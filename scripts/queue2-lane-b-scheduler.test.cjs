/**
 * Lane B scheduler reevaluation tests (deterministic — no AI, no worker start, no CL ingest).
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const {
  loadOfflineTaskRegistry,
  selectLaneBTask,
  assertRoutineZeroAi,
  emptyMetrics,
} = require("./queue2-autonomy-policy.cjs");
const {
  createInitialState,
  applyLaneBSelection,
  completeLaneBTask,
  restoreState,
} = require("./queue2-dual-lane-controller.cjs");
const { buildOperatorStatus } = require("./queue2-worker-observability.cjs");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("all 14 registry tasks evaluated", () => {
  const reg = loadOfflineTaskRegistry();
  assert.equal(reg.tasks.length, 14);
  const sel = selectLaneBTask({
    registry: reg,
    now: new Date("2026-09-25T01:00:00.000Z"),
    lastByTask: {},
    checkpoints: {},
    networkOk: true,
    executing: true,
  });
  assert.equal(sel.evaluatedCount, 14);
  assert.equal(sel.evaluations.length, 14);
  assert.ok(sel.evaluations.every((e) => typeof e.eligible === "boolean" && e.reason));
});

test("completed US_REPORTS becomes temporarily ineligible; next task selected", () => {
  const reg = loadOfflineTaskRegistry();
  const now = new Date("2026-09-25T01:00:00.000Z");
  let state = createInitialState(now);
  state = completeLaneBTask(state, "US_REPORTS_GAP_ANALYSIS", "scorecard-v1", now, {
    minimumIntervalMs: 21600000,
    checkpointKey: "usReportsManifestPosition",
  });
  assert.equal(state.laneB.task, "NONE");
  assert.equal(state.idleSafe, true);

  const sel = selectLaneBTask({
    registry: reg,
    now: new Date(now.getTime() + 60_000),
    lastByTask: state.laneB.lastByTask,
    nextEligibleAt: state.laneB.nextEligibleAt,
    checkpoints: state.laneB.checkpoints,
    networkOk: true,
    executing: true,
  });
  assert.equal(sel.evaluations.find((e) => e.taskId === "US_REPORTS_GAP_ANALYSIS").eligible, false);
  assert.equal(sel.evaluations.find((e) => e.taskId === "US_REPORTS_GAP_ANALYSIS").reason, "minimum_interval");
  assert.notEqual(sel.currentTask, "US_REPORTS_GAP_ANALYSIS");
  assert.equal(sel.currentTask, "NON_CL_PRIMARY_AUTHORITY_INTAKE");
});

test("no eligible tasks => LANE_B_IDLE_SAFE / NONE", () => {
  const reg = loadOfflineTaskRegistry();
  const now = new Date("2026-09-25T01:00:00.000Z");
  const lastByTask = {};
  for (const t of reg.tasks) lastByTask[t.id] = now.toISOString();
  const sel = selectLaneBTask({
    registry: reg,
    now: new Date(now.getTime() + 1000),
    lastByTask,
    networkOk: true,
    executing: true,
  });
  assert.equal(sel.idleSafe, true);
  assert.equal(sel.currentTask, "NONE");
  assert.equal(sel.currentLane, "LANE_B_IDLE_SAFE");
  let state = applyLaneBSelection(createInitialState(now), sel, now);
  assert.equal(state.laneB.task, "NONE");
  assert.equal(state.runtimeState, "IDLE_SAFE");
});

test("corpus-change-gated task becomes eligible after corpus version changes", () => {
  const reg = loadOfflineTaskRegistry();
  const now = new Date("2026-09-25T01:00:00.000Z");
  const cite = reg.tasks.find((t) => t.id === "CITATION_RERESOLVE");
  assert.ok(cite);
  const blocked = selectLaneBTask({
    registry: { ...reg, tasks: [cite] },
    now,
    lastByTask: {},
    checkpoints: { [cite.checkpointKey]: "1" },
    corpusVersion: "1",
    networkOk: true,
    executing: true,
  });
  assert.equal(blocked.idleSafe, true);

  const open = selectLaneBTask({
    registry: { ...reg, tasks: [cite] },
    now,
    lastByTask: {},
    checkpoints: { [cite.checkpointKey]: "1" },
    corpusVersion: "2",
    networkOk: true,
    executing: true,
  });
  assert.equal(open.currentTask, "CITATION_RERESOLVE");
});

test("minimumInterval respected", () => {
  const reg = loadOfflineTaskRegistry();
  const now = new Date("2026-09-25T12:00:00.000Z");
  const sel = selectLaneBTask({
    registry: reg,
    now,
    lastByTask: { US_REPORTS_GAP_ANALYSIS: "2026-09-25T10:00:00.000Z" },
    networkOk: false, // also blocks network tasks
    executing: true,
  });
  const us = sel.evaluations.find((e) => e.taskId === "US_REPORTS_GAP_ANALYSIS");
  assert.equal(us.eligible, false);
  assert.equal(us.reason, "minimum_interval");
  assert.ok(us.minimumIntervalRemainingMs > 0);
});

test("task checkpoint persists across restore/restart", () => {
  const now = new Date("2026-09-25T01:00:00.000Z");
  let state = createInitialState(now);
  state = completeLaneBTask(state, "US_REPORTS_GAP_ANALYSIS", "scorecard-v1", now, {
    minimumIntervalMs: 21600000,
  });
  const restored = restoreState(JSON.parse(JSON.stringify(state)), now);
  assert.equal(restored.laneB.lastByTask.US_REPORTS_GAP_ANALYSIS, state.laneB.lastByTask.US_REPORTS_GAP_ANALYSIS);
  assert.equal(restored.laneB.task, "NONE");
});

test("first-run tasksCompleted hydrates lastByTask (anti-pinning)", () => {
  const now = new Date("2026-09-25T01:00:00.000Z");
  const saved = {
    ...createInitialState(now),
    updatedAt: "2026-09-25T00:30:00.000Z",
    laneB: {
      task: "US_REPORTS_GAP_ANALYSIS",
      tasksCompleted: ["us_reports_gap_analysis", "citation_re_resolution"],
      checkpoints: {},
      lastByTask: {},
      mutatingTaskActive: null,
    },
    idleSafe: false,
    runtimeState: "RUNNING",
  };
  const restored = restoreState(saved, now);
  assert.ok(restored.laneB.lastByTask.us_reports_gap_analysis);
  assert.ok(restored.laneB.lastByTask.US_REPORTS_GAP_ANALYSIS);
  // Display name may remain until idle-safe applied; executing semantics cleared by selection.
  const sel = selectLaneBTask({
    registry: loadOfflineTaskRegistry(),
    now,
    lastByTask: restored.laneB.lastByTask,
    networkOk: true,
    executing: false,
  });
  assert.equal(sel.currentTask, "NONE");
  assert.equal(sel.idleSafe, true);
  const us = sel.evaluations.find((e) => e.taskId === "US_REPORTS_GAP_ANALYSIS");
  assert.equal(us.eligible, false);
  const applied = applyLaneBSelection(restored, sel, now);
  assert.equal(applied.laneB.task, "NONE");
});

test("no scheduler pinning when not executing", () => {
  const sel = selectLaneBTask({
    registry: loadOfflineTaskRegistry(),
    now: new Date("2026-09-25T01:00:00.000Z"),
    lastByTask: {},
    networkOk: true,
    executing: false,
  });
  assert.equal(sel.currentTask, "NONE");
  assert.equal(sel.idleSafe, true);
  assert.equal(sel.selectedWouldRun, "US_REPORTS_GAP_ANALYSIS");
  const state = applyLaneBSelection(createInitialState(), sel);
  assert.equal(state.laneB.task, "NONE");
});

test("status reflects actual executing task", () => {
  let state = createInitialState();
  state.laneA.checkpoint = "cl-opinion-9885161";
  state.laneA.count = 33;
  state.laneA.target = 45;
  state.idleSafe = true;
  state.laneB.task = "NONE";
  const status = buildOperatorStatus({
    state,
    currentLane: "LANE_B_IDLE_SAFE",
    currentTask: "NONE",
    runtimeState: "IDLE_SAFE",
  });
  assert.equal(status.currentTask, "NONE");
  assert.equal(status.currentLane, "LANE_B_IDLE_SAFE");
});

test("all 14 runners wired (callable references exist)", () => {
  const reg = loadOfflineTaskRegistry();
  const { RUNNERS, resolveRunner, runRegistryTask } = require("./queue2-lane-b-runners.cjs");
  assert.equal(reg.tasks.length, 14);
  for (const t of reg.tasks) {
    assert.ok(t.deterministicRunner, t.id);
    const [filePart, exportPart] = String(t.deterministicRunner).split("#");
    assert.equal(filePart, "scripts/queue2-lane-b-runners.cjs");
    assert.equal(typeof RUNNERS[exportPart], "function", t.id);
    const fn = resolveRunner(t.deterministicRunner);
    assert.equal(typeof fn, "function");
    const result = runRegistryTask(t, { corpusVersion: 1, allowMutation: false });
    assert.equal(result.ok, true);
    assert.equal(result.courtListenerHttpCalls, 0);
    assert.equal(result.aiCalls, 0);
    assert.ok(result.checkpoint);
  }
});

test("no AI calls / no Cursor agent", () => {
  assert.equal(assertRoutineZeroAi(emptyMetrics()), true);
  const src = fs.readFileSync(path.join(__dirname, "queue2-autonomy-policy.cjs"), "utf8");
  assert.equal(/openai|anthropic|cursor.?agent/i.test(src), false);
});

console.log(JSON.stringify({ ok: true, tests: passed }));
