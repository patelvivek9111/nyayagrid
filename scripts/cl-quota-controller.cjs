/**
 * CourtListener Tier-2 quota arithmetic + probe reconciliation (pure, no network).
 * Live limits come from /api/rest/v4/api-usage/; never assume without probing.
 */

/** @typedef {{ limit: number, used: number, remaining: number, resetAt?: string|null }} Window */

const QUOTA_CONFIDENCE = Object.freeze({
  AUTHORITATIVE_HEADER: "AUTHORITATIVE_HEADER",
  AUTHORITATIVE_API: "AUTHORITATIVE_API",
  DERIVED_ROLLING_WINDOW: "DERIVED_ROLLING_WINDOW",
  STALE_FALLBACK: "STALE_FALLBACK",
  AMBIGUOUS: "AMBIGUOUS",
});

const FREE_DEFAULT = Object.freeze({ minute: 5, hour: 50, day: 125 });
const TIER2_LIVE = Object.freeze({ minute: 30, hour: 300, day: 1200 });

/**
 * Extract the first complete top-level JSON object from mixed stdout.
 * Avoids lastIndexOf("{") which incorrectly latches onto nested fragments
 * inside string fields (e.g. rawSample) and yields free-default fallbacks.
 * @param {string} text
 * @returns {any|null}
 */
function extractJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const start = raw.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < raw.length; i += 1) {
    const c = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === "\"") inStr = false;
      continue;
    }
    if (c === "\"") {
      inStr = true;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }

  // Fallback: last non-empty line that is valid JSON (single-line probes).
  const lines = raw.split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      /* continue */
    }
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

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
 * Conservative safe request count from live remaining counters.
 * Prefer authoritative remaining; also clamp below day/hour safety targets.
 * @param {{ minute: Window, hour: Window, day: Window }} windows
 * @param {{ minuteTarget: number, hourTarget: number, dayTarget: number, dayReserve?: number }} targets
 * @param {number} [alreadyUsedThisProcess]
 */
