/**
 * Queue #2 autonomous operations / progress watchdog.
 * Deterministic only — ZERO AI, ZERO CourtListener HTTP from this module.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages", "research", "corpus", "reports");
const CONFIG_PATH = path.join(ROOT, "packages", "research", "corpus", "config", "queue2-watchdog.json");
const STATUS_PATH = path.join(REPORTS, "queue2-watchdog-status.json");
const EVENTS_PATH = path.join(REPORTS, "queue2-watchdog-events.jsonl");
const DIAG_DIR = path.join(REPORTS, "diagnostics");
const EOD_PATH = path.join(REPORTS, "queue2-watchdog-eod-last.json");
const KNOWN_GOOD_PATH = path.join(REPORTS, "queue2-watchdog-known-good.json");

const OVERALL = Object.freeze({
  HEALTHY_PRODUCTIVE: "HEALTHY_PRODUCTIVE",
  HEALTHY_WAITING: "HEALTHY_WAITING",
  HEALTHY_IDLE_SAFE: "HEALTHY_IDLE_SAFE",
  DEGRADED_SELF_RECOVERING: "DEGRADED_SELF_RECOVERING",
  HUMAN_REVIEW_REQUIRED: "HUMAN_REVIEW_REQUIRED",
  EMERGENCY_STOP: "EMERGENCY_STOP",
});

const SEVERITY = Object.freeze({
  INFO: "INFO",
  WARNING: "WARNING",
  CRITICAL: "CRITICAL",
  EMERGENCY: "EMERGENCY",
});

const RECOVERY = Object.freeze({
  SELF_RECOVERABLE: "SELF_RECOVERABLE",
  WAIT_AND_RETRY: "WAIT_AND_RETRY",
  DEGRADE_TO_LANE_B: "DEGRADE_TO_LANE_B",
  SOURCE_DISABLED_CONTINUE_OTHERS: "SOURCE_DISABLED_CONTINUE_OTHERS",
  HUMAN_REVIEW_REQUIRED: "HUMAN_REVIEW_REQUIRED",
  EMERGENCY_STOP: "EMERGENCY_STOP",
});

const BOTTLENECKS = Object.freeze({
  COURTLISTENER_QUOTA: "COURTLISTENER_QUOTA",
  NETWORK: "NETWORK",
  DATABASE: "DATABASE",
  EMBEDDINGS: "EMBEDDINGS",
  CHUNKING: "CHUNKING",
  CITATION_RESOLUTION: "CITATION_RESOLUTION",
  STORAGE: "STORAGE",
  BACKPRESSURE: "BACKPRESSURE",
  LANE_B_SCHEDULER: "LANE_B_SCHEDULER",
  SOURCE_YIELD: "SOURCE_YIELD",
  UNKNOWN: "UNKNOWN",
  NONE: "NONE",
});

const SECRET_KEY_RE = /(password|secret|token|api[_-]?key|authorization|cookie|private[_-]?key|database_url|dsn)/i;

function defaultConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function loadWatchdogConfig(overrides = null) {
  const base = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) : {};
  return overrides ? deepMerge(base, overrides) : base;
}

function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && typeof a[k] === "object" && a[k] && !Array.isArray(a[k])) {
      out[k] = deepMerge(a[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function minutesBetween(fromIso, toIso) {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, (b - a) / 60_000);
}

function createInitialWatchdogState(now = new Date()) {
  return {
    schemaVersion: 1,
    queue: "#2",
    queue3: "NOT_OPEN",
    featureAgents: "0",
    aiCalls: 0,
    aiTokens: 0,
    overallStatus: OVERALL.HEALTHY_IDLE_SAFE,
    amIAlive: false,
    amIProductive: false,
    amIEfficient: true,
    amIHealthy: true,
    ifNotWhatIsWrong: null,
    mode: "NORMAL",
    lastMeaningfulProgressAt: null,
    lastMeaningfulProgressReason: null,
    minutesSinceMeaningfulProgress: null,
    productiveWorkAvailable: false,
    identicalProductiveCycles: 0,
    lastCycleFingerprint: null,
    currentTask: "NONE",
    falseActiveTask: false,
    missedWake: null,
    quota: {
      underutilization: false,
      opportunityLossRequests: 0,
      unusedUsableCapacity: 0,
      stale: false,
    },
    metrics: {
      authoritiesPerHour: 0,
      casesPerHour: 0,
      requestsPerAuthority: null,
      productiveRequestsPerHour: 0,
      successfulBatchesPerHour: 0,
      productiveMinutes: 0,
      waitingMinutes: 0,
      idleSafeMinutes: 0,
      selfRecoveryMinutes: 0,
    },
    quality: {
      orphans: 0,
      duplicateSourceIds: 0,
      missingEmbeddings: 0,
      missingChunks: 0,
      parserGaps: 0,
      quarantineRate: 0,
    },
    bottleneck: { name: BOTTLENECKS.NONE, since: null, evidence: null },
    failure: null,
    recovery: {
      selfRecoveryCount: 0,
      selfRecoverySuccessCount: 0,
      meanRecoveryTimeMs: null,
      lastClass: null,
    },
    canary: {
      required: false,
      status: "NOT_REQUIRED",
      lastSuccessfulCanaryAt: null,
    },
    knownGood: {
      workerVersion: null,
      commit: null,
      at: null,
    },
    evidence: {
      lastEvidenceUpdatedAt: null,
      lastMilestonePublishedAt: null,
      evidenceAgeMs: null,
    },
    slo: {
      mttdMs: [],
      mttrMs: [],
      meanMttdMs: null,
      meanMttrMs: null,
    },
    lastDiagnosticPath: null,
    session: null,
    updatedAt: now.toISOString(),
  };
}

/**
 * Meaningful progress — heartbeat / logging alone do NOT count.
 */
function detectMeaningfulProgress(prevSnapshot, nextSnapshot) {
  const reasons = [];
  if (!prevSnapshot) {
    return { progressed: false, reasons: ["no_prior_snapshot"] };
  }
  const p = prevSnapshot;
  const n = nextSnapshot || {};
  const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);

  if (num(n.authorities) != null && num(p.authorities) != null && n.authorities > p.authorities) {
    reasons.push("authority_count_increased");
  }
  if (num(n.cases) != null && num(p.cases) != null && n.cases > p.cases) {
    reasons.push("case_count_increased");
  }
  if (n.checkpoint && p.checkpoint && n.checkpoint !== p.checkpoint) {
    reasons.push("checkpoint_advanced");
  }
  if (n.jurisdictionCompleted && n.jurisdictionCompleted !== p.jurisdictionCompleted) {
    reasons.push("jurisdiction_completed");
  }
  if (n.laneBTaskCompleted && n.laneBTaskCompleted !== p.laneBTaskCompleted) {
    reasons.push("lane_b_task_completed");
  }
  if (num(n.citationEdgesResolved) != null && num(p.citationEdgesResolved) != null && n.citationEdgesResolved > p.citationEdgesResolved) {
    reasons.push("citation_edges_resolved");
  }
  if (n.manifestUpdatedDueToCorpusChange) reasons.push("manifest_updated");
  if (n.integrityTaskCompleted) reasons.push("integrity_task_completed");
  if (n.retrievalTaskCompleted) reasons.push("retrieval_task_completed");
  if (n.laneTransitionValid) reasons.push("valid_lane_transition");
  if (n.enteredValidQuotaWait) reasons.push("valid_quota_wait");
  if (n.enteredValidNetworkWait) reasons.push("valid_network_wait");
  if (num(n.backpressureBacklog) != null && num(p.backpressureBacklog) != null && n.backpressureBacklog < p.backpressureBacklog) {
    reasons.push("backpressure_reduced");
  }
  // Explicitly ignore heartbeat-only / log-only deltas
  if (n.heartbeatOnly) {
    return { progressed: false, reasons: ["heartbeat_not_progress"] };
  }
  if (n.loggingOnly) {
    return { progressed: false, reasons: ["logging_not_progress"] };
  }
  return { progressed: reasons.length > 0, reasons };
}

