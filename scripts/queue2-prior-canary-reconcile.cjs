/**
 * Read-only reconciliation of a prior Lane A canary after LIVE_DB_RECONCILIATION_UNAVAILABLE
 * caused by a missing/generic DB probe (not by CL/ingest failure).
 *
 * ZERO CourtListener. ZERO corpus mutations. AI calls = 0.
 */
"use strict";

const { isFreshPostRunDbEvidence } = require("./queue2-lane-a-child-lifecycle.cjs");
const { normalizeCanonicalCounts, targetProgressFromCounts } = require("./queue2-recovery-path.cjs");
const { canonicalLaneACount } = require("./queue2-lane-a-dispatch.cjs");

const RECOVERED_PREVIOUS_CANARY_PASS = "RECOVERED_PREVIOUS_CANARY_PASS";
const PRIOR_CANARY_ZERO_PROGRESS = "PRIOR_CANARY_ZERO_PROGRESS";
const PRIOR_CANARY_HOLD = "PRIOR_CANARY_HOLD";
const LIVE_DB_RECONCILIATION_UNAVAILABLE = "LIVE_DB_RECONCILIATION_UNAVAILABLE";

function integrityHealthy(integrity = {}) {
  const dups = Number(integrity.duplicateSourceIds ?? integrity.duplicate_source_ids ?? 0) || 0;
  const orphans = Number(integrity.orphanCount ?? integrity.orphan_count ?? 0) || 0;
  const chunkHealthy = integrity.chunkHealthy !== false;
  const missingEmbeddings = Number(integrity.missingEmbeddings ?? integrity.missing_embeddings ?? 0) || 0;
  // Duplicates/orphans always block. Explicit chunkHealthy=false blocks.
  // missingEmbeddings is reported but does not alone block recovered pass
  // (post-ingest embedding backfill may lag the authority write).
  return {
    ok: dups === 0 && orphans === 0 && chunkHealthy,
    duplicateSourceIds: dups,
    orphanCount: orphans,
    chunkHealthy,
    missingEmbeddings,
  };
}

function jobConfirmsCheckpoint(job, claimedCheckpoint) {
  if (!claimedCheckpoint) return { ok: false, reason: "NO_CLAIMED_CHECKPOINT" };
  if (!job || typeof job !== "object") return { ok: false, reason: "NO_JOB_ROW" };
  const durable =
    job.last_successful_external_id ||
    job.lastSuccessfulExternalId ||
    job.cursor ||
    null;
  if (!durable) return { ok: false, reason: "JOB_MISSING_CHECKPOINT" };
  if (String(durable) !== String(claimedCheckpoint)) {
    return {
      ok: false,
      reason: "CHECKPOINT_MISMATCH",
      claimed: claimedCheckpoint,
      jobCheckpoint: durable,
    };
  }
  return { ok: true, checkpoint: durable };
}

/**
 * Evaluate whether a prior canary can be recovered from fresh DB evidence alone.
 */
