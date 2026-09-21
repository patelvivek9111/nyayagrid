/**
 * CourtListener Tier-2 quota arithmetic (pure, no network).
 * Live limits come from /api/rest/v4/api-usage/; never assume without probing.
 */

/** @typedef {{ limit: number, used: number, remaining: number, resetAt?: string|null }} Window */

/**
 * @param {{ minute: Window, hour: Window, day: Window }} windows
 * @param {{ minuteSafetyRatio?: number, hourSafetyRatio?: number, dayReserve?: number }} [opts]
 */
function computeSafetyTargets(windows, opts = {}) {
  const minuteSafetyRatio = opts.minuteSafetyRatio ?? 14 / 15;
  const hourSafetyRatio = opts.hourSafetyRatio ?? 140 / 150;
  const dayReserve = opts.dayReserve ?? Math.max(20, Math.round((windows.day.limit || 600) * (20 / 600)));

  const minuteTarget = Math.max(1, Math.floor((windows.minute.limit || 1) * minuteSafetyRatio));
  const hourTarget = Math.max(1, Math.floor((windows.hour.limit || 1) * hourSafetyRatio));
  const dayTarget = Math.max(1, (windows.day.limit || 1) - dayReserve);

  return { minuteTarget, hourTarget, dayTarget, dayReserve };
}

/**
 * @param {{ minute: Window, hour: Window, day: Window }} windows
 * @param {{ minuteTarget: number, hourTarget: number, dayTarget: number }} targets
 * @param {number} [alreadyUsedThisProcess]
 */
function computeSafeRequests(windows, targets, alreadyUsedThisProcess = 0) {
  const minuteRem = Math.max(0, Math.min(windows.minute.remaining, targets.minuteTarget) - alreadyUsedThisProcess);
  // Hour/day already account for prior usage via remaining; also clamp to target-used.
  const hourUsed = Math.max(0, windows.hour.limit - windows.hour.remaining);
  const dayUsed = Math.max(0, windows.day.limit - windows.day.remaining);
  const hourRem = Math.max(0, Math.min(windows.hour.remaining, targets.hourTarget - hourUsed));
  const dayRem = Math.max(0, Math.min(windows.day.remaining, targets.dayTarget - dayUsed));
  const safe = Math.max(0, Math.min(minuteRem, hourRem, dayRem));
  return { safe, minuteRem, hourRem, dayRem };
}

/** Nominal spacing ms for a target per-minute rate. */
function spacingMsForMinuteTarget(minuteTarget) {
  if (!minuteTarget || minuteTarget <= 0) return 60_000;
  return Math.ceil(60_000 / minuteTarget);
}

/**
 * Sustained spacing that also respects hourly ceiling over a rolling hour.
 * @param {number} minuteTarget
 * @param {number} hourTarget
 */
function sustainedSpacingMs(minuteTarget, hourTarget) {
  const fromMinute = spacingMsForMinuteTarget(minuteTarget);
  const fromHour = hourTarget > 0 ? Math.ceil(3_600_000 / hourTarget) : fromMinute;
  // Prefer the more conservative (larger) spacing for sustained runs.
  return Math.max(fromMinute, fromHour);
}

/**
 * Detect Tier-2-class elevation vs free defaults (5/50/125).
 * @param {{ minute: number, hour: number, day: number }} limits
 */
function isElevatedAboveFree(limits) {
  return (
    Number(limits.minute) > 5 || Number(limits.hour) > 50 || Number(limits.day) > 125
  );
}

/**
 * Parse /api-usage/ current_usage rows into minute/hour/day user windows.
 * @param {any} payload
 */
function parseApiUsagePayload(payload) {
  const membership = payload?.membership || null;
  const current = Array.isArray(payload?.current_usage) ? payload.current_usage : [];
  /** @type {Record<string, Window>} */
  const byPeriod = {};
  for (const row of current) {
    if (String(row.scope || "").toLowerCase() !== "user") continue;
    const rate = String(row.rate || "").toLowerCase();
    const period = rate.includes("/min")
      ? "minute"
      : rate.includes("/hour")
        ? "hour"
        : rate.includes("/day")
          ? "day"
          : null;
    if (!period) continue;
    const limit = Number(row.limit);
    const used = Number(row.used ?? row.usage ?? 0);
    const remaining = Number(
      row.remaining ?? (Number.isFinite(limit) ? limit - used : NaN),
    );
    byPeriod[period] = {
      limit,
      used,
      remaining: Number.isFinite(remaining) ? remaining : 0,
      resetAt: row.reset_at || null,
    };
  }
  return {
    membership: {
      level: membership?.level || null,
      is_active: membership?.is_active ?? null,
    },
    windows: {
      minute: byPeriod.minute || { limit: 5, used: 0, remaining: 5 },
      hour: byPeriod.hour || { limit: 50, used: 0, remaining: 50 },
      day: byPeriod.day || { limit: 125, used: 0, remaining: 125 },
    },
  };
}

module.exports = {
  computeSafetyTargets,
  computeSafeRequests,
  spacingMsForMinuteTarget,
  sustainedSpacingMs,
  isElevatedAboveFree,
  parseApiUsagePayload,
};
