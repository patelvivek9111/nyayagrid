const { spawnSync } = require("node:child_process");
const sha = process.argv[2] || "c133f308a54325f08e27cdb328d15cdc7e90a158";
const url = `https://raw.githubusercontent.com/patelvivek9111/nyayagrid/${sha}/scripts/staging-cl-court-map-probe-bundled.cjs`;
const cmd = `node -e "fetch(process.argv[1]).then(r=>{if(!r.ok)throw new Error('http_'+r.status);return r.text()}).then(t=>{require('fs').writeFileSync('/tmp/cl-court-map.cjs',t); const {spawnSync}=require('child_process'); const r=spawnSync('node',['/tmp/cl-court-map.cjs'],{encoding:'utf8',env:{...process.env,CL_RATE_MS:'600'},maxBuffer:16*1024*1024}); process.stdout.write(r.stdout||''); process.stderr.write((r.stderr||'').slice(0,500)); process.exit(r.status||0)}).catch(e=>{console.log(JSON.stringify({ok:false,err:String(e.message||e)}));process.exit(1)})" ${url}`;
const r = spawnSync(
  "flyctl",
  ["machine", "exec", "811d3e3f522648", "-a", "nyayagrid-staging", "--timeout", "300", cmd],
  { encoding: "utf8", maxBuffer: 16_000_000 },
);
process.stdout.write(r.stdout || "");
process.stderr.write((r.stderr || "").slice(0, 800));
process.exit(r.status ?? 1);
