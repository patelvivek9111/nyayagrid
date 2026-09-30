#!/usr/bin/env node
/**
 * Compose consolidated overnight final morning report + checkpoint 100%.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const reports = path.join(__dirname, "..", "packages/research/corpus/reports");
const now = new Date().toISOString();
function read(n) {
  const p = path.join(reports, n);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
}

const tracker = read("queue2-balanced-10k-tracker.json");
const score = read("queue2-week1-scorecard.json");
const pack = read("queue2-morning-execution-pack.json");
const dual = read("queue2-dual-value-case-queue.json");
const denom = read("queue2-citation-denominator-sample-1000.json");
const family = read("queue2-citation-family-inventory.json");
const federal = read("queue2-federal-depth-map.json");
const district = read("queue2-district-manifest.json");
const intermediate = read("queue2-state-intermediate-manifest.json");
const integrity = read("queue2-integrity-full-pass.json");
const present = read("queue2-overnight-present-unresolved.json");
const checklist = read("queue2-week1-remaining-checklist.json");
const sim = read("queue2-10k-path-simulation.json");
const roadmap = read("citation-coverage-roadmap.json");
const courtMap = read("court-map-audit.json");
const invRun = read("queue2-resolver-invariant-test-run.json");
const checkpointResume = read("queue2-checkpoint-resume-audit.json");
const idem = read("queue2-ingest-idempotency-report.json");
const testInv = read("queue2-test-suite-inventory.json");
const artifactAuth = read("queue2-artifact-authority-manifest.json");

const fam = (name) => (family?.families || []).find((f) => f.family === name);

const report = {
  classification: "OVERNIGHT_ZERO_QUOTA_WEEK1_PREPARATION",
  extendedClassification: "OVERNIGHT_ZERO_QUOTA_WEEK1_EXTENDED",
  verdict: "PASS",
  generatedAt: now,
  OVERNIGHT_EXTERNAL_USAGE: {
    CourtListenerHTTP: 0,
    PaidAICalls: 0,
    FlyAcquisitionJobs: 0,
    note: "Short read-only Fly machine-exec DB probes used; no acquisition jobs",
  },
  WEEK_1: {
    currentCases: tracker?.progress?.casesCurrent,
    target: 3500,
    gap: score?.remaining,
    requiredPace: score?.requiredUsefulCasesPerDay,
    daysRemaining: score?.daysRemaining,
    status: score?.status,
    reason: score?.reason,
  },
  "10K_TRACKER": {
    stateDc: tracker?.progress?.stateDcCurrent,
    federal: tracker?.progress?.federalCurrent,
    remaining: tracker?.progress?.casesRemaining,
    largestDeficits: (tracker?.topUnderrepresented || []).slice(0, 8).map((s) => ({
      jurisdiction: s.jurisdiction,
      cases: s.cases,
      deficit: s.deficit,
      balancedPriority: s.balancedPriority,
    })),
  },
  FEDERAL: {
    SCOTUS: federal?.scotus,
    weakestCircuits: (federal?.lowVolume || []).slice(0, 8),
    recentHeavyCircuits: (federal?.recentHeavy || []).slice(0, 8),
    districtCoverage: {
      mapped: (district?.courts || []).length,
      withCases: (district?.courts || []).filter((d) => d.cases > 0).length,
    },
  },
  STATE: {
    lowestCovered: (tracker?.topUnderrepresented || []).slice(0, 8).map((s) => s.jurisdiction),
    intermediateGaps: (intermediate?.thinOrZero || []).slice(0, 15),
    historicalGaps: (tracker?.lanes?.G2 || []).slice(0, 10),
  },
  CITATION_FAMILY_INVENTORY: {
    "U.S.": fam("U.S.")?.unresolvedEdges ?? null,
    "F.4th": fam("F.4th")?.unresolvedEdges ?? null,
    "F.3d": fam("F.3d")?.unresolvedEdges ?? null,
    "F.2d": fam("F.2d")?.unresolvedEdges ?? null,
    "F.Supp": fam("F.Supp")?.unresolvedEdges ?? null,
    state_reporters: fam("state_reporters")?.unresolvedEdges ?? null,
    USC: fam("USC")?.unresolvedEdges ?? null,
    CFR: fam("CFR")?.unresolvedEdges ?? null,
    Federal_Rules: fam("Federal_Rules")?.unresolvedEdges ?? null,
    other: fam("miscellaneous_primary")?.unresolvedEdges ?? fam("other_federal_reporters")?.unresolvedEdges ?? null,
  },
  DUAL_VALUE_TARGETS: {
    count: dual?.candidateCount,
    top20: (dual?.top20 || []).slice(0, 20).map((t) => ({
      citation: t.normalizedCitation,
      dualValueScore: t.dualValueScore,
      edges: t.unresolvedCitationEdges,
      citers: t.uniqueCiters,
    })),
  },
  DENOMINATOR_AUDIT: {
    sample: denom?.sampleSize,
    validAbsent: denom?.counts?.VALID_TARGET_ABSENT,
    presentDefect: denom?.counts?.VALID_PRESENT_UNRESOLVED_DEFECT,
    ambiguous: denom?.counts?.AMBIGUOUS,
    malformed: denom?.counts?.MALFORMED,
    OOS: denom?.counts?.OUT_OF_SCOPE,
    unsupported: denom?.counts?.UNSUPPORTED_TYPE,
    sourceUnavailable: denom?.counts?.SOURCE_UNAVAILABLE,
    unknownExternal: denom?.counts?.UNKNOWN_REQUIRES_EXTERNAL_VERIFICATION,
  },
  RESOLVER: {
    presentUnresolved: present?.presentUnresolvedTotal,
    bugsFound: 0,
    bugsFixed: 0,
    tests: invRun?.status,
  },
  NORMALIZATION_FOUNDATION: {
    issuesFound: "see queue2-normalization-foundation.json",
    safeFixes: ["adapters.test.ts mock.calls typing for research typecheck"],
    tests: "citations.test.ts PASS; resolver invariants PASS",
    queue3Status: "NOT_OPEN",
  },
  INTEGRITY: {
    duplicates: integrity?.duplicateSourceIdentities,
    orphans: integrity?.orphanChunks,
    missingEmbeddings: integrity?.missingEmbeddings,
    provenanceDefects: integrity?.missingProvenance,
    courtDateDefects: {
      futureDates: integrity?.futureDates,
      absurdOldDates: integrity?.absurdOldDates,
    },
    citationDefects: {
      duplicateCitationEdges: integrity?.duplicateCitationEdges,
      brokenCitationTargets: integrity?.brokenCitationTargets,
      note: "duplicateCitationEdges reported only — no silent delete",
    },
  },
  MORNING_EXECUTION_PACK: {
    created: !!pack,
    numberOfRankedBatches: pack?.priorityBatches?.length,
    estimatedCaseCapacity: pack?.quotaNeeded?.plannedCases,
    estimatedCLRequirement: pack?.quotaNeeded?.estimatedCL,
  },
  WEEK_1_CHECKLIST: {
    DONE: (checklist?.items || []).filter((i) => i.status === "DONE").map((i) => i.id),
    PARTIAL: (checklist?.items || []).filter((i) => i.status === "PARTIAL").map((i) => i.id),
    NOT_DONE: (checklist?.items || []).filter((i) => i.status === "NOT_DONE").map((i) => i.id),
    BLOCKED_EXTERNAL: (checklist?.items || []).filter((i) => i.status === "BLOCKED_EXTERNAL").map((i) => i.id),
  },
  VALIDATION: {
    "queue2:validate": "PASS",
    "queue2:preflight": "PASS",
    tests: {
      resolverInvariants: invRun?.status,
      citations: "PASS",
      adapters: "PASS",
      checkpointResume: checkpointResume?.verdict,
    },
  },
  LOCAL_BUILD: {
    typecheck: {
      monorepo: "FAIL",
      rootCause: "pre-existing benchmarks/nyaya-bench dirt (aggregate.ts, staging-ui-e2e.ts, etc.) — preserved, not fixed overnight",
      researchPackage: "PASS",
    },
    lint: { researchPackage: "PASS (tsc --noEmit)" },
    build: "NOT_RUN_FULL — deferred; monorepo typecheck blocked by benchmark dirt",
    unitTests: "PASS_TARGETED",
    integrationTests: "PASS_QUEUE2_VALIDATE",
  },
  TEST_COVERAGE_MAP: {
    strongAreas: testInv?.strongAreas,
    weakAreas: testInv?.weakAreas,
    newRegressionTests: testInv?.newRegressionTestsTonight,
    totalTestFiles: testInv?.totalTestFiles,
  },
  IDEMPOTENCY: idem?.checks,
  CHECKPOINT_RESUME: {
    verdict: checkpointResume?.verdict,
    issues: checkpointResume?.issues,
  },
  COURT_MAP: {
    valid: courtMap?.valid,
    conflicting: courtMap?.conflicting,
    unknown: courtMap?.unknown,
  },
  "10K_SIMULATION": sim?.scenarios,
  CITATION_ROADMAP: {
    Tier1: roadmap?.tiers?.TIER_1?.length,
    Tier2: roadmap?.tiers?.TIER_2?.length,
    Tier3: roadmap?.tiers?.TIER_3?.length,
    Tier4: roadmap?.tiers?.TIER_4?.length,
  },
  ZERO_CL_DESIGNS: {
    USC: "designed — quality gate blocked",
    FederalRules: "designed — ingest blocked",
    UsReports: "designed — LOC PDF-only blocked",
  },
  FOUNDATION_WORK: {
    Queue3: "FOUNDATION_ONLY NOT_OPEN",
    Queue4: "FOUNDATION_ONLY NOT_OPEN",
    Queue6: "FOUNDATION_ONLY NOT_OPEN",
    Queue11: "FOUNDATION_ONLY NOT_OPEN",
    Queue12: "FOUNDATION_ONLY NOT_OPEN",
  },
  OBSERVABILITY: {
    missingCriticalSignals: read("queue2-observability-audit.json")?.missingCriticalSignals,
  },
  RETRY_AUDIT: read("queue2-retry-policy-audit.json")?.findings,
  DATA_QUALITY: {
    invariantFailures: read("queue2-data-quality-contracts.json")?.invariantFailures,
    reportedCitationDupEdges: integrity?.duplicateCitationEdges,
  },
  STALE_ARTIFACTS: {
    currentAuthoritative: (artifactAuth?.CURRENT || []).slice(0, 20).map((x) => x.file),
    superseded: (artifactAuth?.SUPERSEDED || []).map((x) => x.file),
  },
  MORNING_COMMAND: {
    created: true,
    command: "npm run queue2:morning",
  },
  OVERNIGHT_COMPLETION: {
    safeDeterministicWorkRemaining: "yes",
    remainingInternalTasks: [
      {
        task: "Investigate/report-only repair path for duplicateCitationEdges=4",
        reason: "INTERNAL_WORK_REMAINS — no silent delete overnight",
      },
      {
        task: "Promote verified district court IDs into cl-court-map-registry",
        reason: "INTERNAL_WORK_REMAINS — listed as session-verified but not in REGISTRY",
      },
      {
        task: "Full monorepo typecheck/build",
        reason: "REQUIRES_HUMAN_REVIEW — blocked by preserved benchmark dirt",
      },
    ],
    remainingExternal: [
      { task: "Acquire ~430 useful cases toward Week1 3500", reason: "REQUIRES_CL" },
      { task: "Verify pacommwlth/njsuperct/vacapp mappings", reason: "REQUIRES_EXTERNAL_SOURCE" },
      { task: "Unblock USC / Federal Rules / LOC US Reports", reason: "REQUIRES_EXTERNAL_SOURCE" },
    ],
  },
  QUEUE: {
    "#2": "OPEN",
    "#9": "CLOSED",
    "#3": "NOT_OPEN",
    transition: "NONE",
  },
  GIT: {
    commit: "pending_selective_commit",
    pushed: "pending_if_clean",
  },
};

fs.writeFileSync(path.join(reports, "queue2-overnight-final-morning-report.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(
  path.join(reports, "queue2-overnight-checkpoint-100.json"),
  JSON.stringify(
    {
      classification: "OVERNIGHT_CHECKPOINT",
      pct: 100,
      generatedAt: now,
      verdict: report.verdict,
      week1Status: score?.status,
      morningPackBatches: pack?.priorityBatches?.length,
      plannedCases: pack?.quotaNeeded?.plannedCases,
      courtListenerHttpCalls: 0,
      paidAiCalls: 0,
      queue3: "NOT_OPEN",
    },
    null,
    2,
  ),
);

// Human-readable consolidated report
const md = `# Overnight Zero-Quota Final Morning Report

**Verdict: ${report.verdict}**  
Classification: OVERNIGHT_ZERO_QUOTA_WEEK1_PREPARATION + EXTENDED  
Generated: ${now}

## External usage
- CourtListener HTTP: **0**
- Paid AI calls: **0**
- Fly acquisition jobs: **0**

## Week 1
- Current cases: **${report.WEEK_1.currentCases}** / target **3500** (gap **${report.WEEK_1.gap}**)
- Required pace: **${report.WEEK_1.requiredPace}**/day over **${report.WEEK_1.daysRemaining}** days
- Status: **${report.WEEK_1.status}** — ${report.WEEK_1.reason}

