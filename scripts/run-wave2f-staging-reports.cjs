/**
 * Run Wave 2F citation audit + normalize backfill on staging; write corpus reports.
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const reportsDir = path.join(root, "packages", "research", "corpus", "reports");

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 16_000_000,
    cwd: root,
    shell: process.platform === "win32",
    ...opts,
  });
}

function bundle(entry, outfile) {
  const r = run("npx", ["esbuild", entry, "--bundle", "--platform=node", "--format=cjs", `--outfile=${outfile}`]);
  if (r.status !== 0) {
    console.error("esbuild failed:", r.stderr || r.stdout || r.error?.message);
    process.exit(1);
  }
}

bundle("scripts/staging-wave2f-citation-audit.cjs", "scripts/staging-wave2f-citation-audit-bundled.cjs");
bundle("scripts/staging-wave2f-normalize-backfill.cjs", "scripts/staging-wave2f-normalize-backfill-bundled.cjs");

const sha = run("git", ["rev-parse", "HEAD"]).stdout?.trim();

const auditRun = run("node", ["scripts/run-wave2f-fly-tool.cjs", "scripts/staging-wave2f-citation-audit-bundled.cjs"]);
const backfillRun = run("node", ["scripts/run-wave2f-fly-tool.cjs", "scripts/staging-wave2f-normalize-backfill-bundled.cjs"]);

let audit = null;
let backfill = null;
try {
  audit = JSON.parse((auditRun.stdout || "").trim());
} catch {
  audit = { ok: false, raw: (auditRun.stdout || "").slice(0, 2000), err: (auditRun.stderr || "").slice(0, 500) };
}
try {
  backfill = JSON.parse((backfillRun.stdout || "").trim());
} catch {
  backfill = { ok: false, raw: (backfillRun.stdout || "").slice(0, 2000), err: (backfillRun.stderr || "").slice(0, 500) };
}

const auditPath = path.join(reportsDir, "wave2f-citation-audit.json");
const backfillPath = path.join(reportsDir, "wave2f-normalize-backfill.json");

fs.mkdirSync(reportsDir, { recursive: true });
fs.writeFileSync(
  auditPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      gitSha: sha,
      stagingMachine: "811d3e3f522648",
      ...audit,
    },
    null,
    2,
  ),
);
fs.writeFileSync(
  backfillPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      gitSha: sha,
      stagingMachine: "811d3e3f522648",
      ...backfill,
    },
    null,
    2,
  ),
);

console.log(
  JSON.stringify(
    {
      ok: audit?.ok && backfill?.ok,
      wrote: [auditPath, backfillPath],
      citationGraph: audit?.citationGraph,
      families: audit?.families,
      whyUnresolved: audit?.whyUnresolved,
      backfill: {
        before: backfill?.before,
        after: backfill?.after,
        updated: backfill?.updated,
        candidates: backfill?.candidates,
      },
    },
    null,
    2,
  ),
);

process.exit(auditRun.status === 0 && backfillRun.status === 0 ? 0 : 1);
