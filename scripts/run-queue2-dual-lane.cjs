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
  resolveCorpusTotalsForStatus,
  resolveManifestVersionForStatus,
  isMissingDurableResumeCheckpointFatal,
  isReadyFirstStartLaneA,
  validatePartialCheckpoint,
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
  MANIFEST_PATH,
} = require("./queue2-worker-safety.cjs");
const {
  remainingCasesToFinish,
  resolveLaneABatchBounds,
  parseLaneARunnerOutput,
  classifyLaneABatchResult,
  reconcileLaneACountSources,
  shouldRaiseLaneAZeroProgress,
  evaluateReconciliationCanary,
  selectNextVerifiedIncompleteTarget,
  applyTargetAlreadyComplete,
  resolveBindingResetAt,
  evaluateProductionCanaryGate,
  nextQuotaCheckAfterActiveBatch,
  detectRedundantQuotaProbes,
  detectLaneADispatchStall,
  computePostCycleSleepMs,
} = require("./queue2-lane-a-dispatch.cjs");
const {
  classifyExistingCorpusIngestJob,
  adoptExistingJobIntoLaneA,
  reconcileStaleRunningGuard,
  JOB_CLASSIFICATIONS,
} = require("./queue2-existing-job-reconcile.cjs");
const {
  LANE_A_RUNNER_STATES,
  CANARY_MAX_SESSION_CL_REQUESTS,
  createEmptySessionQuota,
  createLaneAChildRecord,
  mayLaunchLaneAChild,
  markLaneAChildTerminal,
  isFreshPostRunDbEvidence,
  updateSessionQuotaAccounting,
  evaluateCanaryAfterTerminal,
  createSharedClSession,
  remainingChildClBudget,
  mergeChildSessionAccounting,
  assertChildWithinSessionBudget,
} = require("./queue2-lane-a-child-lifecycle.cjs");
const {
  CL_REQUEST_PURPOSES,
  CONSERVATION_REASONS,
  createEmptyClRequestLedger,
  beginNewClRequestSession,
  shouldResetClSessionForNewWorker,
  recordClRequest,
  evaluateClConservationGate,
  evaluateQuotaProbeCache,
  applyQuotaProbeCacheDecision,
  evaluateRedundantQuotaProbeHardStop,
  formatClRequestAccountingLine,
  formatRollingDayObservedLine,
} = require("./queue2-cl-quota-conservation.cjs");
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

/** Mutable worker runtime — must exist before any startup/cycle function uses it. */
const runtime = {
  shuttingDown: false,
  state: null,
  heartbeatTimer: null,
  lastStatus: null,
  morningSummaryPending: null,
  codeFingerprint: null,
  session: null,
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

function runLaneA(state, opts = {}) {
  const court = state.laneA.court || LANE_A_SEQUENCE[0].court;
  const target = String(state.laneA.target || 45);
  const batchSize = String(opts.batchSize || Math.min(8, Math.max(1, remainingCasesToFinish(state.laneA) || 1)));
  console.log(JSON.stringify({ tag: "LANE_A_CL", court, target, batchSize }));
  if (typeof opts.runner === "function") {
    const stdout = opts.runner({ state, court, target, batchSize });
    return { stdout: String(stdout || ""), mocked: true };
  }
  const session = opts.sharedSession || state.clSharedSession || null;
  const remainingBudget =
    opts.maxClRequests != null
      ? Number(opts.maxClRequests)
      : remainingChildClBudget(session);
  const r = spawnSync(
    process.execPath,
    [path.join(__dirname, "run-staging-cl-batch-job.cjs"), "HEAD", court, batchSize, target],
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
        // Parent already probed; child must not burn a fresh quota probe.
        CL_BOOTSTRAP_USAGE: process.env.CL_BOOTSTRAP_USAGE || "0",
        CL_MAX_SESSION_CALLS:
          remainingBudget != null && Number.isFinite(remainingBudget)
            ? String(remainingBudget)
            : process.env.CL_MAX_SESSION_CALLS || "",
        CL_SESSION_ID: session?.sessionId || process.env.CL_SESSION_ID || "",
        CL_BATCH_ID: session?.batchId || process.env.CL_BATCH_ID || "",
        CL_HISTORICAL_API_CALLS_BASELINE: String(
          session?.historicalJobApiCallsBaseline ??
            state.sessionQuota?.historicalJobApiCallsBaseline ??
            "",
        ),
      },
    },
  );
  const stdout = (r.stdout || "") + (r.stderr || "");
  fs.writeFileSync(path.join(reports, "queue2-dual-lane-a.txt"), stdout);
  return { stdout, statusCode: r.status, mocked: false };
}

/**
 * Read-only live DB count for a Lane A court. Injectable for tests.
 * Returns qualifying/CL case counts; never mutates corpus.
 * When opts.after / requireFresh is set, refuse cache older than that timestamp
 * and perform an actual fresh probe (timestamped).
 */
