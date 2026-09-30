#!/usr/bin/env node
/**
 * Compose morning execution pack, Week 1 scorecard/checklist, 10k simulations.
 * ZERO CourtListener. ZERO mutations. Planning artifacts only.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const reports = path.join(root, "packages/research/corpus/reports");
const now = new Date().toISOString();

function read(name) {
  const p = path.join(reports, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
}

const tracker = read("queue2-balanced-10k-tracker.json");
const waveA = read("queue2-overnight-wave-a.json");
const dual = read("queue2-dual-value-case-queue.json");
const district = read("queue2-district-manifest.json");
const intermediate = read("queue2-state-intermediate-manifest.json");
const federal = read("queue2-federal-depth-map.json");
const integrity = read("queue2-integrity-full-pass.json");
const citePri = read("queue2-citation-target-priority-last.json");
const denom = read("queue2-citation-denominator-sample-1000.json");
const familyInv = read("queue2-citation-family-inventory.json");

const cases = tracker?.progress?.casesCurrent ?? 3070;
const week1Target = 3500;
const week1Gap = Math.max(0, week1Target - cases);
const oct4 = new Date("2026-10-04T23:59:59.000Z");
const daysRemaining = Math.max(1, Math.ceil((oct4 - new Date(now)) / (24 * 3600 * 1000)));
const requiredPerDay = Number((week1Gap / daysRemaining).toFixed(1));

// Measured S5 efficiencies
const CL_PER_CASE = {
  G1: 2.2,
  G2: 2.4,
  G3H: 2.4,
  G3_DISTRICT: 2.1,
  G3_SCOTUS: 2.3,
  A2: 2.5,
};

function statesByJ(j) {
  return (tracker?.states || []).find((s) => s.jurisdiction === j);
}

const priorityBatches = [];
let rank = 1;
let plannedCases = 0;

function addBatch(b) {
  const estimatedCL = Number((b.targetCases * (CL_PER_CASE[b.lane] || 2.3)).toFixed(1));
  priorityBatches.push({
    rank: rank++,
    ...b,
    estimatedCL,
    fallbackBatch: b.fallbackBatch || null,
  });
  plannedCases += b.targetCases;
}

// A2 dual-value first (highest value)
const dualTop = (dual?.top20 || []).filter((t) => t.clObtainable).slice(0, 12);
for (const t of dualTop.slice(0, 6)) {
  addBatch({
    lane: "A2_CITATION_TARGET",
    court: t.family === "us_reports" ? "scotus" : t.family === "federal_reporter" ? "ca*" : "district*",
    dateWindow: "citation-target",
    targetCases: 1,
    reason: `Dual-value: unlock ~${t.unresolvedCitationEdges} edges (${t.normalizedCitation})`,
    currentDeficit: t.coverageScore,
    historicalValue: t.family === "us_reports" ? "high" : "medium",
    citationOverlap: t.unresolvedCitationEdges,
    citationTarget: t.normalizedCitation,
    estimatedClPerCase: CL_PER_CASE.A2,
    fallbackBatch: "G3_SCOTUS_hist",
  });
}

// G1 state intermediate — top verified thin
const midPlan = (intermediate?.verified || [])
  .filter((m) => m.proposedNextBatchSize > 0)
  .sort((a, b) => b.priority - a.priority)
  .slice(0, 8);
for (const m of midPlan) {
  addBatch({
    lane: "G1_STATE_INTERMEDIATE",
    court: m.clCourtId,
    jurisdiction: m.jurisdiction,
    dateWindow: m.proposedDateWindow,
    targetCases: Math.min(12, m.proposedNextBatchSize),
    reason: `Intermediate deepen ${m.jurisdiction}; deficitTo150=${m.deficitTo150}; midCases=${m.intermediateCases}`,
    currentDeficit: m.deficitTo150,
    historicalValue: m.historicalCoverage === 0 ? "high" : "medium",
    citationOverlap: statesByJ(m.jurisdiction)?.citationDemand || 0,
    estimatedClPerCase: CL_PER_CASE.G1,
    fallbackBatch: midPlan[1] ? midPlan[1].clCourtId : "wisctapp",
  });
}

// G2 state historical
const g2 = (tracker?.lanes?.G2 || []).slice(0, 6);
for (const s of g2) {
  const courtGuess =
    (intermediate?.verified || []).find((m) => m.jurisdiction === s.jurisdiction)?.clCourtId ||
    `${String(s.jurisdiction).toLowerCase()}-high`;
  addBatch({
    lane: "G2_STATE_HISTORICAL",
    court: courtGuess,
    jurisdiction: s.jurisdiction,
    dateWindow: "1980-01-01..1999-12-31",
    targetCases: 10,
    reason: `Historical gap ${s.jurisdiction}; pre2000=${s.pre2000}; earliest=${s.earliestYear}`,
    currentDeficit: statesByJ(s.jurisdiction)?.historicalDeficit || 20,
    historicalValue: "high",
    citationOverlap: statesByJ(s.jurisdiction)?.citationDemand || 0,
    estimatedClPerCase: CL_PER_CASE.G2,
    fallbackBatch: "G3_FEDERAL_HISTORICAL",
  });
}

// G3 federal historical — weakest circuits
const weakCircuits = (federal?.lowVolume || federal?.weakest || []).slice(0, 6);
for (const c of weakCircuits) {
  const court = c.bucket || c.court;
  if (!court || court === "scotus") continue;
  addBatch({
    lane: "G3_FEDERAL_HISTORICAL",
    court,
    dateWindow: "1985-01-01..1999-12-31",
    targetCases: 10,
    reason: `Circuit deepen ${court}; cases=${c.cases}; flags=${(c.flags || []).join(",")}`,
    currentDeficit: Math.max(0, 25 - (c.cases || 0)),
    historicalValue: c.historicalWeakness || (c.flags || []).includes("HISTORICALLY_THIN") ? "high" : "medium",
    citationOverlap: c.citationDemandOverlap || 0,
    estimatedClPerCase: CL_PER_CASE.G3H,
    fallbackBatch: "ca5",
  });
}

// G3 district
const distPlan = (district?.rankedAcquisitionPlan || []).slice(0, 8);
for (const d of distPlan) {
  addBatch({
    lane: "G3_DISTRICT",
    court: d.court,
    dateWindow: d.proposedDateWindow,
    targetCases: Math.min(12, d.desiredNextBatch || 10),
    reason: `District ${d.court}; current=${d.currentCases}; histNeed=${d.historicalNeed}; recentNeed=${d.recentNeed}`,
    currentDeficit: Math.max(0, 20 - (d.currentCases || 0)),
    historicalValue: d.historicalNeed ? "high" : "medium",
    citationOverlap: 0,
    estimatedClPerCase: CL_PER_CASE.G3_DISTRICT,
    fallbackBatch: distPlan[1]?.court || "nysd",
  });
}

// G3 SCOTUS historical / dual-value support
addBatch({
  lane: "G3_SCOTUS",
  court: "scotus",
  dateWindow: "1980-01-01..1999-12-31",
  targetCases: 15,
  reason: "SCOTUS historical deepen + dual-value U.S. Reports citation demand",
  currentDeficit: Math.max(0, 25 - (federal?.scotus?.cases || 0)),
  historicalValue: "high",
  citationOverlap: federal?.scotus?.citationDemandOverlap || 0,
  estimatedClPerCase: CL_PER_CASE.G3_SCOTUS,
  fallbackBatch: "A2_CITATION_TARGET",
});

// Ensure ≥300 planned capacity
while (plannedCases < 300) {
  const more = (district?.rankedAcquisitionPlan || [])[plannedCases % Math.max(1, distPlan.length)] || {
    court: "nysd",
    proposedDateWindow: "1990-01-01..1999-12-31",
    desiredNextBatch: 10,
    currentCases: 0,
    historicalNeed: true,
    recentNeed: false,
  };
  addBatch({
    lane: "G3_DISTRICT",
    court: more.court,
    dateWindow: more.proposedDateWindow || "1990-01-01..1999-12-31",
    targetCases: 10,
    reason: "Capacity fill for healthy recovered quota day",
    currentDeficit: Math.max(0, 20 - (more.currentCases || 0)),
    historicalValue: "medium",
    citationOverlap: 0,
    estimatedClPerCase: CL_PER_CASE.G3_DISTRICT,
    fallbackBatch: "ca9",
  });
}

const totalEstimatedCL = priorityBatches.reduce((s, b) => s + b.estimatedCL, 0);
const fallbackBatches = priorityBatches.slice(8, 20).map((b, i) => ({
  rank: i + 1,
  lane: b.lane,
  court: b.court,
  dateWindow: b.dateWindow,
  targetCases: b.targetCases,
  estimatedCL: b.estimatedCL,
  reason: `Fallback if primary ${b.rank} blocked`,
}));

const morningPack = {
  generatedAt: now,
  classification: "QUEUE2_MORNING_EXECUTION_PACK",
  courtListenerHttpCalls: 0,
  mutations: 0,
  liveBaseline: {
    cases,
    authorities: citePri?.corpus?.authorities ?? tracker?.baseline?.corpus?.authorities,
    stateDc: tracker?.progress?.stateDcCurrent,
    federal: tracker?.progress?.federalCurrent,
    remainingTo10k: tracker?.progress?.casesRemaining,
    citations: citePri?.citationBaseline || tracker?.baseline?.citations,
    integrity: integrity,
  },
  week1: {
    target: week1Target,
    current: cases,
    gap: week1Gap,
    daysRemaining,
    requiredUsefulCasesPerDay: requiredPerDay,
    deadline: "2026-10-04",
  },
  quotaNeeded: {
    plannedCases,
    estimatedCL: Number(totalEstimatedCL.toFixed(1)),
    healthyDayAssumptionCL: 400,
    note: "Estimates from S5 measured efficiencies; do not call CL until quota returns.",
  },
  priorityBatches,
  fallbackBatches,
  externalVerificationNeeded: (intermediate?.needsVerification || []).map((m) => ({
    court: m.clCourtId,
    jurisdiction: m.jurisdiction,
    status: "NEEDS_VERIFICATION_TOMORROW",
  })),
  zeroCLWork: [
    "CFR eCFR deepen only if local/safe path confirmed",
    "USC blocked — design only",
    "Federal Rules blocked — design only",
    "LOC US Reports blocked — design only",
    "Citation reresolve after A2 imports",
  ],
  stopConditions: [
    "CL 429 / rate limit",
    "quota exhausted",
    "integrity regression (dupes/orphans)",
    "Fly 408 storm",
    "present-unresolved defects appear",
  ],
  executionOrder: priorityBatches.map((b) => ({
    rank: b.rank,
    lane: b.lane,
    court: b.court,
    targetCases: b.targetCases,
    estimatedCL: b.estimatedCL,
  })),
};

fs.writeFileSync(
  path.join(reports, "queue2-morning-execution-pack.json"),
  JSON.stringify(morningPack, null, 2),
);

// Week 1 scorecard
const stateProgress = tracker?.progress?.stateDcCurrent || 0;
const federalProgress = tracker?.progress?.federalCurrent || 0;
const histStates = (tracker?.states || []).filter((s) => s.historicalGap).length;
const midZero = (tracker?.states || []).filter((s) => s.intermediateLayerGap).length;
const districtCoverage = (district?.courts || []).filter((d) => d.cases > 0).length;
const paceOk = requiredPerDay <= 120;
const status =
  week1Gap <= 0 ? "GREEN" : paceOk && integrity?.duplicateSourceIdentities === 0 ? "YELLOW" : "RED";
const scorecard = {
  classification: "WEEK1_SCORECARD",
  generatedAt: now,
  target: week1Target,
  current: cases,
  remaining: week1Gap,
  daysRemaining,
  requiredUsefulCasesPerDay: requiredPerDay,
  stateDcProgress: { current: stateProgress, planningTarget: 7650 },
  federalProgress: { current: federalProgress, planningTarget: 2350 },
  historicalProgress: { statesWithHistoricalGap: histStates },
  intermediateProgress: { statesWithZeroIntermediateLayer: midZero },
  districtProgress: { mappedWithCases: districtCoverage, mappedTotal: (district?.courts || []).length },
  citationStatus: citePri?.citationBaseline || null,
  integrityStatus: integrity,
  status,
  reason:
    status === "GREEN"
      ? "Week 1 case target met"
      : status === "YELLOW"
        ? `On recoverable pace: need ~${requiredPerDay}/day for ${daysRemaining} days; integrity clean; morning pack ready`
        : `Pace or integrity risk: need ${requiredPerDay}/day`,
};
fs.writeFileSync(path.join(reports, "queue2-week1-scorecard.json"), JSON.stringify(scorecard, null, 2));

const checklist = {
  classification: "WEEK1_REMAINING_WORK_CHECKLIST",
  generatedAt: now,
  items: [
    { id: "progress_toward_3500", status: cases >= 3500 ? "DONE" : "PARTIAL", detail: `${cases}/3500` },
    { id: "10k_tracker_operational", status: "DONE", detail: "queue2-balanced-10k-tracker.json refreshed" },
    { id: "per_state_balance_map", status: "DONE" },
    { id: "per_federal_court_map", status: "DONE" },
    { id: "historical_gap_map", status: "DONE" },
    { id: "intermediate_layer_map", status: "DONE" },
    { id: "district_mapping_coverage_map", status: "DONE" },
    { id: "valid_citation_denominator_methodology", status: "DONE", detail: "sample 1000 stratified" },
    { id: "citation_family_inventory", status: "DONE" },
    { id: "normalization_foundation_started", status: "PARTIAL", detail: "QUEUE3_FOUNDATION_ONLY" },
    { id: "zero_known_integrity_defects", status: integrity?.duplicateSourceIdentities === 0 && integrity?.orphanChunks === 0 ? "DONE" : "NOT_DONE" },
    { id: "useful_case_acquisition_to_3500", status: "BLOCKED_EXTERNAL", detail: "REQUIRES_CL" },
    { id: "usc_zero_cl", status: "BLOCKED_EXTERNAL", detail: "quality gate" },
    { id: "federal_rules_zero_cl", status: "BLOCKED_EXTERNAL" },
    { id: "loc_us_reports_zero_cl", status: "BLOCKED_EXTERNAL" },
  ],
};
fs.writeFileSync(path.join(reports, "queue2-week1-remaining-checklist.json"), JSON.stringify(checklist, null, 2));

// 10k path simulation
const remaining = tracker?.progress?.casesRemaining ?? 6930;
const stateNeedA = Math.max(0, 7650 - stateProgress);
const fedNeedA = Math.max(0, 2350 - federalProgress);
const sim = {
  classification: "QUEUE2_10K_PATH_SIMULATION",
  generatedAt: now,
  casesRemaining: remaining,
  measuredClPerCase: CL_PER_CASE,
  scenarios: {
    A_planning_split_7650_2350: {
      stateCasesNeeded: stateNeedA,
      federalCasesNeeded: fedNeedA,
      approximateCL: Number(((stateNeedA + fedNeedA) * 2.3).toFixed(0)),
      healthyQuotaDaysAt400: Number((((stateNeedA + fedNeedA) * 2.3) / 400).toFixed(1)),
      majorCoverageRisks: ["intermediate thin states", "historical holes", "district sparsity"],
    },
    B_federal_heavier_citation: {
      stateCasesNeeded: Math.round(remaining * 0.55),
      federalCasesNeeded: Math.round(remaining * 0.45),
      approximateCL: Number((remaining * 2.35).toFixed(0)),
      healthyQuotaDaysAt400: Number(((remaining * 2.35) / 400).toFixed(1)),
      majorCoverageRisks: ["state underrepresentation", "regional reporter demand"],
      justification: "Citation demand dominated by U.S./F.3d/F.4th",
    },
    C_coverage_first_balance: {
      stateCasesNeeded: Math.round(remaining * 0.7),
      federalCasesNeeded: Math.round(remaining * 0.3),
      approximateCL: Number((remaining * 2.25).toFixed(0)),
      healthyQuotaDaysAt400: Number(((remaining * 2.25) / 400).toFixed(1)),
      majorCoverageRisks: ["slower citation resolution", "SCOTUS dual-value delayed"],
    },
  },
  note: "Planning only. Do not change acquisition targets automatically.",
};
fs.writeFileSync(path.join(reports, "queue2-10k-path-simulation.json"), JSON.stringify(sim, null, 2));

fs.writeFileSync(
  path.join(reports, "queue2-overnight-checkpoint-75.json"),
  JSON.stringify(
    {
      classification: "OVERNIGHT_CHECKPOINT",
      pct: 75,
      generatedAt: now,
      tasksCompleted: [
        "5_tomorrow_acquisition_plan",
        "16_week1_scorecard",
        "17_week1_checklist",
        "18_morning_execution_pack",
        "28_balanced_priority_weights",
        "29_10k_path_simulation",
        "41_morning_command",
      ],
      plannedCases,
      estimatedCL: totalEstimatedCL,
      week1Status: status,
      nextTask: "wave_e_foundations",
      courtListenerHttpCalls: 0,
    },
    null,
    2,
  ),
);

console.log(
  JSON.stringify(
    {
      ok: true,
      plannedCases,
      batches: priorityBatches.length,
      estimatedCL: Number(totalEstimatedCL.toFixed(1)),
      week1Status: status,
      week1Gap,
    },
    null,
    2,
  ),
);
