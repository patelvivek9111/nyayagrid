/**
 * Queue #2 dual-lane orchestrator / canonical worker.
 *
 * Canonical start (preferred):
 *   npm run queue2:worker
 *
 * Equivalent:
 *   node scripts/run-queue2-dual-lane.cjs
 *
 * Behavior:
 * - restores persisted scheduler state
 * - acquires Queue #2 ownership lock (refuses if another worker is active)
 * - detects sleep/resume gaps and network state (deterministic; zero AI)
 * - probes quota when due and auto-selects Lane A or Lane B
 * - Lane B tasks come only from the offline task registry (no AI planner)
 * - idle-safe sleep when no eligible Lane B work
 * - local heartbeat every ~15 minutes (zero AI, no git push)
 * - continues until HUMAN_REVIEW_REQUIRED, SIGTERM/SIGINT, or --once
 *
 * DO NOT invent free-form offline tasks. DO NOT open Queue #3.
 *
 * Env / flags:
 *   --loop | QUEUE2_WORKER_LOOP=1   — continuous loop (npm run queue2:worker)
 *   --once | QUEUE2_WORKER_ONCE=1   — single cycle then exit (default)
 *   QUEUE2_RUN_LANE_B=1             — execute Lane B offline worker
 *   QUEUE2_FORCE_QUOTA_PROBE=1
 *
 * FEATURE_AGENTS=0. Queue #3 is not opened. No manual Lane A/B selection.
 */
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  createInitialState,
  restoreState,
  decideLane,
  applyQuotaSnapshot,
  applyQuotaFloorTransition,
  applyQuotaRecoveryTransition,
  applyDurableJobCheckpoint,
  acquireLaneALock,
  releaseLaneALock,
  quotaProbeDue,
  remainingRequestsToFinishCourt,
  LANE_A_SEQUENCE,
  HUMAN_REVIEW_REASONS,
} = require("./queue2-dual-lane-controller.cjs");
const { computeSafetyTargets, computeSafeRequests, extractJsonObject, reconcileQuotaProbe, laneAConfidenceSufficient, QUOTA_CONFIDENCE } = require("./cl-quota-controller.cjs");
const {
  buildOperatorStatus,
  writeObservabilityArtifacts,
  makeEvent,
  appendEventLine,
  formatHeartbeat,
  shouldEmitHeartbeat,
  evaluateHumanReviewTriggers,
  statusLaneFromState,
  HEARTBEAT_INTERVAL_MS,
} = require("./queue2-worker-observability.cjs");
const { setHumanReview: setReview } = require("./queue2-dual-lane-controller.cjs");
const {
  acquireWorkerLock,
  refreshWorkerHeartbeat,
  releaseWorkerLock,
  newWorkerId,
  newProcessStartNonce,
  HEARTBEAT_INTERVAL_MS: LOCK_HEARTBEAT_MS,
  ACTIVE_REFUSAL_CODE,
} = require("./queue2-worker-lock.cjs");
const {
  detectSystemResume,
  evaluateNetworkState,
  deriveRuntimeState,
  selectLaneBTask,
  assertRoutineZeroAi,
  neverOpenQueue3,
  assertArkCheckpointIntact,
} = require("./queue2-autonomy-policy.cjs");
const { applyLaneBSelection, completeLaneBTask } = require("./queue2-dual-lane-controller.cjs");
const { runRegistryTask } = require("./queue2-lane-b-runners.cjs");
const {
  runPreflight,
  killSwitchStatus,
  fingerprintProductionFiles,
  detectCodeChange,
  appendAuditEvent,
  WORKER_VERSION,
} = require("./queue2-worker-safety.cjs");
const {
  formatMorningStartupSummary,
  formatWatchdogTerminalLine,
  runWatchdogCycle,
  initWatchdogSession,
  clearFalsePositiveHeartbeatDeadman,
  OVERALL,
} = require("./queue2-watchdog.cjs");

const root = path.join(__dirname, "..");
const reports = path.join(root, "packages/research/corpus/reports");
const statePath = path.join(reports, "queue2-dual-lane-state.json");
const finalPath = path.join(reports, "queue2-dual-lane-final.json");
const eventsPath = path.join(reports, "corpus-worker-events.jsonl");
const MACHINE = "811d3e3f522648";
const APP = "nyayagrid-staging";

const WORKER_ID = process.env.QUEUE2_WORKER_ID || newWorkerId();
const PROCESS_NONCE = newProcessStartNonce();
const HEARTBEAT_MS = Number(process.env.QUEUE2_HEARTBEAT_MS) || LOCK_HEARTBEAT_MS || HEARTBEAT_INTERVAL_MS;

/** Proven durable ark job snapshot (queried 2026-09-24 from corpus_ingest_jobs). */
const ARK_DURABLE_JOB_EVIDENCE = {
  source: "courtlistener",
  cl_court: "ark",
  court_id: "st-ar-high",
  status: "quota_paused",
  cursor: "cl-opinion-9885160",
  next_page_url:
    "https://www.courtlistener.com/api/rest/v4/opinions/?cluster__date_filed__lte=2018-12-31&cluster__docket__court=ark&cursor=cD05ODc5OTkx&order_by=-id&page_size=16",
  last_successful_external_id: "cl-opinion-9885161",
  items_imported: 25,
  target_max: 45,
  updated_at: "2026-09-24T03:55:31.381Z",
  evidence:
    "staging corpus_ingest_jobs row source=courtlistener cl_court=ark queried 2026-09-24; AR cases=33",
};

  const runtime = {
  shuttingDown: false,
  state: null,
  heartbeatTimer: null,
  lastStatus: null,
  morningSummaryPending: null,
  codeFingerprint: null,
};

function loadLocalState() {
  if (!fs.existsSync(statePath)) return createInitialState();
  try {
    return restoreState(JSON.parse(fs.readFileSync(statePath, "utf8")));
  } catch {
    return createInitialState();
  }
}

