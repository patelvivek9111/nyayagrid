/**
 * Adaptive CourtListener quota budgeting for Queue #2.
 * Pure functions only — no network, no corpus mutation.
 *
 * Replaces the fixed safeRequests>=25 gate with task-aware
 * usable capacity, micro-batches, finish-target, and reset waits.
 */
"use strict";

const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.join(__dirname, "..");
const SAFETY_CONFIG_PATH = path.join(
  ROOT,
  "packages/research/corpus/config/queue2-worker-safety.json",
);

const QUOTA_MODES = Object.freeze({
  FINISH_TARGET: "FINISH_TARGET",
  FULL_BATCH: "FULL_BATCH",
  MICRO_BATCH: "MICRO_BATCH",
  WAIT_MINUTE: "WAIT_MINUTE",
  WAIT_HOUR: "WAIT_HOUR",
  DAY_BLOCKED: "DAY_BLOCKED",
});

const BINDING_WINDOWS = Object.freeze({
  MINUTE: "MINUTE",
  HOUR: "HOUR",
  DAY: "DAY",
  NONE: "NONE",
});

const DEFAULT_ADAPTIVE_QUOTA = Object.freeze({
  minuteReserve: 2,
  hourReserve: 5,
  dayReserve: 10,
  minimumMicroBatchRequests: 3,
  uncertaintyMultiplier: 1.35,
  ewmaAlpha: 0.3,
  minMeaningfulBatchAuthorities: 2,
  nearCompleteThreshold: 3,
  /** Prefer WAIT over Lane B when minute reset is within this many ms. */
  shortMinuteWaitMs: 90_000,
  wakeAfterResetMs: 3_000,
  /** Nominal request budget for a full Lane A batch (not a hard gate). */
  fullBatchRequests: 20,
  defaultRequestsPerAuthority: 2.3,
  efficiencyRegressionThreshold: 3.0,
  efficiencyRegressionBatches: 3,
  /** Do not re-probe while waiting for a known reset (except at wake). */
  minProbeGapMs: 10 * 60_000,
});

function defaultAdaptiveQuotaConfig() {
  return { ...DEFAULT_ADAPTIVE_QUOTA };
}

function loadAdaptiveQuotaConfig(opts = {}) {
  const base = defaultAdaptiveQuotaConfig();
  let fromFile = {};
  try {
    const raw =
      opts.config ||
      (fs.existsSync(SAFETY_CONFIG_PATH)
        ? JSON.parse(fs.readFileSync(SAFETY_CONFIG_PATH, "utf8"))
        : null);
    if (raw?.adaptiveQuota && typeof raw.adaptiveQuota === "object") {
      fromFile = raw.adaptiveQuota;
    }
  } catch {
    fromFile = {};
  }
  return { ...base, ...fromFile, ...(opts.overrides || {}) };
}

/**
 * Validate adaptive quota config for preflight.
 * @returns {{ ok: boolean, reasons: string[] }}
 */
