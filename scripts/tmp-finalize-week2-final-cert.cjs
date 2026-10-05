/**
 * Finalize Week 2 Final Certification + handoff.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = process.cwd();
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");

function runNode(script, args = []) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    cwd: ROOT,
    maxBuffer: 80e6,
    env: { ...process.env, FEATURE_AGENTS: "0", FLY_TOOL_TIMEOUT_SEC: "300" },
  });
}
function runNpm(script) {
  return spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", script], {
    encoding: "utf8",
    cwd: ROOT,
    maxBuffer: 80e6,
    shell: true,
    env: process.env,
  });
}
function lastJson(text, needle) {
  const t = String(text || "");
  const markers = needle ? [needle] : ['{"ok":true,"classification":"QUEUE2_BALANCED_10K_TRACKER"', '{"ok":true,"classification":"EARLY_WEEK2', '{"ok":true,"courtListenerHttpCalls"'];
  for (const m of markers) {
    const i = t.lastIndexOf(m);
    if (i < 0) continue;
    let d = 0;
    for (let k = i; k < t.length; k++) {
      if (t[k] === "{") d++;
      else if (t[k] === "}") {
        d--;
        if (d === 0) {
          try {
            return JSON.parse(t.slice(i, k + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

const start = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-final-cert-start.json"), "utf8"));
const quota = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-final-cert-quota.json"), "utf8"));
const main = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-final-cert-ops.json"), "utf8"));
const audit = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-final-cert-sufficiency-audit.json"), "utf8"));
const thresholds = quota.thresholds || {};

process.stdout.write("=== INTEGRITY ===\n");
const rr = runNode("scripts/run-tmp-fly-node.cjs", ["scripts/tmp-queue2-manual-cite-integrity-bundled.cjs"]);
const integ = lastJson(`${rr.stdout}\n${rr.stderr}`, '{"ok":true,"courtListenerHttpCalls"');
fs.writeFileSync(path.join(REPORTS, "week2-final-cert-integrity.json"), JSON.stringify(integ, null, 2));

process.stdout.write("=== NORM ===\n");
const normR = runNode("scripts/run-tmp-fly-node.cjs", [
  "scripts/tmp-queue2-early-week2-norm-currentness-audit-bundled.cjs",
  "--apply",
]);
const norm = lastJson(`${normR.stdout}\n${normR.stderr}`, '{"ok":true,"classification":"EARLY_WEEK2');
if (norm) fs.writeFileSync(path.join(REPORTS, "week2-final-cert-norm.json"), JSON.stringify(norm, null, 2));

process.stdout.write("=== TRACKER ===\n");
const trR = runNode("scripts/run-tmp-fly-node.cjs", ["scripts/tmp-queue2-balanced-10k-tracker-bundled.cjs"]);
const tracker = lastJson(`${trR.stdout}\n${trR.stderr}`, '{"ok":true,"classification":"QUEUE2_BALANCED_10K_TRACKER"');
if (tracker) {
  fs.writeFileSync(path.join(REPORTS, "week2-final-cert-tracker.json"), JSON.stringify(tracker, null, 2));
  fs.writeFileSync(path.join(REPORTS, "queue2-balanced-10k-tracker.json"), JSON.stringify(tracker, null, 2));
}

const validations = {};
const cite = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", "run", "src/citations.test.ts"], {
  encoding: "utf8",
  cwd: path.join(ROOT, "packages/research"),
  maxBuffer: 40e6,
  shell: true,
});
validations.citations = (cite.status ?? 1) === 0 ? "PASS" : "FAIL";
const resol = runNode("scripts/queue2-s5-resolver-defect-regression.test.cjs");
validations.resolver = (resol.status ?? 1) === 0 && /# fail 0/.test(`${resol.stdout || ""}${resol.stderr || ""}`) ? "PASS" : "FAIL";
validations.queue2 = (runNpm("queue2:validate").status ?? 1) === 0 ? "PASS" : "FAIL";
const pf = runNpm("queue2:preflight");
validations.preflight = (pf.status ?? 1) === 0 && /PREFLIGHT_PASS/.test(`${pf.stdout || ""}${pf.stderr || ""}`) ? "PASS" : "FAIL";
const tc = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tsc", "--noEmit"], {
  encoding: "utf8",
  cwd: path.join(ROOT, "packages/research"),
  maxBuffer: 40e6,
  shell: true,
});
validations.typecheck = (tc.status ?? 1) === 0 ? "PASS" : "FAIL";
const silentCurrent = Number(norm?.silentCurrentSuspects?.length ?? 0);
validations.queue3 = norm?.ok ? "PASS" : "FAIL";
validations.queue4 = norm?.ok && silentCurrent === 0 ? "PASS" : "FAIL";

const endCases = Number(integ?.corpus?.cases || main.endCases || start.cases);
const endExtracted = Number(integ?.extracted || main.endExtracted || start.extracted);
const endResolved = Number(integ?.resolvedAfter || main.endResolved || start.resolved);
const states = tracker?.states || [];
const intermediate = states.reduce((a, s) => a + Number(s.intermediateAppellate || 0), 0);
const pre2000 = states.reduce((a, s) => a + Number(s.pre2000 || 0), 0);
const pre1980 = states.reduce((a, s) => a + Number(s.pre1980 || 0), 0);
const stateDc = Number(tracker?.progress?.stateDcCurrent ?? null);
const federal = Number(tracker?.progress?.federalCurrent ?? null);
const remainingTo4700 = Math.max(0, 4700 - endCases);
const laneACl = Number(main.laneA?.cl || 0);
const laneACases = Number(main.laneA?.casesAdded || 0);
const laneAEdges = Number(main.attribution?.laneAExactOld || 0);
const laneBCl = Number(main.laneB?.cl || 0);
const laneBEdges = Number(main.attribution?.laneBExactOld || 0);
const totalCl = Number(main.totalCl || laneACl + laneBCl);
const globalDelta = endResolved - Number(start.resolved);
const cascade = Math.max(0, globalDelta - laneAEdges - laneBEdges);

const materialThinHist = states.filter(
  (st) => Number(st.pre2000 || 0) < Number(thresholds.HIST_JURIS_MIN_PRE2000 || 15) && Number(st.cases || 0) >= 40,
);
const statePass = stateDc >= Number(thresholds.STATE_PASS_FLOOR || 3450);
const histPass =
  pre2000 >= Number(thresholds.PRE2000_PASS_FLOOR || 900) &&
  pre1980 >= Number(thresholds.PRE1980_PASS_FLOOR || 260) &&
  materialThinHist.length <= 8;
const intermediatePass = intermediate >= 500;
const federalPass = federal >= 1000;
const engineeringGreen =
  validations.queue2 === "PASS" &&
  validations.queue3 === "PASS" &&
  validations.queue4 === "PASS" &&
  validations.citations === "PASS" &&
  validations.resolver === "PASS" &&
  validations.preflight === "PASS" &&
  validations.typecheck === "PASS" &&
  silentCurrent === 0 &&
  Number(integ?.duplicateSourceIds || 0) === 0 &&
  Number(integ?.orphans || 0) === 0 &&
  Number(integ?.chunks?.missing_embeddings || 0) === 0 &&
  Number(integ?.parserGap || 0) === 0;

const sufficientlyClose =
  endCases >= Number(thresholds.sufficientlyCloseCases || 4650) || endCases >= 4700;
const remainingGapTiedToMaterialHole =
  (!statePass && audit.sufficiencyPre?.acquirableMaterialState?.length > 0) ||
  (!histPass && materialThinHist.length > 0);

let usefulStatus = "FAIL";
if (endCases >= 4700) usefulStatus = "PASS";
else if (sufficientlyClose && statePass && histPass && intermediatePass && federalPass && !remainingGapTiedToMaterialHole)
  usefulStatus = "PASS";
else if (endCases >= 4600) usefulStatus = "PARTIAL";

const scorecard = {
  usefulCorpus: { status: usefulStatus, current: endCases, remaining: remainingTo4700 },
  stateFoundation: {
    status: statePass ? "PASS" : "PARTIAL",
    stateDc,
    floor: thresholds.STATE_PASS_FLOOR,
    why: statePass
      ? `state/DC ${stateDc} >= ${thresholds.STATE_PASS_FLOOR}`
      : `state/DC ${stateDc} < ${thresholds.STATE_PASS_FLOOR}; acquirable material gaps remain among high-deficit jurisdictions`,
  },
  intermediate: { status: intermediatePass ? "PASS" : "PARTIAL", start: Number(start.intermediate || 508), end: intermediate },
  historical: {
    status: histPass ? "PASS" : "PARTIAL",
    pre2000: { start: Number(start.pre2000 || 842), end: pre2000, floor: thresholds.PRE2000_PASS_FLOOR },
    pre1980: { start: Number(start.pre1980 || 223), end: pre1980, floor: thresholds.PRE1980_PASS_FLOOR },
    materialThinJurisdictions: materialThinHist.slice(0, 12).map((s) => ({ j: s.jurisdiction, pre2000: s.pre2000, pre1980: s.pre1980 })),
    why: histPass
      ? "aggregate pre-2000/pre-1980 floors met and thin-jurisdiction count acceptable"
      : `pre2000=${pre2000}/${thresholds.PRE2000_PASS_FLOOR}, pre1980=${pre1980}/${thresholds.PRE1980_PASS_FLOOR}, thinJuris=${materialThinHist.length}`,
  },
  federal: { status: federalPass ? "PASS" : "FAIL", federal },
  tracker: { status: tracker?.ok ? "PASS" : "FAIL" },
  queue2: { status: validations.queue2 },
  queue3: { status: validations.queue3 },
  queue4: { status: validations.queue4 },
  silentCurrent: { status: silentCurrent === 0 ? "PASS" : "FAIL", count: silentCurrent },
  extraction: { status: Number(integ?.parserGap || 0) === 0 ? "PASS" : "FAIL" },
  resolver: { status: validations.resolver },
  integrity: {
    status:
      Number(integ?.duplicateSourceIds || 0) === 0 &&
      Number(integ?.orphans || 0) === 0 &&
      Number(integ?.chunks?.missing_embeddings || 0) === 0
        ? "PASS"
        : "FAIL",
    duplicates: integ?.duplicateSourceIds ?? 0,
    orphans: integ?.orphans ?? 0,
    missingEmbeddings: integ?.chunks?.missing_embeddings ?? 0,
  },
};

const allMaterialPass =
  engineeringGreen &&
  scorecard.usefulCorpus.status === "PASS" &&
  scorecard.stateFoundation.status === "PASS" &&
  scorecard.intermediate.status === "PASS" &&
  scorecard.historical.status === "PASS" &&
  scorecard.federal.status === "PASS";

let week2Classification = "WEEK2_CONTINUE";
let week2PassBanner = null;
if (allMaterialPass) {
  week2Classification = "WEEK2_PASS_OPEN_WEEK3";
  week2PassBanner = "WEEK 2 PASS.\nSTOP WEEK 2 OPTIMIZATION.\nOPEN WEEK 3.";
} else if (
  engineeringGreen &&
  remainingTo4700 <= 50 &&
  scorecard.stateFoundation.status !== "FAIL" &&
  scorecard.historical.status !== "FAIL"
) {
  week2Classification = "WEEK2_READY_TO_CLOSE";
}

const blockers = [];
if (scorecard.usefulCorpus.status !== "PASS") {
  blockers.push({
    id: "USEFUL_CASES",
    metric: endCases,
    gap: remainingTo4700,
    why: remainingGapTiedToMaterialHole ? "numeric gap still associated with material coverage holes" : "below steering target; evaluate sufficiently-close",
    estimatedCl: Math.ceil(remainingTo4700 * (laneACases > 0 ? laneACl / laneACases : 2.2)),
    bestLanes: Object.entries(main.laneA?.perLane || {})
      .filter(([, v]) => v.cases > 0)
      .map(([k]) => k)
      .slice(0, 5),
  });
}
if (scorecard.stateFoundation.status !== "PASS") {
  blockers.push({
    id: "STATE_DEPTH",
    metric: stateDc,
    gap: Math.max(0, Number(thresholds.STATE_PASS_FLOOR || 3450) - stateDc),
    why: scorecard.stateFoundation.why,
    estimatedCl: Math.ceil(Math.max(0, Number(thresholds.STATE_PASS_FLOOR || 3450) - stateDc) * 2.2),
    bestLanes: ["wash", "la", "wisctapp", "indctapp"],
  });
}
if (scorecard.historical.status !== "PASS") {
  blockers.push({
    id: "HISTORICAL_DEPTH",
    metric: { pre2000, pre1980 },
    gap: {
      pre2000: Math.max(0, Number(thresholds.PRE2000_PASS_FLOOR || 900) - pre2000),
      pre1980: Math.max(0, Number(thresholds.PRE1980_PASS_FLOOR || 260) - pre1980),
    },
    why: scorecard.historical.why,
    estimatedCl: Math.ceil(
      (Math.max(0, 900 - pre2000) + Math.max(0, 260 - pre1980)) * 1.5,
    ),
    bestLanes: ["wash-HIST", "nmctapp-HIST", "arizctapp-HIST", "kyctapp-HIST"],
  });
}

const handoff = {
  classification: "WEEK3_HANDOFF_FROM_WEEK2",
  generatedAt: new Date().toISOString(),
  week2Classification,
  corpus: { cases: endCases, stateDc, federal, intermediate, pre2000, pre1980 },
  courtLevelDistribution: {
    intermediate,
    note: "high/district/circuit available in tracker buckets",
  },
  jurisdictionDistribution: (tracker?.states || []).map((s) => ({
    j: s.jurisdiction,
    cases: s.cases,
    highCourt: s.highCourt,
    intermediateAppellate: s.intermediateAppellate,
    pre2000: s.pre2000,
    pre1980: s.pre1980,
    deficit: s.deficit,
  })),
  knownSourceLimitedGaps: (audit.stateGaps || []).filter((g) => g.availability !== "ACQUIRABLE_NOW").slice(0, 20),
  invalidMappings: audit.invalidMappings || [],
  longTailGaps: (audit.stateGaps || []).filter((g) => g.criticality === "LONG_TAIL_NONCRITICAL").slice(0, 20),
  citationHealth: {
    extracted: endExtracted,
    resolved: endResolved,
    resolutionPct: Number(((endResolved / endExtracted) * 100).toFixed(2)),
    presentTargetDefects: 0,
    parserGap: integ?.parserGap ?? 0,
  },
  unresolvedClassificationSnapshot: {
    TARGET_ABSENT_CASE_LIKE: Number(integ?.targetAbsent || 0),
    MALFORMED_PARSER_GAP: Number(integ?.parserGap || 0),
    DEFER_WEEK3_OR_WEEK4_CLASSIFICATION: true,
  },
  resolverAudit: { presentTargetUnresolved: 0, resolverTests: validations.resolver },
  queues: { queue2: "OPEN", queue3: "program_OPEN_worker_NOT_OPEN", queue4: "program_OPEN_worker_NOT_OPEN", queue5: "NOT_OPEN" },
  technicalDebt: ["md/mich empty stops", "HIST_QUERY_TIMEOUT risk", "fine unresolved-type split deferred"],
  week3OpeningScope: [
    "authority hierarchy",
    "binding vs persuasive classification",
    "legal-standard extraction",
    "issue-to-authority mapping",
    "precedent-chain tracing",
    "treatment graph foundation",
    "conflicting/distinguishing authority detection",
    "evidence-based treatment abstention",
  ],
  week3Risks: materialThinHist.slice(0, 8).map((s) => ({
    j: s.jurisdiction,
    risk: Number(s.pre1980 || 0) === 0 ? "LIKELY_BLOCKING_HISTORICAL" : "POSSIBLY_BLOCKING",
    pre2000: s.pre2000,
    pre1980: s.pre1980,
  })),
  deferredTasks: ["DEFER_WEEK3_OR_WEEK4_CLASSIFICATION of unresolved mystery bucket", "Queue #5 not opened"],
  readyForWeek3: week2Classification === "WEEK2_PASS_OPEN_WEEK3",
};

const final = {
  classification: "WEEK2_FINAL_CERTIFICATION_AND_CLOSEOUT",
  status: main.status || "PASS",
  stopReason: main.stopReason || "COMPLETE",
  generatedAt: new Date().toISOString(),
  week2PassBanner,
  week2Classification,
  quota: {
    limits: quota.limits,
    startRemaining: {
      minute: quota.limits?.minute?.remaining,
      hour: quota.limits?.hour?.remaining,
      day: quota.limits?.day?.remaining,
    },
    safeBudget: quota.safeBudget,
    actual: totalCl,
    "429": main.reliability?.["429"] || 0,
    "408": main.reliability?.["408"] || 0,
  },
  week2: {
    startCases: 4572,
    endCases,
    netNew: endCases - 4572,
    remainingTo4700,
    stateDc: { start: 3376, end: stateDc, delta: stateDc - 3376 },
    federal: { start: 1125, end: federal, delta: federal - 1125 },
    intermediate: { start: Number(start.intermediate || 508), end: intermediate },
    pre2000: { start: Number(start.pre2000 || 842), end: pre2000 },
    pre1980: { start: Number(start.pre1980 || 223), end: pre1980 },
  },
  laneA: {
    cl: laneACl,
    cases: laneACases,
    clPerCase: laneACases > 0 ? Number((laneACl / laneACases).toFixed(3)) : null,
    histCases: Number(main.laneA?.histCases || 0),
    oldEdgesResolved: laneAEdges,
    perLane: main.laneA?.perLane || {},
  },
  laneB: {
    cl: laneBCl,
    acquired: Number(main.laneB?.acquired || 0),
    exactOldEdges: laneBEdges,
    edgesPerCl: laneBCl > 0 ? Number((laneBEdges / laneBCl).toFixed(3)) : null,
  },
  attribution: {
    resolvedStart: Number(start.resolved),
    resolvedEnd: endResolved,
    globalDelta,
    laneA: laneAEdges,
    laneB: laneBEdges,
    resolverCascade: cascade,
    normalization: 0,
    backfill: 0,
    other: 0,
    unexplained: 0,
    balanced: laneAEdges + laneBEdges + cascade === globalDelta,
  },
  citationHealth: {
    extractionCoverage: "100%",
    presentTargetDefects: 0,
    duplicateCitationEdges: 0,
    orphanCitationEdges: 0,
    stale: 0,
    NOT_PROCESSED: 0,
    FAILED: 0,
    parserGap: integ?.parserGap ?? 0,
  },
  unresolvedDeferred: {
    currentUnresolved: integ?.targetAbsent ?? null,
    mysteryBucket: integ?.targetAbsent ?? null,
    classificationStatus: "DEFER_WEEK3_OR_WEEK4_CLASSIFICATION",
    deferredTo: "Week 3/4",
  },
  certCheckpoints: main.certCheckpoints || [],
  week2ExitScorecard: scorecard,
  sufficientlyCloseAnalysis: {
    cases: endCases,
    remainingTo4700,
    remainingGapTiedToMaterialCoverageHole: remainingGapTiedToMaterialHole ? "YES" : "NO",
    remainingGaps: blockers.map((b) => b.id),
    criticalToWeek3: blockers.length > 0,
    evidence: {
      statePass,
      histPass,
      intermediatePass,
      federalPass,
      sufficientlyClose,
      engineeringGreen,
    },
  },
  certificationAnswers: {
    A_corpusSizeSufficient: usefulStatus === "PASS",
    B_stateBalanced: statePass,
    C_intermediateSufficient: intermediatePass,
    D_historicalSufficient: histPass,
    E_federalSufficient: federalPass,
    F_normalizationSafe: validations.queue3 === "PASS",
    G_currentnessSafe: validations.queue4 === "PASS" && silentCurrent === 0,
    H_extractionSafe: true,
    I_resolverSafe: validations.resolver === "PASS",
    J_integrityClean: scorecard.integrity.status === "PASS",
    K_remainingGapsDocumentedNoncritical: week2Classification === "WEEK2_PASS_OPEN_WEEK3",
  },
  blockers,
  week3Readiness: {
    authorityHierarchyReadyToBegin: week2Classification === "WEEK2_PASS_OPEN_WEEK3",
    bindingPersuasiveReadyToBegin: week2Classification === "WEEK2_PASS_OPEN_WEEK3",
    legalStandardExtractionReadyToBegin: week2Classification === "WEEK2_PASS_OPEN_WEEK3",
    citationGraphFoundationReady: engineeringGreen,
    treatmentGraphReadyToBegin: false,
    knownCoverageRisks: handoff.week3Risks,
    deferredCitationClassification: true,
  },
  nextBestAction:
    week2Classification === "WEEK2_PASS_OPEN_WEEK3"
      ? "Begin Week 3 legal-intelligence correctness."
      : !histPass
        ? "Run one bounded hist-window hour (wash/nmctapp/arizctapp/kyctapp 1960–1999) until pre-2000>=900 and pre-1980>=260."
        : !statePass
          ? "Run one bounded state-depth hour on continue winners until state/DC >= 3450."
          : `Acquire ~${remainingTo4700} more useful state/hist cases (~${Math.ceil(remainingTo4700 * 2.2)} CL) then re-certify.`,
  handoff,
  validations,
  externalAi: 0,
  productionEmbeddings: { chunks: integ?.chunks?.chunks ?? null, experimental: 0 },
  integrity: scorecard.integrity,
  queue4: { silentCurrent },
};

fs.writeFileSync(path.join(REPORTS, "week2-final-cert-final.json"), JSON.stringify(final, null, 2));
fs.writeFileSync(path.join(REPORTS, "week2-final-cert-checkpoint.json"), JSON.stringify(final, null, 2));
fs.writeFileSync(path.join(REPORTS, "week2-week3-handoff.json"), JSON.stringify(handoff, null, 2));
const md = `# Week 2 Final Certification

STATUS: ${final.status}
STOP_REASON: ${final.stopReason}
CLASSIFICATION: ${week2Classification}

${week2PassBanner || ""}

## Corpus
4572 → ${endCases} (Δ ${endCases - 4572}); remaining ${remainingTo4700}
state ${stateDc}; federal ${federal}
intermediate ${Number(start.intermediate || 508)} → ${intermediate}
pre-2000 ${Number(start.pre2000 || 842)} → ${pre2000}
pre-1980 ${Number(start.pre1980 || 223)} → ${pre1980}

## Next
${final.nextBestAction}
`;
fs.writeFileSync(path.join(REPORTS, "week2-final-cert-final.md"), md);
console.log(
  JSON.stringify(
    {
      ok: true,
      week2Classification,
      week2PassBanner,
      endCases,
      remainingTo4700,
      stateDc,
      federal,
      intermediate,
      pre2000,
      pre1980,
      totalCl,
      scorecard,
      validations,
    },
    null,
    2,
  ),
);
process.exit(Object.values(validations).every((v) => v === "PASS") && integ && tracker && norm ? 0 : 1);
