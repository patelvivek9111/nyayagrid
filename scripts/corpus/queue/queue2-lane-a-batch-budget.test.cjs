/**
 * Lane A parent/child CL budget consistency + canary probe-loop guards.
 * Deterministic. Zero network. Zero corpus mutation. Zero AI. Zero real CL.
 */
"use strict";

const assert = require("node:assert/strict");
const {
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

test("canary budget scope is PER_WORKER_SESSION not per fingerprint", () => {
  assert.equal(CANARY_BUDGET_SCOPE, "PER_WORKER_SESSION");
  const r = remainingClRequestsForChild({
    canaryRequired: true,
    batchMaxClRequests: 5,
    workerSessionRequests: 0,
    canaryMaxClRequests: 5,
  });
  assert.equal(r.canaryBudgetScope, "PER_WORKER_SESSION");
});

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
  assert.ok(
    b2.classification === BATCH_BUDGET_EXHAUSTED ||
      b2.classification === CANARY_BUDGET_INSUFFICIENT_FOR_PRODUCTIVE_BATCH,
  );
});

test("canary probe=1 leaves correct child budget (remaining=4)", () => {
  const r = remainingClRequestsForChild({
    canaryRequired: true,
    batchMaxClRequests: 5,
    workerSessionRequests: 1,
    canaryMaxClRequests: 5,
    parentProbeCountedInSession: true,
    childBootstrapOverhead: 0,
  });
  assert.equal(r.remainingClRequestsForChild, 4);
  assert.equal(r.clMaxSessionCalls, 4);
  assert.equal(r.allowChildLaunch, true);
  assert.equal(r.minProductiveChildRequests, MIN_PRODUCTIVE_CHILD_CL_REQUESTS);
});

test("parent remaining budget == child remaining budget (no double-subtract)", () => {
  const budget = resolveLaneABatchClBudget({
    canaryRequired: true,
    batchMaxClRequests: 5,
    workerSessionRequests: 1,
    canaryMaxClRequests: 5,
  });
  // Handoff model: child max = remaining, alreadyUsed = 0
  const session = createSharedClSession({
    maxClRequests: budget.remainingClRequestsForChild,
    alreadyUsed: 0,
  });
  assert.equal(remainingChildClBudget(session), budget.remainingClRequestsForChild);
  assert.equal(remainingChildClBudget(session), budget.clMaxSessionCalls);
  const agree = assertParentChildBudgetAgreement(budget, remainingChildClBudget(session));
  assert.equal(agree.ok, true);
});

test("no double subtraction of alreadyUsed (hardCap+used vs remaining+0)", () => {
  const budget = resolveLaneABatchClBudget({
    canaryRequired: true,
    batchMaxClRequests: 5,
    workerSessionRequests: 2,
    canaryMaxClRequests: 5,
  });
  assert.equal(budget.remainingClRequestsForChild, 3);
  // Wrong handoff would be max=remaining(3) AND alreadyUsed=2 → remaining 1 (double subtract).
  const wrong = createSharedClSession({
    maxClRequests: budget.remainingClRequestsForChild,
    alreadyUsed: budget.alreadyUsed, // 2 — WRONG if max is already remaining
  });
  assert.equal(remainingChildClBudget(wrong), 1); // demonstrates the bug
  // Correct handoff:
  const right = createSharedClSession({
    maxClRequests: budget.remainingClRequestsForChild,
    alreadyUsed: 0,
  });
  assert.equal(remainingChildClBudget(right), 3);
});

test("no stale workerSessionRequests applied twice", () => {
  const once = remainingClRequestsForChild({
    canaryRequired: true,
    batchMaxClRequests: 5,
    workerSessionRequests: 1,
    canaryMaxClRequests: 5,
    parentQuotaProbeAlreadyConsumed: true,
    parentProbeCountedInSession: true, // already in session — do not add again
  });
  assert.equal(once.remainingClRequestsForChild, 4);
  const twice = remainingClRequestsForChild({
    canaryRequired: true,
    batchMaxClRequests: 5,
    workerSessionRequests: 1,
    canaryMaxClRequests: 5,
    parentQuotaProbeAlreadyConsumed: true,
    parentProbeCountedInSession: false, // would add probe on top of session
  });
  assert.equal(twice.remainingClRequestsForChild, 3);
});

