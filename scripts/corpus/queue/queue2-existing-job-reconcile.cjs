/**
 * Queue #2 existing CourtListener job reconciliation — pure, zero network, zero AI.
 *
 * A target must not be marked READY + checkpoint=null when a prior durable
 * corpus_ingest_jobs row already proves CL progress for that court.
 */
"use strict";

const JOB_CLASSIFICATIONS = Object.freeze({
  NONE: "NONE",
  ACTIVE_VALID: "ACTIVE_VALID",
  STALE_RESUMABLE: "STALE_RESUMABLE",
  STALE_NONRESUMABLE: "STALE_NONRESUMABLE",
  COMPLETED_BUT_STATUS_STALE: "COMPLETED_BUT_STATUS_STALE",
  CORRUPT_INCONSISTENT: "CORRUPT_INCONSISTENT",
});

/** Derived control-plane lifecycle (independent of raw DB status string). */
const JOB_LIFECYCLE_STATES = Object.freeze({
  RUNNING_ACTIVE: "RUNNING_ACTIVE",
  PAUSED_RESUMABLE: "PAUSED_RESUMABLE",
  FAILED_RESUMABLE: "FAILED_RESUMABLE",
  FAILED_NONRESUMABLE: "FAILED_NONRESUMABLE",
  COMPLETED: "COMPLETED",
});

const RESUME_EVIDENCE = Object.freeze({
  LAST_SUCCESSFUL_EXTERNAL_ID: "LAST_SUCCESSFUL_EXTERNAL_ID",
  CURSOR_ONLY: "CURSOR_ONLY",
  NEXT_PAGE_URL: "NEXT_PAGE_URL",
  NONE: "NONE",
});

function isTimeoutErrorText(text) {
  return /TimeoutError|aborted due to timeout|AbortError|operation was aborted/i.test(String(text || ""));
}

function asJob(job) {
  if (!job || typeof job !== "object") return null;
  return job;
}

function jobResumeFields(job) {
  const j = asJob(job) || {};
  const cursor = j.cursor || null;
  const lastSuccessfulExternalId =
    j.last_successful_external_id || j.lastSuccessfulExternalId || null;
  const nextPageUrl = j.next_page_url || j.nextPageUrl || null;
  return { cursor, lastSuccessfulExternalId, nextPageUrl };
}

function resolveResumeEvidence(job, opts = {}) {
  const { cursor, lastSuccessfulExternalId, nextPageUrl } = jobResumeFields(job);
  if (lastSuccessfulExternalId) {
    return {
      kind: RESUME_EVIDENCE.LAST_SUCCESSFUL_EXTERNAL_ID,
      resumeId: lastSuccessfulExternalId,
      cursor,
      lastSuccessfulExternalId,
      nextPageUrl,
      sufficient: true,
    };
  }
  if (cursor) {
    // Runner contract persists cursor as progress identity during import; cursor alone is
    // sufficient when not explicitly invalidated (cursorValid === false).
    const cursorValid = opts.cursorValid !== false;
    return {
      kind: RESUME_EVIDENCE.CURSOR_ONLY,
      resumeId: cursor,
      cursor,
      lastSuccessfulExternalId: null,
      nextPageUrl,
      sufficient: cursorValid,
    };
  }
  if (nextPageUrl) {
    return {
      kind: RESUME_EVIDENCE.NEXT_PAGE_URL,
      resumeId: null,
      cursor: null,
      lastSuccessfulExternalId: null,
      nextPageUrl,
      sufficient: true,
    };
  }
  return {
    kind: RESUME_EVIDENCE.NONE,
    resumeId: null,
    cursor: null,
    lastSuccessfulExternalId: null,
    nextPageUrl: null,
    sufficient: false,
  };
}

/**
 * Classify a durable corpus_ingest_jobs row. Does not infer from status="running" alone.
 */