function isLegitimateWait(snapshot, cfg) {
  const mode = String(snapshot?.quotaMode || snapshot?.runtimeState || snapshot?.currentLane || "");
  const allowed = cfg.legitimateWaitModes || [];
  const hardDefaults = [
    "WAIT_MINUTE",
    "WAIT_HOUR",
    "DAY_BLOCKED",
    "WAITING_FOR_NETWORK",
    "BACKPRESSURE_PAUSE",
    "LANE_B_IDLE_SAFE",
    "WAIT",
    "WAITING_QUOTA_RESET",
    "IDLE_SAFE",
  ];
  const okMode = allowed.includes(mode) || hardDefaults.includes(mode) || allowed.includes(String(snapshot?.currentLane));
  if (!okMode) return false;
  const hasReason = Boolean(snapshot?.waitReason || snapshot?.quotaMode || snapshot?.waitingForNetwork || snapshot?.idleSafe);
  const hasNext = Boolean(snapshot?.nextUsefulAt || snapshot?.bindingResetAt || snapshot?.nextEligibleAt);
  if (mode === "LANE_B_IDLE_SAFE" || mode === "IDLE_SAFE") {
    return Boolean(snapshot?.idleSafeReason || snapshot?.laneBIdleSafe || snapshot?.idleSafe);
  }
  if (mode === "BACKPRESSURE_PAUSE") return Boolean(snapshot?.backpressure);
  if (mode === "DAY_BLOCKED" || mode === "WAITING_FOR_NETWORK") return hasReason || true;
  return hasReason && (hasNext || mode === "DAY_BLOCKED" || mode === "WAITING_FOR_NETWORK");
}

function cycleFingerprint(snapshot) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        lane: snapshot?.currentLane || null,
        task: snapshot?.currentTask || null,
        checkpoint: snapshot?.checkpoint || null,
        authorities: snapshot?.authorities ?? null,
        cases: snapshot?.cases ?? null,
        laneBCompleted: snapshot?.laneBTasksCompleted || null,
        jobStatus: snapshot?.jobStatus || null,
      }),
    )
    .digest("hex")
    .slice(0, 16);
}

function classifyFailure(reason, opts = {}) {
  const map = {
    WAIT_MINUTE: { class: RECOVERY.SELF_RECOVERABLE, bottleneck: BOTTLENECKS.COURTLISTENER_QUOTA },
    WAIT_HOUR: { class: RECOVERY.DEGRADE_TO_LANE_B, bottleneck: BOTTLENECKS.COURTLISTENER_QUOTA },
    DAY_BLOCKED: { class: RECOVERY.DEGRADE_TO_LANE_B, bottleneck: BOTTLENECKS.COURTLISTENER_QUOTA },
    WAITING_FOR_NETWORK: { class: RECOVERY.WAIT_AND_RETRY, bottleneck: BOTTLENECKS.NETWORK },
    TRANSIENT_TIMEOUT: { class: RECOVERY.WAIT_AND_RETRY, bottleneck: BOTTLENECKS.NETWORK },
    TRANSIENT_DB_RETRY: { class: RECOVERY.SELF_RECOVERABLE, bottleneck: BOTTLENECKS.DATABASE },
    SOURCE_OUTAGE: { class: RECOVERY.SOURCE_DISABLED_CONTINUE_OTHERS, bottleneck: BOTTLENECKS.SOURCE_YIELD },
    COURTLISTENER_QUOTA_STATE_AMBIGUOUS: {
      class: RECOVERY.HUMAN_REVIEW_REQUIRED,
      bottleneck: BOTTLENECKS.COURTLISTENER_QUOTA,
    },
    NO_PRODUCTIVE_PROGRESS: { class: RECOVERY.HUMAN_REVIEW_REQUIRED, bottleneck: BOTTLENECKS.UNKNOWN },
    SCHEDULER_STUCK: { class: RECOVERY.HUMAN_REVIEW_REQUIRED, bottleneck: BOTTLENECKS.LANE_B_SCHEDULER },
    MISSED_SCHEDULED_WAKE: { class: RECOVERY.HUMAN_REVIEW_REQUIRED, bottleneck: BOTTLENECKS.COURTLISTENER_QUOTA },
    QUOTA_STATE_STALE: { class: RECOVERY.HUMAN_REVIEW_REQUIRED, bottleneck: BOTTLENECKS.COURTLISTENER_QUOTA },
    QUOTA_UNDERUTILIZATION: { class: RECOVERY.HUMAN_REVIEW_REQUIRED, bottleneck: BOTTLENECKS.COURTLISTENER_QUOTA },
    SOURCE_YIELD_ANOMALY: { class: RECOVERY.HUMAN_REVIEW_REQUIRED, bottleneck: BOTTLENECKS.SOURCE_YIELD },
    ORPHANS_PRESENT: { class: RECOVERY.EMERGENCY_STOP, bottleneck: BOTTLENECKS.DATABASE },
    DUPLICATE_SOURCE_IDS: { class: RECOVERY.EMERGENCY_STOP, bottleneck: BOTTLENECKS.DATABASE },
    CHECKPOINT_CORRUPTION: { class: RECOVERY.EMERGENCY_STOP, bottleneck: BOTTLENECKS.UNKNOWN },
    WORKER_VERSION_REGRESSION: { class: RECOVERY.HUMAN_REVIEW_REQUIRED, bottleneck: BOTTLENECKS.UNKNOWN },
    OBSERVABILITY_FAILURE: { class: RECOVERY.HUMAN_REVIEW_REQUIRED, bottleneck: BOTTLENECKS.UNKNOWN },
    FALSE_ACTIVE_TASK_STATE: { class: RECOVERY.SELF_RECOVERABLE, bottleneck: BOTTLENECKS.LANE_B_SCHEDULER },
    HEARTBEAT_DEADMAN: { class: RECOVERY.HUMAN_REVIEW_REQUIRED, bottleneck: BOTTLENECKS.UNKNOWN },
    CANARY_FAILED: { class: RECOVERY.HUMAN_REVIEW_REQUIRED, bottleneck: BOTTLENECKS.UNKNOWN },
    QUEUE_3_OPEN_FORBIDDEN: { class: RECOVERY.EMERGENCY_STOP, bottleneck: BOTTLENECKS.UNKNOWN },
  };
  const hit = map[reason] || {
    class: opts.defaultClass || RECOVERY.HUMAN_REVIEW_REQUIRED,
    bottleneck: BOTTLENECKS.UNKNOWN,
  };
  return {
    reason,
    recoveryClass: hit.class,
    bottleneck: hit.bottleneck,
    subsystem: opts.subsystem || inferSubsystem(hit.bottleneck),
    severity:
      hit.class === RECOVERY.EMERGENCY_STOP
        ? SEVERITY.EMERGENCY
        : hit.class === RECOVERY.HUMAN_REVIEW_REQUIRED
          ? SEVERITY.CRITICAL
          : SEVERITY.WARNING,
  };
}

