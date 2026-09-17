const { spawnSync } = require("node:child_process");

const sha =
  process.argv[2] ||
  spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
const url = `https://raw.githubusercontent.com/patelvivek9111/nyayagrid/${sha}/scripts/staging-cl-shape-probe-bundled.cjs`;

const cmd = `node -e "fetch(process.argv[1]).then(r=>{if(!r.ok)throw new Error('http_'+r.status);return r.text()}).then(t=>{require('fs').writeFileSync('/tmp/cl-shape.cjs',t); const {spawnSync}=require('child_process'); const r=spawnSync('env',['CL_COURT=scotus','node','/tmp/cl-shape.cjs'],{encoding:'utf8',env:process.env}); process.stdout.write(r.stdout||''); process.stderr.write((r.stderr||'').slice(0,800)); process.exit(r.status||0)}).catch(e=>{console.log(JSON.stringify({ok:false,err:String(e.message||e)}));process.exit(1)})" ${url}`;

const r = spawnSync(
  "flyctl",
  ["machine", "exec", "811d3e3f522648", "-a", "nyayagrid-staging", "--timeout", "90", cmd],
  { encoding: "utf8", maxBuffer: 5_000_000 },
);
process.stdout.write(r.stdout || "");
process.stderr.write((r.stderr || "").slice(0, 500));
process.exit(r.status ?? 1);
