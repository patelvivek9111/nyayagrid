const { spawnSync } = require("node:child_process");

const url =
  "https://raw.githubusercontent.com/patelvivek9111/nyayagrid/433a1616d790ac23afbc8e3107e667f33c38d00a/scripts/staging-sql-probe-bundled.cjs";

const downloadAndRun = `
node -e "fetch(process.argv[1]).then(r=>{if(!r.ok)throw new Error('http_'+r.status);return r.text()}).then(t=>{require('fs').writeFileSync('/tmp/staging-sql-probe-bundled.cjs',t); const {spawnSync}=require('child_process'); const r=spawnSync('node',['/tmp/staging-sql-probe-bundled.cjs'],{encoding:'utf8'}); process.stdout.write(r.stdout||''); process.stderr.write(r.stderr||''); process.exit(r.status||0)}).catch(e=>{console.log(JSON.stringify({ok:false,err:String(e.message||e)})); process.exit(1)})" ${url}
`.trim();

const r = spawnSync(
  "flyctl",
  ["machine", "exec", "811d3e3f522648", "-a", "nyayagrid-staging", "--timeout", "120", downloadAndRun],
  { encoding: "utf8", maxBuffer: 8_000_000, shell: false },
);
process.stdout.write(r.stdout || "");
process.stderr.write((r.stderr || "").slice(0, 1500));
process.exit(r.status ?? 1);