function classifyExistingCorpusIngestJob(job, ctx = {}) {
  const j = asJob(job);
  if (!j) {
    return {
      classification: JOB_CLASSIFICATIONS.NONE,
      resumable: false,
      resumeEvidence: resolveResumeEvidence(null),
      reason: "no_job",
    };
  }

  const status = String(j.status || "").toLowerCase();
  const imported = Math.max(0, Number(j.items_imported ?? j.itemsImported) || 0);
  const targetMax = Math.max(0, Number(j.target_max ?? j.targetMax) || 0);
  const ownerAlive = Boolean(ctx.ownerAlive || ctx.processAlive);
  const nowMs = ctx.now instanceof Date ? ctx.now.getTime() : Number(ctx.now) || Date.now();
  const updatedMs = j.updated_at || j.updatedAt ? Date.parse(j.updated_at || j.updatedAt) : 0;
  const ageMs = updatedMs > 0 ? Math.max(0, nowMs - updatedMs) : Number.POSITIVE_INFINITY;
  const resume = resolveResumeEvidence(j, { cursorValid: ctx.cursorValid });

  const corpusCl =
    ctx.corpusClCases != null && Number.isFinite(Number(ctx.corpusClCases))
      ? Number(ctx.corpusClCases)
      : null;
  if (corpusCl != null && imported > 0 && Math.abs(corpusCl - imported) > Math.max(5, imported * 0.5)) {
    return {
      classification: JOB_CLASSIFICATIONS.CORRUPT_INCONSISTENT,
      resumable: false,
      resumeEvidence: resume,
      reason: "imported_vs_corpus_mismatch",
      evidence: { imported, corpusClCases: corpusCl },
    };
  }

  if (status === "completed" || (targetMax > 0 && imported >= targetMax)) {
    return {
      classification: JOB_CLASSIFICATIONS.COMPLETED_BUT_STATUS_STALE,
      resumable: false,
      resumeEvidence: resume,
      reason: status === "completed" ? "completed" : "imported_meets_target_status_not_completed",
      evidence: { imported, targetMax, status },
    };
  }

  if (imported > 0 && !resume.sufficient) {
    return {
      classification: JOB_CLASSIFICATIONS.STALE_NONRESUMABLE,
      resumable: false,
      resumeEvidence: resume,
      reason: "imported_without_sufficient_resume_evidence",
      evidence: { imported, status },
    };
  }

  if (ownerAlive && (status === "running" || status === "quota_paused" || status === "rate_limited")) {
    return {
      classification: JOB_CLASSIFICATIONS.ACTIVE_VALID,
      resumable: true,
      resumeEvidence: resume,
      reason: "owner_alive",
      evidence: { status, ageMs, ownerAlive: true },
    };
  }

  if (!ownerAlive && resume.sufficient && (imported > 0 || status === "running" || status === "quota_paused")) {
    return {
      classification: JOB_CLASSIFICATIONS.STALE_RESUMABLE,
      resumable: true,
      resumeEvidence: resume,
      reason: status === "running" ? "stale_running_dead_owner" : "stale_resumable_dead_owner",
      evidence: { status, ageMs, imported, ownerAlive: false },
    };
  }

  if (!resume.sufficient) {
    return {
      classification: JOB_CLASSIFICATIONS.STALE_NONRESUMABLE,
      resumable: false,
      resumeEvidence: resume,
      reason: "missing_resume_evidence",
      evidence: { status, imported },
    };
  }

  return {
    classification: JOB_CLASSIFICATIONS.STALE_RESUMABLE,
    resumable: true,
    resumeEvidence: resume,
    reason: "default_resumable",
    evidence: { status, imported, ageMs },
  };
}

/** READY + null checkpoint is only valid when no prior resumable job exists. */
function isReadyAllowedGivenJob(job, ctx = {}) {
  const classified = classifyExistingCorpusIngestJob(job, ctx);
  if (classified.classification === JOB_CLASSIFICATIONS.NONE) return true;
  if (classified.resumable) return false;
  if (classified.classification === JOB_CLASSIFICATIONS.COMPLETED_BUT_STATUS_STALE) return false;
  if (classified.classification === JOB_CLASSIFICATIONS.CORRUPT_INCONSISTENT) return false;
  return true;
}

