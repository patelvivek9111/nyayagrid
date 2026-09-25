/**
 * Queue #2 dual-lane controller — pure scheduler (no network).
 *
 * LANE A: CourtListener ingest (single worker).
 * LANE B: strictly zero CourtListener HTTP.
 * Quota recheck is a separate scheduled mechanism (api-usage only).
 *
 * FEATURE_AGENTS must stay 0. Queue #3 is not opened here.
 */

"use strict";

const { createHash } = require("node:crypto");
const {
  validatePartialCheckpoint,
  reconcileLaneAFromJob,
  setHumanReview,
  HUMAN_REVIEW_REASONS,
  isPartialLaneA,
  isReadyFirstStartLaneA,
  hasDurableCheckpoint,
  requiresDurableResumeCheckpoint,
  isMissingDurableResumeCheckpointFatal,
} = require("./queue2-worker-observability.cjs");
const {
  QUOTA_MODES,
  BINDING_WINDOWS,
  loadAdaptiveQuotaConfig,
  planAdaptiveQuota,
  hasUsefulAdaptiveCapacity,
  updateCourtEfficiency,
  efficiencyRegressionTriggered,
  shouldProbeQuota,
  dayUtilization,
  remainingAuthoritiesNeeded: remainingAuthoritiesNeededAdaptive,
  estimateRequestsNeeded,
} = require("./cl-adaptive-quota.cjs");
const { resolveBindingResetAt, remainingCasesToFinish, nextQuotaCheckAfterActiveBatch } = require("./queue2-lane-a-dispatch.cjs");

const QUEUE = "#2";
/** @deprecated Fixed 25-request gate removed; kept for test/compat aliases only. */
const USEFUL_CL_MIN = 25;
const MIN_QUOTA_PROBE_GAP_MS = 10 * 60 * 1000;
const LANE_A_LOCK_TTL_MS = 30 * 60 * 1000;
const EST_CL_REQUESTS_PER_CASE = 2.3;

/** Current production-depth CL sequence (Wave 2AG remainder). */
const LANE_A_SEQUENCE = [
  { court: "ark", j: "AR", target: 45 },
  { court: "sd", j: "SD", target: 45 },
  { court: "idaho", j: "ID", target: 45 },
  { court: "wyo", j: "WY", target: 45 },
  { court: "neb", j: "NE", target: 45 },
  { court: "ala", j: "AL", target: 45 },
  { court: "ky", j: "KY", target: 45 },
];

const LANE_B_TASKS = [
  "us_reports_gap_analysis",
  "us_reports_non_cl_intake",
  "usc_cfr_federal_rules_depth",
  "citation_re_resolution",
  "depth_gap_analysis",
  "historical_hole_detection",
  "intermediate_court_research",
  "corpus_integrity",
  "retrieval_validation",
  "depth_scorecard",
];

/** Canonical registry IDs (see packages/research/corpus/config/queue2-offline-task-registry.json). */
const LANE_B_REGISTRY_IDS = [
  "US_REPORTS_GAP_ANALYSIS",
  "NON_CL_PRIMARY_AUTHORITY_INTAKE",
  "USC_DEPTH",
  "CFR_DEPTH",
  "FEDERAL_RULES_DEPTH",
  "CITATION_RERESOLVE",
  "DEPTH_MANIFEST_REFRESH",
  "HISTORICAL_GAP_ANALYSIS",
  "INTERMEDIATE_MAPPING_RESEARCH_NON_CL",
  "CORPUS_INTEGRITY_AUDIT",
  "RETRIEVAL_REGRESSION",
  "CURRENTNESS_AUDIT_LOCAL",
  "NEXT_CL_BATCH_PREPARATION",
  "DAILY_SCORECARD_REFRESH",
];

const CL_HOST_RE = /(?:^|\.)courtlistener\.com$/i;
const CL_BLOCKED_PATHS = [
  "/api/rest/v4/opinions",
  "/api/rest/v4/clusters",
  "/api/rest/v4/dockets",
  "/api/rest/v4/courts",
  "/api/rest/v4/search",
  "/api/rest/v4/api-usage",
];

