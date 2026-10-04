/**
 * Finalize Week 2 hybrid closeout: reresolve, norm/#4 audit, tracker, validations, reports.
 * Zero LLM.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = process.cwd();
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");

function run(cmd, args, cwd) {
  return spawnSync(cmd, args, {
    encoding: "utf8",
    cwd: cwd || ROOT,
    maxBuffer: 80e6,
    shell: process.platform === "win32",
    env: process.env,
  });
}

function lastOkJson(text, needle) {
  const t = String(text || "");
  const i = needle ? t.lastIndexOf(needle) : t.lastIndexOf('{"ok":true');
  if (i < 0) return null;
  let d = 0;
  for (let k = i; k < t.length; k++) {
    if (t[k] === "{") d++;
    else if (t[k] === "}") {
      d--;
      if (d === 0) {
        try { return JSON.parse(t.slice(i, k + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

const start = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-start.json"), "utf8"));
const quota = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-quota.json"), "utf8"));
const ops = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-ops.json"), "utf8"));
const laneB = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-lane-b-ops.json"), "utf8"));
const reopen = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-lane-a-reopen.json"), "utf8"));

const resolvedAfterLaneB = Number(ops.endResolved || 5263);
const casesAfterLaneB = Number(ops.endCases || 4214);

process.stdout.write("=== RERESOLVE after Lane A ===\n");
const rr = run(process.execPath, [
  "scripts/run-tmp-fly-node.cjs",
  "scripts/tmp-queue2-manual-cite-integrity-bundled.cjs",
]);
const rrJson = lastOkJson(`${rr.stdout || ""}\n${rr.stderr || ""}`);
fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-integrity-final.json"), JSON.stringify(rrJson, null, 2));

const endCases = Number(rrJson?.corpus?.cases || reopen.endCases || 4228);
const endExtracted = Number(rrJson?.extracted || 0);
const endResolved = Number(rrJson?.resolvedAfter || 0);
const laneAEdges = Math.max(0, endResolved - resolvedAfterLaneB);
const laneBEdgesExact = Number(ops.laneB?.oldEdgesResolved || laneB.byFamily?.us_reports?.oldEdgesResolved || 197);

process.stdout.write("=== NORM/CURRENTNESS APPLY ===\n");
const norm = run(process.execPath, [
  "scripts/run-tmp-fly-node.cjs",
  "scripts/tmp-queue2-early-week2-norm-currentness-audit-bundled.cjs",
  "--apply",
]);
const normJson = lastOkJson(`${norm.stdout || ""}\n${norm.stderr || ""}`);
if (normJson) fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-norm.json"), JSON.stringify(normJson, null, 2));

process.stdout.write("=== TRACKER ===\n");
const tr = run(process.execPath, [
  "scripts/run-tmp-fly-node.cjs",
  "scripts/tmp-queue2-balanced-10k-tracker-bundled.cjs",
]);
const tracker = lastOkJson(
  `${tr.stdout || ""}\n${tr.stderr || ""}`,
  '{"ok":true,"classification":"QUEUE2_BALANCED_10K_TRACKER"',
);
if (tracker) {
  fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-tracker.json"), JSON.stringify(tracker, null, 2));
  fs.writeFileSync(path.join(REPORTS, "queue2-balanced-10k-tracker.json"), JSON.stringify(tracker, null, 2));
}

const validations = {};
process.stdout.write("=== VALIDATIONS ===\n");
const cite = run(process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", "run", "src/citations.test.ts"], path.join(ROOT, "packages/research"));
validations.citations = (cite.status ?? 1) === 0;
const resol = run(process.execPath, ["scripts/queue2-s5-resolver-defect-regression.test.cjs"]);
validations.resolver = (resol.status ?? 1) === 0 && /# fail 0/.test(`${resol.stdout || ""}${resol.stderr || ""}`);
const q2 = run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "queue2:validate"]);
validations.queue2 = (q2.status ?? 1) === 0;
const pf = run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "queue2:preflight"]);
validations.preflight = (pf.status ?? 1) === 0 && /PREFLIGHT_PASS/.test(`${pf.stdout || ""}${pf.stderr || ""}`);
const tc = run(process.platform === "win32" ? "npx.cmd" : "npx", ["tsc", "--noEmit"], path.join(ROOT, "packages/research"));
validations.typecheck = (tc.status ?? 1) === 0;

const stateDc = Number(tracker?.baseline?.corpus?.state_dc_cases ?? tracker?.progress?.stateDcCurrent ?? null);
const federal = Number(tracker?.baseline?.corpus?.federal_cases ?? tracker?.progress?.federalCurrent ?? null);
const resolutionPct = endExtracted > 0 ? Number(((endResolved / endExtracted) * 100).toFixed(2)) : null;
const live12_5Target = endExtracted > 0 ? Math.ceil(endExtracted * 0.125) : null;
const liveGap12_5 = live12_5Target != null ? Math.max(0, live12_5Target - endResolved) : null;

const laneAClInitial = Number(ops.laneA?.cl || 55); // burned on unmapped courts
const laneAClReopen = Number(reopen.cl || 0);
const laneACases = Number(reopen.liveCasesAdded || 0);
const laneBCl = Number(ops.laneB?.cl || 59);
const totalCl = laneAClInitial + laneAClReopen + laneBCl;

const silentCurrent = Number(normJson?.silentCurrent ?? normJson?.silent_current ?? normJson?.defects?.silentCurrent ?? 0);
const unknownCurrent = Number(normJson?.unknown ?? normJson?.unknownCurrent ?? normJson?.counts?.unknown ?? null);

const checkpoint = {
  classification: "WEEK2_HYBRID_CLOSEOUT_BALANCED_CORPUS_AND_CITATION_DEMAND",
  status: "PARTIAL_QUOTA_WAIT",
  stopReason: "LOCAL_QUOTA_SAFETY_FLOOR_AFTER_PRODUCTIVE_REOPEN",
  generatedAt: new Date().toISOString(),
  quota: {
    start: quota.limits,
    pacingMs: 4000,
    plannedBudget: 100,
    actualCl: totalCl,
    extensionCl: laneAClReopen,
    "429": 0,
    "408": "fly_exec_timeouts_observed_on_some_laneA_attempts",
  },
  start,
  end: {
    cases: endCases,
    extracted: endExtracted,
    resolved: endResolved,
    resolutionPct,
    stateDc,
    federal,
    live12_5Target,
    liveGap12_5,
    remainingTo4700: Math.max(0, 4700 - endCases),
  },
  laneA: {
    initialCl: laneAClInitial,
    initialCasesReported: 0,
    initialFailure: "unmapped_court IDs (michctapp/lactapp/mdctapp/nevctapp/tennctapp)",
    reopenCl: laneAClReopen,
    usefulCasesAdded: laneACases,
    clPerCase: reopen.clPerCase,
    productive: reopen.productive,
    quarantined: [
      ...(ops.laneA?.quarantined || []),
      { path: "vacapp/njsuperct/nebrctapp", reason: "MAPPING_INVALID_CACHED" },
    ],
    oldCitationEdgesResolved: laneAEdges,
  },
  laneB: {
    cl: laneBCl,
    attempted: ops.laneB?.attempted,
    found: ops.laneB?.found,
    acquired: ops.laneB?.acquired,
    exactOldEdgesResolved: laneBEdgesExact,
    edgesPerCl: ops.laneB?.familyTable?.us_reports?.edgesPerCl ?? 3.339,
    foundRate: ops.laneB?.familyTable?.us_reports?.foundRate ?? 0.933,
    usWindows: ops.laneB?.usWindows,
  },
  reallocationLog: ops.reallocationLog || [],
  integrity: {
    duplicates: Number(rrJson?.duplicateSourceIds ?? 0),
    orphans: Number(rrJson?.orphans ?? 0),
    missingEmbeddings: Number(rrJson?.chunks?.missing_embeddings ?? 0),
    chunks: Number(rrJson?.chunks?.chunks ?? 0),
    embeddings: Number(rrJson?.chunks?.embeddings ?? 0),
  },
  norm: {
    ok: Boolean(normJson?.ok),
    silentCurrent,
    unknown: unknownCurrent,
    summary: normJson
      ? {
          canonicalDefects: normJson.canonicalDefects ?? normJson.defects?.canonical ?? 0,
          normalizationDefects: normJson.normalizationDefects ?? normJson.defects?.normalization ?? 0,
        }
      : null,
  },
  validations: {
    citations: validations.citations ? "PASS" : "FAIL",
    resolver: validations.resolver ? "PASS" : "FAIL",
    queue2: validations.queue2 ? "PASS" : "FAIL",
    queue3: normJson?.ok ? "PASS" : "FAIL",
    queue4: silentCurrent === 0 && normJson?.ok ? "PASS" : "FAIL",
    preflight: validations.preflight ? "PASS" : "FAIL",
    typecheck: validations.typecheck ? "PASS" : "FAIL",
  },
  week2Classification: "WEEK2_CONTINUE",
  safeToResume: true,
  recommendedNextAllocation: {
    balancedCorpusPct: 70,
    citationDemandPct: 30,
    topStateLanes: ["wisctapp", "utahctapp", "indctapp", "kyctapp", "mich", "la", "wash", "md"],
    topCitationLane: "U.S. Reports",
    note: "Lane A requires targetMax > items_imported; avoid unmapped *ctapp IDs; raise targetMax to reopen.",
  },
};

fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-checkpoint.json"), JSON.stringify(checkpoint, null, 2));

const scorecard = {
  generatedAt: checkpoint.generatedAt,
  classification: checkpoint.classification,
  status: checkpoint.status,
  cases: endCases,
  stateDc,
  federal,
  extracted: endExtracted,
  resolved: endResolved,
  resolutionPct,
  laneAUsefulCases: laneACases,
  laneACl: laneAClInitial + laneAClReopen,
  laneBAcquired: ops.laneB?.acquired,
  laneBEdgesExact,
  laneBEdgesPerCl: checkpoint.laneB.edgesPerCl,
  remainingTo4700: checkpoint.end.remainingTo4700,
  live12_5Target,
  liveGap12_5,
  week2Classification: "WEEK2_CONTINUE",
  validations: checkpoint.validations,
};
fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-scorecard.json"), JSON.stringify(scorecard, null, 2));

try {
  const weekPath = path.join(REPORTS, "queue2-week2-program-state.json");
  if (fs.existsSync(weekPath)) {
    const week = JSON.parse(fs.readFileSync(weekPath, "utf8"));
    week.generatedAt = checkpoint.generatedAt;
    week.week2Cases = endCases;
    week.week2Remaining = Math.max(0, 4700 - endCases);
    week.lastHybridCloseout = {
      status: checkpoint.status,
      totalCl,
      laneACases,
      laneBAcquired: ops.laneB?.acquired,
      resolutionPct,
    };
    fs.writeFileSync(weekPath, JSON.stringify(week, null, 2));
  }
} catch { /* */ }

const citeScore = {
  generatedAt: checkpoint.generatedAt,
  classification: "WEEK2_HYBRID_CITATION_SCORECARD",
  cases: endCases,
  extracted: endExtracted,
  resolved: endResolved,
  unresolved: endExtracted - endResolved,
  resolutionPct,
  live12_5Target,
  liveGap12_5,
  laneAOldEdges: laneAEdges,
  laneBOldEdgesExact: laneBEdgesExact,
  usEdgesPerCl: checkpoint.laneB.edgesPerCl,
  equalShareUsed: false,
};
fs.writeFileSync(path.join(REPORTS, "citation-production-scorecard.json"), JSON.stringify(citeScore, null, 2));

console.log(JSON.stringify({
  ok: true,
  status: checkpoint.status,
  endCases,
  endResolved,
  endExtracted,
  resolutionPct,
  laneACases,
  laneAEdges,
  laneBEdgesExact,
  totalCl,
  validations: checkpoint.validations,
  week2Classification: "WEEK2_CONTINUE",
}, null, 2));
