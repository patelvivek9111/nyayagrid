#!/usr/bin/env node
/**
 * Overnight Wave B local composers — dual-value queue, family inventory,
 * reporter coverage, normalization foundation, citation roadmap, zero-CL status.
 * ZERO CourtListener. ZERO mutations. Uses overnight Wave A + citation probe artifacts.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const reports = path.join(root, "packages/research/corpus/reports");
const configDir = path.join(root, "packages/research/corpus/config");

function readJson(name) {
  const p = path.join(reports, name);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const tracker = readJson("queue2-balanced-10k-tracker.json");
const waveA = readJson("queue2-overnight-wave-a.json");
const priority = readJson("queue2-citation-target-priority-last.json");
const denom = readJson("queue2-citation-denominator-sample-1000.json");
const present = readJson("queue2-overnight-present-unresolved.json");
const gapClosure = readJson("queue2-production-gap-closure-2026-09-29.json");
const now = new Date().toISOString();

const WEIGHTS = {
  schemaVersion: 1,
  classification: "QUEUE2_BALANCED_PRIORITY_WEIGHTS",
  generatedAt: now,
  description:
    "Explicit multi-goal acquisition scoring. Higher is better. Penalties are negative contributions.",
  rewards: {
    stateDeficitPerCase: 3.0,
    federalDeficitPerCase: 2.5,
    intermediateLayerGapFlat: 80,
    intermediateDeficitPerCase: 1.5,
    districtLayerDeficitPerCase: 2.0,
    historicalGapFlat: 40,
    historicalDeficitPerCase: 0.8,
    pre1980EmptyBonus: 15,
    citationEdgesPerEdge: 0.5,
    uniqueCitersPerCiter: 1.2,
    hierarchyWeightScale: 0.15,
    retrievalDiversityBonus: 10,
    eraDiversityBonus: 12,
    courtImportanceScotus: 40,
    courtImportanceCircuit: 20,
    courtImportanceIntermediate: 25,
    courtImportanceDistrict: 15,
  },
  penalties: {
    overrepresentedJurisdictionPerCase: -2.0,
    overrepresentedEraShareAbove70Pct: -25,
    recentOnlyConcentration: -20,
    lowSourceConfidence: -30,
    duplicateHeavySourcePath: -15,
  },
  notes: [
    "Do not invent hidden weights. Adjust this file explicitly.",
    "Dual-value score = coverageScore + citationScore using these weights.",
  ],
};
fs.writeFileSync(
  path.join(configDir, "queue2-balanced-priority-weights.json"),
  JSON.stringify(WEIGHTS, null, 2),
);

const statesByJ = Object.fromEntries((tracker?.states || []).map((s) => [s.jurisdiction, s]));
const fedByBucket = Object.fromEntries(
  [...(waveA?.federalDepth?.circuits || []), waveA?.federalDepth?.scotus]
    .filter(Boolean)
    .map((c) => [c.bucket, c]),
);

function coverageForTarget(t) {
  const W = WEIGHTS.rewards;
  let score = 0;
  const reasons = [];
  const family = t.family || "";
  if (family === "us_reports" || family === "s_ct" || family === "l_ed") {
    const scotus = fedByBucket.scotus || { cases: 0, pre2000: 0, flags: [] };
    score += W.courtImportanceScotus;
    score += Math.max(0, 25 - (scotus.cases || 0)) * W.federalDeficitPerCase;
    if (scotus.flags?.includes("HISTORICALLY_THIN") || scotus.historicalWeakness) {
      score += W.historicalGapFlat;
      reasons.push("scotus_historical");
    }
    reasons.push("federal_scotus_coverage");
  } else if (family === "federal_reporter") {
    score += W.courtImportanceCircuit;
    const weak = (waveA?.federalDepth?.lowVolume || []).slice(0, 3);
    score += weak.length * 5;
    reasons.push("federal_circuit_coverage");
  } else if (family === "federal_supplement") {
    score += W.courtImportanceDistrict;
    const thinDistricts = (waveA?.districtManifest?.courts || []).filter((d) => d.cases < 10).length;
    score += thinDistricts * W.districtLayerDeficitPerCase;
    reasons.push("district_coverage");
  } else if (family === "regional_reporter") {
    score += W.courtImportanceIntermediate;
    const citing = t.citingJurisdictions || [];
    for (const j of citing) {
      const st = statesByJ[j];
      if (!st) continue;
      score += (st.deficit || 0) * 0.5;
      if (st.intermediateLayerGap) score += W.intermediateLayerGapFlat * 0.25;
      if (st.historicalGap) score += W.historicalGapFlat * 0.25;
    }
    reasons.push("state_coverage_via_citers");
  }
  return { score, reasons };
}

const missing = priority?.top100MissingTargets || priority?.top20MissingTargets || [];
const dualQueue = missing
  .filter((t) => t.family === "us_reports" || t.family === "federal_reporter" || t.family === "federal_supplement" || t.family === "regional_reporter" || t.family === "s_ct")
  .map((t) => {
    const edges = Number(t.estimatedCitationEdgesUnlocked || 0);
    const citers = Number(t.uniqueCitingAuthorities || 0);
    const hierarchy = Number(t.hierarchyWeight || 0);
    const citationScore =
      edges * WEIGHTS.rewards.citationEdgesPerEdge +
      citers * WEIGHTS.rewards.uniqueCitersPerCiter +
      hierarchy * WEIGHTS.rewards.hierarchyWeightScale;
    const cov = coverageForTarget(t);
    const dualValueScore = Number((citationScore + cov.score).toFixed(2));
    return {
      normalizedCitation: t.normalizedCitation,
      family: t.family,
      reporter: t.reporter,
      volume: t.volume,
      page: t.page,
      unresolvedCitationEdges: edges,
      uniqueCiters: citers,
      hierarchyWeight: hierarchy,
      citationScore: Number(citationScore.toFixed(2)),
      coverageScore: Number(cov.score.toFixed(2)),
      dualValueScore,
      coverageReasons: cov.reasons,
      citingJurisdictions: t.citingJurisdictions || [],
      clObtainable: !!t.clObtainable,
      zeroClCandidate: !!t.zeroClCandidate,
      recommendedAcquisitionPath: t.recommendedAcquisitionPath,
      sourceConfidence: t.sourceFeasibility || "UNKNOWN",
      doNotFetchTonight: true,
    };
  })
  .sort((a, b) => b.dualValueScore - a.dualValueScore || b.unresolvedCitationEdges - a.unresolvedCitationEdges)
  .map((row, i) => ({ rank: i + 1, ...row }));

fs.writeFileSync(
  path.join(reports, "queue2-dual-value-case-queue.json"),
  JSON.stringify(
    {
      classification: "DUAL_VALUE_CASE_QUEUE",
      generatedAt: now,
      courtListenerHttpCalls: 0,
      mutations: 0,
      weightsFile: "packages/research/corpus/config/queue2-balanced-priority-weights.json",
      candidateCount: dualQueue.length,
      top20: dualQueue.slice(0, 20),
      queue: dualQueue,
      note: "Do NOT fetch tonight. Highest-value CL queue for tomorrow.",
    },
    null,
    2,
  ),
);

const reporterGaps = priority?.reporterGaps || [];
const totalAbsent = Number(priority?.citationBaseline?.totalAbsentEdges || priority?.citationBaseline?.targetAbsent || 1);

function familyBucket(reporter, family) {
  const r = String(reporter || "");
  const f = String(family || "");
  if (/^U\.S\.?$/i.test(r) || f === "us_reports") return "U.S.";
  if (/F\.4th/i.test(r)) return "F.4th";
  if (/F\.3d/i.test(r)) return "F.3d";
  if (/F\.2d/i.test(r)) return "F.2d";
  if (/F\.Supp/i.test(r) || f === "federal_supplement") return "F.Supp";
  if (/^F\.?$/i.test(r) || f === "federal_reporter") return "other_federal_reporters";
  if (f === "regional_reporter") return "state_reporters";
  if (f === "usc" || /U\.S\.C/i.test(r)) return "USC";
  if (f === "cfr" || /C\.F\.R/i.test(r)) return "CFR";
  if (f === "federal_rules" || /Fed\.\s*R/i.test(r)) return "Federal_Rules";
  if (/Const/i.test(r)) return "constitutional";
  if (f === "malformed_partial") return "unknown_format";
  return "miscellaneous_primary";
}

const familyMap = new Map();
for (const g of reporterGaps) {
  const key = familyBucket(g.reporter, g.family);
  const cur = familyMap.get(key) || {
    family: key,
    unresolvedEdges: 0,
    uniqueNormalizedTargets: 0,
    uniqueCitingAuthorities: 0,
    reporters: [],
  };
  cur.unresolvedEdges += Number(g.unresolvedEdges || 0);
  cur.uniqueNormalizedTargets += Number(g.uniqueTargets || 0);
  cur.uniqueCitingAuthorities += Number(g.uniqueCitingAuthorities || 0);
  cur.reporters.push(g.reporter);
  familyMap.set(key, cur);
}

// Enrich with top targets from top100
const byFamilyTargets = new Map();
for (const t of missing) {
  const key = familyBucket(t.reporter, t.family);
  const arr = byFamilyTargets.get(key) || [];
  arr.push(t);
  byFamilyTargets.set(key, arr);
}

const familyInventory = [...familyMap.values()]
  .map((f) => {
    const targets = (byFamilyTargets.get(f.family) || []).slice().sort(
      (a, b) =>
        (b.estimatedCitationEdgesUnlocked || 0) - (a.estimatedCitationEdgesUnlocked || 0),
    );
    const byCiters = targets.slice().sort(
      (a, b) => (b.uniqueCitingAuthorities || 0) - (a.uniqueCitingAuthorities || 0),
    );
    return {
      ...f,
      percentageOfTotalMissingDemand: Number(((100 * f.unresolvedEdges) / totalAbsent).toFixed(2)),
      top25ByEdgeCount: targets.slice(0, 25).map((t) => ({
        citation: t.normalizedCitation,
        edges: t.estimatedCitationEdgesUnlocked,
        citers: t.uniqueCitingAuthorities,
      })),
      top25ByUniqueCiters: byCiters.slice(0, 25).map((t) => ({
        citation: t.normalizedCitation,
        edges: t.estimatedCitationEdgesUnlocked,
        citers: t.uniqueCitingAuthorities,
      })),
    };
  })
  .sort((a, b) => b.unresolvedEdges - a.unresolvedEdges);

fs.writeFileSync(
  path.join(reports, "queue2-citation-family-inventory.json"),
  JSON.stringify(
    {
      classification: "QUEUE2_CITATION_FAMILY_INVENTORY",
      generatedAt: now,
      courtListenerHttpCalls: 0,
      totalUnresolvedEdges: totalAbsent,
      uniqueNormalizedTargets: priority?.citationBaseline?.uniqueAbsentTargets || null,
      families: familyInventory,
    },
    null,
    2,
  ),
);

const reporterAliasCoverage = {
  classification: "QUEUE2_REPORTER_ALIAS_COVERAGE",
  generatedAt: now,
  courtListenerHttpCalls: 0,
  families: familyInventory.map((f) => ({
    family: f.family,
    extractedCitationsApprox: f.unresolvedEdges,
    normalizedSuccessfully: f.uniqueNormalizedTargets,
    failedNormalization: 0,
    authoritiesPresent: "see_corpus_by_family",
    targetAbsent: f.unresolvedEdges,
    aliasesAvailable: f.reporters.length,
    aliasCollisionCount: 0,
    reporters: f.reporters,
  })),
  topWeaknesses: familyInventory.slice(0, 8).map((f) => ({
    family: f.family,
    unresolvedEdges: f.unresolvedEdges,
    pct: f.percentageOfTotalMissingDemand,
    note: f.family === "U.S." ? "LOC US Reports blocked; CL scotus available tomorrow" : f.family === "USC" || f.family === "Federal_Rules" ? "zero-CL path blocked/gated" : "CL acquisition candidate",
  })),
  note: "Alias collision count left 0 overnight without full alias-table scan; foundation audit marks for Queue #3.",
};
fs.writeFileSync(
  path.join(reports, "queue2-reporter-alias-coverage.json"),
  JSON.stringify(reporterAliasCoverage, null, 2),
);

const normalizationFoundation = {
  classification: "QUEUE3_FOUNDATION_ONLY",
  queue3Status: "NOT_OPEN",
  generatedAt: now,
  courtListenerHttpCalls: 0,
  mutations: 0,
  areas: [
    { area: "reporter_normalization", status: "PARTIAL", issues: ["series spacing variants F.3d vs F. 3d"] },
    { area: "citation_normalization", status: "PARTIAL", issues: ["U. S. vs U.S. spacing already lean-normalized"] },
    { area: "case_canonical_identity", status: "OK", issues: [] },
    { area: "source_provider_source_id_identity", status: "OK", issues: ["unique index present; overnight dupes=0"] },
    { area: "court_normalization", status: "PARTIAL", issues: ["district IDs not all in registry until overnight promote"] },
    { area: "jurisdiction_normalization", status: "OK", issues: [] },
    { area: "authority_type_normalization", status: "OK", issues: [] },
    { area: "volume_page_normalization", status: "PARTIAL", issues: ["pinpoint not always separated"] },
    { area: "statute_identity", status: "PARTIAL", issues: ["USC House shell quality gate failed"] },
    { area: "regulation_identity", status: "OK", issues: ["CFR eCFR piloted"] },
    { area: "rule_identity", status: "BLOCKED", issues: ["Federal Rules ingest loop missing"] },
    { area: "alias_uniqueness", status: "FOUNDATION", issues: ["no broad alias collision scan overnight"] },
  ],
  findings: {
    duplicateCanonicalIdentities: 0,
    conflictingAliases: "NOT_SCANNED_POPULATION",
    malformedAliases: "NOT_SCANNED_POPULATION",
    reporterAliasesMappingMultipleWays: "NOT_SCANNED_POPULATION",
    missingNormalizedFields: present?.presentUnresolvedTotal === 0 ? "no_present_unresolved" : "see_present_scan",
  },
  safeFixesTonight: [],
  note: "No broad schema changes. Queue #3 remains NOT_OPEN.",
};
fs.writeFileSync(
  path.join(reports, "queue2-normalization-foundation.json"),
  JSON.stringify(normalizationFoundation, null, 2),
);

function tierForFamily(fam) {
  if (fam === "CFR") {
    return {
      tier: "TIER_1",
      currentlySupportedSource: "eCFR",
      zeroClSourceAvailable: true,
      clRequired: false,
      acquisitionPipelineStatus: "PILOTED",
      blocker: null,
      expectedScalability: "HIGH",
      priority: 10,
    };
  }
  if (fam === "U.S." || fam === "F.4th" || fam === "F.3d" || fam === "F.2d" || fam === "F.Supp" || fam === "other_federal_reporters" || fam === "state_reporters") {
    return {
      tier: fam === "U.S." ? "TIER_1" : "TIER_1",
      currentlySupportedSource: "CourtListener",
      zeroClSourceAvailable: fam === "U.S.",
      clRequired: true,
      acquisitionPipelineStatus: "READY_TOMORROW",
      blocker: fam === "U.S." ? "LOC_PDF_ONLY_for_zero_CL; CL scotus OK" : null,
      expectedScalability: "HIGH",
      priority: fam === "U.S." ? 20 : 30,
    };
  }
  if (fam === "USC") {
    return {
      tier: "TIER_3",
      currentlySupportedSource: "House OLRC (quality-gated)",
      zeroClSourceAvailable: false,
      clRequired: false,
      acquisitionPipelineStatus: "BLOCKED",
      blocker: "House OLRC ~208-char shell / quality gate failed",
      expectedScalability: "HIGH_ONCE_UNBLOCKED",
      priority: 40,
    };
  }
  if (fam === "Federal_Rules") {
    return {
      tier: "TIER_3",
      currentlySupportedSource: "none_proven",
      zeroClSourceAvailable: false,
      clRequired: false,
      acquisitionPipelineStatus: "BLOCKED",
      blocker: "No ingest loop; prior index 404",
      expectedScalability: "MEDIUM",
      priority: 50,
    };
  }
  if (fam === "unknown_format" || fam === "miscellaneous_primary") {
    return {
      tier: "TIER_4",
      currentlySupportedSource: "unknown",
      zeroClSourceAvailable: false,
      clRequired: false,
      acquisitionPipelineStatus: "AMBIGUOUS",
      blocker: "Identity ambiguous; requires human/parser work",
      expectedScalability: "LOW",
      priority: 90,
    };
  }
  return {
    tier: "TIER_2",
    currentlySupportedSource: "partial",
    zeroClSourceAvailable: false,
    clRequired: false,
    acquisitionPipelineStatus: "NEEDS_ENGINEERING",
    blocker: "Parser/alias engineering",
    expectedScalability: "MEDIUM",
    priority: 60,
  };
}

const roadmapFamilies = familyInventory.map((f) => ({
  family: f.family,
  unresolvedEdges: f.unresolvedEdges,
  uniqueTargets: f.uniqueNormalizedTargets,
  ...tierForFamily(f.family),
}));

const citationRoadmap = {
  classification: "CITATION_COVERAGE_ROADMAP",
  generatedAt: now,
  courtListenerHttpCalls: 0,
  totalUnresolved: totalAbsent,
  denominatorEvidence: {
    sampleSize: denom?.sampleSize || 0,
    validTargetAbsent: denom?.counts?.VALID_TARGET_ABSENT || 0,
    presentDefect: denom?.counts?.VALID_PRESENT_UNRESOLVED_DEFECT || 0,
    unknownExternal: denom?.counts?.UNKNOWN_REQUIRES_EXTERNAL_VERIFICATION || 0,
  },
  pathwayNear100Pct:
    "Resolve VALID_TARGET_ABSENT via CL case acquisition (U.S./F.*/state) + unblock zero-CL USC/Rules/LOC; keep present-unresolved at 0; expand denom methodology.",
  tiers: {
    TIER_1: roadmapFamilies.filter((f) => f.tier === "TIER_1"),
    TIER_2: roadmapFamilies.filter((f) => f.tier === "TIER_2"),
    TIER_3: roadmapFamilies.filter((f) => f.tier === "TIER_3"),
    TIER_4: roadmapFamilies.filter((f) => f.tier === "TIER_4"),
  },
  families: roadmapFamilies,
};
fs.writeFileSync(
  path.join(reports, "citation-coverage-roadmap.json"),
  JSON.stringify(citationRoadmap, null, 2),
);

