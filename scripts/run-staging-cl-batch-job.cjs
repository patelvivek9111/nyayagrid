/**
 * Run one CourtListener short-batch job on Fly staging — ATTACHED / SUPERVISED.
 *
 * FORBIDDEN (caused PPID=1 orphans):
 *   detached:true, child.unref(), nohup, background &
 *
 * The remote batch process remains a child of the fly-exec owner node until
 * terminal. Local spawnSync blocks until that remote owner exits.
 *
 * Usage: node scripts/run-staging-cl-batch-job.cjs <sha> <clCourt> [batchSize] [targetMax]
 */
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  LANE_A_REMOTE_COMMAND,
  parseRemoteLaneAProcesses,
  evaluateLaneAProcessGate,
  assertLauncherForbidsDetach,
} = require("./queue2-lane-a-remote-child.cjs");

const sha = process.argv[2] || "HEAD";
const clCourt = (process.argv[3] || "").toLowerCase();
const batchSize = String(Math.min(Math.max(Number.parseInt(process.argv[4] || "5", 10) || 5, 1), 25));
const targetMax = String(Math.min(Math.max(Number.parseInt(process.argv[5] || "20", 10) || 20, 1), 200));
const dayTargetEnv = process.env.CL_DAY_TARGET || "";
const hourTargetEnv = process.env.CL_HOUR_TARGET || "";
const dateFiledLteEnv = process.env.CL_DATE_FILED_LTE || "";
const dateFiledGteEnv = process.env.CL_DATE_FILED_GTE || "";
const orderByEnv = process.env.CL_ORDER_BY || "";
const maxSessionCallsEnv = process.env.CL_MAX_SESSION_CALLS || "";
const sessionIdEnv = process.env.CL_SESSION_ID || "";
const batchIdEnv = process.env.CL_BATCH_ID || "";
const bootstrapUsageEnv = process.env.CL_BOOTSTRAP_USAGE || "0";
const historicalBaselineEnv = process.env.CL_HISTORICAL_API_CALLS_BASELINE || "";
const workerIdEnv = process.env.QUEUE2_WORKER_ID || process.env.CL_WORKER_ID || "";
const processNonceEnv = process.env.QUEUE2_PROCESS_START_NONCE || process.env.CL_PROCESS_START_NONCE || "";
const MACHINE = "811d3e3f522648";
const APP = "nyayagrid-staging";
const root = path.join(__dirname, "..");
const localBundled = path.join(__dirname, "staging-cl-batch-job-bundled.cjs");
const remotePath = "/tmp/staging-cl-batch-job-bundled.cjs";
const CHUNK = 8_000;
const FLY_EXEC_TIMEOUT_SEC = Math.min(
  540,
  Number(process.env.CL_FLY_EXEC_TIMEOUT_SEC) || 540,
);

// Self-check: runtime spawn must never reintroduce detach (comments excluded).
{
  const self = fs
    .readFileSync(__filename, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "");
  const check = assertLauncherForbidsDetach(self);
  if (!check.ok) {
    console.log(JSON.stringify({ ok: false, reason: "LAUNCHER_DETACH_FORBIDDEN", violations: check.violations }));
    process.exit(2);
  }
}

if (!clCourt || !/^[a-z0-9_-]+$/i.test(clCourt)) {
  console.log(JSON.stringify({ ok: false, reason: "clCourt required" }));
  process.exit(2);
}

function fly(cmd, timeout = 120) {
  return spawnSync(
    "flyctl",
    ["machine", "exec", MACHINE, "-a", APP, "--timeout", String(timeout), cmd],
    { encoding: "utf8", maxBuffer: 16_000_000 },
  );
}

function sleep(ms) {
  spawnSync(process.execPath, [
    "-e",
    `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${ms})`,
  ]);
}

function listRemoteLaneAProcesses() {
  const r = fly(`ps -o pid,ppid,args`, 60);
  const text = (r.stdout || "") + (r.stderr || "");
  return parseRemoteLaneAProcesses(text);
}

function uploadLocalBundled() {
  if (!fs.existsSync(localBundled)) {
    console.log(JSON.stringify({ ok: false, reason: "missing_local_bundled", path: localBundled }));
    process.exit(1);
  }
  const b64 = fs.readFileSync(localBundled).toString("base64");
  for (let i = 0; i < b64.length; i += CHUNK) {
    const part = b64.slice(i, i + CHUNK);
    const cmd =
      i === 0
        ? `node -e "require('fs').writeFileSync('${remotePath}',Buffer.from('${part}','base64'))"`
        : `node -e "require('fs').appendFileSync('${remotePath}',Buffer.from('${part}','base64'))"`;
    const w = fly(cmd, 90);
    if (w.status !== 0) {
      console.log(
        JSON.stringify({
          ok: false,
          step: "upload",
          chunk: Math.floor(i / CHUNK),
          err: (w.stderr || w.stdout || "").slice(0, 400),
        }),
      );
      process.exit(1);
    }
  }
  console.log(
    JSON.stringify({
      uploaded: true,
      bytes: fs.statSync(localBundled).size,
      sha,
      source: "local_bundled",
      command: LANE_A_REMOTE_COMMAND,
      detached: false,
    }),
  );
}

