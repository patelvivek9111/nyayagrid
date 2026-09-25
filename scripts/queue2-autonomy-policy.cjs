/**
 * Queue #2 final autonomy policy — deterministic, zero AI.
 *
 * Covers: Lane B registry selection, idle-safe, network/sleep resume,
 * Lane A depth scoring/manifest, completion candidate (never opens #3),
 * runtimeState freshness, milestone rules, resource safety.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const {
  hasUsefulClCapacity,
  USEFUL_CL_MIN,
  remainingRequestsToFinishCourt,
  setHumanReview,
  HUMAN_REVIEW_REASONS,
  LANE_A_SEQUENCE,
} = require("./queue2-dual-lane-controller.cjs");
const { heartbeatImpliesGitCommit, selectMilestoneGitPaths } = require("./queue2-worker-lock.cjs");

const ROOT = path.join(__dirname, "..");
const CONFIG_DIR = path.join(ROOT, "packages", "research", "corpus", "config");
const REPORTS_DIR = path.join(ROOT, "packages", "research", "corpus", "reports");
const REGISTRY_PATH = path.join(CONFIG_DIR, "queue2-offline-task-registry.json");
const CHECKLIST_PATH = path.join(CONFIG_DIR, "queue2-completion-checklist.json");
const MANIFEST_PATH = path.join(REPORTS_DIR, "queue2-lane-a-depth-manifest.json");

const RUNTIME_STATES = Object.freeze([
  "RUNNING",
  "IDLE_SAFE",
  "WAITING_FOR_NETWORK",
  "SUSPENDED_OR_OFFLINE",
  "STOPPED",
  "HUMAN_REVIEW_REQUIRED",
]);

const FRESHNESS = Object.freeze([
  "FRESH_RUNNING",
  "FRESH_IDLE_SAFE",
  "STALE_MACHINE_ASLEEP_OR_OFF",
  "STALE_PROCESS_STOPPED",
  "HUMAN_REVIEW_REQUIRED",
]);

const MANIFEST_STATUSES = Object.freeze([
  "READY",
  "PARTIAL",
  "COMPLETE_FOR_CURRENT_DEPTH",
  "BLOCKED_EXTERNAL",
  "HUMAN_REVIEW_REQUIRED",
]);

const SLEEP_GAP_MS = 20 * 60 * 1000;
const NETWORK_RETRY_MS = 60 * 1000;
const REPEATED_NETWORK_FAILURE_MS = 6 * 60 * 60 * 1000;

const US_JURISDICTIONS = Object.freeze([
  { j: "AL", court: "ala", name: "Alabama" },
  { j: "AK", court: "alaska", name: "Alaska" },
  { j: "AZ", court: "ariz", name: "Arizona" },
  { j: "AR", court: "ark", name: "Arkansas" },
  { j: "CA", court: "cal", name: "California" },
  { j: "CO", court: "colo", name: "Colorado" },
  { j: "CT", court: "conn", name: "Connecticut" },
  { j: "DE", court: "del", name: "Delaware" },
  { j: "DC", court: "dc", name: "District of Columbia" },
  { j: "FL", court: "fla", name: "Florida" },
  { j: "GA", court: "ga", name: "Georgia" },
  { j: "HI", court: "haw", name: "Hawaii" },
  { j: "ID", court: "idaho", name: "Idaho" },
  { j: "IL", court: "ill", name: "Illinois" },
  { j: "IN", court: "ind", name: "Indiana" },
  { j: "IA", court: "iowa", name: "Iowa" },
  { j: "KS", court: "kan", name: "Kansas" },
  { j: "KY", court: "ky", name: "Kentucky" },
  { j: "LA", court: "la", name: "Louisiana" },
  { j: "ME", court: "me", name: "Maine" },
  { j: "MD", court: "md", name: "Maryland" },
  { j: "MA", court: "mass", name: "Massachusetts" },
  { j: "MI", court: "mich", name: "Michigan" },
  { j: "MN", court: "minn", name: "Minnesota" },
  { j: "MS", court: "miss", name: "Mississippi" },
  { j: "MO", court: "mo", name: "Missouri" },
  { j: "MT", court: "mont", name: "Montana" },
  { j: "NE", court: "neb", name: "Nebraska" },
  { j: "NV", court: "nev", name: "Nevada" },
  { j: "NH", court: "nh", name: "New Hampshire" },
  { j: "NJ", court: "nj", name: "New Jersey" },
  { j: "NM", court: "nm", name: "New Mexico" },
  { j: "NY", court: "ny", name: "New York" },
  { j: "NC", court: "nc", name: "North Carolina" },
  { j: "ND", court: "nd", name: "North Dakota" },
  { j: "OH", court: "ohio", name: "Ohio" },
  { j: "OK", court: "okla", name: "Oklahoma" },
  { j: "OR", court: "or", name: "Oregon" },
  { j: "PA", court: "pa", name: "Pennsylvania" },
  { j: "RI", court: "ri", name: "Rhode Island" },
  { j: "SC", court: "sc", name: "South Carolina" },
  { j: "SD", court: "sd", name: "South Dakota" },
  { j: "TN", court: "tenn", name: "Tennessee" },
  { j: "TX", court: "tex", name: "Texas" },
  { j: "UT", court: "utah", name: "Utah" },
  { j: "VT", court: "vt", name: "Vermont" },
  { j: "VA", court: "va", name: "Virginia" },
  { j: "WA", court: "wash", name: "Washington" },
  { j: "WV", court: "wva", name: "West Virginia" },
  { j: "WI", court: "wis", name: "Wisconsin" },
  { j: "WY", court: "wyo", name: "Wyoming" },
]);

const FEDERAL_TARGETS = Object.freeze([
  { j: "US", court: "scotus", name: "U.S. Supreme Court", layer: "high" },
  { j: "US", court: "ca1", name: "U.S. Court of Appeals 1st Circuit", layer: "appellate" },
  { j: "US", court: "ca2", name: "U.S. Court of Appeals 2nd Circuit", layer: "appellate" },
  { j: "US", court: "ca3", name: "U.S. Court of Appeals 3rd Circuit", layer: "appellate" },
  { j: "US", court: "ca4", name: "U.S. Court of Appeals 4th Circuit", layer: "appellate" },
  { j: "US", court: "ca5", name: "U.S. Court of Appeals 5th Circuit", layer: "appellate" },
  { j: "US", court: "ca6", name: "U.S. Court of Appeals 6th Circuit", layer: "appellate" },
  { j: "US", court: "ca7", name: "U.S. Court of Appeals 7th Circuit", layer: "appellate" },
  { j: "US", court: "ca8", name: "U.S. Court of Appeals 8th Circuit", layer: "appellate" },
  { j: "US", court: "ca9", name: "U.S. Court of Appeals 9th Circuit", layer: "appellate" },
  { j: "US", court: "ca10", name: "U.S. Court of Appeals 10th Circuit", layer: "appellate" },
  { j: "US", court: "ca11", name: "U.S. Court of Appeals 11th Circuit", layer: "appellate" },
  { j: "US", court: "cadc", name: "U.S. Court of Appeals D.C. Circuit", layer: "appellate" },
  { j: "US", court: "cafc", name: "U.S. Court of Appeals Federal Circuit", layer: "appellate" },
]);

function sha256(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, filePath);
  return value;
}

function loadOfflineTaskRegistry(registryPath = REGISTRY_PATH) {
  const reg = readJson(registryPath);
  if (!reg || !Array.isArray(reg.tasks)) {
    throw new Error("queue2_offline_task_registry_missing_or_invalid");
  }
  if (reg.aiPlannerAllowed === true) {
    throw new Error("queue2_registry_forbids_ai_planner");
  }
  return reg;
}

function loadCompletionChecklist(checklistPath = CHECKLIST_PATH) {
  const c = readJson(checklistPath);
  if (!c || !Array.isArray(c.required)) {
    throw new Error("queue2_completion_checklist_missing");
  }
  if (c.queue3AutoOpen === true || c.onComplete?.openQueue3 === true) {
    throw new Error("queue2_checklist_must_not_auto_open_queue3");
  }
  return c;
}

/**
 * Reject free-form task invention — only registry IDs (and known legacy aliases).
 */