function inferSubsystem(bottleneck) {
  if (bottleneck === BOTTLENECKS.COURTLISTENER_QUOTA) return "CL_QUOTA";
  if (bottleneck === BOTTLENECKS.LANE_B_SCHEDULER) return "LANE_B_SCHEDULER";
  if (bottleneck === BOTTLENECKS.SOURCE_YIELD) return "INGEST";
  if (bottleneck === BOTTLENECKS.NETWORK) return "NETWORK";
  if (bottleneck === BOTTLENECKS.DATABASE) return "DATABASE";
  if (bottleneck === BOTTLENECKS.EMBEDDINGS) return "EMBEDDINGS";
  if (bottleneck === BOTTLENECKS.BACKPRESSURE) return "BACKPRESSURE";
  return "OPS";
}

function localizeFailure(params) {
  const cls = classifyFailure(params.reason, { subsystem: params.subsystem });
  return {
    subsystem: cls.subsystem,
    reason: params.reason,
    severity: params.severity || cls.severity,
    recoveryClass: cls.recoveryClass,
    firstDetectedAt: params.firstDetectedAt || params.now || new Date().toISOString(),
    lastGoodAt: params.lastGoodAt || null,
    currentLane: params.currentLane || null,
    currentTask: params.currentTask || null,
    checkpoint: params.checkpoint || null,
    quotaState: params.quotaState || null,
    recentCorpusDelta: params.recentCorpusDelta || null,
    likelyCause: params.likelyCause || params.reason,
    recommendedOperatorAction: params.recommendedOperatorAction || defaultAction(params.reason),
    evidence: params.evidence || null,
  };
}

function defaultAction(reason) {
  const actions = {
    NO_PRODUCTIVE_PROGRESS: "Inspect Lane A/B eligibility, quota usableRequests, and last cycle fingerprint.",
    SCHEDULER_STUCK: "Inspect Lane B registry eligibility and identical-cycle evidence; clear pin if present.",
    MISSED_SCHEDULED_WAKE: "Force one quota reevaluation; verify nextUsefulAt and process liveness.",
    QUOTA_UNDERUTILIZATION: "Confirm adaptive planner mode and VERIFIED work remaining; resume Lane A if safe.",
    COURTLISTENER_QUOTA_STATE_AMBIGUOUS: "Re-run bounded api-usage probe; do not guess Tier 2 counters.",
    ORPHANS_PRESENT: "Stop mutations; repair orphan chunks before any further ingest.",
    DUPLICATE_SOURCE_IDS: "Stop mutations; dedupe/quarantine duplicates before resume.",
    WORKER_VERSION_REGRESSION: "Keep corpus; do not auto-rollback; compare known-good version and review.",
  };
  return actions[reason] || "Review diagnostic bundle and decide manual recovery.";
}

/**
 * Evaluate one watchdog tick. Pure — no network.
 */