function killRemotePid(pid, signal) {
  const r = fly(
    `node -e "try{process.kill(${Number(pid)},'${signal}');console.log(JSON.stringify({ok:true,pid:${Number(pid)},signal:'${signal}'}))}catch(e){console.log(JSON.stringify({ok:false,pid:${Number(pid)},err:String(e.message||e)}))}"`,
    30,
  );
  return (r.stdout || "").trim();
}

// Cleanup-only mode for supervisor abort (no CL work).
if (process.env.QUEUE2_LANE_A_CLEANUP_PID) {
  const pid = Number(process.env.QUEUE2_LANE_A_CLEANUP_PID);
  const expectCmd = process.env.QUEUE2_LANE_A_CLEANUP_COMMAND || LANE_A_REMOTE_COMMAND;
  const procs = listRemoteLaneAProcesses();
  const hit = procs.find((p) => Number(p.pid) === pid && p.args.includes(expectCmd));
  if (!hit) {
    console.log(JSON.stringify({ ok: true, cleaned: false, reason: "pid_not_found_or_identity_mismatch", pid, procs }));
    process.exit(0);
  }
  console.log(killRemotePid(pid, "SIGTERM"));
  sleep(8_000);
  const still = listRemoteLaneAProcesses().find((p) => Number(p.pid) === pid);
  if (still) console.log(killRemotePid(pid, "SIGKILL"));
  const final = listRemoteLaneAProcesses().filter((p) => Number(p.pid) === pid);
  console.log(JSON.stringify({ ok: true, cleaned: final.length === 0, pid, remaining: final.length }));
  process.exit(final.length === 0 ? 0 : 1);
}

// ensure machine up
spawnSync("flyctl", ["machine", "start", MACHINE, "-a", APP], { encoding: "utf8" });
sleep(2_000);

// Pre-launch process gate (zero CL).
{
  let ownership = null;
  if (process.env.QUEUE2_LANE_A_CHILD_JSON) {
    try {
      ownership = JSON.parse(process.env.QUEUE2_LANE_A_CHILD_JSON);
    } catch {
      ownership = null;
    }
  }
  const procs = listRemoteLaneAProcesses();
  const gate = evaluateLaneAProcessGate({ processes: procs, laneAChild: ownership });
  console.log(JSON.stringify({ tag: "LANE_A_PROCESS_GATE", ...gate, courtListenerHttpCalls: 0 }));
  if (gate.emergencyStop || !gate.allowLaunch) {
    console.log(
      JSON.stringify({
        ok: false,
        reason: gate.reason,
        humanReviewRequired: gate.humanReviewRequired,
        count: gate.count,
        started: false,
        courtListenerHttpCalls: 0,
      }),
    );
    process.exit(gate.emergencyStop ? 3 : 1);
  }
}

uploadLocalBundled();