function assertKnownLaneBTask(taskId, registry = loadOfflineTaskRegistry()) {
  const id = String(taskId || "");
  for (const t of registry.tasks) {
    if (t.id === id) return t;
    if (Array.isArray(t.legacyIds) && t.legacyIds.includes(id)) return t;
  }
  const err = new Error(`UNKNOWN_LANE_B_TASK:${id}`);
  err.code = "UNKNOWN_LANE_B_TASK";
  throw err;
}

function scoreLaneATarget(entry) {
  const authorityWeakness = Math.max(0, Number(entry.authorityDeficit) || 0);
  const appellateGap = entry.missingAppellateLayer ? 120 : 0;
  const historical = Math.max(0, Number(entry.historicalGapScore) || 0);
  const doctrinal = Math.max(0, Number(entry.doctrinalGapScore) || 0);
  const citationDemand = Math.max(0, Number(entry.citationTargetAbsent) || 0) * 3;
  const efficiencyPenalty = Math.max(0, (Number(entry.requestEfficiency) || 2.3) - 2.0) * 10;
  // Higher is more urgent. Efficiency is tiebreaker (lower efficiency cost preferred).
  return (
    authorityWeakness * 4 +
    appellateGap +
    historical * 2 +
    doctrinal * 2 +
    citationDemand -
    efficiencyPenalty
  );
}

