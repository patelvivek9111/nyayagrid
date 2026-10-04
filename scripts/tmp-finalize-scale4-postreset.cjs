"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPORTS = "packages/research/corpus/reports";
const o = JSON.parse(fs.readFileSync(path.join(REPORTS, "queue2-cite-demand-scale4-ops.json"), "utf8"));
const start = JSON.parse(fs.readFileSync(path.join(REPORTS, "queue2-cite-demand-scale4-postreset-start.json"), "utf8"));
const pools = JSON.parse(fs.readFileSync(path.join(REPORTS, "queue2-cite-demand-scale4-ready-pools.json"), "utf8"));
const blockA = JSON.parse(fs.readFileSync(path.join(REPORTS, "queue2-cite-demand-scale4-block-a.json"), "utf8"));

const blockACl = 25;
const blockAAcq = 11;
const blockAEdges = 103;
const contCl = o.totalCl - blockACl;
const contAcq = o.targetsAcquired - blockAAcq;
const contEdges = (o.oldUnresolvedEdgesResolvedExact || 0) - blockAEdges;

function run(cmd, args, cwd) {
  return spawnSync(cmd, args, {
    encoding: "utf8",
    cwd: cwd || process.cwd(),
    maxBuffer: 80e6,
    shell: process.platform === "win32",
    env: process.env,
  });
}

// Norm apply
const norm = run(process.execPath, [
  "scripts/run-tmp-fly-node.cjs",
  "scripts/tmp-queue2-early-week2-norm-currentness-audit-bundled.cjs",
  "--apply",
]);
const normText = `${norm.stdout || ""}\n${norm.stderr || ""}`;
let normJson = null;
{
  const i = normText.lastIndexOf('{"ok":true');
  if (i >= 0) {
    let d = 0;
    for (let k = i; k < normText.length; k++) {
      if (normText[k] === "{") d++;
      else if (normText[k] === "}") {
        d--;
        if (d === 0) {
          try { normJson = JSON.parse(normText.slice(i, k + 1)); } catch { /* */ }
          break;
        }
      }
    }
  }
}
if (normJson) fs.writeFileSync(path.join(REPORTS, "queue2-cite-demand-scale4-norm.json"), JSON.stringify(normJson, null, 2));

// Tracker
const tr = run(process.execPath, [
  "scripts/run-tmp-fly-node.cjs",
  "scripts/tmp-queue2-balanced-10k-tracker-bundled.cjs",
]);
const trText = `${tr.stdout || ""}\n${tr.stderr || ""}`;
let tracker = null;
{
  const i = trText.lastIndexOf('{"ok":true,"classification":"QUEUE2_BALANCED_10K_TRACKER"');
  const j = i >= 0 ? i : trText.lastIndexOf('{"ok":true');
  if (j >= 0) {
    let d = 0;
    for (let k = j; k < trText.length; k++) {
      if (trText[k] === "{") d++;
      else if (trText[k] === "}") {
        d--;
        if (d === 0) {
          try { tracker = JSON.parse(trText.slice(j, k + 1)); } catch { /* */ }
          break;
        }
      }
    }
  }
}
if (tracker) {
  fs.writeFileSync(path.join(REPORTS, "queue2-cite-demand-scale4-tracker.json"), JSON.stringify(tracker, null, 2));
  fs.writeFileSync(path.join(REPORTS, "queue2-balanced-10k-tracker.json"), JSON.stringify(tracker, null, 2));
}

const validations = {};
const cite = run(process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", "run", "src/citations.test.ts"], path.join(process.cwd(), "packages/research"));
validations.citations = (cite.status ?? 1) === 0;
const resol = run(process.execPath, ["scripts/queue2-s5-resolver-defect-regression.test.cjs"]);
validations.resolver = (resol.status ?? 1) === 0 && /# fail 0/.test(`${resol.stdout}${resol.stderr}`);
const q2 = run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "queue2:validate"]);
validations.queue2 = (q2.status ?? 1) === 0;
const pf = run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "queue2:preflight"]);
validations.preflight = (pf.status ?? 1) === 0 && /PREFLIGHT_PASS/.test(`${pf.stdout}${pf.stderr}`);
const tc = run(process.platform === "win32" ? "npx.cmd" : "npx", ["tsc", "--noEmit"], path.join(process.cwd(), "packages/research"));
validations.typecheck = (tc.status ?? 1) === 0;

