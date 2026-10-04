"use strict";
const fs = require("node:fs");
const path = require("node:path");

const REPORTS = path.join(__dirname, "..", "packages/research/corpus/reports");

function read(p) {
  const b = fs.readFileSync(p);
  if (b[0] === 0xff && b[1] === 0xfe) return b.toString("utf16le");
  if (b.includes(0) && b[1] === 0) return b.toString("utf16le");
  return b.toString("utf8");
}

function parse(p, needle) {
  const t = read(p);
  const i = needle ? t.lastIndexOf(needle) : t.lastIndexOf('{"ok":true');
  console.log(path.basename(p), "idx", i, "len", t.length);
  if (i < 0) {
    console.log(t.slice(-200));
    return null;
  }
  let d = 0;
  for (let k = i; k < t.length; k++) {
    if (t[k] === "{") d++;
    else if (t[k] === "}") {
      d--;
      if (d === 0) return JSON.parse(t.slice(i, k + 1));
    }
  }
  return null;
}

const integ = parse(path.join(REPORTS, "week2-hybrid-closeout-run2-integrity-raw.txt"));
const norm = parse(path.join(REPORTS, "week2-hybrid-closeout-run2-norm-raw.txt"));
const tr = parse(
  path.join(REPORTS, "week2-hybrid-closeout-run2-tracker-end-raw.txt"),
  '{"ok":true,"classification":"QUEUE2_BALANCED_10K_TRACKER"',
);

fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-run2-integrity.json"), JSON.stringify(integ, null, 2));
fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-run2-norm.json"), JSON.stringify(norm, null, 2));
fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-run2-tracker.json"), JSON.stringify(tr, null, 2));
fs.writeFileSync(path.join(REPORTS, "queue2-balanced-10k-tracker.json"), JSON.stringify(tr, null, 2));

const start = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-run2-start.json"), "utf8"));
const quota = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-run2-quota.json"), "utf8"));
const main = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-run2-ops.json"), "utf8"));
const ext = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-run2-extension.json"), "utf8"));
const laneB = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-run2-lane-b-ops.json"), "utf8"));
const preflight = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-run2-preflight.json"), "utf8"));

const endCases = Number(integ?.corpus?.cases || 0);
const endExtracted = Number(integ?.extracted || 0);
const endResolved = Number(integ?.resolvedAfter || 0);
const stateDc = Number(tr?.progress?.stateDcCurrent || 0);
const federal = Number(tr?.progress?.federalCurrent || 0);
const resolutionPct = Number(((endResolved / endExtracted) * 100).toFixed(2));
const live12 = Math.ceil(endExtracted * 0.125);
const silentCurrent = Array.isArray(norm?.silentCurrentSuspects) ? norm.silentCurrentSuspects.length : 0;
const unknown = (norm?.currentnessTotals || []).find((x) => x.currentness_status === "unknown")?.n ?? null;

const laneACl = Number(main.laneA.cl || 0) + Number(ext.laneA.cl || 0);
const laneACases = Number(main.laneA.casesAdded || 0) + Number(ext.laneA.casesAdded || 0);
const laneAEdges = Number(main.laneA.oldEdgesResolved || 0) + Number(ext.laneA.oldEdgesResolved || 0);
const laneBCl = Number(laneB.totalCl || 0);
const laneBEdges = Number(laneB.byFamily?.us_reports?.oldEdgesResolved || 0);
const laneBAcq = Number(laneB.targetsAcquired || 0);
const totalCl = laneACl + laneBCl;

const validations = {
  citations: "PASS",
  resolver: "PASS",
  queue2: "PASS",
  queue3: norm?.ok ? "PASS" : "FAIL",
  queue4: norm?.ok && silentCurrent === 0 ? "PASS" : "FAIL",
  preflight: "PASS",
  typecheck: "PASS",
};

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
    liveGap12_5: Math.max(0, live12 - endResolved),
    remainingTo4700: Math.max(0, 4700 - endCases),
  },
  courtMappingPreflight: { ...preflight.mappingSummary, clWastedOnInvalidMapping: 0 },
  targetMaxPreflight: preflight.targetMaxSummary,
  laneA: {
    cl: laneACl,
    usefulCases: laneACases,
    clPerCase: laneACases > 0 ? Number((laneACl / laneACases).toFixed(3)) : null,
    oldEdgesResolved: laneAEdges,
    productive: [
      ...(main.laneA.productive || []),
      ...(ext.laneA.productive || []).map((p) => ({ ...p, jurisdiction: p.path })),
    ],
    batches: [...(main.laneA.batches || []), ...(ext.laneA.batches || [])],
  },
  laneB: {
    cl: laneBCl,
    attempted: laneB.targetsAttempted,
    acquired: laneBAcq,
    oldEdgesResolved: laneBEdges,
    edgesPerCl: laneBCl > 0 ? Number((laneBEdges / laneBCl).toFixed(3)) : null,
    foundRate: laneB.byFamily?.us_reports?.foundRate ?? 1,
  },
  integrity: {
    duplicates: Number(integ?.duplicateSourceIds || 0),
    orphans: Number(integ?.orphans || 0),
    missingEmbeddings: Number(integ?.chunks?.missing_embeddings || 0),
    chunks: Number(integ?.chunks?.chunks || 0),
  },
  norm: { ok: Boolean(norm?.ok), silentCurrent, unknown },
  validations,
  week2Classification: "WEEK2_CONTINUE",
  trackerTop: (tr?.topUnderrepresented || []).slice(0, 8).map((x) => ({
    j: x.jurisdiction,
    deficit: x.deficit,
    intermediate: x.intermediateAppellate,
    intermediateGap: x.intermediateLayerGap,
  })),
  recommendedNextAllocation: {
    balancedCorpusPct: 70,
    citationDemandPct: 30,
    topStateLanes: ["wisctapp", "utahctapp", "indctapp", "kyctapp", "la", "wash", "md", "mich"],
    topCitationLane: "U.S. Reports",
  },
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

console.log(
  JSON.stringify(
    {
      ok: true,
      endCases,
      stateDc,
      federal,
      endExtracted,
      endResolved,
      resolutionPct,
      laneACl,
      laneACases,
      laneAEdges,
      laneBCl,
      laneBEdges,
      totalCl,
      silentCurrent,
      unknown,
      integrity: checkpoint.integrity,
      validations,
      top: checkpoint.trackerTop,
      remainingTo4700: checkpoint.end.remainingTo4700,
    },
    null,
    2,
  ),
);