/**
 * Adopt a classified existing job into Lane A control-plane state (pure).
 */
function adoptExistingJobIntoLaneA(state, job, classified, opts = {}) {
  const next = JSON.parse(JSON.stringify(state || {}));
  const j = asJob(job);
  const c = classified || classifyExistingCorpusIngestJob(j, opts);
  const resume = c.resumeEvidence || resolveResumeEvidence(j, opts);
  const nowIso = (opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now())).toISOString();

  if (
    c.classification === JOB_CLASSIFICATIONS.CORRUPT_INCONSISTENT ||
    c.classification === JOB_CLASSIFICATIONS.STALE_NONRESUMABLE
  ) {
    next.humanReview = next.humanReview || { required: false, reasons: [], details: [] };
    next.humanReview.required = true;
    const reason =
      c.classification === JOB_CLASSIFICATIONS.CORRUPT_INCONSISTENT
        ? "CORRUPT_INCONSISTENT_INGEST_JOB"
        : "MISSING_DURABLE_RESUME_CHECKPOINT";
    if (!next.humanReview.reasons.includes(reason)) next.humanReview.reasons.push(reason);
    next.humanReview.details.push({ reason, detail: c.reason, at: nowIso });
    next.laneA = {
      ...(next.laneA || {}),
      targetStatus: "HUMAN_REVIEW_REQUIRED",
      jobStatus: j?.status || next.laneA?.jobStatus || null,
      existingJobClassification: c.classification,
      resumeEvidenceKind: resume.kind,
    };
    return { ok: false, state: next, classified: c, humanReviewRequired: true };
  }

  const count =
    opts.qualifyingCases != null && Number.isFinite(Number(opts.qualifyingCases))
      ? Number(opts.qualifyingCases)
      : opts.corpusClCases != null && Number.isFinite(Number(opts.corpusClCases))
        ? Number(opts.corpusClCases)
        : Number(j?.items_imported ?? next.laneA?.count) || 0;

  const resumeId = resume.resumeId || resume.cursor || resume.lastSuccessfulExternalId || null;
  next.laneA = {
    ...(next.laneA || {}),
    court: j?.cl_court || j?.clCourt || next.laneA?.court,
    count,
    target: Number(j?.target_max ?? next.laneA?.target) || 45,
    checkpoint: resume.lastSuccessfulExternalId || null,
    cursor: resume.cursor,
    lastSuccessfulExternalId: resume.lastSuccessfulExternalId,
    nextPageUrl: resume.nextPageUrl,
    jobStatus: c.classification === JOB_CLASSIFICATIONS.STALE_RESUMABLE ? "quota_paused" : j?.status || "running",
    itemsImported: Number(j?.items_imported ?? count) || 0,
    targetStatus: "PARTIAL",
    existingJobClassification: c.classification,
    resumeEvidenceKind: resume.kind,
    lastSuccessfulAt: j?.updated_at || j?.updatedAt || next.laneA?.lastSuccessfulAt || nowIso,
    mappingStatus: opts.mappingStatus || next.laneA?.mappingStatus || "VERIFIED",
  };
  if (!next.laneA.checkpoint && resumeId && resume.kind === RESUME_EVIDENCE.CURSOR_ONLY) {
    next.laneA.checkpoint = resumeId;
  }

  if (next.humanReview?.required && Array.isArray(next.humanReview.reasons)) {
    const drop = new Set([
      "LANE_A_COUNT_RECONCILIATION_FAILED",
      "MISSING_DURABLE_RESUME_CHECKPOINT",
    ]);
    next.humanReview.reasons = next.humanReview.reasons.filter((r) => !drop.has(r));
    next.humanReview.details = (next.humanReview.details || []).filter((d) => !drop.has(d.reason));
    if (next.humanReview.reasons.length === 0) {
      next.humanReview.required = false;
      next.humanReview.details = [];
    }
  }

  next.idleSafe = false;
  next.updatedAt = nowIso;
  return {
    ok: true,
    state: next,
    classified: c,
    humanReviewRequired: false,
    resumeFrom: resumeId,
    duplicateIngestionRisk: false,
  };
}

