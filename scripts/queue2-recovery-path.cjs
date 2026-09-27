/**
 * Queue #2 post-DATABASE_QUOTA_BLOCKED recovery path.
 *
 * Deterministic. Zero CourtListener HTTP. Zero corpus mutations.
 * Manual depth progress and the canonical manifest outrank stale laneA.
 */
"use strict";

const {
  DATABASE_QUOTA_BLOCKED,
  evaluateDbWriteReadiness,
  applyDatabaseQuotaBlock,
  recoverDatabaseQuotaBlock,
  assertCourtListenerAllowed,
  markQuotaUnknownForExecution,
  quotaUsableForExecution,
} = require("./queue2-db-readiness.cjs");
const {
  reconcileManualDepthProgress,
  selectNextProductionDepthTarget,
} = require("./queue2-manual-progress.cjs");
const {
  classifyExistingCorpusIngestJob,
  JOB_CLASSIFICATIONS,
  JOB_LIFECYCLE_STATES,
} = require("./queue2-existing-job-reconcile.cjs");
const { CANARY_MAX_SESSION_CL_REQUESTS } = require("./queue2-lane-a-child-lifecycle.cjs");
const { pageResumeUrl } = require("./cl-batch-resume-cursor.cjs");
const { evaluateLaneAProcessGate, REMOTE_CHILD_REASONS } = require("./queue2-lane-a-remote-child.cjs");

/** Stricter than normal canary for the first Lane A cycle after DB recovery. */
const FIRST_RECOVERY_CANARY = Object.freeze({
  required: true,
  mode: "CANARY_REQUIRED",
  maxQualifyingAuthorities: 2,
  maxClRequests: 5,
  maxParentQuotaProbes: 1,
  childBootstrapUsage: "0",
  reason: "first_recovery_after_database_quota_blocked",
});

const RECOVERY_STEP_ORDER = Object.freeze([
  "DB_WRITE_READY",
  "REFRESH_MANIFEST",
  "CONFIRM_COMPLETED",
  "SELECT_TARGET",
  "CLASSIFY_TARGET_JOB",
  "VERIFY_NO_REMOTE_CHILD",
  "BEGIN_CL_SESSION",
  "FRESH_QUOTA_PROBE",
  "FIRST_RECOVERY_CANARY",
  "TERMINAL_CHILD",
  "FRESH_DB_RECONCILE",
  "PERSIST",
]);

const VT_READINESS = Object.freeze({
  READY_FIRST_START: "READY_FIRST_START",
  PAUSED_RESUMABLE: "PAUSED_RESUMABLE",
  STALE_RESUMABLE: "STALE_RESUMABLE",
  COMPLETE_FOR_CURRENT_DEPTH: "COMPLETE_FOR_CURRENT_DEPTH",
  HOLD: "HOLD",
  LIVE_INSPECTION_BLOCKED: "LIVE_INSPECTION_BLOCKED",
});

/**
 * Named corpus counts. Target progress uses qualifyingCaseCount only.
 */
function normalizeCanonicalCounts(input = {}) {
  const qualifyingCaseCount = firstFinite(
    input.qualifyingCaseCount,
    input.qualifyingCases,
    input.qualifying_high_appellate,
    input.highCourtClCases,
  );
  const clCaseCount = firstFinite(input.clCaseCount, input.clCases, input.cl_cases);
  const totalCaseCount = firstFinite(input.totalCaseCount, input.cases, input.totalCases);
  const authorityCount = firstFinite(input.authorityCount, input.authorities, input.currentAuthorities);
  return {
    qualifyingCaseCount,
    clCaseCount,
    totalCaseCount,
    authorityCount,
    /** @deprecated Prefer qualifyingCaseCount. Kept only as an alias of qualifying. */
    count: qualifyingCaseCount,
  };
}

