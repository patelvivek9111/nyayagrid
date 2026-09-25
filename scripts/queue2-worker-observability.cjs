/**
 * Queue #2 autonomous worker observability — pure helpers (no network).
 * Status / daily / events / human-review / heartbeat.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const STATUS_LANES = Object.freeze([
  "LANE_A_CL",
  "LANE_B_OFFLINE",
  "LANE_B_IDLE_SAFE",
  "QUOTA_CHECK",
  "HOLD",
  "WAITING_FOR_NETWORK",
  "HUMAN_REVIEW_REQUIRED",
]);

const RUNTIME_STATES = Object.freeze([
  "RUNNING",
  "IDLE_SAFE",
  "WAITING_FOR_NETWORK",
  "SUSPENDED_OR_OFFLINE",
  "STOPPED",
  "HUMAN_REVIEW_REQUIRED",
]);

const EVENT_TYPES = Object.freeze([
  "WORKER_START",
  "LOCK_ACQUIRED",
  "LANE_A_START",
  "LANE_A_BATCH_COMPLETE",
  "QUOTA_FLOOR",
  "LANE_B_START",
  "OFFLINE_TASK_COMPLETE",
  "LANE_B_IDLE_SAFE",
  "QUOTA_PROBE",
  "QUOTA_RECOVERED",
  "LANE_SWITCH",
  "CHECKPOINT",
  "MILESTONE",
  "SYSTEM_RESUME_DETECTED",
  "NETWORK_LOSS",
  "NETWORK_RECOVERED",
  "KILL_SWITCH_STOP",
  "CODE_CHANGE_DETECTED",
  "CLOCK_REVALIDATION",
  "BACKPRESSURE_PAUSE",
  "SELF_CHECK_BOUNDARY",
  "HUMAN_REVIEW_REQUIRED",
  "ERROR",
  "WORKER_STOP",
  "LOCK_RELEASED",
  "LOCK_RECOVERED",
  "HEARTBEAT",
]);

const HUMAN_REVIEW_REASONS = Object.freeze({
  MISSING_DURABLE_RESUME_CHECKPOINT: "MISSING_DURABLE_RESUME_CHECKPOINT",
  UNEXPECTED_429: "UNEXPECTED_429",
  CONTROLLER_BYPASS: "CONTROLLER_BYPASS",
  HIGH_REQUESTS_PER_AUTHORITY: "HIGH_REQUESTS_PER_AUTHORITY",
  RETRIEVAL_REGRESSION: "RETRIEVAL_REGRESSION",
  ORPHAN_CHUNKS: "ORPHAN_CHUNKS",
  DUPLICATE_SOURCE_IDS: "DUPLICATE_SOURCE_IDS",
  PARSER_GAP_SPIKE: "PARSER_GAP_SPIKE",
  CITATION_AMBIGUOUS_SPIKE: "CITATION_AMBIGUOUS_SPIKE",
  SOURCE_SCHEMA_CHANGED: "SOURCE_SCHEMA_CHANGED",
  MAPPING_FAILURE_REPEATED: "MAPPING_FAILURE_REPEATED",
  INTEGRITY_FAILURE: "INTEGRITY_FAILURE",
  STALE_HEARTBEAT: "STALE_HEARTBEAT",
  NO_PRODUCTIVE_LANE_B: "NO_PRODUCTIVE_LANE_B",
  NO_PRODUCTIVE_STRATEGY_REMAINS: "NO_PRODUCTIVE_STRATEGY_REMAINS",
  QUEUE_2_COMPLETION_CANDIDATE: "QUEUE_2_COMPLETION_CANDIDATE",
  QUEUE_TRANSITION_REQUESTED: "QUEUE_TRANSITION_REQUESTED",
  CONFLICTING_MUTATOR_REPEATED: "CONFLICTING_MUTATOR_REPEATED",
  LOCK_OWNERSHIP_INCONSISTENCY: "LOCK_OWNERSHIP_INCONSISTENCY",
  ACTIVE_PID_MISMATCHED_WORKER_ID: "ACTIVE_PID_MISMATCHED_WORKER_ID",
  CHECKPOINT_LOCK_DISAGREEMENT: "CHECKPOINT_LOCK_DISAGREEMENT",
  SCHEDULER_LOCK_CORRUPTION: "SCHEDULER_LOCK_CORRUPTION",
  REPEATED_NETWORK_FAILURE: "REPEATED_NETWORK_FAILURE",
  PROVIDER_TERMS_CHANGED: "PROVIDER_TERMS_CHANGED",
  EXTERNAL_SOURCE_LIMITATION_BLOCKS_SCOPE: "EXTERNAL_SOURCE_LIMITATION_BLOCKS_SCOPE",
  COURTLISTENER_QUOTA_STATE_AMBIGUOUS: "COURTLISTENER_QUOTA_STATE_AMBIGUOUS",
});

/** Local heartbeat cadence — zero AI usage. */
const HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000;
/** Operator stale signal; lock stale detection uses 45m in queue2-worker-lock.cjs. */
const STALE_HEARTBEAT_MS = 45 * 60 * 1000;
const REQ_PER_AUTH_THRESHOLD = 3.0;
const REQ_PER_AUTH_STREAK = 3;

