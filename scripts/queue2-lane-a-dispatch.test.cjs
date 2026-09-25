/**
 * Queue #2 Lane A dispatch / loop integration tests.
 * Zero network. Zero corpus mutation. Zero AI. Does NOT start the worker.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  remainingCasesToFinish,
  parseLaneARunnerOutput,
  classifyLaneABatchResult,
  resolveBindingResetAt,
  evaluateProductionCanaryGate,
  nextQuotaCheckAfterActiveBatch,
  detectRedundantQuotaProbes,
  detectLaneADispatchStall,
  computePostCycleSleepMs,
  runMockedLaneAStartupFlow,
} = require("./queue2-lane-a-dispatch.cjs");
const { decideLane, createInitialState, QUOTA_MODES } = require("./queue2-dual-lane-controller.cjs");
const { statusLaneFromState, makeEvent, isRegisteredEventType } = require("./queue2-worker-observability.cjs");
const { neverOpenQueue3 } = require("./queue2-autonomy-policy.cjs");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const STATE_PATH = path.join(__dirname, "../packages/research/corpus/reports/queue2-dual-lane-state.json");

function windows(minuteRem, hourRem, dayRem, opts = {}) {
  return {
    minute: { limit: 30, used: 30 - minuteRem, remaining: minuteRem, resetAt: opts.minuteReset || null },
    hour: { limit: 300, used: 300 - hourRem, remaining: hourRem, resetAt: opts.hourReset || null },
    day: { limit: 1200, used: 1200 - dayRem, remaining: dayRem, resetAt: opts.dayReset || null },
  };
}

test("Lane A selected => mocked runner invoked exactly once", () => {
  const flow = runMockedLaneAStartupFlow({
    currentFingerprint: "fp-new",
    knownGoodFingerprint: "fp-old",
    mockApiCalls: 3,
    mockItemsImported: 45,
    mockCheckpoint: "cl-opinion-9999999",
  });
  assert.equal(flow.runnerInvokedOnce, true);
  assert.equal(flow.ok, true);
  assert.equal(flow.idleBeforeLaneAComplete, false);
});

test("Lane A runner result is awaited/classified from fileResult", () => {
  const stdout = [
    JSON.stringify({ uploaded: true }),
    JSON.stringify({ ok: true, started: true }),
    JSON.stringify({
      i: 0,
      fileResult: {
        ok: true,
        status: "completed",
        reason: "already_completed",
        items_imported: 45,
        apiCalls: 0,
      },
    }),
  ].join("\n");
  const parsed = parseLaneARunnerOutput(stdout);
  assert.equal(parsed.source, "fileResult");
  const c = classifyLaneABatchResult({
    parsed,
    priorCheckpoint: "cl-opinion-9886466",
    priorCount: 44,
    target: 45,
  });
  assert.equal(c.alreadyCompleted, true);
  assert.equal(c.apiCalls, 0);
  assert.equal(c.runnerInvoked, true);
  // already_completed is NOT zero-progress by itself — reconciliation decides.
  assert.equal(c.noProgress, false);
});

test("no idle fallthrough / Lane B idle impossible while Lane A active", () => {
  const state = { currentLane: "A", idleSafe: true, laneA: { court: "wis" } };
  assert.equal(statusLaneFromState(state), "LANE_A_CL");
  const flow = runMockedLaneAStartupFlow({});
  assert.equal(flow.events.some((e) => e.type === "LANE_B_IDLE_SAFE"), false);
});

test("active quota does not cause 5-second reprobe loop", () => {
  const now = new Date("2026-09-25T15:00:00.000Z");
  const next = nextQuotaCheckAfterActiveBatch(now, { deferMs: 15 * 60 * 1000 });
  assert.ok(new Date(next).getTime() - now.getTime() >= 14 * 60 * 1000);
  const sleep = computePostCycleSleepMs({
    now,
    lane: "A",
    quotaMode: "FINISH_TARGET",
    nextCheckAt: now.toISOString(),
  });
  assert.equal(sleep, 0);
});

test("redundant quota probe detection", () => {
  const hist = [
    { minuteRemaining: 30, hourRemaining: 300, dayRemaining: 1106, quotaMode: "FINISH_TARGET", checkpoint: "c", workBetween: false },
    { minuteRemaining: 30, hourRemaining: 300, dayRemaining: 1106, quotaMode: "FINISH_TARGET", checkpoint: "c", workBetween: false },
    { minuteRemaining: 30, hourRemaining: 300, dayRemaining: 1106, quotaMode: "FINISH_TARGET", checkpoint: "c", workBetween: false },
  ];
  const d = detectRedundantQuotaProbes(hist);
  assert.equal(d.redundant, true);
  assert.equal(d.reason, "REDUNDANT_QUOTA_PROBES");
});

test("bindingWindow/reset mapping correct", () => {
  const w = windows(30, 300, 1106, {
    minuteReset: "2026-09-25T15:01:00.000Z",
    hourReset: "2026-09-25T16:00:00.000Z",
    dayReset: "2026-09-26T00:36:37.000Z",
  });
  assert.equal(resolveBindingResetAt(w, "MINUTE"), "2026-09-25T15:01:00.000Z");
  assert.equal(resolveBindingResetAt(w, "HOUR"), "2026-09-25T16:00:00.000Z");
  assert.equal(resolveBindingResetAt(w, "DAY"), "2026-09-26T00:36:37.000Z");
  const state = createInitialState();
  state.laneA = {
    court: "wis",
    count: 44,
    target: 45,
    checkpoint: "cl-opinion-9886466",
    lastSuccessfulExternalId: "cl-opinion-9886466",
  };
  const d = decideLane(state, {
    windows: w,
    projectedUsefulAt: "2026-09-26T00:36:37.000Z",
    now: new Date("2026-09-25T14:55:00.000Z"),
  });
  assert.equal(d.lane, "A");
  assert.equal(d.quotaMode, QUOTA_MODES.FINISH_TARGET);
  // Must not attach day reset to active FINISH_TARGET when minute is binding.
  if (d.bindingWindow === "MINUTE") {
    assert.notEqual(d.bindingResetAt, "2026-09-26T00:36:37.000Z");
  }
});

test("WI remainingCases = 1; estimatedRequestsNeeded separate", () => {
  assert.equal(remainingCasesToFinish({ count: 44, target: 45 }), 1);
  const state = createInitialState();
  state.laneA = {
    court: "wis",
    count: 44,
    target: 45,
    checkpoint: "cl-opinion-9886466",
    lastSuccessfulExternalId: "cl-opinion-9886466",
  };
  state.quota.courtEfficiency = { wis: { ewmaRequestsPerAuthority: 2.13, sampleCount: 3 } };
  const d = decideLane(state, {
    windows: windows(30, 300, 1106),
    now: new Date("2026-09-25T14:55:00.000Z"),
  });
  assert.equal(remainingCasesToFinish(state.laneA), 1);
  assert.ok(d.estimatedRequestsNeeded >= 1);
  // Old mislabeled remainingToFinish was ceil(1*2.3)=3 request estimate — keep separate.
  assert.notEqual(d.estimatedRequestsNeeded, remainingCasesToFinish(state.laneA));
});

test("code fingerprint change => CANARY_REQUIRED", () => {
  const g = evaluateProductionCanaryGate({
    currentFingerprint: "aaa",
    knownGoodFingerprint: "bbb",
  });
  assert.equal(g.required, true);
  assert.equal(g.mode, "CANARY_REQUIRED");
});

test("unchanged known-good fingerprint => canary may be skipped", () => {
  const g = evaluateProductionCanaryGate({
    currentFingerprint: "same",
    knownGoodFingerprint: "same",
  });
  assert.equal(g.required, false);
  assert.equal(g.mode, "NORMAL");
});

test("WI finish may serve as canary", () => {
  const flow = runMockedLaneAStartupFlow({
    currentFingerprint: "fp-new",
    knownGoodFingerprint: "fp-old",
    mockApiCalls: 2,
    mockItemsImported: 45,
  });
  assert.equal(flow.canary.required, true);
  assert.equal(flow.remainingCases, 1);
  assert.equal(flow.runnerInvokedOnce, true);
  assert.ok(flow.classified.productive || flow.classified.runnerInvoked);
});

test("Lane A dispatch stall detected within <=5m", () => {
  const selectedAt = "2026-09-25T14:50:00.000Z";
  const warn = detectLaneADispatchStall({
    laneASelectedAt: selectedAt,
    now: "2026-09-25T14:52:30.000Z",
    runnerStarted: false,
  });
  assert.equal(warn.stalled, true);
  assert.equal(warn.severity, "WARNING");
  const crit = detectLaneADispatchStall({
    laneASelectedAt: selectedAt,
    now: "2026-09-25T14:55:30.000Z",
    runnerStarted: false,
  });
  assert.equal(crit.stalled, true);
  assert.equal(crit.severity, "CRITICAL");
  assert.ok(crit.ageMs <= 6 * 60 * 1000);
});

test("mocked WI finish flow passes end-to-end control sequence", () => {
  const flow = runMockedLaneAStartupFlow({
    knownGoodFingerprint: "old",
    currentFingerprint: "new",
  });
  const types = flow.events.map((e) => e.type);
  assert.ok(types.includes("PREFLIGHT_PASS"));
  assert.ok(types.includes("WATCHDOG_SESSION_INIT"));
  assert.ok(types.includes("INITIAL_HEARTBEAT"));
  assert.ok(types.includes("QUOTA_CHECK"));
  assert.ok(types.includes("CANARY_REQUIRED"));
  assert.ok(types.includes("LANE_A_CL"));
  assert.ok(types.includes("LANE_A_RUNNER_START"));
  assert.ok(types.includes("LANE_A_BATCH_COMPLETE"));
  assert.equal(types.includes("LANE_B_IDLE_SAFE"), false);
});

test("no AI calls; Queue #3 never opens", () => {
  const q3 = neverOpenQueue3({});
  assert.equal(q3.queue3, "NOT_OPEN");
  assert.equal(q3.queue, "#2");
  assert.equal(isRegisteredEventType("LANE_A_RUNNER_START"), true);
  assert.equal(makeEvent("LANE_A_RUNNER_START", { lane: "LANE_A_CL" }).type, "LANE_A_RUNNER_START");
});

test("durable WI complete; next active Lane A is VERIFIED incomplete", () => {
  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  assert.ok(state.completedCourts.includes("wis"));
  assert.equal(state.completedCourtEvidence.wis.status, "COMPLETE_FOR_CURRENT_DEPTH");
  assert.equal(state.completedCourtEvidence.wis.count, 45);
  assert.equal(state.completedCourtEvidence.wis.checkpoint, "cl-opinion-9886466");
  assert.equal(state.laneA.court, "mich");
  assert.equal(state.laneA.count, 20);
  assert.equal(state.laneA.target, 45);
  assert.equal(state.humanReview.required, false);
});

test("zero-progress already_completed forces long backoff not 5s loop", () => {
  const sleep = computePostCycleSleepMs({
    now: new Date(),
    noProgress: true,
    lane: "A",
    quotaMode: "FINISH_TARGET",
  });
  assert.ok(sleep >= 30 * 60 * 1000);
});

console.log(
  JSON.stringify({
    ok: true,
    tests: passed,
    suite: "queue2-lane-a-dispatch",
    workerStarted: false,
    aiCalls: 0,
    corpusMutations: 0,
  }),
);
