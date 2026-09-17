/**
 * One-court-at-a-time CourtListener ingest (survives Fly machine restarts better).
 * Usage: node scripts/run-staging-cl-sequential.cjs <sha>
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const sha = process.argv[2] || "756b85c793b7dea53b0ac9339ee5fb923de3e8f6";
const MACHINE = "811d3e3f522648";
const APP = "nyayagrid-staging";
const leanUrl = `https://raw.githubusercontent.com/patelvivek9111/nyayagrid/${sha}/scripts/staging-cl-ingest-lean-bundled.cjs`;

const PLAN = [
  { court: "ca10", max: 6 },
  { court: "ca11", max: 6 },
  { court: "cadc", max: 6 },
  { court: "cafc", max: 6 },
  { court: "cal", max: 8 },
  { court: "calctapp", max: 6 },
  { court: "ny", max: 8 },
  { court: "nyappdiv", max: 6 },
  { court: "pa", max: 8 },
  { court: "pasuperct", max: 6 },
  { court: "tex", max: 8 },
  { court: "texapp", max: 6 },
  { court: "nj", max: 8 },
  { court: "njsuperct", max: 6 },
  { court: "fla", max: 8 },
  { court: "fladistctapp", max: 6 },
  { court: "ill", max: 8 },
  { court: "illappct", max: 6 },
  { court: "mass", max: 8 },
  { court: "massappct", max: 6 },
  { court: "va", max: 8 },
  { court: "vacapp", max: 6 },
  { court: "del", max: 6 },
];

function flyExec(command, timeoutSec = 120) {
  return spawnSync(
    "flyctl",
    ["machine", "exec", MACHINE, "-a", APP, "--timeout", String(timeoutSec), command],
    { encoding: "utf8", maxBuffer: 16_000_000 },
  );
}

function sleep(ms) {
  spawnSync(process.execPath, [
    "-e",
    `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${ms})`,
  ]);
}

function ensureMachine() {
  const st = spawnSync("flyctl", ["status", "-a", APP], { encoding: "utf8" });
  if ((st.stdout || "").includes("stopped") || (st.stderr || "").includes("not running")) {
    spawnSync("flyctl", ["machine", "start", MACHINE, "-a", APP], { encoding: "utf8" });
    sleep(15_000);
  }
}

function downloadLean() {
  const r = flyExec(
    `node -e "fetch('${leanUrl}').then(r=>{if(!r.ok)throw new Error('http_'+r.status);return r.text()}).then(t=>{require('fs').writeFileSync('/tmp/staging-cl-ingest-lean-bundled.cjs',t); console.log(JSON.stringify({downloaded:true,bytes:t.length}))}).catch(e=>{console.log(JSON.stringify({ok:false,err:String(e.message||e)}));process.exit(1)})"`,
    120,
  );
  process.stdout.write(r.stdout || "");
  return r.status === 0;
}

function runCourt(court, max) {
  ensureMachine();
  // detached single-court run
  const start = flyExec(
    `node -e "const fs=require('fs');const {spawn}=require('child_process'); if(!fs.existsSync('/tmp/staging-cl-ingest-lean-bundled.cjs')){console.log(JSON.stringify({ok:false,reason:'missing_bundle'}));process.exit(1)} fs.writeFileSync('/tmp/cl-one-status.json',JSON.stringify({status:'starting',court:'${court}'})); const out=fs.openSync('/tmp/cl-one.log','w'); const err=fs.openSync('/tmp/cl-one.err','w'); const env={...process.env,CL_COURT:'${court}',CL_MAX:'${max}',CL_PROOF:'0',CL_RATE_MS:'1200'}; const child=spawn(process.execPath,['/tmp/staging-cl-ingest-lean-bundled.cjs'],{detached:true,stdio:['ignore',out,err],env}); child.unref(); console.log(JSON.stringify({ok:true,started:true,pid:child.pid,court:'${court}',max:${max}}))"`,
    90,
  );
  process.stdout.write(start.stdout || "");
  if (start.status !== 0) return { ok: false, court, reason: "start_failed", stderr: (start.stderr || "").slice(0, 300) };

  for (let i = 0; i < 90; i++) {
    sleep(15_000);
    ensureMachine();
    const poll = flyExec(
      `node -e "const fs=require('fs'); const log=fs.existsSync('/tmp/cl-one.log')?fs.readFileSync('/tmp/cl-one.log','utf8'):''; const err=fs.existsSync('/tmp/cl-one.err')?fs.readFileSync('/tmp/cl-one.err','utf8').slice(-400):''; const done=log.includes('\\\"ok\\\":true')||log.includes('\\\"ok\\\": false')||log.includes('\\\"ok\\\":true')||log.includes('\\\"ok\\\":false'); let parsed=null; try{ const lines=log.trim().split(/\\\\n/).filter(Boolean); parsed=JSON.parse(lines[lines.length-1]||'{}'); }catch(e){ parsed=null; } console.log(JSON.stringify({i:${i},done,court:'${court}',result:parsed,errTail:err,logTail:log.slice(-600)}))"`,
      90,
    );
    const line = (poll.stdout || "").trim().split("\n").pop() || "{}";
    console.log(line);
    try {
      const p = JSON.parse(line);
      if (p.done) {
        return { ok: Boolean(p.result && p.result.ok), court, result: p.result, errTail: p.errTail };
      }
    } catch {
      // continue
    }
    if ((poll.stderr || "").includes("machine not running")) {
      ensureMachine();
      if (!downloadLean()) return { ok: false, court, reason: "redownload_failed" };
      return { ok: false, court, reason: "machine_restarted_mid_court" };
    }
  }
  return { ok: false, court, reason: "poll_timeout" };
}

const summary = [];
console.log(JSON.stringify({ phase: "sequential_start", courts: PLAN.length, sha }));
ensureMachine();
if (!downloadLean()) {
  console.log(JSON.stringify({ ok: false, reason: "download_failed" }));
  process.exit(1);
}

for (const item of PLAN) {
  console.log(JSON.stringify({ phase: "court_begin", court: item.court, max: item.max }));
  const r = runCourt(item.court, item.max);
  summary.push({
    court: r.court,
    ok: r.ok,
    imported: r.result?.imported ?? null,
    skipped: r.result?.skipped ?? null,
    quarantined: r.result?.quarantined ?? null,
    reason: r.reason || r.result?.reason || null,
    apiCalls: r.result?.apiCalls ?? null,
  });
  console.log(JSON.stringify({ phase: "court_end", ...summary[summary.length - 1] }));
  sleep(8_000);
  // re-download lean in case /tmp was wiped
  downloadLean();
}

const out = {
  ok: true,
  sha,
  completed: summary.length,
  importedSum: summary.reduce((s, x) => s + (Number(x.imported) || 0), 0),
  okCourts: summary.filter((x) => x.ok).length,
  failedCourts: summary.filter((x) => !x.ok).map((x) => x.court),
  summary,
};
fs.writeFileSync(path.join(__dirname, "cl-sequential-results.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(out.failedCourts.length > 0 && out.importedSum === 0 ? 1 : 0);
