/**
 * Queue #2 Lane A remote child ownership tests.
 * Zero network. Zero corpus mutation. Zero AI. Zero real CourtListener HTTP.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  LANE_A_REMOTE_COMMAND,
  REMOTE_CHILD_REASONS,
  createRemoteChildOwnership,
  parseRemoteLaneAProcesses,
  evaluateLaneAProcessGate,
  maySpawnLaneARemoteChild,
  assertChildMayMakeClRequest,
  planRemoteChildTermination,
  clearLaneAChildOwnership,
  detectPidReuse,
  assertLauncherForbidsDetach,
  replayLaneARemoteChildOwnershipFlow,
} = require("./queue2-lane-a-remote-child.cjs");
const { createSharedClSession, remainingChildClBudget } = require("./queue2-lane-a-child-lifecycle.cjs");
const { HUMAN_REVIEW_REASONS } = require("./queue2-worker-observability.cjs");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("launcher source forbids detached/unref", () => {
  const src = fs.readFileSync(path.join(__dirname, "run-staging-cl-batch-job.cjs"), "utf8");
  const check = assertLauncherForbidsDetach(src);
  assert.equal(check.ok, true, check.violations.join(","));
});

test("parse ps lines with pid/ppid/args", () => {
  const procs = parseRemoteLaneAProcesses(
    [
      "PID   PPID ARGS",
      `100   50   node /tmp/${LANE_A_REMOTE_COMMAND}`,
      "101   1    grep staging-cl",
      `102   1    /usr/local/bin/node /tmp/${LANE_A_REMOTE_COMMAND}`,
    ].join("\n"),
  );
  assert.equal(procs.length, 2);
  assert.equal(procs[0].pid, 100);
  assert.equal(procs[0].ppid, 50);
  assert.equal(procs[1].orphanLikely, true);
});

test("process gate: 0 → allow launch", () => {
  const g = evaluateLaneAProcessGate({ processes: [], laneAChild: null });
  assert.equal(g.allowLaunch, true);
  assert.equal(g.count, 0);
});

test("process gate: 1 owned → already active, no spawn", () => {
  const ownership = createRemoteChildOwnership({
    pid: 100,
    sessionId: "s1",
    batchId: "b1",
  });
  const g = evaluateLaneAProcessGate({
    processes: [{ pid: 100, ppid: 50, args: `node /tmp/${LANE_A_REMOTE_COMMAND}` }],
    laneAChild: ownership,
  });
  assert.equal(g.allowLaunch, false);
  assert.equal(g.reason, REMOTE_CHILD_REASONS.LANE_A_CHILD_ALREADY_ACTIVE);
  assert.equal(g.superviseExisting, true);
  assert.equal(g.emergencyStop, false);
});

test("process gate: 1 orphan PPID=1 → ORPHAN_LANE_A_CHILD", () => {
  const g = evaluateLaneAProcessGate({
    processes: [{ pid: 101, ppid: 1, args: `node /tmp/${LANE_A_REMOTE_COMMAND}` }],
    laneAChild: null,
  });
  assert.equal(g.allowLaunch, false);
  assert.equal(g.reason, REMOTE_CHILD_REASONS.ORPHAN_LANE_A_CHILD);
  assert.equal(g.humanReviewRequired, true);
  assert.equal(g.courtListenerHttpCallsAllowed, false);
});

test("process gate: >1 → MULTIPLE_LANE_A_CHILDREN emergency", () => {
  const g = evaluateLaneAProcessGate({
    processes: [
      { pid: 1, ppid: 1, args: LANE_A_REMOTE_COMMAND },
      { pid: 2, ppid: 1, args: LANE_A_REMOTE_COMMAND },
      { pid: 3, ppid: 1, args: LANE_A_REMOTE_COMMAND },
    ],
    laneAChild: null,
  });
  assert.equal(g.emergencyStop, true);
  assert.equal(g.reason, REMOTE_CHILD_REASONS.MULTIPLE_LANE_A_CHILDREN);
  assert.equal(g.allowLaunch, false);
});

test("second spawn blocked while owned child alive", () => {
  const state = {
    laneAChild: createRemoteChildOwnership({
      pid: 100,
      sessionId: "s1",
      batchId: "b1",
    }),
  };
  const gate = evaluateLaneAProcessGate({
    processes: [{ pid: 100, ppid: 50, args: LANE_A_REMOTE_COMMAND }],
    laneAChild: state.laneAChild,
  });
  const spawn = maySpawnLaneARemoteChild(state, gate);
  assert.equal(spawn.ok, false);
  assert.equal(spawn.reason, REMOTE_CHILD_REASONS.LANE_A_CHILD_ALREADY_ACTIVE);
});

test("SIGINT cleanup plan: TERM → wait → KILL → clear", () => {
  const ownership = createRemoteChildOwnership({ pid: 100, sessionId: "s1", batchId: "b1" });
  const plan = planRemoteChildTermination(ownership, { graceMs: 10 });
  assert.equal(plan.ok, true);
  assert.deepEqual(
    plan.steps.map((s) => s.action),
    ["VERIFY_IDENTITY", "SIGTERM", "WAIT", "SIGKILL_IF_ALIVE", "CONFIRM_EXIT", "CLEAR_OWNERSHIP"],
  );
  let state = {
    laneA: { jobLifecycle: "RUNNING", jobStatus: "running" },
    laneAChild: ownership,
  };
  state = clearLaneAChildOwnership(state, {
    clearRecord: true,
    jobPaused: true,
    reason: "sigint_cleanup",
    exitCode: 0,
  });
  assert.equal(state.laneAChild, null);
  assert.equal(state.laneA.jobLifecycle, "PAUSED_RESUMABLE");
});

test("SIGTERM / exception / timeout share same termination plan", () => {
  const ownership = createRemoteChildOwnership({ pid: 55, batchId: "b", sessionId: "s" });
  for (const reason of ["SIGTERM", "exception", "timeout"]) {
    const plan = planRemoteChildTermination(ownership, { graceMs: 1 });
    assert.equal(plan.ok, true, reason);
    assert.equal(plan.pid, 55);
  }
});

test("PID reuse detection", () => {
  const ownership = createRemoteChildOwnership({
    pid: 100,
    command: LANE_A_REMOTE_COMMAND,
    startedAt: "2026-09-25T12:00:00.000Z",
  });
  const reuse = detectPidReuse(ownership, {
    pid: 100,
    args: "node /tmp/other-job.cjs",
  });
  assert.equal(reuse.reused, true);
  assert.equal(reuse.reason, REMOTE_CHILD_REASONS.LANE_A_CHILD_PID_MISMATCH);
});

test("no CL without ownership", () => {
  const r = assertChildMayMakeClRequest({
    laneAChild: null,
    sessionId: "s",
    batchId: "b",
    remainingClBudget: 5,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, REMOTE_CHILD_REASONS.LANE_A_CHILD_OWNERSHIP_LOST);
});

test("no CL if multiple matching children (gate blocks)", () => {
  const g = evaluateLaneAProcessGate({
    processes: [
      { pid: 1, ppid: 1, args: LANE_A_REMOTE_COMMAND },
      { pid: 2, ppid: 1, args: LANE_A_REMOTE_COMMAND },
    ],
  });
  assert.equal(g.courtListenerHttpCallsAllowed, false);
  assert.equal(g.emergencyStop, true);
});

test("no CL without session/budget", () => {
  const owned = createRemoteChildOwnership({ pid: 1, sessionId: null, batchId: null });
  assert.equal(assertChildMayMakeClRequest({ laneAChild: owned, remainingClBudget: 5 }).ok, false);
  const ownedOk = createRemoteChildOwnership({ pid: 1, sessionId: "s", batchId: "b" });
  assert.equal(
    assertChildMayMakeClRequest({ laneAChild: ownedOk, remainingClBudget: 0 }).ok,
    false,
  );
  assert.equal(
    assertChildMayMakeClRequest({ laneAChild: ownedOk, remainingClBudget: 3 }).ok,
    true,
  );
});

test("shared session budget preserved across ownership", () => {
  const session = createSharedClSession({
    sessionId: "sess-shared",
    batchId: "batch-1",
    maxClRequests: 5,
    alreadyUsed: 2,
  });
  assert.equal(remainingChildClBudget(session), 3);
  const owned = createRemoteChildOwnership({
    pid: 9,
    sessionId: session.sessionId,
    batchId: session.batchId,
  });
  assert.equal(
    assertChildMayMakeClRequest({
      laneAChild: owned,
      sessionId: session.sessionId,
      batchId: session.batchId,
      remainingClBudget: remainingChildClBudget(session),
    }).ok,
    true,
  );
});

test("exact regression replay", () => {
  const r = replayLaneARemoteChildOwnershipFlow();
  assert.equal(r.ok, true);
  assert.equal(r.courtListenerHttpCalls, 0);
  assert.equal(r.aiCalls, 0);
  assert.equal(r.mutations, 0);
  assert.equal(r.queue3, "NOT_OPEN");
  const cycle2 = r.events.find((e) => e.type === "CYCLE2_BLOCKED");
  assert.equal(cycle2.ok, false);
  assert.equal(cycle2.reason, REMOTE_CHILD_REASONS.LANE_A_CHILD_ALREADY_ACTIVE);
  const orphan = r.events.find((e) => e.type === "ORPHAN");
  assert.equal(orphan.reason, REMOTE_CHILD_REASONS.ORPHAN_LANE_A_CHILD);
  const multi = r.events.find((e) => e.type === "MULTI");
  assert.equal(multi.emergencyStop, true);
});

test("HUMAN_REVIEW_REASONS include remote-child codes", () => {
  assert.equal(HUMAN_REVIEW_REASONS.ORPHAN_LANE_A_CHILD, "ORPHAN_LANE_A_CHILD");
  assert.equal(HUMAN_REVIEW_REASONS.MULTIPLE_LANE_A_CHILDREN, "MULTIPLE_LANE_A_CHILDREN");
  assert.equal(HUMAN_REVIEW_REASONS.LANE_A_CHILD_ALREADY_ACTIVE, "LANE_A_CHILD_ALREADY_ACTIVE");
  assert.equal(HUMAN_REVIEW_REASONS.LANE_A_CHILD_OWNERSHIP_LOST, "LANE_A_CHILD_OWNERSHIP_LOST");
  assert.equal(HUMAN_REVIEW_REASONS.LANE_A_CHILD_PID_MISMATCH, "LANE_A_CHILD_PID_MISMATCH");
  assert.equal(HUMAN_REVIEW_REASONS.LANE_A_CHILD_SURVIVED_PARENT, "LANE_A_CHILD_SURVIVED_PARENT");
  assert.equal(HUMAN_REVIEW_REASONS.LANE_A_DUPLICATE_SPAWN_ATTEMPT, "LANE_A_DUPLICATE_SPAWN_ATTEMPT");
});

test("ownership cleared only after confirmed exit flag", () => {
  let state = {
    laneAChild: createRemoteChildOwnership({ pid: 100, sessionId: "s", batchId: "b" }),
  };
  state = clearLaneAChildOwnership(state, { clearRecord: false, reason: "mark_only" });
  assert.equal(state.laneAChild.terminal, true);
  assert.ok(state.laneAChild.pid === 100);
  state = clearLaneAChildOwnership(state, { clearRecord: true, reason: "confirmed_exit" });
  assert.equal(state.laneAChild, null);
});

console.log(JSON.stringify({ ok: true, passed, courtListenerHttpCalls: 0, aiCalls: 0, queue3: "NOT_OPEN" }));
