const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const bundled = join(root, "scripts", "staging-sql-probe-bundled.cjs");

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 8_000_000, cwd: root, ...opts });
  return r;
}

const build = run("npx", [
  "esbuild",
  "scripts/staging-sql-probe-pg.ts",
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--outfile=scripts/staging-sql-probe-bundled.cjs",
]);
if (build.status !== 0) {
  console.error("esbuild failed", build.stderr || build.stdout);
  process.exit(1);
}
if (!existsSync(bundled)) {
  console.error("missing bundled file");
  process.exit(1);
}

// Prefer sftp put with a hard timeout via powershell job if needed.
const put = run(
  "flyctl",
  ["ssh", "sftp", "put", "scripts/staging-sql-probe-bundled.cjs", "/tmp/staging-sql-probe-bundled.cjs", "--app", "nyayagrid-staging"],
  { timeout: 120_000 },
);
console.error(
  JSON.stringify({
    putStatus: put.status,
    putErr: (put.stderr || "").slice(0, 300),
    putOut: (put.stdout || "").slice(0, 300),
  }),
);

const exec = run("flyctl", [
  "machine",
  "exec",
  "811d3e3f522648",
  "-a",
  "nyayagrid-staging",
  "--timeout",
  "120",
  "node /tmp/staging-sql-probe-bundled.cjs",
]);
process.stdout.write(exec.stdout || "");
process.stderr.write((exec.stderr || "").slice(0, 1000));
process.exit(exec.status ?? 1);
