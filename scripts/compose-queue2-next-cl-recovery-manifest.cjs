#!/usr/bin/env node
/**
 * Improve next-CL recovery manifest to ~100–120 useful cases.
 * ZERO CL. Uses live tracker + existing manifests only.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const reports = path.join(__dirname, "..", "packages/research/corpus/reports");

const tracker = JSON.parse(fs.readFileSync(path.join(reports, "queue2-balanced-10k-tracker.json"), "utf8"));
const federal = JSON.parse(fs.readFileSync(path.join(reports, "queue2-federal-depth-map.json"), "utf8"));
const district = JSON.parse(fs.readFileSync(path.join(reports, "queue2-district-manifest.json"), "utf8"));
const intermediate = JSON.parse(fs.readFileSync(path.join(reports, "queue2-state-intermediate-manifest.json"), "utf8"));
const dual = JSON.parse(fs.readFileSync(path.join(reports, "queue2-dual-value-case-queue.json"), "utf8"));
const prev = JSON.parse(fs.readFileSync(path.join(reports, "queue2-next-cl-recovery-manifest.json"), "utf8"));

const before = {
  plannedUsefulCases: prev.plannedUsefulCases,
  mix: prev.mix,
  batchCount: (prev.batches || []).length,
};

const now = new Date().toISOString();
const week1Gap = Math.max(0, 3500 - tracker.progress.casesCurrent);
const TARGET_MIN = 100;
const TARGET_MAX = 120;

const stateHistCourts = {
  NJ: "nj", CT: "conn", NM: "nm", WI: "wis", AZ: "ariz", UT: "utah", IN: "ind",
  RI: "ri", DE: "del", VT: "vt", NH: "nh", ME: "me", ID: "idaho", MT: "mont",
  SD: "sd", ND: "nd", WY: "wyo", NE: "neb", KS: "kan", OK: "okla",
};
const avoidCircuits = new Set(["ca5", "ca3", "ca8"]);
const productiveCircuits = ["cadc", "cafc", "ca1", "ca4", "ca6", "ca7", "ca9", "ca11", "ca2", "ca10"];
const distPreferred = ["njd", "paed", "mad", "flsd", "txnd", "cand", "waed", "dcd", "ilnd", "txsd"];

const batches = [];
let planned = 0;
const seen = new Set();

function add(b) {
  const key = `${b.lane}|${b.court}|${b.dateWindow}`;
  if (seen.has(key)) return false;
  if (planned >= TARGET_MAX) return false;
  seen.add(key);
  const room = TARGET_MAX - planned;
  const targetCases = Math.min(b.targetCases, room);
  if (targetCases <= 0) return false;
  batches.push({ rank: batches.length + 1, ...b, targetCases });
  planned += targetCases;
  return true;
}

// 1) State historical — top underrepresented / historical-gap states
const histCandidates = [
  ...(tracker.lanes?.G2 || []),
  ...(tracker.topUnderrepresented || []),
];
const seenJ = new Set();
for (const s of histCandidates) {
  if (planned >= 48) break;
  const j = s.jurisdiction;
  if (!j || seenJ.has(j)) continue;
  const court = stateHistCourts[j];
  if (!court) continue;
  seenJ.add(j);
  add({
    lane: "G2_STATE_HISTORICAL",
    court,
    jurisdiction: j,
    dateWindow: "1980-01-01..1999-12-31",
    targetCases: 8,
    why: "historical_gap_or_priority",
    avoid: ["blind_ca5_hist", "blind_ca3_hist", "blind_ca8_hist", "pasuperct_prior_pattern"],
    estimatedCL: 19,
  });
}

// 2) Districts — rotate verified efficient courts
const distPlan = (district.rankedAcquisitionPlan || []).filter((d) => distPreferred.includes(d.court));
for (const d of distPlan) {
  if (planned >= 78) break;
  add({
    lane: "G3_DISTRICT",
    court: d.court,
    dateWindow: d.proposedDateWindow || "1990-01-01..1999-12-31",
    targetCases: 5,
    why: "verified_district_balance",
    estimatedCL: 11,
  });
}

// 3) Productive federal circuits — prefer CADC/CAFC; skip weak CA5/CA3/CA8
for (const c of federal.circuits || []) {
  if (avoidCircuits.has(c.bucket)) continue;
  if (!productiveCircuits.includes(c.bucket)) continue;
  if (planned >= 96) break;
  if ((c.flags || []).includes("HISTORICALLY_THIN") || c.cases < 40 || c.bucket === "cadc" || c.bucket === "cafc") {
    add({
      lane: "G3_FEDERAL_HISTORICAL",
      court: c.bucket,
      dateWindow: "1990-01-01..1999-12-31",
      targetCases: c.bucket === "cadc" || c.bucket === "cafc" ? 8 : 5,
      why: "productive_or_thin_circuit",
      flags: c.flags,
      estimatedCL: 14,
    });
  }
}

// 4) Thin verified intermediates (skip pasuperct)
const mid = (intermediate.verified || [])
  .filter((m) => m.clCourtId !== "pasuperct" && m.intermediateCases < 30)
  .sort((a, b) => (b.priority || 0) - (a.priority || 0));
for (const m of mid) {
  if (planned >= 110) break;
  add({
    lane: "G1_STATE_INTERMEDIATE",
    court: m.clCourtId,
    jurisdiction: m.jurisdiction,
    dateWindow: m.proposedDateWindow || "1995-01-01..2005-12-31",
    targetCases: 6,
    why: "thin_verified_intermediate",
    estimatedCL: 13,
  });
}

// 5) Dual-value
const dualUs = (dual.top20 || []).filter((t) => t.clObtainable && t.family === "us_reports").slice(0, 6);
if (dualUs.length && planned < TARGET_MAX) {
  add({
    lane: "A2_DUAL_VALUE",
    court: "scotus",
    dateWindow: "citation-target",
    targetCases: Math.min(6, dualUs.length, TARGET_MAX - planned),
    citationTargets: dualUs.map((t) => t.normalizedCitation),
    why: "dual_value_citation_and_scotus_coverage",
    estimatedCL: 15,
    gate: "run_only_if_prior_window_res_per_cl_ge_3.0",
  });
}

// Fill to TARGET_MIN if short
while (planned < TARGET_MIN) {
  const s = (tracker.topUnderrepresented || []).find((x) => stateHistCourts[x.jurisdiction] && !seenJ.has(x.jurisdiction));
  if (!s) break;
  seenJ.add(s.jurisdiction);
  add({
    lane: "G2_STATE_HISTORICAL",
    court: stateHistCourts[s.jurisdiction],
    jurisdiction: s.jurisdiction,
    dateWindow: "1985-01-01..1999-12-31",
    targetCases: 6,
    why: "deficit_fill_to_100",
    estimatedCL: 14,
  });
}

const byLane = {};
for (const b of batches) byLane[b.lane] = (byLane[b.lane] || 0) + b.targetCases;

const out = {
  classification: "QUEUE2_NEXT_CL_RECOVERY_MANIFEST",
  generatedAt: now,
  courtListenerHttpCalls: 0,
  mutations: 0,
  liveBaseline: {
    cases: tracker.progress.casesCurrent,
    stateDc: tracker.progress.stateDcCurrent,
    federal: tracker.progress.federalCurrent,
    week1GapTo3500: week1Gap,
    remainingTo10k: tracker.progress.casesRemaining,
  },
  plannedUsefulCases: planned,
  plannedTargetBand: "100-120",
  mix: byLane,
  avoidPatterns: [
    "blind_ca5_historical_windows",
    "blind_ca3_historical_windows",
    "blind_ca8_historical_windows",
    "pasuperct_prior_inefficient_pattern",
    "nysd_cacd_dominance",
  ],
  preferPatterns: ["state_historical", "verified_district_rotation", "cadc", "cafc", "thin_verified_intermediate"],
  batches,
  removedRelativeToPrior: {
    dedupedWindows: true,
    avoidedWeakCircuits: ["ca5", "ca3", "ca8"],
    skippedPasuperct: true,
  },
  stopConditions: ["429", "day_remaining_lt_40", "integrity_regression", "408_storm"],
  improvement: { before, after: { plannedUsefulCases: planned, mix: byLane, batchCount: batches.length } },
};

fs.writeFileSync(path.join(reports, "queue2-next-cl-recovery-manifest.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ before, after: out.improvement.after, week1Gap }, null, 2));
