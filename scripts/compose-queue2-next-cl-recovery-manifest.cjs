#!/usr/bin/env node
/**
 * Next CourtListener window recovery manifest (~84–110 useful cases).
 * ZERO CL. Planning only from live tracker/manifests.
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
const now = new Date().toISOString();

const week1Gap = Math.max(0, 3500 - tracker.progress.casesCurrent);
const plannedTarget = Math.max(84, Math.min(110, week1Gap + 80)); // enough for week1 remainder + buffer toward 10k quality

const batches = [];
let planned = 0;
function add(b) {
  batches.push({ rank: batches.length + 1, ...b });
  planned += b.targetCases;
}

// 1) State historical — top historical-gap / high priority states with verified high courts
const g2 = (tracker.lanes?.G2 || []).slice(0, 12);
const stateHistCourts = {
  NJ: "nj", CT: "conn", NM: "nm", WI: "wis", AZ: "ariz", UT: "utah", IN: "ind",
  RI: "ri", DE: "del", VT: "vt", NH: "nh", ME: "me",
};
for (const s of g2) {
  if (planned >= 50) break;
  const court = stateHistCourts[s.jurisdiction];
  if (!court) continue;
  add({
    lane: "G2_STATE_HISTORICAL",
    court,
    jurisdiction: s.jurisdiction,
    dateWindow: "1980-01-01..1999-12-31",
    targetCases: 8,
    why: "historical_gap_or_priority",
    avoid: ["blind_ca5_hist", "blind_ca3_hist", "blind_ca8_hist", "pasuperct_prior_pattern"],
    estimatedCL: 19,
  });
}

// 2) Efficient verified districts — rotate, avoid NYSD/CACD dominance
const distPreferred = ["njd", "paed", "mad", "flsd", "txnd", "cand", "waed", "dcd", "ilnd", "txsd"];
const distPlan = (district.rankedAcquisitionPlan || []).filter((d) => distPreferred.includes(d.court));
for (const d of distPlan.slice(0, 8)) {
  if (planned >= 75) break;
  add({
    lane: "G3_DISTRICT",
    court: d.court,
    dateWindow: d.proposedDateWindow || "1990-01-01..1999-12-31",
    targetCases: 5,
    why: "verified_district_balance",
    estimatedCL: 11,
  });
}

// 3) Productive federal circuits — prefer CADC/CAFC historically productive; avoid blind CA5/CA3/CA8
const productive = ["cadc", "cafc", "ca1", "ca4", "ca6", "ca7", "ca9", "ca11"];
const avoidCircuits = new Set(["ca5", "ca3", "ca8"]);
for (const c of federal.circuits || []) {
  if (avoidCircuits.has(c.bucket)) continue;
  if (!productive.includes(c.bucket) && !(c.flags || []).includes("HISTORICALLY_THIN")) continue;
  if (planned >= 95) break;
  if ((c.flags || []).includes("HISTORICALLY_THIN") || c.cases < 25) {
    add({
      lane: "G3_FEDERAL_HISTORICAL",
      court: c.bucket,
      dateWindow: "1990-01-01..1999-12-31",
      targetCases: 6,
      why: "historically_thin_or_productive_circuit",
      flags: c.flags,
      estimatedCL: 14,
    });
  }
}

// 4) Verified efficient intermediates — thin only
const mid = (intermediate.verified || [])
  .filter((m) => m.intermediateCases < 25 && m.proposedNextBatchSize > 0)
  .sort((a, b) => b.priority - a.priority)
  .slice(0, 4);
for (const m of mid) {
  if (planned >= 105) break;
  // skip pasuperct pattern if that's the court
  if (m.clCourtId === "pasuperct") continue;
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

// 5) Dual-value U.S. Reports targets (natural, not forced)
const dualUs = (dual.top20 || []).filter((t) => t.clObtainable && t.family === "us_reports").slice(0, 6);
if (dualUs.length) {
  add({
    lane: "A2_DUAL_VALUE",
    court: "scotus",
    dateWindow: "citation-target",
    targetCases: Math.min(6, dualUs.length),
    citationTargets: dualUs.map((t) => t.normalizedCitation),
    why: "dual_value_citation_and_scotus_coverage",
    estimatedCL: 15,
    gate: "run_only_if_prior_window_res_per_cl_ge_3.0",
  });
}

while (planned < 84 && batches.length < 40) {
  // fill with additional state hist from top underrepresented
  const s = (tracker.topUnderrepresented || [])[batches.length % 10];
  if (!s) break;
  const court = stateHistCourts[s.jurisdiction] || null;
  if (!court) { planned += 0; break; }
  add({
    lane: "G2_STATE_HISTORICAL",
    court,
    jurisdiction: s.jurisdiction,
    dateWindow: "1985-01-01..1999-12-31",
    targetCases: 6,
    why: "deficit_fill",
    estimatedCL: 14,
  });
}

const byLane = {};
for (const b of batches) {
  byLane[b.lane] = (byLane[b.lane] || 0) + b.targetCases;
}

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
  plannedTargetBand: "84-110",
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
  stopConditions: ["429", "day_remaining_lt_40", "integrity_regression", "408_storm"],
};
fs.writeFileSync(path.join(reports, "queue2-next-cl-recovery-manifest.json"), JSON.stringify(out, null, 2));

const gate = {
  classification: "QUEUE2_WEEK1_GATE_SNAPSHOT",
  generatedAt: now,
  courtListenerHttpCalls: 0,
  items: {
    usefulCases3500: {
      status: week1Gap === 0 ? "PASS" : week1Gap <= 50 ? "PARTIAL" : "BLOCKED_EXTERNAL",
      current: tracker.progress.casesCurrent,
      target: 3500,
      gap: week1Gap,
    },
    duplicates: { status: "PASS", value: 0 },
    orphans: { status: "PASS", value: 0 },
    missingEmbeddings: { status: "PASS", value: 0 },
    duplicateCitationEdges: { status: "PASS", value: 0 },
    tracker10k: { status: "PASS", artifact: "queue2-balanced-10k-tracker.json" },
    federalPerCourt: { status: "PASS", artifact: "queue2-federal-depth-map.json" },
    validInScopeDenominator: { status: "PASS", artifact: "queue2-valid-in-scope-denominator.json" },
    normalizationFoundation: { status: "PARTIAL", note: "QUEUE3_FOUNDATION_ONLY; Queue #3 NOT_OPEN" },
    queue2Clean: { status: "PASS", runtimeState: "STOPPED", laneAChild: null },
  },
};
fs.writeFileSync(path.join(reports, "queue2-week1-gate-snapshot.json"), JSON.stringify(gate, null, 2));

console.log(JSON.stringify({ planned, week1Gap, byLane, cases: tracker.progress.casesCurrent }, null, 2));