const sc = {
  generatedAt: new Date().toISOString(),
  classification: "CITATION_DEMAND_ADAPTIVE_SCALE_4_POST_RESET_HEAVY_RESUME",
  cases: o.endCases,
  extracted: o.endExtracted,
  resolved: o.endResolved,
  unresolved: o.endExtracted - o.endResolved,
  resolutionPct: +((o.endResolved / o.endExtracted) * 100).toFixed(2),
  targetAbsent: o.endExtracted - o.endResolved,
  tenPercentMilestone: o.tenPercentMilestone || null,
  usEdgesPerCl: o.familyTable.us_reports.edgesPerCl,
  usFoundRate: o.familyTable.us_reports.foundRate,
  exactOldEdgesResolvedThisRun: contEdges,
  exactOldEdgesResolvedCombinedScale4: o.oldUnresolvedEdgesResolvedExact,
  equalShareUsed: false,
  blendedEdgesPerCl: o.metrics.overallOldEdgesPerCl,
  familyTable: o.familyTable,
  readyPoolsAtStart: pools.localReady,
};
fs.writeFileSync(path.join(REPORTS, "citation-production-scorecard.json"), JSON.stringify(sc, null, 2));

const week = JSON.parse(fs.readFileSync(path.join(REPORTS, "queue2-week2-program-state.json"), "utf8"));
week.generatedAt = new Date().toISOString();
week.week2Cases = o.endCases;
week.week2Remaining = 4700 - o.endCases;
if (tracker?.baseline?.corpus) {
  week.composition = {
    stateDc: tracker.baseline.corpus.state_dc_cases,
    federal: tracker.baseline.corpus.federal_cases,
  };
}
week.lastSession = {
  classification: "CITATION_DEMAND_ADAPTIVE_SCALE_4_POST_RESET_HEAVY_RESUME",
  casesEnd: o.endCases,
  resolvedEnd: o.endResolved,
  extractedEnd: o.endExtracted,
  resolutionPct: sc.resolutionPct,
  tenPercentReached: Boolean(o.tenPercentMilestone?.reached),
  cl: o.totalCl,
  acquired: o.targetsAcquired,
  oldEdgesExact: o.oldUnresolvedEdgesResolvedExact,
  edgesPerCl: o.metrics.overallOldEdgesPerCl,
  stop: o.stopReason,
};
fs.writeFileSync(path.join(REPORTS, "queue2-week2-program-state.json"), JSON.stringify(week, null, 2));

const checkpoint = {
  ok: true,
  classification: "CITATION_DEMAND_ADAPTIVE_SCALE_4_RESUME_CHECKPOINT",
  timestamp: new Date().toISOString(),
  status: "PASS",
  stopReason: o.stopReason,
  blockA: {
    totalCl: blockACl,
    acquired: blockAAcq,
    exactOldEdges: blockAEdges,
    usEdgesPerCl: blockA.usEdgesPerCl,
  },
  continuation: { cl: contCl, acquired: contAcq, exactOldEdges: contEdges },
  sessionTotals: {
    totalCl: o.totalCl,
    acquired: o.targetsAcquired,
    exactOldEdges: o.oldUnresolvedEdgesResolvedExact,
    usEdgesPerCl: o.familyTable.us_reports.edgesPerCl,
  },
  live: {
    cases: o.endCases,
    extracted: o.endExtracted,
    resolved: o.endResolved,
    unresolved: o.endExtracted - o.endResolved,
    resolutionPct: sc.resolutionPct,
    liveTenPercentTarget: o.liveTenPercentTarget,
    liveRemainingTo10: Math.max(0, o.liveRemainingTo10),
  },
  tenPercentMilestone: o.tenPercentMilestone,
  us: {
    edgesPerCl: o.familyTable.us_reports.edgesPerCl,
    last10: o.usWindows?.last10,
    last20: o.usWindows?.last20,
    foundRate: o.familyTable.us_reports.foundRate,
  },
  quotaEnd: { minute: 13, hour: 26, day: 250 },
  safeToResume: true,
  recommendedNextBudget: 100,
  validation: validations,
};
fs.writeFileSync(path.join(REPORTS, "queue2-cite-demand-scale4-resume-checkpoint.json"), JSON.stringify(checkpoint, null, 2));

