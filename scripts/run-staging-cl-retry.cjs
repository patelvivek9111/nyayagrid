/**
 * Retry remaining Wave 2 courts after 429s (slower rate + inter-court pause).
 * Usage: node scripts/run-staging-cl-retry.cjs <sha>
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const sha = process.argv[2] || "58f4f362edffdbaf15fda8c16c6b731aeba022b9";
const MACHINE = "811d3e3f522648";
const APP = "nyayagrid-staging";
const leanUrl = `https://raw.githubusercontent.com/patelvivek9111/nyayagrid/${sha}/scripts/staging-cl-ingest-lean-bundled.cjs`;
const runnerUrl = `https://raw.githubusercontent.com/patelvivek9111/nyayagrid/${sha}/scripts/staging-cl-wave-runner.cjs`;

const RETRY_PLAN = [
  { court: "ca8", max: 15 },
  { court: "ca9", max: 15 },
  { court: "ca10", max: 15 },
  { court: "ca11", max: 15 },
  { court: "cadc", max: 15 },
  { court: "cafc", max: 15 },
  { court: "cal", max: 20 },
  { court: "calctapp", max: 15 },
  { court: "ny", max: 20 },
  { court: "nyappdiv", max: 15 },
  { court: "pa", max: 20 },
  { court: "pasuperct", max: 15 },
  { court: "tex", max: 20 },
  { court: "texapp", max: 15 },
  { court: "nj", max: 20 },
  { court: "njsuperct", max: 15 },
  { court: "fla", max: 20 },
  { court: "fladistctapp", max: 15 },
  { court: "ill", max: 20 },
  { court: "illappct", max: 15 },
  { court: "mass", max: 20 },
  { court: "massappct", max: 15 },
  { court: "va", max: 20 },
  { court: "vacapp", max: 15 },
  { court: "del", max: 15 },
];

function flyExec(command, timeoutSec = 120) {
  return spawnSync(
    "flyctl",
    ["machine", "exec", MACHINE, "-a", APP, "--timeout", String(timeoutSec), command],
    { encoding: "utf8", maxBuffer: 32_000_000 },
  );
}

function sleep(ms) {
  spawnSync(process.execPath, [
    "-e",
    `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${ms})`,
  ]);
}

const planB64 = Buffer.from(JSON.stringify(RETRY_PLAN), "utf8").toString("base64");

console.log(
  JSON.stringify({
    phase: "cooldown_90s",
    reason: "respect_cl_rate_limit",
    retryCourts: RETRY_PLAN.length,
  }),
);
sleep(90_000);

const dl = flyExec(
  `node -e "Promise.all([fetch('${leanUrl}').then(r=>{if(!r.ok)throw new Error('lean_'+r.status);return r.text()}),fetch('${runnerUrl}').then(r=>{if(!r.ok)throw new Error('runner_'+r.status);return r.text()})]).then(([lean,runner])=>{require('fs').writeFileSync('/tmp/staging-cl-ingest-lean-bundled.cjs',lean);require('fs').writeFileSync('/tmp/staging-cl-wave-runner.cjs',runner);require('fs').writeFileSync('/tmp/cl-wave-plan.json',Buffer.from('${planB64}','base64').toString('utf8')); console.log(JSON.stringify({downloaded:true,leanBytes:lean.length,planCourts:${RETRY_PLAN.length}}))}).catch(e=>{console.log(JSON.stringify({ok:false,err:String(e.message||e)}));process.exit(1)})"`,
  120,
);
process.stdout.write(dl.stdout || "");
process.stderr.write((dl.stderr || "").slice(0, 800));
if (dl.status !== 0) process.exit(dl.status ?? 1);

const start = flyExec(
  `node -e "const fs=require('fs');const {spawn}=require('child_process');fs.writeFileSync('/tmp/cl-wave-results.json',JSON.stringify({status:'starting',at:new Date().toISOString()}));const out=fs.openSync('/tmp/cl-wave-retry.log','w');const err=fs.openSync('/tmp/cl-wave-retry.err','w');const env={...process.env,CL_RATE_MS:'1500',CL_COURT_PAUSE_MS:'12000'};const child=spawn(process.execPath,['/tmp/staging-cl-wave-runner.cjs'],{detached:true,stdio:['ignore',out,err],env});child.unref();console.log(JSON.stringify({ok:true,started:true,pid:child.pid,rateMs:1500,pauseMs:12000}))"`,
  90,
);
process.stdout.write(start.stdout || "");
process.stderr.write((start.stderr || "").slice(0, 800));
if (start.status !== 0) process.exit(start.status ?? 1);

const maxPolls = 200;
for (let i = 0; i < maxPolls; i++) {
  sleep(20_000);
  const poll = flyExec(
    `node -e "const fs=require('fs');let parsed=null;try{parsed=JSON.parse(fs.readFileSync('/tmp/cl-wave-results.json','utf8'))}catch(e){parsed={status:'unreadable'}}const err=fs.existsSync('/tmp/cl-wave-retry.err')?fs.readFileSync('/tmp/cl-wave-retry.err','utf8').slice(-800):''; const last=(parsed.results&&parsed.results.length)?parsed.results[parsed.results.length-1]:null; console.log(JSON.stringify({i:${i},status:parsed.status,completed:parsed.completed,total:parsed.total,done:parsed.status==='done',lastCourt:last&&last.court,lastOk:last&&last.ok,lastImported:last&&last.imported,lastReason:last&&last.reason,errTail:err}))"`,
    90,
  );
  const line = (poll.stdout || "").trim().split("\n").pop() || "{}";
  console.log(line);
  try {
    const p = JSON.parse(line);
    if (p.done) {
      const full = flyExec(
        `node -e "console.log(require('fs').readFileSync('/tmp/cl-wave-results.json','utf8'))"`,
        90,
      );
      process.stdout.write(full.stdout || "");
      // Write local summary for reporting
      try {
        fs.writeFileSync(
          path.join(__dirname, "cl-wave-retry-results.json"),
          full.stdout || "{}",
        );
      } catch {
        // ignore
      }
      process.exit(0);
    }
  } catch {
    // continue
  }
}

console.log(JSON.stringify({ ok: false, reason: "poll_timeout" }));
process.exit(1);
