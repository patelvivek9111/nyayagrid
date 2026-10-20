const { spawnSync } = require("node:child_process");
function fly(cmd, t = 90) {
  return spawnSync(
    "flyctl",
    ["machine", "exec", "811d3e3f522648", "-a", "nyayagrid-staging", "--timeout", String(t), cmd],
    { encoding: "utf8", maxBuffer: 16_000_000 },
  );
}
const a = fly(
  "node -e \"const fs=require('fs'); const files=['/tmp/cl-wave-results.json','/tmp/cl-wave-retry.log','/tmp/cl-wave-retry.err']; for (const f of files) { const ex=fs.existsSync(f); const sz=ex?fs.statSync(f).size:0; console.log(JSON.stringify({f,ex,sz})); }\"",
);
process.stdout.write(a.stdout || "");
process.stderr.write((a.stderr || "").slice(0, 800));
const b = fly(
  "node -e \"const fs=require('fs'); if(!fs.existsSync('/tmp/cl-wave-results.json')){console.log('missing'); process.exit(0)} const s=fs.readFileSync('/tmp/cl-wave-results.json','utf8'); console.log(s.slice(0,3000)); console.log('---TAIL---'); console.log(s.slice(-2000));\"",
);
process.stdout.write(b.stdout || "");
process.stderr.write((b.stderr || "").slice(0, 800));
