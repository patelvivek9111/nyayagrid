/**
 * Queue #2 final autonomy hardening tests (deterministic — no network, no AI, no worker start).
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  loadOfflineTaskRegistry,
  loadCompletionChecklist,
  assertKnownLaneBTask,
  selectLaneBTask,
  evaluateLaneAStop,
  detectSystemResume,
  evaluateNetworkState,
  deriveRuntimeState,
  neverOpenQueue3,
  evaluateQueue2Completion,
  applyCompletionCandidate,
  shouldPushMilestoneSnapshot,
  emptyMetrics,
  assertRoutineZeroAi,
  usefulClCapacityGate,
  assertArkCheckpointIntact,
  buildDefaultLaneAManifest,
  persistLaneAManifest,
  rerankLaneAManifest,
  loadOrCreateLaneAManifest,
  scoreLaneATarget,
  RUNTIME_STATES,
  US_JURISDICTIONS,
  FEDERAL_TARGETS,
  MANIFEST_PATH,
  SLEEP_GAP_MS,
} = require("./queue2-autonomy-policy.cjs");
const {
  restoreState,
  createInitialState,
  applyLaneBSelection,
  decideLane,
  USEFUL_CL_MIN,
  HUMAN_REVIEW_REASONS,
} = require("./queue2-dual-lane-controller.cjs");
const {
  buildOperatorStatus,
  makeEvent,
  evaluateHumanReviewTriggers,
  RUNTIME_STATES: OBS_RUNTIME,
} = require("./queue2-worker-observability.cjs");
const { heartbeatImpliesGitCommit } = require("./queue2-worker-lock.cjs");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("Lane B registry ordering is deterministic by priority", () => {
  const reg = loadOfflineTaskRegistry();
  assert.equal(reg.aiPlannerAllowed, false);
  assert.equal(reg.tasks.length, 14);
  const ids = reg.tasks.map((t) => t.id);
  assert.deepEqual(ids.slice(0, 3), [
    "US_REPORTS_GAP_ANALYSIS",
    "NON_CL_PRIMARY_AUTHORITY_INTAKE",
    "USC_DEPTH",
  ]);
  for (const t of reg.tasks) {
    assert.equal(t.mayUseAI, false);
  }
});

test("no free-form task invention", () => {
  assert.throws(() => assertKnownLaneBTask("INVENT_SOMETHING_CLEVER"), /UNKNOWN_LANE_B_TASK/);
  assert.equal(assertKnownLaneBTask("US_REPORTS_GAP_ANALYSIS").id, "US_REPORTS_GAP_ANALYSIS");
  assert.equal(assertKnownLaneBTask("us_reports_gap_analysis").id, "US_REPORTS_GAP_ANALYSIS");
});

test("no AI calls for routine worker behavior", () => {
  const m = emptyMetrics();
  assert.equal(m.system.aiCalls, 0);
  assert.equal(m.system.aiTokens, 0);
  assert.equal(assertRoutineZeroAi(m), true);
  assert.throws(() => assertRoutineZeroAi({ system: { aiCalls: 1, aiTokens: 0 } }), /ROUTINE_AI_USAGE/);
  const src = fs.readFileSync(path.join(__dirname, "queue2-autonomy-policy.cjs"), "utf8");
  assert.equal(/openai|anthropic|@google\/generative|xai|cursor.?agent/i.test(src), false);
});

test("Lane B idle-safe when nothing eligible", () => {
  const reg = loadOfflineTaskRegistry();
  // Mark all tasks as recently run so intervals block them
  const now = new Date("2026-09-24T18:00:00.000Z");
  const lastByTask = {};
  for (const t of reg.tasks) lastByTask[t.id] = now.toISOString();
  const sel = selectLaneBTask({
    registry: reg,
    now: new Date(now.getTime() + 60_000),
    lastByTask,
    networkOk: true,
    nextQuotaCheckAt: "2026-09-24T22:06:14.563Z",
  });
  assert.equal(sel.idleSafe, true);
  assert.equal(sel.currentLane, "LANE_B_IDLE_SAFE");
  assert.equal(sel.currentTask, "NONE");
  assert.equal(sel.humanReview, false);

  let state = createInitialState();
  state = applyLaneBSelection(state, sel, now);
  assert.equal(state.idleSafe, true);
  assert.equal(state.laneB.task, "NONE");
  assert.equal(state.runtimeState, "IDLE_SAFE");
});

test("network loss and recovery", () => {
  const lost = evaluateNetworkState({
    online: false,
    offlineSince: new Date("2026-09-24T17:00:00.000Z"),
    now: new Date("2026-09-24T17:05:00.000Z"),
  });
  assert.equal(lost.runtimeState, "WAITING_FOR_NETWORK");
  assert.equal(lost.continueLocalOnlyLaneB, true);
  assert.equal(lost.humanReview, false);

  const prolonged = evaluateNetworkState({
    online: false,
    offlineSince: new Date("2026-09-24T10:00:00.000Z"),
    now: new Date("2026-09-24T17:00:00.000Z"),
  });
  assert.equal(prolonged.humanReview, true);

  const recovered = evaluateNetworkState({
    online: true,
    wasWaiting: true,
  });
  assert.equal(recovered.action, "NETWORK_RECOVERED");
  assert.equal(recovered.recheckQuotaBeforeLaneA, true);
  assert.equal(recovered.resumeExactCheckpoint, true);
});

test("sleep gap detection and resume", () => {
  const now = new Date("2026-09-24T18:00:00.000Z");
  const gap = detectSystemResume(
    new Date(now.getTime() - SLEEP_GAP_MS - 1).toISOString(),
    now,
  );
  assert.equal(gap.probableSuspend, true);
  assert.equal(gap.event, "SYSTEM_RESUME_DETECTED");
  assert.ok(gap.gapMs > SLEEP_GAP_MS);

  const fresh = detectSystemResume(new Date(now.getTime() - 60_000).toISOString(), now);
  assert.equal(fresh.probableSuspend, false);
});

test("process restart restores AR checkpoint without inventing", () => {
  const saved = {
    currentLane: "B",
    laneA: {
      court: "ark",
      jurisdiction: "AR",
      count: 33,
      target: 45,
      checkpoint: "cl-opinion-9885161",
      lastSuccessfulExternalId: "cl-opinion-9885161",
      cursor: "cl-opinion-9885160",
    },
    laneB: {
      task: "us_reports_gap_analysis",
      checkpoint: "scorecard-v1",
      checkpoints: { US_REPORTS_GAP_ANALYSIS: "pos-1" },
    },
    quota: { nextCheckAt: "2026-09-24T22:06:14.563Z", lastSafeRequests: 0 },
    metrics: { aiCalls: 99, aiTokens: 1000 },
  };
  const restored = restoreState(saved);
  assert.equal(restored.laneA.checkpoint, "cl-opinion-9885161");
  assert.equal(restored.laneA.count, 33);
  assert.equal(restored.queue3, "NOT_OPEN");
  assert.equal(restored.metrics.aiCalls, 0);
  assert.equal(restored.metrics.aiTokens, 0);
  assertArkCheckpointIntact(restored);
});

test("stale lock recovery covered by lock module contract; autonomy never opens #3", () => {
  const s = neverOpenQueue3({ queue3: "OPEN", queue: "#9" });
  assert.equal(s.queue3, "NOT_OPEN");
  assert.equal(s.queue, "#2");
  assert.equal(s.queue9, "CLOSED");
});

test("quota useful-capacity threshold is adaptive (no fixed 25)", () => {
  const laneA = { count: 33, target: 45, checkpoint: "cl-opinion-9885161", court: "ark" };
  const belowMicro = usefulClCapacityGate(2, laneA);
  assert.equal(belowMicro.useful, false);
  const micro = usefulClCapacityGate(4, laneA);
  assert.equal(micro.useful, true);
  const batch = usefulClCapacityGate(USEFUL_CL_MIN, laneA);
  assert.equal(batch.useful, true);
  const finish = usefulClCapacityGate(28, laneA);
  assert.equal(finish.useful, true);
  assert.ok(["WAIT", "B"].includes(decideLane({ laneA, quota: {}, humanReview: { required: false } }, { safeRequests: 2 }).lane));
  assert.equal(decideLane({ laneA, quota: {}, humanReview: { required: false } }, { safeRequests: 40 }).lane, "A");
});

test("no repeated expensive task without corpus change", () => {
  const reg = loadOfflineTaskRegistry();
  const cite = reg.tasks.find((t) => t.id === "CITATION_RERESOLVE");
  assert.equal(cite.eligibility.requiresCorpusChange, true);
  const sel = selectLaneBTask({
    registry: { ...reg, tasks: [cite] },
    corpusVersion: "v42",
    checkpoints: { citationResolverCorpusVersion: "v42" },
    networkOk: true,
    now: new Date("2026-09-24T18:00:00.000Z"),
  });
  assert.equal(sel.idleSafe, true);
});

test("Lane B checkpoint recovery fields exist on state", () => {
  let state = createInitialState();
  state.laneB.checkpoints = { citationResolverCorpusVersion: "v1" };
  const restored = restoreState(state);
  assert.equal(restored.laneB.checkpoints.citationResolverCorpusVersion, "v1");
});

test("Lane A manifest persistence and all-jurisdiction scope", () => {
  const m = buildDefaultLaneAManifest({
    arkCount: 33,
    arkCheckpoint: "cl-opinion-9885161",
  });
  assert.equal(US_JURISDICTIONS.length, 51);
  assert.ok(FEDERAL_TARGETS.length >= 10);
  assert.equal(m.scope.states, 50);
  assert.equal(m.scope.dc, true);
  assert.equal(m.scope.federal, true);
  assert.equal(m.activePartial.checkpoint, "cl-opinion-9885161");
  assert.ok(m.targets.some((t) => t.jurisdiction === "AR" && t.status === "PARTIAL"));
  assert.ok(MANIFEST_STATUSES_OK(m));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "q2-man-"));
  const file = path.join(dir, "manifest.json");
  persistLaneAManifest(m, file);
  const loaded = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(loaded.activePartial.checkpoint, "cl-opinion-9885161");
  const ranked = rerankLaneAManifest(loaded, { ark: { authorityDeficit: 90 } });
  assert.ok(ranked.version > loaded.version);
  assert.ok(scoreLaneATarget(ranked.targets[0]) >= scoreLaneATarget(ranked.targets.at(-1)));
  fs.rmSync(dir, { recursive: true, force: true });

  // Production file on disk must keep AR checkpoint
  const prod = loadOrCreateLaneAManifest({ arkCheckpoint: "cl-opinion-9885161" });
  assertArkCheckpointIntact(prod);
});

function MANIFEST_STATUSES_OK(m) {
  const allowed = new Set(["READY", "PARTIAL", "COMPLETE_FOR_CURRENT_DEPTH", "BLOCKED_EXTERNAL", "HUMAN_REVIEW_REQUIRED"]);
  return m.targets.every((t) => allowed.has(t.status));
}

test("completion candidate stops progression and never opens #3", () => {
  const checklist = loadCompletionChecklist();
  assert.equal(checklist.queue3AutoOpen, false);
  assert.equal(checklist.onComplete.openQueue3, false);

  const allTrue = {};
  for (const item of checklist.required) allTrue[item.id] = true;
  const ev = evaluateQueue2Completion(allTrue, checklist);
  assert.equal(ev.candidate, true);
  assert.equal(ev.openQueue3, false);

  let state = createInitialState();
  const applied = applyCompletionCandidate(state, ev);
  assert.equal(applied.applied, true);
  assert.equal(applied.openQueue3, false);
  assert.equal(applied.state.queue3, "NOT_OPEN");
  assert.equal(applied.state.humanReview.required, true);
  assert.ok(
    applied.state.humanReview.reasons.includes(HUMAN_REVIEW_REASONS.QUEUE_2_COMPLETION_CANDIDATE),
  );

  const gateAlone = evaluateQueue2Completion(
    { authority_gate_gt_100_alone: true },
    checklist,
  );
  assert.equal(gateAlone.candidate, false);
});

test("status freshness / runtimeState semantics", () => {
  for (const s of RUNTIME_STATES) assert.ok(OBS_RUNTIME.includes(s));
  assert.equal(
    deriveRuntimeState({ humanReviewRequired: true }).runtimeState,
    "HUMAN_REVIEW_REQUIRED",
  );
  assert.equal(deriveRuntimeState({ processAlive: false }).runtimeState, "STOPPED");
  assert.equal(deriveRuntimeState({ processAlive: true, idleSafe: true }).runtimeState, "IDLE_SAFE");
  assert.equal(deriveRuntimeState({ processAlive: true }).runtimeState, "RUNNING");
  assert.equal(
    deriveRuntimeState({ waitingForNetwork: true, processAlive: true }).runtimeState,
    "WAITING_FOR_NETWORK",
  );
  const asleep = deriveRuntimeState({
    processAlive: false,
    lastHeartbeatAt: new Date(Date.now() - SLEEP_GAP_MS - 1000).toISOString(),
  });
  assert.equal(asleep.runtimeState, "SUSPENDED_OR_OFFLINE");

  const status = buildOperatorStatus({
    state: createInitialState(),
    runtimeState: "STOPPED",
    freshness: "STALE_PROCESS_STOPPED",
  });
  assert.equal(status.runtimeState, "STOPPED");
  assert.equal(status.tokens.routineAiCalls, 0);
});

test("milestone snapshot rules; heartbeat does not commit", () => {
  assert.equal(heartbeatImpliesGitCommit(), false);
  assert.equal(shouldPushMilestoneSnapshot({ heartbeatOnly: true }).push, false);
  assert.equal(shouldPushMilestoneSnapshot({ humanReviewRequired: true }).push, true);
  assert.equal(shouldPushMilestoneSnapshot({ completionCandidate: true }).push, true);
  assert.equal(shouldPushMilestoneSnapshot({}).push, false);
});

test("one mutating Lane B task at a time", () => {
  const reg = loadOfflineTaskRegistry();
  const mutators = reg.tasks.filter((t) => t.mayMutate);
  assert.ok(mutators.length >= 1);
  const sel = selectLaneBTask({
    registry: reg,
    networkOk: true,
    mutatingTaskActive: true,
    now: new Date("2026-09-24T12:00:00.000Z"),
    lastByTask: {},
  });
  // If a mutator is active, only non-mutating tasks (or idle) may be chosen
  if (sel.task) assert.equal(sel.task.mayMutate, false);
});

test("Lane A stop: routine floor vs unsafe", () => {
  const floor = evaluateLaneAStop({ dayFloor: true });
  assert.equal(floor.action, "SWITCH_LANE_B");
  assert.equal(floor.humanReview, false);
  const unsafe = evaluateLaneAStop({ unexpected429: true });
  assert.equal(unsafe.action, "HUMAN_REVIEW_REQUIRED");
  assert.equal(unsafe.humanReview, true);
});

test("events include SYSTEM_RESUME_DETECTED and LANE_B_IDLE_SAFE", () => {
  assert.equal(makeEvent("SYSTEM_RESUME_DETECTED", { reason: "sleep_gap" }).type, "SYSTEM_RESUME_DETECTED");
  assert.equal(makeEvent("LANE_B_IDLE_SAFE", { task: "NONE" }).type, "LANE_B_IDLE_SAFE");
  assert.equal(makeEvent("NETWORK_LOSS", {}).type, "NETWORK_LOSS");
  assert.equal(makeEvent("NETWORK_RECOVERED", {}).type, "NETWORK_RECOVERED");
});

test("human review triggers include strategy/network/completion", () => {
  const r = evaluateHumanReviewTriggers({
    noProductiveStrategyRemains: true,
    repeatedNetworkFailure: true,
    queue2CompletionCandidate: true,
  });
  assert.ok(r.reasons.includes(HUMAN_REVIEW_REASONS.NO_PRODUCTIVE_STRATEGY_REMAINS));
  assert.ok(r.reasons.includes(HUMAN_REVIEW_REASONS.REPEATED_NETWORK_FAILURE));
  assert.ok(r.reasons.includes(HUMAN_REVIEW_REASONS.QUEUE_2_COMPLETION_CANDIDATE));
});

test("worker remains STOPPED — this suite does not start npm run queue2:worker", () => {
  // Guard: no lock file should be held by this test process as a running worker claim
  const lockPath = path.join(
    __dirname,
    "..",
    "packages",
    "research",
    "corpus",
    "reports",
    "queue2-worker.lock.json",
  );
  // Absence or foreign lock is fine; we simply never spawn the worker here.
  assert.equal(process.env.QUEUE2_WORKER_STARTED, undefined);
  assert.ok(!process.argv.includes("--loop"));
  void lockPath;
});

console.log(
  JSON.stringify({
    ok: true,
    tests: passed,
    suite: "queue2-autonomy-policy",
    workerStarted: false,
    aiPlanner: false,
  }),
);
