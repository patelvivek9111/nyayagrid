/**
 * Queue #2 Lane A child-process lifecycle — pure helpers, zero network, zero AI.
 *
 * STARTED/RUNNING are NON-TERMINAL. Never classify zero-progress / canary /
 * count-failure from a non-terminal runner result.
 */
"use strict";

const {
  MAX_TOTAL_CL_REQUESTS_BEFORE_FIRST_PROGRESS,
} = require("./queue2-cl-quota-conservation.cjs");

const LANE_A_RUNNER_STATES = Object.freeze({
  STARTED: "STARTED",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  QUOTA_PAUSED: "QUOTA_PAUSED",
  FAILED: "FAILED",
  STALE_RUNNING_GUARD: "STALE_RUNNING_GUARD",
  ALREADY_COMPLETED: "ALREADY_COMPLETED",
  TIMEOUT: "TIMEOUT",
  UNKNOWN: "UNKNOWN",
});

const TERMINAL_STATES = new Set([
  LANE_A_RUNNER_STATES.COMPLETED,
  LANE_A_RUNNER_STATES.QUOTA_PAUSED,
  LANE_A_RUNNER_STATES.FAILED,
  LANE_A_RUNNER_STATES.STALE_RUNNING_GUARD,
  LANE_A_RUNNER_STATES.ALREADY_COMPLETED,
  LANE_A_RUNNER_STATES.TIMEOUT,
]);

const NON_TERMINAL_STATES = new Set([
  LANE_A_RUNNER_STATES.STARTED,
  LANE_A_RUNNER_STATES.RUNNING,
]);

/** Canary stabilization hard cap (current-session CL requests). */
const CANARY_MAX_SESSION_CL_REQUESTS = MAX_TOTAL_CL_REQUESTS_BEFORE_FIRST_PROGRESS;

function createEmptySessionQuota() {
  return {
    sessionClRequests: 0,
    productiveClRequests: 0,
    overheadClRequests: 0,
    quotaProbeRequests: 0,
    retryRequests: 0,
    wastedClRequests: 0,
    historicalJobApiCallsBaseline: null,
    existingJobHistoricalRequests: 0,
    rollingDayObservedUsed: null,
    rollingDayRemaining: null,
    quotaProbeReuseCount: 0,
    redundantQuotaProbesPrevented: 0,
  };
}

/**
 * Map raw runner JSON / fileResult into a formal lifecycle state.
 */
function mapRunnerResultToLifecycleState(result = {}) {
  if (!result || typeof result !== "object") return LANE_A_RUNNER_STATES.UNKNOWN;
  if (result.reason === "stale_running_guard") return LANE_A_RUNNER_STATES.STALE_RUNNING_GUARD;
  if (result.reason === "already_completed") return LANE_A_RUNNER_STATES.ALREADY_COMPLETED;
  if (result.started === true && !result.status && !result.fileResult) {
    return LANE_A_RUNNER_STATES.STARTED;
  }
  if (result.running === true || result.status === "running" || result.status === "starting") {
    return LANE_A_RUNNER_STATES.RUNNING;
  }
  const status = String(result.status || "").toLowerCase();
  if (status === "completed") return LANE_A_RUNNER_STATES.COMPLETED;
  if (status === "quota_paused" || status === "rate_limited") return LANE_A_RUNNER_STATES.QUOTA_PAUSED;
  if (status === "failed" || result.ok === false && result.reason && result.reason !== "stale_running_guard") {
    return LANE_A_RUNNER_STATES.FAILED;
  }
  if (result.timedOut === true || result.reason === "poll_timeout" || status === "timeout") {
    return LANE_A_RUNNER_STATES.TIMEOUT;
  }
  if (result.pid && (result.started === true || result.ok === true) && !status) {
    return LANE_A_RUNNER_STATES.STARTED;
  }
  if (status) {
    // Known terminal-ish statuses from batch job
    if (["paused", "transient_retry"].includes(status)) return LANE_A_RUNNER_STATES.QUOTA_PAUSED;
  }
  return LANE_A_RUNNER_STATES.UNKNOWN;
}

