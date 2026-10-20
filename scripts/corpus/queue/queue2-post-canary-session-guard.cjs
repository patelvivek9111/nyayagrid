/**
 * Post-canary session budget + unresolved UNKNOWN child handling.
 * Pure helpers. Zero network. Zero AI.
 */
"use strict";

const {
  MAX_TOTAL_CL_REQUESTS_BEFORE_FIRST_PROGRESS,
} = require("./queue2-cl-quota-conservation.cjs");
const { LANE_A_RUNNER_STATES } = require("./queue2-lane-a-child-lifecycle.cjs");

const SESSION_BUDGET_EXHAUSTED = "SESSION_BUDGET_EXHAUSTED";
const SAFE_IDLE = "SAFE_IDLE";
const WAIT_FOR_NEXT_QUOTA_WINDOW = "WAIT_FOR_NEXT_QUOTA_WINDOW";
const RUNNER_RESULT_UNRESOLVED = "RUNNER_RESULT_UNRESOLVED";
const NORMAL_BOUNDED_LANE_A = "NORMAL_BOUNDED_LANE_A";

const MIN_UNRESOLVED_BACKOFF_MS = 30_000;
const MIN_BUDGET_EXHAUSTED_SLEEP_MS = 5 * 60 * 1000;
const MIN_ACTIVE_LANE_SLEEP_MS = 2_000;

/**
 * Remaining CL budget for the current session (canary or normal hard cap).
 * TOTAL includes probes + discovery + fetch + retry + verify.
 */
function remainingSessionClBudget(params = {}) {
  const used = Math.max(
    0,
    Number(params.sessionClRequests ?? params.currentSessionRequests ?? 0) || 0,
  );
  const max =
    params.maxClRequests != null && Number.isFinite(Number(params.maxClRequests))
      ? Math.max(0, Number(params.maxClRequests))
      : params.canaryRequired
        ? MAX_TOTAL_CL_REQUESTS_BEFORE_FIRST_PROGRESS
        : null;
  if (max == null) {
    return {
      limited: false,
      used,
      max: null,
      remaining: null,
      exhausted: false,
      allowHttp: true,
      allowChildLaunch: true,
      allowQuotaProbe: true,
    };
  }
  const remaining = Math.max(0, max - used);
  const exhausted = remaining <= 0;
  return {
    limited: true,
    used,
    max,
    remaining,
    exhausted,
    allowHttp: !exhausted,
    allowChildLaunch: !exhausted,
    allowQuotaProbe: !exhausted,
    classification: exhausted ? SESSION_BUDGET_EXHAUSTED : null,
  };
}

/**
 * Canary hard cap: never exceed max total session CL requests, even after progress.
 */
function evaluateCanarySessionHardCap(params = {}) {
  const canaryRequired = Boolean(params.canaryRequired);
  if (!canaryRequired) {
    return { allow: true, reason: null, humanReviewRequired: false };
  }
  const budget = remainingSessionClBudget({
    sessionClRequests: params.sessionClRequests ?? params.currentSessionRequests,
    maxClRequests: params.maxClRequests ?? MAX_TOTAL_CL_REQUESTS_BEFORE_FIRST_PROGRESS,
    canaryRequired: true,
  });
  if (budget.exhausted) {
    return {
      allow: false,
      reason: SESSION_BUDGET_EXHAUSTED,
      humanReviewRequired: false,
      detail: `sessionClRequests=${budget.used} >= max=${budget.max}`,
      budget,
      classification: SESSION_BUDGET_EXHAUSTED,
    };
  }
  // Block a probe that would itself exceed the hard cap.
  if (params.purpose === "QUOTA_PROBE" && budget.remaining < 1) {
    return {
      allow: false,
      reason: SESSION_BUDGET_EXHAUSTED,
      humanReviewRequired: false,
      detail: "no remaining budget for quota probe",
      budget,
      classification: SESSION_BUDGET_EXHAUSTED,
    };
  }
  return { allow: true, reason: null, humanReviewRequired: false, budget };
}