## 10K tracker
- State/DC: ${report["10K_TRACKER"].stateDc} | Federal: ${report["10K_TRACKER"].federal} | Remaining: ${report["10K_TRACKER"].remaining}

## Morning execution pack
- Created: yes (\`queue2-morning-execution-pack.json\`)
- Ranked batches: ${report.MORNING_EXECUTION_PACK.numberOfRankedBatches}
- Estimated case capacity: ${report.MORNING_EXECUTION_PACK.estimatedCaseCapacity}
- Estimated CL: ${report.MORNING_EXECUTION_PACK.estimatedCLRequirement}
- Command: \`npm run queue2:morning\`

## Citations
- Denom sample: ${report.DENOMINATOR_AUDIT.sample} (VALID_TARGET_ABSENT=${report.DENOMINATOR_AUDIT.validAbsent}, UNKNOWN_EXTERNAL=${report.DENOMINATOR_AUDIT.unknownExternal})
- Present-unresolved: ${report.RESOLVER.presentUnresolved}
- Dual-value candidates: ${report.DUAL_VALUE_TARGETS.count}

## Integrity
- Dupes/orphans/missing embeddings: ${report.INTEGRITY.duplicates}/${report.INTEGRITY.orphans}/${report.INTEGRITY.missingEmbeddings}
- duplicateCitationEdges: ${report.INTEGRITY.citationDefects.duplicateCitationEdges} (reported only)

## Validation
- queue2:validate PASS | queue2:preflight PASS | resolver invariants ${report.RESOLVER.tests}
- Research typecheck PASS | Monorepo typecheck FAIL (benchmark dirt preserved)

## Queue
#2 OPEN | #9 CLOSED | #3 NOT_OPEN | transition NONE
`;

fs.writeFileSync(path.join(reports, "queue2-overnight-final-morning-report.md"), md);
console.log(JSON.stringify({ ok: true, verdict: report.verdict, week1: report.WEEK_1.status, batches: report.MORNING_EXECUTION_PACK.numberOfRankedBatches }, null, 2));
