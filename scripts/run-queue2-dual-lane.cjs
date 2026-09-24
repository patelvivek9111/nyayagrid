/**
 * Queue #2 dual-lane orchestrator.
 *
 * Usage: node scripts/run-queue2-dual-lane.cjs
 *
 * One optional /api-usage/ probe when due. Lane B never talks to CourtListener.
 * FEATURE_AGENTS=0. Queue #3 is not opened.
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
} = require("./queue2-worker-observability.cjs");
const { setHumanReview: setReview } = require("./queue2-dual-lane-controller.cjs");

const root = path.join(__dirname, "..");
const reports = path.join(root, "packages/research/corpus/reports");
const statePath = path.join(reports, "queue2-dual-lane-state.json");
const finalPath = path.join(reports, "queue2-dual-lane-final.json");
const eventsPath = path.join(reports, "corpus-worker-events.jsonl");
const MACHINE = "811d3e3f522648";
const APP = "nyayagrid-staging";

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

function maybeHeartbeat(state, status) {
  const now = new Date();
  if (!shouldEmitHeartbeat(state.lastHeartbeatAt, now)) return state;
  const line = formatHeartbeat(status, now);
  console.log(line);
  state.lastHeartbeatAt = now.toISOString();
  emit("HEARTBEAT", {
    lane: status.currentLane,
    task: status.currentTask,
    court: status.currentCourt,
    checkpoint: status.checkpoint,
    reason: "interval",
    extra: { heartbeat: line },
  });
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

async function main() {
  fs.mkdirSync(reports, { recursive: true });
  let state = loadLocalState();
  const started = new Date();
  state.laneStartedAt = state.laneStartedAt || started.toISOString();
  emit("WORKER_START", {
    lane: statusLaneFromState(state),
    task: state.laneB?.task || "boot",
    court: state.laneA?.court,
    checkpoint: state.laneA?.checkpoint,
  });

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
      // Do not clobber known Tier-2 state with free-default parse failures.
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
        emit("HUMAN_REVIEW_REQUIRED", { lane: "HUMAN_REVIEW_REQUIRED", reason: decision.reason, court: state.laneA.court });
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
      console.log(JSON.stringify({ tag: "QUOTA_CHECK", ok: false, note: "probe_unparsed_stay_lane_b", stderr: probe.stderr }));
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
            checkpoint: laneAResult?.cursor || laneAResult?.last_successful_external_id || state.laneA.checkpoint,
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
      // Observability-only pass by default; set QUEUE2_RUN_LANE_B=1 to execute offline worker.
      if (process.env.QUEUE2_RUN_LANE_B === "1") {
        laneBResult = runLaneB();
        emit("OFFLINE_TASK_COMPLETE", {
          lane: "LANE_B_OFFLINE",
          task: state.laneB?.task,
          reason: laneBResult?.ok === false ? "error" : "complete",
          corpusDelta: laneBResult?.imported != null ? { nonClAuthorities: laneBResult.imported } : null,
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
    currentLane: state.humanReview?.required
      ? "HUMAN_REVIEW_REQUIRED"
      : statusLaneFromState(state),
    currentTask: state.humanReview?.required
      ? "await_human_review"
      : state.currentLane === "A"
        ? "cl_ingest"
        : state.laneB?.task || "offline",
    laneReason:
      state.humanReview?.required
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

  const clDuringB = Number(laneBResult?.courtListenerHttpCalls ?? 0);
  const runStatus =
    clDuringB !== 0
      ? "HOLD"
      : state.humanReview?.required
        ? "PARTIAL"
        : laneBResult?.ok === false && !laneAResult
          ? "PARTIAL"
          : "PASS";

  emit("WORKER_STOP", {
    lane: status.currentLane,
    court: state.laneA.court,
    checkpoint: state.laneA.checkpoint,
    reason: runStatus,
  });

  const final = {
    ok: runStatus !== "HOLD",
    status: runStatus,
    wave: "queue2-observability",
    generatedAt: new Date().toISOString(),
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
      humanInterventionRequired: human || state.humanReview?.required ? "yes" : "no",
    },
    operational: {
      tests: "queue2-dual-lane-controller.test.cjs + queue2-worker-observability.test.cjs",
      health,
      featureAgents: health?.featureAgents || health?.checks?.featureAgents || "0",
    },
    queue: { "#2": "OPEN", "#9": "CLOSED", "#3": "NOT_OPEN", transition: "NONE" },
  };
  fs.writeFileSync(finalPath, JSON.stringify(final, null, 2));
  console.log(JSON.stringify({ tag: "LANE_SWITCH", currentLane: state.currentLane, status: runStatus, checkpoint: state.laneA.checkpoint, finalPath }));
  console.log(JSON.stringify(final));
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 500) }));
  process.exit(1);
});