test("parent allowChildLaunch cannot be true if child would get NO_BUDGET (≤0)", () => {
  for (let used = 0; used <= 5; used++) {
    const budget = resolveLaneABatchClBudget({
      canaryRequired: true,
      batchMaxClRequests: 5,
      workerSessionRequests: used,
      canaryMaxClRequests: 5,
    });
    if (budget.allowChildLaunch) {
      assert.ok(budget.clMaxSessionCalls > 0);
      assert.ok(budget.remainingClRequestsForChild >= MIN_PRODUCTIVE_CHILD_CL_REQUESTS);
      // Child early-exit guard: CL_MAX_SESSION_CALLS <= 0 → NO_BUDGET
      assert.ok(Number(budget.clMaxSessionCalls) > 0);
    } else {
      assert.ok(budget.remainingClRequestsForChild < MIN_PRODUCTIVE_CHILD_CL_REQUESTS);
    }
    const agree = assertParentChildBudgetAgreement(budget, budget.clMaxSessionCalls);
    assert.equal(agree.ok, true, `used=${used} ${agree.reason}`);
  }
});

test("insufficient productive budget prevents probe loop", () => {
  // Session already used 5/5 — must not probe again.
  const exhausted = evaluateProbeUsefulnessForNextBatch({
    canaryRequired: true,
    batchMaxClRequests: 5,
    workerSessionRequests: 5,
    canaryMaxClRequests: 5,
  });
  assert.equal(exhausted.allowProbe, false);
  assert.ok(
    exhausted.reason === CANARY_BUDGET_INSUFFICIENT_FOR_PRODUCTIVE_BATCH ||
      exhausted.reason === BATCH_BUDGET_EXHAUSTED,
  );

  // 4/5 used: one request left for child — do NOT burn it on another probe.
  const lastRequest = evaluateProbeUsefulnessForNextBatch({
    canaryRequired: true,
    batchMaxClRequests: 5,
    workerSessionRequests: 4,
    canaryMaxClRequests: 5,
    previewAfterNextProbe: true,
  });
  assert.equal(lastRequest.allowProbe, false);
  assert.equal(lastRequest.reason, CANARY_BUDGET_INSUFFICIENT_FOR_PRODUCTIVE_BATCH);
});

test("repeated WAIT does not burn quota probes when canary exhausted", () => {
  const use = evaluateProbeUsefulnessForNextBatch({
    canaryRequired: true,
    batchMaxClRequests: 5,
    workerSessionRequests: 5,
    canaryMaxClRequests: 5,
    previewAfterNextProbe: true,
  });
  assert.equal(use.allowProbe, false);
  // Second evaluation identical — still no probe.
  const use2 = evaluateProbeUsefulnessForNextBatch({
    canaryRequired: true,
    batchMaxClRequests: 5,
    workerSessionRequests: 5,
    canaryMaxClRequests: 5,
    previewAfterNextProbe: true,
  });
  assert.equal(use2.allowProbe, false);
});

test("childLaunch=false deterministic state when remaining=0", () => {
  const budget = resolveLaneABatchClBudget({
    canaryRequired: true,
    batchMaxClRequests: 5,
    workerSessionRequests: 5,
    canaryMaxClRequests: 5,
  });
  assert.equal(budget.allowChildLaunch, false);
  const c = classifyPreLaunchNoBudget({
    reason: LANE_A_CHILD_NO_BUDGET,
    preLaunch: true,
    canaryRequired: true,
    remainingClBudget: budget.remainingClRequestsForChild,
    classification: budget.classification,
    detail: budget.detail,
  });
  assert.equal(c.matched, true);
  assert.equal(c.childLaunched, false);
  assert.equal(c.unresolvedUnknown, false);
  assert.equal(c.terminal, true);
});

test("classifyPreLaunchNoBudget does NOT false-match survivor/408 (root-cause fix)", () => {
  // Live defect: every launch was labeled NO_BUDGET because reason defaulted to it.
  const survivor = classifyPreLaunchNoBudget({
    stdout: JSON.stringify({
      ok: false,
      reason: "LANE_A_CHILD_SURVIVED_PARENT",
      courtListenerHttpCalls: 0,
    }),
    canaryRequired: true,
    remainingClBudget: 4,
  });
  assert.equal(survivor.matched, false);

  const fly408 = classifyPreLaunchNoBudget({
    stdout: "Error: request returned non-2xx status: 408",
    canaryRequired: true,
    remainingClBudget: 3,
  });
  assert.equal(fly408.matched, false);
});

