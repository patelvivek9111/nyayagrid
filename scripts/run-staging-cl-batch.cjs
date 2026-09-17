const { spawnSync } = require("node:child_process");

/**
 * Download lean CourtListener ingest bundle onto Fly staging machine and run it.
 * Usage: node scripts/run-staging-cl-batch.cjs <sha> <clCourt> <max> [proof]
 * Never prints secrets. Machine already has COURTLISTENER_API_KEY / DATABASE_URL / OPENAI_API_KEY.
 */
const shaArg = process.argv[2] && process.argv[2] !== "-" ? process.argv[2] : null;
const sha =
  shaArg || process.env.CL_INGEST_GIT_SHA?.trim() || "PLACEHOLDER_UPDATE_AFTER_PUSH";
const clCourtRaw = process.argv[3] || "scotus";
const maxRaw = process.argv[4] || "20";
const proofArg = process.argv[5];
const proof = proofArg === "1" || proofArg === "proof" ? "1" : "0";

if (!/^[a-z0-9_-]+$/i.test(clCourtRaw)) {
  console.log(JSON.stringify({ ok: false, reason: "invalid_clCourt" }));
  process.exit(2);
}
const clCourt = clCourtRaw.toLowerCase();
const maxNum = Math.min(Math.max(Number.parseInt(String(maxRaw), 10) || 20, 1), 500);
const max = String(maxNum);

const url = `https://raw.githubusercontent.com/patelvivek9111/nyayagrid/${sha}/scripts/staging-cl-ingest-lean-bundled.cjs`;

function flyExec(command, timeoutSec = 120) {
  return spawnSync(
    "flyctl",
    [
      "machine",
      "exec",
      "811d3e3f522648",
      "-a",
      "nyayagrid-staging",
      "--timeout",
      String(timeoutSec),
      command,
    ],
    { encoding: "utf8", maxBuffer: 32_000_000 },
  );
}

// Proof / tiny batches only: Fly machine exec 408s on longer sync runs.
const useSync = proof === "1" || maxNum <= 5;

if (useSync) {
  const downloadAndRun = `node -e "fetch('${url}').then(r=>{if(!r.ok)throw new Error('http_'+r.status);return r.text()}).then(t=>{require('fs').writeFileSync('/tmp/staging-cl-ingest-lean-bundled.cjs',t); console.log(JSON.stringify({downloaded:true,bytes:t.length,sha:'${sha}',clCourt:'${clCourt}',max:${maxNum},proof:'${proof}'})); const {spawnSync}=require('child_process'); const r=spawnSync('node',['-e',\\\"process.env.CL_COURT='${clCourt}';process.env.CL_MAX='${max}';process.env.CL_PROOF='${proof}';require('/tmp/staging-cl-ingest-lean-bundled.cjs')\\\"],{encoding:'utf8',env:process.env,maxBuffer:32*1024*1024}); process.stdout.write(r.stdout||''); process.stderr.write((r.stderr||'').slice(0,4000)); process.exit(r.status||0)}).catch(e=>{console.log(JSON.stringify({ok:false,err:String(e.message||e)})); process.exit(1)})"`;
  const r = flyExec(downloadAndRun, 600);
  process.stdout.write(r.stdout || "");
  process.stderr.write((r.stderr || "").slice(0, 2000));
  process.exit(r.status ?? 1);
}

// Long batches: detached + poll (same pattern as fetch-run-lean-import.cjs).
const startCmd = `node -e "fetch('${url}').then(r=>{if(!r.ok)throw new Error('http_'+r.status);return r.text()}).then(t=>{require('fs').writeFileSync('/tmp/staging-cl-ingest-lean-bundled.cjs',t); require('fs').writeFileSync('/tmp/cl-ingest-status.json', JSON.stringify({status:'starting',at:new Date().toISOString()})); const fs=require('fs'); const {spawn}=require('child_process'); const out=fs.openSync('/tmp/cl-ingest.log','w'); const err=fs.openSync('/tmp/cl-ingest.err','w'); const child=spawn('node',['-e',\\\"process.env.CL_COURT='${clCourt}';process.env.CL_MAX='${max}';process.env.CL_PROOF='${proof}';require('/tmp/staging-cl-ingest-lean-bundled.cjs')\\\"],{detached:true,stdio:['ignore',out,err],env:process.env}); child.unref(); require('fs').writeFileSync('/tmp/cl-ingest-status.json', JSON.stringify({status:'running',pid:child.pid,at:new Date().toISOString(),bytes:t.length,sha:'${sha}'})); console.log(JSON.stringify({ok:true,started:true,pid:child.pid,bytes:t.length,sha:'${sha}',clCourt:'${clCourt}',max:${maxNum}}))}).catch(e=>{console.log(JSON.stringify({ok:false,err:String(e.message||e)})); process.exit(1)})"`;

const start = flyExec(startCmd, 180);
process.stdout.write(start.stdout || "");
process.stderr.write((start.stderr || "").slice(0, 1000));
if (start.status !== 0) process.exit(start.status ?? 1);

for (let i = 0; i < 60; i++) {
  spawnSync(process.execPath, [
    "-e",
    "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,15000)",
  ]);
  const poll = flyExec(
    `node -e "const fs=require('fs'); const st=fs.existsSync('/tmp/cl-ingest-status.json')?fs.readFileSync('/tmp/cl-ingest-status.json','utf8'):null; const log=fs.existsSync('/tmp/cl-ingest.log')?fs.readFileSync('/tmp/cl-ingest.log','utf8'):''; const err=fs.existsSync('/tmp/cl-ingest.err')?fs.readFileSync('/tmp/cl-ingest.err','utf8').slice(-2000):''; const done=log.includes('\\\"ok\\\": true')||log.includes('\\\"ok\\\":true')||log.includes('\\\"ok\\\": false')||log.includes('\\\"ok\\\":false'); console.log(JSON.stringify({i:${i},done,status:st,logTail:log.slice(-5000),errTail:err}))"`,
    90,
  );
  process.stdout.write(poll.stdout || "");
  try {
    const parsed = JSON.parse((poll.stdout || "").trim().split("\n").pop() || "{}");
    if (parsed.done) {
      process.exit(
        parsed.logTail?.includes('"ok": false') || parsed.logTail?.includes('"ok":false')
          ? 1
          : 0,
      );
    }
  } catch {
    // keep polling
  }
}
console.log(JSON.stringify({ ok: false, reason: "poll_timeout" }));
process.exit(1);