/**
 * Derive lifecycle when durable status=running but ownership/process is gone.
 * Never resets cursor. Never deletes job. Never page-1 restart.
 */
function deriveJobLifecycleState(job, ctx = {}) {
  const j = asJob(job);
  if (!j) {
    return {
      lifecycle: null,
      durableStatus: null,
      clearOwnership: false,
      reason: "no_job",
    };
  }
  const status = String(j.status || "").toLowerCase();
  const activeProcess = Boolean(ctx.activeProcess || ctx.ownerAlive || ctx.processAlive);
  const resume = resolveResumeEvidence(j, { cursorValid: ctx.cursorValid !== false });
  const imported = Math.max(0, Number(j.items_imported ?? j.itemsImported) || 0);
  const targetMax = Math.max(0, Number(j.target_max ?? j.targetMax) || 0);
  const lastError = j.last_error || j.lastError || null;
  const timeout = Boolean(ctx.timeout || isTimeoutErrorText(lastError));

  if (status === "completed" || (targetMax > 0 && imported >= targetMax)) {
    return {
      lifecycle: JOB_LIFECYCLE_STATES.COMPLETED,
      durableStatus: "completed",
      clearOwnership: true,
      reason: "completed",
      resume,
    };
  }

  if (activeProcess && (status === "running" || status === "quota_paused" || status === "rate_limited")) {
    return {
      lifecycle: JOB_LIFECYCLE_STATES.RUNNING_ACTIVE,
      durableStatus: status,
      clearOwnership: false,
      reason: "active_owner",
      resume,
      hold: true,
    };
  }

  if (!resume.sufficient && imported > 0) {
    return {
      lifecycle: JOB_LIFECYCLE_STATES.FAILED_NONRESUMABLE,
      durableStatus: "failed",
      clearOwnership: true,
      reason: "imported_without_resume_evidence",
      resume,
      humanReviewRequired: true,
    };
  }

  if (timeout && resume.sufficient && !activeProcess) {
    return {
      lifecycle: JOB_LIFECYCLE_STATES.PAUSED_RESUMABLE,
      durableStatus: "paused",
      clearOwnership: true,
      reason: "timeout_recoverable",
      resume,
      humanReviewRequired: false,
    };
  }

  if (!activeProcess && resume.sufficient && (status === "running" || status === "paused" || status === "quota_paused")) {
    return {
      lifecycle: JOB_LIFECYCLE_STATES.PAUSED_RESUMABLE,
      durableStatus: status === "running" ? "paused" : status === "quota_paused" ? "quota_paused" : "paused",
      clearOwnership: true,
      reason: status === "running" ? "stale_running_dead_owner" : "already_paused_resumable",
      resume,
      humanReviewRequired: false,
    };
  }

  if (status === "failed" && resume.sufficient) {
    return {
      lifecycle: JOB_LIFECYCLE_STATES.FAILED_RESUMABLE,
      durableStatus: "failed",
      clearOwnership: true,
      reason: "failed_with_resume",
      resume,
      humanReviewRequired: false,
    };
  }

  if (status === "failed") {
    return {
      lifecycle: JOB_LIFECYCLE_STATES.FAILED_NONRESUMABLE,
      durableStatus: "failed",
      clearOwnership: true,
      reason: "failed_no_resume",
      resume,
      humanReviewRequired: true,
    };
  }

  return {
    lifecycle: JOB_LIFECYCLE_STATES.PAUSED_RESUMABLE,
    durableStatus: "paused",
    clearOwnership: true,
    reason: "default_paused_resumable",
    resume,
    humanReviewRequired: false,
  };
}

/**
 * Pure normalize: map stale RUNNING → PAUSED_RESUMABLE patch (no network).
 */
