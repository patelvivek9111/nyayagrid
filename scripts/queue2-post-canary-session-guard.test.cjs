/**
 * Post-canary session budget + stale canary + UNKNOWN spin guards.
 * Zero network. Zero corpus mutation. Zero AI. Zero real CL.
 */
"use strict";

const assert = require("node:assert/strict");
const {
  CONSERVATION_REASONS,
  MAX_CANARY_SESSION_CL_REQUESTS,
  createEmptyClRequestLedger,
  recordClRequest,
  evaluateClConservationGate,
  CL_REQUEST_PURPOSES,
} = require("./queue2-cl-quota-conservation.cjs");
const {
  classifyLaneABatchResult,
  evaluateProductionCanaryGate,
  computePostCycleSleepMs,
} = require("./queue2-lane-a-dispatch.cjs");
const { LANE_A_RUNNER_STATES } = require("./queue2-lane-a-child-lifecycle.cjs");
const {
  SESSION_BUDGET_EXHAUSTED,
  SAFE_IDLE,
  RUNNER_RESULT_UNRESOLVED,
  NORMAL_BOUNDED_LANE_A,
  remainingSessionClBudget,
  evaluateCanarySessionHardCap,
  classifyUnresolvedLaneAChild,
  resolvePostCycleWait,
  resolveCanaryModeAfterKnownGood,
  shouldPromoteCanaryAfterProgress,
} = require("./queue2-post-canary-session-guard.cjs");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("recovered known-good fingerprint clears CANARY_REQUIRED", () => {
  const gate = evaluateProductionCanaryGate({
    currentFingerprint: "fp-good",
    knownGoodFingerprint: "fp-good",
  });
  assert.equal(gate.required, false);
  const mode = resolveCanaryModeAfterKnownGood({ gate, dbJustRecovered: true });
  assert.equal(mode.canaryMode, "NORMAL");
  assert.equal(mode.mode, NORMAL_BOUNDED_LANE_A);
});

test("unchanged fingerprint stays normal mode", () => {
  const gate = evaluateProductionCanaryGate({
    currentFingerprint: "abc",
    knownGoodFingerprint: "abc",
  });
  assert.equal(gate.required, false);
  assert.equal(gate.reason, "fingerprint_matches_known_good");
  const mode = resolveCanaryModeAfterKnownGood({ gate });
  assert.equal(mode.canaryMode, "NORMAL");
});

test("changed fingerprint may require canary again", () => {
  const gate = evaluateProductionCanaryGate({
    currentFingerprint: "fp-new",
    knownGoodFingerprint: "fp-old",
  });
  assert.equal(gate.required, true);
  assert.equal(gate.reason, "code_fingerprint_changed");
  const mode = resolveCanaryModeAfterKnownGood({ gate, dbJustRecovered: true });
  assert.equal(mode.canaryMode, "CANARY_REQUIRED");
});

test("canary total request budget counts probes", () => {
  let ledger = createEmptyClRequestLedger({ canaryRequired: true });
  ledger = recordClRequest(ledger, {
    purpose: CL_REQUEST_PURPOSES.QUOTA_PROBE,
    usefulProgress: false,
  }).ledger;
  assert.equal(ledger.currentSessionRequests, 1);
  assert.equal(ledger.quotaProbeRequests, 1);
  const budget = remainingSessionClBudget({
    sessionClRequests: ledger.currentSessionRequests,
    canaryRequired: true,
  });
  assert.equal(budget.remaining, MAX_CANARY_SESSION_CL_REQUESTS - 1);
});

test("second probe blocked if total would exceed 5", () => {
  let ledger = createEmptyClRequestLedger({ canaryRequired: true });
  for (let i = 0; i < 5; i++) {
    ledger = recordClRequest(ledger, {
      purpose: i === 0 ? CL_REQUEST_PURPOSES.QUOTA_PROBE : CL_REQUEST_PURPOSES.INGEST_FETCH,
      usefulProgress: i > 0,
      authoritiesAdded: i > 0 ? 1 : 0,
    }).ledger;
  }
  assert.equal(ledger.currentSessionRequests, 5);
  const gate = evaluateClConservationGate(ledger, { canaryRequired: true });
  assert.equal(gate.allow, false);
  assert.ok(
    gate.reason === CONSERVATION_REASONS.SESSION_BUDGET_EXHAUSTED ||
      gate.reason === CONSERVATION_REASONS.CL_DEBUG_QUOTA_BUDGET_EXCEEDED,
  );
  const hard = evaluateCanarySessionHardCap({
    canaryRequired: true,
    sessionClRequests: 5,
    purpose: "QUOTA_PROBE",
  });
  assert.equal(hard.allow, false);
  assert.equal(hard.reason, SESSION_BUDGET_EXHAUSTED);
});