function buildDefaultLaneAManifest(opts = {}) {
  const nowIso = (opts.now || new Date()).toISOString();
  const targets = [];

  for (const row of US_JURISDICTIONS) {
    const seq = LANE_A_SEQUENCE.find((s) => s.court === row.court);
    const isArk = row.court === "ark";
    const count = isArk ? Number(opts.arkCount ?? 33) : Number(opts.counts?.[row.court] ?? 0);
    const target = seq ? seq.target : 45;
    const checkpoint =
      isArk && (opts.arkCheckpoint || "cl-opinion-9885161")
        ? opts.arkCheckpoint || "cl-opinion-9885161"
        : opts.checkpoints?.[row.court] || null;
    const authorityDeficit = Math.max(0, 101 - (opts.authorities?.[row.j] ?? (count > 0 ? 60 : 20)));
    const status =
      count >= target
        ? "COMPLETE_FOR_CURRENT_DEPTH"
        : count > 0 && checkpoint
          ? "PARTIAL"
          : authorityDeficit >= 40
            ? "READY"
            : "READY";

    targets.push({
      jurisdiction: row.j,
      name: row.name,
      preferredCourts: [row.court],
      currentAuthorities: opts.authorities?.[row.j] ?? null,
      currentCases: count,
      targetCases: target,
      targetDelta: Math.max(0, target - count),
      missingCourtLayers: count < 20 ? ["high"] : [],
      historicalGaps: count < 10 ? ["pre-2000"] : [],
      doctrinalGaps: [],
      citationDemand: opts.citationDemand?.[row.j] ?? 0,
      citationTargetAbsent: opts.citationDemand?.[row.j] ?? 0,
      requestEfficiency: 2.3,
      authorityDeficit,
      historicalGapScore: count < 10 ? 40 : 10,
      doctrinalGapScore: 5,
      checkpoint,
      mappingStatus: isArk ? "VERIFIED" : seq ? "VERIFIED" : "CANDIDATE",
      status,
      score: 0,
    });
  }

  for (const fed of FEDERAL_TARGETS) {
    targets.push({
      jurisdiction: fed.j,
      name: fed.name,
      preferredCourts: [fed.court],
      currentAuthorities: opts.authorities?.[fed.court] ?? null,
      currentCases: opts.counts?.[fed.court] ?? 0,
      targetCases: fed.layer === "high" ? 80 : 40,
      targetDelta: fed.layer === "high" ? 20 : 15,
      missingCourtLayers: fed.layer === "appellate" ? ["intermediate_federal"] : [],
      historicalGaps: [],
      doctrinalGaps: [],
      citationDemand: 0,
      citationTargetAbsent: 0,
      requestEfficiency: 2.3,
      authorityDeficit: 30,
      historicalGapScore: 5,
      doctrinalGapScore: 5,
      checkpoint: null,
      mappingStatus: "VERIFIED",
      status: "READY",
      score: 0,
      federal: true,
      layer: fed.layer,
    });
  }

  for (const t of targets) t.score = scoreLaneATarget(t);
  targets.sort((a, b) => b.score - a.score || a.jurisdiction.localeCompare(b.jurisdiction));

  return {
    schemaVersion: 1,
    queue: "#2",
    queue3: "NOT_OPEN",
    featureAgents: "0",
    version: Number(opts.version ?? 1),
    generatedAt: nowIso,
    rankingPolicy: [
      "authority-depth weakness",
      "missing appellate layer",
      "historical gaps",
      "doctrinal gaps",
      "citation TARGET_ABSENT demand",
      "request efficiency tiebreaker",
    ],
    scope: {
      states: 50,
      dc: true,
      federal: true,
      overfeedStrongJurisdictions: false,
    },
    activePartial: {
      court: "ark",
      jurisdiction: "AR",
      count: Number(opts.arkCount ?? 33),
      target: 45,
      checkpoint: opts.arkCheckpoint || "cl-opinion-9885161",
      status: "PARTIAL",
      mappingStatus: "VERIFIED",
    },
    targets,
  };
}

