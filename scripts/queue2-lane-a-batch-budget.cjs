/**
 * Lane A per-batch CL budget — separates worker-lifetime accounting from
 * per-batch child allowance. Pure. Zero network. Zero AI.
 *
 * Canary: hard total <=5 across the canary session (alreadyUsed = worker session).
 * Normal: each independent batch gets a fresh batchBudget (alreadyUsed = 0).
 */
"use strict";

const BATCH_BUDGET_EXHAUSTED = "BATCH_BUDGET_EXHAUSTED";
const WAIT_FOR_QUOTA = "WAIT_FOR_QUOTA";
const LANE_A_CHILD_NO_BUDGET = "LANE_A_CHILD_NO_BUDGET";

/**
 * Resolve child max / alreadyUsed for a new Lane A batch.
 */
function resolveLaneABatchClBudget(params = {}) {
  const canaryRequired = Boolean(params.canaryRequired);
  const batchMax = Math.max(0, Number(params.batchMaxClRequests) || 0);
  const workerSessionRequests = Math.max(0, Number(params.workerSessionRequests) || 0);
  const canaryMax = Math.max(
    0,
    Number(params.canaryMaxClRequests != null ? params.canaryMaxClRequests : 5) || 5,
  );

  if (canaryRequired) {
    const remaining = Math.max(0, Math.min(batchMax, canaryMax) - workerSessionRequests);
    return {
      mode: "CANARY",
      workerSessionRequests,
      batchBudget: Math.min(batchMax, canaryMax),
      batchRequestsUsed: 0,
      alreadyUsed: workerSessionRequests,
      childMaxClRequests: Math.min(batchMax, canaryMax),
      remainingClRequests: remaining,
      allowChildLaunch: remaining > 0,
      classification: remaining > 0 ? null : BATCH_BUDGET_EXHAUSTED,
      detail:
        remaining > 0
          ? null
          : `canary session ${workerSessionRequests}/${canaryMax} exhausted`,
    };
  }

  // NORMAL: fresh per-batch budget. Worker session totals are observability only.
  return {
    mode: "NORMAL",
    workerSessionRequests,
    batchBudget: batchMax,
    batchRequestsUsed: 0,
    alreadyUsed: 0,
    childMaxClRequests: batchMax,
    remainingClRequests: batchMax,
    allowChildLaunch: batchMax > 0,
    classification: batchMax > 0 ? null : WAIT_FOR_QUOTA,
    detail: batchMax > 0 ? null : "normal batch budget is zero (quota/target)",
  };
}

/**
 * Detect stale shared-session budget that would block a new normal batch.
 * True when prior batch's alreadyUsed consumed the next batch's allowance.
 */
function isStaleNormalBatchBudget(session, params = {}) {
  if (params.canaryRequired) return false;
  if (!session) return false;
  const max = Number(session.maxClRequests);
  const used = Number(session.alreadyUsed ?? session.sessionClRequests) || 0;
  if (!Number.isFinite(max)) return false;
  // Stale if lifetime/session used was folded into alreadyUsed for a normal batch.
  const workerSession = Number(params.workerSessionRequests) || 0;
  if (workerSession > 0 && used >= workerSession && max - used <= 0 && max > 0) {
    return true;
  }
  if (used > 0 && max - used <= 0 && params.freshBatchMax > 0) {
    return true;
  }
  return false;
}

/**
 * Before spending a parent quota probe: can a useful Lane A batch run after refresh?
 */
function evaluateProbeUsefulnessForNextBatch(params = {}) {
  const budget = resolveLaneABatchClBudget(params);
  if (params.canaryRequired && !budget.allowChildLaunch) {
    return {
      allowProbe: false,
      reason: BATCH_BUDGET_EXHAUSTED,
      detail: budget.detail,
      budget,
    };
  }
  const usable = Number(params.usableRequests);
  if (Number.isFinite(usable) && usable < 1 && params.quotaCacheFresh === true) {
    return {
      allowProbe: false,
      reason: WAIT_FOR_QUOTA,
      detail: "usableRequests=0 with fresh quota cache",
      budget,
    };
  }
  // Stale normal shared session would yield zero — refresh budget instead of probing first.
  if (
    !params.canaryRequired &&
    isStaleNormalBatchBudget(params.clSharedSession, {
      canaryRequired: false,
      workerSessionRequests: params.workerSessionRequests,
      freshBatchMax: params.batchMaxClRequests,
    })
  ) {
    return {
      allowProbe: true,
      reason: "REFRESH_BATCH_BUDGET_FIRST",
      refreshBatchBudget: true,
      detail: "stale normal batch alreadyUsed would yield LANE_A_CHILD_NO_BUDGET",
      budget: resolveLaneABatchClBudget({
        ...params,
        // preview with correct normal alreadyUsed=0
      }),
    };
  }
  return { allowProbe: true, reason: null, budget };
}

/**
 * Classify pre-launch no-budget (child never started).
 */
function classifyPreLaunchNoBudget(params = {}) {
  const reason = params.reason || LANE_A_CHILD_NO_BUDGET;
  const stdout = String(params.stdout || "");
  const hit =
    reason === LANE_A_CHILD_NO_BUDGET ||
    /LANE_A_CHILD_NO_BUDGET/.test(stdout) ||
    params.remainingClBudget === 0;

  if (!hit) return { matched: false };

  const canaryRequired = Boolean(params.canaryRequired);
  const classification = canaryRequired ? BATCH_BUDGET_EXHAUSTED : WAIT_FOR_QUOTA;
  return {
    matched: true,
    childLaunched: false,
    pid: null,
    unresolvedUnknown: false,
    nonTerminal: false,
    terminal: true,
    classification,
    reason: LANE_A_CHILD_NO_BUDGET,
    runtimeState: classification,
    currentLane: "WAIT",
    spin: false,
    allowCourtListener: false,
    detail: params.detail || "pre-launch zero batch budget; no child process",
  };
}

module.exports = {
  BATCH_BUDGET_EXHAUSTED,
  WAIT_FOR_QUOTA,
  LANE_A_CHILD_NO_BUDGET,
  resolveLaneABatchClBudget,
  isStaleNormalBatchBudget,
  evaluateProbeUsefulnessForNextBatch,
  classifyPreLaunchNoBudget,
};
