/**
 * Queue #2 Lane A dispatch helpers — pure, zero network, zero AI.
 * Separates runner result parsing from control-plane fallthrough bugs.
 */
"use strict";

const crypto = require("node:crypto");

/**
 * True remaining qualifying authorities to finish the current court target.
 * Literally: max(0, target - count). NOT a request estimate.
 */
function remainingCasesToFinish(laneA) {
  const count = Math.max(0, Number(laneA?.count) || 0);
  const target = Math.max(0, Number(laneA?.target) || 0);
  return Math.max(0, target - count);
}

/**
 * Extract the authoritative Lane A runner payload from multi-line stdout.
 * run-staging-cl-batch-job prints upload/start/poll lines; the result is in fileResult.
 */
function parseLaneARunnerOutput(stdout) {
  const text = String(stdout || "");
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const objects = [];
  for (const line of lines) {
    try {
      objects.push(JSON.parse(line));
    } catch {
      /* ignore non-json */
    }
  }
  for (let i = objects.length - 1; i >= 0; i -= 1) {
    const o = objects[i];
    if (o && o.fileResult && typeof o.fileResult === "object") {
      return {
        ok: o.fileResult.ok !== false,
        raw: o,
        result: o.fileResult,
        source: "fileResult",
      };
    }
  }
  for (let i = objects.length - 1; i >= 0; i -= 1) {
    const o = objects[i];
    if (o && (o.status || o.job || o.clCourt || o.reason)) {
      return { ok: o.ok !== false, raw: o, result: o, source: "lastJson" };
    }
  }
  return { ok: false, raw: null, result: null, source: "unparsed", objects };
}

/**
 * Classify Lane A runner outcome for control-plane decisions.
 */
function classifyLaneABatchResult(params = {}) {
  const priorCheckpoint = params.priorCheckpoint || null;
  const priorCount = Number(params.priorCount) || 0;
  const target = Number(params.target) || 0;
  const parsed = params.parsed || parseLaneARunnerOutput(params.stdout || "");
  const result = parsed.result || {};
  const status = result.status || result.job?.status || null;
  const reason = result.reason || null;
  const apiCalls = Number(result.apiCalls ?? result.api_calls ?? 0) || 0;
  const itemsImported = Number(result.items_imported ?? result.itemsImported ?? 0) || 0;
  const nextCheckpoint =
    result.last_successful_external_id ||
    result.cursor ||
    result.job?.last_successful_external_id ||
    result.job?.cursor ||
    null;
  const checkpointAdvanced = Boolean(nextCheckpoint && nextCheckpoint !== priorCheckpoint);
  const countAdvanced = itemsImported > priorCount;
  const alreadyCompleted = reason === "already_completed" || (status === "completed" && apiCalls === 0);
  const noProgress = alreadyCompleted || (apiCalls === 0 && !checkpointAdvanced && !countAdvanced);

  return {
    ok: parsed.ok !== false,
    parsed,
    status,
    reason,
    apiCalls,
    itemsImported,
    nextCheckpoint: nextCheckpoint || priorCheckpoint,
    checkpointAdvanced,
    countAdvanced,
    alreadyCompleted,
    noProgress,
    remainingCases: Math.max(0, target - priorCount),
    productive: checkpointAdvanced || countAdvanced || apiCalls > 0,
    runnerInvoked: true,
  };
}

/**
 * Binding reset must match binding window. Never attach day reset to MINUTE.
 */
function resolveBindingResetAt(windows, bindingWindow) {
  const w = String(bindingWindow || "").toUpperCase();
  const pick = (name) =>
    windows?.[name]?.resetAt || windows?.[name]?.reset_at || windows?.[name]?.reset || null;
  if (w === "MINUTE") return pick("minute");
  if (w === "HOUR") return pick("hour");
  if (w === "DAY") return pick("day");
  return null;
}

/**
 * Canary gate based on production code fingerprint (not static WORKER_VERSION alone).
 */
function evaluateProductionCanaryGate(params = {}) {
  const current = params.currentFingerprint || null;
  const knownGood = params.knownGoodFingerprint || null;
  const force = Boolean(params.forceCanary);
  if (force) {
    return { required: true, reason: "forced", mode: "CANARY_REQUIRED" };
  }
  if (!knownGood) {
    return { required: true, reason: "no_known_good_fingerprint", mode: "CANARY_REQUIRED" };
  }
  if (!current) {
    return { required: true, reason: "missing_current_fingerprint", mode: "CANARY_REQUIRED" };
  }
  if (current !== knownGood) {
    return {
      required: true,
      reason: "code_fingerprint_changed",
      mode: "CANARY_REQUIRED",
      prior: knownGood,
      current,
    };
  }
  return { required: false, reason: "fingerprint_matches_known_good", mode: "NORMAL" };
}