function loadOrCreateLaneAManifest(opts = {}) {
  const existing = readJson(MANIFEST_PATH);
  if (existing && Array.isArray(existing.targets) && existing.targets.length > 0) {
    // Preserve AR checkpoint integrity on load.
    const ark = existing.targets.find((t) => t.preferredCourts?.includes("ark") || t.jurisdiction === "AR");
    if (ark && opts.preserveArkCheckpoint !== false) {
      const cp = opts.arkCheckpoint || existing.activePartial?.checkpoint || "cl-opinion-9885161";
      ark.checkpoint = ark.checkpoint || cp;
      if (existing.activePartial) {
        existing.activePartial.checkpoint = existing.activePartial.checkpoint || cp;
      }
    }
    return existing;
  }
  return buildDefaultLaneAManifest(opts);
}

function persistLaneAManifest(manifest, filePath = MANIFEST_PATH) {
  return writeJson(filePath, manifest);
}

function rerankLaneAManifest(manifest, patchByCourt = {}) {
  const next = JSON.parse(JSON.stringify(manifest));
  for (const t of next.targets) {
    const court = t.preferredCourts?.[0];
    if (court && patchByCourt[court]) Object.assign(t, patchByCourt[court]);
    t.score = scoreLaneATarget(t);
  }
  next.targets.sort((a, b) => b.score - a.score || a.jurisdiction.localeCompare(b.jurisdiction));
  next.version = Number(next.version || 0) + 1;
  next.generatedAt = new Date().toISOString();
  return next;
}

/**
 * Lane A stop/switch decision — routine floors → Lane B; unsafe → human review.
 */
