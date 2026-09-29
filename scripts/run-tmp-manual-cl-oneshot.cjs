/**
 * One-shot supervised CourtListener batch. Does not start queue2:worker.
 * Usage: node scripts/run-tmp-manual-cl-oneshot.cjs <clCourt> <batchSize> <targetMax> <maxCalls> <sessionTag>
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const clCourt = process.argv[2];
const batchSize = process.argv[3] || "5";
const targetMax = process.argv[4] || "45";
const maxCalls = process.argv[5] || "15";
const tag = process.argv[6] || `manual-${clCourt}`;
if (!clCourt) {
  console.log(JSON.stringify({ ok: false, reason: "clCourt required" }));
  process.exit(2);
}

const env = { ...process.env };
delete env.QUEUE2_WORKER_ID;
delete env.QUEUE2_PROCESS_START_NONCE;
delete env.QUEUE2_LANE_A_CHILD_JSON;
delete env.QUEUE2_REQUIRE_CL_LEDGER;
if (process.env.CL_KEEP_DATE_FILTER !== "1") {
  delete env.CL_DATE_FILED_LTE;
  delete env.CL_DATE_FILED_GTE;
}
env.CL_BOOTSTRAP_USAGE = "0";
env.CL_MAX_SESSION_CALLS = String(maxCalls);
env.CL_SESSION_ID = `manual-${tag}`;
env.CL_BATCH_ID = `manual-${clCourt}-${tag}`;
env.CL_MAX_RETRIES = "0";
env.CL_RATE_MS = process.env.CL_RATE_MS || "2200";
env.CL_FLY_EXEC_TIMEOUT_SEC = process.env.CL_FLY_EXEC_TIMEOUT_SEC || "540";
env.FEATURE_AGENTS = "0";

const outPath = path.join(
  __dirname,
  "..",
  "packages",
  "research",
  "corpus",
  "reports",
  `queue2-manual-${tag}.log`,
);
const r = spawnSync(
  process.execPath,
  [path.join(__dirname, "run-staging-cl-batch-job.cjs"), "HEAD", clCourt, batchSize, targetMax],
  { env, encoding: "utf8", maxBuffer: 20_000_000, cwd: path.join(__dirname, "..") },
);
const text = `${r.stdout || ""}\n${r.stderr || ""}`;
fs.writeFileSync(outPath, text);
process.stdout.write(r.stdout || "");
process.stderr.write((r.stderr || "").slice(0, 2000));

const disconnected = /408|LANE_A_CHILD_SURVIVED_PARENT/.test(text);
if (!disconnected) process.exit(r.status ?? 1);

function flyPs() {
  return spawnSync(
    "flyctl",
    ["machine", "exec", "811d3e3f522648", "-a", "nyayagrid-staging", "--timeout", "40", "ps -o pid,etime,args"],
    { encoding: "utf8", maxBuffer: 4_000_000 },
  );
}

function killRemoteBatch() {
  // Hard-kill stuck owner/child — Session 3: never leave owner alive after 408.
  const killJs = `
const {execSync}=require('child_process');
const kills=[];
try{
  const out=execSync('ps -o pid,args',{encoding:'utf8'});
  for(const line of out.split('\\n')){
    if(/cl-batch-owner|staging-cl-batch-job-bundled/.test(line)){
      const pid=Number(String(line).trim().split(/\\s+/)[0]);
      if(pid>1){ try{process.kill(pid,'SIGTERM'); kills.push(pid);}catch(e){kills.push('fail:'+pid);} }
    }
  }
}catch(e){}
console.log(JSON.stringify({ok:true,kills,status:'HIST_QUERY_TIMEOUT_OR_408_CLEANUP'}));
`;
  const b64 = Buffer.from(killJs, "utf8").toString("base64");
  spawnSync(
    "flyctl",
    [
      "machine",
      "exec",
      "811d3e3f522648",
      "-a",
      "nyayagrid-staging",
      "--timeout",
      "40",
      `node -e "eval(Buffer.from('${b64}','base64').toString('utf8'))"`,
    ],
    { encoding: "utf8", maxBuffer: 2_000_000 },
  );
}

// Short wait only — then kill. Do not sit for 8 minutes.
const maxWaitMs = Number(process.env.CL_ORPHAN_WAIT_MS || 90000);
const deadline = Date.now() + maxWaitMs;
let still = true;
while (Date.now() < deadline) {
  const ps = flyPs();
  const body = `${ps.stdout || ""}\n${ps.stderr || ""}`;
  still = /staging-cl-batch-job-bundled|cl-batch-owner/.test(body);
  if (!still) break;
  spawnSync(process.execPath, ["-e", "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10000)"]);
}
if (still) {
  killRemoteBatch();
  spawnSync(process.execPath, ["-e", "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,3000)"]);
  still = /staging-cl-batch-job-bundled|cl-batch-owner/.test(`${flyPs().stdout || ""}\n${flyPs().stderr || ""}`);
  console.log(
    JSON.stringify({
      ok: false,
      reason: "HIST_QUERY_TIMEOUT",
      phase: "FETCH_OR_INGEST",
      killedOrphan: true,
      stillAlive: still,
      courtListenerHttpCalls: 0,
    }),
  );
  fs.appendFileSync(outPath, `\nHIST_QUERY_TIMEOUT killed orphan stillAlive=${still}\n`);
  process.exit(1);
}
const result = spawnSync(
  "flyctl",
  ["machine", "exec", "811d3e3f522648", "-a", "nyayagrid-staging", "--timeout", "40", "cat /tmp/cl-batch-result.json"],
  { encoding: "utf8", maxBuffer: 4_000_000 },
);
process.stdout.write(`\n${result.stdout || ""}\n`);
fs.appendFileSync(outPath, `\n${result.stdout || ""}\n${result.stderr || ""}\n`);
process.exit(0);
