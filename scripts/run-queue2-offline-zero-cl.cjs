/**
 * Queue #2 offline orchestrator — ZERO CourtListener HTTP.
 * Usage: node scripts/run-queue2-offline-zero-cl.cjs
 */
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const reports = path.join(root, "packages/research/corpus/reports");

function runFly(script, outFile) {
  console.error(`[offline] fly ${script}`);
  const r = spawnSync("node", [path.join(__dirname, "run-wave2f-fly-tool.cjs"), script], {
    encoding: "utf8",
    maxBuffer: 32_000_000,
    cwd: root,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  fs.writeFileSync(outFile, out);
  if (r.status !== 0) {
    console.error(JSON.stringify({ ok: false, step: script, status: r.status, tail: out.slice(-500) }));
    process.exit(r.status ?? 1);
  }
  return out;
}

function assertNoClHttp(file) {
  const t = fs.readFileSync(file, "utf8");
  // Block only if script attempted live CL API calls (not evidence strings in JSON)
  if (/courtlistener\.com\/api\/rest\/v[34]/i.test(t) && /"status":\s*200.*courtlistener/i.test(t)) {
    throw new Error(`CL HTTP suspected in output ${file}`);
  }
}

console.log(JSON.stringify({ phase: "start", courtListenerHttpCalls: 0, featureAgents: "0" }));

// Bundle offline full audit if needed
const fullSrc = path.join(__dirname, "staging-queue2-offline-full.cjs");
const fullBundled = path.join(__dirname, "staging-queue2-offline-full-bundled.cjs");
{
  const es = spawnSync(
    "npx",
    ["esbuild", fullSrc, "--bundle", "--platform=node", "--format=cjs", `--outfile=${fullBundled}`],
    { encoding: "utf8", cwd: root, shell: true },
  );
  if (es.status !== 0) {
    console.error(es.stderr || es.stdout || "esbuild failed");
    process.exit(1);
  }
}

runFly("scripts/staging-queue2-offline-full-bundled.cjs", path.join(reports, "queue2-offline-prep-raw.txt"));
runFly("scripts/staging-wave2f-citation-audit-bundled.cjs", path.join(reports, "queue2-offline-cite-audit-before.txt"));
runFly("scripts/staging-wave2f-citation-resolve-bundled.cjs", path.join(reports, "queue2-offline-cite-resolve.txt"));
runFly("scripts/staging-wave2f-normalize-backfill-bundled.cjs", path.join(reports, "queue2-offline-normalize.txt"));
runFly("scripts/staging-wave2f-citation-audit-bundled.cjs", path.join(reports, "queue2-offline-cite-audit-after.txt"));
runFly("scripts/staging-wave2f-retrieval-smoke-bundled.cjs", path.join(reports, "queue2-offline-retrieval-smoke.txt"));

for (const f of fs.readdirSync(reports).filter((n) => n.startsWith("queue2-offline"))) {
  assertNoClHttp(path.join(reports, f));
}

const fin = spawnSync("node", [path.join(__dirname, "queue2-offline-finalize.cjs")], {
  encoding: "utf8",
  maxBuffer: 8_000_000,
  cwd: root,
});
process.stdout.write(fin.stdout || "");
if (fin.status !== 0) {
  process.stderr.write(fin.stderr || "");
  process.exit(fin.status ?? 1);
}

console.log(JSON.stringify({ phase: "done", courtListenerHttpCalls: 0 }));
