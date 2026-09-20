/**
 * Run one CourtListener short-batch job on Fly staging.
 * Uploads local bundled script (avoids waiting on GitHub raw).
 * Usage: node scripts/run-staging-cl-batch-job.cjs <sha> <clCourt> [batchSize] [targetMax]
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const sha = process.argv[2] || "HEAD";
const clCourt = (process.argv[3] || "").toLowerCase();
const batchSize = String(Math.min(Math.max(Number.parseInt(process.argv[4] || "5", 10) || 5, 1), 25));
const targetMax = String(Math.min(Math.max(Number.parseInt(process.argv[5] || "20", 10) || 20, 1), 200));
const MACHINE = "811d3e3f522648";
const APP = "nyayagrid-staging";
const root = path.join(__dirname, "..");
const localBundled = path.join(__dirname, "staging-cl-batch-job-bundled.cjs");
const remotePath = "/tmp/staging-cl-batch-job-bundled.cjs";
const CHUNK = 8_000;

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
    }),
  );
}

// ensure machine up
spawnSync("flyctl", ["machine", "start", MACHINE, "-a", APP], { encoding: "utf8" });
sleep(3_000);
uploadLocalBundled();

const start = fly(
  `node -e "const fs=require('fs');const {spawn}=require('child_process'); try{fs.unlinkSync('/tmp/cl-batch-result.json')}catch(e){} fs.writeFileSync('/tmp/cl-batch-status.json',JSON.stringify({status:'starting'}));const out=fs.openSync('/tmp/cl-batch.log','w');const err=fs.openSync('/tmp/cl-batch.err','w');const env={...process.env,CL_COURT:'${clCourt}',CL_BATCH_SIZE:'${batchSize}',CL_TARGET_MAX:'${targetMax}',CL_RATE_MS:process.env.CL_RATE_MS||'1500',CL_PROOF:'0'};const child=spawn(process.execPath,['${remotePath}'],{detached:true,stdio:['ignore',out,err],env});child.unref();console.log(JSON.stringify({ok:true,started:true,pid:child.pid,clCourt:'${clCourt}',batchSize:${batchSize},targetMax:${targetMax}}))"`,
  90,
);
process.stdout.write(start.stdout || "");
if (start.status !== 0) process.exit(start.status ?? 1);

const startedAtMs = Date.now();
const statusUrl = `https://raw.githubusercontent.com/patelvivek9111/nyayagrid/${sha}/scripts/staging-cl-job-status-bundled.cjs`;

for (let i = 0; i < 48; i++) {
  sleep(15_000);
  const poll = fly(
    `node -e "const fs=require('fs');let fileResult=null;if(fs.existsSync('/tmp/cl-batch-result.json')){try{fileResult=JSON.parse(fs.readFileSync('/tmp/cl-batch-result.json','utf8'))}catch(e){fileResult={parseError:true}}}else if(fs.existsSync('/tmp/cl-batch.log')){try{const lines=fs.readFileSync('/tmp/cl-batch.log','utf8').trim().split('\\n').filter(Boolean);if(lines.length)fileResult=JSON.parse(lines[lines.length-1])}catch(e){}}console.log(JSON.stringify({i:${i},fileResult,hasFile:Boolean(fileResult)}))"`,
    60,
  );
  const line = (poll.stdout || "").trim().split("\n").pop() || "{}";
  console.log(line);
  try {
    const p = JSON.parse(line);
    if (p.fileResult && p.fileResult.status) {
      const st = p.fileResult.status;
      if (st === "failed" && p.fileResult.ok === false) process.exit(1);
      process.exit(0);
    }
  } catch {
    // continue
  }

  if (i % 2 === 1) {
    const db = fly(
      `node -e "fetch('${statusUrl}').then(r=>r.text()).then(t=>{require('fs').writeFileSync('/tmp/cl-job-status.cjs',t); process.env.CL_COURT='${clCourt}'; const {spawnSync}=require('child_process'); const r=spawnSync('node',['/tmp/cl-job-status.cjs'],{encoding:'utf8',env:process.env}); process.stdout.write(r.stdout||'')})"`,
      90,
    );
    const dbLine = (db.stdout || "").trim().split("\n").pop() || "{}";
    console.log(dbLine);
    try {
      const j = JSON.parse(dbLine);
      const job = (j.jobs || [])[0];
      if (job) {
        const updated = job.updated_at ? Date.parse(job.updated_at) : 0;
        // Only trust DB terminal status if updated AFTER this run started (avoid stale pause race).
        const fresh = updated >= startedAtMs - 5_000;
        if (
          fresh &&
          (job.status === "paused" ||
            job.status === "completed" ||
            job.status === "rate_limited" ||
            job.status === "failed")
        ) {
          console.log(JSON.stringify({ ok: true, via: "db_checkpoint", job }));
          process.exit(job.status === "failed" ? 1 : 0);
        }
        // Stale running: no DB progress for 5+ minutes after start → stop poller.
        if (job.status === "running" && Date.now() - Math.max(updated, startedAtMs) > 300_000) {
          console.log(JSON.stringify({ ok: false, reason: "stale_running_guard", job }));
          process.exit(1);
        }
      }
    } catch {
      // continue
    }
  }
  if ((poll.stderr || "").includes("machine not running")) {
    spawnSync("flyctl", ["machine", "start", MACHINE, "-a", APP], { encoding: "utf8" });
    sleep(8_000);
  }
  // Keep-alive: prevent Fly autostop from killing detached CL workers mid-batch.
  fly(
    `node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(t=>console.log(JSON.stringify({keepAlive:true,ok:true}))).catch(e=>console.log(JSON.stringify({keepAlive:false,err:String(e.message||e)})))"`,
    30,
  );
}

console.log(JSON.stringify({ ok: false, reason: "poll_timeout" }));
process.exit(1);
