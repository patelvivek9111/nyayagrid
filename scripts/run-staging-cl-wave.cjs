/**
 * Orchestrate Wave 2 CourtListener ingest on Fly staging (detached).
 * Usage: node scripts/run-staging-cl-wave.cjs <sha>
 * Never prints secrets.
 */
const { spawnSync } = require("node:child_process");

const sha = process.argv[2] || "8b176c14eb904f76f78314087a794a5752803e96";
const MACHINE = "811d3e3f522648";
const APP = "nyayagrid-staging";
const leanUrl = `https://raw.githubusercontent.com/patelvivek9111/nyayagrid/${sha}/scripts/staging-cl-ingest-lean-bundled.cjs`;
const runnerUrl = `https://raw.githubusercontent.com/patelvivek9111/nyayagrid/${sha}/scripts/staging-cl-wave-runner.cjs`;

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

console.log(JSON.stringify({ phase: "start", sha, leanUrl, runnerUrl }));

const dl = flyExec(
  `node -e "Promise.all([fetch('${leanUrl}').then(r=>{if(!r.ok)throw new Error('lean_'+r.status);return r.text()}),fetch('${runnerUrl}').then(r=>{if(!r.ok)throw new Error('runner_'+r.status);return r.text()})]).then(([lean,runner])=>{require('fs').writeFileSync('/tmp/staging-cl-ingest-lean-bundled.cjs',lean);require('fs').writeFileSync('/tmp/staging-cl-wave-runner.cjs',runner);console.log(JSON.stringify({downloaded:true,leanBytes:lean.length,runnerBytes:runner.length,sha:'${sha}'}))}).catch(e=>{console.log(JSON.stringify({ok:false,err:String(e.message||e)}));process.exit(1)})"`,
  120,
);
process.stdout.write(dl.stdout || "");
process.stderr.write((dl.stderr || "").slice(0, 800));
if (dl.status !== 0) process.exit(dl.status ?? 1);

const start = flyExec(
  `node -e "const fs=require('fs');const {spawn}=require('child_process');fs.writeFileSync('/tmp/cl-wave-results.json',JSON.stringify({status:'starting',at:new Date().toISOString()}));const out=fs.openSync('/tmp/cl-wave.log','w');const err=fs.openSync('/tmp/cl-wave.err','w');const child=spawn(process.execPath,['/tmp/staging-cl-wave-runner.cjs'],{detached:true,stdio:['ignore',out,err],env:process.env});child.unref();console.log(JSON.stringify({ok:true,started:true,pid:child.pid}))"`,
  90,
);
process.stdout.write(start.stdout || "");
process.stderr.write((start.stderr || "").slice(0, 800));
if (start.status !== 0) process.exit(start.status ?? 1);

const maxPolls = 150; // 150 × 20s ≈ 50 min
for (let i = 0; i < maxPolls; i++) {
  sleep(20_000);
  const poll = flyExec(
    `node -e "const fs=require('fs');let parsed=null;try{parsed=JSON.parse(fs.readFileSync('/tmp/cl-wave-results.json','utf8'))}catch(e){parsed={status:'unreadable'}}const err=fs.existsSync('/tmp/cl-wave.err')?fs.readFileSync('/tmp/cl-wave.err','utf8').slice(-800):'';console.log(JSON.stringify({i:${i},status:parsed.status,completed:parsed.completed,total:parsed.total,done:parsed.status==='done',errTail:err}))"`,
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
      process.exit(0);
    }
  } catch {
    // continue
  }
}

console.log(JSON.stringify({ ok: false, reason: "poll_timeout" }));
process.exit(1);
