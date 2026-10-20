/**
 * Queue #2 Lane A child-process lifecycle tests.
 * Zero network. Zero corpus mutation. Zero AI. Zero real CL ingestion.
 */
"use strict";

const assert = require("node:assert/strict");
const {
  LANE_A_RUNNER_STATES,
  CANARY_MAX_SESSION_CL_REQUESTS,
  createEmptySessionQuota,
  createLaneAChildRecord,
  mayLaunchLaneAChild,
  markLaneAChildTerminal,
  isFreshPostRunDbEvidence,
  updateSessionQuotaAccounting,
  canarySessionRequestCapExceeded,
  evaluateCanaryAfterTerminal,
  parseLaneARunnerStdoutPreferTerminal,
} = require("./queue2-lane-a-child-lifecycle.cjs");
const {
  classifyLaneABatchResult,
  shouldRaiseLaneAZeroProgress,
  resolveLaneABatchBounds,
} = require("./queue2-lane-a-dispatch.cjs");
const { createInitialState } = require("./queue2-dual-lane-controller.cjs");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("STARTED result is non-terminal", () => {
  const classified = classifyLaneABatchResult({
    stdout: JSON.stringify({ ok: true, started: true, pid: 15394, clCourt: "mich", batchSize: 3, targetMax: 45 }),
    priorCheckpoint: "cl-opinion-11250867",
    priorCount: 20,
    target: 45,
  });
  assert.equal(classified.lifecycleState, LANE_A_RUNNER_STATES.STARTED);
  assert.equal(classified.terminal, false);
  assert.equal(classified.nonTerminal, true);
  assert.equal(classified.noProgress, false);
  assert.equal(classified.productive, false);
  assert.equal(classified.apiCalls, 0);
  assert.equal(classified.itemsImported, 0);
});

test("RUNNING result is non-terminal", () => {
  const classified = classifyLaneABatchResult({
    stdout: JSON.stringify({ ok: true, status: "running", pid: 1 }),
    priorCount: 20,
    target: 45,
  });
  assert.equal(classified.lifecycleState, LANE_A_RUNNER_STATES.RUNNING);
  assert.equal(classified.terminal, false);
  assert.equal(classified.noProgress, false);
});

test("no zero progress on STARTED", () => {
  const classified = classifyLaneABatchResult({
    stdout: JSON.stringify({ ok: true, started: true, pid: 15394, clCourt: "mich" }),
    priorCheckpoint: "cl-opinion-11250867",
    priorCount: 20,
    target: 45,
  });
  assert.equal(
    shouldRaiseLaneAZeroProgress({
      classified,
      reconciled: { targetSatisfied: false, classification: "INCOMPLETE" },
      freshDbReconciled: true,
      jobRowRefreshed: true,
      currentBatchRequestCount: 0,
    }),
    false,
  );
});

test("no second child while first alive", () => {
  const state = createInitialState();
  state.laneAChild = createLaneAChildRecord({
    pid: 15394,
    court: "mich",
    expectedMaxAuthorities: 3,
    expectedMaxClRequests: 5,
  });
  const blocked = mayLaunchLaneAChild(state, { processAlive: true });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "LANE_A_CHILD_ALREADY_ACTIVE");
  assert.equal(blocked.pid, 15394);
});

test("dead child reconciled before relaunch", () => {
  let state = createInitialState();
  state.laneAChild = createLaneAChildRecord({ pid: 15394, court: "mich" });
  state = markLaneAChildTerminal(state, {
    lifecycleState: LANE_A_RUNNER_STATES.COMPLETED,
    now: new Date(),
  });
  const gate = mayLaunchLaneAChild(state, { processAlive: false });
  assert.equal(gate.ok, true);
});

test("terminal completion required before canary verdict", () => {
  const pending = evaluateCanaryAfterTerminal({
    canaryRequired: true,
    terminal: false,
    productive: false,
  });
  assert.equal(pending.canaryPass, false);
  assert.equal(pending.reason, "awaiting_terminal");

  const pass = evaluateCanaryAfterTerminal({
    canaryRequired: true,
    terminal: true,
    productive: true,
    checkpointAdvanced: true,
    countAdvanced: true,
    sessionQuota: { sessionClRequests: 3 },
  });
  assert.equal(pass.canaryPass, true);
  assert.equal(pass.reason, "CANARY_PASS");
});

test("stale DB snapshot rejected as post-run evidence", () => {
  const r = isFreshPostRunDbEvidence({
    dbEvidenceObservedAt: "2026-09-25T17:30:48.994Z",
    laneARunnerStartedAt: "2026-09-25T17:39:00.000Z",
    runnerTerminalAt: "2026-09-25T17:40:00.000Z",
  });
  assert.equal(r.ok, false);
  assert.equal(r.postRunDbRefreshed, false);
});

