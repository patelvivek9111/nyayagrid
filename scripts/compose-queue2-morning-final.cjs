#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const reports = path.join(__dirname, "..", "packages/research/corpus/reports");
const now = new Date().toISOString();
function readJson(name) {
  const p = path.join(reports, name);
  let t = fs.readFileSync(p, "utf8");
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  t = t.replace(/\u0000/g, "");
  return JSON.parse(t);
}
const tracker = readJson("queue2-balanced-10k-tracker.json");
const integrity = readJson("queue2-integrity-full-pass.json");
const dup = readJson("queue2-dup-cite-triage.json");
const session = readJson("queue2-morning-session.json");
const cont = readJson("queue2-morning-continuation.json");
const q0 = readJson("queue2-morning-quota-start.json");
const q1 = readJson("queue2-morning-quota-after-reset.json");

const startCases = 3070;
const endCases = tracker.progress.casesCurrent;
const added = endCases - startCases;
const week1Target = 3500;
const gap = Math.max(0, week1Target - endCases);
const daysRemaining = Math.max(1, Math.ceil((Date.parse("2026-10-04T23:59:59Z") - Date.now()) / 86400000));
const pace = Number((gap / daysRemaining).toFixed(1));
const status = gap <= 0 ? "GREEN" : pace <= 120 ? "YELLOW" : "RED";

const actualCl = 1 + 1 + (session.totalCl || 0) + (cont.totalCl || 0); // two probes + sessions

const scorecard = {
  classification: "WEEK1_SCORECARD",
  generatedAt: now,
  target: week1Target,
  current: endCases,
  remaining: gap,
  daysRemaining,
  requiredUsefulCasesPerDay: pace,
  stateDcProgress: { current: tracker.progress.stateDcCurrent, planningTarget: 7650 },
  federalProgress: { current: tracker.progress.federalCurrent, planningTarget: 2350 },
  sessionAdded: added,
  status,
  reason: `Day quota constrained morning: +${added} cases (need ~${pace}/day). Integrity clean. Full pack deferred.`,
};
fs.writeFileSync(path.join(reports, "queue2-week1-scorecard.json"), JSON.stringify(scorecard, null, 2));

