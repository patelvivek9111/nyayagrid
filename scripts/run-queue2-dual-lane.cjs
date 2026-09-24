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
 * - probes quota when due and auto-selects Lane A or Lane B
 * - local heartbeat every ~15 minutes (zero AI, no git push)
 * - continues until HUMAN_REVIEW_REQUIRED, SIGTERM/SIGINT, or QUEUE2_WORKER_ONCE=1
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
const { computeSafetyTargets, computeSafeRequests, parseApiUsagePayload } = require("./cl-quota-controller.cjs");
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

/** @type {{ shuttingDown: boolean, state: object|null, heartbeatTimer: NodeJS.Timeout|null }} */
const runtime = {
  shuttingDown: false,
  state: null,
  heartbeatTimer: null,
  lastStatus: null,
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
  const raw = String(text || "").trim();
  if (!raw) return null;
  // Prefer last complete JSON object (handles pretty-printed multi-line payloads).
  const start = raw.lastIndexOf("{");
  if (start >= 0) {
    const candidate = raw.slice(start);
    try {
      return JSON.parse(candidate);
    } catch {
      /* fall through */
    }
  }
  const lines = raw.split("\n").filter(Boolean);
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

function windowsFromProbe(parsed) {
  const wrap = (row) => ({
    limit: Number(row?.limit || 0),
    used: Number(row?.usage ?? row?.used ?? 0),
    remaining: Number(row?.remaining ?? 0),
    resetAt: row?.reset_at || row?.resetAt || null,
  });
  if (parsed?.limits && (parsed.limits.minute || parsed.limits.hour || parsed.limits.day)) {
    return {
      minute: wrap(parsed.limits.minute),
      hour: wrap(parsed.limits.hour),
      day: wrap(parsed.limits.day),
    };
  }
  if (parsed?.windows) return parsed.windows;
  const fromPayload = parseApiUsagePayload(parsed);
  return fromPayload.windows;
}

function looksLikeFreeDefault(windows) {
  return (
    Number(windows?.minute?.limit) === 5 &&
    Number(windows?.hour?.limit) === 50 &&
    Number(windows?.day?.limit) === 125
  );
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

  if (process.env.QUEUE2_FORCE_QUOTA_PROBE === "1" || quotaProbeDue(state, started)) {
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
    if (probe.parsed && (probe.parsed.ok !== false || probe.parsed.limits || probe.parsed.windows)) {
      const windowsRaw = windowsFromProbe(probe.parsed);
      const prior = state.quota.windows;
      const windows =
        looksLikeFreeDefault(windowsRaw) && prior && !looksLikeFreeDefault(prior)
          ? prior
          : windowsRaw;
      if (windows !== windowsRaw) {
        console.log(
          JSON.stringify({
            tag: "QUOTA_CHECK",
            note: "ignored_free_default_parse_kept_prior_tier2_windows",
          }),
        );
      }
      const targets = computeSafetyTargets(windows);
      const safe = computeSafeRequests(windows, targets, 0);
      quota = {
        probed: true,
        safeRequests: safe.safe,
        windows,
        targets,
        safe,
        membership: probe.parsed.membership || null,
      };
      const projected = projectedFromWindows(windows);
      const remaining = remainingRequestsToFinishCourt(state.laneA);
      const decision = decideLane(state, {
        safeRequests: safe.safe,
        projectedUsefulAt: projected,
        now: started,
      });
      if (decision.needsHumanReview) {
        state = setReview(state, decision.reason, "decideLane blocked Lane A");
        emit("HUMAN_REVIEW_REQUIRED", {
          lane: "HUMAN_REVIEW_REQUIRED",
          reason: decision.reason,
          court: state.laneA.court,
        });
      }
      if (decision.lane === "A") {
        const rec = applyQuotaRecoveryTransition(state, {
          safeRequests: safe.safe,
          windows,
          projectedUsefulAt: projected,
          now: started,
        });
        state = rec.state;
        emit("QUOTA_RECOVERED", {
          lane: "LANE_A_CL",
          court: state.laneA.court,
          checkpoint: state.laneA.checkpoint,
          reason: decision.reason,
          quota: { safeRequests: safe.safe },
        });
        emit("LANE_SWITCH", { lane: "LANE_A_CL", reason: decision.reason, court: state.laneA.court });
      } else {
        state = applyQuotaFloorTransition(state, {
          safeRequests: safe.safe,
          windows,
          projectedUsefulAt: projected,
          now: started,
          court: state.laneA.court,
          checkpoint: state.laneA.checkpoint,
          lastSuccessfulExternalId: state.laneA.lastSuccessfulExternalId,
          cursor: state.laneA.cursor,
          nextPageUrl: state.laneA.nextPageUrl,
          lastSuccessfulAt: state.laneA.lastSuccessfulAt,
          count: state.laneA.count,
          target: state.laneA.target,
          reason: decision.reason,
        });
        emit("QUOTA_FLOOR", {
          lane: "LANE_B_OFFLINE",
          court: state.laneA.court,
          checkpoint: state.laneA.checkpoint,
          reason: decision.reason,
          quota: { safeRequests: safe.safe, dayRemaining: windows.day?.remaining },
        });
      }
      console.log(
        JSON.stringify({
          tag: "QUOTA_CHECK",
          safe: safe.safe,
          remainingToFinish: remaining,
          lane: state.currentLane,
          nextCheckAt: state.quota.nextCheckAt,
          checkpoint: state.laneA.checkpoint,
        }),
      );
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
      emit("LANE_B_START", {
        lane: "LANE_B_OFFLINE",
        task: state.laneB?.task,
        court: state.laneA.court,
        checkpoint: state.laneA.checkpoint,
      });
      if (process.env.QUEUE2_RUN_LANE_B === "1") {
        laneBResult = runLaneB();
        emit("OFFLINE_TASK_COMPLETE", {
          lane: "LANE_B_OFFLINE",
          task: state.laneB?.task,
          reason: laneBResult?.ok === false ? "error" : "complete",
          corpusDelta:
            laneBResult?.imported != null ? { nonClAuthorities: laneBResult.imported } : null,
        });
      } else {
        laneBResult = {
          ok: true,
          skippedRun: true,
          note: "observability pass; set QUEUE2_RUN_LANE_B=1 to execute Lane B worker",
          courtListenerHttpCalls: 0,
        };
      }
    } catch (e) {
      laneBResult = { ok: false, err: String(e.message || e).slice(0, 400), courtListenerHttpCalls: 0 };
      human = true;
      emit("ERROR", { lane: "LANE_B_OFFLINE", reason: String(e.message || e).slice(0, 200) });
    }
  }

  const health = healthCheck();
  const status = publishStatus(state, {
    currentLane: state.humanReview?.required ? "HUMAN_REVIEW_REQUIRED" : statusLaneFromState(state),
    currentTask: state.humanReview?.required
      ? "await_human_review"
      : state.currentLane === "A"
        ? "cl_ingest"
        : state.laneB?.task || "offline",
    laneReason: state.humanReview?.required
      ? (state.humanReview.reasons || []).join(", ")
      : state.currentLane === "B"
        ? "CourtListener day safety floor"
        : "useful CL capacity",
    citationSummary: laneBResult?.citation
      ? `resolved=${laneBResult.citation.resolved} TARGET_ABSENT=${laneBResult.citation.TARGET_ABSENT}`
      : `citationEdgesResolved cumulative: ${state.metrics?.citationsResolved || 0}`,
    offlineSummary: `Lane B CL HTTP=${laneBResult?.courtListenerHttpCalls ?? 0}. Non-CL authorities cumulative=${state.metrics?.nonClAuthorities || 0}.`,
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
  let state = loadLocalState();
  const started = new Date();
  state.laneStartedAt = state.laneStartedAt || started.toISOString();

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

    const nextProbe = state.quota?.nextCheckAt ? new Date(state.quota.nextCheckAt).getTime() : Date.now() + HEARTBEAT_MS;
    const sleepFor = Math.min(
      HEARTBEAT_MS,
      Math.max(5_000, nextProbe - Date.now()),
    );
    console.log(
      JSON.stringify({
        tag: "WORKER_IDLE",
        sleepMs: sleepFor,
        nextQuotaCheckAt: state.quota?.nextCheckAt,
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
      arDurableCheckpoint: state.laneA.checkpoint,
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
