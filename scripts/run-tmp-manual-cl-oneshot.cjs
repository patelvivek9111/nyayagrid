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

const deadline = Date.now() + 8 * 60 * 1000;
let still = true;
while (Date.now() < deadline) {
  const ps = flyPs();
  const body = `${ps.stdout || ""}\n${ps.stderr || ""}`;
  still = /staging-cl-batch-job-bundled/.test(body);
  if (!still) break;
  spawnSync(process.execPath, ["-e", "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,15000)"]);
}
const result = spawnSync(
  "flyctl",
  ["machine", "exec", "811d3e3f522648", "-a", "nyayagrid-staging", "--timeout", "40", "cat /tmp/cl-batch-result.json"],
  { encoding: "utf8", maxBuffer: 4_000_000 },
);
process.stdout.write(`\n${result.stdout || ""}\n`);
fs.appendFileSync(outPath, `\n${result.stdout || ""}\n${result.stderr || ""}\n`);
process.exit(still ? 1 : 0);