function evaluateLaneAStop(signals = {}) {
  const reasons = [];
  if (signals.minuteFloor) reasons.push("minute_safety_floor");
  if (signals.hourFloor) reasons.push("hour_safety_floor");
  if (signals.dayFloor) reasons.push("day_safety_floor");
  if (signals.noVerifiedUsefulTarget) reasons.push("no_verified_useful_court_target");
  if (signals.sourceAnomaly) reasons.push("source_anomaly");
  if (
    Array.isArray(signals.reqPerAuthBatches) &&
    signals.reqPerAuthBatches.length >= 3 &&
    signals.reqPerAuthBatches.slice(-3).every((r) => Number(r) > 3.0)
  ) {
    reasons.push("request_efficiency_above_3");
  }
  if (signals.checkpointIntegrityFailed) reasons.push("checkpoint_integrity_failed");
  if (signals.unexpected429) reasons.push("unexpected_429");
  if (signals.retrievalRegression) reasons.push("retrieval_regression");
  if (signals.integrityRegression) reasons.push("integrity_regression");

  const unsafe = [
    "source_anomaly",
    "request_efficiency_above_3",
    "checkpoint_integrity_failed",
    "unexpected_429",
    "retrieval_regression",
    "integrity_regression",
  ].some((r) => reasons.includes(r));

  const routineFloor = ["minute_safety_floor", "hour_safety_floor", "day_safety_floor"].some((r) =>
    reasons.includes(r),
  );

  if (unsafe) {
    return {
      action: "HUMAN_REVIEW_REQUIRED",
      switchToLaneB: true,
      reasons,
      humanReview: true,
    };
  }
  if (routineFloor || signals.noVerifiedUsefulTarget) {
    return {
      action: "SWITCH_LANE_B",
      switchToLaneB: true,
      reasons: reasons.length ? reasons : ["quota_floor"],
      humanReview: false,
    };
  }
  return { action: "CONTINUE_LANE_A", switchToLaneB: false, reasons: [], humanReview: false };
}

/**
 * Deterministic Lane B task selection from registry.
 * Evaluates every enabled task; never pins to a completed/ineligible task.
 */
function selectLaneBTask(ctx = {}) {
  const registry = ctx.registry || loadOfflineTaskRegistry();
  const now = ctx.now instanceof Date ? ctx.now : new Date(ctx.now || Date.now());
  const networkOk = ctx.networkOk !== false;
  const corpusVersion = ctx.corpusVersion ?? null;
  const lastByTask = ctx.lastByTask || {};
  const checkpoints = ctx.checkpoints || {};
  const nextEligibleAtMap = ctx.nextEligibleAt || {};
  const mutatingBusy = Boolean(ctx.mutatingTaskActive);
  const executing = ctx.executing !== false;

  const evaluations = [];
  const eligible = [];
  for (const task of registry.tasks) {
    const lastAt = lastByTask[task.id] || lastByTask[task.legacyIds?.[0]] || null;
    const nextEligibleAt =
      nextEligibleAtMap[task.id] ||
      (lastAt && task.minimumIntervalMs
        ? new Date(new Date(lastAt).getTime() + Number(task.minimumIntervalMs)).toISOString()
        : null);
    const requiresCorpusChange = Boolean(task.eligibility?.requiresCorpusChange);
    const corpusVersionAtLastRun = requiresCorpusChange
      ? checkpoints[task.checkpointKey] ?? null
      : null;
    let eligibleFlag = true;
    let reason = "eligible";
    let minimumIntervalRemainingMs = 0;

    if (!task.enabled) {
      eligibleFlag = false;
      reason = "disabled";
    } else if (task.mayUseAI === true) {
      eligibleFlag = false;
      reason = "may_use_ai_blocked";
    } else if (task.mayMutate && mutatingBusy) {
      eligibleFlag = false;
      reason = "mutating_task_active";
    } else if (task.eligibility?.requiresNetwork && !networkOk) {
      eligibleFlag = false;
      reason = "network_required";
    } else if (requiresCorpusChange) {
      if (corpusVersion != null && corpusVersionAtLastRun != null && String(corpusVersionAtLastRun) === String(corpusVersion)) {
        eligibleFlag = false;
        reason = "corpus_version_unchanged";
      }
    }

    if (eligibleFlag && nextEligibleAt) {
      const nextMs = new Date(nextEligibleAt).getTime();
      if (Number.isFinite(nextMs) && nextMs > now.getTime()) {
        eligibleFlag = false;
        reason = "minimum_interval";
        minimumIntervalRemainingMs = nextMs - now.getTime();
      }
    } else if (eligibleFlag && lastAt && task.minimumIntervalMs) {
      const age = now.getTime() - new Date(lastAt).getTime();
      if (Number.isFinite(age) && age < task.minimumIntervalMs) {
        eligibleFlag = false;
        reason = "minimum_interval";
        minimumIntervalRemainingMs = task.minimumIntervalMs - age;
      }
    }

    const row = {
      taskId: task.id,
      eligible: eligibleFlag,
      reason,
      nextEligibleAt: nextEligibleAt || null,
      requiresCorpusChange,
      corpusVersionAtLastRun,
      currentCorpusVersion: corpusVersion,
      minimumIntervalRemainingMs,
      networkRequirement: Boolean(task.eligibility?.requiresNetwork),
      checkpointState: checkpoints[task.checkpointKey] ?? checkpoints[task.id] ?? null,
      priority: task.priority,
      mayMutate: Boolean(task.mayMutate),
      deterministicRunner: task.deterministicRunner || null,
    };
    evaluations.push(row);
    if (eligibleFlag) eligible.push(task);
  }

  eligible.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

  if (eligible.length === 0) {
    return {
      task: null,
      currentLane: "LANE_B_IDLE_SAFE",
      currentTask: "NONE",
      idleSafe: true,
      humanReview: false,
      executing: false,
      reason: "no_eligible_lane_b_task",
      sleepUntil: ctx.nextQuotaCheckAt || new Date(now.getTime() + NETWORK_RETRY_MS).toISOString(),
      evaluations,
      eligibleCount: 0,
      evaluatedCount: evaluations.length,
    };
  }

  const chosen = eligible[0];
  if (!executing) {
    return {
      task: chosen,
      currentLane: "LANE_B_IDLE_SAFE",
      currentTask: "NONE",
      idleSafe: true,
      humanReview: false,
      executing: false,
      reason: "eligible_but_not_executing",
      selectedWouldRun: chosen.id,
      sleepUntil: ctx.nextQuotaCheckAt || null,
      evaluations,
      eligibleCount: eligible.length,
      evaluatedCount: evaluations.length,
    };
  }

  return {
    task: chosen,
    currentLane: "LANE_B_OFFLINE",
    currentTask: chosen.id,
    idleSafe: false,
    humanReview: false,
    executing: true,
    reason: "highest_priority_eligible",
    evaluations,
    eligibleCount: eligible.length,
    evaluatedCount: evaluations.length,
  };
}

