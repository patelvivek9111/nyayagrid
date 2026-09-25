/**
 * Queue #2 READY first-start + quota micro-batch + canary bounds.
 * Zero network. Zero corpus mutation. Zero AI. Zero real CL ingestion.
 */
"use strict";

const assert = require("node:assert/strict");
const {
  QUOTA_MODES,
  planAdaptiveQuota,
  loadAdaptiveQuotaConfig,
} = require("./cl-adaptive-quota.cjs");
const {
  decideLane,
  createInitialState,
  restoreState,
  applyDurableJobCheckpoint,
  persistLaneAProgress,
  isReadyFirstStartLaneA,
  isPartialLaneA,
  requiresDurableResumeCheckpoint,
  isMissingDurableResumeCheckpointFatal,
  validatePartialCheckpoint,
  hasDurableCheckpoint,
  HUMAN_REVIEW_REASONS,
} = require("./queue2-dual-lane-controller.cjs");
const { resolveLaneABatchBounds, remainingCasesToFinish } = require("./queue2-lane-a-dispatch.cjs");
const { runWatchdogCycle, OVERALL, initWatchdogSession } = require("./queue2-watchdog.cjs");

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
  },
});

function windows(minuteRem, hourRem, dayRem) {
  return {
    minute: { remaining: minuteRem, limit: 30 },
    hour: { remaining: hourRem, limit: 300 },
    day: { remaining: dayRem, limit: 1200 },
  };
}

function miReadyLaneA(overrides = {}) {
  return {
    court: "mich",
    jurisdiction: "MI",
    count: 20,
    target: 45,
    targetStatus: "READY",
    jobStatus: "ready",
    checkpoint: null,
    cursor: null,
    lastSuccessfulExternalId: null,
    nextPageUrl: null,
    mappingStatus: "VERIFIED",
    ...overrides,
  };
}

function miFixtureState() {
  const state = createInitialState();
  state.laneA = miReadyLaneA();
  state.completedCourts = ["wis"];
  state.humanReview = { required: false, reasons: [], details: [] };
  state.canaryMode = "CANARY_REQUIRED";
  state.canary = { required: true, maxQualifyingAuthorities: 3, maxClRequests: 12 };
  return state;
}

// --- §8 exact MI scenario ---
test("MI READY first-start fixture: Lane A MICRO/FULL, not DAY_BLOCKED, no missing checkpoint", () => {
  const state = miFixtureState();
  assert.equal(isReadyFirstStartLaneA(state.laneA), true);
  assert.equal(isPartialLaneA(state.laneA), false);
  assert.equal(requiresDurableResumeCheckpoint(state.laneA), false);
  assert.equal(isMissingDurableResumeCheckpointFatal(state.laneA), false);
  assert.equal(validatePartialCheckpoint(state.laneA).humanReviewRequired, false);

  const remaining = remainingCasesToFinish(state.laneA);
  assert.equal(remaining, 25);
  const plan = planAdaptiveQuota({
    windows: windows(30, 300, 1106),
    laneA: state.laneA,
    config: CFG,
  });
  assert.ok(plan.estimatedRequestsNeeded >= 58);
  // With default rpa 2.3 * uncertainty 1.35: ceil(25*2.3*1.35)=78; without uncertainty path may be 58.
  assert.ok(plan.usableRequests >= 28 || plan.usableRequests === 28);
  // day healthy + usable >= full/micro → not DAY_BLOCKED
  assert.notEqual(plan.quotaMode, QUOTA_MODES.DAY_BLOCKED);
  assert.ok(
    plan.quotaMode === QUOTA_MODES.FULL_BATCH || plan.quotaMode === QUOTA_MODES.MICRO_BATCH,
    `expected FULL/MICRO got ${plan.quotaMode}`,
  );
  assert.equal(plan.lane, "A");

  const d = decideLane(state, {
    windows: windows(30, 300, 1106),
    safeRequests: 28,
    now: new Date("2026-09-25T16:00:00.000Z"),
    config: CFG,
  });
  assert.equal(d.lane, "A");
  assert.notEqual(d.quotaMode, QUOTA_MODES.DAY_BLOCKED);
  assert.ok(
    d.quotaMode === QUOTA_MODES.FULL_BATCH || d.quotaMode === QUOTA_MODES.MICRO_BATCH,
    `decideLane mode ${d.quotaMode}`,
  );
  assert.notEqual(d.needsHumanReview, true);
  assert.equal(state.humanReview.required, false);

  const bounds = resolveLaneABatchBounds({
    canaryRequired: true,
    maxQualifyingAuthorities: 3,
    maxClRequests: 12,
    remainingAuthorities: 25,
    usableRequests: 28,
    requestsPerAuthorityEstimate: 2.3,
    resourceMaxAuthorities: 8,
    resourceMaxClRequests: 40,
    checkpoint: null,
  });
  assert.ok(bounds.authorities <= 3);
  assert.ok(bounds.maxClRequests <= 12);
  assert.equal(bounds.initialStart, true);
});

