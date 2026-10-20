const { spawnSync } = require("node:child_process");
const sha = process.argv[2] || "fd97548b17812346c05c4f6cabebce8389e4dd3d";
const court = process.argv[3] || "ca11";
const url = `https://raw.githubusercontent.com/patelvivek9111/nyayagrid/${sha}/scripts/staging-cl-batch-job-bundled.cjs`;
const MACHINE = "811d3e3f522648";
const APP = "nyayagrid-staging";

function fly(cmd, t = 120) {
  return spawnSync(
    "flyctl",
    ["machine", "exec", MACHINE, "-a", APP, "--timeout", String(t), cmd],
    { encoding: "utf8", maxBuffer: 8_000_000 },
  );
}

spawnSync("flyctl", ["machine", "start", MACHINE, "-a", APP], { encoding: "utf8" });

const dl = fly(
  `node -e "fetch('${url}').then(r=>{if(!r.ok)throw new Error('http_'+r.status);return r.text()}).then(t=>{require('fs').writeFileSync('/tmp/cl-batch.cjs',t);console.log(JSON.stringify({bytes:t.length}))})"`,
  90,
);
process.stdout.write(dl.stdout || "");

const run = fly(
  `node -e "process.env.CL_COURT='${court}';process.env.CL_BATCH_SIZE='2';process.env.CL_TARGET_MAX='12';process.env.CL_RATE_MS='1000';process.env.CL_PROOF='1';require('/tmp/cl-batch.cjs')"`,
  180,
);
process.stdout.write(run.stdout || "");
process.stderr.write((run.stderr || "").slice(0, 1000));
process.exit(run.status ?? 1);
