/**
 * Queue #2 CourtListener quota conservation — pure, zero network, zero AI.
 *
 * Every CL request must be purpose-classified and counted in the CURRENT SESSION.
 * Historical job.api_calls and rolling-day used are tracked separately.
 */
"use strict";

const CL_REQUEST_PURPOSES = Object.freeze({
  QUOTA_PROBE: "QUOTA_PROBE",
  INGEST_DISCOVERY: "INGEST_DISCOVERY",
  INGEST_FETCH: "INGEST_FETCH",
  RETRY: "RETRY",
  VERIFY: "VERIFY",
  OTHER_EXPLICIT: "OTHER_EXPLICIT",
});

const CL_REQUEST_CLASSES = Object.freeze({
  PRODUCTIVE: "productive",
  OVERHEAD: "overhead",
  WASTED: "wasted",
});

const CONSERVATION_REASONS = Object.freeze({
  CL_DEBUG_QUOTA_BUDGET_EXCEEDED: "CL_DEBUG_QUOTA_BUDGET_EXCEEDED",
  CL_NO_PRODUCTIVE_PROGRESS: "CL_NO_PRODUCTIVE_PROGRESS",
  CL_NONPRODUCTIVE_REQUEST_SPIKE: "CL_NONPRODUCTIVE_REQUEST_SPIKE",
  REDUNDANT_QUOTA_PROBES: "REDUNDANT_QUOTA_PROBES",
});

/** Canary / new-code hard ceilings (independent of daily CL quota). */
const MAX_NONPRODUCTIVE_CL_REQUESTS = 5;
const MAX_TOTAL_CL_REQUESTS_BEFORE_FIRST_PROGRESS = 5;
const MAX_SEQUENTIAL_NONPRODUCTIVE_BEFORE_PROGRESS = 2;
const MAX_REDUNDANT_QUOTA_PROBES = 3;
const QUOTA_PROBE_CACHE_TTL_MS = 7 * 60 * 1000; // 5–10m band; use 7m

function createEmptyClRequestLedger(params = {}) {
  return {
    version: 1,
    sessionId: params.sessionId || `cl-session-${Date.now()}`,
    workerFingerprint: params.workerFingerprint || null,
    court: params.court || null,
    canaryRequired: Boolean(params.canaryRequired),
    entries: [],
    currentSessionRequests: 0,
    productiveClRequests: 0,
    overheadClRequests: 0,
    wastedClRequests: 0,
    quotaProbeRequests: 0,
    retryRequests: 0,
    authoritiesAdded: 0,
    casesAdded: 0,
    checkpointAdvances: 0,
    sequentialNonproductiveBeforeProgress: 0,
    firstProgressAt: null,
    existingJobHistoricalRequests: Number(params.existingJobHistoricalRequests) || 0,
    rollingDayObservedUsed: Number(params.rollingDayObservedUsed) || null,
    rollingDayRemaining: Number(params.rollingDayRemaining) || null,
    quotaProbeReuseCount: 0,
    redundantQuotaProbesPrevented: 0,
    lastQuotaProbeAt: null,
    lastQuotaProbeSignature: null,
  };
}

function classifyRequestPurpose(purpose) {
  const p = String(purpose || "").toUpperCase();
  if (CL_REQUEST_PURPOSES[p]) return CL_REQUEST_PURPOSES[p];
  return CL_REQUEST_PURPOSES.OTHER_EXPLICIT;
}

/**
 * Classify a request as productive / overhead / wasted.
 */
function classifyRequestOutcome(params = {}) {
  const purpose = classifyRequestPurpose(params.purpose);
  if (params.wasted === true || params.redundant === true || params.afterKnownNoProgress === true) {
    return CL_REQUEST_CLASSES.WASTED;
  }
  if (purpose === CL_REQUEST_PURPOSES.QUOTA_PROBE || purpose === CL_REQUEST_PURPOSES.VERIFY) {
    return params.usefulProgress ? CL_REQUEST_CLASSES.PRODUCTIVE : CL_REQUEST_CLASSES.OVERHEAD;
  }
  if (purpose === CL_REQUEST_PURPOSES.RETRY && !params.usefulProgress) {
    return params.necessaryRetry ? CL_REQUEST_CLASSES.OVERHEAD : CL_REQUEST_CLASSES.WASTED;
  }
  if (params.usefulProgress) return CL_REQUEST_CLASSES.PRODUCTIVE;
  if (purpose === CL_REQUEST_PURPOSES.INGEST_DISCOVERY || purpose === CL_REQUEST_PURPOSES.INGEST_FETCH) {
    return params.knownCannotProgress ? CL_REQUEST_CLASSES.WASTED : CL_REQUEST_CLASSES.OVERHEAD;
  }
  return CL_REQUEST_CLASSES.OVERHEAD;
}

