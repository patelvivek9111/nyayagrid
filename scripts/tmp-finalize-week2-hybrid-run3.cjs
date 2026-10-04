/**
 * Finalize Week2 Hybrid Closeout Run 3 (Windows-safe, no shell for node).
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = process.cwd();
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");

function runNode(script, args = [], cwd = ROOT) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    cwd,
    maxBuffer: 80e6,
    env: { ...process.env, FEATURE_AGENTS: "0", FLY_TOOL_TIMEOUT_SEC: "300" },
  });
}

function runCmd(cmd, args, cwd = ROOT) {
  return spawnSync(cmd, args, {
    encoding: "utf8",
    cwd,
    maxBuffer: 80e6,
    env: process.env,
    shell: false,
  });
}

function lastJson(text, needle) {
  const t = String(text || "");
  const markers = needle
    ? [needle]
    : ['{"ok":true,"classification":"QUEUE2_BALANCED_10K_TRACKER"', '{"ok":true,"classification":"EARLY_WEEK2', '{"ok":true,"courtListenerHttpCalls"'];
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
  const lines = t.split(/\n/).map((l) => l.trim()).filter((l) => l.startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const j = JSON.parse(lines[i]);
      if (j && (j.ok === true || j.corpus || j.classification)) return j;
    } catch {
      /* */
    }
  }
  return null;
}

const start = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-run3-start.json"), "utf8"));
const quota = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-run3-quota.json"), "utf8"));
const main = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-run3-ops.json"), "utf8"));
const preflight = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-run3-preflight.json"), "utf8"));
const mapping = JSON.parse(fs.readFileSync(path.join(REPORTS, "queue2-court-mapping-registry.json"), "utf8"));
let laneB = null;
const laneBPath = path.join(REPORTS, "week2-hybrid-closeout-run3-lane-b-ops.json");
if (fs.existsSync(laneBPath)) laneB = JSON.parse(fs.readFileSync(laneBPath, "utf8"));

process.stdout.write("=== RERESOLVE / INTEGRITY ===\n");
const rr = runNode("scripts/run-tmp-fly-node.cjs", ["scripts/tmp-queue2-manual-cite-integrity-bundled.cjs"]);
fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-run3-integrity-raw.txt"), `${rr.stdout || ""}\n${rr.stderr || ""}`);
const integ = lastJson(`${rr.stdout}\n${rr.stderr}`, '{"ok":true,"courtListenerHttpCalls"');
fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-run3-integrity.json"), JSON.stringify(integ, null, 2));

process.stdout.write("=== NORM / CURRENTNESS ===\n");
const normR = runNode("scripts/run-tmp-fly-node.cjs", [
  "scripts/tmp-queue2-early-week2-norm-currentness-audit-bundled.cjs",
  "--apply",
]);
fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-run3-norm-raw.txt"), `${normR.stdout || ""}\n${normR.stderr || ""}`);
const norm = lastJson(`${normR.stdout}\n${normR.stderr}`, '{"ok":true,"classification":"EARLY_WEEK2');
if (norm) fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-run3-norm.json"), JSON.stringify(norm, null, 2));

process.stdout.write("=== TRACKER ===\n");
const trR = runNode("scripts/run-tmp-fly-node.cjs", ["scripts/tmp-queue2-balanced-10k-tracker-bundled.cjs"]);
fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-run3-tracker-end-raw.txt"), `${trR.stdout || ""}\n${trR.stderr || ""}`);
const tracker = lastJson(`${trR.stdout}\n${trR.stderr}`, '{"ok":true,"classification":"QUEUE2_BALANCED_10K_TRACKER"');
if (tracker) {
  fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-run3-tracker.json"), JSON.stringify(tracker, null, 2));
  fs.writeFileSync(path.join(REPORTS, "queue2-balanced-10k-tracker.json"), JSON.stringify(tracker, null, 2));
}

const validations = {};
const cite = runCmd(process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", "run", "src/citations.test.ts"], path.join(ROOT, "packages/research"));
validations.citations = (cite.status ?? 1) === 0 ? "PASS" : "FAIL";
const resol = runNode("scripts/queue2-s5-resolver-defect-regression.test.cjs");
const resolText = `${resol.stdout || ""}${resol.stderr || ""}`;
validations.resolver = (resol.status ?? 1) === 0 && /# fail 0/.test(resolText) ? "PASS" : "FAIL";
const q2 = runCmd(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "queue2:validate"]);
validations.queue2 = (q2.status ?? 1) === 0 ? "PASS" : "FAIL";
const pf = runCmd(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "queue2:preflight"]);
validations.preflight = (pf.status ?? 1) === 0 && /PREFLIGHT_PASS/.test(`${pf.stdout || ""}${pf.stderr || ""}`) ? "PASS" : "FAIL";
const tc = runCmd(process.platform === "win32" ? "npx.cmd" : "npx", ["tsc", "--noEmit"], path.join(ROOT, "packages/research"));
validations.typecheck = (tc.status ?? 1) === 0 ? "PASS" : "FAIL";

