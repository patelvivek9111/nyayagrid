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
  acquireLaneALock,
  releaseLaneALock,
  quotaProbeDue,
  remainingRequestsToFinishCourt,
  LANE_A_SEQUENCE,
} = require("./queue2-dual-lane-controller.cjs");
const { computeSafetyTargets, computeSafeRequests, parseApiUsagePayload } = require("./cl-quota-controller.cjs");

const root = path.join(__dirname, "..");
const reports = path.join(root, "packages/research/corpus/reports");
const statePath = path.join(reports, "queue2-dual-lane-state.json");
const finalPath = path.join(reports, "queue2-dual-lane-final.json");
const MACHINE = "811d3e3f522648";
const APP = "nyayagrid-staging";

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
  const lines = String(text || "")
    .trim()
    .split("\n")
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      /* continue */
    }
  }
  try {
    return JSON.parse(String(text || ""));
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
  if (parsed?.windows) return parsed.windows;
  if (parsed?.limits) {
    return {
      minute: wrap(parsed.limits.minute),
      hour: wrap(parsed.limits.hour),
      day: wrap(parsed.limits.day),
    };
  }
  const fromPayload = parseApiUsagePayload(parsed);
  return fromPayload.windows;
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

async function main() {
  fs.mkdirSync(reports, { recursive: true });
  let state = loadLocalState();
  const started = new Date();
  let quota = {
    probed: false,
    safeRequests: Number(state.quota.lastSafeRequests || 0),
    windows: state.quota.windows,
  };

  if (process.env.QUEUE2_FORCE_QUOTA_PROBE === "1" || quotaProbeDue(state, started)) {
    const probe = runQuotaProbe();
    if (probe.parsed && (probe.parsed.ok !== false || probe.parsed.limits || probe.parsed.windows)) {
      const windows = windowsFromProbe(probe.parsed);
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
      if (decision.lane === "A") {
        const rec = applyQuotaRecoveryTransition(state, {
          safeRequests: safe.safe,
          windows,
          projectedUsefulAt: projected,
          now: started,
        });
        state = rec.state;
      } else {
        state = applyQuotaFloorTransition(state, {
          safeRequests: safe.safe,
          windows,
          projectedUsefulAt: projected,
          now: started,
          court: state.laneA.court,
          checkpoint: state.laneA.checkpoint,
          count: state.laneA.count,
          target: state.laneA.target,
          reason: decision.reason,
        });
      }
      console.log(
        JSON.stringify({
          tag: "QUOTA_CHECK",
          safe: safe.safe,
          remainingToFinish: remaining,
          lane: state.currentLane,
          nextCheckAt: state.quota.nextCheckAt,
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
        });
      }
    }
  }

  let laneAResult = null;
  let laneBResult = null;
  let human = false;

  if (state.currentLane === "A" && quota.safeRequests >= 1) {
    const lock = acquireLaneALock(state, "dual-lane-runner", started);
    if (!lock.ok) {
      console.log(JSON.stringify({ tag: "LANE_A_CL", blocked: true, reason: lock.reason }));
      state.currentLane = "B";
    } else {
      state = lock.state;
      try {
        laneAResult = runLaneA(state);
        const status = laneAResult?.status || laneAResult?.job?.status || laneAResult?.result?.status;
        if (status === "quota_paused" || status === "rate_limited") {
          state = applyQuotaFloorTransition(state, {
            safeRequests: 0,
            checkpoint: laneAResult?.cursor || laneAResult?.job?.cursor || state.laneA.checkpoint,
            count: laneAResult?.items_imported ?? laneAResult?.job?.items_imported ?? state.laneA.count,
            court: state.laneA.court,
            target: state.laneA.target,
            last429At: new Date().toISOString(),
            retryAfterSeconds: laneAResult?.lastRetryAfterSec || laneAResult?.retryAfterSeconds || null,
            now: new Date(),
          });
        }
      } finally {
        const rel = releaseLaneALock(state, "dual-lane-runner", new Date());
        if (rel.ok) state = rel.state;
      }
    }
  }

  if (state.currentLane === "B") {
    try {
      laneBResult = runLaneB();
    } catch (e) {
      laneBResult = { ok: false, err: String(e.message || e).slice(0, 400), courtListenerHttpCalls: 0 };
      human = true;
    }
  }

  const health = healthCheck();
  saveLocalState(state);

  const clDuringB = Number(laneBResult?.courtListenerHttpCalls ?? 0);
  const status =
    clDuringB !== 0
      ? "HOLD"
      : laneBResult?.ok === false && !laneAResult
        ? "PARTIAL"
        : "PASS";

  const final = {
    ok: status !== "HOLD",
    status,
    wave: "queue2-dual-lane",
    generatedAt: new Date().toISOString(),
    architecture: {
      dualLaneImplemented: true,
      schedulerPersisted: true,
      zeroIdleLogic: true,
    },
    courtListener: {
      laneBRequests: clDuringB,
      quotaProbeThisRun: Boolean(quota.probed),
      mustBeZeroExceptQuotaProbe: clDuringB === 0,
    },
    laneA: {
      currentCourt: state.laneA.court,
      checkpoint: state.laneA.checkpoint,
      target: state.laneA.target,
      count: state.laneA.count,
      nextResumeCondition: state.quota.nextCheckAt,
      result: laneAResult,
    },
    laneB: laneBResult,
    citation: laneBResult?.citation || null,
    coverage: laneBResult?.depth || null,
    automation: {
      nextQuotaProbe: state.quota.nextCheckAt,
      automaticLaneAResume: true,
      humanInterventionRequired: human ? "yes" : "no",
    },
    operational: {
      tests: "scripts/queue2-dual-lane-controller.test.cjs + adapters.test.ts us-reports/uscourts",
      health,
      featureAgents: health?.featureAgents || process.env.FEATURE_AGENTS || "0",
    },
    queue: { "#2": "OPEN", "#9": "CLOSED", "#3": "NOT_OPEN", transition: "NONE" },
  };
  fs.writeFileSync(finalPath, JSON.stringify(final, null, 2));
  console.log(JSON.stringify({ tag: "LANE_SWITCH", currentLane: state.currentLane, status, finalPath }));
  console.log(JSON.stringify(final));
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 500) }));
  process.exit(1);
});
