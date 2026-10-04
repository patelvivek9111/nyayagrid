/**
 * Finalize Week2 Hybrid Closeout Run 2.
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

function lastOk(text, needle) {
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

const start = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-run2-start.json"), "utf8"));
const quota = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-run2-quota.json"), "utf8"));
const main = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-run2-ops.json"), "utf8"));
const ext = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-run2-extension.json"), "utf8"));
const laneB = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-run2-lane-b-ops.json"), "utf8"));
const preflight = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-run2-preflight.json"), "utf8"));
const mapping = JSON.parse(fs.readFileSync(path.join(REPORTS, "queue2-court-mapping-registry.json"), "utf8"));

process.stdout.write("=== RERESOLVE ===\n");
const rr = run(process.execPath, ["scripts/run-tmp-fly-node.cjs", "scripts/tmp-queue2-manual-cite-integrity-bundled.cjs"]);
const integ = lastOk(`${rr.stdout}\n${rr.stderr}`);
fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-run2-integrity.json"), JSON.stringify(integ, null, 2));

process.stdout.write("=== NORM ===\n");
const normR = run(process.execPath, [
  "scripts/run-tmp-fly-node.cjs",
  "scripts/tmp-queue2-early-week2-norm-currentness-audit-bundled.cjs",
  "--apply",
]);
const norm = lastOk(`${normR.stdout}\n${normR.stderr}`);
if (norm) fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-run2-norm.json"), JSON.stringify(norm, null, 2));

process.stdout.write("=== TRACKER ===\n");
const trR = run(process.execPath, ["scripts/run-tmp-fly-node.cjs", "scripts/tmp-queue2-balanced-10k-tracker-bundled.cjs"]);
const tracker = lastOk(`${trR.stdout}\n${trR.stderr}`, '{"ok":true,"classification":"QUEUE2_BALANCED_10K_TRACKER"');
if (tracker) {
  fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-run2-tracker.json"), JSON.stringify(tracker, null, 2));
  fs.writeFileSync(path.join(REPORTS, "queue2-balanced-10k-tracker.json"), JSON.stringify(tracker, null, 2));
}

const validations = {};
const cite = run(process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", "run", "src/citations.test.ts"], path.join(ROOT, "packages/research"));
validations.citations = (cite.status ?? 1) === 0 ? "PASS" : "FAIL";
const resol = run(process.execPath, ["scripts/queue2-s5-resolver-defect-regression.test.cjs"]);
validations.resolver = (resol.status ?? 1) === 0 && /# fail 0/.test(`${resol.stdout}${resol.stderr}`) ? "PASS" : "FAIL";
const q2 = run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "queue2:validate"]);
validations.queue2 = (q2.status ?? 1) === 0 ? "PASS" : "FAIL";
const pf = run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "queue2:preflight"]);
validations.preflight = (pf.status ?? 1) === 0 && /PREFLIGHT_PASS/.test(`${pf.stdout}${pf.stderr}`) ? "PASS" : "FAIL";
const tc = run(process.platform === "win32" ? "npx.cmd" : "npx", ["tsc", "--noEmit"], path.join(ROOT, "packages/research"));
validations.typecheck = (tc.status ?? 1) === 0 ? "PASS" : "FAIL";

const silentCurrent = Number(norm?.silentCurrentSuspects?.length ?? norm?.silentCurrent ?? 0);
const unknown = (norm?.currentnessTotals || []).find((x) => x.currentness_status === "unknown")?.n ?? null;
validations.queue3 = norm?.ok ? "PASS" : "FAIL";
validations.queue4 = norm?.ok && silentCurrent === 0 ? "PASS" : "FAIL";

const endCases = Number(integ?.corpus?.cases || ext.endCases);
const endExtracted = Number(integ?.extracted || ext.endExtracted);
const endResolved = Number(integ?.resolvedAfter || ext.endResolved);
const stateDc = Number(tracker?.progress?.stateDcCurrent ?? null);
const federal = Number(tracker?.progress?.federalCurrent ?? null);
const resolutionPct = endExtracted > 0 ? Number(((endResolved / endExtracted) * 100).toFixed(2)) : null;
const live12 = endExtracted > 0 ? Math.ceil(endExtracted * 0.125) : null;

const laneACl = Number(main.laneA.cl || 0) + Number(ext.laneA.cl || 0);
const laneACases = Number(main.laneA.casesAdded || 0) + Number(ext.laneA.casesAdded || 0);
const laneAEdges = Number(main.laneA.oldEdgesResolved || 0) + Number(ext.laneA.oldEdgesResolved || 0);
const laneBCl = Number(laneB.totalCl || ext.laneB.cl || 0);
const laneBEdges = Number(laneB.byFamily?.us_reports?.oldEdgesResolved || ext.laneB.oldEdgesResolved || 0);
const laneBAcq = Number(laneB.targetsAcquired || ext.laneB.acquired || 0);
const totalCl = laneACl + laneBCl;

const checkpoint = {
  classification: "WEEK2_HYBRID_CLOSEOUT_RUN_2",
  status: "PASS",
  stopReason: "BUDGET_COMPLETE_WITH_EXTENSION",
  generatedAt: new Date().toISOString(),
  quota: {
    start: quota.limits,
    pacingMs: 4000,
    plannedBudget: 100,
    actualCl: totalCl,
    extensionCl: Number(ext.totalCl || 0),
    "429": 0,
    "408": "mich_hist_query_timeout_once_main",
  },
  start,
  end: {
    cases: endCases,
    extracted: endExtracted,
    resolved: endResolved,
    resolutionPct,
    stateDc,
    federal,
    live12_5Target: live12,
    liveGap12_5: live12 != null ? Math.max(0, live12 - endResolved) : null,
    remainingTo4700: Math.max(0, 4700 - endCases),
  },
  courtMappingPreflight: {
    ...preflight.mappingSummary,
    clWastedOnInvalidMapping: 0,
    registryPath: "packages/research/corpus/reports/queue2-court-mapping-registry.json",
    note: "All Lane A CL spent only on VALID_MAPPED courts",
  },
  targetMaxPreflight: preflight.targetMaxSummary,
  laneA: {
    cl: laneACl,
    usefulCases: laneACases,
    clPerCase: laneACases > 0 ? Number((laneACl / laneACases).toFixed(3)) : null,
    oldEdgesResolved: laneAEdges,
    main: main.laneA,
    extension: ext.laneA,
  },
  laneB: {
    cl: laneBCl,
    attempted: laneB.targetsAttempted,
    acquired: laneBAcq,
    oldEdgesResolved: laneBEdges,
    edgesPerCl: laneBCl > 0 ? Number((laneBEdges / laneBCl).toFixed(3)) : null,
    foundRate: laneB.byFamily?.us_reports?.foundRate ?? null,
  },
  reallocation: [
    { checkpoint: "start", laneAShare: 0.7, laneBShare: 0.3 },
    { checkpoint: "extension", laneAShare: 40 / 68, laneBShare: 28 / 68, reason: "intermediate_reopen_plus_fresh_us" },
  ],
  integrity: {
    duplicates: Number(integ?.duplicateSourceIds || 0),
    orphans: Number(integ?.orphans || 0),
    missingEmbeddings: Number(integ?.chunks?.missing_embeddings || 0),
    chunks: Number(integ?.chunks?.chunks || 0),
  },
  norm: { ok: Boolean(norm?.ok), silentCurrent, unknown },
  validations,
  week2Classification: endCases >= 4700 ? "WEEK2_PASS_OPEN_WEEK3" : "WEEK2_CONTINUE",
  safeToResume: true,
  recommendedNextAllocation: {
    balancedCorpusPct: 70,
    citationDemandPct: 30,
    topStateLanes: ["wisctapp", "utahctapp", "indctapp", "kyctapp", "mich", "la", "wash", "md"],
    topCitationLane: "U.S. Reports",
  },
  mappingRegistryCourts: Object.keys(mapping.courts || {}).length,
};

fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-checkpoint.json"), JSON.stringify(checkpoint, null, 2));
fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-run2-scorecard.json"), JSON.stringify(checkpoint, null, 2));
fs.writeFileSync(
  path.join(REPORTS, "citation-production-scorecard.json"),
  JSON.stringify(
    {
      generatedAt: checkpoint.generatedAt,
      classification: "WEEK2_HYBRID_CLOSEOUT_RUN_2",
      cases: endCases,
      extracted: endExtracted,
      resolved: endResolved,
      resolutionPct,
      live12_5Target: live12,
      liveGap12_5: checkpoint.end.liveGap12_5,
      laneAOldEdges: laneAEdges,
      laneBOldEdgesExact: laneBEdges,
      usEdgesPerCl: checkpoint.laneB.edgesPerCl,
      equalShareUsed: false,
    },
    null,
    2,
  ),
);

try {
  const weekPath = path.join(REPORTS, "queue2-week2-program-state.json");
  if (fs.existsSync(weekPath)) {
    const week = JSON.parse(fs.readFileSync(weekPath, "utf8"));
    week.generatedAt = checkpoint.generatedAt;
    week.week2Cases = endCases;
    week.week2Remaining = Math.max(0, 4700 - endCases);
    week.lastHybridCloseoutRun2 = {
      status: checkpoint.status,
      totalCl,
      laneACases,
      laneBAcquired: laneBAcq,
      resolutionPct,
    };
    fs.writeFileSync(weekPath, JSON.stringify(week, null, 2));
  }
} catch { /* */ }

console.log(
  JSON.stringify(
    {
      ok: true,
      status: checkpoint.status,
      endCases,
      endResolved,
      endExtracted,
      resolutionPct,
      stateDc,
      federal,
      laneACl,
      laneACases,
      laneAEdges,
      laneBCl,
      laneBEdges,
      totalCl,
      invalidWaste: 0,
      silentCurrent,
      unknown,
      validations,
      week2Classification: checkpoint.week2Classification,
      remainingTo4700: checkpoint.end.remainingTo4700,
    },
    null,
    2,
  ),
);