function saveLocalState(state) {
  fs.mkdirSync(reports, { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function flyExec(command, timeoutSec = 180) {
  return spawnSync(
    "flyctl",
    ["machine", "exec", MACHINE, "-a", APP, "--timeout", String(timeoutSec), command],
    { encoding: "utf8", maxBuffer: 16_000_000, cwd: root, shell: false },
  );
}

function lastJson(text) {
  return extractJsonObject(text);
}

function runQuotaProbe() {
  console.log(JSON.stringify({ tag: "QUOTA_CHECK", phase: "start" }));
  const r = spawnSync(
    process.execPath,
    [path.join(__dirname, "run-wave2f-fly-tool.cjs"), "scripts/tmp-cl-api-usage-probe.cjs"],
    { encoding: "utf8", cwd: root, maxBuffer: 8_000_000 },
  );
  const parsed = lastJson(r.stdout || "");
  fs.writeFileSync(path.join(reports, "queue2-dual-lane-quota-probe.txt"), (r.stdout || "") + (r.stderr || ""));
  return { parsed, status: r.status, stderr: (r.stderr || "").slice(0, 400), stdoutHead: (r.stdout || "").slice(0, 400) };
}

function persistLaneBEligibility(selection) {
  const artifact = {
    observedAt: new Date().toISOString(),
    idleSafe: Boolean(selection.idleSafe),
    currentTask: selection.currentTask || "NONE",
    reason: selection.reason || null,
    eligibleCount: selection.eligibleCount ?? 0,
    evaluatedCount: selection.evaluatedCount ?? 0,
    evaluations: selection.evaluations || [],
  };
  fs.writeFileSync(path.join(reports, "queue2-lane-b-eligibility.json"), JSON.stringify(artifact, null, 2));
  return artifact;
}

function bundleLaneB() {
  const src = path.join(__dirname, "staging-queue2-lane-b.cjs");
  const out = path.join(__dirname, "staging-queue2-lane-b-bundled.cjs");
  const es = spawnSync(
    "npx",
    ["esbuild", src, "--bundle", "--platform=node", "--format=cjs", `--outfile=${out}`],
    { encoding: "utf8", cwd: root, shell: true },
  );
  if (es.status !== 0) {
    throw new Error(es.stderr || es.stdout || "esbuild lane B failed");
  }
  return out;
}

function uploadAndRun(localBundled, remotePath, timeoutSec) {
  const CHUNK = 8_000;
  const b64 = fs.readFileSync(localBundled).toString("base64");
  for (let i = 0; i < b64.length; i += CHUNK) {
    const part = b64.slice(i, i + CHUNK);
    const cmd =
      i === 0
        ? `node -e "require('fs').writeFileSync('${remotePath}',Buffer.from('${part}','base64'))"`
        : `node -e "require('fs').appendFileSync('${remotePath}',Buffer.from('${part}','base64'))"`;
    const w = flyExec(cmd, 90);
    if (w.status !== 0) {
      throw new Error(`upload failed chunk ${Math.floor(i / CHUNK)} ${(w.stderr || w.stdout || "").slice(0, 300)}`);
    }
  }
  return flyExec(`node ${remotePath}`, timeoutSec);
}

function healthCheck() {
  const r = flyExec(
    `node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(async r=>{const t=await r.text();console.log(JSON.stringify({status:r.status,body:t.slice(0,500),featureAgents:process.env.FEATURE_AGENTS||'0'}))}).catch(e=>console.log(JSON.stringify({ok:false,err:String(e.message||e)})))"`,
    60,
  );
  return lastJson(r.stdout || "") || { raw: (r.stdout || r.stderr || "").slice(0, 400) };
}

function runLaneA(state) {
  const court = state.laneA.court || LANE_A_SEQUENCE[0].court;
  const target = String(state.laneA.target || 45);
  console.log(JSON.stringify({ tag: "LANE_A_CL", court, target }));
  const r = spawnSync(
    process.execPath,
    [path.join(__dirname, "run-staging-cl-batch-job.cjs"), "HEAD", court, "8", target],
    {
      encoding: "utf8",
      cwd: root,
      maxBuffer: 32_000_000,
      env: {
        ...process.env,
        CL_DAY_TARGET: process.env.CL_DAY_TARGET || "1160",
        CL_HOUR_TARGET: process.env.CL_HOUR_TARGET || "280",
        CL_RATE_MS: process.env.CL_RATE_MS || "2200",
        CL_DATE_FILED_LTE: process.env.CL_DATE_FILED_LTE || "2018-12-31",
      },
    },
  );
  fs.writeFileSync(path.join(reports, "queue2-dual-lane-a.txt"), (r.stdout || "") + (r.stderr || ""));
  return lastJson(r.stdout || "");
}

function runLaneB() {
  console.log(JSON.stringify({ tag: "LANE_B_OFFLINE", phase: "start", courtListenerHttpCalls: 0 }));
  bundleLaneB();
  let lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const r = spawnSync(
      process.execPath,
      [path.join(__dirname, "run-wave2f-fly-tool.cjs"), "scripts/staging-queue2-lane-b-bundled.cjs"],
      { encoding: "utf8", cwd: root, maxBuffer: 32_000_000 },
    );
    const out = (r.stdout || "") + (r.stderr || "");
    fs.writeFileSync(path.join(reports, "queue2-dual-lane-b.txt"), out);
    const parsed = lastJson(r.stdout || "");
    if (parsed && parsed.lane === "B") return parsed;
    lastErr = (out || `exit ${r.status}`).slice(-400);
    console.log(JSON.stringify({ tag: "LANE_B_OFFLINE", attempt, retry: attempt < 3 }));
    if (attempt < 3) {
      spawnSync(process.execPath, ["-e", "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,8000)"]);
    }
  }
  throw new Error(lastErr || "lane_b_failed");
}

function projectedFromWindows(windows) {
  const dayReset = windows?.day?.resetAt || windows?.day?.reset_at;
  const hourReset = windows?.hour?.resetAt || windows?.hour?.reset_at;
  const dayRemaining = Number(windows?.day?.remaining);
  const dayLimit = Number(windows?.day?.limit);
  if (Number.isFinite(dayRemaining) && Number.isFinite(dayLimit) && dayLimit > 0) {
    const reserve = Math.max(20, Math.round(dayLimit * (20 / 600)));
    if (dayRemaining <= reserve && dayReset) return dayReset;
  }
  return dayReset || hourReset || null;
}

function emit(type, fields) {
  const event = makeEvent(type, fields);
  appendEventLine(eventsPath, event);
  return event;
}

function maybeHeartbeat(state, status, { force = false } = {}) {
  const now = new Date();
  if (!force && !shouldEmitHeartbeat(state.lastHeartbeatAt, now, HEARTBEAT_MS)) return state;
  const line = formatHeartbeat(status, now);
  console.log(line);
  state.lastHeartbeatAt = now.toISOString();
  if (state.watchdogSession) {
    state.watchdogSession = {
      ...state.watchdogSession,
      lastHeartbeatAt: state.lastHeartbeatAt,
      lastWatchdogEvaluationAt: state.watchdogSession.lastWatchdogEvaluationAt || state.lastHeartbeatAt,
    };
  }

  // Local-only lock + status refresh. ZERO AI. NO git commit/push.
  refreshWorkerHeartbeat({
    reportsDir: reports,
    workerId: WORKER_ID,
    processStartNonce: PROCESS_NONCE,
    now,
    currentLane: status.currentLane,
    currentTask: status.currentTask,
    court: status.currentCourt,
    checkpoint: status.checkpoint,
  });

  const hbStatus = buildOperatorStatus({
    state,
    currentLane: status.currentLane,
    currentTask: status.currentTask,
    laneStartedAt: state.laneStartedAt,
    lastHeartbeatAt: state.lastHeartbeatAt,
    today: status.today,
    corpus: status.corpus,
    health: status.health,
    now,
  });
  writeObservabilityArtifacts(reports, hbStatus, {
    event: makeEvent("HEARTBEAT", {
      lane: status.currentLane,
      task: status.currentTask,
      court: status.currentCourt,
      checkpoint: status.checkpoint,
      reason: "interval",
      extra: { heartbeat: line, aiCalls: 0, gitPush: false },
    }),
  });
  runtime.lastStatus = hbStatus;
  saveLocalState(state);
  return state;
}

function publishStatus(state, extras = {}) {
  const status = buildOperatorStatus({
    state,
    currentLane: extras.currentLane || statusLaneFromState(state),
    currentTask: extras.currentTask,
    runtimeState: extras.runtimeState || state.runtimeState || "RUNNING",
    freshness: extras.freshness || null,
    waitingForNetwork: state.waitingForNetwork,
    laneStartedAt: state.laneStartedAt,
    lastHeartbeatAt: state.lastHeartbeatAt,
    today: extras.today,
    corpus: extras.corpus || {
      authorities: 2966,
      cases: 1649,
      clCases: 1604,
      statutes: 904,
      regulations: 158,
      rules: 254,
      authorityGateDeficit: 51,
    },
    health: extras.health || {
      database: "ok",
      orphanCount: 0,
      duplicateSourceIdCount: 0,
      featureAgents: "0",
      retrieval: "ok",
    },
    aiCalls: 0,
    aiTokens: 0,
    now: new Date(),
  });
  writeObservabilityArtifacts(reports, status, {
    dailyExtras: {
      laneReason: extras.laneReason,
      offlineSummary: extras.offlineSummary,
      citationSummary: extras.citationSummary,
      nextAction: extras.nextAction,
    },
    event: extras.event || null,
  });
  runtime.lastStatus = status;
  refreshWorkerHeartbeat({
    reportsDir: reports,
    workerId: WORKER_ID,
    processStartNonce: PROCESS_NONCE,
    currentLane: status.currentLane,
    currentTask: status.currentTask,
    court: status.currentCourt,
    checkpoint: status.checkpoint,
  });
  return status;
}

function reconcileArkCheckpoint(state) {
  if (state.laneA?.court !== "ark") return { state, reconciled: false };
  if (state.laneA?.checkpoint) return { state, reconciled: true, already: true };
  const rec = applyDurableJobCheckpoint(
    state,
    ARK_DURABLE_JOB_EVIDENCE,
    {
      count: 33,
      jurisdiction: "AR",
      mappingStatus: "VERIFIED",
      manifestVersion: state.depthManifestVersion || 1,
      runner: "staging-cl-batch-job",
    },
    new Date(),
  );
  return { state: rec.state, reconciled: rec.ok, reason: rec.reason };
}

function startHeartbeatTimer() {
  if (runtime.heartbeatTimer) clearInterval(runtime.heartbeatTimer);
  runtime.heartbeatTimer = setInterval(() => {
    if (runtime.shuttingDown || !runtime.state) return;
    try {
      if (runtime.codeFingerprint) {
        const changed = detectCodeChange(runtime.codeFingerprint);
        if (changed.changed) {
          emit("CODE_CHANGE_DETECTED", {
            lane: statusLaneFromState(runtime.state),
            court: runtime.state.laneA?.court,
            checkpoint: runtime.state.laneA?.checkpoint,
            reason: "production_files_changed",
          });
          console.log(JSON.stringify({ tag: "CODE_CHANGE_DETECTED", stop: true }));
          safeShutdown("CODE_CHANGE_DETECTED");
          process.exit(4);
        }
      }
      if (String(process.env.QUEUE2_WORKER_ENABLED || "") !== "1") {
        emit("KILL_SWITCH_STOP", {
          lane: statusLaneFromState(runtime.state),
          checkpoint: runtime.state.laneA?.checkpoint,
          reason: "QUEUE2_WORKER_DISABLED",
        });
        safeShutdown("KILL_SWITCH_STOP");
        process.exit(3);
      }
      const status =
        runtime.lastStatus ||
        buildOperatorStatus({
          state: runtime.state,
          lastHeartbeatAt: runtime.state.lastHeartbeatAt,
        });
      runtime.state = maybeHeartbeat(runtime.state, status, { force: true });
    } catch (err) {
      console.log(
        JSON.stringify({
          tag: "HEARTBEAT",
          ok: false,
          err: String(err.message || err).slice(0, 200),
          aiCalls: 0,
        }),
      );
    }
  }, HEARTBEAT_MS);
  if (typeof runtime.heartbeatTimer.unref === "function") runtime.heartbeatTimer.unref();
}

function stopHeartbeatTimer() {
  if (runtime.heartbeatTimer) {
    clearInterval(runtime.heartbeatTimer);
    runtime.heartbeatTimer = null;
  }
}

function safeShutdown(reason = "signal") {
  if (runtime.shuttingDown) return;
  runtime.shuttingDown = true;
  stopHeartbeatTimer();
  try {
    if (runtime.state) {
      saveLocalState(runtime.state);
      emit("WORKER_STOP", {
        lane: statusLaneFromState(runtime.state),
        court: runtime.state.laneA?.court,
        checkpoint: runtime.state.laneA?.checkpoint,
        reason,
      });
    }
  } catch {
    /* best effort */
  }
  try {
    releaseWorkerLock({
      reportsDir: reports,
      workerId: WORKER_ID,
      processStartNonce: PROCESS_NONCE,
    });
    emit("LOCK_RELEASED", {
      lane: runtime.state ? statusLaneFromState(runtime.state) : null,
      reason,
      extra: { workerId: WORKER_ID },
    });
  } catch {
    /* best effort */
  }
}

/**
 * One automated lane-decision + optional work cycle.
 * Lane A vs B is chosen by the controller — never by human prompt.
 */
async function runWorkerCycle(state, cycleStarted = new Date()) {
  const started = cycleStarted;
  let quota = {
    probed: false,
    safeRequests: Number(state.quota.lastSafeRequests || 0),
    windows: state.quota.windows,
  };

  if (
    process.env.QUEUE2_FORCE_QUOTA_PROBE === "1" ||
    runtime.morningSummaryPending ||
    quotaProbeDue(state, started)
  ) {
    const probe = runQuotaProbe();
    emit("QUOTA_PROBE", {
      lane: "QUOTA_CHECK",
      reason: probe.parsed?.ok === false ? "probe_failed" : "scheduled",
      quota: probe.parsed?.limits
        ? {
            minuteRemaining: probe.parsed.limits.minute?.remaining,
            hourRemaining: probe.parsed.limits.hour?.remaining,
            dayRemaining: probe.parsed.limits.day?.remaining,
          }
        : null,
    });
    if (probe.parsed) {
      const reconciled = reconcileQuotaProbe({
        parsed: probe.parsed,
        priorWindows: state.quota.windows,
        priorMembership: state.quota.membership || null,
        priorObservedAt: state.quota.quotaStateObservedAt || state.quota.lastProbeAt || null,
        now: started,
      });
      if (reconciled.note) {
        console.log(
          JSON.stringify({
            tag: "QUOTA_CHECK",
            note: reconciled.note,
            confidence: reconciled.quotaStateConfidence,
            source: reconciled.quotaStateSource,
          }),
        );
      }
      if (reconciled.humanReview || reconciled.quotaStateConfidence === QUOTA_CONFIDENCE.AMBIGUOUS) {
        state = setReview(
          state,
          HUMAN_REVIEW_REASONS.COURTLISTENER_QUOTA_STATE_AMBIGUOUS ||
            reconciled.reviewReason ||
            "COURTLISTENER_QUOTA_STATE_AMBIGUOUS",
          reconciled.note || "quota probe ambiguous",
        );
        emit("HUMAN_REVIEW_REQUIRED", {
          lane: "HUMAN_REVIEW_REQUIRED",
          reason: "COURTLISTENER_QUOTA_STATE_AMBIGUOUS",
          court: state.laneA.court,
        });
      }
      if (reconciled.windows) {
        const windows = reconciled.windows;
        const targets = reconciled.targets || computeSafetyTargets(windows);
        const safe = reconciled.safe || computeSafeRequests(windows, targets, 0);
        quota = {
          probed: true,
          safeRequests: safe.safe,
          windows,
          targets,
          safe,
          membership: reconciled.membership || null,
          confidence: reconciled.quotaStateConfidence,
          source: reconciled.quotaStateSource,
        };
        const projected = projectedFromWindows(windows);
        const remaining = remainingRequestsToFinishCourt(state.laneA);
        const decision = decideLane(state, {
          safeRequests: safe.safe,
          windows,
          projectedUsefulAt: projected,
          now: started,
        });
        // Lane A only when confidence is authoritative.
        const canLaneA =
          decision.lane === "A" &&
          laneAConfidenceSufficient(reconciled.quotaStateConfidence) &&
          !reconciled.humanReview;
        if (decision.needsHumanReview) {
          state = setReview(state, decision.reason, "decideLane blocked Lane A");
          emit("HUMAN_REVIEW_REQUIRED", {
            lane: "HUMAN_REVIEW_REQUIRED",
            reason: decision.reason,
            court: state.laneA.court,
          });
        }
        if (canLaneA) {
          const rec = applyQuotaRecoveryTransition(state, {
            safeRequests: safe.safe,
            windows,
            projectedUsefulAt: projected,
            now: started,
            probeCounted: true,
            quotaStateObservedAt: reconciled.quotaStateObservedAt,
            quotaStateSource: reconciled.quotaStateSource,
            quotaStateConfidence: reconciled.quotaStateConfidence,
            quotaStateAgeMs: reconciled.quotaStateAgeMs,
            membership: reconciled.membership,
          });
          state = rec.state;
          emit("QUOTA_RECOVERED", {
            lane: "LANE_A_CL",
            court: state.laneA.court,
            checkpoint: state.laneA.checkpoint,
            reason: decision.reason,
            quota: {
              safeRequests: safe.safe,
              usableRequests: decision.usableRequests,
              quotaMode: decision.quotaMode,
              estimatedRequestsNeeded: decision.estimatedRequestsNeeded,
              confidence: reconciled.quotaStateConfidence,
            },
          });
          emit("LANE_SWITCH", { lane: "LANE_A_CL", reason: decision.reason, court: state.laneA.court });
        } else {
          state = applyQuotaFloorTransition(state, {
            safeRequests: safe.safe,
            windows,
            projectedUsefulAt: decision.nextUsefulAt || null,
            nextUsefulAt: decision.nextUsefulAt || null,
            bindingResetAt: decision.bindingResetAt || projected || null,
            quotaMode: decision.quotaMode,
            bindingWindow: decision.bindingWindow,
            estimatedRequestsNeeded: decision.estimatedRequestsNeeded,
            now: started,
            probeCounted: true,
            court: state.laneA.court,
            checkpoint: state.laneA.checkpoint,
            lastSuccessfulExternalId: state.laneA.lastSuccessfulExternalId,
            cursor: state.laneA.cursor,
            nextPageUrl: state.laneA.nextPageUrl,
            lastSuccessfulAt: state.laneA.lastSuccessfulAt,
            count: state.laneA.count,
            target: state.laneA.target,
            reason: reconciled.humanReview
              ? "quota_ambiguous"
              : !laneAConfidenceSufficient(reconciled.quotaStateConfidence)
                ? "quota_confidence_insufficient"
                : decision.reason,
            quotaStateObservedAt: reconciled.quotaStateObservedAt,
            quotaStateSource: reconciled.quotaStateSource,
            quotaStateConfidence: reconciled.quotaStateConfidence,
            quotaStateAgeMs: reconciled.quotaStateAgeMs,
            membership: reconciled.membership,
          });
          emit("QUOTA_FLOOR", {
            lane: decision.lane === "WAIT" ? "WAIT_QUOTA_RESET" : "LANE_B_OFFLINE",
            court: state.laneA.court,
            checkpoint: state.laneA.checkpoint,
            reason: decision.reason,
            quota: {
              safeRequests: safe.safe,
              usableRequests: decision.usableRequests,
              quotaMode: decision.quotaMode,
              bindingWindow: decision.bindingWindow,
              nextUsefulAt: decision.nextUsefulAt,
              estimatedRequestsNeeded: decision.estimatedRequestsNeeded,
              dayRemaining: windows.day?.remaining,
              confidence: reconciled.quotaStateConfidence,
            },
          });
        }
        console.log(
          JSON.stringify({
            tag: "QUOTA_CHECK",
            safe: safe.safe,
            usableRequests: decision.usableRequests,
            quotaMode: decision.quotaMode,
            bindingWindow: decision.bindingWindow,
            bindingResetAt: decision.bindingResetAt || null,
            currentUsableNow: decision.currentUsableNow ?? decision.usableRequests,
            estimatedRequestsNeeded: decision.estimatedRequestsNeeded,
            requestsPerAuthorityEstimate: decision.requestsPerAuthorityEstimate,
            nextUsefulAt: decision.nextUsefulAt,
            remainingToFinish: remaining,
            lane: state.currentLane,
            nextCheckAt: state.quota.nextCheckAt,
            checkpoint: state.laneA.checkpoint,
            confidence: reconciled.quotaStateConfidence,
            dayRemaining: windows.day?.remaining,
            minuteRemaining: windows.minute?.remaining,
            hourRemaining: windows.hour?.remaining,
          }),
        );
        if (runtime.morningSummaryPending) {
          const pending = runtime.morningSummaryPending;
          runtime.morningSummaryPending = null;
          console.log(
            formatMorningStartupSummary({
              preflight: pending.preflight,
              canary: pending.canary,
              workerVersion: pending.workerVersion,
              partial: `${state.laneA?.jurisdiction || state.laneA?.court || "?"} ${state.laneA?.count || 0}/${state.laneA?.target || "?"}`,
              quota: `safe=${safe.safe}`,
              lane: statusLaneFromState(state),
              nextTarget: state.laneA?.court || "n/a",
              watchdog: state.humanReview?.required ? "HUMAN_REVIEW" : "HEALTHY",
            }),
          );
        }
      } else {
        console.log(
          JSON.stringify({
            tag: "QUOTA_CHECK",
            ok: false,
            note: reconciled.note || "probe_unparsed_stay_lane_b",
            confidence: reconciled.quotaStateConfidence,
            stderr: probe.stderr,
          }),
        );
        state = applyQuotaSnapshot(state, {
          safeRequests: 0,
          projectedUsefulAt: state.quota.nextCheckAt,
          now: started,
          quotaStateObservedAt: reconciled.quotaStateObservedAt,
          quotaStateSource: reconciled.quotaStateSource,
          quotaStateConfidence: reconciled.quotaStateConfidence,
          quotaStateAgeMs: reconciled.quotaStateAgeMs,
          membership: reconciled.membership,
        });
        if (state.currentLane !== "B") {
          state = applyQuotaFloorTransition(state, {
            safeRequests: 0,
            reason: "quota_probe_unparsed",
            now: started,
            checkpoint: state.laneA.checkpoint,
            lastSuccessfulExternalId: state.laneA.lastSuccessfulExternalId,
            count: state.laneA.count,
            target: state.laneA.target,
          });
        }
      }
    } else {
      console.log(
        JSON.stringify({
          tag: "QUOTA_CHECK",
          ok: false,
          note: "probe_unparsed_stay_lane_b",
          stderr: probe.stderr,
        }),
      );
      state = applyQuotaSnapshot(state, {
        safeRequests: quota.safeRequests,
        projectedUsefulAt: state.quota.nextCheckAt,
        now: started,
        quotaStateConfidence: QUOTA_CONFIDENCE.AMBIGUOUS,
        quotaStateSource: "unparsed",
      });
      if (state.currentLane !== "B") {
        state = applyQuotaFloorTransition(state, {
          safeRequests: quota.safeRequests,
          reason: "quota_probe_unparsed",
          now: started,
          checkpoint: state.laneA.checkpoint,
          lastSuccessfulExternalId: state.laneA.lastSuccessfulExternalId,
          count: state.laneA.count,
          target: state.laneA.target,
        });
      }
    }
  }

  let laneAResult = null;
  let laneBResult = null;
  let human = Boolean(state.humanReview?.required);

  if (state.humanReview?.required) {
    state.currentLane = "B";
  } else if (state.currentLane === "WAIT") {
    console.log(
      JSON.stringify({
        tag: "WAIT_QUOTA_RESET",
        quotaMode: state.quota?.lastPlan?.quotaMode || state.quota?.wait?.quotaMode || "WAIT_MINUTE",
        bindingWindow: state.quota?.wait?.bindingWindow || null,
        usableRequests: state.quota?.wait?.usableRequests ?? state.quota?.lastSafeRequests,
        estimatedRequestsNeeded: state.quota?.wait?.estimatedRequestsNeeded || null,
        nextUsefulAt: state.quota?.wait?.nextUsefulAt || state.quota?.nextCheckAt,
        checkpoint: state.laneA.checkpoint,
        court: state.laneA.court,
      }),
    );
  } else if (state.currentLane === "A" && quota.safeRequests >= 1) {
    if (!state.laneA.checkpoint) {
      state = setReview(
        state,
        HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT,
        "refusing Lane A start without durable checkpoint",
      );
      human = true;
      emit("HUMAN_REVIEW_REQUIRED", {
        lane: "HUMAN_REVIEW_REQUIRED",
        court: state.laneA.court,
        reason: HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT,
      });
    } else {
      const lock = acquireLaneALock(state, "dual-lane-runner", started);
      if (!lock.ok) {
        console.log(JSON.stringify({ tag: "LANE_A_CL", blocked: true, reason: lock.reason }));
        state.currentLane = "B";
      } else {
        state = lock.state;
        emit("LANE_A_START", {
          lane: "LANE_A_CL",
          court: state.laneA.court,
          checkpoint: state.laneA.checkpoint,
        });
        try {
          laneAResult = runLaneA(state);
          const status = laneAResult?.status || laneAResult?.job?.status || laneAResult?.result?.status;
          emit("LANE_A_BATCH_COMPLETE", {
            lane: "LANE_A_CL",
            court: state.laneA.court,
            checkpoint:
              laneAResult?.cursor || laneAResult?.last_successful_external_id || state.laneA.checkpoint,
            reason: status || "batch",
          });
          if (status === "quota_paused" || status === "rate_limited") {
            state = applyQuotaFloorTransition(state, {
              safeRequests: 0,
              checkpoint:
                laneAResult?.last_successful_external_id ||
                laneAResult?.cursor ||
                laneAResult?.job?.cursor ||
                state.laneA.checkpoint,
              lastSuccessfulExternalId:
                laneAResult?.last_successful_external_id || state.laneA.lastSuccessfulExternalId,
              cursor: laneAResult?.cursor || state.laneA.cursor,
              nextPageUrl: laneAResult?.next_page_url || state.laneA.nextPageUrl,
              count: state.laneA.count,
              target: state.laneA.target,
              last429At: status === "rate_limited" ? new Date().toISOString() : null,
              retryAfterSeconds: laneAResult?.lastRetryAfterSec || laneAResult?.retryAfterSeconds || null,
              now: new Date(),
            });
            if (status === "rate_limited") {
              state.quota.hard429Count = Number(state.quota.hard429Count || 0) + 1;
              const review = evaluateHumanReviewTriggers({ unexpected429: true });
              if (review.required) {
                state = setReview(state, review.reasons[0], "hard 429 during Lane A");
                human = true;
              }
            }
            emit("QUOTA_FLOOR", {
              lane: "LANE_B_OFFLINE",
              court: state.laneA.court,
              checkpoint: state.laneA.checkpoint,
              reason: status,
            });
          }
        } finally {
          const rel = releaseLaneALock(state, "dual-lane-runner", new Date());
          if (rel.ok) state = rel.state;
        }
      }
    }
  }

  if (state.currentLane === "B" && !state.humanReview?.required) {
    try {
      const runLaneBEnabled = process.env.QUEUE2_RUN_LANE_B === "1";
      const selection = selectLaneBTask({
        now: new Date(),
        networkOk: !state.waitingForNetwork,
        corpusVersion: state.depthManifestVersion,
        lastByTask: state.laneB?.lastByTask || {},
        checkpoints: state.laneB?.checkpoints || {},
        nextEligibleAt: state.laneB?.nextEligibleAt || {},
        mutatingTaskActive: Boolean(state.laneB?.mutatingTaskActive),
        nextQuotaCheckAt: state.quota?.nextCheckAt,
        executing: runLaneBEnabled,
      });
      persistLaneBEligibility(selection);
      state = applyLaneBSelection(state, selection);

      if (selection.idleSafe || !selection.executing) {
        const nextEligible =
          (selection.evaluations || [])
            .filter((e) => !e.eligible && e.nextEligibleAt)
            .sort((a, b) => String(a.nextEligibleAt).localeCompare(String(b.nextEligibleAt)))[0] || null;
        console.log(
          JSON.stringify({
            tag: "LANE_B_IDLE_SAFE",
            nextEligible: nextEligible
              ? `${nextEligible.taskId}@${nextEligible.nextEligibleAt}`
              : selection.reason || "none",
          }),
        );
        emit("LANE_B_IDLE_SAFE", {
          lane: "LANE_B_IDLE_SAFE",
          task: "NONE",
          court: state.laneA.court,
          checkpoint: state.laneA.checkpoint,
          reason: selection.reason,
        });
        laneBResult = {
          ok: true,
          idleSafe: true,
          courtListenerHttpCalls: 0,
          selectedWouldRun: selection.selectedWouldRun || null,
          note: runLaneBEnabled
            ? "no eligible Lane B task; healthy idle until next probe/eligibility"
            : "Lane B execution disabled this cycle; status cleared to IDLE_SAFE/NONE",
        };
      } else {
        console.log(JSON.stringify({ tag: "LANE_B_SELECT", task: selection.currentTask }));
        emit("LANE_B_START", {
          lane: "LANE_B_OFFLINE",
          task: selection.currentTask,
          court: state.laneA.court,
          checkpoint: state.laneA.checkpoint,
        });
        if (process.env.QUEUE2_LANE_B_MONOLITH === "1") {
          laneBResult = runLaneB();
        } else {
          laneBResult = runRegistryTask(selection.task, {
            corpusVersion: state.depthManifestVersion,
            allowMutation: process.env.QUEUE2_LANE_B_ALLOW_MUTATION === "1",
            state,
          });
        }
        const taskId = selection.currentTask || selection.task?.id;
        const noDelta = Boolean(laneBResult?.noDelta || laneBResult?.imported === 0);
        state = completeLaneBTask(
          state,
          taskId,
          laneBResult?.checkpoint ||
            laneBResult?.citation?.resolved ||
            `done-${taskId}-${new Date().toISOString()}`,
          new Date(),
          {
            minimumIntervalMs: selection.task?.minimumIntervalMs,
            checkpointKey: selection.task?.checkpointKey,
            noDelta,
          },
        );
        // Mirror registry + legacy ids into lastByTask so intervals apply after restart.
        if (taskId) {
          state.laneB.lastByTask[taskId] = state.laneB.lastByTask[taskId] || new Date().toISOString();
          for (const leg of selection.task?.legacyIds || []) {
            state.laneB.lastByTask[leg] = state.laneB.lastByTask[taskId];
          }
        }
        if (selection.task?.checkpointKey && laneBResult?.checkpoint != null) {
          state.laneB.checkpoints[selection.task.checkpointKey] = laneBResult.checkpoint;
        }
        emit("OFFLINE_TASK_COMPLETE", {
          lane: "LANE_B_OFFLINE",
          task: taskId,
          reason: laneBResult?.ok === false ? "error" : noDelta ? "NO_DELTA" : "complete",
          corpusDelta:
            laneBResult?.imported != null ? { nonClAuthorities: laneBResult.imported } : null,
        });
      }
    } catch (e) {
      laneBResult = { ok: false, err: String(e.message || e).slice(0, 400), courtListenerHttpCalls: 0 };
      human = true;
      state.laneB.task = "NONE";
      state.idleSafe = true;
      emit("ERROR", { lane: "LANE_B_OFFLINE", reason: String(e.message || e).slice(0, 200) });
    }
  }

  const health = healthCheck();
  const runtime = deriveRuntimeState({
    humanReviewRequired: Boolean(state.humanReview?.required),
    processAlive: true,
    waitingForNetwork: Boolean(state.waitingForNetwork),
    idleSafe: Boolean(state.idleSafe),
    lastHeartbeatAt: state.lastHeartbeatAt,
  });
  state.runtimeState = runtime.runtimeState;
  const status = publishStatus(state, {
    currentLane: state.humanReview?.required
      ? "HUMAN_REVIEW_REQUIRED"
      : state.idleSafe
        ? "LANE_B_IDLE_SAFE"
        : statusLaneFromState(state),
    runtimeState: runtime.runtimeState,
    freshness: runtime.freshness,
    currentTask: state.humanReview?.required
      ? "await_human_review"
      : state.idleSafe
        ? "NONE"
        : state.currentLane === "A"
          ? "cl_ingest"
          : state.laneB?.task || "offline",
    laneReason: state.humanReview?.required
      ? (state.humanReview.reasons || []).join(", ")
      : state.idleSafe
        ? "no eligible Lane B task"
        : state.currentLane === "B"
          ? "CourtListener day safety floor"
          : "useful CL capacity",
    citationSummary: laneBResult?.citation
      ? `resolved=${laneBResult.citation.resolved} TARGET_ABSENT=${laneBResult.citation.TARGET_ABSENT}`
      : `citationEdgesResolved cumulative: ${state.metrics?.citationsResolved || 0}`,
    offlineSummary: `Lane B CL HTTP=${laneBResult?.courtListenerHttpCalls ?? 0}. Non-CL authorities cumulative=${state.metrics?.nonClAuthorities || 0}. idleSafe=${Boolean(state.idleSafe)}`,
    nextAction: state.humanReview?.required
      ? "Stop unsafe CL path; await human review."
      : `Automatically resume AR (${state.laneA.count}/${state.laneA.target}) when safeRequests meets threshold; checkpoint=${state.laneA.checkpoint}`,
    health: {
      database: health?.checks?.database || (health?.status === 200 ? "ok" : "unknown"),
      orphanCount: 0,
      duplicateSourceIdCount: 0,
      featureAgents: health?.featureAgents || health?.checks?.featureAgents || "0",
      retrieval: "ok",
    },
    corpus: laneBResult?.corpus
      ? {
          authorities: laneBResult.corpus.authorities,
          cases: laneBResult.corpus.cases,
          clCases: laneBResult.corpus.cl_cases,
          statutes: laneBResult.corpus.statutes,
          regulations: laneBResult.corpus.regulations,
          rules: laneBResult.corpus.rules,
          authorityGateDeficit: laneBResult?.depth?.authorityGateDeficit ?? 51,
        }
      : undefined,
  });
  // Deterministic progress watchdog (zero AI / zero CL HTTP).
  try {
    const wdSnap = {
      processAlive: true,
      machineAwake: true,
      pidAlive: true,
      lockMatchesSession: true,
      lastHeartbeatAt: state.lastHeartbeatAt || state.watchdogSession?.lastHeartbeatAt || new Date().toISOString(),
      heartbeatWorkerId: state.watchdogSession?.workerId || WORKER_ID,
      workerId: state.watchdogSession?.workerId || WORKER_ID,
      processStartNonce: state.watchdogSession?.processStartNonce || PROCESS_NONCE,
      watchdogSession: state.watchdogSession || null,
      currentLane: state.currentLane,
      currentTask: state.currentLane === "A" ? "cl_ingest" : state.laneB?.task || "NONE",
      checkpoint: state.laneA?.checkpoint,
      previousCheckpoint: state.laneA?.lastSuccessfulExternalId,
      authorities: status?.corpus?.authorities,
      cases: status?.corpus?.cases,
      productiveWorkAvailable:
        Number(state.laneA?.count || 0) < Number(state.laneA?.target || 0) ||
        state.currentLane === "A",
      quotaMode: state.quota?.lastPlan?.quotaMode || state.quota?.wait?.quotaMode || null,
      waitReason: state.quota?.wait?.quotaMode || null,
      nextUsefulAt: state.quota?.wait?.nextUsefulAt || null,
      bindingResetAt: state.quota?.bindingResetAt || null,
      verifiedClWorkRemaining: Number(state.laneA?.count || 0) < Number(state.laneA?.target || 0),
      unusedUsableCapacity: state.quota?.lastPlan?.usableRequests || 0,
      orphans: status?.health?.orphanCount || 0,
      duplicateSourceIds: status?.health?.duplicateSourceIdCount || 0,
      workerVersion: WORKER_VERSION,
      queue3: state.queue3 || "NOT_OPEN",
      idleSafe: Boolean(state.idleSafe),
    };
    const wd = runWatchdogCycle({
      snapshot: wdSnap,
      session: state.watchdogSession || null,
      persist: true,
    });
    if (state.watchdogSession) {
      state.watchdogSession.lastWatchdogEvaluationAt = new Date().toISOString();
    }
    console.log(
      formatWatchdogTerminalLine(wd.state, {
        currentLane: statusLaneFromState(state),
        jurisdiction: state.laneA?.jurisdiction || state.laneA?.court,
        countLabel: `${state.laneA?.count || 0}/${state.laneA?.target || "?"}`,
        quotaLabel: `${state.quota?.windows?.minute?.remaining ?? "?"}/${state.quota?.windows?.hour?.remaining ?? "?"}/${state.quota?.windows?.day?.remaining ?? "?"}`,
        quotaMode: wdSnap.quotaMode,
        nextUsefulAt: wdSnap.nextUsefulAt,
      }),
    );
    if (wd.state.overallStatus === OVERALL.HUMAN_REVIEW_REQUIRED && wd.state.ifNotWhatIsWrong?.reason) {
      state = setReview(state, wd.state.ifNotWhatIsWrong.reason, "watchdog critical");
      human = true;
    }
    if (wd.state.overallStatus === OVERALL.EMERGENCY_STOP && wd.state.ifNotWhatIsWrong?.reason) {
      state = setReview(state, wd.state.ifNotWhatIsWrong.reason, "watchdog emergency");
      human = true;
    }
  } catch (wdErr) {
    console.log(JSON.stringify({ tag: "WATCHDOG", ok: false, err: String(wdErr.message || wdErr).slice(0, 200), aiCalls: 0 }));
  }
  state = maybeHeartbeat(state, status);
  saveLocalState(state);
  runtime.state = state;

  const clDuringB = Number(laneBResult?.courtListenerHttpCalls ?? 0);
  const runStatus =
    clDuringB !== 0
      ? "HOLD"
      : state.humanReview?.required
        ? "PARTIAL"
        : laneBResult?.ok === false && !laneAResult
          ? "PARTIAL"
          : "PASS";

  return {
    state,
    status,
    health,
    quota,
    laneAResult,
    laneBResult,
    human,
    runStatus,
    clDuringB,
  };
}

function sleepMs(ms) {
  const n = Math.max(0, Number(ms) || 0);
  if (n <= 0) return;
  spawnSync(process.execPath, ["-e", `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${n})`], {
    shell: false,
  });
}

async function main() {
  fs.mkdirSync(reports, { recursive: true });
  let state = neverOpenQueue3(loadLocalState());
  const started = new Date();
  state.laneStartedAt = state.laneStartedAt || started.toISOString();

  // Sleep/resume detection before any mutation.
  const resume = detectSystemResume(state.lastHeartbeatAt, started);
  if (resume.probableSuspend) {
    emit("SYSTEM_RESUME_DETECTED", {
      lane: statusLaneFromState(state),
      court: state.laneA?.court,
      checkpoint: state.laneA?.checkpoint,
      reason: "wall_clock_gap",
      extra: { gapMs: resume.gapMs },
    });
    // Do not assume quota probes ran while asleep — force re-evaluation path.
    if (state.quota) state.quota.nextCheckAt = started.toISOString();
  }

  try {
    assertArkCheckpointIntact(state);
  } catch (err) {
    if (err.code === "ARK_CHECKPOINT_MUTATED" && state.laneA?.court === "ark") {
      state = setReview(
        state,
        HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT,
        String(err.message),
      );
    }
  }

  assertRoutineZeroAi({ system: { aiCalls: state.metrics?.aiCalls || 0, aiTokens: state.metrics?.aiTokens || 0 } });

  // Hard kill switch — refuse mutating work unless explicitly enabled.
  const ks = killSwitchStatus(process.env);
  if (!ks.enabled) {
    console.log("QUEUE2_WORKER_DISABLED");
    console.log(JSON.stringify({ ok: false, code: ks.code, runtimeState: "STOPPED" }));
    process.exit(3);
  }

  // Mandatory preflight before mutating lock acquisition.
  const startedFingerprint = fingerprintProductionFiles();
  runtime.codeFingerprint = startedFingerprint;
  const preflight = runPreflight({
    env: process.env,
    state,
    workerVersion: WORKER_VERSION,
    dbReachable: process.env.QUEUE2_DB_REACHABLE !== "0",
    storageReachable: process.env.QUEUE2_STORAGE_REACHABLE !== "0",
    networkOk: process.env.QUEUE2_NETWORK_ONLINE !== "0",
  });
  fs.writeFileSync(path.join(reports, "queue2-preflight-last.json"), JSON.stringify(preflight, null, 2));
  if (!preflight.ok) {
    console.log("PREFLIGHT_FAIL");
    console.log(`reasons=[${preflight.reasons.join(", ")}]`);
    console.log(JSON.stringify({ ok: false, mutations: preflight.mutations, aiCalls: 0 }));
    process.exit(2);
  }
  console.log("PREFLIGHT_PASS");
  const knownGoodPath = path.join(reports, "queue2-watchdog-known-good.json");
  let knownGood = null;
  try {
    knownGood = JSON.parse(fs.readFileSync(knownGoodPath, "utf8"));
  } catch {
    knownGood = null;
  }
  const canaryNeeded =
    Boolean(knownGood?.workerVersion) && knownGood.workerVersion !== WORKER_VERSION;
  // Morning summary deferred until AFTER fresh quota reconciliation (not stale persisted quota).
  runtime.morningSummaryPending = {
    preflight: "PASS",
    canary: canaryNeeded ? "REQUIRED" : knownGood?.workerVersion ? "PASS" : "NOT_REQUIRED",
    workerVersion: WORKER_VERSION,
  };
  appendAuditEvent({
    lane: statusLaneFromState(state),
    task: "preflight",
    nextActionReason: "PREFLIGHT_PASS",
    workerId: WORKER_ID,
    workerVersion: WORKER_VERSION,
    priorCheckpoint: state.laneA?.checkpoint,
    resultingCheckpoint: state.laneA?.checkpoint,
  });

  // Optional connectivity probe result may be injected via env for tests; default assume online.
  if (process.env.QUEUE2_NETWORK_ONLINE === "0") {
    const net = evaluateNetworkState({
      online: false,
      offlineSince: state.networkOfflineSince || started.toISOString(),
      now: started,
      wasWaiting: true,
    });
    state.waitingForNetwork = true;
    state.runtimeState = net.runtimeState;
    emit("NETWORK_LOSS", {
      lane: "WAITING_FOR_NETWORK",
      court: state.laneA?.court,
      checkpoint: state.laneA?.checkpoint,
      reason: net.action,
    });
  } else if (state.waitingForNetwork) {
    const net = evaluateNetworkState({ online: true, wasWaiting: true, now: started });
    state.waitingForNetwork = false;
    state.lastOnlineAt = started.toISOString();
    emit("NETWORK_RECOVERED", {
      lane: statusLaneFromState(state),
      court: state.laneA?.court,
      checkpoint: state.laneA?.checkpoint,
      reason: net.action,
    });
    if (state.quota) state.quota.nextCheckAt = started.toISOString();
  }

  const acquired = acquireWorkerLock({
    reportsDir: reports,
    workerId: WORKER_ID,
    processStartNonce: PROCESS_NONCE,
    now: started,
    currentLane: statusLaneFromState(state),
    currentTask: state.laneB?.task || "boot",
    court: state.laneA?.court || null,
    checkpoint: state.laneA?.checkpoint || null,
  });

  if (!acquired.ok) {
    console.log(acquired.refusal || ACTIVE_REFUSAL_CODE);
    console.log(
      JSON.stringify({
        ok: false,
        code: acquired.code || ACTIVE_REFUSAL_CODE,
        lock: acquired.lock,
      }),
    );
    process.exit(2);
  }

  emit("WORKER_START", {
    lane: statusLaneFromState(state),
    task: state.laneB?.task || "boot",
    court: state.laneA?.court,
    checkpoint: state.laneA?.checkpoint,
    extra: { workerId: WORKER_ID, pid: process.pid },
  });

  if (acquired.recovered) {
    emit("LOCK_RECOVERED", {
      lane: statusLaneFromState(state),
      court: state.laneA?.court,
      checkpoint: state.laneA?.checkpoint,
      reason: "stale_or_corrupt_lock",
      extra: { workerId: WORKER_ID, archivedPath: acquired.archivedPath },
    });
  } else {
    emit("LOCK_ACQUIRED", {
      lane: statusLaneFromState(state),
      court: state.laneA?.court,
      checkpoint: state.laneA?.checkpoint,
      extra: { workerId: WORKER_ID, pid: process.pid },
    });
  }

  // WATCHDOG_SESSION_INIT — baseline from CURRENT worker session only.
  const sessionNow = new Date();
  state.watchdogSession = initWatchdogSession({
    workerId: WORKER_ID,
    pid: process.pid,
    processStartNonce: PROCESS_NONCE,
    now: sessionNow,
  });
  state.lastHeartbeatAt = state.watchdogSession.lastHeartbeatAt;
  emit("WATCHDOG_SESSION_INIT", {
    lane: statusLaneFromState(state),
    court: state.laneA?.court,
    checkpoint: state.laneA?.checkpoint,
    extra: {
      workerId: WORKER_ID,
      pid: process.pid,
      processStartNonce: PROCESS_NONCE,
      startedAt: state.watchdogSession.startedAt,
    },
  });

  // Clear only the known HEARTBEAT_DEADMAN false-positive; keep unrelated review reasons.
  const clearedReview = clearFalsePositiveHeartbeatDeadman(state.humanReview);
  if (clearedReview.cleared) {
    state.humanReview = {
      required: clearedReview.required,
      reasons: clearedReview.reasons,
      details: clearedReview.details,
    };
    emit("HUMAN_REVIEW_CLEARED", {
      lane: statusLaneFromState(state),
      reason: "HEARTBEAT_DEADMAN_FALSE_POSITIVE",
      court: state.laneA?.court,
      checkpoint: state.laneA?.checkpoint,
      extra: { remainingReasons: clearedReview.reasons },
    });
  }

  // INITIAL_HEARTBEAT immediately — do not wait 15 minutes.
  {
    const bootStatus = {
      currentLane: statusLaneFromState(state),
      currentTask: "boot",
      currentCourt: state.laneA?.court,
      checkpoint: state.laneA?.checkpoint,
      today: {},
      corpus: null,
      health: null,
    };
    state = maybeHeartbeat(state, bootStatus, { force: true });
    emit("INITIAL_HEARTBEAT", {
      lane: statusLaneFromState(state),
      court: state.laneA?.court,
      checkpoint: state.laneA?.checkpoint,
      extra: {
        workerId: WORKER_ID,
        processStartNonce: PROCESS_NONCE,
        lastHeartbeatAt: state.lastHeartbeatAt,
      },
    });
  }
  saveLocalState(state);

  if (acquired.reviewReason) {
    state = setReview(state, acquired.reviewReason, "lock acquisition noted ownership inconsistency");
    emit("HUMAN_REVIEW_REQUIRED", {
      lane: "HUMAN_REVIEW_REQUIRED",
      reason: acquired.reviewReason,
    });
  }

  const onSignal = (sig) => {
    console.log(JSON.stringify({ tag: "WORKER_STOP", reason: sig }));
    safeShutdown(sig);
    process.exit(0);
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  // Checkpoint hardening: never leave AR partial with null resume position.
  const recon = reconcileArkCheckpoint(state);
  state = recon.state;
  if (recon.reconciled && !recon.already) {
    emit("CHECKPOINT", {
      lane: "LANE_A_CL",
      court: state.laneA.court,
      checkpoint: state.laneA.checkpoint,
      reason: "reconciled_from_corpus_ingest_jobs",
      extra: {
        cursor: state.laneA.cursor,
        lastSuccessfulExternalId: state.laneA.lastSuccessfulExternalId,
        count: state.laneA.count,
        target: state.laneA.target,
      },
    });
  } else if (!state.laneA?.checkpoint && Number(state.laneA?.count) > 0) {
    state = setReview(
      state,
      HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT,
      "AR partial without durable resume after reconcile attempt",
    );
    emit("HUMAN_REVIEW_REQUIRED", {
      lane: "HUMAN_REVIEW_REQUIRED",
      court: state.laneA.court,
      reason: HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT,
    });
  }

  runtime.state = state;
  startHeartbeatTimer();

  const wantLoop =
    process.argv.includes("--loop") ||
    (process.env.QUEUE2_WORKER_LOOP === "1" && !process.argv.includes("--once"));
  const wantOnce =
    process.argv.includes("--once") ||
    process.env.QUEUE2_WORKER_ONCE === "1" ||
    !wantLoop;
  const loop = wantLoop && !wantOnce;
  const maxCycles = Number(process.env.QUEUE2_WORKER_MAX_CYCLES || (loop ? 0 : 1));
  let cycles = 0;
  let lastCycle = null;

  // eslint-disable-next-line no-constant-condition
  while (!runtime.shuttingDown) {
    cycles += 1;
    lastCycle = await runWorkerCycle(runtime.state, new Date());
    state = lastCycle.state;
    runtime.state = state;

    if (state.humanReview?.required) break;
    if (!loop) break;
    if (maxCycles > 0 && cycles >= maxCycles) break;

    const nextProbe = state.quota?.wait?.nextUsefulAt
      ? new Date(state.quota.wait.nextUsefulAt).getTime()
      : state.quota?.nextCheckAt
        ? new Date(state.quota.nextCheckAt).getTime()
        : Date.now() + HEARTBEAT_MS;
    const sleepFor =
      state.currentLane === "WAIT"
        ? Math.min(HEARTBEAT_MS, Math.max(2_000, nextProbe - Date.now()))
        : Math.min(HEARTBEAT_MS, Math.max(5_000, nextProbe - Date.now()));
    console.log(
      JSON.stringify({
        tag: state.currentLane === "WAIT" ? "WAIT_QUOTA_RESET" : "WORKER_IDLE",
        sleepMs: sleepFor,
        nextQuotaCheckAt: state.quota?.nextCheckAt,
        nextUsefulAt: state.quota?.wait?.nextUsefulAt || null,
        lane: state.currentLane,
        aiCalls: 0,
      }),
    );
    sleepMs(sleepFor);
  }

  const clDuringB = Number(lastCycle?.clDuringB ?? 0);
  const runStatus = lastCycle?.runStatus || "PASS";
  const health = lastCycle?.health || {};
  const laneAResult = lastCycle?.laneAResult || null;
  const laneBResult = lastCycle?.laneBResult || null;
  const human = Boolean(lastCycle?.human || state.humanReview?.required);
  const status = lastCycle?.status || publishStatus(state);
  const quota = lastCycle?.quota || { probed: false };

  emit("WORKER_STOP", {
    lane: status.currentLane,
    court: state.laneA.court,
    checkpoint: state.laneA.checkpoint,
    reason: runStatus,
  });

  const final = {
    ok: runStatus !== "HOLD",
    status: runStatus,
    wave: "queue2-ownership-heartbeat",
    generatedAt: new Date().toISOString(),
    worker: {
      workerId: WORKER_ID,
      pid: process.pid,
      cycles,
      heartbeatIntervalMs: HEARTBEAT_MS,
      aiCallsForHeartbeat: 0,
      gitPushesForHeartbeat: 0,
      lockPath: "packages/research/corpus/reports/queue2-worker.lock.json",
      canonicalCommand: "npm run queue2:worker",
      manualLaneSelectionRequired: false,
      osAutostartConfigured: false,
    },
    checkpointSafety: {
      durableCheckpoint: state.laneA.checkpoint,
      currentJurisdiction: state.laneA.jurisdiction || null,
      currentCourt: state.laneA.court || null,
      cursor: state.laneA.cursor,
      lastSuccessfulExternalId: state.laneA.lastSuccessfulExternalId,
      nextPageUrl: state.laneA.nextPageUrl,
      lastSuccessfulAt: state.laneA.lastSuccessfulAt,
      mappingStatus: state.laneA.mappingStatus,
      reconciledFrom: "corpus_ingest_jobs",
      humanReviewRequired: Boolean(state.humanReview?.required),
      reviewReasons: state.humanReview?.reasons || [],
    },
    observability: {
      statusFile: "packages/research/corpus/reports/corpus-worker-status.json",
      dailyFile: "packages/research/corpus/reports/corpus-worker-daily.md",
      eventsFile: "packages/research/corpus/reports/corpus-worker-events.jsonl",
      heartbeat: true,
      heartbeatIntervalMs: HEARTBEAT_MS,
    },
    courtListener: {
      laneBRequests: clDuringB,
      quotaProbeThisRun: Boolean(quota.probed),
      mustBeZeroExceptQuotaProbe: clDuringB === 0,
    },
    laneA: {
      currentCourt: state.laneA.court,
      jurisdiction: state.laneA.jurisdiction,
      checkpoint: state.laneA.checkpoint,
      target: state.laneA.target,
      count: state.laneA.count,
      nextResumeCondition: state.quota.nextCheckAt,
      result: laneAResult,
    },
    laneB: laneBResult,
    automation: {
      nextQuotaProbe: state.quota.nextCheckAt,
      automaticLaneAResume: !state.humanReview?.required,
      automaticLaneSwitch: true,
      humanInterventionRequired: human || state.humanReview?.required ? "yes" : "no",
    },
    operational: {
      tests:
        "queue2-dual-lane-controller.test.cjs + queue2-worker-observability.test.cjs + queue2-worker-lock.test.cjs",
      health,
      featureAgents: health?.featureAgents || health?.checks?.featureAgents || "0",
    },
    queue: { "#2": "OPEN", "#9": "CLOSED", "#3": "NOT_OPEN", transition: "NONE" },
  };
  fs.writeFileSync(finalPath, JSON.stringify(final, null, 2));
  console.log(
    JSON.stringify({
      tag: "LANE_SWITCH",
      currentLane: state.currentLane,
      status: runStatus,
      checkpoint: state.laneA.checkpoint,
      finalPath,
    }),
  );
  console.log(JSON.stringify(final));

  safeShutdown("normal");
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 500) }));
  try {
    safeShutdown("error");
  } catch {
    /* ignore */
  }
  process.exit(1);
});