function computeSafeRequests(windows, targets, alreadyUsedThisProcess = 0) {
  const dayReserve = Number(targets.dayReserve) || Math.max(20, Math.round((windows.day.limit || 600) * (20 / 600)));
  const minuteRem = Math.max(0, Math.min(windows.minute.remaining, targets.minuteTarget) - alreadyUsedThisProcess);
  const hourUsed = Math.max(0, windows.hour.limit - windows.hour.remaining);
  const dayUsed = Math.max(0, windows.day.limit - windows.day.remaining);
  const hourRem = Math.max(0, Math.min(windows.hour.remaining, targets.hourTarget - hourUsed));
  // Prefer remaining-reserve when remaining is the live authority signal.
  const dayFromRemaining = Math.max(0, Number(windows.day.remaining) - dayReserve);
  const dayFromTarget = Math.max(0, Math.min(windows.day.remaining, targets.dayTarget - dayUsed));
  const dayRem = Math.min(dayFromRemaining, dayFromTarget);
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

function looksLikeFreeDefault(windows) {
  return (
    Number(windows?.minute?.limit) === FREE_DEFAULT.minute &&
    Number(windows?.hour?.limit) === FREE_DEFAULT.hour &&
    Number(windows?.day?.limit) === FREE_DEFAULT.day
  );
}

function looksLikeTier2Live(windows) {
  return (
    Number(windows?.minute?.limit) === TIER2_LIVE.minute &&
    Number(windows?.hour?.limit) === TIER2_LIVE.hour &&
    Number(windows?.day?.limit) === TIER2_LIVE.day
  );
}

function membershipClaimsTier2(membership) {
  const level = String(membership?.level || membership?.name || "");
  return /tier\s*2/i.test(level) && membership?.is_active !== false;
}

function wrapLimitRow(row) {
  if (!row || typeof row !== "object") return null;
  const limit = Number(row.limit ?? 0);
  const used = Number(row.usage ?? row.used ?? 0);
  const remaining = Number(
    row.remaining ?? (Number.isFinite(limit) ? limit - used : 0),
  );
  return {
    limit: Number.isFinite(limit) ? limit : 0,
    used: Number.isFinite(used) ? used : 0,
    remaining: Number.isFinite(remaining) ? remaining : 0,
    resetAt: row.reset_at || row.resetAt || null,
  };
}

/**
 * Parse /api-usage/ current_usage rows into minute/hour/day user windows.
 * @param {any} payload
 * @param {{ fillFreeDefaults?: boolean }} [opts]
 */
function parseApiUsagePayload(payload, opts = {}) {
  const fillFreeDefaults = opts.fillFreeDefaults !== false;
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
  const freeWin = {
    minute: { limit: FREE_DEFAULT.minute, used: 0, remaining: FREE_DEFAULT.minute, resetAt: null },
    hour: { limit: FREE_DEFAULT.hour, used: 0, remaining: FREE_DEFAULT.hour, resetAt: null },
    day: { limit: FREE_DEFAULT.day, used: 0, remaining: FREE_DEFAULT.day, resetAt: null },
  };
  return {
    membership: {
      level: membership?.level || null,
      is_active: membership?.is_active ?? null,
    },
    windows: {
      minute: byPeriod.minute || (fillFreeDefaults ? freeWin.minute : null),
      hour: byPeriod.hour || (fillFreeDefaults ? freeWin.hour : null),
      day: byPeriod.day || (fillFreeDefaults ? freeWin.day : null),
    },
    complete: Boolean(byPeriod.minute && byPeriod.hour && byPeriod.day),
  };
}

/**
 * Normalize probe stdout / parsed object into minute/hour/day windows.
 * @param {any} parsed
 */
function windowsFromProbe(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return { windows: null, source: null, membership: null, complete: false };
  }
  const membership = parsed.membership || null;
  if (parsed.limits && (parsed.limits.minute || parsed.limits.hour || parsed.limits.day)) {
    const windows = {
      minute: wrapLimitRow(parsed.limits.minute),
      hour: wrapLimitRow(parsed.limits.hour),
      day: wrapLimitRow(parsed.limits.day),
    };
    const complete = Boolean(windows.minute && windows.hour && windows.day);
    return {
      windows: complete ? windows : null,
      source: "probe.limits",
      membership,
      complete,
    };
  }
  if (parsed.windows?.minute && parsed.windows?.hour && parsed.windows?.day) {
    return {
      windows: {
        minute: wrapLimitRow(parsed.windows.minute),
        hour: wrapLimitRow(parsed.windows.hour),
        day: wrapLimitRow(parsed.windows.day),
      },
      source: "probe.windows",
      membership,
      complete: true,
    };
  }
  if (Array.isArray(parsed.current_usage)) {
    const fromPayload = parseApiUsagePayload(parsed, { fillFreeDefaults: false });
    if (fromPayload.complete) {
      return {
        windows: fromPayload.windows,
        source: "probe.current_usage",
        membership: fromPayload.membership || membership,
        complete: true,
      };
    }
  }
  return { windows: null, source: null, membership, complete: false };
}

function resetAtPassed(resetAt, now) {
  if (!resetAt) return false;
  const t = new Date(resetAt).getTime();
  if (Number.isNaN(t)) return false;
  return now.getTime() >= t;
}

/**
 * True when prior day/hour windows are past their reset and must not block recovery.
 */
function windowsPastReset(windows, now = new Date()) {
  if (!windows) return true;
  if (resetAtPassed(windows.day?.resetAt || windows.day?.reset_at, now)) return true;
  if (resetAtPassed(windows.hour?.resetAt || windows.hour?.reset_at, now)) return true;
  return false;
}

function laneAConfidenceSufficient(confidence) {
  return (
    confidence === QUOTA_CONFIDENCE.AUTHORITATIVE_API ||
    confidence === QUOTA_CONFIDENCE.AUTHORITATIVE_HEADER
  );
}

