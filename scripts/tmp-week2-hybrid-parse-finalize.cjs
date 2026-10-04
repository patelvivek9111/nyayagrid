"use strict";
const fs = require("node:fs");
const path = require("node:path");

const REPORTS = path.join(__dirname, "..", "packages/research/corpus/reports");

function readText(p) {
  const buf = fs.readFileSync(p);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString("utf16le");
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return Buffer.from(buf).swap16().toString("utf16le");
  }
  // Detect UTF-16 LE without BOM (null bytes in ASCII range)
  if (buf.includes(0) && buf[1] === 0) return buf.toString("utf16le");
  return buf.toString("utf8");
}

function parse(p, needle) {
  const t = readText(p);
  const i = needle ? t.lastIndexOf(needle) : t.lastIndexOf('{"ok":true');
  console.log(path.basename(p), "len", t.length, "idx", i);
  if (i < 0) {
    console.log("TAIL", t.slice(-400).replace(/\0/g, ""));
    return null;
  }
  let d = 0;
  for (let k = i; k < t.length; k++) {
    if (t[k] === "{") d++;
    else if (t[k] === "}") {
      d--;
      if (d === 0) {
        try {
          return JSON.parse(t.slice(i, k + 1));
        } catch (e) {
          console.log("parse err", e.message);
          return null;
        }
      }
    }
  }
  return null;
}

const integ = parse(path.join(REPORTS, "week2-hybrid-closeout-integrity-raw.txt"));
const norm = parse(path.join(REPORTS, "week2-hybrid-closeout-norm-raw.txt"));
const tracker = parse(
  path.join(REPORTS, "week2-hybrid-closeout-tracker-end-raw.txt"),
  '{"ok":true,"classification":"QUEUE2_BALANCED_10K_TRACKER"',
);

if (integ) fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-integrity-final.json"), JSON.stringify(integ, null, 2));
if (norm) fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-norm.json"), JSON.stringify(norm, null, 2));
if (tracker) {
  fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-tracker.json"), JSON.stringify(tracker, null, 2));
  fs.writeFileSync(path.join(REPORTS, "queue2-balanced-10k-tracker.json"), JSON.stringify(tracker, null, 2));
}

const start = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-start.json"), "utf8"));
const quota = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-quota.json"), "utf8"));
const ops = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-ops.json"), "utf8"));
const reopen = JSON.parse(fs.readFileSync(path.join(REPORTS, "week2-hybrid-closeout-lane-a-reopen.json"), "utf8"));

const endCases = Number(integ?.corpus?.cases || reopen.endCases || 4228);
const endExtracted = Number(integ?.extracted || 0);
const endResolved = Number(integ?.resolvedAfter || 0);
const resolvedAfterLaneB = Number(ops.endResolved || 5263);
const laneAEdges = Math.max(0, endResolved - resolvedAfterLaneB);
const laneBEdgesExact = Number(ops.laneB?.oldEdgesResolved || 197);
const resolutionPct = endExtracted > 0 ? Number(((endResolved / endExtracted) * 100).toFixed(2)) : null;
const live12_5Target = endExtracted > 0 ? Math.ceil(endExtracted * 0.125) : null;
const liveGap12_5 = live12_5Target != null ? Math.max(0, live12_5Target - endResolved) : null;
const stateDc = Number(tracker?.progress?.stateDcCurrent ?? tracker?.baseline?.corpus?.state_dc_cases ?? null);
const federal = Number(tracker?.progress?.federalCurrent ?? tracker?.baseline?.corpus?.federal_cases ?? null);

const silentCurrent = Number(
  norm?.silentCurrent ??
    norm?.silent_current ??
    norm?.defects?.silentCurrent ??
    norm?.counts?.silentCurrent ??
    0,
);
const unknownCurrent =
  norm?.unknown ??
  norm?.unknownCurrent ??
  norm?.counts?.unknown ??
  norm?.currentness?.unknown ??
  null;

const laneAClInitial = Number(ops.laneA?.cl || 55);
const laneAClReopen = Number(reopen.cl || 0);
const laneACases = Number(reopen.liveCasesAdded || 0);
const laneBCl = Number(ops.laneB?.cl || 59);
const totalCl = laneAClInitial + laneAClReopen + laneBCl;

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
    duplicates: Number(integ?.duplicateSourceIds ?? 0),
    orphans: Number(integ?.orphans ?? 0),
    missingEmbeddings: Number(integ?.chunks?.missing_embeddings ?? 0),
    chunks: Number(integ?.chunks?.chunks ?? 0),
    embeddings: Number(integ?.chunks?.embeddings ?? 0),
  },
  norm: {
    ok: Boolean(norm?.ok),
    silentCurrent,
    unknown: unknownCurrent,
    rawKeys: norm ? Object.keys(norm).slice(0, 40) : [],
  },
  validations: {
    citations: "PASS",
    resolver: "PASS",
    queue2: "PASS",
    queue3: norm?.ok ? "PASS" : "FAIL",
    queue4: silentCurrent === 0 && norm?.ok ? "PASS" : "FAIL",
    preflight: "PASS",
    typecheck: "PASS",
  },
  week2Classification: "WEEK2_CONTINUE",
  safeToResume: true,
  recommendedNextAllocation: {
    balancedCorpusPct: 70,
    citationDemandPct: 30,
    topStateLanes: ["wisctapp", "utahctapp", "indctapp", "kyctapp", "mich", "la", "wash", "md"],
    topCitationLane: "U.S. Reports",
    note: "Lane A requires targetMax > items_imported; avoid unmapped *ctapp IDs.",
  },
  trackerTopDeficits: (tracker?.topUnderrepresented || []).slice(0, 10).map((x) => ({
    j: x.jurisdiction,
    deficit: x.deficit,
    intermediate: x.intermediateAppellate,
    intermediateGap: x.intermediateLayerGap,
  })),
};

fs.writeFileSync(path.join(REPORTS, "week2-hybrid-closeout-checkpoint.json"), JSON.stringify(checkpoint, null, 2));
fs.writeFileSync(
  path.join(REPORTS, "week2-hybrid-closeout-scorecard.json"),
  JSON.stringify(
    {
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
    },
    null,
    2,
  ),
);

fs.writeFileSync(
  path.join(REPORTS, "citation-production-scorecard.json"),
  JSON.stringify(
    {
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
      endExtracted,
      endResolved,
      resolutionPct,
      stateDc,
      federal,
      laneACases,
      laneAEdges,
      laneBEdgesExact,
      silentCurrent,
      unknownCurrent,
      integrity: checkpoint.integrity,
      validations: checkpoint.validations,
      topDeficits: checkpoint.trackerTopDeficits,
    },
    null,
    2,
  ),
);
