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

const RESUME_EVIDENCE = Object.freeze({
  LAST_SUCCESSFUL_EXTERNAL_ID: "LAST_SUCCESSFUL_EXTERNAL_ID",
  CURSOR_ONLY: "CURSOR_ONLY",
  NEXT_PAGE_URL: "NEXT_PAGE_URL",
  NONE: "NONE",
});

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
 * Handle stale_running_guard without treating it as a zero-batch count failure.
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

  const classified = classifyExistingCorpusIngestJob(job, {
    ownerAlive: Boolean(params.ownerAlive),
    processAlive: Boolean(params.processAlive),
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
      runnerBatchImported: 0,
      existingJobItemsImported,
      canonicalDbCount,
    };
  }

  const adopted = adoptExistingJobIntoLaneA(params.state, job, classified, {
    qualifyingCases: canonicalDbCount,
    corpusClCases: liveDb.clCases ?? liveDb.highCourtClCases,
    mappingStatus: params.mappingStatus || "VERIFIED",
    cursorValid: params.cursorValid !== false,
    now: params.now,
  });

  return {
    ok: adopted.ok,
    classification: "EXISTING_JOB_RECONCILED",
    jobClassification: classified.classification,
    humanReviewRequired: Boolean(adopted.humanReviewRequired),
    state: adopted.state,
    classified,
    resumeFrom: adopted.resumeFrom,
    runnerBatchImported: 0,
    existingJobItemsImported,
    canonicalDbCount,
    duplicateIngestionRisk: false,
    canaryResume: true,
  };
}

function extractExistingJobFromRunnerResult(result) {
  if (!result || typeof result !== "object") return null;
  if (result.job && typeof result.job === "object") return result.job;
  return null;
}

module.exports = {
  JOB_CLASSIFICATIONS,
  RESUME_EVIDENCE,
  classifyExistingCorpusIngestJob,
  resolveResumeEvidence,
  isReadyAllowedGivenJob,
  adoptExistingJobIntoLaneA,
  reconcileStaleRunningGuard,
  extractExistingJobFromRunnerResult,
  jobResumeFields,
};
