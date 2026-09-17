const { spawnSync } = require("node:child_process");

// SHA placeholder — update after lean bundle is pushed to GitHub.
const sha = "PLACEHOLDER_UPDATE_AFTER_PUSH";
const url = `https://raw.githubusercontent.com/patelvivek9111/nyayagrid/${sha}/scripts/staging-corpus-import-lean-bundled.cjs`;

function flyExec(command, timeoutSec = 120) {
  return spawnSync(
    "flyctl",
    ["machine", "exec", "811d3e3f522648", "-a", "nyayagrid-staging", "--timeout", String(timeoutSec), command],
    { encoding: "utf8", maxBuffer: 16_000_000 },
  );
}

const startCmd = `node -e "fetch('${url}').then(r=>{if(!r.ok)throw new Error('http_'+r.status);return r.text()}).then(t=>{require('fs').writeFileSync('/tmp/staging-corpus-import-lean-bundled.cjs',t); require('fs').writeFileSync('/tmp/corpus-import-status.json', JSON.stringify({status:'starting',at:new Date().toISOString()})); const fs=require('fs'); const {spawn}=require('child_process'); const out=fs.openSync('/tmp/corpus-import.log','w'); const err=fs.openSync('/tmp/corpus-import.err','w'); const child=spawn('node',['/tmp/staging-corpus-import-lean-bundled.cjs'],{detached:true,stdio:['ignore',out,err],env:process.env}); child.unref(); require('fs').writeFileSync('/tmp/corpus-import-status.json', JSON.stringify({status:'running',pid:child.pid,at:new Date().toISOString()})); console.log(JSON.stringify({ok:true,started:true,pid:child.pid,bytes:t.length}))}).catch(e=>{console.log(JSON.stringify({ok:false,err:String(e.message||e)})); process.exit(1)})"`;

const start = flyExec(startCmd, 180);
process.stdout.write(start.stdout || "");
process.stderr.write((start.stderr || "").slice(0, 1000));
if (start.status !== 0) process.exit(start.status ?? 1);

for (let i = 0; i < 40; i++) {
  spawnSync(process.execPath, ["-e", "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,15000)"]);
  const poll = flyExec(
    `node -e "const fs=require('fs'); const st=fs.existsSync('/tmp/corpus-import-status.json')?fs.readFileSync('/tmp/corpus-import-status.json','utf8'):null; const log=fs.existsSync('/tmp/corpus-import.log')?fs.readFileSync('/tmp/corpus-import.log','utf8'):''; const err=fs.existsSync('/tmp/corpus-import.err')?fs.readFileSync('/tmp/corpus-import.err','utf8').slice(-2000):''; const done=log.includes('\\\"ok\\\": true')||log.includes('\\\"ok\\\":true')||log.includes('\\\"ok\\\": false'); console.log(JSON.stringify({i:${i},done,status:st,logTail:log.slice(-4000),errTail:err}))"`,
    90,
  );
  process.stdout.write(poll.stdout || "");
  try {
    const parsed = JSON.parse((poll.stdout || "").trim().split("\n").pop() || "{}");
    if (parsed.done) {
      process.exit(parsed.logTail?.includes('"ok": false') || parsed.logTail?.includes('"ok":false') ? 1 : 0);
    }
  } catch {
    // keep polling
  }
}
console.log(JSON.stringify({ ok: false, reason: "poll_timeout" }));
process.exit(1);
