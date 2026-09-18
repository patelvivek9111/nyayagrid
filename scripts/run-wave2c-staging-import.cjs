const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const sha = process.argv[2] || process.env.LEAN_IMPORT_GIT_SHA?.trim();
if (!sha) {
  console.error("Usage: node scripts/run-wave2c-staging-import.cjs <git-sha>");
  process.exit(2);
}

const MACHINE = "811d3e3f522648";
const APP = "nyayagrid-staging";
const leanUrl = `https://raw.githubusercontent.com/patelvivek9111/nyayagrid/${sha}/scripts/staging-corpus-import-lean-bundled.cjs`;

function flyExec(command, timeoutSec = 120) {
  return spawnSync(
    "flyctl",
    ["machine", "exec", MACHINE, "-a", APP, "--timeout", String(timeoutSec), command],
    { encoding: "utf8", maxBuffer: 16_000_000 },
  );
}

const startCmd = `node -e "fetch('${leanUrl}').then(r=>{if(!r.ok)throw new Error('http_'+r.status);return r.text()}).then(t=>{require('fs').writeFileSync('/tmp/staging-corpus-import-lean-bundled.cjs',t); require('fs').writeFileSync('/tmp/corpus-import-status.json', JSON.stringify({status:'starting',at:new Date().toISOString(),sha:'${sha}'})); const fs=require('fs'); const {spawn}=require('child_process'); const out=fs.openSync('/tmp/corpus-import.log','w'); const err=fs.openSync('/tmp/corpus-import.err','w'); const env={...process.env,CORPUS_GIT_SHA:'${sha}'}; const child=spawn('node',['/tmp/staging-corpus-import-lean-bundled.cjs'],{detached:true,stdio:['ignore',out,err],env}); child.unref(); require('fs').writeFileSync('/tmp/corpus-import-status.json', JSON.stringify({status:'running',pid:child.pid,at:new Date().toISOString(),sha:'${sha}'})); console.log(JSON.stringify({ok:true,started:true,pid:child.pid,bytes:t.length,sha:'${sha}'}))}).catch(e=>{console.log(JSON.stringify({ok:false,err:String(e.message||e)})); process.exit(1)})"`;

const start = flyExec(startCmd, 180);
process.stdout.write(start.stdout || "");
process.stderr.write((start.stderr || "").slice(0, 1000));
if (start.status !== 0) process.exit(start.status ?? 1);

for (let i = 0; i < 60; i++) {
  spawnSync(process.execPath, ["-e", "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,15000)"]);
  const poll = flyExec(
    `node -e "const fs=require('fs'); const st=fs.existsSync('/tmp/corpus-import-status.json')?fs.readFileSync('/tmp/corpus-import-status.json','utf8'):null; const log=fs.existsSync('/tmp/corpus-import.log')?fs.readFileSync('/tmp/corpus-import.log','utf8'):''; const err=fs.existsSync('/tmp/corpus-import.err')?fs.readFileSync('/tmp/corpus-import.err','utf8').slice(-3000):''; const done=log.includes('\\\"ok\\\": true')||log.includes('\\\"ok\\\":true')||log.includes('\\\"ok\\\": false')||log.includes('\\\"ok\\\":false'); console.log(JSON.stringify({i:${i},done,status:st,logTail:log.slice(-5000),errTail:err}))"`,
    90,
  );
  process.stdout.write(poll.stdout || "");
  try {
    const lines = (poll.stdout || "").trim().split("\n");
    const parsed = JSON.parse(lines[lines.length - 1] || "{}");
    if (parsed.done) {
      const fail =
        (parsed.logTail || "").includes('"ok": false') || (parsed.logTail || "").includes('"ok":false');
      fs.writeFileSync(
        path.join("packages", "research", "corpus", "reports", "wave2c-staging-import.json"),
        `${JSON.stringify(parsed, null, 2)}\n`,
      );
      process.exit(fail ? 1 : 0);
    }
  } catch {
    // keep polling
  }
}
console.log(JSON.stringify({ ok: false, reason: "poll_timeout" }));
process.exit(1);