const silentCurrent = Number(norm?.silentCurrentSuspects?.length ?? norm?.silentCurrent ?? 0);
const unknown = (norm?.currentnessTotals || []).find((x) => x.currentness_status === "unknown")?.n ?? null;
validations.queue3 = norm?.ok ? "PASS" : "FAIL";
validations.queue4 = norm?.ok && silentCurrent === 0 ? "PASS" : "FAIL";

const endCases = Number(integ?.corpus?.cases || main.endCases || start.cases);
const endExtracted = Number(integ?.extracted || main.endExtracted || start.extracted);
const endResolved = Number(integ?.resolvedAfter || main.endResolved || start.resolved);
const stateDc = Number(tracker?.progress?.stateDcCurrent ?? tracker?.baseline?.corpus?.state_dc_cases ?? null);
const federal = Number(tracker?.progress?.federalCurrent ?? tracker?.baseline?.corpus?.federal_cases ?? null);
const resolutionPct = endExtracted > 0 ? Number(((endResolved / endExtracted) * 100).toFixed(2)) : null;
const live12 = endExtracted > 0 ? Math.ceil(endExtracted * 0.125) : null;

const laneACl = Number(main.laneA?.cl || 0);
const laneACases = Number(main.laneA?.casesAdded || 0);
const laneAEdges = Number(main.laneA?.oldEdgesResolved || 0);
const laneBCl = Number(main.laneB?.cl || laneB?.totalCl || 0);
const laneBEdges = Number(main.laneB?.oldEdgesResolved || laneB?.byFamily?.us_reports?.oldEdgesResolved || 0);
const laneBAcq = Number(main.laneB?.acquired || laneB?.targetsAcquired || 0);
const laneBAttempted = Number(main.laneB?.attempted || laneB?.targetsAttempted || 0);
const laneBFound = Number(main.laneB?.found || laneB?.targetsFound || 0);
const totalCl = Number(main.totalCl || laneACl + laneBCl);
const clPerCase = laneACases > 0 ? Number((laneACl / laneACases).toFixed(3)) : null;
const remainingTo4700 = Math.max(0, 4700 - endCases);
const estClTo4700 = clPerCase != null ? Math.ceil(remainingTo4700 * clPerCase) : null;
const likelyRuns = estClTo4700 != null ? Math.ceil(estClTo4700 / 84) : null;

const stateDelta = stateDc != null && Number.isFinite(stateDc) ? stateDc - Number(start.stateDc) : null;
const federalDelta = federal != null && Number.isFinite(federal) ? federal - Number(start.federal) : null;

// Intermediate / historical from tracker states aggregate if available
const states = tracker?.states || [];
const intermediateTotal = states.reduce((a, s) => a + Number(s.intermediateAppellate || 0), 0);
const pre2000Total = states.reduce((a, s) => a + Number(s.pre2000 || 0), 0);
const pre1980Total = states.reduce((a, s) => a + Number(s.pre1980 || 0), 0);
const intermediateGapsUnknown = (preflight.intermediateGaps || []).filter((g) => String(g.status || "").includes("UNKNOWN")).length;
const intermediateGapsInvalid = (preflight.intermediateGaps || []).filter((g) => g.status === "INVALID" || g.status === "NO_STRUCTURE").length;

function gate4700(n) {
  if (n >= 4700) return "PASS";
  if (n >= 4500) return "PARTIAL";
  return "FAIL";
}
function gateBalance() {
  if (stateDelta == null || federalDelta == null) return "PARTIAL";
  if (stateDelta > federalDelta && stateDelta > 0) return "PARTIAL";
  return "PARTIAL";
}
function gateIntermediate() {
  if (laneACases > 0 && intermediateTotal > 0) return "PARTIAL";
  return "FAIL";
}