/**
 * Detect laptop sleep / long wall-clock gap.
 */
function detectSystemResume(lastHeartbeatAt, now = new Date(), thresholdMs = SLEEP_GAP_MS) {
  if (!lastHeartbeatAt) {
    return { resumed: false, probableSuspend: false, gapMs: null };
  }
  const t = new Date(lastHeartbeatAt).getTime();
  if (Number.isNaN(t)) return { resumed: false, probableSuspend: false, gapMs: null };
  const gapMs = now.getTime() - t;
  if (gapMs >= thresholdMs) {
    return {
      resumed: true,
      probableSuspend: true,
      gapMs,
      event: "SYSTEM_RESUME_DETECTED",
      note: "Large wall-clock gap since last heartbeat; revalidate lock/network/quota. Do not assume probes ran while asleep.",
    };
  }
  return { resumed: false, probableSuspend: false, gapMs };
}

/**
 * Network loss/recovery policy (deterministic connectivity result injected by caller).
 */
function evaluateNetworkState(params = {}) {
  const online = params.online === true;
  const now = params.now instanceof Date ? params.now : new Date(params.now || Date.now());
  const offlineSince = params.offlineSince ? new Date(params.offlineSince) : null;

  if (online) {
    return {
      runtimeState: params.wasWaiting ? "RUNNING" : params.runtimeStateHint || "RUNNING",
      waitingForNetwork: false,
      action: params.wasWaiting ? "NETWORK_RECOVERED" : "NETWORK_OK",
      recheckQuotaBeforeLaneA: Boolean(params.wasWaiting),
      resumeExactCheckpoint: true,
    };
  }

  const offlineMs = offlineSince ? now.getTime() - offlineSince.getTime() : 0;
  const prolonged = offlineMs >= REPEATED_NETWORK_FAILURE_MS;
  return {
    runtimeState: "WAITING_FOR_NETWORK",
    waitingForNetwork: true,
    action: "PAUSE_NETWORK_DEPENDENT",
    continueLocalOnlyLaneB: true,
    heartbeatContinues: true,
    humanReview: prolonged,
    reviewReason: prolonged ? "REPEATED_NETWORK_FAILURE" : null,
    nextConnectivityCheckAt: new Date(now.getTime() + NETWORK_RETRY_MS).toISOString(),
  };
}

