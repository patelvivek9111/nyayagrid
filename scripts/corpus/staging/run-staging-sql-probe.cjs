const { spawnSync } = require("node:child_process");
const { readFileSync, writeFileSync, existsSync, unlinkSync } = require("node:fs");
const path = require("node:path");

const scriptPath = path.join(__dirname, "staging-sql-probe.cjs");
const b64 = readFileSync(scriptPath).toString("base64");
// Write via machine exec in chunks if needed — probe is small.
const nodeWrite = `node -e "require('fs').writeFileSync('/tmp/staging-sql-probe.cjs',Buffer.from('${b64}','base64'))"`;
const write = spawnSync("flyctl", ["machine", "exec", "811d3e3f522648", "-a", "nyayagrid-staging", "--timeout", "60", nodeWrite], {
  encoding: "utf8",
  maxBuffer: 5_000_000,
});
if (write.status !== 0) {
  console.log(JSON.stringify({ ok: false, step: "write", status: write.status, err: (write.stderr || write.stdout || "").slice(0, 500) }));
  process.exit(1);
}
const run = spawnSync(
  "flyctl",
  ["machine", "exec", "811d3e3f522648", "-a", "nyayagrid-staging", "--timeout", "90", "node /tmp/staging-sql-probe.cjs"],
  { encoding: "utf8", maxBuffer: 5_000_000 },
);
process.stdout.write(run.stdout || "");
process.stderr.write((run.stderr || "").slice(0, 1000));
process.exit(run.status ?? 1);