/**
 * Reconcile a live probe against prior persisted Tier 2 windows.
 * Never silently retain stale safe=0 after day/hour reset when a fresh
 * authoritative probe is available. Never silently downgrade to free-tier.
 *
 * @param {{
 *   parsed: any,
 *   priorWindows?: object|null,
 *   priorMembership?: object|null,
 *   priorObservedAt?: string|null,
 *   now?: Date,
 * }} params
 */
function reconcileQuotaProbe(params = {}) {
  const now = params.now instanceof Date ? params.now : new Date(params.now || Date.now());
  const observedAt = now.toISOString();
  const prior = params.priorWindows || null;
  const priorMembership = params.priorMembership || null;
  const extracted = windowsFromProbe(params.parsed);
  const membership = extracted.membership || params.parsed?.membership || priorMembership || null;
  const priorAgeMs = params.priorObservedAt
    ? Math.max(0, now.getTime() - new Date(params.priorObservedAt).getTime())
    : null;
  const priorPastReset = windowsPastReset(prior, now);
  const priorIsTier2 = prior && (looksLikeTier2Live(prior) || isElevatedAboveFree({
    minute: prior.minute?.limit,
    hour: prior.hour?.limit,
    day: prior.day?.limit,
  }));

  if (extracted.complete && extracted.windows && !looksLikeFreeDefault(extracted.windows)) {
    const targets = computeSafetyTargets(extracted.windows);
    const safe = computeSafeRequests(extracted.windows, targets, 0);
    return {
      ok: true,
      ambiguous: false,
      humanReview: false,
      windows: extracted.windows,
      membership,
      targets,
      safe,
      quotaStateObservedAt: observedAt,
      quotaStateSource: extracted.source || "AUTHORITATIVE_API",
      quotaStateConfidence: QUOTA_CONFIDENCE.AUTHORITATIVE_API,
      quotaStateAgeMs: 0,
      note: null,
      reviewReason: null,
    };
  }

  // Free-default-shaped or incomplete parse while membership claims Tier 2 → do not guess.
  if (membershipClaimsTier2(membership) || membershipClaimsTier2(priorMembership)) {
    if (!extracted.complete || looksLikeFreeDefault(extracted.windows)) {
      // Prior Tier 2 past reset must not indefinitely block recovery.
      if (priorIsTier2 && !priorPastReset && prior) {
        const targets = computeSafetyTargets(prior);
        const safe = computeSafeRequests(prior, targets, 0);
        return {
          ok: true,
          ambiguous: true,
          humanReview: true,
          windows: prior,
          membership: membership || priorMembership,
          targets,
          safe,
          quotaStateObservedAt: params.priorObservedAt || observedAt,
          quotaStateSource: "prior_tier2_kept_pending_review",
          quotaStateConfidence: QUOTA_CONFIDENCE.AMBIGUOUS,
          quotaStateAgeMs: priorAgeMs,
          note: "tier2_membership_but_probe_parsed_free_or_incomplete",
          reviewReason: "COURTLISTENER_QUOTA_STATE_AMBIGUOUS",
        };
      }
      return {
        ok: false,
        ambiguous: true,
        humanReview: true,
        windows: priorPastReset ? null : prior,
        membership: membership || priorMembership,
        targets: prior && !priorPastReset ? computeSafetyTargets(prior) : null,
        safe: prior && !priorPastReset ? computeSafeRequests(prior, computeSafetyTargets(prior), 0) : { safe: 0 },
        quotaStateObservedAt: observedAt,
        quotaStateSource: extracted.source || "unparsed",
        quotaStateConfidence: QUOTA_CONFIDENCE.AMBIGUOUS,
        quotaStateAgeMs: 0,
        note: "ambiguous_tier2_probe",
        reviewReason: "COURTLISTENER_QUOTA_STATE_AMBIGUOUS",
      };
    }
  }

  if (extracted.complete && looksLikeFreeDefault(extracted.windows)) {
    // Genuine free-tier only when membership does not claim Tier 2.
    if (priorIsTier2 && !priorPastReset) {
      const targets = computeSafetyTargets(prior);
      const safe = computeSafeRequests(prior, targets, 0);
      return {
        ok: true,
        ambiguous: false,
        humanReview: false,
        windows: prior,
        membership: priorMembership || membership,
        targets,
        safe,
        quotaStateObservedAt: params.priorObservedAt || observedAt,
        quotaStateSource: "ignored_free_default_kept_prior_tier2",
        quotaStateConfidence: QUOTA_CONFIDENCE.STALE_FALLBACK,
        quotaStateAgeMs: priorAgeMs,
        note: "ignored_free_default_parse_kept_prior_tier2_windows",
        reviewReason: null,
      };
    }
    // Prior Tier 2 expired — accept free only if membership is not Tier 2; else ambiguous.
    if (priorIsTier2 && priorPastReset) {
      return {
        ok: false,
        ambiguous: true,
        humanReview: true,
        windows: null,
        membership,
        targets: null,
        safe: { safe: 0 },
        quotaStateObservedAt: observedAt,
        quotaStateSource: "free_default_after_tier2_reset",
        quotaStateConfidence: QUOTA_CONFIDENCE.AMBIGUOUS,
        quotaStateAgeMs: 0,
        note: "stale_tier2_reset_free_default_rejected",
        reviewReason: "COURTLISTENER_QUOTA_STATE_AMBIGUOUS",
      };
    }
    const targets = computeSafetyTargets(extracted.windows);
    const safe = computeSafeRequests(extracted.windows, targets, 0);
    return {
      ok: true,
      ambiguous: false,
      humanReview: false,
      windows: extracted.windows,
      membership,
      targets,
      safe,
      quotaStateObservedAt: observedAt,
      quotaStateSource: extracted.source || "free_default",
      quotaStateConfidence: QUOTA_CONFIDENCE.AUTHORITATIVE_API,
      quotaStateAgeMs: 0,
      note: null,
      reviewReason: null,
    };
  }

  // Incomplete parse, no Tier 2 membership claim.
  if (prior && !priorPastReset) {
    const targets = computeSafetyTargets(prior);
    const safe = computeSafeRequests(prior, targets, 0);
    return {
      ok: true,
      ambiguous: false,
      humanReview: false,
      windows: prior,
      membership: priorMembership || membership,
      targets,
      safe,
      quotaStateObservedAt: params.priorObservedAt || observedAt,
      quotaStateSource: "stale_prior_windows",
      quotaStateConfidence: QUOTA_CONFIDENCE.STALE_FALLBACK,
      quotaStateAgeMs: priorAgeMs,
      note: "probe_incomplete_kept_prior",
      reviewReason: null,
    };
  }

  return {
    ok: false,
    ambiguous: true,
    humanReview: true,
    windows: null,
    membership,
    targets: null,
    safe: { safe: 0 },
    quotaStateObservedAt: observedAt,
    quotaStateSource: "unparsed",
    quotaStateConfidence: QUOTA_CONFIDENCE.AMBIGUOUS,
    quotaStateAgeMs: 0,
    note: "probe_unparsed",
    reviewReason: "COURTLISTENER_QUOTA_STATE_AMBIGUOUS",
  };
}

module.exports = {
  FREE_DEFAULT,
  TIER2_LIVE,
  QUOTA_CONFIDENCE,
  computeSafetyTargets,
  computeSafeRequests,
  spacingMsForMinuteTarget,
  sustainedSpacingMs,
  isElevatedAboveFree,
  looksLikeFreeDefault,
  looksLikeTier2Live,
  membershipClaimsTier2,
  parseApiUsagePayload,
  windowsFromProbe,
  windowsPastReset,
  extractJsonObject,
  reconcileQuotaProbe,
  laneAConfidenceSufficient,
};