function sha256(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

function createInitialState(now = new Date()) {
  const first = LANE_A_SEQUENCE[0];
  return {
    version: 1,
    queue: QUEUE,
    queue9: "CLOSED",
    queue3: "NOT_OPEN",
    featureAgents: "0",
    currentLane: "B",
    updatedAt: now.toISOString(),
    laneA: {
      court: first.court,
      jurisdiction: first.j,
      checkpoint: null,
      cursor: null,
      lastSuccessfulExternalId: null,
      nextPageUrl: null,
      lastSuccessfulAt: null,
      runner: "staging-cl-batch-job",
      mappingStatus: null,
      manifestVersion: 0,
      jobStatus: null,
      itemsImported: null,
      target: first.target,
      count: 0,
      sequence: LANE_A_SEQUENCE.map((s) => s.court),
      lock: null,
    },
    quota: {
      windows: null,
      lastProbeAt: null,
      nextCheckAt: now.toISOString(),
      last429At: null,
      retryAfterSeconds: null,
      lastSafeRequests: 0,
      currentUsableNow: 0,
      bindingWindow: null,
      bindingResetAt: null,
      hard429Count: 0,
      courtEfficiency: {},
      probeRequests: 0,
      lastPlan: null,
      wait: null,
      utilization: null,
      quotaStateObservedAt: null,
      quotaStateSource: null,
      quotaStateConfidence: null,
      quotaStateAgeMs: null,
      membership: null,
    },
    laneB: {
      task: "NONE",
      checkpoint: null,
      tasksCompleted: [],
      checkpoints: {},
      lastByTask: {},
      nextEligibleAt: {},
      lastEligibility: null,
      mutatingTaskActive: null,
    },
    depthManifestVersion: 0,
    lastCitationResolve: null,
    lastIntegrityAudit: null,
    laneStartedAt: null,
    lastHeartbeatAt: null,
    idleSafe: false,
    waitingForNetwork: false,
    lastOnlineAt: null,
    runtimeState: "STOPPED",
    humanReview: { required: false, reasons: [], details: [] },
    metrics: {
      laneAMs: 0,
      laneBMs: 0,
      idleMs: 0,
      idleSafeMs: 0,
      waitingNetworkMs: 0,
      clAuthorities: 0,
      nonClAuthorities: 0,
      citationsResolved: 0,
      quotaChecks: 0,
      laneSwitches: 0,
      aiCalls: 0,
      aiTokens: 0,
    },
    switches: [],
  };
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function restoreState(saved, now = new Date()) {
  const base = createInitialState(now);
  if (!saved || typeof saved !== "object") return base;
  const merged = {
    ...base,
    ...saved,
    laneA: { ...base.laneA, ...(saved.laneA || {}) },
    quota: { ...base.quota, ...(saved.quota || {}) },
    laneB: { ...base.laneB, ...(saved.laneB || {}) },
    metrics: { ...base.metrics, ...(saved.metrics || {}) },
    humanReview: {
      required: false,
      reasons: [],
      details: [],
      ...(saved.humanReview || {}),
    },
    switches: Array.isArray(saved.switches) ? saved.switches : [],
  };
  merged.queue = QUEUE;
  merged.queue9 = "CLOSED";
  merged.queue3 = "NOT_OPEN";
  merged.featureAgents = "0";
  merged.version = 1;
  if (merged.currentLane === "STOPPED" || merged.runtimeState === "STOPPED") {
    // Preserve clean stopped scheduler state; do not coerce to Lane B.
    if (merged.currentLane !== "A" && merged.currentLane !== "B" && merged.currentLane !== "WAIT") {
      merged.currentLane = "STOPPED";
    }
  } else if (merged.currentLane !== "A" && merged.currentLane !== "B" && merged.currentLane !== "WAIT") {
    merged.currentLane = "B";
  }
  merged.idleSafe = Boolean(merged.idleSafe);
  merged.waitingForNetwork = Boolean(merged.waitingForNetwork);
  merged.runtimeState = merged.runtimeState || "STOPPED";
  merged.metrics = {
    ...base.metrics,
    ...(saved.metrics || {}),
    aiCalls: 0,
    aiTokens: 0,
  };
  merged.laneB = {
    ...base.laneB,
    ...(saved.laneB || {}),
    checkpoints: { ...(base.laneB.checkpoints || {}), ...((saved.laneB && saved.laneB.checkpoints) || {}) },
    lastByTask: { ...(base.laneB.lastByTask || {}), ...((saved.laneB && saved.laneB.lastByTask) || {}) },
    nextEligibleAt: {
      ...(base.laneB.nextEligibleAt || {}),
      ...((saved.laneB && saved.laneB.nextEligibleAt) || {}),
    },
  };
  // Hydrate lastByTask from tasksCompleted when intervals were never persisted
  // (first-run bug: monolithic Lane B wrote tasksCompleted but orchestrator
  // overwrote lastByTask {}). Prevents permanent US_REPORTS pinning.
  if (
    Array.isArray(merged.laneB.tasksCompleted) &&
    merged.laneB.tasksCompleted.length > 0 &&
    Object.keys(merged.laneB.lastByTask || {}).length === 0
  ) {
    const seedAt = saved.updatedAt || saved.lastHeartbeatAt || now.toISOString();
    const legacyToId = {
      us_reports_gap_analysis: "US_REPORTS_GAP_ANALYSIS",
      us_reports_non_cl_intake: "NON_CL_PRIMARY_AUTHORITY_INTAKE",
      usc_cfr_federal_rules_depth: "USC_DEPTH",
      citation_re_resolution: "CITATION_RERESOLVE",
      depth_gap_analysis: "DEPTH_MANIFEST_REFRESH",
      historical_hole_detection: "HISTORICAL_GAP_ANALYSIS",
      intermediate_court_research: "INTERMEDIATE_MAPPING_RESEARCH_NON_CL",
      corpus_integrity: "CORPUS_INTEGRITY_AUDIT",
      retrieval_validation: "RETRIEVAL_REGRESSION",
      depth_scorecard: "DAILY_SCORECARD_REFRESH",
    };
    for (const id of merged.laneB.tasksCompleted) {
      merged.laneB.lastByTask[id] = seedAt;
      const canon = legacyToId[id];
      if (canon) merged.laneB.lastByTask[canon] = seedAt;
    }
  }
  if (merged.idleSafe || merged.runtimeState === "IDLE_SAFE") {
    merged.laneB.task = "NONE";
  }
  // Harden: never keep an active CL partial court with a null checkpoint.
  // READY first-start courts (e.g. MI with existing corpus cases, no CL resume) are OK.
  const check = validatePartialCheckpoint(merged.laneA);
  merged.laneA = check.laneA;
  if (check.humanReviewRequired) {
    Object.assign(
      merged,
      setHumanReview(merged, check.reason, "restoreState refused null checkpoint on partial court"),
    );
    if (merged.currentLane === "A") merged.currentLane = "B";
  } else if (
    merged.humanReview?.required &&
    Array.isArray(merged.humanReview.reasons) &&
    merged.humanReview.reasons.length === 1 &&
    merged.humanReview.reasons[0] === HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT &&
    isReadyFirstStartLaneA(merged.laneA)
  ) {
    // Clear stale false-positive review if state was previously poisoned by READY-as-partial.
    merged.humanReview = { required: false, reasons: [], details: [] };
  }
  return merged;
}

/**
 * Persist Lane A progress. Rejects partial courts without durable checkpoint
 * (never invents a resume position).
 */
function persistLaneAProgress(state, patch = {}, now = new Date()) {
  const next = cloneState(state);
  next.laneA = {
    ...next.laneA,
    ...patch,
    checkpoint:
      patch.checkpoint ??
      patch.lastSuccessfulExternalId ??
      next.laneA.checkpoint ??
      next.laneA.lastSuccessfulExternalId ??
      null,
  };
  if (patch.lastSuccessfulExternalId) {
    next.laneA.lastSuccessfulExternalId = patch.lastSuccessfulExternalId;
    if (!next.laneA.checkpoint) next.laneA.checkpoint = patch.lastSuccessfulExternalId;
  }
  next.updatedAt = now.toISOString();
  const check = validatePartialCheckpoint(next.laneA);
  next.laneA = check.laneA;
  if (check.humanReviewRequired) {
    return {
      ok: false,
      state: setHumanReview(next, check.reason, "persistLaneAProgress blocked null checkpoint"),
      reason: check.reason,
    };
  }
  return { ok: true, state: next, reason: null };
}

/**
 * Copy proven durable job checkpoint into scheduler. Does not invent IDs.
 */
function applyDurableJobCheckpoint(state, job, extras = {}, now = new Date()) {
  const next = cloneState(state);
  const { state: laneA, reconciled, reason } = reconcileLaneAFromJob(next.laneA, job, extras);
  next.laneA = laneA;
  next.updatedAt = now.toISOString();
  if (!reconciled) {
    if (isMissingDurableResumeCheckpointFatal(next.laneA)) {
      return {
        ok: false,
        state: setHumanReview(
          next,
          HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT,
          reason || "durable job reconcile failed",
        ),
        reason: reason || HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT,
      };
    }
    return { ok: false, state: next, reason: reason || "reconcile_failed" };
  }
  const check = validatePartialCheckpoint(next.laneA);
  next.laneA = check.laneA;
  if (check.humanReviewRequired) {
    return {
      ok: false,
      state: setHumanReview(next, check.reason, "post-reconcile validation"),
      reason: check.reason,
    };
  }
  // Clear prior missing-checkpoint review if reconciled successfully.
  if (next.humanReview?.reasons?.includes(HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT)) {
    next.humanReview.reasons = next.humanReview.reasons.filter(
      (r) => r !== HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT,
    );
    if (next.humanReview.reasons.length === 0) {
      next.humanReview.required = false;
      next.humanReview.details = [];
    }
  }
  return { ok: true, state: next, reason: null };
}

function remainingRequestsToFinishCourt(laneA, opts = {}) {
  const need = remainingAuthoritiesNeededAdaptive(laneA);
  if (need <= 0) return 0;
  const cfg = opts.config || loadAdaptiveQuotaConfig();
  const rpa =
    opts.requestsPerAuthority != null
      ? Number(opts.requestsPerAuthority)
      : Number(cfg.defaultRequestsPerAuthority);
  // Conservative estimate for finish budgeting (includes uncertainty when requested).
  if (opts.withUncertainty) {
    return estimateRequestsNeeded(need, rpa, cfg);
  }
  return Math.ceil(need * rpa);
}

/**
 * Resume Lane A when adaptive usable capacity supports finish / full / micro batch.
 * The fixed safeRequests>=25 gate is removed.
 *
 * @param {{
 *   safeRequests?: number,
 *   windows?: object,
 *   remainingRequestsToFinishCourt?: number,
 *   minBatch?: number,
 *   laneA?: object,
 *   efficiencyStore?: object,
 *   config?: object,
 *   now?: Date,
 *   laneBHasWork?: boolean,
 * }} params
 */
function hasUsefulClCapacity(params) {
  // Legacy minBatch ignored as a universal gate; adaptive planner decides.
  const capacity = hasUsefulAdaptiveCapacity({
    windows: params.windows || null,
    safeRequests: params.safeRequests,
    remainingRequestsToFinishCourt: params.remainingRequestsToFinishCourt,
    laneA: params.laneA || {
      count: 0,
      target: 45,
      court: params.court || null,
    },
    efficiencyStore: params.efficiencyStore,
    config: params.config,
    now: params.now,
    laneBHasWork: params.laneBHasWork,
  });
  return capacity;
}

function projectNextQuotaCheck(params) {
  const nowMs = (params.now instanceof Date ? params.now : new Date(params.now)).getTime();
  const lastProbeMs = params.lastProbeAt ? new Date(params.lastProbeAt).getTime() : 0;
  const earliest = lastProbeMs + (params.minGapMs ?? MIN_QUOTA_PROBE_GAP_MS);
  const projected =
    params.projectedUsefulAt != null ? new Date(params.projectedUsefulAt).getTime() : nowMs;
  const next = Math.max(nowMs, earliest, projected);
  return new Date(next).toISOString();
}

/** Quota modes that mean work is eligible NOW — nextUsefulAt must not block. */
const ACTIVE_QUOTA_MODES = new Set([
  QUOTA_MODES.FINISH_TARGET,
  QUOTA_MODES.FULL_BATCH,
  QUOTA_MODES.MICRO_BATCH,
]);

function isActiveQuotaMode(mode) {
  return ACTIVE_QUOTA_MODES.has(mode);
}

function quotaProbeDue(state, now = new Date()) {
  return shouldProbeQuota(state, now).probe;
}

/**
 * @param {object} state
 * @param {{
 *   safeRequests?: number,
 *   windows?: object,
 *   projectedUsefulAt?: string|Date|null,
 *   now?: Date,
 *   laneBHasWork?: boolean,
 *   efficiencyStore?: object,
 *   config?: object,
 * }} quota
 */
function decideLane(state, quota = {}) {
  const now = quota.now || new Date();
  const cfg = quota.config || loadAdaptiveQuotaConfig();
  if (state?.humanReview?.required) {
    return {
      lane: "B",
      reason: "human_review_required",
      quotaMode: QUOTA_MODES.DAY_BLOCKED,
      remainingRequestsToFinishCourt: remainingRequestsToFinishCourt(state.laneA),
      blocked: true,
    };
  }
  const check = validatePartialCheckpoint(state.laneA);
  if (check.humanReviewRequired) {
    return {
      lane: "B",
      reason: check.reason,
      quotaMode: QUOTA_MODES.DAY_BLOCKED,
      remainingRequestsToFinishCourt: remainingRequestsToFinishCourt(state.laneA),
      blocked: true,
      needsHumanReview: true,
    };
  }

  if (efficiencyRegressionTriggered(state.quota?.courtEfficiency || {}, state.laneA?.court, cfg)) {
    return {
      lane: "B",
      reason: "COURTLISTENER_REQUEST_EFFICIENCY_REGRESSION",
      quotaMode: QUOTA_MODES.DAY_BLOCKED,
      remainingRequestsToFinishCourt: remainingRequestsToFinishCourt(state.laneA),
      blocked: true,
      needsHumanReview: true,
      humanReviewReason: "COURTLISTENER_REQUEST_EFFICIENCY_REGRESSION",
    };
  }

  const rawWindows = quota.windows || state.quota?.windows || null;
  const windowsComplete = Boolean(
    rawWindows &&
      rawWindows.minute &&
      rawWindows.hour &&
      rawWindows.day &&
      Number.isFinite(Number(rawWindows.minute.remaining)) &&
      Number.isFinite(Number(rawWindows.hour.remaining)) &&
      Number.isFinite(Number(rawWindows.day.remaining)),
  );
  const plan = planAdaptiveQuota({
    windows: windowsComplete ? rawWindows : null,
    usableRequestsOverride: windowsComplete
      ? null
      : quota.safeRequests != null
        ? quota.safeRequests
        : state.quota?.lastSafeRequests,
    laneA: state.laneA,
    efficiencyStore: quota.efficiencyStore || state.quota?.courtEfficiency || {},
    config: cfg,
    now,
    laneBHasWork: quota.laneBHasWork,
  });

  // Legacy finish-partial: when only safeRequests provided and it covers estimated finish.
  if (!windowsComplete && plan.lane !== "A") {
    const legacyRemaining = remainingRequestsToFinishCourt(state.laneA);
    const safe = Number(quota.safeRequests);
    if (Number.isFinite(safe) && legacyRemaining > 0 && safe >= legacyRemaining) {
      return {
        lane: "A",
        reason: "finish_partial_court",
        quotaMode: QUOTA_MODES.FINISH_TARGET,
        remainingRequestsToFinishCourt: legacyRemaining,
        usableRequests: safe,
        estimatedRequestsNeeded: legacyRemaining,
        requestsPerAuthorityEstimate: plan.requestsPerAuthorityEstimate,
        bindingWindow: plan.bindingWindow,
        nextUsefulAt: null,
        plan,
      };
    }
  }

  const activeNow = isActiveQuotaMode(plan.quotaMode) && plan.lane === "A";
  // Active modes: never inherit projected day/hour reset into nextUsefulAt.
  const nextUsefulAt = activeNow ? null : plan.nextUsefulAt || null;
  const bindingResetAt = activeNow
    ? resolveBindingResetAt(rawWindows, plan.bindingWindow)
    : plan.nextUsefulAt || resolveBindingResetAt(rawWindows, plan.bindingWindow);

  const out = {
    lane: plan.lane,
    reason: plan.reason,
    quotaMode: plan.quotaMode,
    remainingRequestsToFinishCourt: remainingRequestsToFinishCourt(state.laneA),
    remainingAuthoritiesNeeded: plan.remainingAuthoritiesNeeded,
    usableRequests: plan.usableRequests,
    estimatedRequestsNeeded: plan.estimatedRequestsNeeded,
    requestsPerAuthorityEstimate: plan.requestsPerAuthorityEstimate,
    bindingWindow: plan.bindingWindow,
    bindingResetAt,
    currentUsableNow: plan.usableRequests,
    nextUsefulAt,
    microBatchMaxRequests: plan.microBatchMaxRequests,
    nearComplete: plan.nearComplete,
    plan,
  };

  if (plan.lane === "A") {
    return {
      ...out,
      nextUsefulAt: null,
      nextCheckAt: nextQuotaCheckAfterActiveBatch(now, { deferMs: 15 * 60 * 1000 }),
    };
  }

  if (plan.lane === "WAIT") {
    return {
      ...out,
      lane: "WAIT",
      nextCheckAt: nextUsefulAt
        ? nextUsefulAt
        : projectNextQuotaCheck({
            now,
            lastProbeAt: state.quota?.lastProbeAt || now.toISOString(),
            projectedUsefulAt: nextUsefulAt,
          }),
    };
  }

  return {
    ...out,
    lane: "B",
    nextCheckAt: projectNextQuotaCheck({
      now,
      lastProbeAt: state.quota?.lastProbeAt || now.toISOString(),
      projectedUsefulAt: nextUsefulAt,
    }),
  };
}

function applyQuotaSnapshot(state, params) {
  const next = cloneState(state);
  const now = params.now || new Date();
  const usableNow = Math.max(0, Number(params.safeRequests) || 0);
  next.quota.windows = params.windows || next.quota.windows;
  next.quota.lastProbeAt = now.toISOString();
  next.quota.lastSafeRequests = usableNow;
  next.quota.currentUsableNow = usableNow;
  if (params.bindingWindow != null) next.quota.bindingWindow = params.bindingWindow;
  const activeNow =
    params.wait === null ||
    isActiveQuotaMode(params.quotaMode) ||
    params.clearBlocking === true;
  // Binding reset must match bindingWindow. Never attach day reset to MINUTE.
  if (params.bindingResetAt !== undefined) {
    next.quota.bindingResetAt = params.bindingResetAt;
  } else if (!activeNow && params.projectedUsefulAt != null) {
    next.quota.bindingResetAt = params.projectedUsefulAt;
  } else if (activeNow && params.windows && params.bindingWindow) {
    next.quota.bindingResetAt = resolveBindingResetAt(params.windows, params.bindingWindow);
  }
  if (activeNow) {
    // Do not set nextCheckAt=now — that creates a 5-second reprobe loop.
    next.quota.nextCheckAt =
      params.nextCheckAt ||
      nextQuotaCheckAfterActiveBatch(now, { deferMs: params.activeDeferMs || 15 * 60 * 1000 });
  } else {
    next.quota.nextCheckAt = projectNextQuotaCheck({
      now,
      lastProbeAt: now.toISOString(),
      projectedUsefulAt: params.nextUsefulAt || params.projectedUsefulAt || null,
    });
  }
  if (params.last429At) next.quota.last429At = params.last429At;
  if (params.retryAfterSeconds != null) next.quota.retryAfterSeconds = params.retryAfterSeconds;
  if (params.quotaStateObservedAt != null) next.quota.quotaStateObservedAt = params.quotaStateObservedAt;
  else next.quota.quotaStateObservedAt = now.toISOString();
  if (params.quotaStateSource != null) next.quota.quotaStateSource = params.quotaStateSource;
  if (params.quotaStateConfidence != null) next.quota.quotaStateConfidence = params.quotaStateConfidence;
  if (params.quotaStateAgeMs != null) next.quota.quotaStateAgeMs = params.quotaStateAgeMs;
  else next.quota.quotaStateAgeMs = 0;
  if (params.membership != null) next.quota.membership = params.membership;
  if (params.plan) next.quota.lastPlan = params.plan;
  if (params.wait !== undefined) next.quota.wait = params.wait;
  if (params.windows) next.quota.utilization = dayUtilization(params.windows);
  if (params.probeCounted) {
    next.quota.probeRequests = Number(next.quota.probeRequests || 0) + 1;
  }
  next.metrics.quotaChecks += 1;
  next.updatedAt = now.toISOString();
  return next;
}

function recordCourtBatchEfficiency(state, batch) {
  const next = cloneState(state);
  next.quota.courtEfficiency = updateCourtEfficiency(next.quota.courtEfficiency || {}, batch);
  next.updatedAt = new Date().toISOString();
  return next;
}

function recordLaneSwitch(state, fromLane, toLane, reason, now = new Date()) {
  const next = cloneState(state);
  next.currentLane = toLane;
  next.metrics.laneSwitches += 1;
  next.switches.push({
    at: now.toISOString(),
    from: fromLane,
    to: toLane,
    reason,
  });
  next.updatedAt = now.toISOString();
  return next;
}

function applyQuotaFloorTransition(state, params) {
  const now = params.now || new Date();
  const waitPayload =
    params.wait !== undefined
      ? params.wait
      : params.nextUsefulAt
        ? {
            bindingWindow: params.bindingWindow || null,
            nextUsefulAt: params.nextUsefulAt,
            quotaMode: params.quotaMode || null,
            usableRequests: params.safeRequests,
            estimatedRequestsNeeded: params.estimatedRequestsNeeded || null,
          }
        : params.clearWait
          ? null
          : undefined;
  let next = applyQuotaSnapshot(state, {
    ...params,
    projectedUsefulAt: params.projectedUsefulAt || params.nextUsefulAt || null,
    wait: waitPayload,
  });
  const checkpoint =
    params.checkpoint ??
    params.lastSuccessfulExternalId ??
    next.laneA.checkpoint ??
    next.laneA.lastSuccessfulExternalId ??
    null;
  next.laneA = {
    ...next.laneA,
    court: params.court ?? next.laneA.court,
    jurisdiction: params.jurisdiction ?? next.laneA.jurisdiction,
    checkpoint,
    cursor: params.cursor ?? next.laneA.cursor,
    lastSuccessfulExternalId:
      params.lastSuccessfulExternalId ?? next.laneA.lastSuccessfulExternalId ?? checkpoint,
    nextPageUrl: params.nextPageUrl ?? next.laneA.nextPageUrl,
    lastSuccessfulAt: params.lastSuccessfulAt ?? next.laneA.lastSuccessfulAt,
    target: params.target ?? next.laneA.target,
    count: params.count ?? next.laneA.count,
    jobStatus: params.jobStatus ?? next.laneA.jobStatus ?? "quota_paused",
    lock: null,
  };
  const check = validatePartialCheckpoint(next.laneA);
  next.laneA = check.laneA;
  if (check.humanReviewRequired) {
    next = setHumanReview(next, check.reason, "quota floor with missing durable checkpoint");
  }

  const mode = params.quotaMode || null;
  const preferWait =
    mode === QUOTA_MODES.WAIT_MINUTE ||
    params.reason === "minute_window_blocked" ||
    params.reason === "below_micro_batch_minimum";

  if (preferWait && mode !== QUOTA_MODES.DAY_BLOCKED && mode !== QUOTA_MODES.WAIT_HOUR) {
    if (next.currentLane !== "WAIT") {
      next = recordLaneSwitch(next, next.currentLane, "WAIT", params.reason || "wait_minute", now);
    } else {
      next.currentLane = "WAIT";
      next.updatedAt = now.toISOString();
    }
    next.idleSafe = true;
    next.runtimeState = "WAITING_QUOTA_RESET";
    return next;
  }

  if (next.currentLane !== "B") {
    next = recordLaneSwitch(next, next.currentLane, "B", params.reason || "quota_floor", now);
  } else {
    next.currentLane = "B";
    next.updatedAt = now.toISOString();
  }
  return next;
}

function applyQuotaRecoveryTransition(state, params) {
  const now = params.now || new Date();
  let next = applyQuotaSnapshot(state, { ...params, wait: null });
  const decision = decideLane(next, {
    safeRequests: params.safeRequests,
    windows: params.windows || next.quota.windows,
    projectedUsefulAt: params.projectedUsefulAt,
    now,
    laneBHasWork: params.laneBHasWork,
  });
  next.quota.lastPlan = decision.plan || decision;
  if (decision.lane === "A" && next.currentLane !== "A") {
    next = recordLaneSwitch(next, next.currentLane, "A", decision.reason, now);
    next.quota.wait = null;
    next.idleSafe = false;
    next.runtimeState = "RUNNING";
    next.laneASelectedAt = now.toISOString();
    next.laneARunnerStartedAt = null;
    next.quota.bindingWindow = decision.bindingWindow || next.quota.bindingWindow;
    next.quota.bindingResetAt = decision.bindingResetAt ?? null;
    // Prevent immediate 5s reprobe before the batch runs.
    next.quota.nextCheckAt = nextQuotaCheckAfterActiveBatch(now, { deferMs: 15 * 60 * 1000 });
  } else if (decision.lane === "A") {
    next.idleSafe = false;
    next.runtimeState = "RUNNING";
    next.quota.wait = null;
    next.quota.bindingWindow = decision.bindingWindow || next.quota.bindingWindow;
    next.quota.bindingResetAt = decision.bindingResetAt ?? null;
    next.quota.nextCheckAt = nextQuotaCheckAfterActiveBatch(now, { deferMs: 15 * 60 * 1000 });
  } else if (decision.lane === "WAIT") {
    next = applyQuotaFloorTransition(next, {
      ...params,
      quotaMode: decision.quotaMode,
      reason: decision.reason,
      nextUsefulAt: decision.nextUsefulAt,
      bindingWindow: decision.bindingWindow,
      estimatedRequestsNeeded: decision.estimatedRequestsNeeded,
      now,
    });
  }
  return { state: next, decision };
}

function acquireLaneALock(state, workerId, now = new Date(), ttlMs = LANE_A_LOCK_TTL_MS) {
  const lock = state.laneA?.lock;
  if (lock && lock.until && new Date(lock.until).getTime() > now.getTime() && lock.workerId !== workerId) {
    return { ok: false, reason: "lane_a_already_running", state };
  }
  const next = cloneState(state);
  next.laneA.lock = {
    workerId,
    until: new Date(now.getTime() + ttlMs).toISOString(),
  };
  next.updatedAt = now.toISOString();
  return { ok: true, state: next };
}

function releaseLaneALock(state, workerId, now = new Date()) {
  const next = cloneState(state);
  if (next.laneA.lock && next.laneA.lock.workerId && next.laneA.lock.workerId !== workerId) {
    return { ok: false, reason: "lock_owned_by_other", state };
  }
  next.laneA.lock = null;
  next.updatedAt = now.toISOString();
  return { ok: true, state: next };
}

function recordLaneTime(state, lane, durationMs, extras = {}) {
  const next = cloneState(state);
  const ms = Math.max(0, Number(durationMs) || 0);
  if (lane === "A") next.metrics.laneAMs += ms;
  else if (lane === "B") next.metrics.laneBMs += ms;
  else next.metrics.idleMs += ms;
  if (extras.clAuthorities) next.metrics.clAuthorities += extras.clAuthorities;
  if (extras.nonClAuthorities) next.metrics.nonClAuthorities += extras.nonClAuthorities;
  if (extras.citationsResolved) next.metrics.citationsResolved += extras.citationsResolved;
  next.updatedAt = extras.now ? new Date(extras.now).toISOString() : next.updatedAt;
  return next;
}

function completeLaneBTask(state, task, checkpoint, now = new Date(), opts = {}) {
  const next = cloneState(state);
  const taskId = String(task || "");
  if (taskId && !next.laneB.tasksCompleted.includes(taskId)) next.laneB.tasksCompleted.push(taskId);
  next.laneB.checkpoint = checkpoint ?? next.laneB.checkpoint;
  next.laneB.checkpoints = next.laneB.checkpoints || {};
  next.laneB.lastByTask = next.laneB.lastByTask || {};
  next.laneB.nextEligibleAt = next.laneB.nextEligibleAt || {};
  if (taskId) next.laneB.lastByTask[taskId] = now.toISOString();
  if (checkpoint != null && taskId) {
    next.laneB.checkpoints[taskId] = checkpoint;
  }
  if (opts.checkpointKey && checkpoint != null) {
    next.laneB.checkpoints[opts.checkpointKey] = checkpoint;
  }
  if (opts.minimumIntervalMs && taskId) {
    next.laneB.nextEligibleAt[taskId] = new Date(now.getTime() + Number(opts.minimumIntervalMs)).toISOString();
  }
  if (opts.noDelta && taskId) {
    next.laneB.lastOutcome = next.laneB.lastOutcome || {};
    next.laneB.lastOutcome[taskId] = { at: now.toISOString(), result: "NO_DELTA" };
  }
  next.laneB.mutatingTaskActive = null;
  // Clear active task so the next wake cycle reevaluates the full registry.
  // Do not round-robin pin to a sibling task name.
  next.laneB.task = "NONE";
  next.idleSafe = true;
  next.runtimeState = "IDLE_SAFE";
  next.updatedAt = now.toISOString();
  return next;
}

/**
 * Apply registry selection result onto scheduler state (deterministic; no AI).
 * currentTask means the task actually executing now — idle clears to NONE.
 */
function applyLaneBSelection(state, selection, now = new Date()) {
  const next = cloneState(state);
  next.updatedAt = now.toISOString();
  next.laneB = next.laneB || {};
  next.laneB.lastEligibility = selection.evaluations || next.laneB.lastEligibility || null;
  if (selection.idleSafe || !selection.task || selection.executing === false) {
    next.idleSafe = true;
    next.currentLane = "B";
    next.laneB.task = "NONE";
    next.runtimeState = "IDLE_SAFE";
    return next;
  }
  next.idleSafe = false;
  next.currentLane = "B";
  next.laneB.task = selection.task.id || selection.currentTask;
  if (selection.task.mayMutate) {
    next.laneB.mutatingTaskActive = selection.task.id;
  } else {
    next.laneB.mutatingTaskActive = null;
  }
  next.runtimeState = "RUNNING";
  return next;
}

function isCourtListenerUrl(url) {
  if (url == null) return false;
  let parsed;
  try {
    parsed = new URL(String(url), "https://www.courtlistener.com");
  } catch {
    return /courtlistener\.com/i.test(String(url));
  }
  return CL_HOST_RE.test(parsed.hostname);
}

function isBlockedLaneBCourtListenerUrl(url) {
  if (!isCourtListenerUrl(url)) return false;
  try {
    const parsed = new URL(String(url), "https://www.courtlistener.com");
    return CL_BLOCKED_PATHS.some((p) => parsed.pathname === p || parsed.pathname.startsWith(`${p}/`));
  } catch {
    return true;
  }
}

function assertLaneBUrlAllowed(url) {
  if (isCourtListenerUrl(url)) {
    const err = new Error(`LANE_B_CL_BLOCKED: ${String(url)}`);
    err.code = "LANE_B_CL_BLOCKED";
    throw err;
  }
  return true;
}

/**
 * Patch fetch so accidental CL calls during Lane B fail locally.
 * Quota recheck must use a separate unguarded fetch, not this wrapper.
 */
function installLaneBFetchGuard(globalObj = globalThis) {
  const original = globalObj.fetch;
  if (typeof original !== "function") {
    throw new Error("fetch unavailable; cannot install Lane B guard");
  }
  if (original.__nyayaLaneBGuard) return original;
  const guarded = async function laneBGuardedFetch(input, init) {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
    assertLaneBUrlAllowed(url);
    return original.call(this, input, init);
  };
  guarded.__nyayaLaneBGuard = true;
  guarded.__nyayaLaneBOriginalFetch = original;
  globalObj.fetch = guarded;
  return guarded;
}

function uninstallLaneBFetchGuard(globalObj = globalThis) {
  const current = globalObj.fetch;
  if (current && current.__nyayaLaneBOriginalFetch) {
    globalObj.fetch = current.__nyayaLaneBOriginalFetch;
  }
}

function uniqueCitationEdgeKey(edge) {
  return [edge.fromAuthorityId, edge.normalizedCitation || edge.rawCitation, edge.pinpoint || ""]
    .join("|")
    .toLowerCase();
}

function uniqueEmbeddingKey(row) {
  return `${row.authorityId}:${row.chunkIndex}:${row.contentHash || sha256(row.content || "")}`;
}

function insertUnique(set, key) {
  if (set.has(key)) return { inserted: false, duplicate: true };
  set.add(key);
  return { inserted: true, duplicate: false };
}

function classifyDepth(params) {
  const deficit = Math.max(0, Number(params.authorityDeficitTo101) || 0);
  const mid = Number(params.intermediateAppellate) || 0;
  if (deficit >= 80 || (deficit >= 50 && mid === 0)) return "CRITICAL_DEPTH";
  if (deficit >= 40 || mid < 5) return "HIGH_DEPTH";
  if (deficit >= 15) return "MEDIUM_DEPTH";
  return "LOW_DEPTH";
}

function detectHistoricalHoles(params) {
  const years = (params.years || []).filter((y) => Number.isFinite(y)).map(Number);
  const nowYear = params.nowYear ?? new Date().getUTCFullYear();
  const flags = [];
  if (years.length === 0) {
    return { flags: [{ kind: "no_dated_cases" }], targetRanges: ["pre-2000", "1980-1999", "1960-1979", "pre-1960"] };
  }
  const newest = Math.max(...years);
  const oldest = Math.min(...years);
  const decades = new Set(years.map((y) => Math.floor(y / 10) * 10));
  if (years.every((y) => y >= nowYear - 1)) flags.push({ kind: "recent_only", label: `${nowYear}/recent concentration` });
  if (decades.size <= 1) flags.push({ kind: "one_decade", decade: [...decades][0] });
  const uniqueCourts = params.uniqueCourts ?? null;
  if (uniqueCourts != null && uniqueCourts <= 1) flags.push({ kind: "one_court" });

  const targetRanges = [];
  if (!years.some((y) => y < 2000)) targetRanges.push("pre-2000");
  if (!years.some((y) => y >= 1980 && y <= 1999)) targetRanges.push("1980-1999");
  if (!years.some((y) => y >= 1960 && y <= 1979)) targetRanges.push("1960-1979");
  if (!years.some((y) => y < 1960)) targetRanges.push("pre-1960");

  return { flags, targetRanges, oldest, newest, decadeCount: decades.size };
}

const US_REPORTS_RE = /\b(\d{1,3})\s+U\.\s*S\.\s+(\d{1,4})\b/;
const SCOTUS_S_CT_RE = /\b(\d{1,3})\s+S\.\s*Ct\.\s+(\d{1,4})\b/;
const SCOTUS_L_ED_RE = /\b(\d{1,3})\s+L\.\s*Ed\.(?:\s*2d)?\s+(\d{1,4})\b/;

function parseUsReportsCitation(raw) {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  const us = US_REPORTS_RE.exec(text);
  if (us) {
    return {
      citation: `${us[1]} U.S. ${us[2]}`,
      reporter: "U.S.",
      volume: Number(us[1]),
      page: Number(us[2]),
      family: "us_reports",
    };
  }
  const sct = SCOTUS_S_CT_RE.exec(text);
  if (sct) {
    return {
      citation: `${sct[1]} S. Ct. ${sct[2]}`,
      reporter: "S. Ct.",
      volume: Number(sct[1]),
      page: Number(sct[2]),
      family: "scotus_sct",
    };
  }
  const led = SCOTUS_L_ED_RE.exec(text);
  if (led) {
    return {
      citation: text,
      reporter: /2d/i.test(text) ? "L. Ed. 2d" : "L. Ed.",
      volume: Number(led[1]),
      page: Number(led[2]),
      family: "scotus_led",
    };
  }
  return null;
}

/**
 * Rank missing U.S. Reports / SCOTUS citations from local TARGET_ABSENT edges.
 * Does not fabricate case identities.
 */
function rankMissingUsReports(edges, presentCitations = []) {
  const present = new Set(
    presentCitations.map((c) => String(c).replace(/\s+/g, " ").trim().toLowerCase()),
  );
  const buckets = new Map();
  for (const edge of edges || []) {
    const parsed = parseUsReportsCitation(edge.normalizedCitation || edge.rawCitation);
    if (!parsed) continue;
    const key = parsed.citation.toLowerCase();
    if (!buckets.has(key)) {
      buckets.set(key, {
        citation: parsed.citation,
        volume: parsed.volume,
        page: parsed.page,
        reporter: parsed.reporter,
        family: parsed.family,
        inbound: 0,
        alreadyPresentUnderAlias: present.has(key),
        estimatedDecisionIdentity: null,
        suitablePublicNonClSource: parsed.family === "us_reports" ? "loc_us_reports_candidate" : "unknown_without_us_reports_parallel",
      });
    }
    buckets.get(key).inbound += Number(edge.inbound || 1);
  }
  return [...buckets.values()].sort((a, b) => b.inbound - a.inbound || a.volume - b.volume || a.page - b.page);
}

/**
 * Intermediate mapping: local evidence only. Never invent IDs.
 * Known-bad IDs stay MAPPING_INVALID unless new local evidence exists.
 */
function classifyIntermediateCandidate(params) {
  const invalidId = params.invalidCandidateId;
  const hypothesized = params.hypothesizedIds || [];
  const liveVerifyForbidden = true;
  if (!params.positiveLocalEvidence) {
    return {
      gapId: invalidId,
      classification: "UNRESOLVED",
      candidateClId: null,
      hypothesizedUnverifiedIds: hypothesized,
      liveVerifyForbidden,
      note: "No local evidence identifies a replacement CourtListener court id. Do not query CourtListener from Lane B.",
    };
  }
  return {
    gapId: invalidId,
    classification: "CANDIDATE_NEEDS_SINGLE_CL_VERIFY",
    candidateClId: params.positiveLocalEvidence.candidateClId,
    evidence: params.positiveLocalEvidence.evidence,
    liveVerifyForbidden,
  };
}

const KNOWN_INTERMEDIATE_GAPS = [
  {
    invalidCandidateId: "pacommwlth",
    courtName: "Commonwealth Court of Pennsylvania",
    hypothesizedIds: ["pacomm", "pa-comm"],
    positiveLocalEvidence: null,
  },
  {
    invalidCandidateId: "njsuperct",
    courtName: "Superior Court of New Jersey, Appellate Division",
    hypothesizedIds: ["njsuper"],
    positiveLocalEvidence: null,
  },
  {
    invalidCandidateId: "vacapp",
    courtName: "Court of Appeals of Virginia",
    hypothesizedIds: [],
    positiveLocalEvidence: null,
  },
];

function researchIntermediateGaps() {
  return KNOWN_INTERMEDIATE_GAPS.map((g) => classifyIntermediateCandidate(g));
}

function logLaneEvent(lane, payload) {
  const tag =
    lane === "A" ? "LANE_A_CL" : lane === "CHECK" ? "QUOTA_CHECK" : lane === "SWITCH" ? "LANE_SWITCH" : "LANE_B_OFFLINE";
  return { tag, at: new Date().toISOString(), ...payload };
}

module.exports = {
  QUEUE,
  USEFUL_CL_MIN,
  MIN_QUOTA_PROBE_GAP_MS,
  LANE_A_SEQUENCE,
  LANE_B_TASKS,
  LANE_B_REGISTRY_IDS,
  EST_CL_REQUESTS_PER_CASE,
  QUOTA_MODES,
  BINDING_WINDOWS,
  createInitialState,
  restoreState,
  cloneState,
  remainingRequestsToFinishCourt,
  remainingCasesToFinish,
  hasUsefulClCapacity,
  projectNextQuotaCheck,
  quotaProbeDue,
  decideLane,
  isActiveQuotaMode,
  ACTIVE_QUOTA_MODES,
  applyQuotaSnapshot,
  applyQuotaFloorTransition,
  applyQuotaRecoveryTransition,
  recordCourtBatchEfficiency,
  recordLaneSwitch,
  acquireLaneALock,
  releaseLaneALock,
  recordLaneTime,
  completeLaneBTask,
  applyLaneBSelection,
  isCourtListenerUrl,
  isBlockedLaneBCourtListenerUrl,
  assertLaneBUrlAllowed,
  installLaneBFetchGuard,
  uninstallLaneBFetchGuard,
  uniqueCitationEdgeKey,
  uniqueEmbeddingKey,
  insertUnique,
  classifyDepth,
  detectHistoricalHoles,
  parseUsReportsCitation,
  rankMissingUsReports,
  classifyIntermediateCandidate,
  researchIntermediateGaps,
  KNOWN_INTERMEDIATE_GAPS,
  logLaneEvent,
  sha256,
  persistLaneAProgress,
  applyDurableJobCheckpoint,
  validatePartialCheckpoint,
  reconcileLaneAFromJob,
  setHumanReview,
  isPartialLaneA,
  isReadyFirstStartLaneA,
  hasDurableCheckpoint,
  requiresDurableResumeCheckpoint,
  isMissingDurableResumeCheckpointFatal,
  HUMAN_REVIEW_REASONS,
};