function normalizeStaleRunningJob(job, ctx = {}) {
  const derived = deriveJobLifecycleState(job, { ...ctx, activeProcess: Boolean(ctx.activeProcess) });
  const j = asJob(job);
  if (!j) {
    return { ok: false, reason: "no_job", derived };
  }
  if (derived.lifecycle === JOB_LIFECYCLE_STATES.RUNNING_ACTIVE) {
    return {
      ok: false,
      hold: true,
      reason: "ACTIVE_CHILD_PROCESS",
      derived,
      patch: null,
    };
  }
  const patch = {
    status: derived.durableStatus,
    cursor: j.cursor, // never reset
    last_successful_external_id: j.last_successful_external_id || j.lastSuccessfulExternalId || null,
    next_page_url: j.next_page_url || j.nextPageUrl || null,
    items_imported: j.items_imported ?? j.itemsImported,
    api_calls: j.api_calls ?? j.apiCalls,
    last_error: j.last_error || j.lastError || null,
    clearOwnership: derived.clearOwnership,
  };
  return {
    ok: true,
    hold: false,
    reason: derived.reason,
    derived,
    patch,
    lifecycle: derived.lifecycle,
    humanReviewRequired: Boolean(derived.humanReviewRequired),
  };
}

/**
 * Deterministic MI job-state + accounting replay (mocked; zero network).
 */
function replayMiJobStateAndAccountingFlow(opts = {}) {
  const events = [];
  const push = (type, extra = {}) => events.push({ type, ...extra });
  const job = {
    source: "courtlistener",
    cl_court: "mich",
    status: "running",
    cursor: "cl-opinion-11250867",
    last_successful_external_id: null,
    next_page_url: null,
    items_imported: 19,
    items_fetched: 19,
    api_calls: 9,
    target_max: 45,
    last_error: "TimeoutError: The operation was aborted due to timeout",
    updated_at: "2026-09-25T18:36:49.406Z",
    completed_at: null,
  };
  const activeProcess = opts.activeProcess === true;
  push("PROCESS_CHECK", { activeProcess });
  if (activeProcess) {
    return {
      ok: false,
      hold: true,
      reason: "ACTIVE_CHILD_PROCESS",
      events,
      courtListenerHttpCalls: 0,
      mutations: 0,
      aiCalls: 0,
      queue3: "NOT_OPEN",
    };
  }

  const normalized = normalizeStaleRunningJob(job, {
    activeProcess: false,
    timeout: true,
    cursorValid: true,
  });
  push("NORMALIZE", normalized);
  assertOk(normalized.ok && normalized.lifecycle === JOB_LIFECYCLE_STATES.PAUSED_RESUMABLE);

  const runnerTerminalAt = "2026-09-25T18:41:56.447Z";
  const staleDb = {
    qualifyingCases: 20,
    clCases: 19,
    generatedAt: "2026-09-25T18:09:38.292Z",
  };
  const freshDb = {
    qualifyingCases: 20,
    highCourtClCases: 19,
    clCases: 19,
    cases: 20,
    authorities: 43,
    integrity: { duplicateSourceIds: 0, orphanCount: 0 },
    generatedAt: "2026-09-25T18:42:00.000Z",
    dbEvidenceObservedAt: "2026-09-25T18:42:00.000Z",
  };
  push("REJECT_STALE_DB", {
    staleAt: staleDb.generatedAt,
    terminalAt: runnerTerminalAt,
    accepted: Date.parse(staleDb.generatedAt) >= Date.parse(runnerTerminalAt),
  });
  push("ACCEPT_FRESH_DB", {
    freshAt: freshDb.generatedAt,
    accepted: Date.parse(freshDb.generatedAt) >= Date.parse(runnerTerminalAt),
  });

  const classified = classifyExistingCorpusIngestJob(
    { ...job, status: normalized.patch.status },
    { ownerAlive: false, cursorValid: true, corpusClCases: 19 },
  );
  const state0 = {
    laneA: {
      court: "mich",
      count: 20,
      target: 45,
      targetStatus: "PARTIAL",
      checkpoint: "cl-opinion-11250867",
      cursor: "cl-opinion-11250867",
      mappingStatus: "VERIFIED",
    },
    humanReview: { required: false, reasons: [], details: [] },
    queue3: "NOT_OPEN",
  };
  const staleRec = reconcileStaleRunningGuard({
    state: state0,
    job: { ...job, status: "paused" },
    liveDb: freshDb,
    ownerAlive: false,
    processAlive: false,
    cursorValid: true,
    now: new Date("2026-09-25T18:42:01.000Z"),
  });
  push("STALE_GUARD", {
    ok: staleRec.ok,
    humanReviewRequired: staleRec.humanReviewRequired,
    classification: staleRec.classification,
  });

  // Simulated next canary: child budget 5, 3 CL calls, 2 authorities
  const session = {
    sessionId: "mi-canary-session-1",
    batchId: "mi-canary-batch-1",
    historicalJobApiCalls: 9,
    sessionClRequests: 0,
    productiveClRequests: 0,
    maxClRequests: 5,
  };
  const childCalls = 3;
  assertOk(childCalls <= session.maxClRequests);
  session.sessionClRequests += childCalls;
  session.productiveClRequests += childCalls;
  push("CANARY_CHILD", {
    sessionClRequests: session.sessionClRequests,
    productiveClRequests: session.productiveClRequests,
    historicalJobApiCalls: session.historicalJobApiCalls,
    checkpointAdvances: true,
    page1Restart: false,
  });

  const ok =
    normalized.lifecycle === JOB_LIFECYCLE_STATES.PAUSED_RESUMABLE &&
    staleRec.ok === true &&
    staleRec.humanReviewRequired === false &&
    session.sessionClRequests === 3 &&
    session.historicalJobApiCalls === 9 &&
    state0.queue3 === "NOT_OPEN";

  return {
    ok,
    hold: false,
    events,
    normalized,
    staleRec,
    session,
    courtListenerHttpCalls: 0,
    mutations: 0,
    aiCalls: 0,
    queue3: "NOT_OPEN",
    checkpoint: "cl-opinion-11250867",
    miCount: 20,
  };
}