/**
 * Classify UNKNOWN / pid=null runner outcomes.
 * A = confirmed owned child alive
 * B = confirmed no child
 * C = unknown due to network
 * D = runner returned no terminal parse
 */
function classifyUnresolvedLaneAChild(params = {}) {
  const lifecycleState = params.lifecycleState || params.classified?.lifecycleState || null;
  const pid = params.pid ?? params.classified?.pid ?? null;
  const ownedAlive = params.ownedChildAlive === true;
  const processCount = Number(params.processCount);
  const network =
    params.unknownDueToNetwork === true ||
    lifecycleState === LANE_A_RUNNER_STATES.UNKNOWN_DUE_TO_NETWORK;

  if (ownedAlive && pid != null) {
    return {
      class: "A_OWNED_CHILD_ALIVE",
      nonTerminal: true,
      spin: false,
      action: "SUPERVISE",
    };
  }
  if (network) {
    return {
      class: "C_UNKNOWN_DUE_TO_NETWORK",
      nonTerminal: true,
      spin: false,
      action: "WAIT_FOR_NETWORK",
      classification: "UNKNOWN_DUE_TO_NETWORK",
    };
  }
  if (
    lifecycleState === LANE_A_RUNNER_STATES.UNKNOWN ||
    (pid == null &&
      lifecycleState &&
      lifecycleState !== LANE_A_RUNNER_STATES.STARTED &&
      lifecycleState !== LANE_A_RUNNER_STATES.RUNNING)
  ) {
    if (Number.isFinite(processCount) && processCount === 0) {
      return {
        class: "B_CONFIRMED_NO_CHILD",
        nonTerminal: false,
        spin: false,
        action: SAFE_IDLE,
        classification: RUNNER_RESULT_UNRESOLVED,
        reason: "UNKNOWN_PID_NULL_NO_OWNED_PROCESS",
      };
    }
    return {
      class: "D_RUNNER_NO_TERMINAL_PARSE",
      nonTerminal: false,
      spin: false,
      action: "RECONCILE_ONCE",
      classification: RUNNER_RESULT_UNRESOLVED,
      reason: "UNKNOWN_PID_NULL_NEEDS_RECONCILE",
    };
  }
  if (Number.isFinite(processCount) && processCount === 0 && pid == null) {
    return {
      class: "B_CONFIRMED_NO_CHILD",
      nonTerminal: false,
      spin: false,
      action: SAFE_IDLE,
      classification: RUNNER_RESULT_UNRESOLVED,
    };
  }
  return {
    class: "INDETERMINATE",
    nonTerminal: Boolean(params.classified?.nonTerminal),
    spin: false,
    action: "RECONCILE_ONCE",
  };
}

/**
 * Post-cycle sleep: never allow sleepMs=0 spin for budget exhaustion or unresolved UNKNOWN.
 */
function resolvePostCycleWait(params = {}) {
  const budget = params.budget || remainingSessionClBudget(params);
  if (budget.exhausted || params.sessionBudgetExhausted) {
    return {
      sleepMs: Math.max(
        MIN_BUDGET_EXHAUSTED_SLEEP_MS,
        Number(params.budgetExhaustedSleepMs) || MIN_BUDGET_EXHAUSTED_SLEEP_MS,
      ),
      classification: SESSION_BUDGET_EXHAUSTED,
      runtimeState: SESSION_BUDGET_EXHAUSTED,
      currentLane: "WAIT",
      allowCourtListener: false,
      allowChildLaunch: false,
      spin: false,
    };
  }
  if (params.unresolvedUnknown || params.classification === RUNNER_RESULT_UNRESOLVED) {
    return {
      sleepMs: Math.max(MIN_UNRESOLVED_BACKOFF_MS, Number(params.unresolvedBackoffMs) || MIN_UNRESOLVED_BACKOFF_MS),
      classification: RUNNER_RESULT_UNRESOLVED,
      runtimeState: SAFE_IDLE,
      currentLane: "B",
      allowCourtListener: false,
      allowChildLaunch: false,
      spin: false,
    };
  }
  if (params.waitForQuotaWindow) {
    return {
      sleepMs: Math.max(60_000, Number(params.quotaWindowSleepMs) || 60_000),
      classification: WAIT_FOR_NEXT_QUOTA_WINDOW,
      runtimeState: WAIT_FOR_NEXT_QUOTA_WINDOW,
      currentLane: "WAIT",
      allowCourtListener: false,
      allowChildLaunch: false,
      spin: false,
    };
  }
  const raw = Number(params.computedSleepMs);
  if (Number.isFinite(raw) && raw <= 0 && params.lane === "A") {
    // Active Lane A with immediate continue is only OK when a real owned child is supervised.
    if (params.ownedChildAlive === true) {
      return { sleepMs: 0, classification: null, spin: false, supervise: true };
    }
    return {
      sleepMs: MIN_ACTIVE_LANE_SLEEP_MS,
      classification: SAFE_IDLE,
      runtimeState: SAFE_IDLE,
      currentLane: params.lane || "B",
      spin: false,
      detail: "blocked_zero_sleep_relaunch",
    };
  }
  return {
    sleepMs: Number.isFinite(raw) ? Math.max(0, raw) : MIN_ACTIVE_LANE_SLEEP_MS,
    classification: null,
    spin: false,
  };
}

