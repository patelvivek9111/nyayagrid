const { spawnSync } = require("node:child_process");

const sha = process.argv[2] || "56168d10e4fc9a71899ce9fda888d81f9bc6afb2";
const court = process.argv[3] || "scotus";
const max = process.argv[4] || "2";
const proof = process.argv[5] || "1";
const url = `https://raw.githubusercontent.com/patelvivek9111/nyayagrid/${sha}/scripts/staging-cl-ingest-lean-bundled.cjs`;

function flyExec(command, timeoutSec = 120) {
  const r = spawnSync(
    "flyctl",
    ["machine", "exec", "811d3e3f522648", "-a", "nyayagrid-staging", "--timeout", String(timeoutSec), command],
    { encoding: "utf8", maxBuffer: 16_000_000 },
  );
  return r;
}

spawnSync("curl.exe", ["-sS", "--max-time", "20", "https://nyayagrid-staging.fly.dev/api/health/live"], {
  encoding: "utf8",
});

const dl = flyExec(
  `node -e "fetch('${url}').then(r=>{if(!r.ok)throw new Error('http_'+r.status);return r.text()}).then(t=>{require('fs').writeFileSync('/tmp/staging-cl-ingest-lean-bundled.cjs',t); console.log(JSON.stringify({downloaded:true,bytes:t.length}))}).catch(e=>{console.log(JSON.stringify({ok:false,err:String(e.message||e)}));process.exit(1)})"`,
  90,
);
process.stdout.write(dl.stdout || "");
process.stderr.write((dl.stderr || "").slice(0, 400));
if (dl.status !== 0) process.exit(dl.status ?? 1);

const run = flyExec(
  `node -e "process.env.CL_COURT='${court}'; process.env.CL_MAX='${max}'; process.env.CL_PROOF='${proof}'; process.env.CL_RATE_MS='500'; require('/tmp/staging-cl-ingest-lean-bundled.cjs')"`,
  proof === "1" ? 180 : 600,
);
process.stdout.write(run.stdout || "");
process.stderr.write((run.stderr || "").slice(0, 1500));
process.exit(run.status ?? 1);
