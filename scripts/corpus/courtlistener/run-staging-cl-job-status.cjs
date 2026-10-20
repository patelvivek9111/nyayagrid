const { spawnSync } = require("node:child_process");
const sha = process.argv[2] || "89dc67cb2ea4f947236d8b501116d2b9dedb9c2f";
const court = process.argv[3] || "";
const url = `https://raw.githubusercontent.com/patelvivek9111/nyayagrid/${sha}/scripts/staging-cl-job-status-bundled.cjs`;
const envCourt = court ? `process.env.CL_COURT='${court}';` : "";
const cmd = `node -e "fetch(process.argv[1]).then(r=>{if(!r.ok)throw new Error('http_'+r.status);return r.text()}).then(t=>{require('fs').writeFileSync('/tmp/cl-job-status.cjs',t); ${envCourt} const {spawnSync}=require('child_process'); const r=spawnSync('node',['/tmp/cl-job-status.cjs'],{encoding:'utf8',env:process.env}); process.stdout.write(r.stdout||''); process.exit(r.status||0)}).catch(e=>{console.log(JSON.stringify({ok:false,err:String(e.message||e)}));process.exit(1)})" ${url}`;
const r = spawnSync(
  "flyctl",
  ["machine", "exec", "811d3e3f522648", "-a", "nyayagrid-staging", "--timeout", "120", cmd],
  { encoding: "utf8", maxBuffer: 8_000_000 },
);
process.stdout.write(r.stdout || "");
process.stderr.write((r.stderr || "").slice(0, 500));
process.exit(r.status ?? 1);