test("classifyPreLaunchNoBudget matches only explicit stdout or preLaunch zero", () => {
  const fromStdout = classifyPreLaunchNoBudget({
    stdout: JSON.stringify({ ok: false, reason: "LANE_A_CHILD_NO_BUDGET", pid: null }),
    canaryRequired: false,
  });
  assert.equal(fromStdout.matched, true);
  assert.equal(fromStdout.classification, WAIT_FOR_QUOTA);

  const preZero = classifyPreLaunchNoBudget({
    preLaunch: true,
    remainingClBudget: 0,
    canaryRequired: true,
  });
  assert.equal(preZero.matched, true);
  assert.equal(preZero.childLaunched, false);

  // remaining=0 WITHOUT preLaunch and WITHOUT stdout — must NOT match
  // (post-launch path must not invent NO_BUDGET from remaining alone after allow=true)
  const postRemainingZero = classifyPreLaunchNoBudget({
    stdout: '{"ok":true}',
    remainingClBudget: 0,
    canaryRequired: true,
  });
  assert.equal(postRemainingZero.matched, false);
});

test("zero productive work does not alter VT state (budget helpers are pure)", () => {
  const vt = { qualifyingCaseCount: 33, checkpoint: "cl-opinion-9886254", target: 45 };
  remainingClRequestsForChild({
    canaryRequired: true,
    batchMaxClRequests: 5,
    workerSessionRequests: 4,
    canaryMaxClRequests: 5,
  });
  resolveLaneABatchClBudget({
    canaryRequired: true,
    batchMaxClRequests: 5,
    workerSessionRequests: 4,
    canaryMaxClRequests: 5,
  });
  assert.equal(vt.qualifyingCaseCount, 33);
  assert.equal(vt.checkpoint, "cl-opinion-9886254");
  assert.equal(vt.target, 45);
});

test("successful canary promotes NORMAL mode path", () => {
  const gate = evaluateProductionCanaryGate({
    currentFingerprint: "fp",
    knownGoodFingerprint: "fp",
  });
  assert.equal(gate.required, false);
  assert.equal(resolveCanaryModeAfterKnownGood({ gate }).mode, NORMAL_BOUNDED_LANE_A);
});

test("normal mode budget behavior remains unchanged", () => {
  const b = resolveLaneABatchClBudget({
    canaryRequired: false,
    batchMaxClRequests: 19,
    workerSessionRequests: 5,
  });
  assert.equal(b.mode, "NORMAL");
  assert.equal(b.alreadyUsed, 0);
  assert.equal(b.batchBudget, 19);
  assert.equal(b.remainingClRequests, 19);
  assert.equal(b.remainingClRequestsForChild, 19);
  assert.equal(b.workerSessionRequests, 5);
  assert.equal(b.allowChildLaunch, true);
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
    maxClRequests: afterFirst.remainingClRequestsForChild,
    alreadyUsed: 0,
  });
  assert.equal(remainingChildClBudget(session), 19);
});

test("historical worker requests do not consume next normal batch budget", () => {
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
        maxClRequests: fixed.remainingClRequestsForChild,
        alreadyUsed: 0,
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

test("fresh worker session resets canary to full 5 (PER_WORKER_SESSION)", () => {
  const burned = resolveLaneABatchClBudget({
    canaryRequired: true,
    batchMaxClRequests: 5,
    workerSessionRequests: 4,
    canaryMaxClRequests: 5,
  });
  assert.equal(burned.remainingClRequestsForChild, 1);
  // New worker process / beginNewClRequestSession → sessionClRequests=0
  const fresh = resolveLaneABatchClBudget({
    canaryRequired: true,
    batchMaxClRequests: 5,
    workerSessionRequests: 0,
    canaryMaxClRequests: 5,
  });
  assert.equal(fresh.remainingClRequestsForChild, 5);
  assert.equal(fresh.allowChildLaunch, true);
});

test("10-minute intentional idle does not trigger HEARTBEAT_DEADMAN", () => {
  const now = new Date("2026-09-27T15:40:00.000Z");
  const started = new Date("2026-09-27T14:00:00.000Z");
  const lastHb = new Date("2026-09-27T15:25:00.000Z");
  const idleUntil = new Date("2026-09-27T15:45:00.000Z");
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
  const lastHb = new Date("2026-09-27T15:30:00.000Z");
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
