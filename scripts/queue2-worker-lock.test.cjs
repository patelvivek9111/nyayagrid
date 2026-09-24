/**
 * Queue #2 ownership lock + heartbeat + milestone policy tests.
 * Deterministic — no network, no AI, no model tournaments.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  acquireWorkerLock,
  refreshWorkerHeartbeat,
  releaseWorkerLock,
  classifyLock,
  assertQueue2Access,
  refuseIfForeignOwner,
  selectMilestoneGitPaths,
  heartbeatImpliesGitCommit,
  ACTIVE_REFUSAL_CODE,
  HEARTBEAT_INTERVAL_MS,
  STALE_LOCK_MS,
  buildLock,
  writeLockFile,
  lockPathFor,
  MILESTONE_EVIDENCE_PATHS,
} = require("./queue2-worker-lock.cjs");
const {
  decideLane,
  applyQuotaFloorTransition,
  applyQuotaRecoveryTransition,
  createInitialState,
  restoreState,
  HUMAN_REVIEW_REASONS,
} = require("./queue2-dual-lane-controller.cjs");
const {
  evaluateHumanReviewTriggers,
  shouldEmitHeartbeat,
  makeEvent,
  HEARTBEAT_INTERVAL_MS: OBS_HB_MS,
} = require("./queue2-worker-observability.cjs");
const { planMilestoneCommit } = require("./queue2-milestone-push.cjs");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

function tmpReports() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "q2-lock-"));
}

test("first lock acquisition succeeds", () => {
  const dir = tmpReports();
  const r = acquireWorkerLock({
    reportsDir: dir,
    workerId: "w1",
    processStartNonce: "n1",
    currentLane: "LANE_B_OFFLINE",
    currentTask: "boot",
    court: "ark",
    checkpoint: "cl-opinion-9885161",
  });
  assert.equal(r.ok, true);
  assert.equal(r.code, "LOCK_ACQUIRED");
  assert.equal(r.lock.workerId, "w1");
  assert.equal(r.lock.schemaVersion, 1);
  assert.ok(fs.existsSync(lockPathFor(dir)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("second mutator blocked with QUEUE2_WORKER_ACTIVE", () => {
  const dir = tmpReports();
  const first = acquireWorkerLock({
    reportsDir: dir,
    workerId: "owner",
    processStartNonce: "n-owner",
    pid: process.pid,
    isPidAlive: () => true,
  });
  assert.equal(first.ok, true);

  const second = acquireWorkerLock({
    reportsDir: dir,
    workerId: "intruder",
    processStartNonce: "n-intruder",
    isPidAlive: () => true,
  });
  assert.equal(second.ok, false);
  assert.equal(second.code, ACTIVE_REFUSAL_CODE);
  assert.match(second.refusal, /QUEUE2_WORKER_ACTIVE/);
  assert.match(second.refusal, /workerId=owner/);
  assert.match(second.refusal, /lastHeartbeat=/);

  const refuse = refuseIfForeignOwner({
    reportsDir: dir,
    workerId: "intruder",
    processStartNonce: "n-intruder",
    isPidAlive: () => true,
  });
  assert.equal(refuse.ok, false);
  assert.equal(refuse.code, ACTIVE_REFUSAL_CODE);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("read-only operation allowed while worker owns lock", () => {
  const dir = tmpReports();
  acquireWorkerLock({
    reportsDir: dir,
    workerId: "owner",
    processStartNonce: "n1",
    isPidAlive: () => true,
  });
  const ro = assertQueue2Access({
    reportsDir: dir,
    mode: "readonly",
    workerId: "reader",
    isPidAlive: () => true,
  });
  assert.equal(ro.allowed, true);
  assert.equal(ro.mode, "readonly");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("heartbeat refresh is local-only with zero AI and no git push", () => {
  const dir = tmpReports();
  acquireWorkerLock({
    reportsDir: dir,
    workerId: "w1",
    processStartNonce: "n1",
    currentLane: "LANE_A_CL",
  });
  const before = Date.now();
  const hb = refreshWorkerHeartbeat({
    reportsDir: dir,
    workerId: "w1",
    processStartNonce: "n1",
    now: new Date(before + 1000),
    currentLane: "LANE_B_OFFLINE",
    currentTask: "citation_re_resolution",
    court: "ark",
    checkpoint: "cl-opinion-9885161",
  });
  assert.equal(hb.ok, true);
  assert.equal(hb.aiCalls, 0);
  assert.equal(hb.gitPush, false);
  assert.equal(hb.lock.currentLane, "LANE_B_OFFLINE");
  assert.equal(hb.lock.checkpoint, "cl-opinion-9885161");
  assert.equal(heartbeatImpliesGitCommit(), false);
  assert.equal(HEARTBEAT_INTERVAL_MS, 15 * 60 * 1000);
  assert.equal(OBS_HB_MS, 15 * 60 * 1000);
  // Ensure lock module source has no AI provider requires
  const src = fs.readFileSync(path.join(__dirname, "queue2-worker-lock.cjs"), "utf8");
  assert.equal(/openai|anthropic|@google\/generative|xai|cursor.?agent/i.test(src), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("stale lock detection when pid dead and heartbeat old", () => {
  const now = new Date("2026-09-24T18:00:00.000Z");
  const lock = buildLock({
    workerId: "dead",
    pid: 999999,
    processStartNonce: "x",
    now: new Date(now.getTime() - STALE_LOCK_MS - 60_000),
  });
  const c = classifyLock(lock, {
    now,
    workerId: "new",
    isPidAlive: () => false,
  });
  assert.equal(c.status, "STALE");
});

test("live PID cannot be stolen even with stale heartbeat", () => {
  const now = new Date("2026-09-24T18:00:00.000Z");
  const lock = buildLock({
    workerId: "alive",
    pid: 12345,
    processStartNonce: "x",
    now: new Date(now.getTime() - STALE_LOCK_MS - 60_000),
  });
  const c = classifyLock(lock, {
    now,
    workerId: "thief",
    isPidAlive: () => true,
  });
  assert.equal(c.status, "ACTIVE");
  assert.equal(c.reason, "pid_alive_despite_stale_heartbeat");
});

test("stale lock recovery archives then acquires", () => {
  const dir = tmpReports();
  const lockPath = lockPathFor(dir);
  const old = buildLock({
    workerId: "old",
    pid: 424242,
    processStartNonce: "oldn",
    now: new Date("2026-09-24T10:00:00.000Z"),
  });
  writeLockFile(lockPath, old);

  const recovered = acquireWorkerLock({
    reportsDir: dir,
    workerId: "new",
    processStartNonce: "newn",
    now: new Date("2026-09-24T18:00:00.000Z"),
    isPidAlive: () => false,
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.code, "LOCK_RECOVERED");
  assert.ok(recovered.archivedPath);
  assert.ok(fs.existsSync(recovered.archivedPath));
  assert.equal(recovered.lock.workerId, "new");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("safe shutdown releases lock", () => {
  const dir = tmpReports();
  acquireWorkerLock({
    reportsDir: dir,
    workerId: "w1",
    processStartNonce: "n1",
  });
  const rel = releaseWorkerLock({
    reportsDir: dir,
    workerId: "w1",
    processStartNonce: "n1",
  });
  assert.equal(rel.ok, true);
  assert.equal(fs.existsSync(lockPathFor(dir)), false);

  // After release, another worker can acquire
  const again = acquireWorkerLock({
    reportsDir: dir,
    workerId: "w2",
    processStartNonce: "n2",
  });
  assert.equal(again.ok, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("crash restart restores scheduler state without duplicate invent", () => {
  let state = createInitialState(new Date("2026-09-24T16:00:00.000Z"));
  state.currentLane = "B";
  state.laneA = {
    ...state.laneA,
    court: "ark",
    jurisdiction: "AR",
    count: 33,
    target: 45,
    checkpoint: "cl-opinion-9885161",
    lastSuccessfulExternalId: "cl-opinion-9885161",
    cursor: "cl-opinion-9885160",
  };
  state.laneB = { task: "citation_re_resolution", checkpoint: "cite-1", tasksCompleted: ["us_reports_gap_analysis"] };
  state.quota.nextCheckAt = "2026-09-24T22:06:14.563Z";

  const restored = restoreState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.laneA.checkpoint, "cl-opinion-9885161");
  assert.equal(restored.laneA.count, 33);
  assert.equal(restored.laneA.target, 45);
  assert.equal(restored.laneB.task, "citation_re_resolution");
  assert.equal(restored.quota.nextCheckAt, "2026-09-24T22:06:14.563Z");
  // No invented second CL worker / no wiped checkpoint
  assert.equal(restored.laneA.checkpoint, state.laneA.checkpoint);
});

test("Lane A auto-selection when useful capacity exists", () => {
  const state = createInitialState();
  state.laneA.checkpoint = "cl-opinion-1";
  state.laneA.count = 10;
  state.laneA.target = 45;
  const d = decideLane(state, { safeRequests: 40, now: new Date() });
  assert.equal(d.lane, "A");
});

test("Lane B auto-selection when quota floor", () => {
  const state = createInitialState();
  state.laneA.checkpoint = "cl-opinion-1";
  state.laneA.count = 33;
  state.laneA.target = 45;
  const d = decideLane(state, { safeRequests: 0, now: new Date() });
  assert.equal(d.lane, "B");
});

test("Lane B → Lane A auto-switch on quota recovery", () => {
  let state = createInitialState();
  state.currentLane = "B";
  state.laneA.checkpoint = "cl-opinion-9885161";
  state.laneA.count = 33;
  state.laneA.target = 45;
  const rec = applyQuotaRecoveryTransition(state, {
    safeRequests: 50,
    windows: { day: { remaining: 200, limit: 5000 } },
    now: new Date(),
  });
  assert.equal(rec.state.currentLane, "A");
  assert.equal(rec.decision.lane, "A");
});

test("Lane A → Lane B quota-floor switch persists checkpoint", () => {
  let state = createInitialState();
  state.currentLane = "A";
  state.laneA.checkpoint = "cl-opinion-9885161";
  state.laneA.count = 33;
  state.laneA.target = 45;
  state = applyQuotaFloorTransition(state, {
    safeRequests: 0,
    checkpoint: "cl-opinion-9885161",
    lastSuccessfulExternalId: "cl-opinion-9885161",
    count: 33,
    target: 45,
    reason: "quota_floor",
    now: new Date(),
  });
  assert.equal(state.currentLane, "B");
  assert.equal(state.laneA.checkpoint, "cl-opinion-9885161");
});

test("no duplicate CL workers — second Lane A owner refused", () => {
  const dir = tmpReports();
  acquireWorkerLock({
    reportsDir: dir,
    workerId: "cl-1",
    processStartNonce: "a",
    currentLane: "LANE_A_CL",
    currentTask: "cl_ingest",
    isPidAlive: () => true,
  });
  const mut = assertQueue2Access({
    reportsDir: dir,
    mode: "mutate",
    workerId: "cl-2",
    processStartNonce: "b",
    isPidAlive: () => true,
  });
  assert.equal(mut.allowed, false);
  assert.equal(mut.code, ACTIVE_REFUSAL_CODE);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("canonical milestone push selection excludes benchmarks and lock", () => {
  const selected = selectMilestoneGitPaths([
    ...MILESTONE_EVIDENCE_PATHS,
    "benchmarks/nyaya-bench/graders/signals.ts",
    "packages/research/corpus/reports/queue2-worker.lock.json",
    "packages/research/corpus/reports/queue2-dual-lane-quota-probe.txt",
  ]);
  assert.ok(selected.includes("packages/research/corpus/reports/corpus-worker-status.json"));
  assert.equal(selected.some((p) => p.includes("nyaya-bench")), false);
  assert.equal(selected.some((p) => p.includes("queue2-worker.lock.json")), false);
  assert.equal(selected.some((p) => p.includes("quota-probe")), false);
  assert.equal(heartbeatImpliesGitCommit(), false);

  const plan = planMilestoneCommit({
    candidates: ["packages/research/corpus/reports/corpus-worker-status.json"],
  });
  // dry plan always reports heartbeatWouldCommit false
  assert.equal(plan.heartbeatWouldCommit, false);
});

test("heartbeat interval policy does not auto-emit under 15 minutes", () => {
  const now = new Date("2026-09-24T18:00:00.000Z");
  assert.equal(shouldEmitHeartbeat(new Date(now.getTime() - 60_000).toISOString(), now), false);
  assert.equal(
    shouldEmitHeartbeat(new Date(now.getTime() - HEARTBEAT_INTERVAL_MS - 1).toISOString(), now),
    true,
  );
});

test("lock ownership review triggers exist and normal lane switch does not", () => {
  const normal = evaluateHumanReviewTriggers({ quotaFloor: true });
  assert.equal(normal.required, false);

  const conflict = evaluateHumanReviewTriggers({ conflictingMutatorRepeated: true });
  assert.ok(conflict.reasons.includes(HUMAN_REVIEW_REASONS.CONFLICTING_MUTATOR_REPEATED));

  const mismatch = evaluateHumanReviewTriggers({ activePidMismatchedWorkerId: true });
  assert.ok(mismatch.reasons.includes(HUMAN_REVIEW_REASONS.ACTIVE_PID_MISMATCHED_WORKER_ID));

  const corrupt = evaluateHumanReviewTriggers({ schedulerLockCorruption: true });
  assert.ok(corrupt.reasons.includes(HUMAN_REVIEW_REASONS.SCHEDULER_LOCK_CORRUPTION));
});

test("new lock event types are valid", () => {
  assert.equal(makeEvent("LOCK_ACQUIRED", { lane: "LANE_B_OFFLINE" }).type, "LOCK_ACQUIRED");
  assert.equal(makeEvent("LOCK_RELEASED", {}).type, "LOCK_RELEASED");
  assert.equal(makeEvent("LOCK_RECOVERED", {}).type, "LOCK_RECOVERED");
  assert.equal(makeEvent("MILESTONE", { reason: "daily_close" }).type, "MILESTONE");
});

test("owner can re-enter lock; foreign cannot release", () => {
  const dir = tmpReports();
  acquireWorkerLock({
    reportsDir: dir,
    workerId: "w1",
    processStartNonce: "n1",
    isPidAlive: () => true,
  });
  const again = acquireWorkerLock({
    reportsDir: dir,
    workerId: "w1",
    processStartNonce: "n1",
    isPidAlive: () => true,
  });
  assert.equal(again.ok, true);
  assert.equal(again.code, "REENTRANT");

  const badRel = releaseWorkerLock({
    reportsDir: dir,
    workerId: "other",
    processStartNonce: "x",
  });
  assert.equal(badRel.ok, false);
  assert.ok(fs.existsSync(lockPathFor(dir)));
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(JSON.stringify({ ok: true, tests: passed, suite: "queue2-worker-lock" }));
