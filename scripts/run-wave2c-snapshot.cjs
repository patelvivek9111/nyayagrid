const { spawnSync } = require("node:child_process");
const fs = require("node:fs");

const sha = process.argv[2] || "7edb8f4efbf7d7640ebf455863e7ec8cdf088b7d";
const MACHINE = "811d3e3f522648";
const APP = "nyayagrid-staging";

function flyExec(command, timeoutSec = 120) {
  return spawnSync(
    "flyctl",
    ["machine", "exec", MACHINE, "-a", APP, "--timeout", String(timeoutSec), command],
    { encoding: "utf8", maxBuffer: 16_000_000 },
  );
}

const url = `https://raw.githubusercontent.com/patelvivek9111/nyayagrid/${sha}/scripts/staging-wave2c-snapshot.cjs`;
const cmd = `node -e "fetch('${url}').then(r=>{if(!r.ok)throw new Error('http_'+r.status);return r.text()}).then(t=>{require('fs').writeFileSync('/tmp/wave2c-snapshot.cjs',t); require('/tmp/wave2c-snapshot.cjs')}).catch(e=>{console.log(JSON.stringify({ok:false,err:String(e.message||e)}));process.exit(1)})"`;
const r = flyExec(cmd, 90);
process.stdout.write(r.stdout || "");
process.stderr.write((r.stderr || "").slice(0, 1500));
process.exit(r.status ?? 1);