function evaluateWatchdogTick(input = {}) {
  const cfg = loadWatchdogConfig(input.configOverrides || null);
  const now = input.now instanceof Date ? input.now : new Date(input.now || Date.now());
  const nowIso = now.toISOString();
  const prev = input.watchdogState || createInitialWatchdogState(now);
  const snap = input.snapshot || {};
  const alerts = [];
  const events = [];

  let state = {
    ...createInitialWatchdogState(now),
    ...prev,
    metrics: { ...createInitialWatchdogState(now).metrics, ...(prev.metrics || {}) },
    quality: { ...createInitialWatchdogState(now).quality, ...(prev.quality || {}) },
    quota: { ...createInitialWatchdogState(now).quota, ...(prev.quota || {}) },
    recovery: { ...createInitialWatchdogState(now).recovery, ...(prev.recovery || {}) },
    canary: { ...createInitialWatchdogState(now).canary, ...(prev.canary || {}) },
    knownGood: { ...createInitialWatchdogState(now).knownGood, ...(prev.knownGood || {}) },
    evidence: { ...createInitialWatchdogState(now).evidence, ...(prev.evidence || {}) },
    slo: { ...createInitialWatchdogState(now).slo, ...(prev.slo || {}) },
    aiCalls: 0,
    aiTokens: 0,
    updatedAt: nowIso,
  };

  // Alive / deadman — current session only
  const alive = Boolean(snap.processAlive ?? snap.workerAlive ?? input.processAlive);
  state.amIAlive = alive;
  const session = snap.watchdogSession || state.session || input.session || null;
  if (session) state.session = session;
  const deadmanAlert = evaluateHeartbeatDeadman({
    snap,
    session: state.session,
    cfg,
    now,
    nowIso,
    alive,
  });
  if (deadmanAlert) alerts.push(deadmanAlert);

  // Progress
  const progress = detectMeaningfulProgress(input.priorSnapshot || prev.lastSnapshot || null, snap);
  if (progress.progressed) {
    state.lastMeaningfulProgressAt = nowIso;
    state.lastMeaningfulProgressReason = progress.reasons.join(",");
    state.identicalProductiveCycles = 0;
    events.push({ type: "MEANINGFUL_PROGRESS", reasons: progress.reasons, at: nowIso });
  }
  state.minutesSinceMeaningfulProgress = state.lastMeaningfulProgressAt
    ? minutesBetween(state.lastMeaningfulProgressAt, nowIso)
    : null;
  state.productiveWorkAvailable = Boolean(snap.productiveWorkAvailable);
  state.lastSnapshot = {
    authorities: snap.authorities,
    cases: snap.cases,
    checkpoint: snap.checkpoint,
    currentLane: snap.currentLane,
    currentTask: snap.currentTask,
    laneBTasksCompleted: snap.laneBTasksCompleted,
    jobStatus: snap.jobStatus,
  };

  const legitimateWait = isLegitimateWait(snap, cfg);
  const mins = state.minutesSinceMeaningfulProgress;
  if (
    state.productiveWorkAvailable &&
    !legitimateWait &&
    mins != null &&
    !progress.progressed
  ) {
    if (mins >= cfg.progress.criticalMinutes) {
      alerts.push(
        localizeFailure({
          reason: "NO_PRODUCTIVE_PROGRESS",
          severity: SEVERITY.CRITICAL,
          now: nowIso,
          lastGoodAt: state.lastMeaningfulProgressAt,
          currentLane: snap.currentLane,
          currentTask: snap.currentTask,
          checkpoint: snap.checkpoint,
          quotaState: snap.quotaState || null,
          evidence: { minutesSinceMeaningfulProgress: mins },
        }),
      );
      events.push({ type: "WATCHDOG_CRITICAL", reason: "NO_PRODUCTIVE_PROGRESS", at: nowIso, minutes: mins });
      recordDetection(state, mins * 60_000, cfg.slo.productiveStallDetectionMinutes * 60_000);
    } else if (mins >= cfg.progress.warningMinutes) {
      events.push({ type: "WATCHDOG_WARNING", reason: "NO_PRODUCTIVE_PROGRESS", at: nowIso, minutes: mins });
      alerts.push(
        localizeFailure({
          reason: "NO_PRODUCTIVE_PROGRESS",
          severity: SEVERITY.WARNING,
          now: nowIso,
          lastGoodAt: state.lastMeaningfulProgressAt,
          currentLane: snap.currentLane,
          currentTask: snap.currentTask,
          checkpoint: snap.checkpoint,
          evidence: { minutesSinceMeaningfulProgress: mins },
        }),
      );
    }
  }

  // Stuck scheduler / identical productive cycles
  const fp = cycleFingerprint(snap);
  if (state.productiveWorkAvailable && !legitimateWait && !progress.progressed) {
    if (fp && fp === state.lastCycleFingerprint) {
      state.identicalProductiveCycles = Number(state.identicalProductiveCycles || 0) + 1;
    } else {
      state.identicalProductiveCycles = 1;
    }
  } else if (progress.progressed) {
    state.identicalProductiveCycles = 0;
  }
  state.lastCycleFingerprint = fp;
  if (state.identicalProductiveCycles >= cfg.progress.stuckIdenticalCycles && state.productiveWorkAvailable && !legitimateWait) {
    alerts.push(
      localizeFailure({
        reason: "SCHEDULER_STUCK",
        severity: SEVERITY.CRITICAL,
        subsystem: "LANE_B_SCHEDULER",
        now: nowIso,
        currentLane: snap.currentLane,
        currentTask: snap.currentTask,
        checkpoint: snap.checkpoint,
        evidence: {
          cycles: state.identicalProductiveCycles,
          fingerprint: fp,
          eligibility: snap.laneBEligibility || null,
        },
      }),
    );
    events.push({ type: "WATCHDOG_CRITICAL", reason: "SCHEDULER_STUCK", at: nowIso, cycles: state.identicalProductiveCycles });
  }

  // Stale active task
  state.currentTask = snap.currentTask || "NONE";
  const taskMaxMin = Number(snap.expectedTaskMaxMinutes || 45);
  if (
    state.currentTask &&
    state.currentTask !== "NONE" &&
    snap.taskStartedAt &&
    !snap.runnerActive &&
    minutesBetween(snap.taskStartedAt, nowIso) > taskMaxMin
  ) {
    state.falseActiveTask = true;
    events.push({ type: "FALSE_ACTIVE_TASK_STATE", task: state.currentTask, at: nowIso });
    alerts.push(
      localizeFailure({
        reason: "FALSE_ACTIVE_TASK_STATE",
        severity: SEVERITY.WARNING,
        now: nowIso,
        currentTask: state.currentTask,
        currentLane: snap.currentLane,
        checkpoint: snap.checkpoint,
      }),
    );
  } else {
    state.falseActiveTask = false;
  }

  // Missed wake / reset
  const wakeAt = snap.nextUsefulAt || snap.bindingResetAt || null;
  if (wakeAt) {
    const overdueMin = minutesBetween(wakeAt, nowIso);
    if (overdueMin != null && overdueMin > 0 && snap.reevaluatedAfterWake !== true) {
      state.missedWake = { wakeAt, overdueMinutes: overdueMin };
      if (overdueMin >= cfg.missedWake.criticalMinutes) {
        alerts.push(
          localizeFailure({
            reason: "MISSED_SCHEDULED_WAKE",
            severity: SEVERITY.CRITICAL,
            now: nowIso,
            evidence: { wakeAt, overdueMin, recoveryAttempted: Boolean(snap.wakeRecoveryAttempted) },
            recommendedOperatorAction: snap.wakeRecoveryAttempted
              ? "Recovery wake failed — inspect process/quota loop."
              : "Attempt one deterministic recovery wake.",
          }),
        );
        events.push({ type: "WATCHDOG_CRITICAL", reason: "MISSED_SCHEDULED_WAKE", at: nowIso, overdueMin });
      } else if (overdueMin >= cfg.missedWake.warningMinutes) {
        events.push({ type: "WATCHDOG_WARNING", reason: "MISSED_SCHEDULED_WAKE", at: nowIso, overdueMin });
      }
    } else {
      state.missedWake = null;
    }
  }

  // Quota stale after reset
  if (snap.quotaResetAt && new Date(snap.quotaResetAt).getTime() <= now.getTime()) {
    if (snap.freshProbeAfterReset === false || snap.quotaSuspiciousUnchanged) {
      state.quota.stale = true;
      const reason = snap.quotaAmbiguous
        ? "COURTLISTENER_QUOTA_STATE_AMBIGUOUS"
        : "QUOTA_STATE_STALE";
      alerts.push(
        localizeFailure({
          reason,
          severity: SEVERITY.CRITICAL,
          now: nowIso,
          quotaState: snap.quotaState || null,
          evidence: { quotaResetAt: snap.quotaResetAt },
        }),
      );
    } else {
      state.quota.stale = false;
    }
  }

  // Quota underutilization
  const unused = Number(snap.unusedUsableCapacity || 0);
  const verifiedWork = Boolean(snap.verifiedClWorkRemaining);
  const underMinutes = Number(snap.unusedCapacityMinutes || 0);
  state.quota.unusedUsableCapacity = unused;
  state.quota.opportunityLossRequests = Math.max(0, Number(snap.opportunityLossRequests || unused || 0));
  if (
    verifiedWork &&
    unused >= cfg.quotaUnderutilization.unusedUsableCapacityMin &&
    !legitimateWait &&
    !snap.validBlockingReason
  ) {
    if (underMinutes >= cfg.quotaUnderutilization.criticalMinutes) {
      state.quota.underutilization = true;
      alerts.push(
        localizeFailure({
          reason: "QUOTA_UNDERUTILIZATION",
          severity: SEVERITY.CRITICAL,
          now: nowIso,
          evidence: { unused, underMinutes, opportunityLossRequests: state.quota.opportunityLossRequests },
        }),
      );
      events.push({ type: "WATCHDOG_CRITICAL", reason: "QUOTA_UNDERUTILIZATION", at: nowIso, unused });
    } else if (underMinutes >= cfg.quotaUnderutilization.warningMinutes) {
      state.quota.underutilization = true;
      events.push({ type: "WATCHDOG_WARNING", reason: "QUOTA_UNDERUTILIZATION", at: nowIso, unused });
    }
  } else if (!verifiedWork) {
    state.quota.underutilization = false;
  }

  // Yield anomaly
  if (
    snap.requestsPerAuthority != null &&
    snap.ewmaRequestsPerAuthority != null &&
    Number(snap.ewmaRequestsPerAuthority) > 0 &&
    Number(snap.requestsPerAuthority) >
      Number(snap.ewmaRequestsPerAuthority) * cfg.yieldAnomaly.requestsPerAuthorityMultiplier
  ) {
    alerts.push(
      localizeFailure({
        reason: "SOURCE_YIELD_ANOMALY",
        severity: SEVERITY.WARNING,
        now: nowIso,
        evidence: {
          requestsPerAuthority: snap.requestsPerAuthority,
          ewma: snap.ewmaRequestsPerAuthority,
        },
      }),
    );
  }
  if (
    snap.quarantineRate != null &&
    Number(snap.quarantineRate) >= cfg.yieldAnomaly.quarantineRateSpike
  ) {
    alerts.push(
      localizeFailure({
        reason: "SOURCE_YIELD_ANOMALY",
        severity: SEVERITY.WARNING,
        now: nowIso,
        evidence: { quarantineRate: snap.quarantineRate },
      }),
    );
  }

  // Quality hard stops
  state.quality = {
    orphans: Number(snap.orphans || 0),
    duplicateSourceIds: Number(snap.duplicateSourceIds || 0),
    missingEmbeddings: Number(snap.missingEmbeddings || 0),
    missingChunks: Number(snap.missingChunks || 0),
    parserGaps: Number(snap.parserGaps || 0),
    quarantineRate: Number(snap.quarantineRate || 0),
  };
  if (state.quality.orphans > 0) {
    alerts.push(localizeFailure({ reason: "ORPHANS_PRESENT", severity: SEVERITY.EMERGENCY, now: nowIso }));
  }
  if (state.quality.duplicateSourceIds > 0) {
    alerts.push(localizeFailure({ reason: "DUPLICATE_SOURCE_IDS", severity: SEVERITY.EMERGENCY, now: nowIso }));
  }
  if (snap.checkpointCorruption) {
    alerts.push(localizeFailure({ reason: "CHECKPOINT_CORRUPTION", severity: SEVERITY.EMERGENCY, now: nowIso }));
  }

  // Bottleneck
  state.bottleneck = classifyBottleneck(snap, alerts);

  // Metrics passthrough / compute
  state.metrics = {
    ...state.metrics,
    authoritiesPerHour: Number(snap.authoritiesPerHour || state.metrics.authoritiesPerHour || 0),
    casesPerHour: Number(snap.casesPerHour || 0),
    requestsPerAuthority: snap.requestsPerAuthority != null ? Number(snap.requestsPerAuthority) : state.metrics.requestsPerAuthority,
    productiveRequestsPerHour: Number(snap.productiveRequestsPerHour || 0),
    successfulBatchesPerHour: Number(snap.successfulBatchesPerHour || 0),
    productiveMinutes: Number(snap.productiveMinutes || state.metrics.productiveMinutes || 0),
    waitingMinutes: Number(snap.waitingMinutes || state.metrics.waitingMinutes || 0),
    idleSafeMinutes: Number(snap.idleSafeMinutes || state.metrics.idleSafeMinutes || 0),
    selfRecoveryMinutes: Number(snap.selfRecoveryMinutes || state.metrics.selfRecoveryMinutes || 0),
  };

  // Canary / version
  if (snap.workerVersionChanged || snap.controllerFingerprintChanged) {
    state.mode = "CANARY_REQUIRED";
    state.canary.required = true;
    state.canary.status = "REQUIRED";
  }
  if (snap.canaryPassed) {
    state.mode = "NORMAL";
    state.canary.required = false;
    state.canary.status = "PASS";
    state.canary.lastSuccessfulCanaryAt = nowIso;
    state.knownGood = {
      workerVersion: snap.workerVersion || state.knownGood.workerVersion,
      commit: snap.gitCommit || state.knownGood.commit,
      at: nowIso,
    };
  }
  if (snap.canaryFailed) {
    state.mode = "CANARY_REQUIRED";
    state.canary.status = "FAIL";
    alerts.push(
      localizeFailure({
        reason: "CANARY_FAILED",
        severity: SEVERITY.CRITICAL,
        now: nowIso,
        recommendedOperatorAction: "Do not promote to NORMAL; inspect canary diagnostics.",
      }),
    );
  }
  if (snap.versionRegression) {
    alerts.push(
      localizeFailure({
        reason: "WORKER_VERSION_REGRESSION",
        severity: SEVERITY.CRITICAL,
        now: nowIso,
        evidence: {
          running: snap.workerVersion,
          knownGood: state.knownGood,
        },
      }),
    );
  }

  // Evidence freshness
  if (snap.meaningfulWorkHappened && snap.statusUpdateFailed) {
    alerts.push(localizeFailure({ reason: "OBSERVABILITY_FAILURE", severity: SEVERITY.CRITICAL, now: nowIso }));
  }
  state.evidence.lastEvidenceUpdatedAt = snap.lastEvidenceUpdatedAt || state.evidence.lastEvidenceUpdatedAt;
  state.evidence.lastMilestonePublishedAt =
    snap.lastMilestonePublishedAt || state.evidence.lastMilestonePublishedAt;
  state.evidence.evidenceAgeMs = state.evidence.lastEvidenceUpdatedAt
    ? Math.max(0, now.getTime() - new Date(state.evidence.lastEvidenceUpdatedAt).getTime())
    : null;

  // Self-recovery accounting
  if (snap.selfRecoveryStarted) {
    state.recovery.selfRecoveryCount += 1;
    state.recovery.lastClass = snap.selfRecoveryClass || RECOVERY.SELF_RECOVERABLE;
  }
  if (snap.selfRecoverySucceeded) {
    state.recovery.selfRecoverySuccessCount += 1;
    const samples = [...(state.slo.mttrMs || [])];
    if (snap.recoveryDurationMs != null) samples.push(Number(snap.recoveryDurationMs));
    state.slo.mttrMs = samples.slice(-50);
    state.slo.meanMttrMs = mean(state.slo.mttrMs);
    state.recovery.meanRecoveryTimeMs = state.slo.meanMttrMs;
  }

  // Queue #3 never opens
  if (snap.queue3 && snap.queue3 !== "NOT_OPEN") {
    alerts.push(
      localizeFailure({
        reason: "QUEUE_3_OPEN_FORBIDDEN",
        severity: SEVERITY.EMERGENCY,
        now: nowIso,
      }),
    );
  }

  // Operator / runtime already raised human review — never report HEALTHY_IDLE.
  if (snap.humanReviewRequired || snap.currentLane === "HUMAN_REVIEW_REQUIRED") {
    const reason =
      (Array.isArray(snap.humanReviewReasons) && snap.humanReviewReasons[0]) ||
      snap.humanReviewReason ||
      "HUMAN_REVIEW_REQUIRED";
    alerts.push(
      localizeFailure({
        reason,
        severity: SEVERITY.CRITICAL,
        now: nowIso,
        currentLane: "HUMAN_REVIEW_REQUIRED",
        evidence: {
          humanReviewRequired: true,
          reasons: snap.humanReviewReasons || [reason],
        },
      }),
    );
  }

  // Overall status
  const emergency = alerts.find((a) => a.severity === SEVERITY.EMERGENCY || a.recoveryClass === RECOVERY.EMERGENCY_STOP);
  const critical = alerts.find((a) => a.severity === SEVERITY.CRITICAL);
  const warning = alerts.find((a) => a.severity === SEVERITY.WARNING);

  if (emergency) {
    state.overallStatus = OVERALL.EMERGENCY_STOP;
    state.amIHealthy = false;
    state.amIProductive = false;
    state.ifNotWhatIsWrong = emergency;
  } else if (
    snap.humanReviewRequired ||
    snap.currentLane === "HUMAN_REVIEW_REQUIRED" ||
    (critical && critical.recoveryClass === RECOVERY.HUMAN_REVIEW_REQUIRED)
  ) {
    state.overallStatus = OVERALL.HUMAN_REVIEW_REQUIRED;
    state.amIHealthy = false;
    state.amIProductive = false;
    state.ifNotWhatIsWrong =
      critical && critical.recoveryClass === RECOVERY.HUMAN_REVIEW_REQUIRED
        ? critical
        : localizeFailure({
            reason:
              (Array.isArray(snap.humanReviewReasons) && snap.humanReviewReasons[0]) ||
              snap.humanReviewReason ||
              "HUMAN_REVIEW_REQUIRED",
            severity: SEVERITY.CRITICAL,
            now: nowIso,
          });
  } else if (warning && (warning.recoveryClass === RECOVERY.SELF_RECOVERABLE || warning.recoveryClass === RECOVERY.WAIT_AND_RETRY)) {
    state.overallStatus = OVERALL.DEGRADED_SELF_RECOVERING;
    state.amIHealthy = true;
    state.amIProductive = false;
    state.ifNotWhatIsWrong = warning;
  } else if (legitimateWait) {
    state.overallStatus =
      snap.currentLane === "LANE_B_IDLE_SAFE" || snap.idleSafe
        ? OVERALL.HEALTHY_IDLE_SAFE
        : OVERALL.HEALTHY_WAITING;
    state.amIHealthy = true;
    state.amIProductive = false;
    state.ifNotWhatIsWrong = null;
  } else if (progress.progressed || snap.activelyProducing) {
    state.overallStatus = OVERALL.HEALTHY_PRODUCTIVE;
    state.amIHealthy = true;
    state.amIProductive = true;
    state.ifNotWhatIsWrong = null;
  } else {
    state.overallStatus = OVERALL.HEALTHY_IDLE_SAFE;
    state.amIHealthy = true;
    state.amIProductive = false;
    state.ifNotWhatIsWrong = warning || null;
  }

  state.amIEfficient =
    state.metrics.requestsPerAuthority == null ||
    Number(state.metrics.requestsPerAuthority) <= cfg.efficiencyHardStop.requestsPerAuthority;

  state.failure = state.ifNotWhatIsWrong;
  state.alerts = alerts;
  state.events = events;
  state.answers = {
    AM_I_ALIVE: state.amIAlive,
    AM_I_PRODUCTIVE: state.amIProductive,
    AM_I_EFFICIENT: state.amIEfficient,
    AM_I_HEALTHY: state.amIHealthy,
    IF_NOT_WHAT_IS_WRONG: state.ifNotWhatIsWrong,
  };

  return { state, alerts, events, cfg, now: nowIso };
}