function assertOk(cond) {
  if (!cond) throw new Error("replay_assertion_failed");
}

/**
 * Handle stale_running_guard without treating it as a zero-batch count failure.
 * With fresh DB + dead owner + valid cursor → PAUSED_RESUMABLE, no human review.
 */
function reconcileStaleRunningGuard(params = {}) {
  const job = asJob(params.job) || asJob(params.classified?.existingJob) || null;
  const liveDb = params.liveDb || null;
  const hasDb =
    liveDb &&
    [liveDb.qualifyingCases, liveDb.highCourtClCases, liveDb.clCases, liveDb.cases].some(
      (n) => Number.isFinite(Number(n)),
    );

  if (!hasDb) {
    return {
      ok: false,
      classification: "LIVE_DB_RECONCILIATION_UNAVAILABLE",
      humanReviewRequired: true,
      reason: "LIVE_DB_RECONCILIATION_UNAVAILABLE",
      detail: "stale_running_guard requires live DB count before count consistency decision",
      runnerBatchImported: 0,
      existingJobItemsImported: Number(job?.items_imported ?? job?.itemsImported) || 0,
      canonicalDbCount: null,
    };
  }

  if (!job) {
    return {
      ok: false,
      classification: "RECONCILIATION_FAILED",
      humanReviewRequired: true,
      reason: "STALE_RUNNING_WITHOUT_JOB",
      runnerBatchImported: 0,
      existingJobItemsImported: 0,
      canonicalDbCount: Number(
        liveDb.qualifyingCases ?? liveDb.highCourtClCases ?? liveDb.clCases ?? liveDb.cases,
      ),
    };
  }

  const activeProcess = Boolean(params.ownerAlive || params.processAlive || params.activeProcess);
  if (activeProcess) {
    return {
      ok: false,
      hold: true,
      classification: JOB_LIFECYCLE_STATES.RUNNING_ACTIVE,
      humanReviewRequired: false,
      reason: "ACTIVE_CHILD_PROCESS",
      detail: "refusing normalize while staging-cl-batch child is alive",
      runnerBatchImported: 0,
      existingJobItemsImported: Number(job.items_imported ?? job.itemsImported) || 0,
      canonicalDbCount: Number(
        liveDb.qualifyingCases ?? liveDb.highCourtClCases ?? liveDb.clCases ?? liveDb.cases,
      ),
    };
  }

  const normalized = normalizeStaleRunningJob(job, {
    activeProcess: false,
    timeout: isTimeoutErrorText(job.last_error || job.lastError) || Boolean(params.timeout),
    cursorValid: params.cursorValid !== false,
  });

  const jobForClassify = {
    ...job,
    status:
      normalized.patch?.status ||
      (normalized.lifecycle === JOB_LIFECYCLE_STATES.PAUSED_RESUMABLE ? "paused" : job.status),
  };

  const classified = classifyExistingCorpusIngestJob(jobForClassify, {
    ownerAlive: false,
    processAlive: false,
    cursorValid: params.cursorValid !== false,
    corpusClCases: liveDb.clCases ?? liveDb.highCourtClCases,
    qualifyingCases: liveDb.qualifyingCases ?? liveDb.highCourtClCases ?? liveDb.clCases,
    now: params.now,
  });

  const canonicalDbCount = Number(
    liveDb.qualifyingCases ?? liveDb.highCourtClCases ?? liveDb.clCases ?? liveDb.cases,
  );
  const existingJobItemsImported = Number(job.items_imported ?? job.itemsImported) || 0;

  if (!classified.resumable) {
    return {
      ok: false,
      classification: classified.classification,
      humanReviewRequired: true,
      reason: classified.reason,
      classified,
      normalized,
      runnerBatchImported: 0,
      existingJobItemsImported,
      canonicalDbCount,
    };
  }

  const adopted = adoptExistingJobIntoLaneA(params.state, jobForClassify, classified, {
    qualifyingCases: canonicalDbCount,
    corpusClCases: liveDb.clCases ?? liveDb.highCourtClCases,
    mappingStatus: params.mappingStatus || "VERIFIED",
    cursorValid: params.cursorValid !== false,
    now: params.now,
  });

  if (adopted.state?.laneA) {
    adopted.state.laneA.jobStatus = "quota_paused";
    adopted.state.laneA.jobLifecycle = normalized.lifecycle || JOB_LIFECYCLE_STATES.PAUSED_RESUMABLE;
    adopted.state.laneAChild = null;
  }

  return {
    ok: adopted.ok,
    classification: "EXISTING_JOB_RECONCILED",
    jobClassification: classified.classification,
    jobLifecycle: normalized.lifecycle || JOB_LIFECYCLE_STATES.PAUSED_RESUMABLE,
    humanReviewRequired: Boolean(adopted.humanReviewRequired || normalized.humanReviewRequired),
    state: adopted.state,
    classified,
    normalized,
    resumeFrom: adopted.resumeFrom,
    runnerBatchImported: 0,
    existingJobItemsImported,
    canonicalDbCount,
    duplicateIngestionRisk: false,
    canaryResume: true,
    courtListenerHttpCalls: 0,
  };
}

function extractExistingJobFromRunnerResult(result) {
  if (!result || typeof result !== "object") return null;
  if (result.job && typeof result.job === "object") return result.job;
  return null;
}

module.exports = {
  JOB_CLASSIFICATIONS,
  JOB_LIFECYCLE_STATES,
  RESUME_EVIDENCE,
  classifyExistingCorpusIngestJob,
  resolveResumeEvidence,
  isReadyAllowedGivenJob,
  adoptExistingJobIntoLaneA,
  deriveJobLifecycleState,
  normalizeStaleRunningJob,
  reconcileStaleRunningGuard,
  extractExistingJobFromRunnerResult,
  jobResumeFields,
  isTimeoutErrorText,
  replayMiJobStateAndAccountingFlow,
};