/**
 * Record one CL request into the session ledger (no secrets).
 */
function recordClRequest(ledger, params = {}) {
  const next = JSON.parse(JSON.stringify(ledger || createEmptyClRequestLedger()));
  const purpose = classifyRequestPurpose(params.purpose);
  const outcomeClass = classifyRequestOutcome({ ...params, purpose });
  const nowIso = (params.now instanceof Date ? params.now : new Date(params.now || Date.now())).toISOString();
  const entry = {
    n: next.currentSessionRequests + 1,
    at: nowIso,
    court: params.court || next.court || null,
    jurisdiction: params.jurisdiction || null,
    purpose,
    httpOutcome: params.httpOutcome || null,
    usefulProgress: Boolean(params.usefulProgress),
    outcomeClass,
    batchId: params.batchId || null,
    runId: params.runId || null,
    workerFingerprint: params.workerFingerprint || next.workerFingerprint || null,
  };
  delete entry.apiKey;
  delete entry.authorization;
  delete entry.token;

  next.entries.push(entry);
  next.currentSessionRequests += 1;
  if (outcomeClass === CL_REQUEST_CLASSES.PRODUCTIVE) {
    next.productiveClRequests += 1;
    next.sequentialNonproductiveBeforeProgress = 0;
    if (!next.firstProgressAt) next.firstProgressAt = nowIso;
  } else if (outcomeClass === CL_REQUEST_CLASSES.OVERHEAD) {
    next.overheadClRequests += 1;
    if (!next.firstProgressAt) next.sequentialNonproductiveBeforeProgress += 1;
  } else {
    next.wastedClRequests += 1;
    if (!next.firstProgressAt) next.sequentialNonproductiveBeforeProgress += 1;
  }
  if (purpose === CL_REQUEST_PURPOSES.QUOTA_PROBE) next.quotaProbeRequests += 1;
  if (purpose === CL_REQUEST_PURPOSES.RETRY) next.retryRequests += 1;
  if (params.authoritiesAdded) next.authoritiesAdded += Number(params.authoritiesAdded) || 0;
  if (params.casesAdded) next.casesAdded += Number(params.casesAdded) || 0;
  if (params.checkpointAdvanced) next.checkpointAdvances += 1;
  return { ledger: next, entry, outcomeClass };
}

function nonproductiveCount(ledger) {
  return (Number(ledger?.overheadClRequests) || 0) + (Number(ledger?.wastedClRequests) || 0);
}

/**
 * Canary / new-code conservation gates. Call BEFORE issuing another CL request.
 */
function evaluateClConservationGate(ledger, opts = {}) {
  const canary = Boolean(opts.canaryRequired ?? ledger?.canaryRequired);
  const nonprod = nonproductiveCount(ledger);
  const total = Number(ledger?.currentSessionRequests) || 0;
  const hasProgress = Boolean(ledger?.firstProgressAt);
  const seq = Number(ledger?.sequentialNonproductiveBeforeProgress) || 0;

  if (canary && nonprod >= MAX_NONPRODUCTIVE_CL_REQUESTS) {
    return {
      allow: false,
      humanReviewRequired: true,
      reason: CONSERVATION_REASONS.CL_DEBUG_QUOTA_BUDGET_EXCEEDED,
      detail: `nonproductive=${nonprod} >= ${MAX_NONPRODUCTIVE_CL_REQUESTS}`,
    };
  }
  if (canary && !hasProgress && total >= MAX_TOTAL_CL_REQUESTS_BEFORE_FIRST_PROGRESS) {
    return {
      allow: false,
      humanReviewRequired: true,
      reason: CONSERVATION_REASONS.CL_DEBUG_QUOTA_BUDGET_EXCEEDED,
      detail: `total=${total} before first progress >= ${MAX_TOTAL_CL_REQUESTS_BEFORE_FIRST_PROGRESS}`,
    };
  }
  if (!hasProgress && seq >= MAX_SEQUENTIAL_NONPRODUCTIVE_BEFORE_PROGRESS) {
    return {
      allow: false,
      humanReviewRequired: true,
      reason: CONSERVATION_REASONS.CL_NO_PRODUCTIVE_PROGRESS,
      detail: `sequentialNonproductiveBeforeProgress=${seq}`,
    };
  }
  return { allow: true, humanReviewRequired: false, reason: null };
}

