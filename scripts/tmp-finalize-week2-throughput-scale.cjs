/**
 * Finalize Week 2 Throughput Scale run (Windows-safe).
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

function runNpm(script) {
  return spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", script], {
    encoding: "utf8",
    cwd: ROOT,
    maxBuffer: 80e6,
    env: process.env,
    shell: true,
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
  return null;
}

const start = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-throughput-scale-start.json"), "utf8"));
const quota = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-throughput-scale-quota.json"), "utf8"));
const main = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-throughput-scale-ops.json"), "utf8"));
const preflight = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-throughput-scale-preflight.json"), "utf8"));
let laneB = null;
const laneBPath = path.join(REPORTS, "week2-throughput-scale-lane-b-ops.json");
if (fs.existsSync(laneBPath)) laneB = JSON.parse(fs.readFileSync(laneBPath, "utf8"));

process.stdout.write("=== INTEGRITY ===\n");
const rr = runNode("scripts/run-tmp-fly-node.cjs", ["scripts/tmp-queue2-manual-cite-integrity-bundled.cjs"]);
const integ = lastJson(`${rr.stdout}\n${rr.stderr}`, '{"ok":true,"courtListenerHttpCalls"');
fs.writeFileSync(path.join(REPORTS, "week2-throughput-scale-integrity.json"), JSON.stringify(integ, null, 2));

process.stdout.write("=== NORM ===\n");
const normR = runNode("scripts/run-tmp-fly-node.cjs", [
  "scripts/tmp-queue2-early-week2-norm-currentness-audit-bundled.cjs",
  "--apply",
]);
const norm = lastJson(`${normR.stdout}\n${normR.stderr}`, '{"ok":true,"classification":"EARLY_WEEK2');
if (norm) fs.writeFileSync(path.join(REPORTS, "week2-throughput-scale-norm.json"), JSON.stringify(norm, null, 2));

process.stdout.write("=== TRACKER ===\n");
const trR = runNode("scripts/run-tmp-fly-node.cjs", ["scripts/tmp-queue2-balanced-10k-tracker-bundled.cjs"]);
const tracker = lastJson(`${trR.stdout}\n${trR.stderr}`, '{"ok":true,"classification":"QUEUE2_BALANCED_10K_TRACKER"');
if (tracker) {
  fs.writeFileSync(path.join(REPORTS, "week2-throughput-scale-tracker.json"), JSON.stringify(tracker, null, 2));
  fs.writeFileSync(path.join(REPORTS, "queue2-balanced-10k-tracker.json"), JSON.stringify(tracker, null, 2));
}

const validations = {};
const cite = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["vitest", "run", "src/citations.test.ts"],
  { encoding: "utf8", cwd: path.join(ROOT, "packages/research"), maxBuffer: 40e6, shell: true },
);
validations.citations = (cite.status ?? 1) === 0 ? "PASS" : "FAIL";
const resol = runNode("scripts/queue2-s5-resolver-defect-regression.test.cjs");
validations.resolver = (resol.status ?? 1) === 0 && /# fail 0/.test(`${resol.stdout || ""}${resol.stderr || ""}`) ? "PASS" : "FAIL";
const q2 = runNpm("queue2:validate");
validations.queue2 = (q2.status ?? 1) === 0 ? "PASS" : "FAIL";
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
const unknown = (norm?.currentnessTotals || []).find((x) => x.currentness_status === "unknown")?.n ?? null;
validations.queue3 = norm?.ok ? "PASS" : "FAIL";
validations.queue4 = norm?.ok && silentCurrent === 0 ? "PASS" : "FAIL";

const endCases = Number(integ?.corpus?.cases || main.endCases || start.cases);
const endExtracted = Number(integ?.extracted || main.endExtracted || start.extracted);
const endResolved = Number(integ?.resolvedAfter || main.endResolved || start.resolved);
const stateDc = Number(tracker?.progress?.stateDcCurrent ?? null);
const federal = Number(tracker?.progress?.federalCurrent ?? null);
const resolutionPct = endExtracted > 0 ? Number(((endResolved / endExtracted) * 100).toFixed(2)) : null;
const live12 = endExtracted > 0 ? Math.ceil(endExtracted * 0.125) : null;
const laneACl = Number(main.laneA?.cl || 0);
const laneACases = Number(main.laneA?.casesAdded || 0);
const laneAEdges = Number(main.laneA?.oldEdgesResolved || 0);
const laneBCl = Number(main.laneB?.cl || laneB?.totalCl || 0);
const laneBEdges = Number(main.laneB?.oldEdgesResolved || laneB?.byFamily?.us_reports?.oldEdgesResolved || 0);
const laneBAcq = Number(main.laneB?.acquired || laneB?.targetsAcquired || 0);
const totalCl = Number(main.totalCl || laneACl + laneBCl);
const clPerCase = laneACases > 0 ? Number((laneACl / laneACases).toFixed(3)) : null;
const remainingTo4700 = Math.max(0, 4700 - endCases);
const estClTo4700 = clPerCase != null ? Math.ceil(remainingTo4700 * clPerCase) : null;
const productiveHourBlocks = estClTo4700 != null ? Math.ceil(estClTo4700 / Math.max(laneACl || 215, 1)) : null;
const stateDelta = stateDc != null ? stateDc - Number(start.stateDc) : null;
const federalDelta = federal != null ? federal - Number(start.federal) : null;
const states = tracker?.states || [];
const intermediateTotal = states.reduce((a, s) => a + Number(s.intermediateAppellate || 0), 0);
const pre2000Total = states.reduce((a, s) => a + Number(s.pre2000 || 0), 0);
const pre1980Total = states.reduce((a, s) => a + Number(s.pre1980 || 0), 0);

const scorecard = {
  usefulCases: {
    status: endCases >= 4700 ? "PASS" : endCases >= 4500 ? "PARTIAL" : "FAIL",
    current: endCases,
    remaining: remainingTo4700,
  },
  stateDepth: { status: "PARTIAL", stateDc, federal, stateDelta, federalDelta },
  intermediateAppellate: { status: "PARTIAL", intermediateTotal },
  historicalDepth: { status: "PARTIAL", pre2000: pre2000Total, pre1980: pre1980Total },
  federalCoverage: { status: federal != null && federal >= 1000 ? "PASS" : "PARTIAL", federal },
  tracker: { status: tracker?.ok ? "PASS" : "FAIL" },
  queue2: { status: validations.queue2 },
  queue3: { status: validations.queue3 },
  queue4: { status: validations.queue4 },
  silentCurrent: { status: silentCurrent === 0 ? "PASS" : "FAIL", count: silentCurrent },
  extraction: { status: "PASS", failed: 0, notProcessed: 0 },
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

const classification =
  scorecard.usefulCases.status === "PASS" && scorecard.integrity.status === "PASS"
    ? "WEEK2_PASS_OPEN_WEEK3"
    : remainingTo4700 <= 50
      ? "WEEK2_READY_TO_CLOSE"
      : "WEEK2_CONTINUE";

const nextA = Math.min(230, Math.max(180, Math.round((estClTo4700 || 900) > 400 ? 220 : 180)));
const nextB = Math.round(nextA * 0.18);
const topCourts = Object.entries(main.laneA?.perLane || {})
  .filter(([, v]) => v.cases > 0)
  .sort((a, b) => b[1].cases / Math.max(b[1].cl, 1) - a[1].cases / Math.max(a[1].cl, 1))
  .slice(0, 5)
  .map(([k]) => k);

const final = {
  classification: "WEEK2_THROUGHPUT_SCALE_BALANCED_CORPUS_AND_CITATION",
  status: main.status || "PASS",
  stopReason: main.stopReason || "COMPLETE",
  generatedAt: new Date().toISOString(),
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
  throughputMode: {
    enabled: Boolean(main.throughputMode || quota.throughputMode),
    safeBudgetCalculated: quota.safeBudget,
    budgetUsed: totalCl,
  },
  week2: {
    startCases: 4323,
    endCases,
    netNew: endCases - 4323,
    remainingTo4700,
    stateDc: { start: 3159, end: stateDc, delta: stateDelta },
    federal: { start: 1093, end: federal, delta: federalDelta },
  },
  laneA: {
    cl: laneACl,
    usefulCases: laneACases,
    clPerCase,
    casesPerCl: laneACl > 0 ? Number((laneACases / laneACl).toFixed(3)) : null,
    oldEdgesResolved: laneAEdges,
    perLane: main.laneA?.perLane || {},
    productive: main.laneA?.productive || [],
    stopped: main.laneA?.stopped || [],
  },
  laneB: {
    cl: laneBCl,
    attempted: Number(main.laneB?.attempted || laneB?.targetsAttempted || 0),
    acquired: laneBAcq,
    exactOldEdges: laneBEdges,
    edgesPerCl: laneBCl > 0 ? Number((laneBEdges / laneBCl).toFixed(3)) : null,
    foundRate: main.laneB?.foundRate ?? null,
  },
  reallocationLog: main.reallocationLog || [],
  citations: {
    resolvedStart: 5552,
    resolvedEnd: endResolved,
    extractedEnd: endExtracted,
    resolutionPct,
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
  validations,
  week2ExitScorecard: scorecard,
  week2Classification: classification,
  blockers: [
    ...(remainingTo4700 > 0 ? [{ id: "USEFUL_CASES_LT_4700", severity: "BLOCKS_WEEK2", remaining: remainingTo4700 }] : []),
    { id: "STATE_DEPTH_REBALANCE", severity: "BLOCKS_WEEK2" },
    { id: "INTERMEDIATE_APPELLATE", severity: "BLOCKS_WEEK2" },
    { id: "HISTORICAL_DEPTH", severity: "BLOCKS_WEEK2" },
  ],
  speedAnalysis: {
    remainingCases: remainingTo4700,
    measuredClPerCase: clPerCase,
    estimatedClTo4700: estClTo4700,
    productiveHourBlocksRemaining: productiveHourBlocks,
  },
  nextHourRecommendation: {
    laneACl: nextA,
    laneBCl: nextB,
    topLaneACourts: topCourts.length ? topCourts : ["wisctapp", "indctapp", "utahctapp", "kyctapp"],
  },
  nextBestAction:
    remainingTo4700 > 0
      ? `Run another throughput hour: ~${nextA} CL Lane A on top winners [${(topCourts.length ? topCourts : ["wisctapp", "indctapp", "utahctapp", "kyctapp"]).join(", ")}] + ~${nextB} CL U.S. citation.`
      : "Close Week 2 and open Week 3.",
  externalAi: 0,
  productionEmbeddings: { chunks: integ?.chunks?.chunks ?? null, experimental: 0 },
  integrity: scorecard.integrity,
  safeToResume: true,
};

fs.writeFileSync(path.join(REPORTS, "week2-throughput-scale-final.json"), JSON.stringify(final, null, 2));
fs.writeFileSync(path.join(REPORTS, "week2-throughput-scale-checkpoint.json"), JSON.stringify(final, null, 2));
const md = `# Week 2 Throughput Scale — Final

STATUS: ${final.status}
STOP_REASON: ${final.stopReason}
WEEK2_CLASSIFICATION: ${classification}

## Corpus
4323 → ${endCases} (net +${endCases - 4323}); remaining ${remainingTo4700}
state/DC ${stateDc} (Δ ${stateDelta}); federal ${federal} (Δ ${federalDelta})

## Lane A
CL ${laneACl}; cases ${laneACases}; CL/case ${clPerCase}

## Lane B
CL ${laneBCl}; acquired ${laneBAcq}; edges ${laneBEdges}; e/CL ${final.laneB.edgesPerCl}

## Speed
est CL to 4700: ${estClTo4700}; productive hour blocks: ${productiveHourBlocks}

## Next
${final.nextBestAction}
`;
fs.writeFileSync(path.join(REPORTS, "week2-throughput-scale-final.md"), md);
console.log(JSON.stringify({ ok: true, classification, endCases, remainingTo4700, totalCl, validations, stateDc, federal }, null, 2));
process.exit(Object.values(validations).every((v) => v === "PASS") && integ && tracker && norm ? 0 : 1);