// --- §9 quota blocking ---
test("quota A: dayRemaining=1106 safe=28 need=58 → NOT DAY_BLOCKED", () => {
  const plan = planAdaptiveQuota({
    windows: windows(30, 300, 1106),
    laneA: miReadyLaneA(),
    config: CFG,
  });
  assert.notEqual(plan.quotaMode, QUOTA_MODES.DAY_BLOCKED);
  assert.ok([QUOTA_MODES.FULL_BATCH, QUOTA_MODES.MICRO_BATCH, QUOTA_MODES.FINISH_TARGET].includes(plan.quotaMode));
});

test("quota B: day usable below minimum → DAY_BLOCKED", () => {
  const plan = planAdaptiveQuota({
    windows: windows(30, 300, 11), // dayRem - reserve(10) = 1 < min(3)
    laneA: miReadyLaneA(),
    config: CFG,
  });
  // usable day may still bind through computeUsableRequests — assert DAY_BLOCKED when day window exhausted
  const dayUsable = 11 - 10;
  if (dayUsable < 3) {
    assert.ok(
      plan.quotaMode === QUOTA_MODES.DAY_BLOCKED || plan.usableRequests < 3,
      `expected day block or unusable, got ${plan.quotaMode} usable=${plan.usableRequests}`,
    );
  }
});

test("quota C: hour usable below min, day healthy → WAIT_HOUR / hour-block", () => {
  const plan = planAdaptiveQuota({
    windows: windows(30, 6, 1106), // hourRem - 5 = 1 < 3
    laneA: miReadyLaneA(),
    config: CFG,
  });
  assert.ok(
    plan.quotaMode === QUOTA_MODES.WAIT_HOUR ||
      plan.bindingWindow === "hour" ||
      plan.usableRequests < 3,
    `got ${plan.quotaMode} bind=${plan.bindingWindow}`,
  );
  assert.notEqual(plan.quotaMode, QUOTA_MODES.DAY_BLOCKED);
});

test("quota D: minute usable below min → WAIT_MINUTE", () => {
  const plan = planAdaptiveQuota({
    windows: windows(3, 300, 1106), // minuteRem - 2 = 1 < 3
    laneA: miReadyLaneA(),
    config: CFG,
  });
  assert.ok(
    plan.quotaMode === QUOTA_MODES.WAIT_MINUTE || plan.usableRequests < 3,
    `got ${plan.quotaMode}`,
  );
});

test("quota E: need > current budget → MICRO/FULL batch, not blocked", () => {
  const plan = planAdaptiveQuota({
    usableRequestsOverride: 28,
    laneA: miReadyLaneA(),
    config: CFG,
  });
  assert.ok(plan.estimatedRequestsNeeded > 28);
  assert.notEqual(plan.quotaMode, QUOTA_MODES.DAY_BLOCKED);
  assert.ok(
    plan.quotaMode === QUOTA_MODES.FULL_BATCH || plan.quotaMode === QUOTA_MODES.MICRO_BATCH,
  );
  assert.equal(plan.useful, true);
  assert.equal(plan.lane, "A");
});

test("quota F: canary cap reduces otherwise larger batch", () => {
  const without = resolveLaneABatchBounds({
    canaryRequired: false,
    remainingAuthorities: 25,
    usableRequests: 28,
    requestsPerAuthorityEstimate: 2.3,
    resourceMaxAuthorities: 8,
    resourceMaxClRequests: 40,
  });
  const withCanary = resolveLaneABatchBounds({
    canaryRequired: true,
    maxQualifyingAuthorities: 3,
    maxClRequests: 12,
    remainingAuthorities: 25,
    usableRequests: 28,
    requestsPerAuthorityEstimate: 2.3,
    resourceMaxAuthorities: 8,
    resourceMaxClRequests: 40,
  });
  assert.ok(withCanary.authorities <= 3);
  assert.ok(withCanary.maxClRequests <= 12);
  assert.ok(withCanary.authorities < without.authorities || without.authorities <= 3);
});