/**
 * Quota probe cache: reuse fresh authoritative probe.
 */
function evaluateQuotaProbeCache(cache, opts = {}) {
  const nowMs = (opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now())).getTime();
  const ttl = Number(opts.ttlMs ?? QUOTA_PROBE_CACHE_TTL_MS);
  if (!cache || !cache.observedAt) {
    return { reuse: false, reason: "no_cache", probe: true };
  }
  if (opts.force === true) return { reuse: false, reason: "forced", probe: true };
  if (opts.invalidateReason) {
    return { reuse: false, reason: opts.invalidateReason, probe: true };
  }
  if (cache.had429) return { reuse: false, reason: "prior_429", probe: true };
  if (cache.resetOccurred) return { reuse: false, reason: "reset_occurred", probe: true };
  if (cache.countersMateriallyChanged) {
    return { reuse: false, reason: "counters_changed", probe: true };
  }
  const age = nowMs - Date.parse(cache.observedAt);
  if (!Number.isFinite(age) || age > ttl) {
    return { reuse: false, reason: "ttl_expired", probe: true, ageMs: age };
  }
  if (opts.reason && ["cycle", "watchdog", "status", "lane_b", "db_reconcile"].includes(opts.reason)) {
    return {
      reuse: true,
      reason: "reuse_fresh_cache",
      probe: false,
      cache,
      preventedRedundant: true,
    };
  }
  return { reuse: true, reason: "reuse_fresh_cache", probe: false, cache };
}

function applyQuotaProbeCacheDecision(ledger, decision) {
  const next = JSON.parse(JSON.stringify(ledger || createEmptyClRequestLedger()));
  if (decision?.reuse && decision?.preventedRedundant) {
    next.quotaProbeReuseCount += 1;
    next.redundantQuotaProbesPrevented += 1;
  } else if (decision?.probe === false && decision?.reuse) {
    next.quotaProbeReuseCount += 1;
  }
  return next;
}

function evaluateRedundantQuotaProbeHardStop(history = [], opts = {}) {
  const min = Number(opts.minRepeats ?? MAX_REDUNDANT_QUOTA_PROBES);
  if (!Array.isArray(history) || history.length < min) {
    return { hardStop: false, count: history?.length || 0 };
  }
  const last = history.slice(-min);
  const sig = (p) =>
    `${p?.minuteRemaining ?? "?"}/${p?.hourRemaining ?? "?"}/${p?.dayRemaining ?? "?"}|${p?.quotaMode || ""}|${p?.checkpoint || ""}`;
  const first = sig(last[0]);
  const allSame = last.every((p) => sig(p) === first);
  const noWork = last.every((p) => !p?.workBetween);
  if (allSame && noWork) {
    return {
      hardStop: true,
      count: last.length,
      reason: CONSERVATION_REASONS.REDUNDANT_QUOTA_PROBES,
      humanReviewRequired: true,
    };
  }
  return { hardStop: false, count: last.length };
}

/**
 * Startup rule: at most one fresh quota probe, then productive Lane A or stop/wait (no more CL).
 */