function isTerminalRunnerState(state) {
  return TERMINAL_STATES.has(state);
}

function isNonTerminalRunnerState(state) {
  return NON_TERMINAL_STATES.has(state);
}

/**
 * Prefer terminal fileResult over intermediate started/poll lines.
 */
function parseLaneARunnerStdoutPreferTerminal(stdout) {
  const text = String(stdout || "");
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const objects = [];
  for (const line of lines) {
    try {
      objects.push(JSON.parse(line));
    } catch {
      /* ignore */
    }
  }

  // 1) Prefer last fileResult that is terminal (or any fileResult with status).
  for (let i = objects.length - 1; i >= 0; i -= 1) {
    const o = objects[i];
    if (o && o.fileResult && typeof o.fileResult === "object") {
      const fr = o.fileResult;
      const life = mapRunnerResultToLifecycleState(fr);
      if (isTerminalRunnerState(life) || fr.status) {
        return {
          ok: fr.ok !== false,
          raw: o,
          result: fr,
          source: "fileResult",
          lifecycleState: life,
          terminal: isTerminalRunnerState(life),
        };
      }
    }
  }

  // 2) Prefer last explicit terminal JSON (not started-only).
  for (let i = objects.length - 1; i >= 0; i -= 1) {
    const o = objects[i];
    if (!o || typeof o !== "object") continue;
    if (o.started === true && !o.status && !o.reason) continue; // skip STARTED noise
    if (o.fileResult) continue;
    if (o.status || o.job || o.reason === "stale_running_guard" || o.reason === "already_completed" || o.timedOut) {
      const life = mapRunnerResultToLifecycleState(o);
      return {
        ok: o.ok !== false,
        raw: o,
        result: o,
        source: "lastJson",
        lifecycleState: life,
        terminal: isTerminalRunnerState(life),
      };
    }
  }

  // 3) Fall back to STARTED if that is all we have.
  for (let i = objects.length - 1; i >= 0; i -= 1) {
    const o = objects[i];
    if (o && o.started === true) {
      return {
        ok: true,
        raw: o,
        result: o,
        source: "startedOnly",
        lifecycleState: LANE_A_RUNNER_STATES.STARTED,
        terminal: false,
        pid: o.pid || null,
      };
    }
  }

  return {
    ok: false,
    raw: null,
    result: null,
    source: "unparsed",
    objects,
    lifecycleState: LANE_A_RUNNER_STATES.UNKNOWN,
    terminal: false,
  };
}

function createLaneAChildRecord(params = {}) {
  const now = params.now instanceof Date ? params.now : new Date(params.now || Date.now());
  return {
    pid: params.pid != null ? Number(params.pid) : null,
    court: params.court || null,
    batchId: params.batchId || `lane-a-${params.court || "unk"}-${now.getTime()}`,
    startedAt: now.toISOString(),
    workerId: params.workerId || null,
    codeFingerprint: params.codeFingerprint || null,
    expectedMaxAuthorities: Number(params.expectedMaxAuthorities) || 3,
    expectedMaxClRequests: Number(params.expectedMaxClRequests) || CANARY_MAX_SESSION_CL_REQUESTS,
    lifecycleState: LANE_A_RUNNER_STATES.STARTED,
    terminal: false,
    terminalAt: null,
  };
}

function isLaneAChildAlive(child, opts = {}) {
  if (!child || child.terminal) return false;
  if (opts.aliveOverride != null) return Boolean(opts.aliveOverride);
  if (child.pid == null) return false;
  // Without a live probe, treat non-terminal child with pid as potentially alive.
  if (opts.processAlive === false) return false;
  if (opts.processAlive === true) return true;
  return Boolean(child.pid) && !child.terminal;
}

