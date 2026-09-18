/**
 * Wave 2I staging orchestrator: esbuild → fly exec → reports. No CL.
 */
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const reportsDir = path.join(root, "packages/research/corpus/reports");

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    encoding: "utf8",
    cwd: root,
    shell: true,
    maxBuffer: 32_000_000,
    ...opts,
  });
}

function esbuild(entry, outfile) {
  const r = run("npx", ["esbuild", entry, "--bundle", "--platform=node", "--format=cjs", `--outfile=${outfile}`]);
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    process.exit(r.status || 1);
  }
}

function flyTool(bundled, outJson) {
  const r = run("node", ["scripts/run-wave2f-fly-tool.cjs", bundled]);
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
run("node", ["scripts/generate-wave2i-bundles.cjs"]);
run("flyctl", ["machine", "start", "811d3e3f522648", "-a", "nyayagrid-staging"]);

const steps = [
  { entry: "scripts/staging-wave2i-import.cjs", bundled: "scripts/staging-wave2i-import-bundled.cjs", out: "wave2i-import.json" },
  { entry: "scripts/staging-wave2i-retrieval.cjs", bundled: "scripts/staging-wave2i-retrieval-bundled.cjs", out: "wave2i-retrieval.json" },
  { entry: "scripts/staging-wave2i-audit.cjs", bundled: "scripts/staging-wave2i-audit-bundled.cjs", out: "wave2i-audit.json" },
  { entry: "scripts/staging-wave2h-cl-resume-prep.cjs", bundled: "scripts/staging-wave2i-cl-resume-prep-bundled.cjs", out: "wave2i-cl-resume-prep.json" },
];

const summary = { ok: true, wave: "2I", steps: [] };
for (const step of steps) {
  console.error(`esbuild ${step.entry}`);
  esbuild(step.entry, step.bundled);
  console.error(`fly ${step.bundled}`);
  const json = flyTool(step.bundled, path.join(reportsDir, step.out));
  summary.steps.push({ out: step.out, ok: Boolean(json?.ok) });
  if (!json?.ok) summary.ok = false;
}

fs.writeFileSync(path.join(reportsDir, "wave2i-staging-orchestrator.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
process.exit(summary.ok ? 0 : 1);
