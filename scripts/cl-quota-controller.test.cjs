const assert = require("node:assert/strict");
const {
  computeSafetyTargets,
  computeSafeRequests,
  spacingMsForMinuteTarget,
  sustainedSpacingMs,
  isElevatedAboveFree,
  parseApiUsagePayload,
} = require("./cl-quota-controller.cjs");

function testExpectedTierDocs() {
  // Documented Tier 2 brochure numbers
  const windows = {
    minute: { limit: 15, used: 0, remaining: 15 },
    hour: { limit: 150, used: 0, remaining: 150 },
    day: { limit: 600, used: 0, remaining: 600 },
  };
  const t = computeSafetyTargets(windows);
  assert.equal(t.minuteTarget, 14);
  assert.equal(t.hourTarget, 140);
  assert.equal(t.dayTarget, 580);
  assert.equal(spacingMsForMinuteTarget(14), Math.ceil(60000 / 14));
}

function testLiveElevatedLimits() {
  // Observed live Tier 2 on 2026-09-21: 30/300/1200
  const windows = {
    minute: { limit: 30, used: 0, remaining: 30 },
    hour: { limit: 300, used: 0, remaining: 300 },
    day: { limit: 1200, used: 250, remaining: 950 },
  };
  assert.equal(isElevatedAboveFree({ minute: 30, hour: 300, day: 1200 }), true);
  assert.equal(isElevatedAboveFree({ minute: 5, hour: 50, day: 125 }), false);
  const t = computeSafetyTargets(windows);
  assert.equal(t.minuteTarget, 28);
  assert.equal(t.hourTarget, 280);
  assert.equal(t.dayTarget, 1160);
  const safe = computeSafeRequests(windows, t, 0);
  // dayTarget-used = 1160-250 = 910; remaining=950 → dayRem=910
  assert.equal(safe.dayRem, 910);
  assert.equal(safe.safe, Math.min(28, 280, 910));
  assert.ok(sustainedSpacingMs(28, 280) >= spacingMsForMinuteTarget(28));
}

function testExistingUsageReducesQuota() {
  const windows = {
    minute: { limit: 15, used: 10, remaining: 5 },
    hour: { limit: 150, used: 140, remaining: 10 },
    day: { limit: 600, used: 580, remaining: 20 },
  };
  const t = computeSafetyTargets(windows);
  const safe = computeSafeRequests(windows, t, 0);
  // hourTarget-used = 140-140 = 0 → hourRem=0
  assert.equal(safe.hourRem, 0);
  assert.equal(safe.safe, 0);
  const withProcess = computeSafeRequests(
    {
      minute: { limit: 15, used: 0, remaining: 15 },
      hour: { limit: 150, used: 0, remaining: 150 },
      day: { limit: 600, used: 0, remaining: 600 },
    },
    t,
    10,
  );
  assert.equal(withProcess.minuteRem, 4); // 14-10
}

function testParseApiUsage() {
  const payload = {
    membership: { level: "CL Membership - Tier 2", is_active: true },
    current_usage: [
      { scope: "user", rate: "1200/day", used: 250, limit: 1200, remaining: 950 },
      { scope: "user", rate: "30/min", used: 0, limit: 30, remaining: 30 },
      { scope: "user", rate: "300/hour", used: 0, limit: 300, remaining: 300 },
      { scope: "api_usage", rate: "10/min", used: 1, limit: 10, remaining: 9 },
    ],
  };
  const parsed = parseApiUsagePayload(payload);
  assert.equal(parsed.membership.level, "CL Membership - Tier 2");
  assert.equal(parsed.windows.minute.limit, 30);
  assert.equal(parsed.windows.hour.limit, 300);
  assert.equal(parsed.windows.day.limit, 1200);
  assert.equal(parsed.windows.day.remaining, 950);
}

testExpectedTierDocs();
testLiveElevatedLimits();
testExistingUsageReducesQuota();
testParseApiUsage();
console.log(JSON.stringify({ ok: true, tests: 4 }));
