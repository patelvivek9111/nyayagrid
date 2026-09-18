const { spawnSync } = require("node:child_process");

const sha = process.argv[2] || "5eadc501e8cf5ff5fd14d6658fd3e75cae0133a9";
const script = process.argv[3] || "scripts/staging-wave2c-resolve-citations-bundled.cjs";
const MACHINE = "811d3e3f522648";
const APP = "nyayagrid-staging";
const url = `https://raw.githubusercontent.com/patelvivek9111/nyayagrid/${sha}/${script.replace(/\\\\/g, "/")}`;

const cmd = `node -e "fetch('${url}').then(r=>{if(!r.ok)throw new Error('http_'+r.status);return r.text()}).then(t=>{require('fs').writeFileSync('/tmp/wave2c-tool.cjs',t); require('/tmp/wave2c-tool.cjs')}).catch(e=>{console.log(JSON.stringify({ok:false,err:String(e.message||e)}));process.exit(1)})"`;

const r = spawnSync(
  "flyctl",
  ["machine", "exec", MACHINE, "-a", APP, "--timeout", "180", cmd],
  { encoding: "utf8", maxBuffer: 16_000_000 },
);
process.stdout.write(r.stdout || "");
process.stderr.write((r.stderr || "").slice(0, 2000));
process.exit(r.status ?? 1);
