/**
 * Synchronous one-shot CL batch on Fly (stdout captured). Prefer for small batches.
 * Usage: node scripts/run-staging-cl-batch-sync.cjs <sha> <clCourt> [batchSize] [targetMax]
 */
const { spawnSync } = require("node:child_process");

const sha = process.argv[2];
const clCourt = (process.argv[3] || "").toLowerCase();
const batchSize = process.argv[4] || "2";
const targetMax = process.argv[5] || "12";
const MACHINE = "811d3e3f522648";
const APP = "nyayagrid-staging";
const url = `https://raw.githubusercontent.com/patelvivek9111/nyayagrid/${sha}/scripts/staging-cl-batch-job-bundled.cjs`;

if (!sha || !clCourt) {
  console.log(JSON.stringify({ ok: false, reason: "sha and clCourt required" }));
  process.exit(2);
}

spawnSync("flyctl", ["machine", "start", MACHINE, "-a", APP], { encoding: "utf8" });

const inner = [
  `fetch(${JSON.stringify(url)}).then(r=>{if(!r.ok)throw new Error('http_'+r.status);return r.text()})`,
  `.then(t=>{require('fs').writeFileSync('/tmp/staging-cl-batch-job-bundled.cjs',t);`,
  `process.env.CL_COURT=${JSON.stringify(clCourt)};`,
  `process.env.CL_BATCH_SIZE=${JSON.stringify(batchSize)};`,
  `process.env.CL_TARGET_MAX=${JSON.stringify(targetMax)};`,
  `process.env.CL_RATE_MS=process.env.CL_RATE_MS||'1200';`,
  `process.env.CL_PROOF='0';`,
  `require('/tmp/staging-cl-batch-job-bundled.cjs')})`,
  `.catch(e=>{console.log(JSON.stringify({ok:false,err:String(e.message||e)}));process.exit(1)})`,
].join("");

const cmd = `node -e ${JSON.stringify(inner)}`;

const r = spawnSync(
  "flyctl",
  ["machine", "exec", MACHINE, "-a", APP, "--timeout", "480", cmd],
  { encoding: "utf8", maxBuffer: 16_000_000 },
);
process.stdout.write(r.stdout || "");
process.stderr.write((r.stderr || "").slice(0, 1500));
process.exit(r.status ?? 1);
