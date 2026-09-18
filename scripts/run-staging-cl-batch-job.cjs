/**
 * Run one CourtListener short-batch job on Fly staging.
 * Usage: node scripts/run-staging-cl-batch-job.cjs <sha> <clCourt> [batchSize] [targetMax]
 */
const { spawnSync } = require("node:child_process");

const sha = process.argv[2] || "HEAD";
const clCourt = (process.argv[3] || "").toLowerCase();
const batchSize = String(Math.min(Math.max(Number.parseInt(process.argv[4] || "5", 10) || 5, 1), 25));
const targetMax = String(Math.min(Math.max(Number.parseInt(process.argv[5] || "20", 10) || 20, 1), 200));
const MACHINE = "811d3e3f522648";
const APP = "nyayagrid-staging";

if (!clCourt || !/^[a-z0-9_-]+$/i.test(clCourt)) {
  console.log(JSON.stringify({ ok: false, reason: "clCourt required" }));
  process.exit(2);
}

const url = `https://raw.githubusercontent.com/patelvivek9111/nyayagrid/${sha}/scripts/staging-cl-batch-job-bundled.cjs`;

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

// ensure machine up
spawnSync("flyctl", ["machine", "start", MACHINE, "-a", APP], { encoding: "utf8" });
sleep(5_000);

const dl = fly(
  `node -e "fetch('${url}').then(r=>{if(!r.ok)throw new Error('http_'+r.status);return r.text()}).then(t=>{require('fs').writeFileSync('/tmp/staging-cl-batch-job-bundled.cjs',t);console.log(JSON.stringify({downloaded:true,bytes:t.length,sha:'${sha}'}))}).catch(e=>{console.log(JSON.stringify({ok:false,err:String(e.message||e)}));process.exit(1)})"`,
  90,
);
process.stdout.write(dl.stdout || "");
if (dl.status !== 0) process.exit(dl.status ?? 1);

const start = fly(
  `node -e "const fs=require('fs');const {spawn}=require('child_process'); try{fs.unlinkSync('/tmp/cl-batch-result.json')}catch(e){} fs.writeFileSync('/tmp/cl-batch-status.json',JSON.stringify({status:'starting'}));const out=fs.openSync('/tmp/cl-batch.log','w');const err=fs.openSync('/tmp/cl-batch.err','w');const env={...process.env,CL_COURT:'${clCourt}',CL_BATCH_SIZE:'${batchSize}',CL_TARGET_MAX:'${targetMax}',CL_RATE_MS:process.env.CL_RATE_MS||'1500',CL_PROOF:'0'};const child=spawn(process.execPath,['/tmp/staging-cl-batch-job-bundled.cjs'],{detached:true,stdio:['ignore',out,err],env});child.unref();console.log(JSON.stringify({ok:true,started:true,pid:child.pid,clCourt:'${clCourt}',batchSize:${batchSize},targetMax:${targetMax}}))"`,
  90,
);
process.stdout.write(start.stdout || "");
if (start.status !== 0) process.exit(start.status ?? 1);

// Poll DB job status (durable) + optional /tmp result file
const statusUrl = `https://raw.githubusercontent.com/patelvivek9111/nyayagrid/${sha}/scripts/staging-cl-job-status-bundled.cjs`;
for (let i = 0; i < 60; i++) {
  sleep(15_000);
  const poll = fly(
    `node -e "const fs=require('fs'); let fileResult=null; if(fs.existsSync('/tmp/cl-batch-result.json')){try{fileResult=JSON.parse(fs.readFileSync('/tmp/cl-batch-result.json','utf8'))}catch(e){fileResult={parseError:true}}} console.log(JSON.stringify({i:${i},fileResult,hasFile:Boolean(fileResult)}))"`,
    60,
  );
  const line = (poll.stdout || "").trim().split("\n").pop() || "{}";
  console.log(line);
  try {
    const p = JSON.parse(line);
    if (p.fileResult && p.fileResult.status) {
      process.exit(p.fileResult.ok === false && p.fileResult.status !== "rate_limited" ? 1 : 0);
    }
  } catch {
    // continue
  }
  // every other poll, check DB
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
      if (job && (job.status === "paused" || job.status === "completed" || job.status === "rate_limited")) {
        // require updated_at recent (within 3 min) to avoid stale paused
        const updated = job.updated_at ? Date.parse(job.updated_at) : 0;
        if (Date.now() - updated < 180_000 || job.status === "completed" || job.status === "rate_limited") {
          console.log(JSON.stringify({ ok: true, via: "db_checkpoint", job }));
          process.exit(job.status === "failed" ? 1 : 0);
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
}

console.log(JSON.stringify({ ok: false, reason: "poll_timeout" }));
process.exit(1);
