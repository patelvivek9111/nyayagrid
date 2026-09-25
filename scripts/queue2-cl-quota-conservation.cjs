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
    sessionId: params.sessionId || `cl-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workerFingerprint: params.workerFingerprint || null,
    workerId: params.workerId || null,
    processStartNonce: params.processStartNonce || null,
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
    rollingDayObservedUsed:
      params.rollingDayObservedUsed == null ? null : Number(params.rollingDayObservedUsed),
    rollingDayRemaining:
      params.rollingDayRemaining == null ? null : Number(params.rollingDayRemaining),
    quotaProbeReuseCount: 0,
    redundantQuotaProbesPrevented: 0,
    lastQuotaProbeAt: null,
    lastQuotaProbeSignature: null,
    startedAt: (params.now instanceof Date ? params.now : new Date(params.now || Date.now())).toISOString(),
  };
}

/**
 * Archive prior active ledger and start a fresh session for a new worker process.
 * Never copies counters into the new active session.
 */
function beginNewClRequestSession(state, opts = {}) {
  const next = state && typeof state === "object" ? JSON.parse(JSON.stringify(state)) : {};
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now());
  const prior = next.clRequestLedger || null;
  const archived = Array.isArray(next.historicalClSessions) ? next.historicalClSessions.slice() : [];
  if (prior && (Number(prior.currentSessionRequests) > 0 || Array.isArray(prior.entries) && prior.entries.length > 0)) {
    archived.push({
      ...prior,
      archivedAt: now.toISOString(),
      archiveReason: opts.reason || "new_worker_process",
    });
  }
  // Cap archive size for durable state.
  next.historicalClSessions = archived.slice(-20);

  next.clRequestLedger = createEmptyClRequestLedger({
    sessionId: opts.sessionId,
    workerFingerprint: opts.workerFingerprint || null,
    workerId: opts.workerId || null,
    processStartNonce: opts.processStartNonce || null,
    court: next.laneA?.court || opts.court || null,
    canaryRequired: next.canaryMode === "CANARY_REQUIRED" || Boolean(opts.canaryRequired),
    existingJobHistoricalRequests:
      Number(opts.existingJobHistoricalRequests) ||
      Number(next.sessionQuota?.historicalJobApiCallsBaseline) ||
      Number(prior?.existingJobHistoricalRequests) ||
      0,
    rollingDayObservedUsed: next.quota?.windows?.day?.used ?? prior?.rollingDayObservedUsed ?? null,
    rollingDayRemaining: next.quota?.windows?.day?.remaining ?? prior?.rollingDayRemaining ?? null,
    now,
  });

  // Reset active sessionQuota counters; keep historical baseline + rolling observations.
  const prevSq = next.sessionQuota || {};
  next.sessionQuota = {
    sessionClRequests: 0,
    productiveClRequests: 0,
    overheadClRequests: 0,
    quotaProbeRequests: 0,
    retryRequests: 0,
    wastedClRequests: 0,
    historicalJobApiCallsBaseline:
      prevSq.historicalJobApiCallsBaseline != null
        ? prevSq.historicalJobApiCallsBaseline
        : Number(opts.existingJobHistoricalRequests) || null,
    existingJobHistoricalRequests:
      Number(prevSq.existingJobHistoricalRequests) ||
      Number(prevSq.historicalJobApiCallsBaseline) ||
      0,
    rollingDayObservedUsed: prevSq.rollingDayObservedUsed ?? next.quota?.windows?.day?.used ?? null,
    rollingDayRemaining: prevSq.rollingDayRemaining ?? next.quota?.windows?.day?.remaining ?? null,
    quotaProbeReuseCount: 0,
    redundantQuotaProbesPrevented: 0,
    sessionId: next.clRequestLedger.sessionId,
    childSessionApiCalls: 0,
  };

  next.clSharedSession = null;
  next.clSessionStartedAt = now.toISOString();
  next.clSessionWorkerId = opts.workerId || null;
  next.clSessionProcessNonce = opts.processStartNonce || null;

  // Drop false CL_NO_PRODUCTIVE_PROGRESS holds that belonged to the prior session.
  if (next.humanReview?.required && Array.isArray(next.humanReview.reasons)) {
    const drop = new Set([
      CONSERVATION_REASONS.CL_NO_PRODUCTIVE_PROGRESS,
      CONSERVATION_REASONS.CL_NONPRODUCTIVE_REQUEST_SPIKE,
      CONSERVATION_REASONS.CL_DEBUG_QUOTA_BUDGET_EXCEEDED,
    ]);
    next.humanReview.reasons = next.humanReview.reasons.filter((r) => !drop.has(r));
    next.humanReview.details = (next.humanReview.details || []).filter((d) => !drop.has(d.reason));
    if (next.humanReview.reasons.length === 0) {
      next.humanReview.required = false;
      next.humanReview.details = [];
    }
  }

  return {
    state: next,
    priorSessionId: prior?.sessionId || null,
    sessionId: next.clRequestLedger.sessionId,
    archivedCount: next.historicalClSessions.length,
    streak: 0,
    currentSessionRequests: 0,
  };
}

/**
 * True when persisted ledger belongs to a different worker process/nonce.
 */
function shouldResetClSessionForNewWorker(state, opts = {}) {
  const ledger = state?.clRequestLedger;
  if (!ledger) return true;
  if (opts.processStartNonce && ledger.processStartNonce && ledger.processStartNonce !== opts.processStartNonce) {
    return true;
  }
  if (opts.workerId && ledger.workerId && ledger.workerId !== opts.workerId) {
    return true;
  }
  // Always reset on explicit new process start (caller passes force or process nonce).
  if (opts.force === true) return true;
  if (opts.processStartNonce && !ledger.processStartNonce) return true;
  return false;
}

/**
 * Queue #2 CourtListener callers — inventory for instrumentation invariant.
 * Autonomous Queue #2 paths must be ledger-instrumented (or zero-CL).
 */
const QUEUE2_CL_CALLERS = Object.freeze([
  {
    caller: "run-queue2-dual-lane.runQuotaProbe → tmp-cl-api-usage-probe",
    purpose: "QUOTA_PROBE",
    ledgerInstrumented: true,
    typicalRequests: 1,
    canRunWhileWorkerStopped: false,
    notes: "Parent records QUOTA_PROBE; single /api-usage/ HTTP call",
  },
  {
    caller: "run-staging-cl-batch-job → staging-cl-batch-job",
    purpose: "INGEST_DISCOVERY/INGEST_FETCH/RETRY",
    ledgerInstrumented: true,
    typicalRequests: "1..CL_MAX_SESSION_CALLS",
    canRunWhileWorkerStopped: true,
    notes: "Detached child; must receive CL_SESSION_ID + CL_MAX_SESSION_CALLS; reports sessionApiCalls",
  },
  {
    caller: "staging-cl-batch-job.bootstrapQuotaPlan",
    purpose: "QUOTA_PROBE",
    ledgerInstrumented: true,
    typicalRequests: 1,
    canRunWhileWorkerStopped: true,
    notes: "Disabled when CL_BOOTSTRAP_USAGE=0 (Queue #2 default)",
  },
  {
    caller: "queue2:preflight / queue2:validate / Lane B / watchdog / status",
    purpose: "NONE",
    ledgerInstrumented: true,
    typicalRequests: 0,
    canRunWhileWorkerStopped: true,
    notes: "Hard zero-CL; covered by assertZeroClOperation tests",
  },
  {
    caller: "tmp-wave2*-usage-probe / cl-ping / staging-cl-shape-probe / run-cl-shape-inline",
    purpose: "OTHER_EXPLICIT (manual/ops)",
    ledgerInstrumented: false,
    typicalRequests: "1+",
    canRunWhileWorkerStopped: true,
    notes: "NOT part of Queue #2 autonomous worker; must not run during Q2 autonomy",
  },
  {
    caller: "staging-cl-ingest-lean / staging-cl-court-map-probe",
    purpose: "OTHER_EXPLICIT (legacy wave scripts)",
    ledgerInstrumented: false,
    typicalRequests: "many",
    canRunWhileWorkerStopped: true,
    notes: "NOT Queue #2 autonomous path; blocked by process policy during Q2",
  },
]);

function assertQueue2AutonomousCallersInstrumented() {
  const autonomous = QUEUE2_CL_CALLERS.filter(
    (c) =>
      c.caller.includes("run-queue2") ||
      c.caller.includes("run-staging-cl-batch") ||
      c.caller.includes("staging-cl-batch-job") ||
      c.caller.includes("preflight") ||
      c.caller.includes("Lane B"),
  );
  const bad = autonomous.filter((c) => c.ledgerInstrumented !== true && Number(c.typicalRequests) !== 0);
  return { ok: bad.length === 0, bad, autonomous };
}

/**
 * Replay: prior session A with streak=1 must not block new session B after one probe.
 */
function replayNewWorkerSessionBoundary(opts = {}) {
  const events = [];
  let state = {
    canaryMode: "CANARY_REQUIRED",
    laneA: { court: "mich", count: 20, target: 45, checkpoint: "cl-opinion-11250867" },
    sessionQuota: {
      sessionClRequests: 1,
      productiveClRequests: 0,
      overheadClRequests: 1,
      quotaProbeRequests: 1,
      historicalJobApiCallsBaseline: 9,
    },
    clRequestLedger: createEmptyClRequestLedger({
      sessionId: "session-A",
      canaryRequired: true,
      existingJobHistoricalRequests: 9,
    }),
    humanReview: {
      required: true,
      reasons: [CONSERVATION_REASONS.CL_NO_PRODUCTIVE_PROGRESS],
      details: [{ reason: CONSERVATION_REASONS.CL_NO_PRODUCTIVE_PROGRESS, detail: "streak=2" }],
    },
    queue3: "NOT_OPEN",
  };
  // Seed session A with one probe (streak=1).
  state.clRequestLedger = recordClRequest(state.clRequestLedger, {
    purpose: CL_REQUEST_PURPOSES.QUOTA_PROBE,
    usefulProgress: false,
  }).ledger;
  events.push({
    type: "SESSION_A",
    requests: state.clRequestLedger.currentSessionRequests,
    streak: state.clRequestLedger.sequentialNonproductiveBeforeProgress,
  });

  const reset = beginNewClRequestSession(state, {
    workerId: "worker-B",
    processStartNonce: "nonce-B",
    workerFingerprint: "fp-B",
    reason: "new_worker_process",
    now: new Date("2026-09-25T19:10:00.000Z"),
  });
  state = reset.state;
  events.push({
    type: "SESSION_B_START",
    requests: state.clRequestLedger.currentSessionRequests,
    streak: state.clRequestLedger.sequentialNonproductiveBeforeProgress,
    priorArchived: Boolean(reset.priorSessionId),
    hr: state.humanReview.required,
  });

  // One startup probe on B.
  state.clRequestLedger = recordClRequest(state.clRequestLedger, {
    purpose: CL_REQUEST_PURPOSES.QUOTA_PROBE,
    usefulProgress: false,
  }).ledger;
  const gate = evaluateClConservationGate(state.clRequestLedger, { canaryRequired: true });
  events.push({
    type: "AFTER_ONE_PROBE",
    requests: state.clRequestLedger.currentSessionRequests,
    streak: state.clRequestLedger.sequentialNonproductiveBeforeProgress,
    allowLaneA: gate.allow,
    reason: gate.reason,
  });

  const ok =
    reset.currentSessionRequests === 0 &&
    state.clRequestLedger.currentSessionRequests === 1 &&
    state.clRequestLedger.sequentialNonproductiveBeforeProgress === 1 &&
    gate.allow === true &&
    gate.reason == null &&
    state.humanReview.required === false &&
    state.queue3 === "NOT_OPEN" &&
    Array.isArray(state.historicalClSessions) &&
    state.historicalClSessions.length >= 1;

  return { ok, events, state, gate, courtListenerHttpCalls: 0, aiCalls: 0, mutations: 0 };
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
  QUEUE2_CL_CALLERS,
  createEmptyClRequestLedger,
  beginNewClRequestSession,
  shouldResetClSessionForNewWorker,
  assertQueue2AutonomousCallersInstrumented,
  replayNewWorkerSessionBoundary,
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
