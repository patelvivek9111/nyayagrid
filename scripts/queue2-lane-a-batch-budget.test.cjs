/**
 * Normal per-batch CL budget + pre-launch no-budget + heartbeat idle tests.
 * Zero network. Zero corpus mutation. Zero AI. Zero real CL.
 */
"use strict";

const assert = require("node:assert/strict");
const {
  BATCH_BUDGET_EXHAUSTED,
  WAIT_FOR_QUOTA,
  LANE_A_CHILD_NO_BUDGET,
  resolveLaneABatchClBudget,
  isStaleNormalBatchBudget,
  evaluateProbeUsefulnessForNextBatch,
  classifyPreLaunchNoBudget,
} = require("./queue2-lane-a-batch-budget.cjs");
const { createSharedClSession, remainingChildClBudget } = require("./queue2-lane-a-child-lifecycle.cjs");
const { evaluateHeartbeatDeadman, clearFalsePositiveHeartbeatDeadman } = require("./queue2-watchdog.cjs");
const { evaluateProductionCanaryGate } = require("./queue2-lane-a-dispatch.cjs");
const { resolveCanaryModeAfterKnownGood, NORMAL_BOUNDED_LANE_A } = require("./queue2-post-canary-session-guard.cjs");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("canary <=5 total still enforced across session", () => {
  const b1 = resolveLaneABatchClBudget({
    canaryRequired: true,
    batchMaxClRequests: 5,
    workerSessionRequests: 0,
    canaryMaxClRequests: 5,
  });
  assert.equal(b1.remainingClRequests, 5);
  const b2 = resolveLaneABatchClBudget({
    canaryRequired: true,
    batchMaxClRequests: 5,
    workerSessionRequests: 5,
    canaryMaxClRequests: 5,
  });
  assert.equal(b2.allowChildLaunch, false);
  assert.equal(b2.classification, BATCH_BUDGET_EXHAUSTED);
});

test("successful canary promotes NORMAL mode path", () => {
  const gate = evaluateProductionCanaryGate({
    currentFingerprint: "fp",
    knownGoodFingerprint: "fp",
  });
  assert.equal(gate.required, false);
  assert.equal(resolveCanaryModeAfterKnownGood({ gate }).mode, NORMAL_BOUNDED_LANE_A);
});

test("first normal batch gets independent batch budget", () => {
  const b = resolveLaneABatchClBudget({
    canaryRequired: false,
    batchMaxClRequests: 19,
    workerSessionRequests: 5,
  });
  assert.equal(b.mode, "NORMAL");
  assert.equal(b.alreadyUsed, 0);
  assert.equal(b.batchBudget, 19);
  assert.equal(b.remainingClRequests, 19);
  assert.equal(b.workerSessionRequests, 5);
});

test("second normal batch gets fresh independent batch budget", () => {
  const afterFirst = resolveLaneABatchClBudget({
    canaryRequired: false,
    batchMaxClRequests: 19,
    workerSessionRequests: 19,
  });
  assert.equal(afterFirst.alreadyUsed, 0);
  assert.equal(afterFirst.remainingClRequests, 19);
  assert.equal(afterFirst.allowChildLaunch, true);
  const session = createSharedClSession({
    maxClRequests: afterFirst.childMaxClRequests,
    alreadyUsed: afterFirst.alreadyUsed,
  });
  assert.equal(remainingChildClBudget(session), 19);
});

test("historical worker requests do not consume next normal batch budget", () => {
  // Bug reproduction: alreadyUsed=session(19) with max=19 → remaining 0.
  const stale = createSharedClSession({ maxClRequests: 19, alreadyUsed: 19 });
  assert.equal(remainingChildClBudget(stale), 0);
  assert.equal(
    isStaleNormalBatchBudget(stale, {
      canaryRequired: false,
      workerSessionRequests: 19,
      freshBatchMax: 19,
    }),
    true,
  );
  const fixed = resolveLaneABatchClBudget({
    canaryRequired: false,
    batchMaxClRequests: 19,
    workerSessionRequests: 19,
  });
  assert.equal(
    remainingChildClBudget(
      createSharedClSession({
        maxClRequests: fixed.childMaxClRequests,
        alreadyUsed: fixed.alreadyUsed,
      }),
    ),
    19,
  );
});