/**
 * Derive reviewer-facing freshness + runtimeState.
 */
function deriveRuntimeState(params = {}) {
  const now = params.now instanceof Date ? params.now : new Date(params.now || Date.now());
  if (params.humanReviewRequired) {
    return {
      runtimeState: "HUMAN_REVIEW_REQUIRED",
      freshness: "HUMAN_REVIEW_REQUIRED",
      claimRunningFromGithubAlone: false,
    };
  }
  if (params.waitingForNetwork) {
    return {
      runtimeState: "WAITING_FOR_NETWORK",
      freshness: "FRESH_RUNNING",
    };
  }
  const resume = detectSystemResume(params.lastHeartbeatAt, now, params.sleepGapMs || SLEEP_GAP_MS);
  if (resume.probableSuspend && params.processAlive !== true) {
    return {
      runtimeState: "SUSPENDED_OR_OFFLINE",
      freshness: "STALE_MACHINE_ASLEEP_OR_OFF",
      resume,
    };
  }
  if (params.processAlive === false) {
    return {
      runtimeState: "STOPPED",
      freshness: "STALE_PROCESS_STOPPED",
    };
  }
  if (params.idleSafe) {
    return {
      runtimeState: "IDLE_SAFE",
      freshness: "FRESH_IDLE_SAFE",
    };
  }
  if (params.processAlive === true) {
    return {
      runtimeState: "RUNNING",
      freshness: "FRESH_RUNNING",
    };
  }
  return {
    runtimeState: "STOPPED",
    freshness: "STALE_PROCESS_STOPPED",
  };
}

function neverOpenQueue3(state) {
  const next = JSON.parse(JSON.stringify(state || {}));
  next.queue = "#2";
  next.queue9 = "CLOSED";
  next.queue3 = "NOT_OPEN";
  next.featureAgents = "0";
  return next;
}

/**
 * Evaluate completion checklist. Never auto-opens #3.
 */
function evaluateQueue2Completion(checklistStatus = {}, checklist = loadCompletionChecklist()) {
  const required = checklist.required || [];
  const missing = [];
  for (const item of required) {
    if (!checklistStatus[item.id]) missing.push(item.id);
  }
  // Explicitly reject "authority gate alone"
  if (checklistStatus.authority_gate_gt_100_alone && missing.length > 0) {
    return {
      complete: false,
      candidate: false,
      missing,
      reason: "authority_gate_alone_insufficient",
      openQueue3: false,
    };
  }
  if (missing.length > 0) {
    return { complete: false, candidate: false, missing, openQueue3: false };
  }
  return {
    complete: true,
    candidate: true,
    missing: [],
    openQueue3: false,
    action: {
      currentLane: "HUMAN_REVIEW_REQUIRED",
      reviewReason: HUMAN_REVIEW_REASONS.QUEUE_2_COMPLETION_CANDIDATE || "QUEUE_2_COMPLETION_CANDIDATE",
      stopStrategicIngestion: true,
      pushMilestoneSnapshot: true,
    },
  };
}

function applyCompletionCandidate(state, evaluation) {
  let next = neverOpenQueue3(state);
  if (!evaluation?.candidate) return { state: next, applied: false };
  next = setHumanReview(
    next,
    HUMAN_REVIEW_REASONS.QUEUE_2_COMPLETION_CANDIDATE,
    "production completion checklist satisfied — await human review; do not open #3",
  );
  next.currentLane = "B";
  next.queue3 = "NOT_OPEN";
  return { state: next, applied: true, openQueue3: false };
}

/**
 * Milestone push eligibility — never heartbeat-only.
 */
