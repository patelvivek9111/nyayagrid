/**
 * Run a Wave 2F bundled staging script on nyayagrid-staging via fly machine exec.
 * Uploads bundled script via chunked base64 write (no GitHub push required).
 * Usage: node scripts/run-wave2f-fly-tool.cjs [bundledScriptPath]
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const script = process.argv[2] || "scripts/staging-wave2f-citation-audit-bundled.cjs";
const MACHINE = "811d3e3f522648";
const APP = "nyayagrid-staging";
const root = path.join(__dirname, "..");
const localBundled = path.join(root, script);
const remotePath = "/tmp/wave2f-tool.cjs";
const CHUNK = 8_000;

function flyExec(command, timeoutSec = 180) {
  const r = spawnSync("flyctl", ["machine", "exec", MACHINE, "-a", APP, "--timeout", String(timeoutSec), command], {
    encoding: "utf8",
    maxBuffer: 16_000_000,
    cwd: root,
    shell: false,
  });
  if (r.error) {
    return { status: 1, stdout: "", stderr: String(r.error.message || r.error) };
  }
  return r;
}

function uploadBundled(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(JSON.stringify({ ok: false, err: `missing ${filePath}` }));
    process.exit(1);
  }
  const b64 = fs.readFileSync(filePath).toString("base64");
  const chunks = [];
  for (let i = 0; i < b64.length; i += CHUNK) chunks.push(b64.slice(i, i + CHUNK));

  for (let i = 0; i < chunks.length; i += 1) {
    const part = chunks[i];
    const cmd =
      i === 0
        ? `node -e "require('fs').writeFileSync('${remotePath}',Buffer.from('${part}','base64'))"`
        : `node -e "require('fs').appendFileSync('${remotePath}',Buffer.from('${part}','base64'))"`;
    const w = flyExec(cmd, 90);
    if (w.status !== 0) {
      console.log(
        JSON.stringify({
          ok: false,
          step: "upload",
          chunk: i,
          status: w.status,
          err: (w.stderr || w.stdout || "").slice(0, 500),
        }),
      );
      process.exit(1);
    }
  }
}

uploadBundled(localBundled);
const r = flyExec(`node ${remotePath}`, 180);
process.stdout.write(r.stdout || "");
process.stderr.write((r.stderr || "").slice(0, 2000));
process.exit(r.status ?? 1);