function queryLiveLaneACourtCounts(court, opts = {}) {
  if (typeof opts.query === "function") {
    const q = opts.query({ court, after: opts.after, requireFresh: opts.requireFresh });
    if (q && !q.generatedAt && !q.observedAt && !q.dbEvidenceObservedAt) {
      return { ...q, generatedAt: new Date().toISOString(), dbEvidenceObservedAt: new Date().toISOString() };
    }
    return q;
  }
  if (typeof runtime.liveLaneACountQuery === "function") {
    return runtime.liveLaneACountQuery({ court, after: opts.after, requireFresh: opts.requireFresh });
  }
  if (typeof runtime.fetchLiveLaneACourtCounts === "function") {
    return runtime.fetchLiveLaneACourtCounts({ court, after: opts.after });
  }

  const afterMs = opts.after ? Date.parse(opts.after) : NaN;
  const probePath = path.join(reports, "queue2-lane-a-live-count-last.json");

  const acceptCached = (probe) => {
    if (!probe?.ok || probe?.court !== court) return null;
    const at = probe.generatedAt || probe.observedAt || probe.dbEvidenceObservedAt;
    if (!at) return null;
    if (Number.isFinite(afterMs) && Date.parse(at) < afterMs) return null;
    return probe;
  };

  // Production post-terminal path: always attempt a fresh probe when required.
  if (opts.requireFresh === true || Number.isFinite(afterMs)) {
    const fresh = runFreshLaneALiveCountProbe(court, { after: opts.after });
    if (fresh) {
      try {
        fs.writeFileSync(probePath, JSON.stringify(fresh, null, 2));
      } catch {
        /* ignore */
      }
      return fresh;
    }
    // Fall through: only accept cache if still fresh vs after.
  }

  if (fs.existsSync(probePath)) {
    try {
      const probe = JSON.parse(fs.readFileSync(probePath, "utf8"));
      const ok = acceptCached(probe);
      if (ok) return ok;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Fresh read-only Lane A court count via Fly staging SQL probe (zero CL HTTP).
 */
function runFreshLaneALiveCountProbe(court, opts = {}) {
  const bundled = path.join(__dirname, "tmp-queue2-mi-job-reconcile-probe-bundled.cjs");
  if (!fs.existsSync(bundled)) return null;
  // Only mich probe script is currently bundled; generalize via court arg when available.
  const r = spawnSync(
    process.execPath,
    [path.join(__dirname, "run-wave2f-fly-tool.cjs"), "scripts/tmp-queue2-mi-job-reconcile-probe-bundled.cjs"],
    { encoding: "utf8", cwd: root, maxBuffer: 8_000_000 },
  );
  const parsed = lastJson(r.stdout || "");
  if (!parsed?.ok) return null;
  const nowIso = new Date().toISOString();
  // Map MI probe shape → liveDb evidence. For non-mich courts return null (caller treats as unavailable).
  if (String(court).toLowerCase() !== "mich" && String(court).toLowerCase() !== "mi") {
    return null;
  }
  const mi = parsed.mi || {};
  return {
    ok: true,
    court: "mich",
    qualifyingCases: mi.high_court_cl_cases ?? mi.cases ?? null,
    highCourtClCases: mi.high_court_cl_cases ?? null,
    clCases: mi.cl_cases ?? null,
    cases: mi.cases ?? null,
    authorities: mi.authorities ?? null,
    integrity: {
      duplicateSourceIds: parsed.integrity?.duplicate_source_ids ?? 0,
      orphanCount: parsed.integrity?.orphan_count ?? 0,
      chunkHealthy: true,
    },
    jobs: parsed.jobs || [],
    generatedAt: parsed.generatedAt || nowIso,
    observedAt: parsed.generatedAt || nowIso,
    dbEvidenceObservedAt: parsed.generatedAt || nowIso,
    courtListenerHttpCalls: 0,
    mutations: 0,
    after: opts.after || null,
  };
}

function loadManifestForSelection() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  } catch {
    return { targets: [] };
  }
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

  const resolvedCorpus = resolveCorpusTotalsForStatus({
    reportsDir: reports,
    corpus: status.corpus || runtime.lastStatus?.corpus || null,
  });
  const resolvedManifest = resolveManifestVersionForStatus({
    reportsDir: reports,
    state,
    manifestVersion: status.manifestVersion ?? state.laneA?.manifestVersion,
  });
  const hbStatus = buildOperatorStatus({
    state,
    currentLane: status.currentLane,
    currentTask: status.currentTask,
    laneStartedAt: state.laneStartedAt,
    lastHeartbeatAt: state.lastHeartbeatAt,
    today: status.today,
    corpus: resolvedCorpus,
    manifestVersion: resolvedManifest,
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
    protectCorpusTotals: true,
  });
  runtime.lastStatus = hbStatus;
  saveLocalState(state);
  return state;
}

function publishStatus(state, extras = {}) {
  const resolvedCorpus = resolveCorpusTotalsForStatus({
    reportsDir: reports,
    corpus: extras.corpus || null,
  });
  const resolvedManifest =
    extras.manifestVersion != null
      ? extras.manifestVersion
      : resolveManifestVersionForStatus({
          reportsDir: reports,
          state,
          manifestVersion: state.laneA?.manifestVersion,
        });
  // Keep durable state aligned with the best-known live manifest version.
  if (
    resolvedManifest != null &&
    Number(state.laneA?.manifestVersion || 0) < Number(resolvedManifest)
  ) {
    state.laneA = { ...state.laneA, manifestVersion: resolvedManifest };
    state.depthManifestVersion = Math.max(
      Number(state.depthManifestVersion || 0),
      Number(resolvedManifest),
    );
  }
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
    manifestVersion: resolvedManifest,
    corpus: {
      authorities: resolvedCorpus.authorities,
      cases: resolvedCorpus.cases,
      clCases: resolvedCorpus.clCases,
      statutes: resolvedCorpus.statutes,
      regulations: resolvedCorpus.regulations,
      rules: resolvedCorpus.rules,
      authorityGateDeficit: resolvedCorpus.authorityGateDeficit,
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
    protectCorpusTotals: true,
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

  // Lane A selected but no runner within warning/critical thresholds.
  if (state.currentLane === "A" && !state.humanReview?.required) {
    const stall = detectLaneADispatchStall({
      laneASelectedAt: state.laneASelectedAt,
      now: started,
      runnerStarted: Boolean(state.laneARunnerStartedAt || state.laneA?.lock),
      warningMs: 2 * 60 * 1000,
      criticalMs: 5 * 60 * 1000,
    });
    if (stall.stalled) {
      emit(stall.severity === "CRITICAL" ? "WATCHDOG_CRITICAL" : "WATCHDOG_WARNING", {
        lane: "LANE_A_CL",
        court: state.laneA.court,
        checkpoint: state.laneA.checkpoint,
        reason: stall.reason,
        extra: { ageMs: stall.ageMs, severity: stall.severity },
      });
      if (stall.severity === "CRITICAL") {
        state = setReview(
          state,
          HUMAN_REVIEW_REASONS.LANE_A_DISPATCH_STALLED,
          `Lane A selected but runner not started within ${Math.round(stall.ageMs / 1000)}s`,
        );
        emit("HUMAN_REVIEW_REQUIRED", {
          lane: "HUMAN_REVIEW_REQUIRED",
          court: state.laneA.court,
          reason: HUMAN_REVIEW_REASONS.LANE_A_DISPATCH_STALLED,
        });
      }
    }
  }

  // Hold redundant quota probing until reset / justified event.
  if (
    state.quota?.redundantProbeHoldUntil &&
    started.getTime() < new Date(state.quota.redundantProbeHoldUntil).getTime() &&
    process.env.QUEUE2_FORCE_QUOTA_PROBE !== "1"
  ) {
    console.log(
      JSON.stringify({
        tag: "QUOTA_CHECK",
        skipped: true,
        reason: "REDUNDANT_QUOTA_PROBES",
        holdUntil: state.quota.redundantProbeHoldUntil,
      }),
    );
  } else if (
    process.env.QUEUE2_FORCE_QUOTA_PROBE === "1" ||
    runtime.morningSummaryPending ||
    quotaProbeDue(state, started)
  ) {
    state.sessionQuota = state.sessionQuota || createEmptySessionQuota();
    // Active ledger must already exist from process-start beginNewClRequestSession.
    // Never revive a stale persisted ledger mid-cycle.
    if (
      !state.clRequestLedger ||
      (state.clSessionProcessNonce && state.clRequestLedger.processStartNonce !== state.clSessionProcessNonce)
    ) {
      const reset = beginNewClRequestSession(state, {
        workerId: WORKER_ID,
        processStartNonce: PROCESS_NONCE,
        workerFingerprint: runtime.codeFingerprint,
        reason: "missing_or_mismatched_active_session",
        now: started,
      });
      state = reset.state;
    }
    state.clRequestLedger.canaryRequired = state.canaryMode === "CANARY_REQUIRED";
    if (runtime.codeFingerprint) state.clRequestLedger.workerFingerprint = runtime.codeFingerprint;

    const consBeforeProbe = evaluateClConservationGate(state.clRequestLedger, {
      canaryRequired: state.canaryMode === "CANARY_REQUIRED",
    });
    if (!consBeforeProbe.allow) {
      state = setReview(state, consBeforeProbe.reason, consBeforeProbe.detail || consBeforeProbe.reason);
      emit("HUMAN_REVIEW_REQUIRED", {
        lane: "HUMAN_REVIEW_REQUIRED",
        reason: consBeforeProbe.reason,
        court: state.laneA.court,
        checkpoint: state.laneA.checkpoint,
      });
      console.log(
        JSON.stringify({
          tag: "QUOTA_CHECK",
          skipped: true,
          reason: consBeforeProbe.reason,
          detail: consBeforeProbe.detail,
        }),
      );
    } else {
      const cacheDecision = evaluateQuotaProbeCache(state.quotaProbeCache, {
        now: started,
        force: process.env.QUEUE2_FORCE_QUOTA_PROBE === "1",
        reason: runtime.morningSummaryPending ? "cycle" : "scheduled",
        invalidateReason: state.quota?.hard429Count > 0 && state.quota?.last429At ? null : null,
      });
      // Prefer reuse when cache is fresh — even if morningSummaryPending / scheduled.
      if (
        cacheDecision.reuse &&
        cacheDecision.probe === false &&
        process.env.QUEUE2_FORCE_QUOTA_PROBE !== "1" &&
        state.quota?.windows
      ) {
        state.clRequestLedger = applyQuotaProbeCacheDecision(state.clRequestLedger, {
          ...cacheDecision,
          preventedRedundant: true,
        });
        state.sessionQuota.quotaProbeReuseCount =
          Number(state.sessionQuota.quotaProbeReuseCount || 0) + 1;
        state.sessionQuota.redundantQuotaProbesPrevented =
          Number(state.sessionQuota.redundantQuotaProbesPrevented || 0) + 1;
        console.log(
          JSON.stringify({
            tag: "QUOTA_CHECK",
            skipped: true,
            reason: "PROBE_CACHE_REUSE",
            cacheReason: cacheDecision.reason,
            reuseCount: state.sessionQuota.quotaProbeReuseCount,
            prevented: state.sessionQuota.redundantQuotaProbesPrevented,
          }),
        );
        // Re-decide lane from cached windows without a fresh CL HTTP call.
        const windows = state.quota.windows;
        const targets = computeSafetyTargets(windows);
        const safe = computeSafeRequests(windows, targets, 0);
        quota = {
          probed: false,
          reused: true,
          safeRequests: safe.safe,
          windows,
          targets,
          safe,
          membership: state.quota.membership || null,
          confidence: state.quota.quotaStateConfidence || QUOTA_CONFIDENCE.AUTHORITATIVE,
          source: "probe_cache",
        };
        const decision = decideLane(state, {
          safeRequests: safe.safe,
          windows,
          projectedUsefulAt: state.quota.wait?.nextUsefulAt || state.quota.nextCheckAt,
          now: started,
        });
        if (decision.lane === "A" && !decision.needsHumanReview) {
          state.currentLane = "A";
        } else if (decision.lane === "WAIT") {
          state.currentLane = "WAIT";
        } else {
          state.currentLane = "B";
        }
        if (runtime.morningSummaryPending) {
          const pending = runtime.morningSummaryPending;
          runtime.morningSummaryPending = null;
          console.log(
            formatMorningStartupSummary({
              preflight: pending.preflight,
              canary: pending.canary,
              workerVersion: pending.workerVersion,
              partial: `${state.laneA?.jurisdiction || state.laneA?.court || "?"} ${state.laneA?.count || 0}/${state.laneA?.target || "?"}`,
              quota: `safe=${safe.safe} (cached)`,
              lane: statusLaneFromState(state),
              nextTarget: state.laneA?.court || "n/a",
              watchdog: state.humanReview?.required ? "HUMAN_REVIEW" : "HEALTHY",
            }),
          );
        }
      } else {
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
    // Per-request accounting: quota probe is overhead (never secrets).
    {
      const rec = recordClRequest(state.clRequestLedger, {
        purpose: CL_REQUEST_PURPOSES.QUOTA_PROBE,
        court: state.laneA?.court,
        jurisdiction: state.laneA?.jurisdiction,
        httpOutcome: probe.status === 0 && probe.parsed ? 200 : probe.status,
        usefulProgress: false,
        batchId: "quota-probe",
        workerFingerprint: runtime.codeFingerprint,
        now: started,
      });
      state.clRequestLedger = rec.ledger;
      state.sessionQuota = updateSessionQuotaAccounting(state.sessionQuota, {
        sessionClRequestDelta: 1,
        probe: true,
        rollingDayObservedUsed: probe.parsed?.limits?.day
          ? Number(probe.parsed.limits.day.limit) - Number(probe.parsed.limits.day.remaining)
          : state.quota?.windows?.day?.used,
        rollingDayRemaining: probe.parsed?.limits?.day?.remaining ?? state.quota?.windows?.day?.remaining,
      });
    }
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
        // Fresh authoritative probe → cache for reuse (TTL in conservation module).
        state.quotaProbeCache = {
          observedAt: started.toISOString(),
          minuteRemaining: windows.minute?.remaining,
          hourRemaining: windows.hour?.remaining,
          dayRemaining: windows.day?.remaining,
          safeRequests: safe.safe,
          had429: Boolean(state.quota?.last429At),
          resetOccurred: false,
          countersMateriallyChanged: false,
        };
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
        const remainingCases = remainingCasesToFinish(state.laneA);
        const remainingRequestsEstimate = remainingRequestsToFinishCourt(state.laneA);
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
            remainingCases,
            estimatedRequestsNeeded: decision.estimatedRequestsNeeded ?? remainingRequestsEstimate,
            requestsPerAuthorityEstimate: decision.requestsPerAuthorityEstimate,
            nextUsefulAt: decision.nextUsefulAt,
            lane: state.currentLane,
            nextCheckAt: state.quota.nextCheckAt,
            checkpoint: state.laneA.checkpoint,
            confidence: reconciled.quotaStateConfidence,
            dayRemaining: windows.day?.remaining,
            minuteRemaining: windows.minute?.remaining,
            hourRemaining: windows.hour?.remaining,
          }),
        );
        // Track probe signatures for redundant-probe watchdog.
        state.quotaProbeHistory = Array.isArray(state.quotaProbeHistory) ? state.quotaProbeHistory : [];
        const lastProbe = state.quotaProbeHistory[state.quotaProbeHistory.length - 1];
        const workBetween = Boolean(
          state.laneARunnerStartedAt &&
            lastProbe?.at &&
            new Date(state.laneARunnerStartedAt).getTime() > new Date(lastProbe.at).getTime(),
        );
        state.quotaProbeHistory.push({
          at: started.toISOString(),
          minuteRemaining: windows.minute?.remaining,
          hourRemaining: windows.hour?.remaining,
          dayRemaining: windows.day?.remaining,
          quotaMode: decision.quotaMode,
          checkpoint: state.laneA.checkpoint,
          workBetween,
        });
        if (state.quotaProbeHistory.length > 12) {
          state.quotaProbeHistory = state.quotaProbeHistory.slice(-12);
        }
        const redundant = detectRedundantQuotaProbes(state.quotaProbeHistory, { minRepeats: 3 });
        const redundantHard = evaluateRedundantQuotaProbeHardStop(state.quotaProbeHistory, {
          minRepeats: 3,
        });
        if (redundantHard.hardStop || redundant.redundant) {
          emit("WATCHDOG_WARNING", {
            lane: statusLaneFromState(state),
            court: state.laneA.court,
            checkpoint: state.laneA.checkpoint,
            reason: CONSERVATION_REASONS.REDUNDANT_QUOTA_PROBES,
            extra: { count: redundant.count || redundantHard.count, signature: redundant.signature },
          });
          state.quota.redundantProbeHoldUntil = nextQuotaCheckAfterActiveBatch(started, {
            deferMs: 30 * 60 * 1000,
            noProgress: true,
          });
          state.quota.nextCheckAt = state.quota.redundantProbeHoldUntil;
          state.metrics = state.metrics || {};
          state.metrics.redundantQuotaProbes = Number(state.metrics.redundantQuotaProbes || 0) + 1;
          console.log(
            JSON.stringify({
              tag: "WATCHDOG_WARNING",
              reason: CONSERVATION_REASONS.REDUNDANT_QUOTA_PROBES,
              holdUntil: state.quota.redundantProbeHoldUntil,
              hardStop: Boolean(redundantHard.hardStop),
            }),
          );
          if (redundantHard.hardStop) {
            state = setReview(
              state,
              HUMAN_REVIEW_REASONS.REDUNDANT_QUOTA_PROBES,
              `redundant quota probes count=${redundantHard.count}`,
            );
          }
        }
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
      } // end fresh-probe (cache miss) branch
    } // end conservation-allow branch
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
    // Stale idleSafe from a prior cycle must not survive into active Lane A.
    state.idleSafe = false;
    state.runtimeState = "RUNNING";
    state.laneASelectedAt = state.laneASelectedAt || started.toISOString();
    if (
      !state.clRequestLedger ||
      state.clRequestLedger.processStartNonce !== PROCESS_NONCE
    ) {
      const reset = beginNewClRequestSession(state, {
        workerId: WORKER_ID,
        processStartNonce: PROCESS_NONCE,
        workerFingerprint: runtime.codeFingerprint,
        reason: "lane_a_session_guard",
        now: started,
      });
      state = reset.state;
    }
    state.clRequestLedger.canaryRequired = state.canaryMode === "CANARY_REQUIRED";
    const consBeforeLaneA = evaluateClConservationGate(state.clRequestLedger, {
      canaryRequired: state.canaryMode === "CANARY_REQUIRED",
    });
    if (!consBeforeLaneA.allow) {
      state = setReview(
        state,
        consBeforeLaneA.reason,
        consBeforeLaneA.detail || consBeforeLaneA.reason,
      );
      human = true;
      emit("HUMAN_REVIEW_REQUIRED", {
        lane: "HUMAN_REVIEW_REQUIRED",
        court: state.laneA.court,
        checkpoint: state.laneA.checkpoint,
        reason: consBeforeLaneA.reason,
      });
      console.log(
        JSON.stringify({
          tag: "LANE_A_CL",
          blocked: true,
          reason: consBeforeLaneA.reason,
          detail: consBeforeLaneA.detail,
        }),
      );
    } else if (isMissingDurableResumeCheckpointFatal(state.laneA)) {
      state = setReview(
        state,
        HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT,
        "refusing Lane A resume without durable checkpoint",
      );
      human = true;
      emit("HUMAN_REVIEW_REQUIRED", {
        lane: "HUMAN_REVIEW_REQUIRED",
        court: state.laneA.court,
        reason: HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT,
      });
    } else {
      const launchGate = mayLaunchLaneAChild(state, {
        processAlive: process.env.QUEUE2_MOCK_LANE_A_CHILD_ALIVE === "1",
        aliveOverride:
          process.env.QUEUE2_MOCK_LANE_A_CHILD_ALIVE === "0"
            ? false
            : process.env.QUEUE2_MOCK_LANE_A_CHILD_ALIVE === "1"
              ? true
              : undefined,
      });
      if (!launchGate.ok) {
        console.log(
          JSON.stringify({
            tag: "LANE_A_SINGLE_FLIGHT",
            blocked: true,
            reason: launchGate.reason,
            pid: launchGate.pid,
            court: launchGate.court,
          }),
        );
        state.currentLane = "A";
        state.runtimeState = "LANE_A_RUNNING";
        state.idleSafe = false;
        // Do not spawn; do not Lane B; do not zero-progress.
      } else {
      const lock = acquireLaneALock(state, "dual-lane-runner", started);
      if (!lock.ok) {
        console.log(JSON.stringify({ tag: "LANE_A_CL", blocked: true, reason: lock.reason }));
        state.currentLane = "B";
      } else {
        state = lock.state;
        const initialStart = isReadyFirstStartLaneA(state.laneA) || !state.laneA.checkpoint;
        emit("LANE_A_START", {
          lane: "LANE_A_CL",
          court: state.laneA.court,
          checkpoint: state.laneA.checkpoint,
          reason: initialStart ? "initial_start" : "resume",
        });
        emit("LANE_A_RUNNER_START", {
          lane: "LANE_A_CL",
          court: state.laneA.court,
          checkpoint: state.laneA.checkpoint,
          task: "cl_ingest",
          reason: initialStart ? "initial_start" : "resume",
        });
        state.laneARunnerStartedAt = new Date().toISOString();
        state.sessionQuota = state.sessionQuota || createEmptySessionQuota();
        try {
          const priorCheckpoint = state.laneA.checkpoint;
          const priorCount = Number(state.laneA.count) || 0;
          const canaryMaxCl =
            state.canaryMode === "CANARY_REQUIRED"
              ? Math.min(
                  CANARY_MAX_SESSION_CL_REQUESTS,
                  Number(state.canary?.maxClRequests || CANARY_MAX_SESSION_CL_REQUESTS),
                )
              : Number(state.canary?.maxClRequests || 12);
          const batchBounds = resolveLaneABatchBounds({
            canaryRequired: state.canaryMode === "CANARY_REQUIRED",
            maxQualifyingAuthorities: Number(state.canary?.maxQualifyingAuthorities || 3),
            maxClRequests: canaryMaxCl,
            remainingAuthorities: remainingCasesToFinish(state.laneA),
            usableRequests:
              Number(state.quota?.lastPlan?.microBatchMaxRequests) ||
              Number(quota.safeRequests) ||
              0,
            requestsPerAuthorityEstimate:
              Number(state.quota?.lastPlan?.requestsPerAuthorityEstimate) || 2.3,
            resourceMaxAuthorities: 8,
            resourceMaxClRequests: 40,
            checkpoint: state.laneA.checkpoint,
          });
          console.log(
            JSON.stringify({
              tag: "LANE_A_BATCH_BOUNDS",
              court: state.laneA.court,
              authorities: batchBounds.authorities,
              maxClRequests: batchBounds.maxClRequests,
              initialStart: batchBounds.initialStart,
              canaryRequired: state.canaryMode === "CANARY_REQUIRED",
            }),
          );
          state.clSharedSession = createSharedClSession({
            sessionId: state.clRequestLedger?.sessionId || state.sessionQuota?.sessionId,
            batchId: `lane-a-${state.laneA.court}-${Date.now()}`,
            maxClRequests: batchBounds.maxClRequests,
            alreadyUsed: Number(state.sessionQuota?.sessionClRequests) || 0,
            historicalJobApiCallsBaseline: state.sessionQuota?.historicalJobApiCallsBaseline || 0,
            workerFingerprint: runtime.codeFingerprint,
          });
          const raw = runLaneA(state, {
            runner: process.env.QUEUE2_MOCK_LANE_A_RUNNER === "1" ? runtime.mockLaneARunner : null,
            batchSize: batchBounds.batchSize,
            maxClRequests: remainingChildClBudget(state.clSharedSession),
            sharedSession: state.clSharedSession,
          });
          const classified = classifyLaneABatchResult({
            stdout: raw?.stdout || "",
            priorCheckpoint,
            priorCount,
            target: state.laneA.target,
          });

          // Persist single-flight child ownership from STARTED / pid.
          if (classified.pid || classified.lifecycleState === LANE_A_RUNNER_STATES.STARTED) {
            state.laneAChild = createLaneAChildRecord({
              pid: classified.pid,
              court: state.laneA.court,
              workerId: WORKER_ID,
              codeFingerprint: runtime.codeFingerprint,
              expectedMaxAuthorities: batchBounds.authorities,
              expectedMaxClRequests: batchBounds.maxClRequests,
              now: new Date(state.laneARunnerStartedAt),
            });
            state.laneAChild.lifecycleState = classified.lifecycleState;
            state.runtimeState = "LANE_A_RUNNING";
            state.currentLane = "A";
            state.idleSafe = false;
          }

          // NON-TERMINAL: do not reconcile as zero-progress / canary fail / count fail.
          if (classified.nonTerminal || classified.terminal === false) {
            console.log(
              JSON.stringify({
                tag: "LANE_A_CHILD_NON_TERMINAL",
                lifecycleState: classified.lifecycleState,
                pid: classified.pid,
                terminal: false,
                zeroProgress: false,
              }),
            );
            emit("LANE_A_RUNNER_START", {
              lane: "LANE_A_RUNNING",
              court: state.laneA.court,
              checkpoint: state.laneA.checkpoint,
              reason: classified.lifecycleState,
              extra: { pid: classified.pid, terminal: false },
            });
            laneAResult = {
              classified,
              nonTerminal: true,
              liveDb: null,
              postRunDbRefreshed: false,
            };
            // Skip terminal classification path entirely.
          } else {
          const runnerTerminalAt = new Date().toISOString();
          state = markLaneAChildTerminal(state, {
            lifecycleState: classified.lifecycleState,
            now: runnerTerminalAt,
            exitCode: raw?.statusCode,
          });

          // Post-run live DB refresh — must be AFTER terminal; reject stale cache.
          let liveDb = null;
          if (typeof runtime.fetchLiveLaneACourtCounts === "function") {
            liveDb = runtime.fetchLiveLaneACourtCounts({
              court: state.laneA.court,
              after: runnerTerminalAt,
            }) || null;
          }
          if (!liveDb) {
            liveDb = queryLiveLaneACourtCounts(state.laneA.court, {
              query: process.env.QUEUE2_MOCK_LANE_A_DB === "1" ? runtime.mockLaneADbQuery : null,
              after: runnerTerminalAt,
              requireFresh: true,
            });
          }
          // Stamp query time if probe omitted it (injected mocks).
          if (liveDb && !liveDb.generatedAt && !liveDb.dbEvidenceObservedAt && !liveDb.observedAt) {
            liveDb = {
              ...liveDb,
              generatedAt: new Date().toISOString(),
              dbEvidenceObservedAt: new Date().toISOString(),
            };
          }
          const freshness = isFreshPostRunDbEvidence({
            liveDb,
            dbEvidenceObservedAt: liveDb?.generatedAt || liveDb?.observedAt || liveDb?.dbEvidenceObservedAt,
            runnerTerminalAt,
            laneARunnerStartedAt: state.laneARunnerStartedAt,
          });
          if (!freshness.ok) {
            liveDb = null; // refuse stale cached evidence labeled as post-run
          }

          // Session request accounting — merge child sessionApiCalls into parent identity.
          const sessionDelta = Number(classified.sessionApiCalls || 0) || 0;
          const parentBeforeChild = Number(state.sessionQuota?.sessionClRequests) || 0;
          const desync = assertChildWithinSessionBudget({
            maxClRequests: state.clSharedSession?.maxClRequests || CANARY_MAX_SESSION_CL_REQUESTS,
            childSessionApiCalls: sessionDelta,
            parentSessionClRequests: parentBeforeChild,
          });
          if (!desync.ok) {
            console.log(JSON.stringify({ tag: "CL_SESSION_BUDGET", ...desync }));
            if (desync.reason === "CHILD_EXCEEDED_SESSION_BUDGET") {
              state = setReview(
                state,
                HUMAN_REVIEW_REASONS.CL_DEBUG_QUOTA_BUDGET_EXCEEDED || "CL_DEBUG_QUOTA_BUDGET_EXCEEDED",
                `childSessionApiCalls=${sessionDelta} exceeded max=${desync.max}`,
              );
              human = true;
            }
          }
          state.sessionQuota = mergeChildSessionAccounting(state.sessionQuota, {
            sessionApiCalls: sessionDelta,
            historicalJobApiCalls: classified.historicalJobApiCalls,
            sessionId: state.clSharedSession?.sessionId,
            batchId: state.clSharedSession?.batchId,
            productive: classified.productive,
          });
          state.sessionQuota = updateSessionQuotaAccounting(state.sessionQuota, {
            historicalJobApiCalls: classified.historicalJobApiCalls,
            rollingDayObservedUsed: state.quota?.windows?.day?.used,
            rollingDayRemaining: state.quota?.windows?.day?.remaining,
          });
          if (sessionDelta > 0 && state.clRequestLedger) {
            let ledger = state.clRequestLedger;
            const purpose = classified.productive
              ? CL_REQUEST_PURPOSES.INGEST_FETCH
              : CL_REQUEST_PURPOSES.INGEST_DISCOVERY;
            for (let i = 0; i < Math.min(sessionDelta, 40); i++) {
              const rec = recordClRequest(ledger, {
                purpose: i === 0 ? purpose : CL_REQUEST_PURPOSES.INGEST_FETCH,
                court: state.laneA.court,
                jurisdiction: state.laneA.jurisdiction,
                httpOutcome: 200,
                usefulProgress: Boolean(classified.productive),
                authoritiesAdded: i === 0 && classified.productive ? Number(classified.runnerBatchImported) || 0 : 0,
                checkpointAdvanced: i === 0 && Boolean(classified.checkpointAdvanced),
                batchId: state.clSharedSession?.batchId || classified.jobId || "lane-a-batch",
                runId: state.clSharedSession?.sessionId || null,
                workerFingerprint: runtime.codeFingerprint,
              });
              ledger = rec.ledger;
            }
            state.clRequestLedger = ledger;
          }

          const manifest = loadManifestForSelection();
          const manifestRow = (manifest.targets || []).find(
            (t) => (t.preferredCourts || [])[0] === state.laneA.court || t.jurisdiction === state.laneA.jurisdiction,
          );
          const reconciled = reconcileLaneACountSources({
            runtimeCount: priorCount,
            statusCount: Number(runtime.lastStatus?.currentCount),
            manifestCount: Number(manifestRow?.currentCases),
            runnerCount: classified.runnerBatchImported,
            runnerBatchImported: classified.runnerBatchImported,
            existingJobItemsImported: classified.existingJobItemsImported,
            alreadyCompleted: classified.alreadyCompleted,
            staleRunningGuard: classified.staleRunningGuard,
            existingJob: classified.existingJob,
            requireLiveDb: Boolean(
              classified.staleRunningGuard ||
                classified.existingJob ||
                state.canaryMode === "CANARY_REQUIRED",
            ),
            target: state.laneA.target,
            db: liveDb
              ? {
                  qualifyingCases: liveDb.qualifyingCases ?? liveDb.highCourtClCases ?? liveDb.clCases,
                  highCourtClCases: liveDb.highCourtClCases,
                  clCases: liveDb.clCases,
                  cases: liveDb.cases,
                }
              : {},
            integrity: liveDb?.integrity || {
              duplicateSourceIds: 0,
              orphanCount: 0,
              chunkHealthy: true,
            },
          });
          reconciled.freshDbReconciled = Boolean(freshness.ok && liveDb);
          reconciled.jobRowRefreshed = Boolean(classified.existingJob || classified.status);
          reconciled.dbEvidenceObservedAt = freshness.dbEvidenceObservedAt || null;
          reconciled.runnerTerminalAt = runnerTerminalAt;

          if (!freshness.ok && (classified.staleRunningGuard || state.canaryMode === "CANARY_REQUIRED")) {
            state = setReview(
              state,
              HUMAN_REVIEW_REASONS.LIVE_DB_RECONCILIATION_UNAVAILABLE,
              freshness.reason || "stale_or_missing_post_run_db_evidence",
            );
            human = true;
            state.idleSafe = false;
            laneAResult = {
              classified,
              reconciled: {
                ...reconciled,
                classification: "LIVE_DB_RECONCILIATION_UNAVAILABLE",
                humanReviewRequired: true,
              },
              liveDb: null,
              postRunDbRefreshed: false,
            };
          } else {
          // Existing job / stale_running_guard: adopt durable resume — do not treat as count failure.
          if (classified.staleRunningGuard || reconciled.classification === "STALE_RUNNING_GUARD") {
            const staleRec = reconcileStaleRunningGuard({
              state,
              job: classified.existingJob,
              classified,
              liveDb: liveDb
                ? {
                    qualifyingCases: liveDb.qualifyingCases ?? liveDb.highCourtClCases ?? liveDb.clCases ?? liveDb.cases,
                    highCourtClCases: liveDb.highCourtClCases,
                    clCases: liveDb.clCases,
                    cases: liveDb.cases,
                  }
                : null,
              ownerAlive: false,
              processAlive: false,
              cursorValid: true,
              mappingStatus: state.laneA.mappingStatus || "VERIFIED",
              now: new Date(),
            });
            if (staleRec.classification === "LIVE_DB_RECONCILIATION_UNAVAILABLE") {
              state = setReview(
                state,
                HUMAN_REVIEW_REASONS.LIVE_DB_RECONCILIATION_UNAVAILABLE,
                staleRec.detail || staleRec.reason,
              );
              human = true;
              state.idleSafe = false;
              emit("HUMAN_REVIEW_REQUIRED", {
                lane: "HUMAN_REVIEW_REQUIRED",
                court: state.laneA.court,
                reason: HUMAN_REVIEW_REASONS.LIVE_DB_RECONCILIATION_UNAVAILABLE,
              });
            } else if (!staleRec.ok) {
              const reviewReason =
                staleRec.reason === "MISSING_DURABLE_RESUME_CHECKPOINT" ||
                staleRec.classification === JOB_CLASSIFICATIONS.STALE_NONRESUMABLE
                  ? HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT
                  : HUMAN_REVIEW_REASONS.CORRUPT_INCONSISTENT_INGEST_JOB;
              state = setReview(state, reviewReason, staleRec.detail || staleRec.reason);
              human = true;
              state.idleSafe = false;
            } else {
              state = staleRec.state;
              state.canaryMode = "CANARY_REQUIRED";
              state.canary = {
                ...(state.canary || {}),
                required: true,
                maxQualifyingAuthorities: 3,
                maxClRequests: CANARY_MAX_SESSION_CL_REQUESTS,
                resumeFromExistingJob: true,
                resumeFrom: staleRec.resumeFrom,
              };
              emit("CHECKPOINT", {
                lane: "LANE_A_CL",
                court: state.laneA.court,
                checkpoint: state.laneA.checkpoint,
                reason: "existing_job_reconciled",
                extra: {
                  jobClassification: staleRec.jobClassification,
                  cursor: state.laneA.cursor,
                  existingJobItemsImported: staleRec.existingJobItemsImported,
                  canonicalDbCount: staleRec.canonicalDbCount,
                  runnerBatchImported: 0,
                },
              });
              console.log(
                JSON.stringify({
                  tag: "EXISTING_JOB_RECONCILED",
                  court: state.laneA.court,
                  classification: staleRec.jobClassification,
                  targetStatus: state.laneA.targetStatus,
                  checkpoint: state.laneA.checkpoint,
                  cursor: state.laneA.cursor,
                  count: state.laneA.count,
                  existingJobItemsImported: staleRec.existingJobItemsImported,
                  canonicalDbCount: staleRec.canonicalDbCount,
                }),
              );
            }
            laneAResult = {
              classified,
              reconciled: { ...reconciled, ...staleRec, classification: staleRec.classification },
              liveDb,
              staleRunningReconciled: true,
              postRunDbRefreshed: Boolean(freshness.ok),
            };
          } else if (reconciled.classification === "LIVE_DB_RECONCILIATION_UNAVAILABLE") {
            state = setReview(
              state,
              HUMAN_REVIEW_REASONS.LIVE_DB_RECONCILIATION_UNAVAILABLE,
              reconciled.detail || reconciled.reason,
            );
            human = true;
            state.idleSafe = false;
            emit("HUMAN_REVIEW_REQUIRED", {
              lane: "HUMAN_REVIEW_REQUIRED",
              court: state.laneA.court,
              reason: HUMAN_REVIEW_REASONS.LIVE_DB_RECONCILIATION_UNAVAILABLE,
            });
            laneAResult = { classified, reconciled, liveDb };
          } else {
            emit("LANE_A_COUNT_RECONCILED", {
              lane: "LANE_A_CL",
              court: state.laneA.court,
              checkpoint: state.laneA.checkpoint,
              reason: reconciled.reason,
              extra: {
                canonicalCount: reconciled.canonicalCount,
                classification: reconciled.classification,
                targetSatisfied: reconciled.targetSatisfied,
                dbPresent: Boolean(liveDb),
                runnerBatchImported: classified.runnerBatchImported,
                existingJobItemsImported: classified.existingJobItemsImported,
              },
            });
            laneAResult = {
              ...(classified.parsed?.result || {}),
              classified,
              reconciled,
              liveDb,
              stdoutSource: classified.parsed?.source,
              postRunDbRefreshed: true,
            };
            emit("LANE_A_BATCH_COMPLETE", {
              lane: "LANE_A_CL",
              court: state.laneA.court,
              checkpoint: classified.nextCheckpoint || state.laneA.checkpoint,
              reason: classified.reason || classified.status || "batch",
              extra: {
                apiCalls: classified.apiCalls,
                productive: classified.productive,
                noProgress: classified.noProgress,
                remainingCases: remainingCasesToFinish(state.laneA),
                canonicalCount: reconciled.canonicalCount,
                classification: reconciled.classification,
              },
            });

            if (reconciled.classification === "RECONCILIATION_FAILED" || reconciled.humanReviewRequired) {
            state = setReview(
              state,
              HUMAN_REVIEW_REASONS.LANE_A_COUNT_RECONCILIATION_FAILED,
              reconciled.detail || reconciled.reason || "Lane A count reconciliation failed",
            );
            human = true;
            state.idleSafe = false;
            emit("HUMAN_REVIEW_REQUIRED", {
              lane: "HUMAN_REVIEW_REQUIRED",
              court: state.laneA.court,
              reason: HUMAN_REVIEW_REASONS.LANE_A_COUNT_RECONCILIATION_FAILED,
            });
          } else if (reconciled.classification === "TARGET_ALREADY_COMPLETE") {
            emit("TARGET_ALREADY_COMPLETE", {
              lane: "LANE_A_CL",
              court: state.laneA.court,
              checkpoint: state.laneA.checkpoint,
              reason: "already_completed_db_confirmed",
              extra: { canonicalCount: reconciled.canonicalCount, target: state.laneA.target },
            });
            const nextTarget = selectNextVerifiedIncompleteTarget(manifest, {
              excludeCourt: state.laneA.court,
            });
            const completedCourt = state.laneA.court;
            state = applyTargetAlreadyComplete(state, {
              canonicalCount: reconciled.canonicalCount,
              target: state.laneA.target,
              checkpoint: state.laneA.checkpoint,
              nextTarget,
              now: new Date(),
            });
            const canaryEval = evaluateReconciliationCanary({
              canaryRequired: state.canaryMode === "CANARY_REQUIRED",
              reconciled,
            });
            state.canary = {
              ...(state.canary || {}),
              reconciliationCanary: canaryEval.reconciliationCanary || null,
              requireTinyRealCanaryOnNextTarget: Boolean(canaryEval.requireTinyRealCanaryOnNextTarget),
              mode: canaryEval.mode,
            };
            // Do not promote to NORMAL solely from zero-call already_completed.
            if (canaryEval.requireTinyRealCanaryOnNextTarget) {
              state.canaryMode = "CANARY_REQUIRED";
            }
            state.quota.nextCheckAt = nextQuotaCheckAfterActiveBatch(new Date(), {
              batchComplete: true,
              productive: true,
            });
            state.idleSafe = false;
            state.laneASelectedAt = null;
            console.log(
              JSON.stringify({
                tag: "TARGET_ALREADY_COMPLETE",
                completedCourt,
                canonicalCount: reconciled.canonicalCount,
                nextCourt: nextTarget?.court || null,
                nextCount: nextTarget?.count ?? null,
                nextTarget: nextTarget?.target ?? null,
                canary: canaryEval,
              }),
            );
          } else if (
            shouldRaiseLaneAZeroProgress({
              classified,
              reconciled,
              freshDbReconciled: Boolean(reconciled.freshDbReconciled),
              jobRowRefreshed: Boolean(reconciled.jobRowRefreshed),
              currentBatchRequestCount: classified.sessionApiCalls ?? classified.apiCalls ?? 0,
            })
          ) {
            emit("LANE_A_NO_PROGRESS", {
              lane: "LANE_A_CL",
              court: state.laneA.court,
              checkpoint: state.laneA.checkpoint,
              reason: classified.reason || "zero_progress",
              extra: {
                apiCalls: classified.apiCalls,
                itemsImported: classified.itemsImported,
                remoteStatus: classified.status,
                canonicalCount: reconciled.canonicalCount,
              },
            });
            state = setReview(
              state,
              HUMAN_REVIEW_REASONS.LANE_A_ZERO_PROGRESS,
              `Lane A runner returned no progress (reason=${classified.reason || classified.status || "unknown"}); local ${state.laneA.count}/${state.laneA.target} checkpoint=${state.laneA.checkpoint}`,
            );
            human = true;
            state.quota.nextCheckAt = nextQuotaCheckAfterActiveBatch(new Date(), { noProgress: true });
            state.idleSafe = false;
          } else if (classified.status === "quota_paused" || classified.status === "rate_limited") {
            state = applyQuotaFloorTransition(state, {
              safeRequests: 0,
              checkpoint: classified.nextCheckpoint || state.laneA.checkpoint,
              lastSuccessfulExternalId:
                classified.nextCheckpoint || state.laneA.lastSuccessfulExternalId,
              cursor: classified.nextCheckpoint || state.laneA.cursor,
              nextPageUrl: laneAResult?.next_page_url || state.laneA.nextPageUrl,
              count: reconciled.canonicalCount ?? state.laneA.count,
              target: state.laneA.target,
              last429At: classified.status === "rate_limited" ? new Date().toISOString() : null,
              retryAfterSeconds: laneAResult?.lastRetryAfterSec || laneAResult?.retryAfterSeconds || null,
              now: new Date(),
            });
            if (classified.status === "rate_limited") {
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
              reason: classified.status,
            });
          } else if (classified.productive || (reconciled.canonicalCount != null && reconciled.canonicalCount > priorCount)) {
            // Persist progress from runner and/or live DB refresh.
            if (classified.checkpointAdvanced) {
              state.laneA.checkpoint = classified.nextCheckpoint;
              state.laneA.lastSuccessfulExternalId = classified.nextCheckpoint;
              state.laneA.cursor = classified.nextCheckpoint;
            }
            if (reconciled.canonicalCount != null) {
              state.laneA.count = reconciled.canonicalCount;
            } else if (classified.countAdvanced) {
              state.laneA.count = classified.itemsImported;
            }
            state.laneA.lastSuccessfulAt = new Date().toISOString();
            state.quota.nextCheckAt = nextQuotaCheckAfterActiveBatch(new Date(), {
              batchComplete: true,
              productive: true,
            });
            state.idleSafe = false;
            state.laneASelectedAt = null;
            if (state.canaryMode === "CANARY_REQUIRED" && runtime.codeFingerprint && classified.apiCalls > 0) {
              const knownGoodOut = {
                codeFingerprint: runtime.codeFingerprint,
                workerVersion: WORKER_VERSION,
                promotedAt: new Date().toISOString(),
                court: state.laneA.court,
                count: state.laneA.count,
                target: state.laneA.target,
                checkpoint: state.laneA.checkpoint,
                reason: "production_mutation_canary_pass",
              };
              fs.writeFileSync(
                path.join(reports, "queue2-watchdog-known-good.json"),
                JSON.stringify(knownGoodOut, null, 2),
              );
              state.canaryMode = "NORMAL";
              state.canary = { ...(state.canary || {}), required: false, status: "PASS" };
              emit("CANARY_SKIPPED", {
                lane: "LANE_A_CL",
                reason: "canary_pass_promoted_known_good",
                extra: { codeFingerprint: runtime.codeFingerprint },
              });
            }
          }
          } // end freshness-ok / terminal reconcile branches
          } // end non-terminal else (terminal path)
          } // end launchGate.ok + lock try body scope marker
        } finally {
          const rel = releaseLaneALock(state, "dual-lane-runner", new Date());
          if (rel.ok) state = rel.state;
        }
      } // end lock.ok
      } // end launchGate.ok
    }
  } else if (state.currentLane === "A" && quota.safeRequests < 1) {
    // Selected A but no usable quota — do not pretend Lane B idle without an explicit floor transition.
    console.log(
      JSON.stringify({
        tag: "LANE_A_CL",
        blocked: true,
        reason: "usable_requests_exhausted",
        safeRequests: quota.safeRequests,
      }),
    );
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
      // Never paint healthy-idle while human review is required.
      state.idleSafe = false;
      emit("ERROR", { lane: "LANE_B_OFFLINE", reason: String(e.message || e).slice(0, 200) });
    }
  }

  const health = healthCheck();
  // IMPORTANT: do not name this `runtime` — that shadows the module-level runtime
  // and puts earlier references (morningSummaryPending, etc.) into the TDZ.
  const derivedRuntime = deriveRuntimeState({
    humanReviewRequired: Boolean(state.humanReview?.required),
    processAlive: true,
    waitingForNetwork: Boolean(state.waitingForNetwork),
    idleSafe: Boolean(state.idleSafe),
    lastHeartbeatAt: state.lastHeartbeatAt,
  });
  state.runtimeState = derivedRuntime.runtimeState;
  const status = publishStatus(state, {
    currentLane: state.humanReview?.required
      ? "HUMAN_REVIEW_REQUIRED"
      : state.currentLane === "A"
        ? "LANE_A_CL"
        : state.idleSafe
          ? "LANE_B_IDLE_SAFE"
          : statusLaneFromState(state),
    runtimeState: derivedRuntime.runtimeState,
    freshness: derivedRuntime.freshness,
    currentTask: state.humanReview?.required
      ? "await_human_review"
      : state.currentLane === "A"
        ? "cl_ingest"
        : state.idleSafe
          ? "NONE"
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
      idleSafe: Boolean(state.idleSafe) && !state.humanReview?.required,
      humanReviewRequired: Boolean(state.humanReview?.required),
      humanReviewReasons: state.humanReview?.reasons || [],
      humanReviewReason: (state.humanReview?.reasons || [])[0] || null,
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

  // End-of-cycle CL request accounting (session ≠ rolling-day used).
  {
    const ledger =
      state.clRequestLedger ||
      createEmptyClRequestLedger({
        rollingDayObservedUsed: state.quota?.windows?.day?.used ?? state.sessionQuota?.rollingDayObservedUsed,
        rollingDayRemaining: state.quota?.windows?.day?.remaining ?? state.sessionQuota?.rollingDayRemaining,
        existingJobHistoricalRequests:
          state.sessionQuota?.existingJobHistoricalRequests ??
          state.sessionQuota?.historicalJobApiCallsBaseline ??
          0,
      });
    if (state.quota?.windows?.day) {
      ledger.rollingDayObservedUsed = state.quota.windows.day.used;
      ledger.rollingDayRemaining = state.quota.windows.day.remaining;
    }
    console.log(formatClRequestAccountingLine(ledger));
    console.log(formatRollingDayObservedLine(ledger));
    console.log(
      JSON.stringify({
        tag: "CL_REQUEST_ACCOUNTING",
        sessionId: ledger.sessionId,
        session: ledger.currentSessionRequests,
        productive: ledger.productiveClRequests,
        overhead: ledger.overheadClRequests,
        wasted: ledger.wastedClRequests,
        quotaProbes: ledger.quotaProbeRequests,
        retries: ledger.retryRequests,
        authoritiesAdded: ledger.authoritiesAdded,
        checkpointAdvanced: ledger.checkpointAdvances > 0,
        sequentialNonproductiveBeforeProgress: ledger.sequentialNonproductiveBeforeProgress,
        existingJobHistoricalRequests: ledger.existingJobHistoricalRequests,
        historicalSessions: Array.isArray(state.historicalClSessions)
          ? state.historicalClSessions.length
          : 0,
        rollingDayUsed: ledger.rollingDayObservedUsed,
        rollingDayRemaining: ledger.rollingDayRemaining,
        note: "session_requests_are_not_rolling_day_used",
      }),
    );
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

  // NEW WORKER PROCESS ⇒ NEW CL SESSION. Never inherit prior streak/counters.
  {
    const mustReset =
      shouldResetClSessionForNewWorker(state, {
        workerId: WORKER_ID,
        processStartNonce: PROCESS_NONCE,
        force: true,
      }) || true;
    if (mustReset) {
      const reset = beginNewClRequestSession(state, {
        workerId: WORKER_ID,
        processStartNonce: PROCESS_NONCE,
        workerFingerprint: runtime.codeFingerprint || null,
        reason: "new_worker_process",
        now: started,
        canaryRequired: state.canaryMode === "CANARY_REQUIRED",
      });
      state = reset.state;
      console.log(
        JSON.stringify({
          tag: "CL_SESSION_RESET",
          sessionId: reset.sessionId,
          priorSessionId: reset.priorSessionId,
          archivedCount: reset.archivedCount,
          currentSessionRequests: reset.currentSessionRequests,
          streak: reset.streak,
          workerId: WORKER_ID,
          processStartNonce: PROCESS_NONCE,
        }),
      );
      saveLocalState(state);
    }
  }

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
  // Do NOT treat queue2-worker-versions.json as known-good — that file tracks current
  // fingerprints and would make canary always NOT_REQUIRED after any write.
  const canaryGate = evaluateProductionCanaryGate({
    currentFingerprint: startedFingerprint,
    knownGoodFingerprint: knownGood?.codeFingerprint || knownGood?.fingerprint || null,
  });
  const canaryNeeded = canaryGate.required;
  // Morning summary deferred until AFTER fresh quota reconciliation (not stale persisted quota).
  runtime.morningSummaryPending = {
    preflight: "PASS",
    canary: canaryNeeded ? "REQUIRED" : "PASS",
    workerVersion: WORKER_VERSION,
    canaryReason: canaryGate.reason,
  };
  if (canaryNeeded) {
    emit("CANARY_REQUIRED", {
      lane: "STARTUP",
      reason: canaryGate.reason,
      extra: { currentFingerprint: startedFingerprint, prior: canaryGate.prior || null },
    });
    state.canaryMode = "CANARY_REQUIRED";
    state.canary = { required: true, reason: canaryGate.reason, maxQualifyingAuthorities: 3, maxClRequests: 12 };
  } else {
    emit("CANARY_SKIPPED", { lane: "STARTUP", reason: canaryGate.reason });
    state.canaryMode = "NORMAL";
  }
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
  // Immutable session metadata is separate from mutable runtime lane/quota state.
  const sessionNow = new Date();
  const session = initWatchdogSession({
    workerId: WORKER_ID,
    pid: process.pid,
    processStartNonce: PROCESS_NONCE,
    now: sessionNow,
  });
  runtime.session = session;
  state.watchdogSession = session;
  state.lastHeartbeatAt = session.lastHeartbeatAt;
  emit("WATCHDOG_SESSION_INIT", {
    lane: "STARTUP",
    task: "boot",
    court: state.laneA?.court,
    checkpoint: state.laneA?.checkpoint,
    extra: {
      workerId: WORKER_ID,
      pid: process.pid,
      processStartNonce: PROCESS_NONCE,
      startedAt: session.startedAt,
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
  // Use STARTUP lane label so we never print misleading LANE_B_IDLE_SAFE before
  // fresh quota reconciliation / lane selection.
  {
    const bootStatus = {
      currentLane: "STARTUP",
      currentTask: "boot",
      runtimeState: "STARTUP",
      currentCourt: state.laneA?.court,
      checkpoint: state.laneA?.checkpoint,
      today: {},
      corpus: null,
      health: null,
    };
    state = maybeHeartbeat(state, bootStatus, { force: true });
    emit("INITIAL_HEARTBEAT", {
      lane: "STARTUP",
      task: "boot",
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

  // Checkpoint hardening: never leave an active CL partial with null resume position.
  // READY first-start (baseline corpus count, no CL resume metadata) is valid.
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
  } else if (isMissingDurableResumeCheckpointFatal(state.laneA)) {
    state = setReview(
      state,
      HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT,
      "partial CL target without durable resume after reconcile attempt",
    );
    emit("HUMAN_REVIEW_REQUIRED", {
      lane: "HUMAN_REVIEW_REQUIRED",
      court: state.laneA.court,
      reason: HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT,
    });
  } else if (
    state.humanReview?.required &&
    Array.isArray(state.humanReview.reasons) &&
    state.humanReview.reasons.length === 1 &&
    state.humanReview.reasons[0] === HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT &&
    isReadyFirstStartLaneA(state.laneA)
  ) {
    // Clear stale false-positive from prior poisoned runs (READY first-start).
    state.humanReview = { required: false, reasons: [], details: [] };
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

    const classifiedNoProgress = Boolean(lastCycle?.laneAResult?.classified?.noProgress);
    const sleepFor = computePostCycleSleepMs({
      now: new Date(),
      humanReviewRequired: Boolean(state.humanReview?.required),
      noProgress: classifiedNoProgress,
      lane: state.currentLane,
      quotaMode: state.quota?.lastPlan?.quotaMode || state.quota?.wait?.quotaMode,
      nextUsefulAt: state.quota?.wait?.nextUsefulAt || null,
      nextCheckAt: state.quota?.nextCheckAt || null,
      heartbeatMs: HEARTBEAT_MS,
      awaitingBatch: false,
    });
    if (sleepFor <= 0) {
      console.log(
        JSON.stringify({
          tag: state.currentLane === "A" ? "LANE_A_CONTINUE" : "CYCLE_CONTINUE",
          sleepMs: 0,
          lane: state.currentLane,
          aiCalls: 0,
        }),
      );
      continue;
    }
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