function evaluateStartupClPlan(params = {}) {
  const probesSoFar = Number(params.quotaProbeRequests) || 0;
  const session = Number(params.currentSessionRequests) || 0;
  const canary = Boolean(params.canaryRequired);
  if (probesSoFar === 0 && session === 0) {
    return { next: "ONE_QUOTA_PROBE", allowCl: true, purpose: CL_REQUEST_PURPOSES.QUOTA_PROBE };
  }
  if (probesSoFar >= 1 && !params.laneAProductiveStarted && session <= probesSoFar) {
    if (params.hasUsefulLaneACapacity) {
      return { next: "ENTER_PRODUCTIVE_LANE_A", allowCl: true, purpose: CL_REQUEST_PURPOSES.INGEST_DISCOVERY };
    }
    return { next: "STOP_OR_WAIT_ZERO_CL", allowCl: false, purpose: null };
  }
  if (canary && session >= 2 && !params.firstProgressAt) {
    return {
      next: "HARD_STOP",
      allowCl: false,
      reason: CONSERVATION_REASONS.CL_NO_PRODUCTIVE_PROGRESS,
      humanReviewRequired: true,
    };
  }
  return { next: "CONTINUE", allowCl: true };
}

function requestsPerAuthority(ledger) {
  const auth = Number(ledger?.authoritiesAdded) || 0;
  const prod = Number(ledger?.productiveClRequests) || 0;
  if (auth <= 0) return null;
  return prod / auth;
}

function formatClRequestAccountingLine(ledger) {
  const L = ledger || createEmptyClRequestLedger();
  return (
    `CL REQUEST ACCOUNTING session=${L.currentSessionRequests} ` +
    `productive=${L.productiveClRequests} overhead=${L.overheadClRequests} ` +
    `wasted=${L.wastedClRequests} quotaProbes=${L.quotaProbeRequests} ` +
    `retries=${L.retryRequests} authoritiesAdded=${L.authoritiesAdded} ` +
    `checkpointAdvanced=${L.checkpointAdvances > 0}`
  );
}

function formatRollingDayObservedLine(ledger) {
  const used = ledger?.rollingDayObservedUsed;
  const rem = ledger?.rollingDayRemaining;
  return `ROLLING DAY OBSERVED used=${used == null ? "?" : used} remaining=${rem == null ? "?" : rem}`;
}

/**
 * Assert a named operation must issue zero CL HTTP calls.
 */
function assertZeroClOperation(opName, clCalls) {
  const n = Number(clCalls) || 0;
  if (n !== 0) {
    return { ok: false, operation: opName, courtListenerHttpCalls: n, reason: "ZERO_CL_VIOLATION" };
  }
  return { ok: true, operation: opName, courtListenerHttpCalls: 0 };
}

/**
 * Deterministic MI canary conservation replay (mocked; zero network).
 */