/**
 * Whether startup / recovery should force first-recovery canary.
 * Known-good matching fingerprint → NORMAL_BOUNDED_LANE_A.
 */
function resolveCanaryModeAfterKnownGood(params = {}) {
  const gate = params.gate || {};
  if (gate.required === true && gate.reason === "code_fingerprint_changed") {
    return {
      canaryMode: "CANARY_REQUIRED",
      reason: gate.reason,
      mode: "CANARY_REQUIRED",
    };
  }
  if (gate.required === true && gate.reason === "no_known_good_fingerprint") {
    return {
      canaryMode: "CANARY_REQUIRED",
      reason: gate.reason,
      mode: "CANARY_REQUIRED",
    };
  }
  if (gate.required === true && gate.reason === "forced") {
    return { canaryMode: "CANARY_REQUIRED", reason: "forced", mode: "CANARY_REQUIRED" };
  }
  if (gate.required !== true) {
    return {
      canaryMode: "NORMAL",
      reason: gate.reason || "fingerprint_matches_known_good",
      mode: NORMAL_BOUNDED_LANE_A,
    };
  }
  // Genuine recovery safety may still require canary.
  if (params.firstRecoveryPending === true && params.dbJustRecovered === true) {
    return {
      canaryMode: "CANARY_REQUIRED",
      reason: "first_recovery_after_db_quota",
      mode: "CANARY_REQUIRED",
    };
  }
  return {
    canaryMode: "NORMAL",
    reason: "known_good_honored",
    mode: NORMAL_BOUNDED_LANE_A,
  };
}

/**
 * Promote canary → NORMAL after productive terminal progress (including quota_paused).
 */
function shouldPromoteCanaryAfterProgress(params = {}) {
  if (params.canaryMode !== "CANARY_REQUIRED") return false;
  if (!params.codeFingerprint) return false;
  if (!params.terminal) return false;
  const productive =
    Boolean(params.productive) ||
    Boolean(params.checkpointAdvanced) ||
    Boolean(params.countAdvanced) ||
    (Number(params.qualifyingDelta) || 0) > 0;
  return productive;
}

module.exports = {
  SESSION_BUDGET_EXHAUSTED,
  SAFE_IDLE,
  WAIT_FOR_NEXT_QUOTA_WINDOW,
  RUNNER_RESULT_UNRESOLVED,
  NORMAL_BOUNDED_LANE_A,
  MIN_UNRESOLVED_BACKOFF_MS,
  MIN_BUDGET_EXHAUSTED_SLEEP_MS,
  MIN_ACTIVE_LANE_SLEEP_MS,
  remainingSessionClBudget,
  evaluateCanarySessionHardCap,
  classifyUnresolvedLaneAChild,
  resolvePostCycleWait,
  resolveCanaryModeAfterKnownGood,
  shouldPromoteCanaryAfterProgress,
};