function firstFinite(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

/**
 * Target completion uses qualifying high/appellate cases only.
 * totalCaseCount and raw clCaseCount cannot falsely complete a court.
 */
function targetProgressFromCounts(counts, target = 45) {
  const goal = Math.max(0, Number(target) || 45);
  const q = counts?.qualifyingCaseCount;
  if (q == null || !Number.isFinite(Number(q))) {
    return {
      ok: false,
      reason: "QUALIFYING_COUNT_REQUIRED",
      qualifyingCaseCount: null,
      target: goal,
      remaining: null,
      targetSatisfied: false,
      falseCompletionBlocked: true,
    };
  }
  const qualifyingCaseCount = Math.max(0, Number(q));
  return {
    ok: true,
    reason: null,
    qualifyingCaseCount,
    clCaseCount: counts.clCaseCount,
    totalCaseCount: counts.totalCaseCount,
    authorityCount: counts.authorityCount,
    target: goal,
    remaining: Math.max(0, goal - qualifyingCaseCount),
    targetSatisfied: qualifyingCaseCount >= goal,
    falseCompletionBlocked: true,
  };
}

/**
 * Classify Vermont (or any court) ingest-job row without mutating.
 */
function classifyTargetJobReadiness(params = {}) {
  const court = String(params.court || "vt").toLowerCase();
  const inspection = params.inspection || {};
  if (inspection.blocked === true || inspection.classification === DATABASE_QUOTA_BLOCKED) {
    return {
      court,
      classification: VT_READINESS.LIVE_INSPECTION_BLOCKED,
      reason: inspection.reason || DATABASE_QUOTA_BLOCKED,
      job: null,
      fields: null,
      safeFirstStart: false,
      safeResume: false,
      hold: false,
      mutations: 0,
      courtListenerHttpCalls: 0,
    };
  }
  const job = params.job || null;
  if (!job) {
    return {
      court,
      classification: VT_READINESS.READY_FIRST_START,
      reason: "no_corpus_ingest_job_row",
      job: null,
      fields: emptyJobFields(),
      safeFirstStart: true,
      safeResume: false,
      hold: false,
      mutations: 0,
      courtListenerHttpCalls: 0,
    };
  }
  const fields = extractJobFields(job);
  const classified = classifyExistingCorpusIngestJob(job, {
    ownerAlive: Boolean(params.ownerAlive),
    processAlive: Boolean(params.processAlive),
    cursorValid: params.cursorValid !== false,
    corpusClCases: params.corpusClCases,
    now: params.now,
  });
  if (classified.classification === JOB_CLASSIFICATIONS.CORRUPT_INCONSISTENT) {
    return {
      court,
      classification: VT_READINESS.HOLD,
      reason: classified.reason,
      jobClassification: classified.classification,
      job,
      fields,
      safeFirstStart: false,
      safeResume: false,
      hold: true,
      mutations: 0,
      courtListenerHttpCalls: 0,
    };
  }
  if (
    classified.classification === JOB_CLASSIFICATIONS.COMPLETED_BUT_STATUS_STALE ||
    String(job.status || "").toLowerCase() === "completed"
  ) {
    return {
      court,
      classification: VT_READINESS.COMPLETE_FOR_CURRENT_DEPTH,
      reason: classified.reason || "completed",
      jobClassification: classified.classification,
      job,
      fields,
      safeFirstStart: false,
      safeResume: false,
      hold: false,
      mutations: 0,
      courtListenerHttpCalls: 0,
    };
  }
  if (classified.resumable) {
    const paused =
      ["quota_paused", "rate_limited", "paused"].includes(String(job.status || "").toLowerCase()) ||
      classified.classification === JOB_CLASSIFICATIONS.STALE_RESUMABLE;
    return {
      court,
      classification: paused ? VT_READINESS.PAUSED_RESUMABLE : VT_READINESS.STALE_RESUMABLE,
      reason: classified.reason,
      jobClassification: classified.classification,
      lifecycle: JOB_LIFECYCLE_STATES.PAUSED_RESUMABLE,
      job,
      fields,
      safeFirstStart: false,
      safeResume: true,
      hold: false,
      resumeFrom: {
        cursor: fields.cursor,
        nextPageUrl: fields.next_page_url,
        lastSuccessfulExternalId: fields.last_successful_external_id,
      },
      mutations: 0,
      courtListenerHttpCalls: 0,
    };
  }
  if (classified.classification === JOB_CLASSIFICATIONS.STALE_NONRESUMABLE) {
    return {
      court,
      classification: VT_READINESS.HOLD,
      reason: classified.reason,
      jobClassification: classified.classification,
      job,
      fields,
      safeFirstStart: false,
      safeResume: false,
      hold: true,
      mutations: 0,
      courtListenerHttpCalls: 0,
    };
  }
  return {
    court,
    classification: VT_READINESS.READY_FIRST_START,
    reason: classified.reason || "no_resumable_progress",
    jobClassification: classified.classification,
    job,
    fields,
    safeFirstStart: true,
    safeResume: false,
    hold: false,
    mutations: 0,
    courtListenerHttpCalls: 0,
  };
}

function emptyJobFields() {
  return {
    status: null,
    cursor: null,
    next_page_url: null,
    last_successful_external_id: null,
    items_imported: null,
    api_calls: null,
    target_max: null,
    batch_size: null,
    last_error: null,
    started_at: null,
    updated_at: null,
  };
}

function extractJobFields(job) {
  if (!job || typeof job !== "object") return emptyJobFields();
  return {
    status: job.status ?? null,
    cursor: job.cursor ?? null,
    next_page_url: job.next_page_url ?? job.nextPageUrl ?? null,
    last_successful_external_id:
      job.last_successful_external_id ?? job.lastSuccessfulExternalId ?? null,
    items_imported: job.items_imported ?? job.itemsImported ?? null,
    api_calls: job.api_calls ?? job.apiCalls ?? null,
    target_max: job.target_max ?? job.targetMax ?? null,
    batch_size: job.batch_size ?? job.batchSize ?? null,
    last_error: job.last_error ?? job.lastError ?? null,
    started_at: job.started_at ?? job.startedAt ?? null,
    updated_at: job.updated_at ?? job.updatedAt ?? null,
  };
}

/**
 * Autonomous worker must resume from the last opinion actually handled when
 * a CourtListener page returns more hits than the batch consumed.
 */
function assertPageSubsetCheckpointSemantics(opts = {}) {
  const url = pageResumeUrl(opts);
  const providerNext = opts.nextPage || null;
  const processed = Number(opts.processedCount) || 0;
  const hits = Number(opts.hitCount) || 0;
  if (hits > 0 && processed < hits) {
    if (!url) return { ok: false, reason: "missing_resume_url" };
    if (providerNext && url === providerNext) {
      return { ok: false, reason: "REGRESSED_TO_PROVIDER_NEXT_PAGE_SKIP" };
    }
    return { ok: true, resumeUrl: url, skippedUnhandledItems: false };
  }
  return { ok: true, resumeUrl: url, usedProviderNext: true };
}

/**
 * Plan the exact recovery path. Does not execute CourtListener or mutate corpus.
 */
function planDatabaseQuotaRecovery(params = {}) {
  const now = params.now instanceof Date ? params.now : new Date(params.now || Date.now());
  const steps = [];
  const push = (id, ok, extra = {}) => steps.push({ id, ok, ...extra });

  const db = evaluateDbWriteReadiness(params.dbProbe);
  if (db.dbWriteReady !== true) {
    push("DB_WRITE_READY", false, { classification: db.classification });
    let state = applyDatabaseQuotaBlock(params.state || {}, now);
    return {
      ok: false,
      blocked: true,
      classification: db.classification || DATABASE_QUOTA_BLOCKED,
      steps,
      state,
      allowCourtListener: false,
      clRequests: 0,
      childLaunches: 0,
      mutations: 0,
      aiCalls: 0,
      queue2: "#2",
      queue3: "NOT_OPEN",
      canary: null,
    };
  }
  push("DB_WRITE_READY", true, { classification: db.classification });

  let state = JSON.parse(JSON.stringify(params.state || {}));
  if (state.databaseBlock?.classification === DATABASE_QUOTA_BLOCKED) {
    const rec = recoverDatabaseQuotaBlock(state, now);
    state = rec.state;
  } else {
    state.dbWriteReady = true;
    state.quota = markQuotaUnknownForExecution(state.quota);
  }

  const manifest = params.manifest || { targets: [] };
  push("REFRESH_MANIFEST", true, { version: manifest.version || null });

  const reconciled = reconcileManualDepthProgress(state, manifest, { now });
  state = reconciled.state;
  push("CONFIRM_COMPLETED", true, {
    completedCourts: state.completedCourts || [],
    inventedCheckpoints: reconciled.inventedCheckpoints,
  });

  // Live drift: prefer live counts when provided.
  let workingManifest = manifest;
  if (params.liveCountsByCourt && typeof params.liveCountsByCourt === "object") {
    workingManifest = JSON.parse(JSON.stringify(manifest));
    for (const t of workingManifest.targets || []) {
      const court = (t.preferredCourts || [])[0];
      const live = params.liveCountsByCourt[court];
      if (!live) continue;
      const counts = normalizeCanonicalCounts(live);
      if (counts.qualifyingCaseCount != null) {
        t.currentCases = counts.qualifyingCaseCount;
        t.qualifyingCaseCount = counts.qualifyingCaseCount;
        if (counts.qualifyingCaseCount >= Number(t.targetCases || 45)) {
          t.status = "COMPLETE_FOR_CURRENT_DEPTH";
          t.autonomousIngestBlocked = true;
        }
      }
      if (counts.clCaseCount != null) t.clCases = counts.clCaseCount;
      if (counts.authorityCount != null) t.currentAuthorities = counts.authorityCount;
    }
    const again = reconcileManualDepthProgress(state, workingManifest, { now });
    state = again.state;
  }

  const next = selectNextProductionDepthTarget(workingManifest, {
    excludeCourts: state.completedCourts || [],
  });
  if (!next?.court) {
    push("SELECT_TARGET", false, { reason: "no_incomplete_verified_target" });
    return {
      ok: false,
      blocked: false,
      reason: "NO_INCOMPLETE_TARGET",
      steps,
      state,
      allowCourtListener: false,
      clRequests: 0,
      childLaunches: 0,
      mutations: 0,
      aiCalls: 0,
      queue2: "#2",
      queue3: "NOT_OPEN",
      canary: null,
    };
  }

  const counts = normalizeCanonicalCounts({
    qualifyingCaseCount: next.count,
    clCaseCount: next.clCases,
    totalCaseCount: next.totalCases,
    authorityCount: next.currentAuthorities,
  });
  const progress = targetProgressFromCounts(counts, next.target);
  state.laneA = {
    ...(state.laneA || {}),
    court: next.court,
    jurisdiction: next.jurisdiction,
    qualifyingCaseCount: progress.qualifyingCaseCount,
    clCaseCount: counts.clCaseCount,
    totalCaseCount: counts.totalCaseCount,
    authorityCount: counts.authorityCount,
    count: progress.qualifyingCaseCount,
    target: next.target,
    mappingStatus: next.mappingStatus || "VERIFIED",
    checkpoint: next.checkpoint,
    targetStatus: next.status || "READY",
    jobStatus: state.laneA?.jobStatus === "completed" ? "ready" : state.laneA?.jobStatus || "ready",
  };
  push("SELECT_TARGET", true, {
    court: next.court,
    jurisdiction: next.jurisdiction,
    qualifyingCaseCount: progress.qualifyingCaseCount,
    target: next.target,
    mappingStatus: next.mappingStatus,
  });

  const jobReady = classifyTargetJobReadiness({
    court: next.court,
    job: params.targetJob,
    inspection: params.jobInspection,
    ownerAlive: false,
    processAlive: false,
    corpusClCases: params.corpusClCases,
    now,
  });
  push("CLASSIFY_TARGET_JOB", !jobReady.hold, {
    classification: jobReady.classification,
    hold: jobReady.hold,
  });
  if (jobReady.hold) {
    state.humanReview = {
      required: true,
      reasons: ["CORRUPT_INCONSISTENT_INGEST_JOB"],
      details: [{ reason: jobReady.reason }],
    };
    return {
      ok: false,
      hold: true,
      reason: jobReady.reason,
      steps,
      state,
      jobReady,
      nextTarget: next,
      allowCourtListener: false,
      clRequests: 0,
      childLaunches: 0,
      mutations: 0,
      aiCalls: 0,
      queue2: "#2",
      queue3: "NOT_OPEN",
      canary: null,
    };
  }

  const processGate = evaluateLaneAProcessGate({
    processes: params.remoteProcesses || [],
    laneAChild: state.laneAChild || null,
  });
  const processOk =
    processGate.allowLaunch === true &&
    !processGate.emergencyStop &&
    processGate.count === 0;
  push("VERIFY_NO_REMOTE_CHILD", processOk, {
    reason: processGate.reason,
    count: processGate.count,
  });
  if (!processOk) {
    return {
      ok: false,
      hold: processGate.emergencyStop || processGate.count > 0,
      reason: processGate.reason || REMOTE_CHILD_REASONS.ORPHAN_LANE_A_CHILD,
      steps,
      state,
      jobReady,
      nextTarget: next,
      processGate,
      allowCourtListener: false,
      clRequests: 0,
      childLaunches: 0,
      mutations: 0,
      aiCalls: 0,
      queue2: "#2",
      queue3: "NOT_OPEN",
      canary: null,
    };
  }

  push("BEGIN_CL_SESSION", true, { note: "new_worker_process_resets_session" });
  push("FRESH_QUOTA_PROBE", true, {
    maxProbes: FIRST_RECOVERY_CANARY.maxParentQuotaProbes,
    childBootstrapUsage: FIRST_RECOVERY_CANARY.childBootstrapUsage,
    staleQuotaUsable: quotaUsableForExecution(state.quota),
  });

  const canary = {
    ...FIRST_RECOVERY_CANARY,
    maxClRequests: Math.min(FIRST_RECOVERY_CANARY.maxClRequests, CANARY_MAX_SESSION_CL_REQUESTS),
  };
  state.canaryMode = "CANARY_REQUIRED";
  state.canary = {
    required: true,
    reason: canary.reason,
    maxQualifyingAuthorities: canary.maxQualifyingAuthorities,
    maxClRequests: canary.maxClRequests,
    firstRecovery: true,
  };
  push("FIRST_RECOVERY_CANARY", true, canary);
  push("TERMINAL_CHILD", true, { pending: true });
  push("FRESH_DB_RECONCILE", true, { pending: true });
  push("PERSIST", true, { pending: true });

  const clGate = assertCourtListenerAllowed({ dbWriteReady: true });
  state.queue = "#2";
  state.queue9 = "CLOSED";
  state.queue3 = "NOT_OPEN";
  state.featureAgents = "0";
  state.metrics = { ...(state.metrics || {}), aiCalls: 0, aiTokens: 0 };

  return {
    ok: true,
    blocked: false,
    hold: false,
    recovered: true,
    steps,
    stepOrder: RECOVERY_STEP_ORDER,
    state,
    jobReady,
    nextTarget: {
      court: next.court,
      jurisdiction: next.jurisdiction,
      qualifyingCaseCount: progress.qualifyingCaseCount,
      clCaseCount: counts.clCaseCount,
      totalCaseCount: counts.totalCaseCount,
      authorityCount: counts.authorityCount,
      target: next.target,
      mappingStatus: next.mappingStatus,
    },
    processGate,
    canary,
    allowCourtListener: clGate.ok,
    parentQuotaProbesAllowed: 1,
    childBootstrapUsage: "0",
    clRequests: 0,
    childLaunches: 0,
    mutations: 0,
    aiCalls: 0,
    queue2: "#2",
    queue3: "NOT_OPEN",
    inventedCheckpoints: reconciled.inventedCheckpoints,
  };
}

/**
 * Safe non-mutating DB readiness interpretation.
 * SELECT 1 succeeding proves the Neon quota session is accepted.
 * Optional rollback-safe write probe may strengthen the signal; it must leave mutations=0.
 */
function evaluateIngestDbWriteReadiness(probe = {}) {
  const base = evaluateDbWriteReadiness(probe);
  if (base.dbWriteReady !== true) return { ...base, ingestPathReady: false };
  if (probe.writeProbeMode === "rollback_txn" && probe.mutations === 0 && probe.rollbackOk === true) {
    return {
      ...base,
      ingestPathReady: true,
      writeProof: "rollback_safe_transaction",
      mutations: 0,
    };
  }
  return {
    ...base,
    ingestPathReady: true,
    writeProof: "session_accepted_select_1",
    note: "SQLSTATE 53000 rejects before SQL; successful SELECT 1 is sufficient readiness for this gate",
    mutations: 0,
  };
}

module.exports = {
  FIRST_RECOVERY_CANARY,
  RECOVERY_STEP_ORDER,
  VT_READINESS,
  normalizeCanonicalCounts,
  targetProgressFromCounts,
  classifyTargetJobReadiness,
  extractJobFields,
  assertPageSubsetCheckpointSemantics,
  planDatabaseQuotaRecovery,
  evaluateIngestDbWriteReadiness,
};
