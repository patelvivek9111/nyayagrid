const { spawnSync } = require("node:child_process");

const sha = process.argv[2] || "HEAD";
const url = `https://raw.githubusercontent.com/patelvivek9111/nyayagrid/${sha}/scripts/staging-cl-coverage-probe-bundled.cjs`;

const cmd = `node -e "fetch(process.argv[1]).then(r=>{if(!r.ok)throw new Error('http_'+r.status);return r.text()}).then(t=>{require('fs').writeFileSync('/tmp/staging-cl-coverage-probe-bundled.cjs',t); const {spawnSync}=require('child_process'); const r=spawnSync('node',['/tmp/staging-cl-coverage-probe-bundled.cjs'],{encoding:'utf8',env:process.env,maxBuffer:16*1024*1024}); process.stdout.write(r.stdout||''); process.stderr.write((r.stderr||'').slice(0,800)); process.exit(r.status||0)}).catch(e=>{console.log(JSON.stringify({ok:false,err:String(e.message||e)})); process.exit(1)})" ${url}`;

const r = spawnSync(
  "flyctl",
  ["machine", "exec", "811d3e3f522648", "-a", "nyayagrid-staging", "--timeout", "180", cmd],
  { encoding: "utf8", maxBuffer: 16_000_000 },
);
process.stdout.write(r.stdout || "");
process.stderr.write((r.stderr || "").slice(0, 800));
process.exit(r.status ?? 1);