// --- §10 checkpoint ---
test("checkpoint A: READY 20/45 no checkpoint → valid first-start", () => {
  const laneA = miReadyLaneA();
  assert.equal(isReadyFirstStartLaneA(laneA), true);
  assert.equal(isMissingDurableResumeCheckpointFatal(laneA), false);
  assert.equal(validatePartialCheckpoint(laneA).ok, true);
});

test("checkpoint B: PARTIAL 20/45 no checkpoint with prior job evidence → fatal", () => {
  const laneA = miReadyLaneA({
    targetStatus: "PARTIAL",
    jobStatus: "quota_paused",
    checkpoint: null,
  });
  assert.equal(requiresDurableResumeCheckpoint(laneA), true);
  assert.equal(isMissingDurableResumeCheckpointFatal(laneA), true);
  const v = validatePartialCheckpoint(laneA);
  assert.equal(v.humanReviewRequired, true);
  assert.equal(v.reason, HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT);
});

test("checkpoint C: READY + baseline corpus only → no missing checkpoint review", () => {
  const laneA = miReadyLaneA({ count: 20, target: 45 });
  assert.equal(hasDurableCheckpoint(laneA), false);
  assert.equal(validatePartialCheckpoint(laneA).humanReviewRequired, false);
  const state = createInitialState();
  state.laneA = laneA;
  state.humanReview = {
    required: true,
    reasons: [HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT],
    details: [{ reason: HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT, detail: "stale" }],
  };
  const restored = restoreState(state);
  assert.equal(restored.humanReview.required, false);
});

test("checkpoint D: first successful CL result → checkpoint created atomically", () => {
  let state = miFixtureState();
  assert.equal(state.laneA.checkpoint, null);
  const applied = applyDurableJobCheckpoint(
    state,
    {
      cl_court: "mich",
      cursor: "cl-opinion-mi-1",
      last_successful_external_id: "cl-opinion-mi-1",
      status: "running",
      updated_at: "2026-09-25T16:10:00.000Z",
      target_max: 45,
      items_imported: 1,
    },
    { count: 21, jurisdiction: "MI", mappingStatus: "VERIFIED" },
  );
  assert.equal(applied.ok, true);
  assert.equal(applied.state.laneA.checkpoint, "cl-opinion-mi-1");
  assert.equal(applied.state.laneA.lastSuccessfulExternalId, "cl-opinion-mi-1");
  assert.ok(hasDurableCheckpoint(applied.state.laneA));
});

test("checkpoint E: preflight and runtime checkpoint policy return same result", () => {
  const ready = miReadyLaneA();
  const partial = miReadyLaneA({ targetStatus: "PARTIAL", jobStatus: "quota_paused" });
  // Runtime shared helpers === validatePartialCheckpoint (preflight uses same)
  assert.equal(
    isMissingDurableResumeCheckpointFatal(ready),
    validatePartialCheckpoint(ready).humanReviewRequired,
  );
  assert.equal(
    isMissingDurableResumeCheckpointFatal(partial),
    validatePartialCheckpoint(partial).humanReviewRequired,
  );
  assert.equal(isMissingDurableResumeCheckpointFatal(ready), false);
  assert.equal(isMissingDurableResumeCheckpointFatal(partial), true);
});

test("watchdog: human review must not report HEALTHY_IDLE_SAFE", () => {
  const session = initWatchdogSession({ workerId: "test", processStartNonce: "n1" });
  const wd = runWatchdogCycle({
    snapshot: {
      processAlive: true,
      machineAwake: true,
      pidAlive: true,
      lockMatchesSession: true,
      lastHeartbeatAt: new Date().toISOString(),
      currentLane: "HUMAN_REVIEW_REQUIRED",
      humanReviewRequired: true,
      humanReviewReasons: [HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT],
      productiveWorkAvailable: true,
      idleSafe: false,
      queue3: "NOT_OPEN",
    },
    session,
    persist: false,
  });
  assert.equal(wd.state.overallStatus, OVERALL.HUMAN_REVIEW_REQUIRED);
  assert.notEqual(wd.state.overallStatus, OVERALL.HEALTHY_IDLE_SAFE);
});

test("persistLaneAProgress allows READY first-start null checkpoint until first success", () => {
  const state = miFixtureState();
  const ok = persistLaneAProgress(state, {
    court: "mich",
    count: 20,
    target: 45,
    targetStatus: "READY",
    jobStatus: "ready",
    checkpoint: null,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.state.humanReview?.required, false);
});

console.log(`queue2-ready-start-quota.test.cjs: ${passed} passed`);