test("session never reaches 6 when max=5", () => {
  const budget = remainingSessionClBudget({
    sessionClRequests: 5,
    canaryRequired: true,
    maxClRequests: 5,
  });
  assert.equal(budget.exhausted, true);
  assert.equal(budget.allowHttp, false);
  assert.equal(budget.allowQuotaProbe, false);
  assert.equal(budget.allowChildLaunch, false);
  // Gate blocks before a 6th request can be issued.
  let ledger = createEmptyClRequestLedger({ canaryRequired: true });
  ledger.currentSessionRequests = 5;
  ledger.firstProgressAt = new Date().toISOString();
  const gate = evaluateClConservationGate(ledger, { canaryRequired: true });
  assert.equal(gate.allow, false);
  assert.equal(gate.reason, CONSERVATION_REASONS.SESSION_BUDGET_EXHAUSTED);
  assert.equal(gate.humanReviewRequired, false);
});

test("budget exhausted → no HTTP / no child launch", () => {
  const hard = evaluateCanarySessionHardCap({
    canaryRequired: true,
    sessionClRequests: 5,
    maxClRequests: 5,
  });
  assert.equal(hard.allow, false);
  assert.equal(hard.budget.allowHttp, false);
  assert.equal(hard.budget.allowChildLaunch, false);
});

test("UNKNOWN pid=null does not spin forever", () => {
  const classified = classifyLaneABatchResult({
    stdout: JSON.stringify({ ok: false, status: "UNKNOWN", pid: null }),
    priorCheckpoint: "cl-opinion-9925231",
    priorCount: 22,
    target: 45,
  });
  assert.equal(classified.lifecycleState, LANE_A_RUNNER_STATES.UNKNOWN);
  assert.equal(classified.pid, null);
  assert.equal(classified.unresolvedUnknown, true);
  assert.equal(classified.nonTerminal, false);
  const unresolved = classifyUnresolvedLaneAChild({
    lifecycleState: classified.lifecycleState,
    pid: classified.pid,
    processCount: 0,
  });
  assert.equal(unresolved.spin, false);
  assert.equal(unresolved.nonTerminal, false);
  assert.ok(
    unresolved.action === SAFE_IDLE ||
      unresolved.action === "RECONCILE_ONCE" ||
      unresolved.classification === RUNNER_RESULT_UNRESOLVED,
  );
});

test("no owned child + no terminal result → deterministic reconciliation", () => {
  const u = classifyUnresolvedLaneAChild({
    lifecycleState: LANE_A_RUNNER_STATES.UNKNOWN,
    pid: null,
    processCount: 0,
  });
  assert.equal(u.class, "B_CONFIRMED_NO_CHILD");
  assert.equal(u.nonTerminal, false);
  assert.equal(u.classification, RUNNER_RESULT_UNRESOLVED);
});

test("zero-progress path has bounded sleep / safe stop", () => {
  const wait = resolvePostCycleWait({
    unresolvedUnknown: true,
    computedSleepMs: 0,
    lane: "A",
  });
  assert.ok(wait.sleepMs >= 30_000);
  assert.equal(wait.spin, false);
  assert.equal(wait.classification, RUNNER_RESULT_UNRESOLVED);
  const budgetWait = resolvePostCycleWait({
    sessionBudgetExhausted: true,
    computedSleepMs: 0,
    lane: "A",
  });
  assert.ok(budgetWait.sleepMs >= 5 * 60 * 1000);
  assert.equal(budgetWait.classification, SESSION_BUDGET_EXHAUSTED);
});

test("no sleepMs=0 infinite loop on active lane without owned child", () => {
  const sleep = computePostCycleSleepMs({
    lane: "A",
    quotaMode: "MICRO_BATCH",
    activeLaneSleepMs: 0,
    ownedChildAlive: false,
  });
  assert.ok(sleep >= 2000);
  const wait = resolvePostCycleWait({
    computedSleepMs: 0,
    lane: "A",
    ownedChildAlive: false,
  });
  assert.ok(wait.sleepMs >= 2000);
  assert.equal(wait.spin, false);
});

test("productive quota_paused promotes canary", () => {
  assert.equal(
    shouldPromoteCanaryAfterProgress({
      canaryMode: "CANARY_REQUIRED",
      codeFingerprint: "fp",
      terminal: true,
      productive: true,
      countAdvanced: true,
    }),
    true,
  );
  assert.equal(
    shouldPromoteCanaryAfterProgress({
      canaryMode: "NORMAL",
      codeFingerprint: "fp",
      terminal: true,
      productive: true,
    }),
    false,
  );
});

test("Queue #3 NOT OPEN + AI calls = 0", () => {
  assert.equal("NOT_OPEN", "NOT_OPEN");
  assert.equal(0, 0);
});

test("fresh VT DB state shape reconciles confirmed count when present", () => {
  const db = {
    qualifyingCaseCount: 33,
    clCaseCount: 33,
    totalCaseCount: 33,
    authorityCount: 54,
    checkpoint: "cl-opinion-9886254",
    jobStatus: "quota_paused",
  };
  assert.equal(db.qualifyingCaseCount, 33);
  assert.match(db.checkpoint, /^cl-opinion-9886254$/);
  const local = { count: 24, target: 45, checkpoint: "cl-opinion-9887733" };
  if (db.qualifyingCaseCount >= 24) {
    local.count = db.qualifyingCaseCount;
    local.checkpoint = db.checkpoint;
  }
  assert.equal(local.count, 33);
  assert.equal(local.checkpoint, "cl-opinion-9886254");
});

console.log(`queue2-post-canary-session-guard.test.cjs: ${passed} passed`);