test("fresh DB snapshot accepted", () => {
  const r = isFreshPostRunDbEvidence({
    dbEvidenceObservedAt: "2026-09-25T17:40:30.000Z",
    laneARunnerStartedAt: "2026-09-25T17:39:00.000Z",
    runnerTerminalAt: "2026-09-25T17:40:00.000Z",
  });
  assert.equal(r.ok, true);
  assert.equal(r.postRunDbRefreshed, true);
});

test("session request accounting excludes historical job requests", () => {
  let session = createEmptySessionQuota();
  session = updateSessionQuotaAccounting(session, {
    historicalJobApiCalls: 9,
    sessionClRequestDelta: 0,
  });
  assert.equal(session.historicalJobApiCallsBaseline, 9);
  assert.equal(session.sessionClRequests, 0);
  session = updateSessionQuotaAccounting(session, {
    historicalJobApiCalls: 9,
    sessionClRequestDelta: 3,
    productive: true,
  });
  assert.equal(session.sessionClRequests, 3);
  assert.equal(session.productiveClRequests, 3);
  assert.equal(session.historicalJobApiCallsBaseline, 9);
});

test("canary hard cap <=5 CL requests", () => {
  assert.equal(CANARY_MAX_SESSION_CL_REQUESTS, 5);
  const bounds = resolveLaneABatchBounds({
    canaryRequired: true,
    maxQualifyingAuthorities: 3,
    maxClRequests: 12, // even if caller passes 12, stabilization hard-caps at 5
    remainingAuthorities: 25,
    usableRequests: 28,
    requestsPerAuthorityEstimate: 2.3,
    checkpoint: "cl-opinion-11250867",
  });
  assert.ok(bounds.maxClRequests <= 5);
  assert.ok(bounds.authorities <= 3);
  const cap = canarySessionRequestCapExceeded({ sessionClRequests: 5 }, 5);
  assert.equal(cap.exceeded, true);
});

test("exact failure replay: started-only does not human-review", () => {
  const classified = classifyLaneABatchResult({
    stdout: JSON.stringify({ ok: true, started: true, pid: 15394 }),
    priorCheckpoint: "cl-opinion-11250867",
    priorCount: 20,
    target: 45,
  });
  assert.equal(classified.lifecycleState, "STARTED");
  assert.equal(classified.terminal, false);
  assert.equal(classified.noProgress, false);
  let state = createInitialState();
  state.laneAChild = createLaneAChildRecord({ pid: 15394, court: "mich" });
  state.runtimeState = "LANE_A_RUNNING";
  state.currentLane = "A";
  assert.notEqual(state.humanReview?.required, true);
  const second = mayLaunchLaneAChild(state, { processAlive: true });
  assert.equal(second.ok, false);
});

test("terminal success path: productive canary pass", () => {
  const stdout = [
    JSON.stringify({ ok: true, started: true, pid: 15394, clCourt: "mich" }),
    JSON.stringify({
      i: 1,
      fileResult: {
        ok: true,
        status: "completed",
        batchImported: 2,
        items_imported: 22,
        sessionApiCalls: 3,
        apiCalls: 3,
        last_successful_external_id: "cl-opinion-mi-new",
        cursor: "cl-opinion-mi-new",
      },
      hasFile: true,
    }),
  ].join("\n");
  const parsed = parseLaneARunnerStdoutPreferTerminal(stdout);
  assert.equal(parsed.terminal, true);
  const classified = classifyLaneABatchResult({
    stdout,
    priorCheckpoint: "cl-opinion-11250867",
    priorCount: 20,
    target: 45,
  });
  assert.equal(classified.terminal, true);
  assert.equal(classified.lifecycleState, LANE_A_RUNNER_STATES.COMPLETED);
  assert.equal(classified.checkpointAdvanced, true);
  assert.equal(classified.sessionApiCalls, 3);
  // historical job api_calls must not inflate session when only sessionApiCalls provided
  assert.equal(classified.apiCalls, 3);
  const canary = evaluateCanaryAfterTerminal({
    canaryRequired: true,
    terminal: true,
    productive: classified.productive,
    checkpointAdvanced: classified.checkpointAdvanced,
    countAdvanced: true,
    sessionQuota: { sessionClRequests: 3 },
  });
  assert.equal(canary.canaryPass, true);
  assert.equal(canary.promoteKnownGood, true);
});

test("Queue #3 never opens", () => {
  const state = createInitialState();
  assert.equal(state.queue3, "NOT_OPEN");
});

test("AI calls remain 0 on lifecycle module surface", () => {
  assert.equal(typeof createLaneAChildRecord, "function");
  assert.equal(createEmptySessionQuota().aiCalls, undefined);
});

console.log(`queue2-lane-a-child-lifecycle.test.cjs: ${passed} passed`);