function shouldPushMilestoneSnapshot(signals = {}) {
  if (signals.heartbeatOnly) return { push: false, reason: "heartbeat_only" };
  if (heartbeatImpliesGitCommit()) return { push: false, reason: "heartbeat_policy_blocks" };
  const triggers = [
    "humanReviewRequired",
    "completionCandidate",
    "majorLaneMilestone",
    "majorBatchClosed",
    "dailySummaryClose",
    "productionHealthChanged",
    "cleanShutdownAfterMeaningfulWork",
    "codeConfigChanged",
  ];
  for (const t of triggers) {
    if (signals[t]) return { push: true, reason: t, paths: selectMilestoneGitPaths() };
  }
  return { push: false, reason: "no_meaningful_milestone" };
}

function emptyMetrics() {
  return {
    laneA: {
      clRequests: 0,
      clAuthorities: 0,
      reqPerAuth: null,
      jurisdictionsDeepened: 0,
      historicalRangeImproved: 0,
      citationTargetsResolved: 0,
    },
    laneB: {
      nonClAuthorities: 0,
      citationEdgesResolved: 0,
      manifestsRefreshed: 0,
      integrityFindings: 0,
      retrievalFindings: 0,
      externalLimitations: 0,
    },
    system: {
      laneASeconds: 0,
      laneBSeconds: 0,
      idleSafeSeconds: 0,
      waitingNetworkSeconds: 0,
      sleepOfflineGapSeconds: 0,
      aiCalls: 0,
      aiTokens: 0,
    },
  };
}

function assertRoutineZeroAi(metrics = {}) {
  const calls = Number(metrics.system?.aiCalls ?? metrics.aiCalls ?? 0);
  const tokens = Number(metrics.system?.aiTokens ?? metrics.aiTokens ?? 0);
  if (calls !== 0 || tokens !== 0) {
    const err = new Error(`ROUTINE_AI_USAGE_FORBIDDEN:calls=${calls}:tokens=${tokens}`);
    err.code = "ROUTINE_AI_USAGE_FORBIDDEN";
    throw err;
  }
  return true;
}

/**
 * Useful CL capacity — mirrors controller (≥25 or finish partial).
 */
function usefulClCapacityGate(safeRequests, laneA) {
  return hasUsefulClCapacity({
    safeRequests,
    remainingRequestsToFinishCourt: remainingRequestsToFinishCourt(laneA),
    minBatch: USEFUL_CL_MIN,
  });
}

/**
 * Preserve AR checkpoint helper for tests/restart.
 */
function assertArkCheckpointIntact(state, expected = "cl-opinion-9885161") {
  const cp =
    state?.laneA?.checkpoint ||
    state?.laneA?.lastSuccessfulExternalId ||
    state?.activePartial?.checkpoint ||
    state?.checkpoint;
  if (cp !== expected) {
    const err = new Error(`ARK_CHECKPOINT_MUTATED:${cp}`);
    err.code = "ARK_CHECKPOINT_MUTATED";
    throw err;
  }
  return true;
}

module.exports = {
  ROOT,
  CONFIG_DIR,
  REPORTS_DIR,
  REGISTRY_PATH,
  CHECKLIST_PATH,
  MANIFEST_PATH,
  RUNTIME_STATES,
  FRESHNESS,
  MANIFEST_STATUSES,
  SLEEP_GAP_MS,
  NETWORK_RETRY_MS,
  US_JURISDICTIONS,
  FEDERAL_TARGETS,
  sha256,
  readJson,
  writeJson,
  loadOfflineTaskRegistry,
  loadCompletionChecklist,
  assertKnownLaneBTask,
  scoreLaneATarget,
  buildDefaultLaneAManifest,
  loadOrCreateLaneAManifest,
  persistLaneAManifest,
  rerankLaneAManifest,
  evaluateLaneAStop,
  selectLaneBTask,
  detectSystemResume,
  evaluateNetworkState,
  deriveRuntimeState,
  neverOpenQueue3,
  evaluateQueue2Completion,
  applyCompletionCandidate,
  shouldPushMilestoneSnapshot,
  emptyMetrics,
  assertRoutineZeroAi,
  usefulClCapacityGate,
  assertArkCheckpointIntact,
};
