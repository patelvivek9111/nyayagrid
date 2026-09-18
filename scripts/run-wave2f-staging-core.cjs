/**
 * Orchestrate Wave 2F staging: esbuild bundle → fly exec → write reports.
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const reportsDir = path.join(root, "packages/research/corpus/reports");

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    cwd: root,
    shell: true,
    maxBuffer: 32_000_000,
    ...opts,
  });
  return r;
}

function esbuild(entry, outfile) {
  const r = run("npx", [
    "esbuild",
    entry,
    "--bundle",
    "--platform=node",
    "--format=cjs",
    `--outfile=${outfile}`,
  ]);
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    process.exit(r.status || 1);
  }
}

function flyTool(bundled, outJson) {
  const r = run("node", ["scripts/run-wave2f-fly-tool.cjs", bundled], {
    env: process.env,
  });
  const stdout = r.stdout || "";
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end < start) {
    fs.writeFileSync(
      outJson,
      JSON.stringify({ ok: false, err: "no_json", status: r.status, stderr: (r.stderr || "").slice(0, 1000) }, null, 2),
    );
    return { ok: false };
  }
  const json = JSON.parse(stdout.slice(start, end + 1));
  fs.writeFileSync(outJson, JSON.stringify(json, null, 2));
  return json;
}

fs.mkdirSync(reportsDir, { recursive: true });

const steps = [
  {
    entry: "scripts/staging-wave2f-import-rules.cjs",
    bundled: "scripts/staging-wave2f-import-rules-bundled.cjs",
    out: path.join(reportsDir, "wave2f-import-rules.json"),
  },
  {
    entry: "scripts/staging-wave2f-citation-resolve.cjs",
    bundled: "scripts/staging-wave2f-citation-resolve-bundled.cjs",
    out: path.join(reportsDir, "wave2f-citation-resolve.json"),
  },
  {
    entry: "scripts/staging-wave2f-live-refresh.cjs",
    bundled: "scripts/staging-wave2f-live-refresh-bundled.cjs",
    out: path.join(reportsDir, "wave2f-live-refresh.json"),
  },
  {
    entry: "scripts/staging-wave2f-citation-audit.cjs",
    bundled: "scripts/staging-wave2f-citation-audit-bundled.cjs",
    out: path.join(reportsDir, "wave2f-citation-audit.json"),
  },
  {
    entry: "scripts/staging-wave2f-retrieval-smoke.cjs",
    bundled: "scripts/staging-wave2f-retrieval-smoke-bundled.cjs",
    out: path.join(reportsDir, "wave2f-retrieval-smoke.json"),
  },
];

const summary = { ok: true, steps: [] };
for (const step of steps) {
  console.error(`esbuild ${step.entry}`);
  esbuild(step.entry, step.bundled);
  console.error(`fly ${step.bundled}`);
  const json = flyTool(step.bundled, step.out);
  summary.steps.push({ out: path.basename(step.out), ok: Boolean(json?.ok) });
  if (!json?.ok) summary.ok = false;
}

fs.writeFileSync(path.join(reportsDir, "wave2f-staging-orchestrator.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
process.exit(summary.ok ? 0 : 1);
