/**
 * Lane A per-batch CL budget — single source of truth for parent/child handoff.
 * Pure. Zero network. Zero AI.
 *
 * Canary hard total <=5 INCLUDING parent quota probe, scoped PER_WORKER_SESSION
 * (resets on new processStartNonce / beginNewClRequestSession — NOT per fingerprint).
 * Normal: each independent batch gets a fresh batchBudget (alreadyUsed = 0).
 */
"use strict";

const BATCH_BUDGET_EXHAUSTED = "BATCH_BUDGET_EXHAUSTED";
const WAIT_FOR_QUOTA = "WAIT_FOR_QUOTA";
const LANE_A_CHILD_NO_BUDGET = "LANE_A_CHILD_NO_BUDGET";
const CANARY_BUDGET_INSUFFICIENT_FOR_PRODUCTIVE_BATCH =
  "CANARY_BUDGET_INSUFFICIENT_FOR_PRODUCTIVE_BATCH";

/** Canary max=5 is per worker CL session, not per fingerprint attempt. */
const CANARY_BUDGET_SCOPE = "PER_WORKER_SESSION";

/** Minimum CL_MAX_SESSION_CALLS for a useful child (bootstrap=0 after parent probe). */
const MIN_PRODUCTIVE_CHILD_CL_REQUESTS = 1;

/**
 * Canonical remaining CL requests the child may consume.
 * Same value MUST drive allowChildLaunch, CL_MAX_SESSION_CALLS, and preflight.
 *
 * Inputs:
 * - mode CANARY/NORMAL (via canaryRequired)
 * - hard canary total max
 * - worker/session requests already consumed (includes parent probe when counted)
 * - parentQuotaProbeAlreadyConsumed (optional; only added if not already in session)
 * - per-batch allowance
 * - childBootstrapOverhead (usually 0 — parent already probed)
 * - requiredReserve
 */
function remainingClRequestsForChild(params = {}) {
  const canaryRequired = Boolean(params.canaryRequired);
  const batchMax = Math.max(0, Number(params.batchMaxClRequests) || 0);
  const workerSessionRequests = Math.max(0, Number(params.workerSessionRequests) || 0);
  const canaryMax = Math.max(
    0,
    Number(params.canaryMaxClRequests != null ? params.canaryMaxClRequests : 5) || 5,
  );
  const childBootstrapOverhead = Math.max(0, Number(params.childBootstrapOverhead) || 0);
  const requiredReserve = Math.max(0, Number(params.requiredReserve) || 0);
  const minProductive = Math.max(
    1,
    Number(
      params.minProductiveChildRequests != null
        ? params.minProductiveChildRequests
        : MIN_PRODUCTIVE_CHILD_CL_REQUESTS,
    ) || MIN_PRODUCTIVE_CHILD_CL_REQUESTS,
  );

  let hardCap;
  let mode;
  let consumed;
  if (canaryRequired) {
    mode = "CANARY";
    hardCap = Math.min(batchMax > 0 ? batchMax : canaryMax, canaryMax);
    // Canary: worker-session consumption (incl. parent probe) counts against hard cap.
    consumed = workerSessionRequests;
    // Parent probe is normally already inside workerSessionRequests. Only add when
    // explicitly marked consumed AND session counter has not yet recorded it.
    if (params.parentQuotaProbeAlreadyConsumed === true && params.parentProbeCountedInSession !== true) {
      const probeCount = Math.max(1, Number(params.parentQuotaProbeCount) || 1);
      consumed += probeCount;
    }
  } else {
    mode = "NORMAL";
    hardCap = batchMax;
    // Normal: fresh per-batch budget. Worker session totals are observability only.
    consumed = 0;
  }

  const rawRemaining = Math.max(0, hardCap - consumed - childBootstrapOverhead - requiredReserve);
  const allowChildLaunch = rawRemaining >= minProductive;

  let classification = null;
  let detail = null;
  if (!allowChildLaunch) {
    if (canaryRequired && hardCap > 0 && rawRemaining > 0 && rawRemaining < minProductive) {
      classification = CANARY_BUDGET_INSUFFICIENT_FOR_PRODUCTIVE_BATCH;
      detail = `canary remaining=${rawRemaining} < minProductive=${minProductive}`;
    } else if (canaryRequired) {
      classification =
        rawRemaining <= 0 && consumed > 0
          ? CANARY_BUDGET_INSUFFICIENT_FOR_PRODUCTIVE_BATCH
          : BATCH_BUDGET_EXHAUSTED;
      detail = `canary session ${consumed}/${hardCap} remaining=${rawRemaining}`;
    } else {
      classification = WAIT_FOR_QUOTA;
      detail = "normal batch budget is zero (quota/target)";
    }
  }

  return {
    mode,
    canaryBudgetScope: CANARY_BUDGET_SCOPE,
    hardCap,
    consumed,
    workerSessionRequests,
    childBootstrapOverhead,
    requiredReserve,
    minProductiveChildRequests: minProductive,
    remainingClRequests: rawRemaining,
    remainingClRequestsForChild: rawRemaining,
    allowChildLaunch,
    classification,
    detail,
    // Shared-session handoff: child allowance as max, alreadyUsed=0 (no double-subtract).
    childMaxClRequests: canaryRequired ? hardCap : batchMax,
    alreadyUsedForSharedSession: canaryRequired ? consumed : 0,
    clMaxSessionCalls: rawRemaining,
  };
}