const scorecard = {
  usefulCases: { status: gate4700(endCases), current: endCases, remaining: remainingTo4700 },
  stateDepth: { status: gateBalance(), stateDc, federal, stateDelta, federalDelta },
  intermediateAppellate: {
    status: gateIntermediate(),
    intermediateTotal,
    unknownMappingGaps: intermediateGapsUnknown,
    invalidOrNoStructure: intermediateGapsInvalid,
    newlyValidated: preflight.newlyValidated || [],
  },
  historicalDepth: {
    status: "PARTIAL",
    pre2000: pre2000Total,
    pre1980: pre1980Total,
  },
  federalCoverage: { status: federal != null && federal >= 1000 ? "PASS" : "PARTIAL", federal },
  trackerCurrent: { status: tracker?.ok ? "PASS" : "FAIL" },
  queue2: { status: validations.queue2 },
  queue3: { status: validations.queue3 },
  queue4: { status: validations.queue4 },
  silentCurrent: { status: silentCurrent === 0 ? "PASS" : "FAIL", count: silentCurrent },
  extraction: {
    status: Number(integ?.failed || 0) === 0 && Number(integ?.notProcessed || 0) === 0 ? "PASS" : "FAIL",
    processedPct: integ?.extraction?.processedPct ?? 100,
    failed: integ?.failed ?? 0,
    notProcessed: integ?.notProcessed ?? 0,
  },
  resolverDefects: { status: validations.resolver },
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
    duplicateCitationEdges: integ?.duplicateCitationEdges ?? 0,
    orphanCitationEdges: integ?.orphanCitationEdges ?? 0,
  },
};

const week2Pass =
  scorecard.usefulCases.status === "PASS" &&
  scorecard.queue2.status === "PASS" &&
  scorecard.queue3.status === "PASS" &&
  scorecard.queue4.status === "PASS" &&
  scorecard.silentCurrent.status === "PASS" &&
  scorecard.extraction.status === "PASS" &&
  scorecard.resolverDefects.status === "PASS" &&
  scorecard.integrity.status === "PASS";

const classification = week2Pass
  ? "WEEK2_PASS_OPEN_WEEK3"
  : remainingTo4700 <= 50 && scorecard.integrity.status === "PASS"
    ? "WEEK2_READY_TO_CLOSE"
    : "WEEK2_CONTINUE";

const blockers = [];
if (scorecard.usefulCases.status !== "PASS") {
  blockers.push({ id: "USEFUL_CASES_LT_4700", severity: "BLOCKS_WEEK2", remaining: remainingTo4700 });
}
if (scorecard.stateDepth.status !== "PASS") {
  blockers.push({ id: "STATE_DEPTH_REBALANCE", severity: "BLOCKS_WEEK2" });
}
if (scorecard.intermediateAppellate.status !== "PASS") {
  blockers.push({
    id: "INTERMEDIATE_APPELLATE",
    severity: scorecard.intermediateAppellate.status === "FAIL" ? "BLOCKS_WEEK2" : "BLOCKS_WEEK2",
    unknownMappingGaps: intermediateGapsUnknown,
  });
}
if (scorecard.historicalDepth.status !== "PASS") {
  blockers.push({ id: "HISTORICAL_DEPTH", severity: "BLOCKS_WEEK2" });
}