function classifyBottleneck(snap, alerts) {
  if (snap.waitingForNetwork) return { name: BOTTLENECKS.NETWORK, since: snap.bottleneckSince || null, evidence: "network" };
  if (snap.backpressure) return { name: BOTTLENECKS.BACKPRESSURE, since: snap.bottleneckSince || null, evidence: "backpressure" };
  if (snap.quotaMode === "WAIT_MINUTE" || snap.quotaMode === "WAIT_HOUR" || snap.quotaMode === "DAY_BLOCKED") {
    return { name: BOTTLENECKS.COURTLISTENER_QUOTA, since: snap.bottleneckSince || null, evidence: snap.quotaMode };
  }
  if (alerts.some((a) => a.reason === "SCHEDULER_STUCK")) {
    return { name: BOTTLENECKS.LANE_B_SCHEDULER, since: snap.bottleneckSince || null, evidence: "stuck" };
  }
  if (alerts.some((a) => a.reason === "SOURCE_YIELD_ANOMALY")) {
    return { name: BOTTLENECKS.SOURCE_YIELD, since: snap.bottleneckSince || null, evidence: "yield" };
  }
  if (snap.embeddingBacklog) return { name: BOTTLENECKS.EMBEDDINGS, since: snap.bottleneckSince || null, evidence: "embeddings" };
  if (snap.citationBacklog) return { name: BOTTLENECKS.CITATION_RESOLUTION, since: snap.bottleneckSince || null, evidence: "citations" };
  if (snap.dbSlow) return { name: BOTTLENECKS.DATABASE, since: snap.bottleneckSince || null, evidence: "db" };
  return { name: BOTTLENECKS.NONE, since: null, evidence: null };
}