/**
 * After an active Lane A decision, next quota check must not be "now".
 */
function nextQuotaCheckAfterActiveBatch(now = new Date(), opts = {}) {
  const deferMs = Number(opts.deferMs ?? 15 * 60 * 1000);
  if (opts.noProgress) {
    return new Date(now.getTime() + Math.max(deferMs, 30 * 60 * 1000)).toISOString();
  }
  return new Date(now.getTime() + deferMs).toISOString();
}

/**
 * Detect redundant quota probes: same counters, no work, no reset.
 */
function detectRedundantQuotaProbes(history = [], opts = {}) {
  const min = Number(opts.minRepeats ?? 3);
  if (!Array.isArray(history) || history.length < min) {
    return { redundant: false, count: history?.length || 0 };
  }
  const last = history.slice(-min);
  const sig = (p) =>
    `${p?.minuteRemaining ?? "?"}/${p?.hourRemaining ?? "?"}/${p?.dayRemaining ?? "?"}|${p?.quotaMode || ""}|${p?.checkpoint || ""}`;
  const first = sig(last[0]);
  const allSame = last.every((p) => sig(p) === first);
  const noWork = last.every((p) => !p?.workBetween);
  return {
    redundant: allSame && noWork,
    count: last.length,
    signature: first,
    reason: allSame && noWork ? "REDUNDANT_QUOTA_PROBES" : null,
  };
}

/**
 * Lane A selected but no productive runner activity within threshold.
 */
function detectLaneADispatchStall(params = {}) {
  const selectedAt = params.laneASelectedAt ? new Date(params.laneASelectedAt).getTime() : null;
  const now = (params.now instanceof Date ? params.now : new Date(params.now || Date.now())).getTime();
  const warningMs = Number(params.warningMs ?? 2 * 60 * 1000);
  const criticalMs = Number(params.criticalMs ?? 5 * 60 * 1000);
  if (!selectedAt || !Number.isFinite(selectedAt)) return { stalled: false };
  if (params.runnerStarted || params.productive) return { stalled: false };
  const age = now - selectedAt;
  if (age >= criticalMs) {
    return { stalled: true, severity: "CRITICAL", reason: "LANE_A_DISPATCH_STALLED", ageMs: age };
  }
  if (age >= warningMs) {
    return { stalled: true, severity: "WARNING", reason: "LANE_A_DISPATCH_STALLED", ageMs: age };
  }
  return { stalled: false, ageMs: age };
}

/**
 * Sleep policy after a cycle — never 5s reprobe while active Lane A work is pending
 * or after a zero-progress already_completed result.
 */
function computePostCycleSleepMs(params = {}) {
  const now = params.now instanceof Date ? params.now : new Date(params.now || Date.now());
  if (params.humanReviewRequired) return 0;
  if (params.noProgress) return Math.max(30 * 60 * 1000, Number(params.noProgressSleepMs || 0));
  if (params.lane === "A" && params.awaitingBatch) return 0;
  if (params.lane === "WAIT" && params.nextUsefulAt) {
    return Math.min(
      Number(params.heartbeatMs || 15 * 60 * 1000),
      Math.max(2_000, new Date(params.nextUsefulAt).getTime() - now.getTime()),
    );
  }
  if (
    params.lane === "A" &&
    params.quotaMode &&
    ["FINISH_TARGET", "FULL_BATCH", "MICRO_BATCH"].includes(params.quotaMode)
  ) {
    return Number(params.activeLaneSleepMs ?? 0);
  }
  const next = params.nextCheckAt ? new Date(params.nextCheckAt).getTime() : now.getTime() + 60_000;
  return Math.min(Number(params.heartbeatMs || 15 * 60 * 1000), Math.max(5_000, next - now.getTime()));
}

function hashFingerprintFiles(fileContentsByRel) {
  const h = crypto.createHash("sha256");
  for (const rel of Object.keys(fileContentsByRel).sort()) {
    h.update(rel);
    h.update("\0");
    h.update(fileContentsByRel[rel] || "");
    h.update("\0");
  }
  return h.digest("hex");
}

