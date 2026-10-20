const { spawnSync } = require("node:child_process");
const r = spawnSync(
  "flyctl",
  [
    "machine",
    "exec",
    "811d3e3f522648",
    "-a",
    "nyayagrid-staging",
    "--timeout",
    "60",
    `node -e "const fs=require('fs'); const o={log:fs.existsSync('/tmp/cl-batch.log')?fs.readFileSync('/tmp/cl-batch.log','utf8').slice(-2000):null,err:fs.existsSync('/tmp/cl-batch.err')?fs.readFileSync('/tmp/cl-batch.err','utf8').slice(-800):null,result:fs.existsSync('/tmp/cl-batch-result.json')?fs.readFileSync('/tmp/cl-batch-result.json','utf8'):null}; console.log(JSON.stringify(o))"`,
  ],
  { encoding: "utf8", maxBuffer: 8_000_000 },
);
process.stdout.write(r.stdout || "");
process.stderr.write((r.stderr || "").slice(0, 500));