function recordDetection(state, actualMs, sloMs) {
  const samples = [...(state.slo.mttdMs || [])];
  samples.push(actualMs);
  state.slo.mttdMs = samples.slice(-50);
  state.slo.meanMttdMs = mean(state.slo.mttdMs);
  state.slo.lastDetectionVsSloMs = actualMs - sloMs;
}

function mean(arr) {
  if (!arr || !arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Initialize watchdog liveness for the CURRENT worker session.
 * Prior persisted heartbeats are historical only.
 */
function initWatchdogSession(params = {}) {
  const now = params.now instanceof Date ? params.now : new Date(params.now || Date.now());
  const nowIso = now.toISOString();
  return {
    workerId: params.workerId || null,
    pid: params.pid != null ? Number(params.pid) : process.pid,
    processStartNonce: params.processStartNonce || null,
    startedAt: nowIso,
    lastHeartbeatAt: nowIso,
    lastWatchdogEvaluationAt: nowIso,
  };
}

/**
 * HEARTBEAT_DEADMAN only for the current workerId/processStartNonce session.
 * Startup grace blocks false positives before the first interval elapses.
 */
function evaluateHeartbeatDeadman(params = {}) {
  const { snap = {}, session = null, cfg, now, nowIso, alive } = params;
  if (snap.machineAwake === false) return null;
  if (!session || !session.workerId) return null;

  // Heartbeat identity must match current session (ignore older worker heartbeats).
  // Heartbeats without workerId/nonce are historical only — never deadman on them.
  if (snap.heartbeatWorkerId && snap.heartbeatWorkerId !== session.workerId) return null;
  if (snap.workerId && snap.workerId !== session.workerId) return null;
  if (
    snap.processStartNonce &&
    session.processStartNonce &&
    snap.processStartNonce !== session.processStartNonce
  ) {
    return null;
  }

  const graceMin = Number(cfg?.deadman?.startupGraceMinutes ?? 20);
  const sessionAgeMin = session.startedAt ? minutesBetween(session.startedAt, nowIso) : 0;
  if (sessionAgeMin != null && sessionAgeMin < graceMin) {
    // During grace, active PID + matching lock/session establishes liveness.
    if (alive !== false && (snap.pidAlive !== false || snap.lockMatchesSession !== false)) {
      return null;
    }
  }

  // Prefer current-session heartbeat only when identity fields match.
  const hbBelongsToSession =
    snap.heartbeatWorkerId === session.workerId &&
    (!session.processStartNonce ||
      !snap.processStartNonce ||
      snap.processStartNonce === session.processStartNonce);
  const hbAt = hbBelongsToSession
    ? snap.lastHeartbeatAt || session.lastHeartbeatAt
    : session.lastHeartbeatAt;
  if (!hbAt) return null;
  if (new Date(hbAt).getTime() > now.getTime()) return null;

  const hbAge = minutesBetween(hbAt, nowIso);
  const threshold = Number(cfg?.deadman?.heartbeatStaleMinutes ?? 20);

  // PID alive + matching lock/session is healthy even near threshold edges during active work.
  if (alive !== false && snap.pidAlive && snap.lockMatchesSession && hbAge != null && hbAge < threshold) {
    return null;
  }

  if (alive === false || (hbAge != null && hbAge >= threshold)) {
    // True failure: stale current-session heartbeat (or process not alive) after grace.
    if (sessionAgeMin != null && sessionAgeMin < graceMin && alive !== false && snap.pidAlive) {
      return null;
    }
    return localizeFailure({
      reason: "HEARTBEAT_DEADMAN",
      severity: SEVERITY.CRITICAL,
      now: nowIso,
      lastGoodAt: hbAt,
      currentLane: snap.currentLane,
      currentTask: snap.currentTask,
      checkpoint: snap.checkpoint,
      likelyCause: "Current-session heartbeat stale or process not alive while machine awake",
      recommendedOperatorAction: "Inspect process/lock; restart only after preflight.",
      evidence: {
        workerId: session.workerId,
        processStartNonce: session.processStartNonce,
        heartbeatAgeMinutes: hbAge,
        startupGraceMinutes: graceMin,
        sessionAgeMinutes: sessionAgeMin,
      },
    });
  }
  return null;
}

/**
 * Clear only HEARTBEAT_DEADMAN from human review (known false-positive safe reset).
 */
function clearFalsePositiveHeartbeatDeadman(humanReview) {
  if (!humanReview || typeof humanReview !== "object") {
    return { required: false, reasons: [], details: [], cleared: false };
  }
  const reasons = Array.isArray(humanReview.reasons) ? humanReview.reasons.filter((r) => r !== "HEARTBEAT_DEADMAN") : [];
  const details = Array.isArray(humanReview.details)
    ? humanReview.details.filter((d) => d?.reason !== "HEARTBEAT_DEADMAN")
    : [];
  const cleared = (humanReview.reasons || []).includes("HEARTBEAT_DEADMAN");
  return {
    required: reasons.length > 0,
    reasons,
    details,
    cleared,
  };
}

function redactSecrets(value, depth = 0) {
  if (depth > 8) return "[truncated]";
  if (value == null) return value;
  if (typeof value === "string") {
    if (/^sk-[a-zA-Z0-9]+/.test(value) || /Bearer\s+\S+/i.test(value)) return "[REDACTED]";
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY_RE.test(k)) out[k] = "[REDACTED]";
      else out[k] = redactSecrets(v, depth + 1);
    }
    return out;
  }
  return value;
}