/**
 * Mocked end-to-end startup + Lane A dispatch flow (no network / no corpus mutation).
 */
function runMockedLaneAStartupFlow(params = {}) {
  const events = [];
  const push = (type, extra = {}) => {
    events.push({ type, ...extra });
    return events[events.length - 1];
  };
  const state = {
    laneA: {
      court: "wis",
      jurisdiction: "WI",
      count: 44,
      target: 45,
      checkpoint: "cl-opinion-9886466",
      lastSuccessfulExternalId: "cl-opinion-9886466",
    },
    currentLane: "B",
    idleSafe: true,
    quota: {},
    humanReview: { required: false, reasons: [] },
    ...(params.state || {}),
  };
  push("PREFLIGHT_PASS");
  push("WATCHDOG_SESSION_INIT", { lane: "STARTUP" });
  push("INITIAL_HEARTBEAT", { lane: "STARTUP" });
  const remainingCases = remainingCasesToFinish(state.laneA);
  const canary = evaluateProductionCanaryGate({
    currentFingerprint: params.currentFingerprint || "fp-new",
    knownGoodFingerprint: params.knownGoodFingerprint || "fp-old",
  });
  push(canary.required ? "CANARY_REQUIRED" : "CANARY_SKIPPED", { reason: canary.reason });
  push("QUOTA_CHECK", {
    quotaMode: "FINISH_TARGET",
    usableRequests: 28,
    remainingCases,
    estimatedRequestsNeeded: params.estimatedRequestsNeeded ?? 4,
  });
  state.idleSafe = false;
  state.currentLane = "A";
  push("LANE_A_CL", { court: "wis", target: 45 });
  if (events.some((e) => e.type === "LANE_B_IDLE_SAFE")) {
    throw new Error("LANE_B_IDLE_SAFE emitted before Lane A completed");
  }
  push("LANE_A_RUNNER_START", { court: "wis", checkpoint: state.laneA.checkpoint });
  const mockStdout =
    params.mockStdout ||
    [
      JSON.stringify({ uploaded: true }),
      JSON.stringify({ ok: true, started: true, clCourt: "wis" }),
      JSON.stringify({
        i: 0,
        fileResult: {
          ok: true,
          status: "completed",
          reason: params.mockReason || "batch_complete",
          items_imported: params.mockItemsImported ?? 45,
          apiCalls: params.mockApiCalls ?? 3,
          last_successful_external_id: params.mockCheckpoint || "cl-opinion-9999999",
          cursor: params.mockCheckpoint || "cl-opinion-9999999",
        },
        hasFile: true,
      }),
    ].join("\n");
  const classified = classifyLaneABatchResult({
    stdout: mockStdout,
    priorCheckpoint: state.laneA.checkpoint,
    priorCount: state.laneA.count,
    target: state.laneA.target,
  });
  push("LANE_A_BATCH_COMPLETE", {
    status: classified.status,
    productive: classified.productive,
    noProgress: classified.noProgress,
    apiCalls: classified.apiCalls,
  });
  if (classified.productive && classified.nextCheckpoint) {
    state.laneA.checkpoint = classified.nextCheckpoint;
    state.laneA.lastSuccessfulExternalId = classified.nextCheckpoint;
    if (classified.itemsImported > state.laneA.count) state.laneA.count = classified.itemsImported;
  }
  push("WATCHDOG_PROGRESS", { productive: classified.productive });
  const idleBeforeComplete = events.findIndex((e) => e.type === "LANE_B_IDLE_SAFE");
  const runnerIdx = events.findIndex((e) => e.type === "LANE_A_RUNNER_START");
  return {
    ok: classified.runnerInvoked && idleBeforeComplete < 0,
    events,
    state,
    classified,
    canary,
    remainingCases,
    runnerInvokedOnce: events.filter((e) => e.type === "LANE_A_RUNNER_START").length === 1,
    idleBeforeLaneAComplete: idleBeforeComplete >= 0 && (runnerIdx < 0 || idleBeforeComplete < runnerIdx),
  };
}

module.exports = {
  remainingCasesToFinish,
  parseLaneARunnerOutput,
  classifyLaneABatchResult,
  resolveBindingResetAt,
  evaluateProductionCanaryGate,
  nextQuotaCheckAfterActiveBatch,
  detectRedundantQuotaProbes,
  detectLaneADispatchStall,
  computePostCycleSleepMs,
  hashFingerprintFiles,
  runMockedLaneAStartupFlow,
};