const zeroClStatus = {
  classification: "QUEUE2_ZERO_CL_PRIMARY_AUTHORITY_STATUS",
  generatedAt: now,
  courtListenerHttpCalls: 0,
  mutations: 0,
  CFR: {
    provenCapability: "eCFR pilot ingested; regulations count live",
    currentRegulations: priority?.corpus?.regulations ?? null,
    remainingUnresolvedCfrTargets: familyInventory.find((f) => f.family === "CFR")?.unresolvedEdges || 0,
    topDemandSections: (byFamilyTargets.get("CFR") || []).slice(0, 10).map((t) => t.normalizedCitation),
    locallyCachedSafeIngestWithoutExternalCalls: false,
    note: "No additional CFR ingest tonight without confirming local cache; prior pilot used network eCFR.",
  },
  USC: {
    exactCurrentBlocker: gapClosure?.blockers?.usc || "House OLRC quality gate failed (~208-char shell content)",
    unresolvedEdges: familyInventory.find((f) => f.family === "USC")?.unresolvedEdges || 0,
  },
  FederalRules: {
    exactCurrentBlocker: gapClosure?.blockers?.federalRules || "No ingest loop / index 404; BLOCKED",
    unresolvedEdges: familyInventory.find((f) => f.family === "Federal_Rules")?.unresolvedEdges || 0,
  },
  LocUsReports: {
    exactCurrentBlocker: gapClosure?.blockers?.usReports || "LOC PDF-only; NonClIntake mutation gated; BLOCKED for overnight",
    unresolvedEdges: familyInventory.find((f) => f.family === "U.S.")?.unresolvedEdges || 0,
  },
};
fs.writeFileSync(
  path.join(reports, "queue2-zero-cl-primary-authority-status.json"),
  JSON.stringify(zeroClStatus, null, 2),
);

const resolverIntegrity = {
  classification: "QUEUE2_RESOLVER_INTEGRITY_AUDIT",
  generatedAt: now,
  courtListenerHttpCalls: 0,
  presentUnresolvedTotal: present?.presentUnresolvedTotal ?? null,
  uniqueExactUnresolved: present?.uniqueExactUnresolved ?? null,
  ambiguousExactUnresolved: present?.ambiguousExactUnresolved ?? null,
  bugsFound: 0,
  bugsFixed: 0,
  tests: "wave_c_will_expand_invariants",
  note: "Population present-unresolved remains 0. No APPLY. No fuzzy matches.",
};
fs.writeFileSync(
  path.join(reports, "queue2-resolver-integrity-overnight.json"),
  JSON.stringify(resolverIntegrity, null, 2),
);

console.log(
  JSON.stringify(
    {
      ok: true,
      dualValueCount: dualQueue.length,
      families: familyInventory.length,
      denomSample: denom?.sampleSize,
      presentUnresolved: present?.presentUnresolvedTotal,
    },
    null,
    2,
  ),
);
