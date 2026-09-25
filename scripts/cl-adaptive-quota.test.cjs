/**
 * Adaptive CourtListener quota controller tests (Queue #2).
 * Zero network. Zero corpus mutation. Zero AI.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  QUOTA_MODES,
  planAdaptiveQuota,
  computeUsableRequests,
  updateCourtEfficiency,
  efficiencyRegressionTriggered,
  shouldProbeQuota,
  dayUtilization,
  validateAdaptiveQuotaConfig,
  loadAdaptiveQuotaConfig,
  estimateRequestsNeeded,
} = require("./cl-adaptive-quota.cjs");
const { decideLane, createInitialState, remainingRequestsToFinishCourt } = require("./queue2-dual-lane-controller.cjs");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const CFG = loadAdaptiveQuotaConfig({
  overrides: {
    minuteReserve: 2,
    hourReserve: 5,
    dayReserve: 10,
    minimumMicroBatchRequests: 3,
    uncertaintyMultiplier: 1.35,
    fullBatchRequests: 20,
    defaultRequestsPerAuthority: 2.3,
    nearCompleteThreshold: 3,
    shortMinuteWaitMs: 90_000,
    wakeAfterResetMs: 3_000,
    efficiencyRegressionThreshold: 3.0,
    efficiencyRegressionBatches: 3,
  },
});

function windows(minuteRem, hourRem, dayRem, opts = {}) {
  return {
    minute: { limit: 30, used: 30 - minuteRem, remaining: minuteRem, resetAt: opts.minuteReset || null },
    hour: { limit: 300, used: 300 - hourRem, remaining: hourRem, resetAt: opts.hourReset || null },
    day: { limit: 1200, used: 1200 - dayRem, remaining: dayRem, resetAt: opts.dayReset || null },
  };
}

test("A: ample quota with remaining target -> FULL_BATCH", () => {
  const plan = planAdaptiveQuota({
    windows: windows(30, 300, 400),
    laneA: { court: "mich", count: 20, target: 45 },
    config: CFG,
    now: new Date("2026-09-25T01:00:00.000Z"),
  });
  assert.equal(plan.quotaMode, QUOTA_MODES.FULL_BATCH);
  assert.equal(plan.lane, "A");
  assert.ok(plan.usableRequests >= 20);
});

test("B: minute=16 WI 44/45 efficiency~2.13 -> FINISH_TARGET not STOP", () => {
  const plan = planAdaptiveQuota({
    windows: windows(16, 215, 328),
    laneA: { court: "wis", count: 44, target: 45 },
    efficiencyStore: {
      wis: {
        court: "wis",
        ewmaRequestsPerAuthority: 2.13,
        requestsPerAuthority: 2.13,
        sampleCount: 3,
        qualifyingAuthorities: 24,
        requests: 51,
      },
    },
    config: CFG,
    now: new Date("2026-09-25T00:49:00.000Z"),
  });
  assert.ok(
    plan.quotaMode === QUOTA_MODES.FINISH_TARGET || plan.quotaMode === QUOTA_MODES.MICRO_BATCH,
    "expected FINISH_TARGET or MICRO_BATCH, got " + plan.quotaMode,
  );
  assert.equal(plan.lane, "A");
  assert.ok(plan.usableRequests >= 14);
  assert.equal(plan.estimatedRequestsNeeded, Math.ceil(1 * 2.13 * 1.35));
  assert.notEqual(plan.quotaMode, QUOTA_MODES.WAIT_MINUTE);
});

test("C: usable 4 after reserve -> MICRO_BATCH when minimum satisfied", () => {
  const plan = planAdaptiveQuota({
    windows: windows(6, 200, 300),
    laneA: { court: "mich", count: 20, target: 45 },
    config: CFG,
  });
  assert.equal(plan.usableRequests, 4);
  assert.equal(plan.quotaMode, QUOTA_MODES.MICRO_BATCH);
  assert.equal(plan.lane, "A");
});

test("D: minute 2 reserve 2 -> WAIT_FOR_RESET", () => {
  const plan = planAdaptiveQuota({
    windows: windows(2, 200, 300, { minuteReset: "2026-09-25T01:01:00.000Z" }),
    laneA: { court: "wis", count: 44, target: 45 },
    config: CFG,
    now: new Date("2026-09-25T01:00:00.000Z"),
  });
  assert.equal(plan.usableRequests, 0);
  assert.equal(plan.quotaMode, QUOTA_MODES.WAIT_MINUTE);
  assert.ok(plan.lane === "WAIT" || plan.lane === "B");
});

test("E: minute blocked / hour+day healthy -> wait minute, not terminate", () => {
  const plan = planAdaptiveQuota({
    windows: windows(2, 200, 300, { minuteReset: "2026-09-25T01:00:30.000Z" }),
    laneA: { court: "wis", count: 44, target: 45 },
    config: CFG,
    now: new Date("2026-09-25T01:00:00.000Z"),
    laneBHasWork: true,
  });
  assert.equal(plan.quotaMode, QUOTA_MODES.WAIT_MINUTE);
  assert.equal(plan.lane, "WAIT");
  assert.ok(plan.nextUsefulAt);
});

test("F: hour blocked / day healthy -> Lane B if productive", () => {
  const plan = planAdaptiveQuota({
    windows: windows(30, 2, 300, { hourReset: "2026-09-25T02:00:00.000Z" }),
    laneA: { court: "mich", count: 20, target: 45 },
    config: CFG,
    laneBHasWork: true,
  });
  assert.equal(plan.quotaMode, QUOTA_MODES.WAIT_HOUR);
  assert.equal(plan.lane, "B");
  assert.equal(plan.laneBPreferred, true);
});

test("G: day blocked -> Lane B", () => {
  const plan = planAdaptiveQuota({
    windows: windows(30, 200, 5),
    laneA: { court: "mich", count: 20, target: 45 },
    config: CFG,
    laneBHasWork: true,
  });
  assert.equal(plan.quotaMode, QUOTA_MODES.DAY_BLOCKED);
  assert.equal(plan.lane, "B");
});

test("H: efficiency >3.0 across 3 meaningful batches -> HUMAN_REVIEW", () => {
  let store = {};
  for (let i = 0; i < 3; i += 1) {
    store = updateCourtEfficiency(store, { court: "bad", requests: 10, qualifyingAuthorities: 3 }, CFG);
  }
  assert.ok(efficiencyRegressionTriggered(store, "bad", CFG));
  const state = createInitialState();
  state.laneA.court = "bad";
  state.laneA.checkpoint = "cl-opinion-1";
  state.laneA.lastSuccessfulExternalId = "cl-opinion-1";
  state.laneA.count = 10;
  state.laneA.target = 45;
  state.quota.courtEfficiency = store;
  const d = decideLane(state, { windows: windows(30, 300, 400), safeRequests: 28, now: new Date() });
  assert.equal(d.needsHumanReview, true);
  assert.match(d.reason, /EFFICIENCY_REGRESSION/);
});

test("I: known reset timestamp -> no wasteful repeated probes", () => {
  const state = {
    quota: {
      wait: { nextUsefulAt: "2026-09-25T01:10:00.000Z", bindingWindow: "MINUTE" },
      nextCheckAt: "2026-09-25T01:00:00.000Z",
    },
  };
  const before = shouldProbeQuota(state, new Date("2026-09-25T01:05:00.000Z"), CFG);
  assert.equal(before.probe, false);
  assert.equal(before.reason, "waiting_known_reset");
  const after = shouldProbeQuota(state, new Date("2026-09-25T01:10:05.000Z"), CFG);
  assert.equal(after.probe, true);
  assert.equal(after.reason, "post_reset_validation");
});

test("J: near-complete jurisdiction prioritized (FINISH_TARGET)", () => {
  const plan = planAdaptiveQuota({
    windows: windows(16, 215, 328),
    laneA: { court: "wis", count: 44, target: 45 },
    efficiencyStore: { wis: { ewmaRequestsPerAuthority: 2.13, sampleCount: 2 } },
    config: CFG,
  });
  assert.equal(plan.nearComplete, true);
  assert.equal(plan.quotaMode, QUOTA_MODES.FINISH_TARGET);
});

test("K: probe / day utilization accounting present", () => {
  const u = dayUtilization(windows(16, 215, 328), CFG);
  assert.ok(u);
  assert.equal(u.dayLimit, 1200);
  assert.equal(u.dayRemaining, 328);
  assert.equal(u.reservedRequests, 10);
  assert.ok(u.productiveQuotaUtilizationPercent > 0);
  const usable = computeUsableRequests(windows(16, 215, 328), CFG);
  assert.equal(usable.usableRequests, 14);
});

test("L: planner never emits 429 and never invents requests", () => {
  const plan = planAdaptiveQuota({
    windows: windows(16, 215, 328),
    laneA: { court: "wis", count: 44, target: 45 },
    config: CFG,
  });
  assert.equal(plan.hard429, undefined);
  assert.ok(Number.isFinite(plan.estimatedRequestsNeeded));
  assert.ok(plan.estimatedRequestsNeeded >= 1);
});

test("M: AR complete (49/45) does not schedule Lane A finish", () => {
  const plan = planAdaptiveQuota({
    windows: windows(30, 300, 400),
    laneA: { court: "ark", count: 49, target: 45 },
    config: CFG,
  });
  assert.equal(plan.remainingAuthoritiesNeeded, 0);
  assert.equal(plan.useful, false);
  assert.equal(plan.lane, "B");
});

test("N: WI durable 44/45 checkpoint preserved in live state file", () => {
  const statePath = path.join(__dirname, "../packages/research/corpus/reports/queue2-dual-lane-state.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(state.laneA.court, "wis");
  assert.equal(state.laneA.count, 44);
  assert.equal(state.laneA.target, 45);
  assert.equal(state.laneA.checkpoint, "cl-opinion-9886466");
});

test("O: AI calls remain 0 in adaptive config module surface", () => {
  assert.equal(typeof planAdaptiveQuota, "function");
  assert.equal(CFG.aiCalls, undefined);
  const v = validateAdaptiveQuotaConfig(CFG);
  assert.equal(v.ok, true);
});

test("estimateRequestsNeeded uses uncertainty multiplier", () => {
  assert.equal(estimateRequestsNeeded(1, 2.13, CFG), Math.ceil(2.13 * 1.35));
  assert.equal(remainingRequestsToFinishCourt({ count: 44, target: 45 }), Math.ceil(1 * 2.3));
});

test("fixed 25-request gate removed: safe=16 near-complete is Lane A", () => {
  const state = createInitialState();
  state.laneA.court = "wis";
  state.laneA.count = 44;
  state.laneA.target = 45;
  state.laneA.checkpoint = "cl-opinion-9886466";
  state.laneA.lastSuccessfulExternalId = "cl-opinion-9886466";
  state.quota.courtEfficiency = { wis: { ewmaRequestsPerAuthority: 2.13, sampleCount: 3 } };
  const d = decideLane(state, {
    windows: windows(16, 215, 328),
    safeRequests: 16,
    now: new Date("2026-09-25T00:49:00.000Z"),
  });
  assert.equal(d.lane, "A");
  assert.equal(d.quotaMode, QUOTA_MODES.FINISH_TARGET);
});

test("H: FINISH_TARGET with usable quota now → nextUsefulAt null", () => {
  const state = createInitialState();
  state.laneA.court = "wis";
  state.laneA.count = 44;
  state.laneA.target = 45;
  state.laneA.checkpoint = "cl-opinion-9886466";
  state.laneA.lastSuccessfulExternalId = "cl-opinion-9886466";
  state.quota.courtEfficiency = { wis: { ewmaRequestsPerAuthority: 2.13, sampleCount: 3 } };
  const dayReset = "2026-09-26T00:36:37.000Z";
  const d = decideLane(state, {
    windows: windows(30, 300, 1115, { dayReset }),
    safeRequests: 28,
    projectedUsefulAt: dayReset,
    now: new Date("2026-09-25T20:36:00.000Z"),
  });
  assert.equal(d.quotaMode, QUOTA_MODES.FINISH_TARGET);
  assert.equal(d.lane, "A");
  assert.equal(d.nextUsefulAt, null);
  assert.ok(d.usableRequests >= 4);
});

test("I: FULL_BATCH with usable quota now → deferred nextCheckAt (no immediate reprobe)", () => {
  const state = createInitialState();
  state.laneA.court = "mich";
  state.laneA.count = 20;
  state.laneA.target = 45;
  state.laneA.checkpoint = "cl-opinion-x";
  state.laneA.lastSuccessfulExternalId = "cl-opinion-x";
  const dayReset = "2026-09-26T00:36:37.000Z";
  const now = new Date("2026-09-25T20:36:00.000Z");
  const d = decideLane(state, {
    windows: windows(30, 300, 400, { dayReset }),
    projectedUsefulAt: dayReset,
    now,
  });
  assert.equal(d.quotaMode, QUOTA_MODES.FULL_BATCH);
  assert.equal(d.lane, "A");
  assert.equal(d.nextUsefulAt, null);
  // Must NOT set nextCheckAt≈now (that caused the 5s quota reprobe loop).
  assert.ok(new Date(d.nextCheckAt).getTime() >= now.getTime() + 14 * 60 * 1000);
});

test("J: WAIT_MINUTE → nextUsefulAt uses minute reset", () => {
  const minuteReset = "2026-09-25T20:37:00.000Z";
  const plan = planAdaptiveQuota({
    windows: windows(0, 300, 400, { minuteReset }),
    laneA: { court: "wis", count: 20, target: 45 },
    config: CFG,
    now: new Date("2026-09-25T20:36:00.000Z"),
    laneBHasWork: false,
  });
  assert.equal(plan.quotaMode, QUOTA_MODES.WAIT_MINUTE);
  assert.ok(plan.nextUsefulAt);
  assert.ok(String(plan.nextUsefulAt).includes("2026-09-25T20:37") || plan.nextUsefulAt === minuteReset || new Date(plan.nextUsefulAt).getTime() >= new Date(minuteReset).getTime());
});

test("K: WAIT_HOUR → nextUsefulAt uses hour reset", () => {
  const hourReset = "2026-09-25T21:00:00.000Z";
  const plan = planAdaptiveQuota({
    windows: windows(30, 0, 400, { hourReset }),
    laneA: { court: "wis", count: 20, target: 45 },
    config: CFG,
    now: new Date("2026-09-25T20:36:00.000Z"),
    laneBHasWork: true,
  });
  assert.equal(plan.quotaMode, QUOTA_MODES.WAIT_HOUR);
  assert.ok(plan.nextUsefulAt);
});

test("M: generic checkpoint output does not use arDurableCheckpoint", () => {
  const finalPath = path.join(__dirname, "../packages/research/corpus/reports/queue2-dual-lane-final.json");
  const final = JSON.parse(fs.readFileSync(finalPath, "utf8"));
  assert.equal(final.checkpointSafety?.arDurableCheckpoint, undefined);
  assert.ok(final.checkpointSafety?.durableCheckpoint || final.laneA?.checkpoint);
});

console.log(JSON.stringify({ ok: true, tests: passed, suite: "cl-adaptive-quota", workerStarted: false, aiCalls: 0, corpusMutations: 0 }));