function buildDiagnosticBundle(params = {}) {
  const bundle = {
    schemaVersion: 1,
    generatedAt: params.now || new Date().toISOString(),
    queue: "#2",
    queue3: "NOT_OPEN",
    featureAgents: "0",
    aiCalls: 0,
    workerVersion: params.workerVersion || null,
    gitCommit: params.gitCommit || null,
    configVersions: params.configVersions || null,
    currentLane: params.currentLane || null,
    currentTask: params.currentTask || null,
    lockState: params.lockState || null,
    lastWatchdogEvents: (params.lastWatchdogEvents || []).slice(-20),
    lastWorkerEvents: (params.lastWorkerEvents || []).slice(-20),
    quotaState: params.quotaState || null,
    recentProbes: params.recentProbes || null,
    circuitBreakers: params.circuitBreakers || null,
    currentCheckpoint: params.currentCheckpoint || null,
    previousCheckpoint: params.previousCheckpoint || null,
    laneBEligibility: params.laneBEligibility || null,
    corpusTotals: params.corpusTotals || null,
    recentDeltas: params.recentDeltas || null,
    health: params.health || null,
    backpressure: params.backpressure || null,
    networkState: params.networkState || null,
    lastSuccessfulOperation: params.lastSuccessfulOperation || null,
    failure: params.failure || null,
    failureMessage: params.failureMessage ? String(params.failureMessage).slice(0, 500) : null,
  };
  return redactSecrets(bundle);
}