/**
 * Resolve child max / alreadyUsed for a new Lane A batch.
 * Thin wrapper around remainingClRequestsForChild (single source of truth).
 */
function resolveLaneABatchClBudget(params = {}) {
  const resolved = remainingClRequestsForChild(params);
  return {
    mode: resolved.mode,
    canaryBudgetScope: resolved.canaryBudgetScope,
    workerSessionRequests: resolved.workerSessionRequests,
    batchBudget: resolved.hardCap,
    batchRequestsUsed: 0,
    alreadyUsed: resolved.alreadyUsedForSharedSession,
    childMaxClRequests: resolved.childMaxClRequests,
    remainingClRequests: resolved.remainingClRequestsForChild,
    remainingClRequestsForChild: resolved.remainingClRequestsForChild,
    clMaxSessionCalls: resolved.clMaxSessionCalls,
    minProductiveChildRequests: resolved.minProductiveChildRequests,
    allowChildLaunch: resolved.allowChildLaunch,
    classification: resolved.classification,
    detail: resolved.detail,
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
 * Must never allow a probe that will be followed by allowChildLaunch=false / NO_BUDGET.
 */
function evaluateProbeUsefulnessForNextBatch(params = {}) {
  const budget = resolveLaneABatchClBudget(params);
  if (params.canaryRequired && !budget.allowChildLaunch) {
    return {
      allowProbe: false,
      reason: budget.classification || CANARY_BUDGET_INSUFFICIENT_FOR_PRODUCTIVE_BATCH,
      detail: budget.detail,
      budget,
    };
  }
  // Preview AFTER one more probe would burn (canary): if next remaining < min, stop now.
  if (params.canaryRequired && params.previewAfterNextProbe === true) {
    const afterProbe = resolveLaneABatchClBudget({
      ...params,
      workerSessionRequests: (Number(params.workerSessionRequests) || 0) + 1,
    });
    if (!afterProbe.allowChildLaunch) {
      return {
        allowProbe: false,
        reason: CANARY_BUDGET_INSUFFICIENT_FOR_PRODUCTIVE_BATCH,
        detail: `next probe would leave remaining=${afterProbe.remainingClRequestsForChild} < minProductive`,
        budget: afterProbe,
      };
    }
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
      }),
    };
  }
  return { allowProbe: true, reason: null, budget };
}

/**
 * Classify pre-launch / child-reported no-budget.
 *
 * CRITICAL: do NOT default `reason` to LANE_A_CHILD_NO_BUDGET — that made every
 * post-launch call match (false positive → probe-only loop).
 */
function classifyPreLaunchNoBudget(params = {}) {
  const stdout = String(params.stdout || "");
  const explicitReason = params.reason === LANE_A_CHILD_NO_BUDGET;
  const stdoutHit = /LANE_A_CHILD_NO_BUDGET/.test(stdout);
  const preLaunchZero =
    params.preLaunch === true &&
    params.remainingClBudget != null &&
    Number(params.remainingClBudget) <= 0;

  const hit = explicitReason || stdoutHit || preLaunchZero;
  if (!hit) return { matched: false };

  const canaryRequired = Boolean(params.canaryRequired);
  const classification = canaryRequired
    ? params.classification || BATCH_BUDGET_EXHAUSTED
    : WAIT_FOR_QUOTA;
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

/**
 * Assert parent remaining == child CL_MAX handoff (invariant helper for tests/runtime).
 */
function assertParentChildBudgetAgreement(budget, childClMaxSessionCalls) {
  const parent = Number(budget?.remainingClRequestsForChild ?? budget?.remainingClRequests);
  const child = Number(childClMaxSessionCalls);
  if (!Number.isFinite(parent) || !Number.isFinite(child)) {
    return { ok: false, reason: "non_finite", parent, child };
  }
  if (parent !== child) {
    return { ok: false, reason: "parent_child_mismatch", parent, child };
  }
  if (budget?.allowChildLaunch === true && child <= 0) {
    return { ok: false, reason: "allow_true_but_child_zero", parent, child };
  }
  if (budget?.allowChildLaunch === false && child > 0 && budget?.mode === "CANARY") {
    // allow=false with child>0 only valid when remaining < minProductive
    const min = Number(budget.minProductiveChildRequests) || MIN_PRODUCTIVE_CHILD_CL_REQUESTS;
    if (child >= min) {
      return { ok: false, reason: "allow_false_but_child_sufficient", parent, child, min };
    }
  }
  return { ok: true, parent, child };
}

module.exports = {
  BATCH_BUDGET_EXHAUSTED,
  WAIT_FOR_QUOTA,
  LANE_A_CHILD_NO_BUDGET,
  CANARY_BUDGET_INSUFFICIENT_FOR_PRODUCTIVE_BATCH,
  CANARY_BUDGET_SCOPE,
  MIN_PRODUCTIVE_CHILD_CL_REQUESTS,
  remainingClRequestsForChild,
  resolveLaneABatchClBudget,
  isStaleNormalBatchBudget,
  evaluateProbeUsefulnessForNextBatch,
  classifyPreLaunchNoBudget,
  assertParentChildBudgetAgreement,
};