function mayLaunchLaneAChild(state, opts = {}) {
  const child = state?.laneAChild || null;
  if (!child) return { ok: true, reason: "no_existing_child" };
  if (child.terminal) return { ok: true, reason: "prior_child_terminal" };
  if (isLaneAChildAlive(child, opts)) {
    return {
      ok: false,
      reason: "LANE_A_CHILD_STILL_ALIVE",
      pid: child.pid,
      court: child.court,
      batchId: child.batchId,
    };
  }
  return { ok: true, reason: "prior_child_dead_may_relaunch", deadChild: child };
}

function markLaneAChildTerminal(state, params = {}) {
  const next = JSON.parse(JSON.stringify(state || {}));
  if (!next.laneAChild) return next;
  const now = params.now instanceof Date ? params.now : new Date(params.now || Date.now());
  next.laneAChild = {
    ...next.laneAChild,
    terminal: true,
    terminalAt: now.toISOString(),
    lifecycleState: params.lifecycleState || next.laneAChild.lifecycleState || LANE_A_RUNNER_STATES.COMPLETED,
    exitCode: params.exitCode != null ? params.exitCode : next.laneAChild.exitCode,
  };
  return next;
}

/**
 * Fresh post-run DB evidence must be generated after runner terminal time
 * (and after laneARunnerStartedAt).
 */
function isFreshPostRunDbEvidence(params = {}) {
  const dbAt = params.dbEvidenceObservedAt || params.liveDb?.generatedAt || params.liveDb?.observedAt || null;
  const terminalAt = params.runnerTerminalAt || null;
  const startedAt = params.laneARunnerStartedAt || null;
  if (!dbAt) {
    return {
      ok: false,
      postRunDbRefreshed: false,
      reason: "missing_db_evidence_timestamp",
    };
  }
  const dbMs = Date.parse(dbAt);
  if (!Number.isFinite(dbMs)) {
    return { ok: false, postRunDbRefreshed: false, reason: "invalid_db_evidence_timestamp" };
  }
  if (startedAt) {
    const startMs = Date.parse(startedAt);
    if (Number.isFinite(startMs) && dbMs < startMs) {
      return {
        ok: false,
        postRunDbRefreshed: false,
        reason: "db_evidence_before_runner_start",
        dbEvidenceObservedAt: dbAt,
        laneARunnerStartedAt: startedAt,
      };
    }
  }
  if (terminalAt) {
    const termMs = Date.parse(terminalAt);
    if (Number.isFinite(termMs) && dbMs < termMs) {
      return {
        ok: false,
        postRunDbRefreshed: false,
        reason: "db_evidence_before_runner_terminal",
        dbEvidenceObservedAt: dbAt,
        runnerTerminalAt: terminalAt,
      };
    }
  }
  return {
    ok: true,
    postRunDbRefreshed: true,
    dbEvidenceObservedAt: dbAt,
    runnerTerminalAt: terminalAt,
  };
}

/**
 * Session CL request accounting — never count historical job api_calls as session.
 */
function updateSessionQuotaAccounting(session, params = {}) {
  const next = { ...(session || createEmptySessionQuota()) };
  const historical = Number(params.historicalJobApiCalls);
  if (Number.isFinite(historical) && next.historicalJobApiCallsBaseline == null) {
    next.historicalJobApiCallsBaseline = historical;
  }
  if (params.rollingDayObservedUsed != null) {
    next.rollingDayObservedUsed = Number(params.rollingDayObservedUsed);
  }
  if (params.rollingDayRemaining != null) {
    next.rollingDayRemaining = Number(params.rollingDayRemaining);
  }
  if (params.existingJobHistoricalRequests != null) {
    next.existingJobHistoricalRequests = Number(params.existingJobHistoricalRequests) || 0;
  }
  const delta = Number(params.sessionClRequestDelta);
  if (Number.isFinite(delta) && delta > 0) {
    next.sessionClRequests += delta;
    if (params.productive) next.productiveClRequests += delta;
    else if (params.retry) next.retryRequests += delta;
    else if (params.probe) {
      next.quotaProbeRequests += delta;
      next.overheadClRequests += delta;
    } else if (params.overhead) next.overheadClRequests += delta;
    else next.wastedClRequests += delta;
  } else if (
    Number.isFinite(historical) &&
    next.historicalJobApiCallsBaseline != null &&
    historical > next.historicalJobApiCallsBaseline
  ) {
    // Derive session delta from job counter growth only when explicitly allowed.
    const grown = historical - next.historicalJobApiCallsBaseline;
    next.sessionClRequests += grown;
    next.historicalJobApiCallsBaseline = historical;
    if (params.productive) next.productiveClRequests += grown;
    else next.wastedClRequests += grown;
  }
  return next;
}