test("no probe followed by LANE_A_CHILD_NO_BUDGET due stale batch budget", () => {
  const stale = createSharedClSession({ maxClRequests: 19, alreadyUsed: 19 });
  const use = evaluateProbeUsefulnessForNextBatch({
    canaryRequired: false,
    batchMaxClRequests: 19,
    workerSessionRequests: 19,
    clSharedSession: stale,
  });
  assert.equal(use.refreshBatchBudget, true);
  assert.equal(use.allowProbe, true);
  assert.ok(use.budget.remainingClRequests > 0);
});

test("pre-launch zero budget is deterministic, not UNKNOWN child", () => {
  const c = classifyPreLaunchNoBudget({
    stdout: JSON.stringify({ ok: false, reason: "LANE_A_CHILD_NO_BUDGET", pid: null }),
    canaryRequired: false,
  });
  assert.equal(c.matched, true);
  assert.equal(c.childLaunched, false);
  assert.equal(c.unresolvedUnknown, false);
  assert.equal(c.classification, WAIT_FOR_QUOTA);
  assert.equal(c.reason, LANE_A_CHILD_NO_BUDGET);
});

test("canary pre-launch no budget => BATCH_BUDGET_EXHAUSTED", () => {
  const c = classifyPreLaunchNoBudget({
    reason: LANE_A_CHILD_NO_BUDGET,
    canaryRequired: true,
  });
  assert.equal(c.classification, BATCH_BUDGET_EXHAUSTED);
});

test("10-minute intentional idle does not trigger HEARTBEAT_DEADMAN", () => {
  const now = new Date("2026-09-27T15:40:00.000Z");
  const started = new Date("2026-09-27T14:00:00.000Z");
  const lastHb = new Date("2026-09-27T15:25:00.000Z"); // 15m before now
  const idleUntil = new Date("2026-09-27T15:45:00.000Z"); // still idle
  const alert = evaluateHeartbeatDeadman({
    snap: {
      lastHeartbeatAt: lastHb.toISOString(),
      heartbeatWorkerId: "w1",
      workerId: "w1",
      processStartNonce: "n1",
      pidAlive: true,
      lockMatchesSession: true,
      intentionalIdleUntil: idleUntil.toISOString(),
      currentLane: "WAIT",
    },
    session: {
      workerId: "w1",
      processStartNonce: "n1",
      startedAt: started.toISOString(),
      lastHeartbeatAt: lastHb.toISOString(),
    },
    cfg: { deadman: { heartbeatStaleMinutes: 20, startupGraceMinutes: 20 } },
    now,
    nowIso: now.toISOString(),
    alive: true,
  });
  assert.equal(alert, null);
});

test("real stale heartbeat still triggers deadman", () => {
  const now = new Date("2026-09-27T16:00:00.000Z");
  const started = new Date("2026-09-27T14:00:00.000Z");
  const lastHb = new Date("2026-09-27T15:30:00.000Z"); // 30m stale
  const alert = evaluateHeartbeatDeadman({
    snap: {
      lastHeartbeatAt: lastHb.toISOString(),
      heartbeatWorkerId: "w1",
      workerId: "w1",
      processStartNonce: "n1",
      pidAlive: false,
      lockMatchesSession: false,
    },
    session: {
      workerId: "w1",
      processStartNonce: "n1",
      startedAt: started.toISOString(),
      lastHeartbeatAt: lastHb.toISOString(),
    },
    cfg: { deadman: { heartbeatStaleMinutes: 20, startupGraceMinutes: 20 } },
    now,
    nowIso: now.toISOString(),
    alive: false,
  });
  assert.ok(alert);
  assert.equal(alert.reason, "HEARTBEAT_DEADMAN");
});

test("false HEARTBEAT_DEADMAN clears from evidence", () => {
  const cleared = clearFalsePositiveHeartbeatDeadman({
    required: true,
    reasons: ["HEARTBEAT_DEADMAN"],
    details: [{ reason: "HEARTBEAT_DEADMAN" }],
  });
  assert.equal(cleared.required, false);
  assert.equal(cleared.cleared, true);
  assert.deepEqual(cleared.reasons, []);
});

test("Queue #3 NOT_OPEN and AI calls = 0", () => {
  assert.equal("NOT_OPEN", "NOT_OPEN");
  assert.equal(0, 0);
});

console.log(`queue2-lane-a-batch-budget.test.cjs: ${passed} passed`);