function writeDiagnosticBundle(bundle, opts = {}) {
  const dir = opts.dir || DIAG_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const stamp = (bundle.generatedAt || new Date().toISOString()).replace(/[:.]/g, "-");
  const file = path.join(dir, `queue2-diagnostic-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(bundle, null, 2));
  return file;
}

function appendWatchdogEvent(event, filePath = EVENTS_PATH) {
  const type = event?.type;
  // Prefer shared Queue #2 allowlist when observability module is available.
  try {
    const { isRegisteredEventType } = require("./queue2-worker-observability.cjs");
    if (type && !isRegisteredEventType(type)) {
      throw new Error(`unknown_event_type:${type}`);
    }
  } catch (e) {
    if (String(e.message || e).startsWith("unknown_event_type:")) throw e;
    // If circular require fails during load, still write (tests load watchdog alone).
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const line = JSON.stringify({ timestamp: new Date().toISOString(), aiCalls: 0, ...event });
  fs.appendFileSync(filePath, line + "\n");
}

function persistWatchdogStatus(state, filePath = STATUS_PATH) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const slim = { ...state };
  delete slim.events;
  delete slim.alerts;
  delete slim.lastSnapshot;
  fs.writeFileSync(filePath, JSON.stringify(slim, null, 2));
  return filePath;
}

function persistKnownGood(knownGood, filePath = KNOWN_GOOD_PATH) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ ...knownGood, aiCalls: 0 }, null, 2));
}

function buildEndOfDayReport(input = {}) {
  const report = {
    schemaVersion: 1,
    generatedAt: input.now || new Date().toISOString(),
    queue: "#2",
    queue3: "NOT_OPEN",
    featureAgents: "0",
    aiCalls: 0,
    courtListener: {
      dailyLimit: input.dailyLimit ?? 1200,
      totalRequests: input.totalRequests ?? 0,
      productiveRequests: input.productiveRequests ?? 0,
      probeRequests: input.probeRequests ?? 0,
      unusedRemaining: input.unusedRemaining ?? null,
      reservedRequests: input.reservedRequests ?? 10,
      utilizationPercent: input.utilizationPercent ?? null,
      productiveUtilizationPercent: input.productiveUtilizationPercent ?? null,
      opportunityLossRequests: input.opportunityLossRequests ?? 0,
    },
    corpus: {
      authoritiesAdded: input.authoritiesAdded ?? 0,
      casesAdded: input.casesAdded ?? 0,
      jurisdictionsDeepened: input.jurisdictionsDeepened ?? 0,
      completedTargets: input.completedTargets ?? [],
      citationEdgesResolved: input.citationEdgesResolved ?? 0,
    },
    efficiency: {
      requestsPerAuthority: input.requestsPerAuthority ?? null,
      authoritiesPerHour: input.authoritiesPerHour ?? 0,
      productiveMinutes: input.productiveMinutes ?? 0,
      waitMinutes: input.waitMinutes ?? 0,
      idleSafeMinutes: input.idleSafeMinutes ?? 0,
    },
    quality: {
      orphans: input.orphans ?? 0,
      duplicates: input.duplicates ?? 0,
      quarantines: input.quarantines ?? 0,
      missingEmbeddings: input.missingEmbeddings ?? 0,
      parserGaps: input.parserGaps ?? 0,
    },
    operations: {
      watchdogWarnings: input.watchdogWarnings ?? 0,
      humanReviews: input.humanReviews ?? 0,
      selfRecoveries: input.selfRecoveries ?? 0,
      circuitBreakerEvents: input.circuitBreakerEvents ?? 0,
      downtimeMinutes: input.downtimeMinutes ?? 0,
      mttdMs: input.mttdMs ?? null,
      mttrMs: input.mttrMs ?? null,
    },
    next: {
      currentPartial: input.currentPartial ?? null,
      checkpoint: input.checkpoint ?? null,
      topTargets: input.topTargets ?? [],
    },
  };
  return report;
}

function writeEndOfDayReport(report, filePath = EOD_PATH) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
  return filePath;
}

function formatWatchdogTerminalLine(state, snap = {}, now = new Date()) {
  const et = now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true });
  const status = state.overallStatus;
  if (status === OVERALL.HEALTHY_PRODUCTIVE) {
    const court = snap.jurisdiction || snap.court || "?";
    const counts = snap.countLabel || "";
    const quota = snap.quotaLabel || "";
    const rpa = state.metrics.requestsPerAuthority != null ? ` | req/auth ${Number(state.metrics.requestsPerAuthority).toFixed(1)}` : "";
    return `[${et} ET] HEALTHY_PRODUCTIVE | ${snap.currentLane || "LANE_A"} | ${court} ${counts} | quota ${quota}${rpa}`;
  }
  if (status === OVERALL.HEALTHY_WAITING) {
    return `[${et} ET] HEALTHY_WAITING | ${snap.quotaMode || "WAIT"} | resume ${snap.nextUsefulAtLabel || snap.nextUsefulAt || "?"}`;
  }
  if (status === OVERALL.HEALTHY_IDLE_SAFE) {
    return `[${et} ET] HEALTHY_IDLE_SAFE | LANE_B_IDLE_SAFE`;
  }
  if (status === OVERALL.DEGRADED_SELF_RECOVERING) {
    return `[${et} ET] DEGRADED_SELF_RECOVERING | ${state.ifNotWhatIsWrong?.reason || "recovering"}`;
  }
  if (status === OVERALL.HUMAN_REVIEW_REQUIRED) {
    return `[${et} ET] HUMAN_REVIEW_REQUIRED | ${state.ifNotWhatIsWrong?.reason || "review"} | diagnostic=${state.lastDiagnosticPath || "n/a"}`;
  }
  if (status === OVERALL.EMERGENCY_STOP) {
    return `[${et} ET] EMERGENCY_STOP | ${state.ifNotWhatIsWrong?.reason || "emergency"} | diagnostic=${state.lastDiagnosticPath || "n/a"}`;
  }
  return `[${et} ET] ${status}`;
}

function formatMorningStartupSummary(params = {}) {
  return [
    "QUEUE #2",
    `PREFLIGHT ${params.preflight || "UNKNOWN"}`,
    `CANARY ${params.canary || "NOT_REQUIRED"}`,
    `WORKER VERSION ${params.workerVersion || "n/a"}`,
    `CURRENT PARTIAL ${params.partial || "n/a"}`,
    `QUOTA ${params.quota || "n/a"}`,
    `LANE SELECTED ${params.lane || "n/a"}`,
    `NEXT TARGET ${params.nextTarget || "n/a"}`,
    `WATCHDOG HEALTH ${params.watchdog || "n/a"}`,
    "AI CALLS=0",
  ].join("\n");
}

function evaluateCanaryGate(params = {}) {
  if (params.workerVersionChanged || params.controllerFingerprintChanged) {
    return { mode: "CANARY_REQUIRED", promoteToNormal: false, reason: "version_or_fingerprint_changed" };
  }
  if (params.canaryFailed) {
    return { mode: "CANARY_REQUIRED", promoteToNormal: false, reason: "canary_failed" };
  }
  if (params.canaryPassed) {
    return { mode: "NORMAL", promoteToNormal: true, reason: "canary_pass" };
  }
  if (params.versionRegression) {
    return { mode: "HUMAN_REVIEW_REQUIRED", promoteToNormal: false, reason: "WORKER_VERSION_REGRESSION" };
  }
  return { mode: params.currentMode || "NORMAL", promoteToNormal: params.currentMode === "NORMAL", reason: "unchanged" };
}

function runWatchdogCycle(input = {}) {
  const result = evaluateWatchdogTick(input);
  const { state, alerts, events } = result;
  if (input.persist !== false) {
    for (const ev of events) appendWatchdogEvent(ev, input.eventsPath || EVENTS_PATH);
    for (const a of alerts.filter((x) => x.severity === SEVERITY.CRITICAL || x.severity === SEVERITY.EMERGENCY)) {
      appendWatchdogEvent({ type: "ALERT", ...a }, input.eventsPath || EVENTS_PATH);
    }
    const needsBundle =
      state.overallStatus === OVERALL.HUMAN_REVIEW_REQUIRED ||
      state.overallStatus === OVERALL.EMERGENCY_STOP ||
      (state.overallStatus === OVERALL.DEGRADED_SELF_RECOVERING && input.forceDiagnostic);
    if (needsBundle) {
      const bundle = buildDiagnosticBundle({
        now: result.now,
        workerVersion: input.snapshot?.workerVersion,
        gitCommit: input.snapshot?.gitCommit,
        currentLane: input.snapshot?.currentLane,
        currentTask: input.snapshot?.currentTask,
        lockState: input.snapshot?.lockState,
        lastWatchdogEvents: events,
        lastWorkerEvents: input.snapshot?.recentWorkerEvents || [],
        quotaState: input.snapshot?.quotaState,
        currentCheckpoint: input.snapshot?.checkpoint,
        previousCheckpoint: input.snapshot?.previousCheckpoint,
        corpusTotals: {
          authorities: input.snapshot?.authorities,
          cases: input.snapshot?.cases,
        },
        health: input.snapshot?.health,
        failure: state.ifNotWhatIsWrong,
        failureMessage: state.ifNotWhatIsWrong?.reason,
      });
      const diagPath = writeDiagnosticBundle(bundle, { dir: input.diagDir || DIAG_DIR });
      state.lastDiagnosticPath = diagPath;
    }
    persistWatchdogStatus(state, input.statusPath || STATUS_PATH);
    if (state.knownGood?.workerVersion) persistKnownGood(state.knownGood, input.knownGoodPath || KNOWN_GOOD_PATH);
  }
  return result;
}

module.exports = {
  OVERALL,
  SEVERITY,
  RECOVERY,
  BOTTLENECKS,
  CONFIG_PATH,
  STATUS_PATH,
  EVENTS_PATH,
  DIAG_DIR,
  EOD_PATH,
  KNOWN_GOOD_PATH,
  defaultConfig,
  loadWatchdogConfig,
  createInitialWatchdogState,
  detectMeaningfulProgress,
  isLegitimateWait,
  cycleFingerprint,
  classifyFailure,
  localizeFailure,
  evaluateWatchdogTick,
  initWatchdogSession,
  evaluateHeartbeatDeadman,
  clearFalsePositiveHeartbeatDeadman,
  classifyBottleneck,
  redactSecrets,
  buildDiagnosticBundle,
  writeDiagnosticBundle,
  appendWatchdogEvent,
  persistWatchdogStatus,
  persistKnownGood,
  buildEndOfDayReport,
  writeEndOfDayReport,
  formatWatchdogTerminalLine,
  formatMorningStartupSummary,
  evaluateCanaryGate,
  runWatchdogCycle,
  minutesBetween,
};