function evaluateRecoveredPreviousCanary(params = {}) {
  const court = String(params.court || "").toLowerCase();
  const priorCount = Number(params.priorQualifyingCount);
  const liveDb = params.liveDb || null;
  const runnerTerminalAt = params.runnerTerminalAt || null;
  const sessionClRequests = Number(params.sessionClRequests);
  const maxSessionCl = Number(params.maxSessionClRequests) || 5;
  const claimedCheckpoint = params.claimedCheckpoint || null;
  const job = params.job || liveDb?.job || (Array.isArray(liveDb?.jobs) ? liveDb.jobs[0] : null) || null;
  const childTerminal = params.childTerminal !== false;
  const supervised = params.supervised !== false;

  const base = {
    court,
    courtListenerHttpCalls: 0,
    mutations: 0,
    aiCalls: 0,
    childLaunches: 0,
    queue3: "NOT_OPEN",
  };

  if (!liveDb || liveDb.ok === false) {
    return {
      ...base,
      ok: false,
      classification: LIVE_DB_RECONCILIATION_UNAVAILABLE,
      reason: "MISSING_LIVE_DB",
      recoveredPass: false,
      anotherCanaryNeeded: true,
    };
  }

  if (String(liveDb.court || "").toLowerCase() !== court) {
    return {
      ...base,
      ok: false,
      classification: PRIOR_CANARY_HOLD,
      reason: "COURT_MISMATCH",
      recoveredPass: false,
      anotherCanaryNeeded: false,
      hold: true,
      detail: `liveDb.court=${liveDb.court} requested=${court}`,
    };
  }

  const freshness = isFreshPostRunDbEvidence({
    liveDb,
    dbEvidenceObservedAt:
      liveDb.dbEvidenceObservedAt || liveDb.generatedAt || liveDb.observedAt,
    runnerTerminalAt,
    laneARunnerStartedAt: params.laneARunnerStartedAt || null,
  });
  if (!freshness.ok) {
    return {
      ...base,
      ok: false,
      classification: LIVE_DB_RECONCILIATION_UNAVAILABLE,
      reason: freshness.reason,
      freshness,
      recoveredPass: false,
      anotherCanaryNeeded: true,
    };
  }

  const counts = normalizeCanonicalCounts(liveDb);
  // Reject false completion via raw totals alone.
  const falseComplete = targetProgressFromCounts(
    {
      qualifyingCaseCount: null,
      clCaseCount: counts.clCaseCount,
      totalCaseCount: counts.totalCaseCount,
    },
    params.target || 45,
  );
  if (falseComplete.ok === true && falseComplete.targetSatisfied) {
    return {
      ...base,
      ok: false,
      classification: PRIOR_CANARY_HOLD,
      reason: "RAW_COUNT_FALSE_COMPLETION_BLOCKED",
      hold: true,
      recoveredPass: false,
      anotherCanaryNeeded: false,
    };
  }

  const qualifying = canonicalLaneACount({ db: liveDb });
  if (qualifying == null || !Number.isFinite(priorCount)) {
    return {
      ...base,
      ok: false,
      classification: PRIOR_CANARY_HOLD,
      reason: "QUALIFYING_COUNT_REQUIRED",
      hold: true,
      recoveredPass: false,
      anotherCanaryNeeded: false,
      counts,
    };
  }

  const delta = qualifying - priorCount;
  const integ = integrityHealthy(liveDb.integrity || {});
  const cp = jobConfirmsCheckpoint(job, claimedCheckpoint);
  const sessionOk =
    Number.isFinite(sessionClRequests) && sessionClRequests >= 0 && sessionClRequests <= maxSessionCl;

  if (!integ.ok) {
    return {
      ...base,
      ok: false,
      classification: PRIOR_CANARY_HOLD,
      reason: "INTEGRITY_UNHEALTHY",
      hold: true,
      integrity: integ,
      recoveredPass: false,
      anotherCanaryNeeded: false,
      qualifyingCaseCount: qualifying,
      delta,
    };
  }

  if (!sessionOk) {
    return {
      ...base,
      ok: false,
      classification: PRIOR_CANARY_HOLD,
      reason: "SESSION_CL_OUT_OF_BOUNDS",
      hold: true,
      sessionClRequests,
      maxSessionCl,
      recoveredPass: false,
      anotherCanaryNeeded: false,
    };
  }

  if (!childTerminal || !supervised) {
    return {
      ...base,
      ok: false,
      classification: PRIOR_CANARY_HOLD,
      reason: "CHILD_NOT_TERMINAL_SUPERVISED",
      hold: true,
      recoveredPass: false,
      anotherCanaryNeeded: false,
    };
  }

  if (delta === 0) {
    return {
      ...base,
      ok: true,
      classification: PRIOR_CANARY_ZERO_PROGRESS,
      reason: PRIOR_CANARY_ZERO_PROGRESS,
      recoveredPass: false,
      anotherCanaryNeeded: true,
      qualifyingCaseCount: qualifying,
      priorQualifyingCount: priorCount,
      delta: 0,
      freshness,
      integrity: integ,
      counts,
      job,
    };
  }

  if (delta < 1 || delta > 2) {
    return {
      ...base,
      ok: false,
      classification: PRIOR_CANARY_HOLD,
      reason: "UNEXPECTED_QUALIFYING_DELTA",
      hold: true,
      delta,
      qualifyingCaseCount: qualifying,
      priorQualifyingCount: priorCount,
      recoveredPass: false,
      anotherCanaryNeeded: false,
    };
  }

  if (claimedCheckpoint && !cp.ok) {
    return {
      ...base,
      ok: false,
      classification: PRIOR_CANARY_HOLD,
      reason: cp.reason,
      hold: true,
      checkpointCheck: cp,
      recoveredPass: false,
      anotherCanaryNeeded: false,
      detail: "refusing to fabricate or accept unconfirmed checkpoint",
    };
  }

  return {
    ...base,
    ok: true,
    classification: RECOVERED_PREVIOUS_CANARY_PASS,
    reason: RECOVERED_PREVIOUS_CANARY_PASS,
    recoveredPass: true,
    anotherCanaryNeeded: false,
    clearHumanReviewReasons: [LIVE_DB_RECONCILIATION_UNAVAILABLE],
    qualifyingCaseCount: qualifying,
    priorQualifyingCount: priorCount,
    delta,
    checkpoint: cp.ok ? cp.checkpoint : null,
    counts,
    integrity: integ,
    freshness,
    job,
    sessionClRequests,
  };
}