const productive = main.laneA?.productive || [];
const final = {
  classification: "WEEK2_HYBRID_CLOSEOUT_RUN_3",
  status: main.clWastedOnInvalidMapping === 0 ? "PASS" : "FAIL",
  stopReason: main.stopReason || "budget_exhausted",
  generatedAt: new Date().toISOString(),
  quota: {
    limits: quota.limits,
    startRemaining: {
      minute: quota.limits?.minute?.remaining,
      hour: quota.limits?.hour?.remaining,
      day: quota.limits?.day?.remaining,
    },
    pacingMs: main.pacingMs || 4000,
    planned: quota.preferred || 120,
    actual: totalCl,
    "429": main.reliability?.["429"] || 0,
    "408": main.reliability?.["408"] || 0,
  },
  week2: {
    startCases: 4270,
    endCases,
    remainingTo4700,
    stateDc: { start: 3115, end: stateDc, delta: stateDelta },
    federal: { start: 1084, end: federal, delta: federalDelta },
  },
  mapping: preflight.mappingSummary,
  newlyValidated: preflight.newlyValidated || mapping.newlyValidated || [],
  targetMax: preflight.targetMaxSummary,
  laneA: {
    cl: laneACl,
    usefulCases: laneACases,
    clPerCase,
    casesPerCl: laneACl > 0 ? Number((laneACases / laneACl).toFixed(3)) : null,
    oldCitationEdges: laneAEdges,
    productive,
    stopped: main.laneA?.stopped || [],
    batches: main.laneA?.batches || [],
  },
  laneB: {
    cl: laneBCl,
    attempted: laneBAttempted,
    found: laneBFound,
    acquired: laneBAcq,
    exactOldEdges: laneBEdges,
    edgesPerCl: laneBCl > 0 ? Number((laneBEdges / laneBCl).toFixed(3)) : null,
  },
  reallocationLog: main.reallocationLog || [],
  throughput: {
    laneACasesThisRun: laneACases,
    previousLaneACases: 28,
    improved: laneACases > 28,
  },
  citations: {
    resolvedStart: 5445,
    resolvedEnd: endResolved,
    resolutionStart: 11.34,
    resolutionEnd: resolutionPct,
    live12_5Target: live12,
    liveGap12_5: live12 != null ? Math.max(0, live12 - endResolved) : null,
    laneAOldResolves: laneAEdges,
    laneBOldResolves: laneBEdges,
  },
  tracker: {
    intermediate: intermediateTotal,
    pre2000: pre2000Total,
    pre1980: pre1980Total,
    topDeficits: (tracker?.states || []).slice(0, 8).map((s) => ({
      j: s.jurisdiction,
      deficit: s.deficit,
      intermediateLayerGap: s.intermediateLayerGap,
    })),
  },
  queue4: { unknown, silentCurrent },
  extraction: scorecard.extraction,
  integrity: scorecard.integrity,
  validations,
  externalAi: 0,
  productionEmbeddings: { chunks: integ?.chunks?.chunks ?? null, experimental: 0 },
  week2ExitScorecard: scorecard,
  week2Classification: classification,
  blockers,
  schedule: {
    remainingCases: remainingTo4700,
    measuredLaneAClPerCase: clPerCase,
    estimatedClTo4700: estClTo4700,
    likelyProductiveRuns: likelyRuns,
  },
  next100Cl: {
    balancedCorpusPct: stateDelta != null && federalDelta != null && stateDelta > federalDelta ? 75 : 70,
    citationDemandPct: stateDelta != null && federalDelta != null && stateDelta > federalDelta ? 25 : 30,
    topBalancedLanes: productive.slice(0, 6).map((p) => p.clCourt || p.path),
    topCitationLane: "us_reports",
  },
  nextBestAction:
    remainingTo4700 > 0
      ? "Repeat micro→scale on validated intermediate winners (wisctapp/utahctapp/indctapp/kyctapp) at ~75/25 until ~4700; mapping CL=0."
      : "Stop Week 2 optimization and open Week 3.",
  safeToResume: true,
  recommendedNextSplit: { laneA: 0.75, laneB: 0.25 },
};

fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-run3-final.json"), JSON.stringify(final, null, 2));
fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-run3-checkpoint.json"), JSON.stringify(final, null, 2));

const md = `# Week 2 Hybrid Closeout Run 3 — Final

STATUS: ${final.status}
STOP_REASON: ${final.stopReason}
WEEK2_CLASSIFICATION: ${classification}

## Corpus
- start: 4270 → end: ${endCases} (net +${endCases - 4270})
- remaining to 4700: ${remainingTo4700}
- state/DC: 3115 → ${stateDc} (Δ ${stateDelta})
- federal: 1084 → ${federal} (Δ ${federalDelta})

## Lane A
- CL: ${laneACl}
- useful cases: ${laneACases}
- CL/case: ${clPerCase}
- old citation edges: ${laneAEdges}
- improved vs prior 28?: ${laneACases > 28}

## Lane B
- CL: ${laneBCl}
- acquired: ${laneBAcq}
- exact old edges: ${laneBEdges}
- edges/CL: ${final.laneB.edgesPerCl}

## Mapping
- CL spent: 0
- new VALID_MAPPED: ${final.mapping?.newVALID_MAPPED ?? 0}
- remaining UNKNOWN: ${final.mapping?.remainingUNKNOWN ?? 0}

## Citations
- resolved: 5445 → ${endResolved} (${resolutionPct}%)
- live 12.5% gap: ${final.citations.liveGap12_5}

## Schedule
- measured Lane A CL/case: ${clPerCase}
- estimated CL to ~4700: ${estClTo4700}
- likely productive runs: ${likelyRuns}

## Next best action
${final.nextBestAction}
`;
fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-run3-final.md"), md);
console.log(
  JSON.stringify(
    {
      ok: true,
      classification,
      endCases,
      remainingTo4700,
      stateDc,
      federal,
      stateDelta,
      federalDelta,
      totalCl,
      validations,
      integOk: !!integ,
      normOk: !!norm,
      trackerOk: !!tracker,
      scorecard,
    },
    null,
    2,
  ),
);
process.exit(Object.values(validations).every((v) => v === "PASS") && integ && tracker && norm ? 0 : 1);