/** Canonical production reports directory — never overwrite with fixture/stale totals. */
const CANONICAL_REPORTS_DIR = path.resolve(
  path.join(__dirname, "..", "packages", "research", "corpus", "reports"),
);
const CANONICAL_STATUS_FILENAME = "corpus-worker-status.json";
const CANONICAL_SNAPSHOT_FILENAME = "queue2-lane-a-corpus-snapshot.json";
const CANONICAL_MANIFEST_FILENAME = "queue2-lane-a-depth-manifest.json";

function isCanonicalReportsDir(reportsDir) {
  if (!reportsDir) return false;
  try {
    return path.resolve(reportsDir) === CANONICAL_REPORTS_DIR;
  } catch {
    return false;
  }
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function corpusMetricFloor(statusOrCorpus) {
  const c = statusOrCorpus?.corpus || statusOrCorpus || {};
  return {
    authorities: numOrNull(c.authorities) ?? 0,
    cases: numOrNull(c.cases) ?? 0,
    clCases: numOrNull(c.clCases ?? c.cl_cases) ?? 0,
    statutes: numOrNull(c.statutes),
    regulations: numOrNull(c.regulations ?? c.regs),
    rules: numOrNull(c.rules),
    authorityGateDeficit: numOrNull(c.authorityGateDeficit),
    manifestVersion: numOrNull(statusOrCorpus?.manifestVersion) ?? 0,
  };
}

/**
 * True when incoming corpus/manifest totals would regress below an existing floor.
 * Null/missing incoming metrics are treated as regression when existing > 0.
 */
function wouldRegressCorpusTotals(existingStatus, incomingStatus) {
  const a = corpusMetricFloor(existingStatus);
  const incomingCorpus = incomingStatus?.corpus || {};
  const bAuth = numOrNull(incomingCorpus.authorities);
  const bCases = numOrNull(incomingCorpus.cases);
  const bCl = numOrNull(incomingCorpus.clCases ?? incomingCorpus.cl_cases);
  const bMan = numOrNull(incomingStatus?.manifestVersion);
  if (a.authorities > 0 && (bAuth == null || bAuth < a.authorities)) return true;
  if (a.cases > 0 && (bCases == null || bCases < a.cases)) return true;
  if (a.clCases > 0 && (bCl == null || bCl < a.clCases)) return true;
  if (a.manifestVersion > 0 && (bMan == null || bMan < a.manifestVersion)) return true;
  return false;
}

function maxMetric(a, b) {
  const na = numOrNull(a);
  const nb = numOrNull(b);
  if (na == null) return nb;
  if (nb == null) return na;
  return Math.max(na, nb);
}

/**
 * Preserve monotonic corpus totals / manifestVersion when merging into canonical status.
 */
function protectCorpusTotalsFromRegression(existingStatus, incomingStatus) {
  if (!existingStatus || !incomingStatus) return incomingStatus;
  if (!wouldRegressCorpusTotals(existingStatus, incomingStatus)) return incomingStatus;
  const prev = existingStatus.corpus || {};
  const next = incomingStatus.corpus || {};
  return {
    ...incomingStatus,
    manifestVersion: maxMetric(existingStatus.manifestVersion, incomingStatus.manifestVersion),
    corpus: {
      authorities: maxMetric(prev.authorities, next.authorities),
      cases: maxMetric(prev.cases, next.cases),
      clCases: maxMetric(prev.clCases ?? prev.cl_cases, next.clCases ?? next.cl_cases),
      statutes: maxMetric(prev.statutes, next.statutes),
      regulations: maxMetric(prev.regulations ?? prev.regs, next.regulations ?? next.regs),
      rules: maxMetric(prev.rules, next.rules),
      authorityGateDeficit:
        numOrNull(next.authorityGateDeficit) != null
          ? next.authorityGateDeficit
          : prev.authorityGateDeficit ?? null,
    },
  };
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Resolve corpus totals for status writes.
 * Prefer live extras → prior status → lane-a snapshot. NEVER invent stale hardcoded totals.
 */
function resolveCorpusTotalsForStatus(params = {}) {
  const reportsDir = params.reportsDir || CANONICAL_REPORTS_DIR;
  const explicit = params.corpus || null;
  if (explicit && numOrNull(explicit.authorities) != null && numOrNull(explicit.cases) != null) {
    return {
      authorities: Number(explicit.authorities),
      cases: Number(explicit.cases),
      clCases: numOrNull(explicit.clCases ?? explicit.cl_cases),
      statutes: numOrNull(explicit.statutes),
      regulations: numOrNull(explicit.regulations ?? explicit.regs),
      rules: numOrNull(explicit.rules),
      authorityGateDeficit: numOrNull(explicit.authorityGateDeficit),
      source: "explicit",
    };
  }

  const prior = readJsonIfExists(path.join(reportsDir, CANONICAL_STATUS_FILENAME));
  if (prior?.corpus && numOrNull(prior.corpus.authorities) != null) {
    return {
      authorities: Number(prior.corpus.authorities),
      cases: Number(prior.corpus.cases),
      clCases: numOrNull(prior.corpus.clCases ?? prior.corpus.cl_cases),
      statutes: numOrNull(prior.corpus.statutes),
      regulations: numOrNull(prior.corpus.regulations),
      rules: numOrNull(prior.corpus.rules),
      authorityGateDeficit: numOrNull(prior.corpus.authorityGateDeficit),
      source: "prior_status",
      manifestVersion: numOrNull(prior.manifestVersion),
    };
  }

  const snapshot = readJsonIfExists(path.join(reportsDir, CANONICAL_SNAPSHOT_FILENAME));
  const snapCorpus = snapshot?.corpus;
  if (snapCorpus && numOrNull(snapCorpus.authorities) != null) {
    return {
      authorities: Number(snapCorpus.authorities),
      cases: Number(snapCorpus.cases),
      clCases: numOrNull(snapCorpus.cl_cases ?? snapCorpus.clCases),
      statutes: numOrNull(snapCorpus.statutes),
      regulations: numOrNull(snapCorpus.regulations),
      rules: numOrNull(snapCorpus.rules),
      authorityGateDeficit: numOrNull(params.authorityGateDeficit),
      source: "lane_a_snapshot",
    };
  }

  return {
    authorities: null,
    cases: null,
    clCases: null,
    statutes: null,
    regulations: null,
    rules: null,
    authorityGateDeficit: null,
    source: "unavailable",
  };
}

function resolveManifestVersionForStatus(params = {}) {
  const reportsDir = params.reportsDir || CANONICAL_REPORTS_DIR;
  const candidates = [
    numOrNull(params.manifestVersion),
    numOrNull(params.state?.laneA?.manifestVersion),
    numOrNull(params.state?.depthManifestVersion),
  ];
  const manifest = readJsonIfExists(path.join(reportsDir, CANONICAL_MANIFEST_FILENAME));
  if (manifest) candidates.push(numOrNull(manifest.version));
  const prior = readJsonIfExists(path.join(reportsDir, CANONICAL_STATUS_FILENAME));
  if (prior) candidates.push(numOrNull(prior.manifestVersion));
  const nums = candidates.filter((n) => n != null && n >= 0);
  return nums.length ? Math.max(...nums) : null;
}

function formatEt(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return String(isoOrDate || "");
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(d);
}

function statusLaneFromState(state) {
  if (state?.humanReview?.required) return "HUMAN_REVIEW_REQUIRED";
  if (state?.hold) return "HOLD";
  if (state?.waitingForNetwork) return "WAITING_FOR_NETWORK";
  if (state?.currentLane === "WAIT" || state?.runtimeState === "WAITING_QUOTA_RESET") {
    return "WAIT_QUOTA_RESET";
  }
  if (state?.idleSafe || state?.currentLane === "IDLE_SAFE") return "LANE_B_IDLE_SAFE";
  if (state?.currentLane === "A") return "LANE_A_CL";
  if (state?.currentLane === "B") return "LANE_B_OFFLINE";
  return "LANE_B_OFFLINE";
}

/**
 * Active/partial CL court requires a durable resume position.
 * Partial = count > 0 && count < target (or job status quota_paused/rate_limited/paused with unfinished target).
 */
function isPartialLaneA(laneA) {
  if (!laneA) return false;
  const count = Number(laneA.count) || 0;
  const target = Number(laneA.target) || 0;
  if (target <= 0) return false;
  if (count > 0 && count < target) return true;
  const status = String(laneA.jobStatus || "");
  if (["quota_paused", "rate_limited", "paused"].includes(status) && count < target) return true;
  return false;
}

function hasDurableCheckpoint(laneA) {
  if (!laneA) return false;
  const cp = laneA.checkpoint || laneA.lastSuccessfulExternalId || laneA.cursor;
  return typeof cp === "string" && cp.trim().length > 0;
}

/**
 * Validate scheduler Lane A partial safety. Never invent a checkpoint.
 * @returns {{ ok: boolean, humanReviewRequired: boolean, reason: string|null, laneA: object }}
 */
function validatePartialCheckpoint(laneA) {
  const next = { ...(laneA || {}) };
  if (!isPartialLaneA(next)) {
    return { ok: true, humanReviewRequired: false, reason: null, laneA: next };
  }
  if (hasDurableCheckpoint(next)) {
    // Prefer lastSuccessfulExternalId as canonical checkpoint identity when present.
    if (!next.checkpoint && next.lastSuccessfulExternalId) {
      next.checkpoint = next.lastSuccessfulExternalId;
    }
    return { ok: true, humanReviewRequired: false, reason: null, laneA: next };
  }
  return {
    ok: false,
    humanReviewRequired: true,
    reason: HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT,
    laneA: next,
  };
}

/**
 * Apply a proven durable job row into scheduler laneA. Refuses to invent fields.
 */
function reconcileLaneAFromJob(laneA, job, extras = {}) {
  const next = { ...(laneA || {}) };
  if (!job || typeof job !== "object") {
    return { state: next, reconciled: false, reason: "no_job_row" };
  }
  const lastId = job.last_successful_external_id || job.lastSuccessfulExternalId || null;
  const cursor = job.cursor || null;
  const checkpoint = lastId || cursor;
  if (!checkpoint) {
    return { state: next, reconciled: false, reason: "job_missing_checkpoint" };
  }
  next.court = job.cl_court || job.clCourt || next.court;
  next.runner = extras.runner || next.runner || "staging-cl-batch-job";
  next.checkpoint = checkpoint;
  next.cursor = cursor;
  next.lastSuccessfulExternalId = lastId;
  next.nextPageUrl = job.next_page_url || job.nextPageUrl || next.nextPageUrl || null;
  next.lastSuccessfulAt = job.updated_at
    ? new Date(job.updated_at).toISOString()
    : next.lastSuccessfulAt || null;
  next.jobStatus = job.status || next.jobStatus || null;
  if (job.items_imported != null) next.itemsImported = Number(job.items_imported);
  if (job.target_max != null) next.target = Number(job.target_max) || next.target;
  if (extras.count != null) next.count = Number(extras.count);
  if (extras.jurisdiction) next.jurisdiction = extras.jurisdiction;
  if (extras.mappingStatus) next.mappingStatus = extras.mappingStatus;
  if (extras.manifestVersion != null) next.manifestVersion = extras.manifestVersion;
  return { state: next, reconciled: true, reason: null };
}

function setHumanReview(state, reason, detail = null) {
  const next = JSON.parse(JSON.stringify(state));
  next.humanReview = next.humanReview || { required: false, reasons: [], details: [] };
  next.humanReview.required = true;
  if (reason && !next.humanReview.reasons.includes(reason)) {
    next.humanReview.reasons.push(reason);
  }
  if (detail) next.humanReview.details.push({ reason, detail, at: new Date().toISOString() });
  next.updatedAt = new Date().toISOString();
  return next;
}

/**
 * Evaluate operational signals for human review. Routine quota floors are ignored.
 */
function evaluateHumanReviewTriggers(signals = {}) {
  const reasons = [];
  if (signals.missingDurableCheckpoint) reasons.push(HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT);
  if (signals.unexpected429) reasons.push(HUMAN_REVIEW_REASONS.UNEXPECTED_429);
  if (signals.controllerBypass) reasons.push(HUMAN_REVIEW_REASONS.CONTROLLER_BYPASS);
  if (
    Array.isArray(signals.reqPerAuthBatches) &&
    signals.reqPerAuthBatches.length >= REQ_PER_AUTH_STREAK &&
    signals.reqPerAuthBatches.slice(-REQ_PER_AUTH_STREAK).every((r) => Number(r) > REQ_PER_AUTH_THRESHOLD)
  ) {
    reasons.push(HUMAN_REVIEW_REASONS.HIGH_REQUESTS_PER_AUTHORITY);
  }
  if (signals.retrievalRegression) reasons.push(HUMAN_REVIEW_REASONS.RETRIEVAL_REGRESSION);
  if (Number(signals.orphanCount) > 0) reasons.push(HUMAN_REVIEW_REASONS.ORPHAN_CHUNKS);
  if (Number(signals.duplicateSourceIdCount) > 0 && signals.duplicateSourceIdsIntroduced) {
    reasons.push(HUMAN_REVIEW_REASONS.DUPLICATE_SOURCE_IDS);
  }
  if (Number(signals.parserGap) > 0 && signals.parserGapMaterial) {
    reasons.push(HUMAN_REVIEW_REASONS.PARSER_GAP_SPIKE);
  }
  if (signals.citationAmbiguousSpike) reasons.push(HUMAN_REVIEW_REASONS.CITATION_AMBIGUOUS_SPIKE);
  if (signals.sourceSchemaChanged) reasons.push(HUMAN_REVIEW_REASONS.SOURCE_SCHEMA_CHANGED);
  if (signals.repeatedMappingFailure) reasons.push(HUMAN_REVIEW_REASONS.MAPPING_FAILURE_REPEATED);
  if (signals.integrityFailure) reasons.push(HUMAN_REVIEW_REASONS.INTEGRITY_FAILURE);
  if (signals.staleHeartbeat) reasons.push(HUMAN_REVIEW_REASONS.STALE_HEARTBEAT);
  if (signals.noProductiveLaneB) reasons.push(HUMAN_REVIEW_REASONS.NO_PRODUCTIVE_LANE_B);
  if (signals.queue2CompletionCandidate) reasons.push(HUMAN_REVIEW_REASONS.QUEUE_2_COMPLETION_CANDIDATE);
  if (signals.queueTransitionRequested) reasons.push(HUMAN_REVIEW_REASONS.QUEUE_TRANSITION_REQUESTED);
  if (signals.conflictingMutatorRepeated) reasons.push(HUMAN_REVIEW_REASONS.CONFLICTING_MUTATOR_REPEATED);
  if (signals.lockOwnershipInconsistency) reasons.push(HUMAN_REVIEW_REASONS.LOCK_OWNERSHIP_INCONSISTENCY);
  if (signals.activePidMismatchedWorkerId) reasons.push(HUMAN_REVIEW_REASONS.ACTIVE_PID_MISMATCHED_WORKER_ID);
  if (signals.checkpointLockDisagreement) reasons.push(HUMAN_REVIEW_REASONS.CHECKPOINT_LOCK_DISAGREEMENT);
  if (signals.schedulerLockCorruption) reasons.push(HUMAN_REVIEW_REASONS.SCHEDULER_LOCK_CORRUPTION);
  if (signals.noProductiveStrategyRemains) reasons.push(HUMAN_REVIEW_REASONS.NO_PRODUCTIVE_STRATEGY_REMAINS);
  if (signals.repeatedNetworkFailure) reasons.push(HUMAN_REVIEW_REASONS.REPEATED_NETWORK_FAILURE);
  if (signals.providerTermsChanged) reasons.push(HUMAN_REVIEW_REASONS.PROVIDER_TERMS_CHANGED);
  if (signals.externalSourceLimitationBlocksScope) {
    reasons.push(HUMAN_REVIEW_REASONS.EXTERNAL_SOURCE_LIMITATION_BLOCKS_SCOPE);
  }
  return { required: reasons.length > 0, reasons };
}

function isHeartbeatStale(lastHeartbeatAt, now = new Date(), thresholdMs = STALE_HEARTBEAT_MS) {
  if (!lastHeartbeatAt) return true;
  const t = new Date(lastHeartbeatAt).getTime();
  if (Number.isNaN(t)) return true;
  return now.getTime() - t > thresholdMs;
}

function buildOperatorStatus(params = {}) {
  const state = params.state || {};
  const laneA = state.laneA || {};
  const quota = state.quota || {};
  const windows = quota.windows || {};
  const today = params.today || {};
  const corpus = params.corpus || {};
  const health = params.health || {};
  const review = state.humanReview || { required: false, reasons: [] };
  const currentLane = params.currentLane || statusLaneFromState(state);
  const nowIso = (params.now || new Date()).toISOString();

  return {
    schemaVersion: 1,
    queue: "#2",
    queue9: "CLOSED",
    queue3: "NOT_OPEN",
    featureAgents: "0",
    currentLane,
    runtimeState: params.runtimeState || "STOPPED",
    freshness: params.freshness || null,
    currentTask: params.currentTask || state.laneB?.task || (currentLane === "LANE_A_CL" ? "cl_ingest" : null),
    currentCourt: laneA.court || null,
    currentJurisdiction: laneA.jurisdiction || null,
    currentCount: laneA.count ?? null,
    targetCount: laneA.target ?? null,
    checkpoint: laneA.checkpoint || laneA.lastSuccessfulExternalId || laneA.cursor || null,
    cursor: laneA.cursor || null,
    lastSuccessfulExternalId: laneA.lastSuccessfulExternalId || null,
    nextPageUrl: laneA.nextPageUrl || null,
    lastSuccessfulAt: laneA.lastSuccessfulAt || null,
    runner: laneA.runner || "staging-cl-batch-job",
    mappingStatus: laneA.mappingStatus || null,
    manifestVersion:
      params.manifestVersion != null
        ? params.manifestVersion
        : laneA.manifestVersion ?? state.depthManifestVersion ?? null,
    jobStatus: laneA.jobStatus || null,
    laneStartedAt: params.laneStartedAt || state.laneStartedAt || null,
    lastUpdatedAt: nowIso,
    lastHeartbeatAt: params.lastHeartbeatAt || state.lastHeartbeatAt || null,
    nextQuotaCheckAt: quota.nextCheckAt || null,
    network: {
      waitingForNetwork: Boolean(state.waitingForNetwork || params.waitingForNetwork),
      lastOnlineAt: params.lastOnlineAt || state.lastOnlineAt || null,
    },
    tokens: {
      routineAiCalls: Number(params.aiCalls ?? state.metrics?.aiCalls ?? 0),
      routineAiTokens: Number(params.aiTokens ?? state.metrics?.aiTokens ?? 0),
    },
    quota: {
      minuteRemaining: windows.minute?.remaining ?? null,
      hourRemaining: windows.hour?.remaining ?? null,
      dayRemaining: windows.day?.remaining ?? null,
      safeRequests: quota.lastSafeRequests ?? 0,
      lastProbeAt: quota.lastProbeAt || null,
      hard429Count: Number(quota.hard429Count || 0),
      dayResetAt: windows.day?.resetAt || null,
      quotaStateObservedAt: quota.quotaStateObservedAt || quota.lastProbeAt || null,
      quotaStateSource: quota.quotaStateSource || null,
      quotaStateConfidence: quota.quotaStateConfidence || null,
      quotaStateAgeMs:
        quota.quotaStateAgeMs != null
          ? Number(quota.quotaStateAgeMs)
          : quota.quotaStateObservedAt || quota.lastProbeAt
            ? Math.max(0, Date.now() - new Date(quota.quotaStateObservedAt || quota.lastProbeAt).getTime())
            : null,
    },
    today: {
      clRequests: Number(today.clRequests || 0),
      clAuthoritiesAdded: Number(today.clAuthoritiesAdded || state.metrics?.clAuthorities || 0),
      nonClAuthoritiesAdded: Number(today.nonClAuthoritiesAdded || state.metrics?.nonClAuthorities || 0),
      totalAuthoritiesAdded: Number(
        today.totalAuthoritiesAdded ??
          Number(today.clAuthoritiesAdded || state.metrics?.clAuthorities || 0) +
            Number(today.nonClAuthoritiesAdded || state.metrics?.nonClAuthorities || 0),
      ),
      casesAdded: Number(today.casesAdded || 0),
      citationEdgesResolved: Number(today.citationEdgesResolved || state.metrics?.citationsResolved || 0),
      jurisdictionsProcessed: Number(today.jurisdictionsProcessed || 0),
      laneASeconds: Math.round(Number(today.laneASeconds ?? (state.metrics?.laneAMs || 0) / 1000)),
      laneBSeconds: Math.round(Number(today.laneBSeconds ?? (state.metrics?.laneBMs || 0) / 1000)),
      idleSeconds: Math.round(Number(today.idleSeconds ?? (state.metrics?.idleMs || 0) / 1000)),
      idleSafeSeconds: Math.round(Number(today.idleSafeSeconds ?? (state.metrics?.idleSafeMs || 0) / 1000)),
      waitingNetworkSeconds: Math.round(
        Number(today.waitingNetworkSeconds ?? (state.metrics?.waitingNetworkMs || 0) / 1000),
      ),
    },
    corpus: {
      authorities: corpus.authorities ?? null,
      cases: corpus.cases ?? null,
      clCases: corpus.clCases ?? corpus.cl_cases ?? null,
      statutes: corpus.statutes ?? null,
      regulations: corpus.regulations ?? corpus.regs ?? null,
      rules: corpus.rules ?? null,
      authorityGateDeficit: corpus.authorityGateDeficit ?? null,
    },
    health: {
      retrieval: health.retrieval ?? "unknown",
      orphanCount: Number(health.orphanCount ?? 0),
      duplicateSourceIdCount: Number(health.duplicateSourceIdCount ?? 0),
      database: health.database ?? "unknown",
      featureAgents: String(health.featureAgents ?? "0"),
    },
    review: {
      humanReviewRequired: Boolean(review.required),
      reviewReasons: Array.isArray(review.reasons) ? review.reasons : [],
    },
  };
}

function renderDailyMarkdown(status, extras = {}) {
  const s = status || {};
  const q = s.quota || {};
  const t = s.today || {};
  const c = s.corpus || {};
  const h = s.health || {};
  const r = s.review || {};
  const reason = extras.laneReason || (s.currentLane === "LANE_B_OFFLINE" ? "CourtListener day safety floor" : "");
  const nextAction =
    extras.nextAction ||
    (r.humanReviewRequired
      ? "Stop unsafe path; await human review."
      : s.currentLane === "LANE_B_OFFLINE"
        ? `Automatically resume ${s.currentCourt || "Lane A"} when safeRequests meets useful-capacity threshold.`
        : `Continue ${s.currentCourt || "Lane A"} to ${s.targetCount}.`);

  return [
    `# Queue #2 Corpus Worker — Daily Status`,
    ``,
    `Generated: ${s.lastUpdatedAt || ""} (${formatEt(s.lastUpdatedAt || new Date())})`,
    `Queue: #2 OPEN | #9 CLOSED | #3 NOT OPEN | FEATURE_AGENTS=${h.featureAgents || "0"}`,
    ``,
    `## CURRENT LANE`,
    `${s.currentLane || "UNKNOWN"}`,
    reason ? `Reason: ${reason}` : "",
    ``,
    `## CURRENT TASK`,
    `${s.currentTask || "n/a"}`,
    s.currentCourt
      ? `${String(s.currentCourt).toUpperCase()} ${s.currentCount ?? "?"}/${s.targetCount ?? "?"} (${s.currentJurisdiction || "?"})`
      : "",
    s.checkpoint ? `checkpoint: ${s.checkpoint}` : "checkpoint: (none)",
    ``,
    `## TODAY'S PROGRESS`,
    `+${t.clAuthoritiesAdded || 0} CL authorities`,
    `+${t.nonClAuthoritiesAdded || 0} non-CL authorities`,
    `+${t.citationEdgesResolved || 0} citation edges resolved`,
    `total authorities added: ${t.totalAuthoritiesAdded || (t.clAuthoritiesAdded || 0) + (t.nonClAuthoritiesAdded || 0)}`,
    `laneA ${t.laneASeconds || 0}s | laneB ${t.laneBSeconds || 0}s | idle ${t.idleSeconds || 0}s`,
    ``,
    `## COURTLISTENER`,
    `${s.currentCourt || "n/a"} ${s.currentCount ?? "?"}/${s.targetCount ?? "?"}`,
    `checkpoint: ${s.checkpoint || "(missing)"}`,
    `lastSuccessfulExternalId: ${s.lastSuccessfulExternalId || "n/a"}`,
    `cursor: ${s.cursor || "n/a"}`,
    `mapping: ${s.mappingStatus || "n/a"} | runner: ${s.runner || "n/a"}`,
    `safeRequests: ${q.safeRequests ?? 0}`,
    `dayRem: ${q.dayRemaining ?? "?"} | hourRem: ${q.hourRemaining ?? "?"} | minuteRem: ${q.minuteRemaining ?? "?"}`,
    `next quota probe: ${s.nextQuotaCheckAt || "n/a"}${s.nextQuotaCheckAt ? ` (${formatEt(s.nextQuotaCheckAt)})` : ""}`,
    `dayResetAt: ${q.dayResetAt || "n/a"}${q.dayResetAt ? ` (${formatEt(q.dayResetAt)})` : ""}`,
    `quotaConfidence: ${q.quotaStateConfidence || "n/a"} source=${q.quotaStateSource || "n/a"}`,
    `429: ${q.hard429Count ?? 0}`,
    ``,
    `## OFFLINE WORK`,
    extras.offlineSummary || `Lane B tasks active when CL floor blocks useful ingest. CL HTTP during Lane B must be 0.`,
    ``,
    `## CORPUS / DEPTH`,
    `authorities=${c.authorities ?? "?"} cases=${c.cases ?? "?"} clCases=${c.clCases ?? "?"} statutes=${c.statutes ?? "?"} regs=${c.regulations ?? "?"} rules=${c.rules ?? "?"}`,
    `authorityGateDeficit=${c.authorityGateDeficit ?? "?"}`,
    ``,
    `## CITATION GRAPH`,
    extras.citationSummary || `citationEdgesResolved today: ${t.citationEdgesResolved || 0}`,
    ``,
    `## HEALTH`,
    `database=${h.database || "?"} orphans=${h.orphanCount ?? 0} duplicateSourceIds=${h.duplicateSourceIdCount ?? 0} retrieval=${h.retrieval || "?"} FEATURE_AGENTS=${h.featureAgents || "0"}`,
    ``,
    `## NEXT ACTION`,
    nextAction,
    ``,
    `## HUMAN REVIEW`,
    r.humanReviewRequired
      ? `REQUIRED: ${(r.reviewReasons || []).join(", ") || "unspecified"}`
      : `not required`,
    ``,
  ]
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n");
}

function makeEvent(type, fields = {}) {
  if (!EVENT_TYPES.includes(type)) {
    throw new Error(`unknown_event_type:${type}`);
  }
  const event = {
    timestamp: fields.timestamp || new Date().toISOString(),
    type,
    lane: fields.lane || null,
    task: fields.task || null,
    court: fields.court || null,
    checkpoint: fields.checkpoint || null,
    reason: fields.reason || null,
  };
  if (fields.quota) event.quota = fields.quota;
  if (fields.corpusDelta) event.corpusDelta = fields.corpusDelta;
  if (fields.extra && typeof fields.extra === "object") {
    for (const [k, v] of Object.entries(fields.extra)) {
      if (["token", "apiKey", "authorization", "password", "secret"].includes(k)) continue;
      event[k] = v;
    }
  }
  return event;
}

function appendEventLine(filePath, event) {
  const line = JSON.stringify(event);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${line}\n`, "utf8");
  return line;
}

function formatHeartbeat(status, now = new Date()) {
  const s = status || {};
  const t = s.today || {};
  const q = s.quota || {};
  const stamp = `[${formatEt(now)}]`;
  if (s.currentLane === "LANE_A_CL") {
    return `${stamp} LANE_A_CL | ${String(s.currentCourt || "?").toUpperCase()} ${s.currentCount ?? "?"}/${s.targetCount ?? "?"} | checkpoint=${s.checkpoint || "none"} | dayRem=${q.dayRemaining ?? "?"} | safe=${q.safeRequests ?? 0}`;
  }
  if (s.currentLane === "HUMAN_REVIEW_REQUIRED" || s.runtimeState === "HUMAN_REVIEW_REQUIRED") {
    return `${stamp} HUMAN_REVIEW_REQUIRED | ${(s.review?.reviewReasons || []).join(",") || "see status"} | court=${s.currentCourt || "n/a"}`;
  }
  if (s.currentLane === "LANE_B_IDLE_SAFE" || s.runtimeState === "IDLE_SAFE") {
    const next = s.nextQuotaCheckAt || q.dayResetAt;
    return `${stamp} LANE_B_IDLE_SAFE | task=NONE | nextProbe ${next ? formatEt(next) : "n/a"} | aiCalls=${s.tokens?.routineAiCalls ?? 0}`;
  }
  if (s.runtimeState === "WAITING_FOR_NETWORK" || s.currentLane === "WAITING_FOR_NETWORK") {
    return `${stamp} WAITING_FOR_NETWORK | local heartbeat continues | checkpoint=${s.checkpoint || "none"}`;
  }
  const next = s.nextQuotaCheckAt || q.dayResetAt;
  return `${stamp} LANE_B_OFFLINE | ${s.currentTask || "offline"} | today +${(t.clAuthoritiesAdded || 0) + (t.nonClAuthoritiesAdded || 0)} auth | citations +${t.citationEdgesResolved || 0} | CL paused | nextProbe ${next ? formatEt(next) : "n/a"}`;
}

function shouldEmitHeartbeat(lastHeartbeatAt, now = new Date(), intervalMs = HEARTBEAT_INTERVAL_MS) {
  if (!lastHeartbeatAt) return true;
  const t = new Date(lastHeartbeatAt).getTime();
  if (Number.isNaN(t)) return true;
  return now.getTime() - t >= intervalMs;
}

/**
 * Persist operator artifacts. Local continuous write; caller decides git push cadence.
 *
 * Anti-regression: when writing into the canonical production reports dir (or when
 * opts.protectCorpusTotals is true), corpus totals + manifestVersion never decrease
 * solely because a heartbeat/debug/test path omitted live corpus.
 * Tests MUST pass a temp reportsDir — never the canonical path.
 */
function writeObservabilityArtifacts(reportsDir, status, opts = {}) {
  fs.mkdirSync(reportsDir, { recursive: true });
  const statusPath = path.join(reportsDir, "corpus-worker-status.json");
  const dailyPath = path.join(reportsDir, "corpus-worker-daily.md");
  const eventsPath = path.join(reportsDir, "corpus-worker-events.jsonl");

  const protect =
    opts.protectCorpusTotals === true ||
    (opts.protectCorpusTotals !== false && isCanonicalReportsDir(reportsDir));

  let toWrite = status;
  if (protect && fs.existsSync(statusPath)) {
    const existing = readJsonIfExists(statusPath);
    if (existing && wouldRegressCorpusTotals(existing, status)) {
      toWrite = protectCorpusTotalsFromRegression(existing, status);
      toWrite = {
        ...toWrite,
        _corpusProtection: {
          applied: true,
          reason: "refused_stale_or_fixture_regression",
          prior: {
            authorities: existing.corpus?.authorities,
            cases: existing.corpus?.cases,
            clCases: existing.corpus?.clCases,
            manifestVersion: existing.manifestVersion,
          },
        },
      };
    }
  }

  // Strip internal marker before persist (keep evidence in return value only).
  const { _corpusProtection, ...persisted } = toWrite;
  fs.writeFileSync(statusPath, JSON.stringify(persisted, null, 2));
  fs.writeFileSync(dailyPath, renderDailyMarkdown(persisted, opts.dailyExtras || {}));
  if (opts.event) appendEventLine(eventsPath, opts.event);
  return {
    statusPath,
    dailyPath,
    eventsPath,
    status: persisted,
    corpusProtectionApplied: Boolean(_corpusProtection?.applied),
    corpusProtection: _corpusProtection || null,
  };
}

module.exports = {
  STATUS_LANES,
  RUNTIME_STATES,
  EVENT_TYPES,
  HUMAN_REVIEW_REASONS,
  HEARTBEAT_INTERVAL_MS,
  STALE_HEARTBEAT_MS,
  REQ_PER_AUTH_THRESHOLD,
  REQ_PER_AUTH_STREAK,
  CANONICAL_REPORTS_DIR,
  CANONICAL_STATUS_FILENAME,
  formatEt,
  statusLaneFromState,
  isPartialLaneA,
  hasDurableCheckpoint,
  validatePartialCheckpoint,
  reconcileLaneAFromJob,
  setHumanReview,
  evaluateHumanReviewTriggers,
  isHeartbeatStale,
  buildOperatorStatus,
  renderDailyMarkdown,
  makeEvent,
  appendEventLine,
  formatHeartbeat,
  shouldEmitHeartbeat,
  writeObservabilityArtifacts,
  isCanonicalReportsDir,
  wouldRegressCorpusTotals,
  protectCorpusTotalsFromRegression,
  resolveCorpusTotalsForStatus,
  resolveManifestVersionForStatus,
  corpusMetricFloor,
};