function canarySessionRequestCapExceeded(session, maxRequests = CANARY_MAX_SESSION_CL_REQUESTS) {
  const used = Number(session?.sessionClRequests) || 0;
  return {
    exceeded: used >= maxRequests,
    used,
    max: maxRequests,
  };
}

/**
 * Zero-progress may only be evaluated after terminal + fresh DB + job refresh.
 */
function mayEvaluateLaneAZeroProgress(params = {}) {
  if (!params.terminal) {
    return { ok: false, reason: "runner_non_terminal" };
  }
  if (!params.freshDbReconciled) {
    return { ok: false, reason: "fresh_db_not_reconciled" };
  }
  if (!params.jobRowRefreshed) {
    return { ok: false, reason: "job_row_not_refreshed" };
  }
  if (params.currentBatchRequestCount == null || !Number.isFinite(Number(params.currentBatchRequestCount))) {
    return { ok: false, reason: "batch_request_count_unknown" };
  }
  return { ok: true, reason: "eligible" };
}

function evaluateCanaryAfterTerminal(params = {}) {
  const canaryRequired = Boolean(params.canaryRequired);
  if (!canaryRequired) {
    return { mode: "NORMAL", canaryPass: true, reason: "canary_not_required" };
  }
  if (!params.terminal) {
    return { mode: "CANARY_REQUIRED", canaryPass: false, reason: "awaiting_terminal" };
  }
  if (!params.productive) {
    return { mode: "CANARY_REQUIRED", canaryPass: false, reason: "no_productive_progress" };
  }
  if (!params.checkpointAdvanced && !params.countAdvanced) {
    return { mode: "CANARY_REQUIRED", canaryPass: false, reason: "no_checkpoint_or_count_advance" };
  }
  const cap = canarySessionRequestCapExceeded(params.sessionQuota, params.maxSessionClRequests);
  if (cap.exceeded && !params.productive) {
    return {
      mode: "CANARY_REQUIRED",
      canaryPass: false,
      humanReviewRequired: true,
      reason: "CANARY_SESSION_REQUEST_CAP_EXCEEDED",
      ...cap,
    };
  }
  return {
    mode: "NORMAL",
    canaryPass: true,
    reason: "CANARY_PASS",
    promoteKnownGood: true,
  };
}

module.exports = {
  LANE_A_RUNNER_STATES,
  TERMINAL_STATES,
  NON_TERMINAL_STATES,
  CANARY_MAX_SESSION_CL_REQUESTS,
  createEmptySessionQuota,
  mapRunnerResultToLifecycleState,
  isTerminalRunnerState,
  isNonTerminalRunnerState,
  parseLaneARunnerStdoutPreferTerminal,
  createLaneAChildRecord,
  isLaneAChildAlive,
  mayLaunchLaneAChild,
  markLaneAChildTerminal,
  isFreshPostRunDbEvidence,
  updateSessionQuotaAccounting,
  canarySessionRequestCapExceeded,
  mayEvaluateLaneAZeroProgress,
  evaluateCanaryAfterTerminal,
};