// Require session identity for Queue #2 autonomous launches.
if (process.env.QUEUE2_REQUIRE_CL_LEDGER === "1" || sessionIdEnv || batchIdEnv || maxSessionCallsEnv) {
  if (!sessionIdEnv || !batchIdEnv) {
    console.log(
      JSON.stringify({
        ok: false,
        reason: "LANE_A_CHILD_NO_SESSION",
        detail: "CL_SESSION_ID and CL_BATCH_ID required for supervised Lane A child",
        courtListenerHttpCalls: 0,
      }),
    );
    process.exit(2);
  }
  if (maxSessionCallsEnv !== "" && Number(maxSessionCallsEnv) <= 0) {
    console.log(JSON.stringify({ ok: false, reason: "LANE_A_CHILD_NO_BUDGET", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
}

/**
 * ATTACHED owner: fly exec runs a node supervisor that:
 *  - spawns the batch job with detached:false (never unref)
 *  - writes /tmp/cl-batch-owner.json identity
 *  - waits for child exit
 *  - forwards SIGTERM/SIGINT to the child
 * Local spawnSync blocks until this remote owner exits → no fire-and-forget.
 */
const ownerJs = `
const fs=require('fs');
const {spawn}=require('child_process');
try{fs.unlinkSync('/tmp/cl-batch-result.json')}catch(e){}
const out=fs.openSync('/tmp/cl-batch.log','w');
const err=fs.openSync('/tmp/cl-batch.err','w');
const env={...process.env,CL_COURT:${JSON.stringify(clCourt)},CL_BATCH_SIZE:${JSON.stringify(batchSize)},CL_TARGET_MAX:${JSON.stringify(targetMax)},CL_RATE_MS:process.env.CL_RATE_MS||'2200',CL_BOOTSTRAP_USAGE:${JSON.stringify(bootstrapUsageEnv || "0")},CL_PROOF:'0'${dayTargetEnv ? `,CL_DAY_TARGET:${JSON.stringify(dayTargetEnv)}` : ""}${hourTargetEnv ? `,CL_HOUR_TARGET:${JSON.stringify(hourTargetEnv)}` : ""}${dateFiledLteEnv ? `,CL_DATE_FILED_LTE:${JSON.stringify(dateFiledLteEnv)}` : ""}${dateFiledGteEnv ? `,CL_DATE_FILED_GTE:${JSON.stringify(dateFiledGteEnv)}` : ""}${orderByEnv ? `,CL_ORDER_BY:${JSON.stringify(orderByEnv)}` : ""}${maxSessionCallsEnv ? `,CL_MAX_SESSION_CALLS:${JSON.stringify(maxSessionCallsEnv)}` : ""}${sessionIdEnv ? `,CL_SESSION_ID:${JSON.stringify(sessionIdEnv)}` : ""}${batchIdEnv ? `,CL_BATCH_ID:${JSON.stringify(batchIdEnv)}` : ""}${historicalBaselineEnv ? `,CL_HISTORICAL_API_CALLS_BASELINE:${JSON.stringify(historicalBaselineEnv)}` : ""}${workerIdEnv ? `,CL_WORKER_ID:${JSON.stringify(workerIdEnv)}` : ""}${processNonceEnv ? `,CL_PROCESS_START_NONCE:${JSON.stringify(processNonceEnv)}` : ""}};
const child=spawn(process.execPath,[${JSON.stringify(remotePath)}],{detached:false,stdio:['ignore',out,err],env});
const owner={ok:true,started:true,pid:child.pid,ppid:process.pid,clCourt:${JSON.stringify(clCourt)},batchSize:${Number(batchSize)},targetMax:${Number(targetMax)},sessionId:${JSON.stringify(sessionIdEnv || null)},batchId:${JSON.stringify(batchIdEnv || null)},workerId:${JSON.stringify(workerIdEnv || null)},processStartNonce:${JSON.stringify(processNonceEnv || null)},command:${JSON.stringify(LANE_A_REMOTE_COMMAND)},detached:false,supervised:true,startedAt:new Date().toISOString()};
fs.writeFileSync('/tmp/cl-batch-owner.json',JSON.stringify(owner));
fs.writeFileSync('/tmp/cl-batch-status.json',JSON.stringify({status:'running',...owner}));
console.log(JSON.stringify(owner));
function shutdown(sig){try{child.kill('SIGTERM')}catch(e){} setTimeout(()=>{try{child.kill('SIGKILL')}catch(e){}},8000);}
process.on('SIGTERM',()=>shutdown('SIGTERM'));
process.on('SIGINT',()=>shutdown('SIGINT'));
child.on('exit',(code,signal)=>{
  let fileResult=null;
  try{if(fs.existsSync('/tmp/cl-batch-result.json'))fileResult=JSON.parse(fs.readFileSync('/tmp/cl-batch-result.json','utf8'));}catch(e){}
  if(!fileResult){try{const lines=fs.readFileSync('/tmp/cl-batch.log','utf8').trim().split(/\\n/).filter(Boolean); if(lines.length)fileResult=JSON.parse(lines[lines.length-1]);}catch(e){}}
  const done={...owner,terminal:true,exitCode:code,signal:signal||null,fileResult,finishedAt:new Date().toISOString()};
  try{fs.writeFileSync('/tmp/cl-batch-owner.json',JSON.stringify(done));}catch(e){}
  console.log(JSON.stringify({ok:code===0||(fileResult&&fileResult.ok!==false),pid:child.pid,exitCode:code,signal:signal||null,fileResult,sessionApiCalls:fileResult&&fileResult.sessionApiCalls,status:fileResult&&fileResult.status,reason:fileResult&&fileResult.reason,job:fileResult&&fileResult.job,supervised:true,detached:false}));
  process.exit(code==null?1:code);
});
`;

// flyctl on Windows strips backslashes in `node -e` source (`\n` becomes `n`).
// Write the attached owner as base64, then exec the file. Still detached:false.
const ownerRemote = "/tmp/cl-batch-owner.cjs";
const ownerB64 = Buffer.from(ownerJs, "utf8").toString("base64");
{
  const w = fly(
    `node -e "require('fs').writeFileSync('${ownerRemote}',Buffer.from('${ownerB64}','base64'))"`,
    90,
  );
  if (w.status !== 0) {
    console.log(
      JSON.stringify({
        ok: false,
        step: "upload_owner",
        err: (w.stderr || w.stdout || "").slice(0, 400),
        courtListenerHttpCalls: 0,
      }),
    );
    process.exit(1);
  }
}
const run = fly(`node ${ownerRemote}`, FLY_EXEC_TIMEOUT_SEC);
process.stdout.write(run.stdout || "");
if (run.stderr) process.stderr.write(String(run.stderr).slice(0, 800));

// After supervised run, confirm no orphan left for this command.
{
  const leftover = listRemoteLaneAProcesses();
  if (leftover.length > 0) {
    console.log(
      JSON.stringify({
        ok: false,
        reason: "LANE_A_CHILD_SURVIVED_PARENT",
        leftover,
        courtListenerHttpCalls: 0,
      }),
    );
    process.exit(1);
  }
}

process.exit(run.status ?? 1);