function validateAdaptiveQuotaConfig(cfg = loadAdaptiveQuotaConfig()) {
  const reasons = [];
  const req = [
    ["minuteReserve", 0, 15],
    ["hourReserve", 0, 50],
    ["dayReserve", 0, 200],
    ["minimumMicroBatchRequests", 1, 40],
    ["uncertaintyMultiplier", 1, 3],
    ["ewmaAlpha", 0.05, 0.9],
    ["minMeaningfulBatchAuthorities", 1, 20],
    ["nearCompleteThreshold", 1, 20],
    ["shortMinuteWaitMs", 1_000, 600_000],
    ["wakeAfterResetMs", 0, 30_000],
    ["fullBatchRequests", 5, 80],
    ["defaultRequestsPerAuthority", 1, 10],
    ["efficiencyRegressionThreshold", 2, 10],
    ["efficiencyRegressionBatches", 2, 10],
    ["minProbeGapMs", 60_000, 3_600_000],
  ];
  for (const [key, lo, hi] of req) {
    const v = Number(cfg[key]);
    if (!Number.isFinite(v) || v < lo || v > hi) {
      reasons.push(`adaptiveQuota.${key}_invalid`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

function windowRemaining(windows, name) {
  const w = windows?.[name];
  if (!w) return null;
  const rem = Number(w.remaining);
  return Number.isFinite(rem) ? Math.max(0, rem) : null;
}

function windowResetAt(windows, name) {
  const w = windows?.[name];
  return w?.resetAt || w?.reset_at || null;
}

/**
 * Usable request budget after operational reserves.
 */
function computeUsableRequests(windows, cfg = loadAdaptiveQuotaConfig()) {
  const minuteRemaining = windowRemaining(windows, "minute");
  const hourRemaining = windowRemaining(windows, "hour");
  const dayRemaining = windowRemaining(windows, "day");
  if (minuteRemaining == null || hourRemaining == null || dayRemaining == null) {
    return {
      ok: false,
      usableRequests: 0,
      usableMinute: 0,
      usableHour: 0,
      usableDay: 0,
      minuteRemaining,
      hourRemaining,
      dayRemaining,
      bindingWindow: BINDING_WINDOWS.NONE,
      reserves: {
        minuteReserve: cfg.minuteReserve,
        hourReserve: cfg.hourReserve,
        dayReserve: cfg.dayReserve,
      },
    };
  }
  const usableMinute = Math.max(0, minuteRemaining - cfg.minuteReserve);
  const usableHour = Math.max(0, hourRemaining - cfg.hourReserve);
  const usableDay = Math.max(0, dayRemaining - cfg.dayReserve);
  const usableRequests = Math.max(0, Math.min(usableMinute, usableHour, usableDay));
  let bindingWindow = BINDING_WINDOWS.NONE;
  if (usableRequests === usableMinute) bindingWindow = BINDING_WINDOWS.MINUTE;
  else if (usableRequests === usableHour) bindingWindow = BINDING_WINDOWS.HOUR;
  else if (usableRequests === usableDay) bindingWindow = BINDING_WINDOWS.DAY;
  return {
    ok: true,
    usableRequests,
    usableMinute,
    usableHour,
    usableDay,
    minuteRemaining,
    hourRemaining,
    dayRemaining,
    bindingWindow,
    reserves: {
      minuteReserve: cfg.minuteReserve,
      hourReserve: cfg.hourReserve,
      dayReserve: cfg.dayReserve,
    },
  };
}

function remainingAuthoritiesNeeded(laneA) {
  const target = Number(laneA?.target) || 0;
  const count = Number(laneA?.count) || 0;
  return Math.max(0, target - count);
}

/**
 * Resolve court-specific efficiency estimate (EWMA preferred).
 */
function resolveRequestsPerAuthority(court, efficiencyStore, cfg = loadAdaptiveQuotaConfig()) {
  const key = String(court || "").toLowerCase();
  const row = efficiencyStore?.[key] || efficiencyStore?.[court];
  if (row && Number.isFinite(Number(row.ewmaRequestsPerAuthority)) && Number(row.sampleCount) > 0) {
    return {
      requestsPerAuthority: Number(row.ewmaRequestsPerAuthority),
      source: "court_ewma",
      sampleCount: Number(row.sampleCount),
    };
  }
  if (
    row &&
    Number.isFinite(Number(row.requestsPerAuthority)) &&
    Number(row.qualifyingAuthorities) > 0
  ) {
    return {
      requestsPerAuthority: Number(row.requestsPerAuthority),
      source: "court_cumulative",
      sampleCount: Number(row.sampleCount || 0),
    };
  }
  return {
    requestsPerAuthority: Number(cfg.defaultRequestsPerAuthority),
    source: "global_default",
    sampleCount: 0,
  };
}

function estimateRequestsNeeded(remainingAuth, requestsPerAuthority, cfg = loadAdaptiveQuotaConfig()) {
  const need = Math.max(0, Number(remainingAuth) || 0);
  if (need <= 0) return 0;
  const rpa = Math.max(0.5, Number(requestsPerAuthority) || cfg.defaultRequestsPerAuthority);
  const mult = Math.max(1, Number(cfg.uncertaintyMultiplier) || 1.35);
  return Math.ceil(need * rpa * mult);
}

/**
 * Update per-court EWMA after a meaningful batch.
 */
function updateCourtEfficiency(store, batch, cfg = loadAdaptiveQuotaConfig()) {
  const next = { ...(store || {}) };
  const court = String(batch.court || "").toLowerCase();
  if (!court) return next;
  const requests = Math.max(0, Number(batch.requests) || 0);
  const authorities = Math.max(0, Number(batch.qualifyingAuthorities) || 0);
  if (requests <= 0 || authorities <= 0) return next;
  const meaningful = authorities >= (cfg.minMeaningfulBatchAuthorities || 2);
  const rpa = requests / authorities;
  const prior = next[court] || {
    court,
    requests: 0,
    qualifyingAuthorities: 0,
    requestsPerAuthority: null,
    ewmaRequestsPerAuthority: null,
    sampleCount: 0,
    consecutiveHighEfficiencyBatches: 0,
    lastUpdatedAt: null,
  };
  const totalReq = prior.requests + requests;
  const totalAuth = prior.qualifyingAuthorities + authorities;
  const alpha = Number(cfg.ewmaAlpha) || 0.3;
  let ewma = prior.ewmaRequestsPerAuthority;
  if (meaningful) {
    ewma = ewma == null ? rpa : alpha * rpa + (1 - alpha) * ewma;
  } else if (ewma == null) {
    ewma = prior.requestsPerAuthority != null ? prior.requestsPerAuthority : rpa;
  }
  let consecutive = prior.consecutiveHighEfficiencyBatches || 0;
  if (meaningful) {
    consecutive = rpa > cfg.efficiencyRegressionThreshold ? consecutive + 1 : 0;
  }
  next[court] = {
    court,
    requests: totalReq,
    qualifyingAuthorities: totalAuth,
    requestsPerAuthority: totalAuth > 0 ? totalReq / totalAuth : null,
    ewmaRequestsPerAuthority: ewma,
    sampleCount: (prior.sampleCount || 0) + (meaningful ? 1 : 0),
    consecutiveHighEfficiencyBatches: consecutive,
    lastBatchRequestsPerAuthority: rpa,
    lastUpdatedAt: batch.at || new Date().toISOString(),
  };
  return next;
}

function efficiencyRegressionTriggered(store, court, cfg = loadAdaptiveQuotaConfig()) {
  const row = store?.[String(court || "").toLowerCase()];
  if (!row) return false;
  return (
    Number(row.consecutiveHighEfficiencyBatches || 0) >= Number(cfg.efficiencyRegressionBatches || 3)
  );
}

function dayUtilization(windows, cfg = loadAdaptiveQuotaConfig()) {
  const day = windows?.day;
  if (!day) return null;
  const limit = Number(day.limit) || 0;
  const remaining = Number(day.remaining);
  const used = Number.isFinite(Number(day.used))
    ? Number(day.used)
    : Number.isFinite(remaining) && limit
      ? Math.max(0, limit - remaining)
      : null;
  if (!limit || used == null) return null;
  const reserved = Number(cfg.dayReserve) || 0;
  const usableDailyBudget = Math.max(0, limit - reserved);
  const productiveUsed = Math.max(0, used);
  const pct = usableDailyBudget > 0 ? Math.min(100, (productiveUsed / usableDailyBudget) * 100) : 0;
  return {
    dayLimit: limit,
    dayRemaining: Number.isFinite(remaining) ? remaining : Math.max(0, limit - used),
    dayUsed: used,
    reservedRequests: reserved,
    usableDailyBudget,
    utilizationPercent: pct,
    productiveQuotaUtilizationPercent: pct,
  };
}

/**
 * Whether a quota probe should run now (avoids wasteful repeats while waiting).
 */
function shouldProbeQuota(state, now = new Date(), cfg = loadAdaptiveQuotaConfig()) {
  const wait = state?.quota?.wait;
  if (wait?.nextUsefulAt) {
    const wakeMs = new Date(wait.nextUsefulAt).getTime();
    if (Number.isFinite(wakeMs) && now.getTime() < wakeMs) {
      return { probe: false, reason: "waiting_known_reset", nextUsefulAt: wait.nextUsefulAt };
    }
    return { probe: true, reason: "post_reset_validation", nextUsefulAt: wait.nextUsefulAt };
  }
  if (!state?.quota?.nextCheckAt) return { probe: true, reason: "no_next_check" };
  const due = now.getTime() >= new Date(state.quota.nextCheckAt).getTime();
  if (!due) return { probe: false, reason: "probe_gap", nextCheckAt: state.quota.nextCheckAt };
  return { probe: true, reason: "scheduled" };
}

function projectWakeAt(resetAt, cfg = loadAdaptiveQuotaConfig(), now = new Date()) {
  if (!resetAt) return null;
  const resetMs = new Date(resetAt).getTime();
  if (!Number.isFinite(resetMs)) return null;
  const wake = Math.max(now.getTime(), resetMs + (Number(cfg.wakeAfterResetMs) || 0));
  return new Date(wake).toISOString();
}

/**
 * Core adaptive planner.
 */
function planAdaptiveQuota(params = {}) {
  const cfg = params.config || loadAdaptiveQuotaConfig();
  const now = params.now instanceof Date ? params.now : new Date(params.now || Date.now());
  const laneA = params.laneA || {};
  const court = laneA.court || null;
  const remainingAuth = remainingAuthoritiesNeeded(laneA);
  const eff = resolveRequestsPerAuthority(court, params.efficiencyStore || {}, cfg);
  const estimatedRequestsNeeded = estimateRequestsNeeded(remainingAuth, eff.requestsPerAuthority, cfg);

  let usable;
  if (params.windows) {
    usable = computeUsableRequests(params.windows, cfg);
  } else if (params.usableRequestsOverride != null) {
    const u = Math.max(0, Number(params.usableRequestsOverride) || 0);
    usable = {
      ok: true,
      usableRequests: u,
      usableMinute: u,
      usableHour: u,
      usableDay: u,
      minuteRemaining: u,
      hourRemaining: u,
      dayRemaining: u,
      bindingWindow: BINDING_WINDOWS.NONE,
      reserves: {
        minuteReserve: cfg.minuteReserve,
        hourReserve: cfg.hourReserve,
        dayReserve: cfg.dayReserve,
      },
    };
  } else {
    usable = {
      ok: false,
      usableRequests: 0,
      usableMinute: 0,
      usableHour: 0,
      usableDay: 0,
      minuteRemaining: null,
      hourRemaining: null,
      dayRemaining: null,
      bindingWindow: BINDING_WINDOWS.NONE,
      reserves: {
        minuteReserve: cfg.minuteReserve,
        hourReserve: cfg.hourReserve,
        dayReserve: cfg.dayReserve,
      },
    };
  }

  const utilization = params.windows ? dayUtilization(params.windows, cfg) : null;
  const nearComplete =
    remainingAuth > 0 && remainingAuth <= Number(cfg.nearCompleteThreshold || 3);

  const base = {
    usableRequests: usable.usableRequests,
    usableMinute: usable.usableMinute,
    usableHour: usable.usableHour,
    usableDay: usable.usableDay,
    bindingWindow: usable.bindingWindow,
    estimatedRequestsNeeded,
    remainingAuthoritiesNeeded: remainingAuth,
    requestsPerAuthorityEstimate: eff.requestsPerAuthority,
    requestsPerAuthoritySource: eff.source,
    nearComplete,
    reserves: usable.reserves,
    utilization,
    microBatchMaxRequests: 0,
    nextUsefulAt: null,
    laneBPreferred: false,
  };

  if (remainingAuth <= 0) {
    return {
      ...base,
      quotaMode: QUOTA_MODES.DAY_BLOCKED,
      reason: "target_already_met",
      lane: "B",
      useful: false,
    };
  }

  if (!usable.ok && params.usableRequestsOverride == null) {
    return {
      ...base,
      quotaMode: QUOTA_MODES.WAIT_MINUTE,
      reason: "quota_windows_unavailable",
      lane: "WAIT",
      useful: false,
    };
  }

  const u = usable.usableRequests;

  if (estimatedRequestsNeeded > 0 && estimatedRequestsNeeded <= u) {
    return {
      ...base,
      quotaMode: QUOTA_MODES.FINISH_TARGET,
      reason: nearComplete ? "finish_near_complete" : "finish_target_fits",
      lane: "A",
      useful: true,
      microBatchMaxRequests: estimatedRequestsNeeded,
    };
  }

  if (u >= Number(cfg.fullBatchRequests)) {
    return {
      ...base,
      quotaMode: QUOTA_MODES.FULL_BATCH,
      reason: "full_batch_capacity",
      lane: "A",
      useful: true,
      microBatchMaxRequests: Math.min(u, Number(cfg.fullBatchRequests)),
    };
  }

  if (u >= Number(cfg.minimumMicroBatchRequests)) {
    return {
      ...base,
      quotaMode: QUOTA_MODES.MICRO_BATCH,
      reason: nearComplete ? "micro_batch_near_complete" : "micro_batch_capacity",
      lane: "A",
      useful: true,
      microBatchMaxRequests: u,
    };
  }

  const minuteRem = usable.minuteRemaining;
  const hourRem = usable.hourRemaining;
  const dayRem = usable.dayRemaining;
  const minuteReset = projectWakeAt(windowResetAt(params.windows, "minute"), cfg, now);
  const hourReset = projectWakeAt(windowResetAt(params.windows, "hour"), cfg, now);
  const dayReset = projectWakeAt(windowResetAt(params.windows, "day"), cfg, now);

  const hourBlocked = hourRem != null && hourRem - cfg.hourReserve < cfg.minimumMicroBatchRequests;
  const dayBlocked = dayRem != null && dayRem - cfg.dayReserve < cfg.minimumMicroBatchRequests;
  const minuteBlocked =
    minuteRem != null && minuteRem - cfg.minuteReserve < cfg.minimumMicroBatchRequests;

  if (dayBlocked) {
    return {
      ...base,
      quotaMode: QUOTA_MODES.DAY_BLOCKED,
      reason: "day_window_blocked",
      lane: "B",
      useful: false,
      laneBPreferred: true,
      nextUsefulAt: dayReset,
      bindingWindow: BINDING_WINDOWS.DAY,
    };
  }

  if (hourBlocked && !dayBlocked) {
    return {
      ...base,
      quotaMode: QUOTA_MODES.WAIT_HOUR,
      reason: "hour_window_blocked",
      lane: params.laneBHasWork ? "B" : "WAIT",
      useful: false,
      laneBPreferred: Boolean(params.laneBHasWork),
      nextUsefulAt: hourReset,
      bindingWindow: BINDING_WINDOWS.HOUR,
    };
  }

  const resetMs = minuteReset ? new Date(minuteReset).getTime() - now.getTime() : null;
  const shortWait =
    resetMs != null && resetMs >= 0 && resetMs <= Number(cfg.shortMinuteWaitMs);

  // Prefer short WAIT when a minute reset is known and imminent; otherwise Lane B.
  const lane =
    shortWait && minuteReset
      ? "WAIT"
      : params.laneBHasWork === false && minuteReset
        ? "WAIT"
        : "B";

  return {
    ...base,
    quotaMode: QUOTA_MODES.WAIT_MINUTE,
    reason: minuteBlocked ? "minute_window_blocked" : "below_micro_batch_minimum",
    lane,
    useful: false,
    laneBPreferred: lane === "B",
    nextUsefulAt: minuteReset,
    bindingWindow: BINDING_WINDOWS.MINUTE,
  };
}

/**
 * Compatibility wrapper for callers that only pass safeRequests.
 * No longer requires a fixed 25-request pool.
 */
function hasUsefulAdaptiveCapacity(params) {
  const plan = planAdaptiveQuota({
    windows: params.windows || null,
    usableRequestsOverride: params.windows ? null : params.safeRequests,
    laneA: params.laneA || {
      count: 0,
      target: 45,
      court: params.court || null,
    },
    efficiencyStore: params.efficiencyStore || {},
    config: params.config,
    now: params.now,
    laneBHasWork: params.laneBHasWork,
  });
  if (
    !params.windows &&
    params.remainingRequestsToFinishCourt != null &&
    Number(params.safeRequests) >= Number(params.remainingRequestsToFinishCourt) &&
    Number(params.remainingRequestsToFinishCourt) > 0
  ) {
    return {
      useful: true,
      reason: "finish_partial_court",
      quotaMode: QUOTA_MODES.FINISH_TARGET,
      plan,
    };
  }
  return {
    useful: Boolean(plan.useful),
    reason: plan.reason,
    quotaMode: plan.quotaMode,
    plan,
  };
}

module.exports = {
  QUOTA_MODES,
  BINDING_WINDOWS,
  DEFAULT_ADAPTIVE_QUOTA,
  defaultAdaptiveQuotaConfig,
  loadAdaptiveQuotaConfig,
  validateAdaptiveQuotaConfig,
  computeUsableRequests,
  remainingAuthoritiesNeeded,
  resolveRequestsPerAuthority,
  estimateRequestsNeeded,
  updateCourtEfficiency,
  efficiencyRegressionTriggered,
  dayUtilization,
  shouldProbeQuota,
  projectWakeAt,
  planAdaptiveQuota,
  hasUsefulAdaptiveCapacity,
};