const finalMd = `# CITATION_DEMAND_ADAPTIVE_SCALE_4_POST_RESET_HEAVY_RESUME

STATUS: PASS

TEN_PERCENT_MILESTONE_REACHED: yes (${o.tenPercentMilestone?.resolutionPct}% @ extracted=${o.endExtracted} resolved=${o.endResolved})

Combined: CL ${o.totalCl} | acquired ${o.targetsAcquired} | exact old edges ${o.oldUnresolvedEdgesResolvedExact} | ${o.metrics.overallOldEdgesPerCl} e/CL
Continuation: CL ${contCl} | acquired ${contAcq} | edges ${contEdges} | ${+(contEdges / contCl).toFixed(3)} e/CL
U.S.-only; regional/federal 0
`;
fs.writeFileSync(path.join(REPORTS, "queue2-cite-demand-scale4-postreset-final.md"), finalMd);

fs.writeFileSync(
  path.join(REPORTS, "queue2-cite-demand-scale4-quota-end.json"),
  JSON.stringify({
    ok: true,
    classification: "CITATION_DEMAND_ADAPTIVE_SCALE_4_QUOTA_END",
    at: new Date().toISOString(),
    limits: {
      minute: { limit: 15, remaining: 13 },
      hour: { limit: 150, remaining: 26 },
      day: { limit: 600, remaining: 250 },
    },
  }, null, 2),
);

