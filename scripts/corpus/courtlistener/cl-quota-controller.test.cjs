/**
 * CourtListener quota reconciliation tests (deterministic — no network, no 429, no ingest).
 */
"use strict";

const assert = require("node:assert/strict");
const {
  computeSafetyTargets,
  computeSafeRequests,
  spacingMsForMinuteTarget,
  sustainedSpacingMs,
  isElevatedAboveFree,
  parseApiUsagePayload,
  extractJsonObject,
  reconcileQuotaProbe,
  looksLikeFreeDefault,
  looksLikeTier2Live,
  windowsPastReset,
  QUOTA_CONFIDENCE,
  TIER2_LIVE,
} = require("./cl-quota-controller.cjs");

function testExpectedTierDocs() {
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
  const windows = {
    minute: { limit: 30, used: 0, remaining: 30 },
    hour: { limit: 300, used: 0, remaining: 300 },
    day: { limit: 1200, used: 250, remaining: 950 },
  };
  assert.equal(isElevatedAboveFree({ minute: 30, hour: 300, day: 1200 }), true);
  assert.equal(isElevatedAboveFree({ minute: 5, hour: 50, day: 125 }), false);
  assert.equal(looksLikeTier2Live(windows), true);
  const t = computeSafetyTargets(windows);
  assert.equal(t.minuteTarget, 28);
  assert.equal(t.hourTarget, 280);
  assert.equal(t.dayTarget, 1160);
  const safe = computeSafeRequests(windows, t, 0);
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
  assert.equal(withProcess.minuteRem, 4);
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

function testTier2Parse30_300_1200() {
  const probe = {
    ok: true,
    membership: { level: "CL Membership - Tier 2", is_active: true },
    limits: {
      minute: { limit: 30, usage: 0, remaining: 30, reset_at: null },
      hour: { limit: 300, usage: 0, remaining: 300, reset_at: null },
      day: { limit: 1200, usage: 865, remaining: 335, reset_at: "2026-09-25T00:14:25.981596+00:00" },
    },
  };
  const r = reconcileQuotaProbe({ parsed: probe, now: new Date("2026-09-25T00:10:00.000Z") });
  assert.equal(r.ok, true);
  assert.equal(r.quotaStateConfidence, QUOTA_CONFIDENCE.AUTHORITATIVE_API);
  assert.equal(r.windows.day.remaining, 335);
  assert.equal(r.windows.minute.limit, TIER2_LIVE.minute);
  assert.ok(r.safe.safe > 0);
  assert.equal(r.humanReview, false);
}

function testRecoveryAfterDayWindowRolls() {
  const prior = {
    minute: { limit: 30, used: 0, remaining: 30, resetAt: null },
    hour: { limit: 300, used: 0, remaining: 300, resetAt: null },
    day: {
      limit: 1200,
      used: 1171,
      remaining: 29,
      resetAt: "2026-09-24T22:06:14.563161+00:00",
    },
  };
  assert.equal(windowsPastReset(prior, new Date("2026-09-25T00:10:00.000Z")), true);
  const priorTargets = computeSafetyTargets(prior);
  assert.equal(computeSafeRequests(prior, priorTargets, 0).safe, 0);

  const live = {
    ok: true,
    membership: { level: "CL Membership - Tier 2", is_active: true },
    limits: {
      minute: { limit: 30, usage: 0, remaining: 30, reset_at: null },
      hour: { limit: 300, usage: 0, remaining: 300, reset_at: null },
      day: {
        limit: 1200,
        usage: 865,
        remaining: 335,
        reset_at: "2026-09-25T00:14:25.981596+00:00",
      },
    },
  };
  const r = reconcileQuotaProbe({
    parsed: live,
    priorWindows: prior,
    priorObservedAt: "2026-09-24T22:00:00.000Z",
    now: new Date("2026-09-25T00:10:00.000Z"),
  });
  assert.equal(r.windows.day.remaining, 335);
  assert.notEqual(r.windows.day.resetAt, prior.day.resetAt);
  assert.ok(r.safe.safe > 0);
  assert.equal(r.quotaStateConfidence, QUOTA_CONFIDENCE.AUTHORITATIVE_API);
}

function testStaleResetTimestampReplaced() {
  const prior = {
    minute: { limit: 30, used: 0, remaining: 30, resetAt: null },
    hour: { limit: 300, used: 0, remaining: 300, resetAt: null },
    day: { limit: 1200, used: 1171, remaining: 29, resetAt: "2026-09-24T22:06:14.563161+00:00" },
  };
  const live = {
    membership: { level: "CL Membership - Tier 2", is_active: true },
    limits: {
      minute: { limit: 30, remaining: 30, usage: 0 },
      hour: { limit: 300, remaining: 300, usage: 0 },
      day: { limit: 1200, remaining: 335, usage: 865, reset_at: "2026-09-25T06:00:00.000Z" },
    },
  };
  const r = reconcileQuotaProbe({
    parsed: live,
    priorWindows: prior,
    now: new Date("2026-09-25T01:00:00.000Z"),
  });
  assert.equal(r.windows.day.resetAt, "2026-09-25T06:00:00.000Z");
}

function testFreeTierDoesNotOverwriteValidatedTier2Incorrectly() {
  const prior = {
    minute: { limit: 30, used: 0, remaining: 30, resetAt: null },
    hour: { limit: 300, used: 0, remaining: 300, resetAt: null },
    day: { limit: 1200, used: 100, remaining: 1100, resetAt: "2026-09-25T22:00:00.000Z" },
  };
  assert.equal(looksLikeFreeDefault({
    minute: { limit: 5 },
    hour: { limit: 50 },
    day: { limit: 125 },
  }), true);
  // Incomplete/membership-only fragment must not replace live Tier 2.
  const r = reconcileQuotaProbe({
    parsed: { membership: { level: "CL Membership - Tier 2", is_active: true } },
    priorWindows: prior,
    priorMembership: { level: "CL Membership - Tier 2", is_active: true },
    priorObservedAt: "2026-09-25T01:00:00.000Z",
    now: new Date("2026-09-25T01:05:00.000Z"),
  });
  assert.equal(r.windows.day.limit, 1200);
  assert.equal(r.windows.day.remaining, 1100);
  assert.equal(r.humanReview, true);
  assert.equal(r.reviewReason, "COURTLISTENER_QUOTA_STATE_AMBIGUOUS");
  assert.equal(r.quotaStateConfidence, QUOTA_CONFIDENCE.AMBIGUOUS);
}

function testSafeRequestsRecovered() {
  const windows = {
    minute: { limit: 30, used: 0, remaining: 30 },
    hour: { limit: 300, used: 0, remaining: 300 },
    day: { limit: 1200, used: 865, remaining: 335 },
  };
  const t = computeSafetyTargets(windows);
  const safe = computeSafeRequests(windows, t, 0);
  assert.ok(safe.safe > 0);
}

function testSafeRequestsZeroWhenUnavailable() {
  const windows = {
    minute: { limit: 30, used: 0, remaining: 30 },
    hour: { limit: 300, used: 0, remaining: 300 },
    day: { limit: 1200, used: 1171, remaining: 29 },
  };
  const t = computeSafetyTargets(windows);
  const safe = computeSafeRequests(windows, t, 0);
  assert.equal(safe.safe, 0);
}

function testAmbiguousTriggersReview() {
  const r = reconcileQuotaProbe({
    parsed: { membership: { level: "CL Membership - Tier 2", is_active: true } },
    priorWindows: {
      minute: { limit: 30, remaining: 30, used: 0, resetAt: null },
      hour: { limit: 300, remaining: 300, used: 0, resetAt: null },
      day: { limit: 1200, remaining: 29, used: 1171, resetAt: "2026-09-24T22:06:14.000Z" },
    },
    priorMembership: { level: "CL Membership - Tier 2", is_active: true },
    now: new Date("2026-09-25T01:00:00.000Z"),
  });
  assert.equal(r.ambiguous, true);
  assert.equal(r.humanReview, true);
  assert.equal(r.reviewReason, "COURTLISTENER_QUOTA_STATE_AMBIGUOUS");
}

function testExtractJsonObjectIgnoresNestedRawSample() {
  const probe = {
    ok: true,
    membership: { level: "CL Membership - Tier 2", is_active: true },
    limits: {
      minute: { limit: 30, usage: 0, remaining: 30, reset_at: null },
      hour: { limit: 300, usage: 0, remaining: 300, reset_at: null },
      day: { limit: 1200, usage: 865, remaining: 335, reset_at: "2026-09-25T00:14:25Z" },
    },
    rawSample: JSON.stringify({
      membership: { level: "CL Membership - Tier 2", is_active: true },
    }),
  };
  const text = JSON.stringify(probe, null, 2);
  const badStart = text.lastIndexOf("{");
  assert.ok(badStart > text.indexOf("{"));
  // last brace points inside rawSample string — not the top-level probe.
  assert.ok(text.slice(badStart).includes("is_active"));
  let badParsed = null;
  try {
    badParsed = JSON.parse(text.slice(badStart));
  } catch {
    badParsed = null;
  }
  // Whether parse succeeds or fails, last-brace strategy is wrong for probe.limits.
  assert.ok(!badParsed || badParsed.limits == null);

  const good = extractJsonObject(text);
  assert.equal(good.limits.day.remaining, 335);
  assert.equal(good.membership.level, "CL Membership - Tier 2");
}

function testProbeDoesNotIngest() {
  // This module has no ingest APIs; reconciliation is pure.
  const src = require("fs").readFileSync(require("path").join(__dirname, "cl-quota-controller.cjs"), "utf8");
  assert.equal(/ingest|opinions\?|courtlistener\.com\/api\/rest\/v4\/opinions/i.test(src), false);
  assert.equal(/429/.test(src) && /throw.*429/.test(src), false);
}

testExpectedTierDocs();
testLiveElevatedLimits();
testExistingUsageReducesQuota();
testParseApiUsage();
testTier2Parse30_300_1200();
testRecoveryAfterDayWindowRolls();
testStaleResetTimestampReplaced();
testFreeTierDoesNotOverwriteValidatedTier2Incorrectly();
testSafeRequestsRecovered();
testSafeRequestsZeroWhenUnavailable();
testAmbiguousTriggersReview();
testExtractJsonObjectIgnoresNestedRawSample();
testProbeDoesNotIngest();
console.log(JSON.stringify({ ok: true, tests: 13 }));