/**
 * Apply a recovered prior-canary pass into durable Queue #2 state (no CL).
 */
function applyRecoveredPreviousCanary(state, evaluation, opts = {}) {
  const next = state && typeof state === "object" ? JSON.parse(JSON.stringify(state)) : {};
  if (!evaluation?.recoveredPass) {
    return { state: next, applied: false, reason: evaluation?.reason || "NOT_RECOVERED" };
  }

  const nowIso = (opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now())).toISOString();
  const court = evaluation.court || next.laneA?.court;
  next.laneA = {
    ...(next.laneA || {}),
    court,
    jurisdiction: next.laneA?.jurisdiction || evaluation.counts?.jurisdiction || null,
    qualifyingCaseCount: evaluation.qualifyingCaseCount,
    count: evaluation.qualifyingCaseCount,
    clCaseCount: evaluation.counts?.clCaseCount ?? next.laneA?.clCaseCount ?? null,
    totalCaseCount: evaluation.counts?.totalCaseCount ?? next.laneA?.totalCaseCount ?? null,
    authorityCount: evaluation.counts?.authorityCount ?? next.laneA?.authorityCount ?? null,
    target: next.laneA?.target || 45,
    targetStatus: "PARTIAL",
    jobLifecycle: "PAUSED_RESUMABLE",
    jobStatus: evaluation.job?.status || next.laneA?.jobStatus || "quota_paused",
    mappingStatus: next.laneA?.mappingStatus || "VERIFIED",
  };

  if (evaluation.checkpoint) {
    next.laneA.checkpoint = evaluation.checkpoint;
    next.laneA.cursor = evaluation.checkpoint;
    next.laneA.lastSuccessfulExternalId = evaluation.checkpoint;
  }

  const reasons = Array.isArray(next.humanReview?.reasons) ? [...next.humanReview.reasons] : [];
  const clearSet = new Set(evaluation.clearHumanReviewReasons || [LIVE_DB_RECONCILIATION_UNAVAILABLE]);
  const kept = reasons.filter((r) => !clearSet.has(r));
  next.humanReview = {
    required: kept.length > 0,
    reasons: kept,
    details: Array.isArray(next.humanReview?.details)
      ? next.humanReview.details.filter((d) => !clearSet.has(d?.reason))
      : [],
  };

  next.canaryMode = "NORMAL";
  next.canary = {
    ...(next.canary || {}),
    required: false,
    status: "PASS",
    recoveredPreviousCanaryPass: true,
    recoveredAt: nowIso,
    classification: RECOVERED_PREVIOUS_CANARY_PASS,
    qualifyingAuthoritiesAdded: evaluation.delta,
    sessionClRequests: evaluation.sessionClRequests,
  };
  next.firstRecoveryCanaryPending = false;
  next.runtimeState = kept.length > 0 ? "HUMAN_REVIEW_REQUIRED" : "STOPPED";
  next.currentLane = kept.length > 0 ? "HUMAN_REVIEW_REQUIRED" : "STOPPED";
  next.queue = "#2";
  next.queue9 = "CLOSED";
  next.queue3 = "NOT_OPEN";
  next.featureAgents = "0";
  next.idleSafe = kept.length === 0;
  next.waitingForNetwork = false;
  next.updatedAt = nowIso;
  next.priorCanaryRecovery = {
    classification: RECOVERED_PREVIOUS_CANARY_PASS,
    court,
    priorQualifyingCount: evaluation.priorQualifyingCount,
    qualifyingCaseCount: evaluation.qualifyingCaseCount,
    delta: evaluation.delta,
    checkpoint: evaluation.checkpoint,
    sessionClRequests: evaluation.sessionClRequests,
    dbEvidenceObservedAt: evaluation.freshness?.dbEvidenceObservedAt || null,
    runnerTerminalAt: evaluation.freshness?.runnerTerminalAt || null,
    recoveredAt: nowIso,
    courtListenerHttpCalls: 0,
    mutations: 0,
    aiCalls: 0,
  };

  const knownGood = opts.codeFingerprint
    ? {
        codeFingerprint: opts.codeFingerprint,
        workerVersion: opts.workerVersion || null,
        promotedAt: nowIso,
        court,
        count: evaluation.qualifyingCaseCount,
        target: next.laneA.target,
        checkpoint: evaluation.checkpoint,
        reason: RECOVERED_PREVIOUS_CANARY_PASS,
      }
    : null;

  return {
    state: next,
    applied: true,
    knownGood,
    classification: RECOVERED_PREVIOUS_CANARY_PASS,
    courtListenerHttpCalls: 0,
    mutations: 0,
    aiCalls: 0,
    childLaunches: 0,
  };
}