const report = {
  classification: "MANUAL_QUEUE2_MORNING_EXECUTION_PACK",
  verdict: "PARTIAL",
  generatedAt: now,
  reason:
    "Day remaining only 10 then ~40 after reset_at — below healthy headroom for +125/+175 pack. Ran bounded dual-value A2 + limited G3H. Duplicate citation edges fixed. Monorepo typecheck remains benchmark/auth dirt.",
  LOCAL_TRIAGE: {
    duplicateCitationEdges: {
      countBefore: 4,
      trueDuplicates: 4,
      trueDuplicateRawVariant: 4,
      legitimateRepeats: 0,
      fixed: true,
      deleted: 4,
      countAfter: 0,
      note: "Raw whitespace variants of same normalized citation from same citing authority",
    },
    monorepoTypecheck: {
      error: "auth/invites.test.ts mock transaction typing; benchmarks/nyaya-bench aggregate/staging-ui-e2e/v3-grade",
      classification: "BENCHMARK_DIRT + UNRELATED_EXISTING",
      fixed: false,
      researchTypecheck: "PASS",
    },
  },
  SAFETY: {
    worker: "STOPPED",
    remoteChild: null,
    ownership: "clean",
    "408": session.timedOut408 || false,
    "429": session.rateLimited || cont.stopReason === "429" || false,
    locUscFedRulesMutation: "OFF",
    queue3: "NOT_OPEN",
  },
  QUOTA: {
    startBeforeReset: q0.limits,
    afterReset: {
      minute: q1.limits.minute.remaining,
      hour: q1.limits.hour.remaining,
      day: q1.limits.day.remaining,
    },
    budgetUsedApprox: actualCl,
    estimatedRemainingDay: Math.max(0, (q1.limits.day.remaining || 0) - (session.totalCl || 0) - (cont.totalCl || 0)),
    note: "Only two probes (pre-reset hold + post-reset). Preserve floor day>=40 blocked full pack.",
  },
  EXECUTION_PACK: {
    batchesAvailable: 32,
    batchesExecuted: (session.batches?.length || 0) + (cont.batches?.length || 0),
    batchesSkipped: "most — day quota floor",
    reason: "day remaining insufficient for 303-case / ~672 CL pack",
  },
  CASES: {
    start: startCases,
    end: endCases,
    added,
    remainingTo10k: tracker.progress.casesRemaining,
    pct10k: tracker.progress.pctComplete,
  },
  WEEK_1: {
    target: week1Target,
    current: endCases,
    gap,
    requiredDailyPace: pace,
    status,
  },
  DUAL_VALUE: {
    candidatesExecuted: session.dualValue?.candidates || 0,
    casesAdded: "A2 reported 0 imported but corpus +5 before continuation; attribution partial",
    cl: session.dualValue?.cl || 0,
    note: "A2 spent 15 CL on 8 U.S. Reports targets; import field under-counted — live cases rose 3070→3075 then →3078",
  },
  STATE_DC: {
    startEnd: "2524→2524",
    historicalAdds: 0,
    intermediateAdds: 0,
    note: "No state growth this window (budget spent on A2/G3H)",
  },
  FEDERAL: {
    startEnd: `546→${tracker.progress.federalCurrent}`,
    historicalAdds: cont.totalImported || 0,
    circuits: cont.batches || [],
    districtAdds: 0,
    SCOTUS: "A2 attempt",
  },
  A2: {
    targets: session.batches?.[0]?.cites || [],
    CL: session.lanes?.A2?.cl || 0,
    resolvedViaReresolve: session.citationReresolve?.newResolved,
    resPerCL: null,
    note: "Skip further A2 until res/CL measurable >=3.0 on next healthier quota day",
  },
  CITATIONS: {
    extracted: `9489→${tracker.baseline.citations.extracted}`,
    resolved: `1125→${tracker.baseline.citations.resolved}`,
    TARGET_ABSENT: `8364→${tracker.baseline.citations.targetAbsent}`,
    rawRate: `11.86%→${tracker.baseline.citations.resolutionRatePct}%`,
    note: "extracted -4 from duplicate edge cleanup; resolved +39",
  },
  VALID_DENOMINATOR: {
    valid: "984/1000 overnight sample still authoritative",
    unknownExternal: 16,
    presentUnresolved: 0,
  },
  REQUEST_EFFICIENCY: {
    overall: added > 0 ? Number((actualCl / added).toFixed(2)) : null,
    note: "High CL/case this window due to empty hist windows + A2 search cost; do not extrapolate",
  },
  CORPUS: {
    authorities: tracker.baseline.corpus.authorities,
    cases: endCases,
    cl_cases: tracker.baseline.corpus.cl_cases,
    statutes: tracker.baseline.corpus.statutes,
    regulations: tracker.baseline.corpus.regulations,
    rules: tracker.baseline.corpus.rules,
    chunks: tracker.baseline.chunks.chunks,
    embeddings: tracker.baseline.chunks.embeddings,
    duplicates: integrity.duplicateSourceIdentities,
    orphans: integrity.orphanChunks,
    missingEmbeddings: integrity.missingEmbeddings,
    duplicateCitationEdges: integrity.duplicateCitationEdges,
  },
  VALIDATION: {
    "queue2:validate": "PASS",
    "queue2:preflight": "PASS",
    researchTypecheck: "PASS",
    monorepoTypecheck: "FAIL (BENCHMARK_DIRT + UNRELATED_EXISTING)",
  },
  QUEUE: { "#2": "OPEN", "#9": "CLOSED", "#3": "NOT_OPEN", transition: "NONE" },
  completionCandidate: false,
};
fs.writeFileSync(path.join(reports, "queue2-morning-execution-final.json"), JSON.stringify(report, null, 2));

const md = `# Morning Execution Final Report

**Verdict: PARTIAL**  
Classification: MANUAL_QUEUE2_MORNING_EXECUTION_PACK  
Generated: ${now}

## LOCAL TRIAGE
- duplicateCitationEdges: 4 → **0** (deleted 4 TRUE_DUPLICATE_RAW_VARIANT)
- monorepo typecheck: FAIL — BENCHMARK_DIRT + UNRELATED_EXISTING (auth invites.test.ts); research typecheck PASS

## SAFETY
- worker STOPPED · remote child null · ownership clean · Queue #3 NOT_OPEN · LOC/USC/Rules mutation OFF

## QUOTA
- Pre-reset day remaining: **10** (HOLD until reset)
- Post-reset: minute 30 / hour 300 / day **40**
- Approx CL used this session: **${actualCl}**
- Full pack (~672 CL / 303 cases) **not executable** without violating day preserve floor

## CASES / WEEK 1
- Cases: **${startCases} → ${endCases}** (+${added})
- Remaining to 10k: ${tracker.progress.casesRemaining}
- Week 1 gap to 3500: **${gap}** · pace ~**${pace}**/day · **${status}**

## CITATIONS
- extracted ${tracker.baseline.citations.extracted} · resolved ${tracker.baseline.citations.resolved} · TARGET_ABSENT ${tracker.baseline.citations.targetAbsent} · rate ${tracker.baseline.citations.resolutionRatePct}%

## INTEGRITY
- duplicates ${integrity.duplicateSourceIdentities} · orphans ${integrity.orphanChunks} · missing embeddings ${integrity.missingEmbeddings} · duplicateCitationEdges ${integrity.duplicateCitationEdges}

## VALIDATION
- queue2:validate PASS · queue2:preflight PASS · research typecheck PASS

## QUEUE
#2 OPEN · #9 CLOSED · #3 NOT_OPEN · transition NONE

Completion candidate: **NO**
`;
fs.writeFileSync(path.join(reports, "queue2-morning-execution-final.md"), md);
console.log(JSON.stringify({ verdict: report.verdict, added, endCases, gap, status, actualCl }, null, 2));