function replayMiCanaryConservationFlow(opts = {}) {
  const events = [];
  const push = (type, extra = {}) => events.push({ type, ...extra });
  let ledger = createEmptyClRequestLedger({
    canaryRequired: true,
    court: "mich",
    existingJobHistoricalRequests: 9,
    rollingDayObservedUsed: opts.rollingDayUsed ?? 94,
    rollingDayRemaining: opts.rollingDayRemaining ?? 1106,
    workerFingerprint: opts.workerFingerprint || "test-fp",
  });
  let courtListenerHttpCalls = 0;
  let state = {
    laneA: {
      court: "mich",
      jurisdiction: "MI",
      count: 20,
      target: 45,
      targetStatus: "PARTIAL",
      checkpoint: "cl-opinion-11250867",
      cursor: "cl-opinion-11250867",
      jobStatus: "quota_paused",
      mappingStatus: "VERIFIED",
      existingJobClassification: "STALE_RESUMABLE",
    },
    canaryMode: "CANARY_REQUIRED",
    humanReview: { required: false, reasons: [], details: [] },
    queue3: "NOT_OPEN",
  };

  push("PREFLIGHT", assertZeroClOperation("preflight", 0));
  push("VALIDATE", assertZeroClOperation("validate", 0));

  const startup = evaluateStartupClPlan({
    quotaProbeRequests: 0,
    currentSessionRequests: 0,
    canaryRequired: true,
  });
  push("STARTUP_PLAN", startup);
  let rec = recordClRequest(ledger, {
    purpose: CL_REQUEST_PURPOSES.QUOTA_PROBE,
    court: "mich",
    httpOutcome: 200,
    usefulProgress: false,
    batchId: "startup-probe",
  });
  ledger = rec.ledger;
  courtListenerHttpCalls += 1;

  const cache = {
    observedAt: new Date().toISOString(),
    minuteRemaining: 30,
    hourRemaining: 300,
    dayRemaining: 1106,
    safeRequests: 28,
  };
  const reuse = evaluateQuotaProbeCache(cache, { reason: "cycle", now: new Date() });
  push("PROBE_CACHE", reuse);
  ledger = applyQuotaProbeCacheDecision(ledger, { ...reuse, preventedRedundant: true });

  let gate = evaluateClConservationGate(ledger, { canaryRequired: true });
  push("GATE_BEFORE_LANE_A", gate);
  if (!gate.allow) {
    return { ok: false, events, ledger, courtListenerHttpCalls, state, reason: gate.reason };
  }

  push("LANE_A_RESUME", {
    checkpoint: state.laneA.checkpoint,
    initialStart: false,
    page1Restart: false,
  });

  const batchId = "mi-canary-1";
  // After one probe: enter productive Lane A immediately (no second nonproductive).
  for (const step of [
    { purpose: CL_REQUEST_PURPOSES.INGEST_FETCH, useful: true, authoritiesAdded: 1 },
    { purpose: CL_REQUEST_PURPOSES.INGEST_FETCH, useful: true, authoritiesAdded: 1, checkpointAdvanced: true },
    { purpose: CL_REQUEST_PURPOSES.INGEST_FETCH, useful: true, authoritiesAdded: 0 },
  ]) {
    gate = evaluateClConservationGate(ledger, { canaryRequired: true });
    if (!gate.allow) {
      return { ok: false, events, ledger, courtListenerHttpCalls, state, reason: gate.reason };
    }
    rec = recordClRequest(ledger, {
      purpose: step.purpose,
      court: "mich",
      httpOutcome: 200,
      usefulProgress: step.useful,
      authoritiesAdded: step.authoritiesAdded || 0,
      checkpointAdvanced: Boolean(step.checkpointAdvanced),
      batchId,
    });
    ledger = rec.ledger;
    courtListenerHttpCalls += 1;
  }

  state.laneA.count = 22;
  state.laneA.checkpoint = "cl-opinion-mi-canary-2";
  state.laneA.cursor = "cl-opinion-mi-canary-2";
  state.canaryMode = "NORMAL";
  push("CANARY_PASS", {
    authoritiesAdded: ledger.authoritiesAdded,
    session: ledger.currentSessionRequests,
    checkpoint: state.laneA.checkpoint,
  });
  push("ACCOUNTING", { line: formatClRequestAccountingLine(ledger) });
  push("ROLLING_DAY", { line: formatRollingDayObservedLine(ledger) });

  const ok =
    courtListenerHttpCalls === ledger.currentSessionRequests &&
    ledger.currentSessionRequests === 4 &&
    ledger.existingJobHistoricalRequests === 9 &&
    ledger.rollingDayObservedUsed === (opts.rollingDayUsed ?? 94) &&
    state.laneA.checkpoint !== "cl-opinion-11250867" &&
    state.queue3 === "NOT_OPEN";

  return {
    ok,
    events,
    ledger,
    courtListenerHttpCalls,
    state,
    accountingLine: formatClRequestAccountingLine(ledger),
    rollingDayLine: formatRollingDayObservedLine(ledger),
    aiCalls: 0,
    mutations: 0,
  };
}

module.exports = {
  CL_REQUEST_PURPOSES,
  CL_REQUEST_CLASSES,
  CONSERVATION_REASONS,
  MAX_NONPRODUCTIVE_CL_REQUESTS,
  MAX_TOTAL_CL_REQUESTS_BEFORE_FIRST_PROGRESS,
  MAX_SEQUENTIAL_NONPRODUCTIVE_BEFORE_PROGRESS,
  MAX_REDUNDANT_QUOTA_PROBES,
  QUOTA_PROBE_CACHE_TTL_MS,
  createEmptyClRequestLedger,
  classifyRequestPurpose,
  classifyRequestOutcome,
  recordClRequest,
  nonproductiveCount,
  evaluateClConservationGate,
  evaluateQuotaProbeCache,
  applyQuotaProbeCacheDecision,
  evaluateRedundantQuotaProbeHardStop,
  evaluateStartupClPlan,
  requestsPerAuthority,
  formatClRequestAccountingLine,
  formatRollingDayObservedLine,
  assertZeroClOperation,
  replayMiCanaryConservationFlow,
};