/**
 * Normalize raw probe JSON into liveDb evidence used by dual-lane / reconcile.
 */
function normalizeLiveCountProbeResult(parsed, requestedCourt) {
  if (!parsed || parsed.ok !== true) return null;
  const court = String(parsed.court || "").toLowerCase();
  const want = String(requestedCourt || "").toLowerCase();
  if (want && court && court !== want && !(want === "mi" && court === "mich")) {
    return null;
  }
  const nowIso = new Date().toISOString();
  const observed =
    parsed.dbEvidenceObservedAt || parsed.generatedAt || parsed.observedAt || nowIso;
  return {
    ok: true,
    court: court || want,
    jurisdiction: parsed.jurisdiction || null,
    qualifyingCaseCount: parsed.qualifyingCaseCount ?? parsed.qualifyingCases ?? null,
    qualifyingCases: parsed.qualifyingCaseCount ?? parsed.qualifyingCases ?? null,
    qualifying_high_appellate: parsed.qualifying_high_appellate ?? parsed.qualifyingCaseCount ?? null,
    highCourtClCases: parsed.highCourtClCases ?? parsed.high_court_cl_cases ?? null,
    clCaseCount: parsed.clCaseCount ?? parsed.clCases ?? null,
    clCases: parsed.clCaseCount ?? parsed.clCases ?? null,
    totalCaseCount: parsed.totalCaseCount ?? parsed.cases ?? null,
    cases: parsed.totalCaseCount ?? parsed.cases ?? null,
    authorityCount: parsed.authorityCount ?? parsed.authorities ?? null,
    authorities: parsed.authorityCount ?? parsed.authorities ?? null,
    integrity: parsed.integrity || {
      duplicateSourceIds: 0,
      orphanCount: 0,
      chunkHealthy: true,
      missingEmbeddings: 0,
    },
    jobs: parsed.jobs || [],
    job: parsed.job || (Array.isArray(parsed.jobs) ? parsed.jobs[0] : null) || null,
    generatedAt: parsed.generatedAt || observed,
    observedAt: parsed.observedAt || observed,
    dbEvidenceObservedAt: observed,
    courtListenerHttpCalls: 0,
    mutations: 0,
  };
}

module.exports = {
  RECOVERED_PREVIOUS_CANARY_PASS,
  PRIOR_CANARY_ZERO_PROGRESS,
  PRIOR_CANARY_HOLD,
  LIVE_DB_RECONCILIATION_UNAVAILABLE,
  evaluateRecoveredPreviousCanary,
  applyRecoveredPreviousCanary,
  normalizeLiveCountProbeResult,
  integrityHealthy,
  jobConfirmsCheckpoint,
};