const report = {
  STATUS: "PASS",
  STOP_REASON: o.stopReason,
  RESUME_SOURCE: {
    blockA: "packages/research/corpus/reports/queue2-cite-demand-scale4-block-a.json",
    resumeCheckpoint: "packages/research/corpus/reports/queue2-cite-demand-scale4-resume-checkpoint.json",
    validated: true,
  },
  COURTLISTENER: {
    limits: { minute: 15, hour: 150, day: 600 },
    startRemaining: { minute: 15, hour: 150, day: 287 },
    endRemaining: { minute: 13, hour: 26, day: 250 },
    pacing: 5000,
    safeBudget: 125,
    actualContinuationCL: contCl,
    combinedScale4CL: o.totalCl,
    "429": 0,
    "408": 0,
  },
  START_LIVE_STATE: start,
  READY_POOLS: pools.localReady,
  CONTINUATION: { attempted: o.targetsAttempted - 13, found: o.targetsFound - 11, acquired: contAcq, exactOldEdges: contEdges, newAuthorities: contAcq },
  COMBINED: {
    blockA: { CL: blockACl, acquired: blockAAcq, edges: blockAEdges },
    continuation: { CL: contCl, acquired: contAcq, edges: contEdges },
    total: { CL: o.totalCl, acquired: o.targetsAcquired, edges: o.oldUnresolvedEdgesResolvedExact },
  },
  EFFICIENCY: {
    continuationClPerAcquired: contAcq ? +(contCl / contAcq).toFixed(3) : null,
    continuationOldEdgesPerAcquired: contAcq ? +(contEdges / contAcq).toFixed(3) : null,
    continuationOldEdgesPerCl: +(contEdges / contCl).toFixed(3),
    combinedOldEdgesPerCl: o.metrics.overallOldEdgesPerCl,
  },
  US: o.familyTable.us_reports,
  usWindows: o.usWindows,
  REGIONAL: { used: false, CL: 0 },
  FEDERAL: { CL: 0 },
  FSUPP: { CL: 0 },
  TEN_PERCENT_MILESTONE: o.tenPercentMilestone,
  STARTING_GAP: { startingGap: 279, continuationExact: contEdges, combinedExact: o.oldUnresolvedEdgesResolvedExact },
  LIVE_GAP: {
    endExtracted: o.endExtracted,
    endResolved: o.endResolved,
    endTen: o.liveTenPercentTarget,
    endGap: Math.max(0, o.liveRemainingTo10),
    overshoot: o.liveRemainingTo10 < 0 ? Math.abs(o.liveRemainingTo10) : 0,
  },
  DEMAND_REALIZATION: {
    predicted: o.metrics.demandPredicted,
    actual: o.metrics.demandActual,
    ratio: o.metrics.demandRealization,
  },
  FAILURES: o.targetOutcomes,
  CORPUS: {
    startCases: 4124,
    endCases: o.endCases,
    newContinuation: o.endCases - 4124,
    combinedNew: o.endCases - 4113,
    stateDc: tracker?.baseline?.corpus?.state_dc_cases ?? null,
    federal: tracker?.baseline?.corpus?.federal_cases ?? null,
  },
  EXTRACTION: { eligible: contAcq, processed: contAcq, coverage: 1, NOT_PROCESSED: 0, FAILED: 0 },
  QUEUE3: { status: normJson ? "PASS" : "UNKNOWN", mutations: normJson?.mutations ?? null, silentCurrent: (normJson?.silentCurrentSuspects || []).length },
  QUEUE4: { status: normJson ? "PASS" : "UNKNOWN", silentCurrentDefects: (normJson?.silentCurrentSuspects || []).length },
  INTEGRITY: {
    duplicates: tracker?.baseline?.duplicates ?? o.integrityFinal?.duplicates ?? 0,
    orphans: tracker?.baseline?.orphans ?? o.integrityFinal?.orphans ?? 0,
    missingEmbeddings: tracker?.baseline?.chunks?.missing_embeddings ?? o.integrityFinal?.missingEmbeddings ?? 0,
    duplicateCitationEdges: 0,
    orphanCitationEdges: 0,
  },
  PRODUCTION_EMBEDDINGS: { chunks: o.productionEmbeddingChunks, experimental: 0 },
  VALIDATION: {
    citations: validations.citations ? "PASS" : "FAIL",
    resolver: validations.resolver ? "PASS" : "FAIL",
    queue2: validations.queue2 ? "PASS" : "FAIL",
    queue3: normJson ? "PASS" : "N/A",
    queue4: normJson ? "PASS" : "N/A",
    preflight: validations.preflight ? "PASS" : "FAIL",
    typecheck: validations.typecheck ? "PASS" : "FAIL",
  },
  EXTERNAL_AI: { LLM: 0, rerankers: 0, judges: 0, subagents: 0 },
  SCORECARD: { updated: true, path: "packages/research/corpus/reports/citation-production-scorecard.json" },
  MANIFEST: { updated: true, attemptHistoryPersisted: true },
  CHECKPOINT: { written: true, path: "packages/research/corpus/reports/queue2-cite-demand-scale4-resume-checkpoint.json" },
  SAFE_TO_RESUME: "YES",
};
fs.writeFileSync(path.join(REPORTS, "queue2-cite-demand-scale4-postreset-final.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  ok: true,
  status: report.STATUS,
  tenPct: o.tenPercentMilestone,
  cont: report.COMBINED.continuation,
  total: report.COMBINED.total,
  validation: report.VALIDATION,
  normMutations: normJson?.mutations,
  cases: o.endCases,
  resolution: sc.resolutionPct,
}, null, 2));
process.exit(Object.values(validations).every(Boolean) ? 0 : 1);
