/**
 * Write staging-derived coverage matrix snippet from CL coverage probe JSON on stdin or file.
 * Also runs health + FEATURE_AGENTS check.
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const sha = process.argv[2] || "ad51c009b2f115e9a47716226152e71f06341957";
const coverageUrl = `https://raw.githubusercontent.com/patelvivek9111/nyayagrid/${sha}/scripts/staging-cl-coverage-probe-bundled.cjs`;

function fly(cmd, timeout = 180) {
  return spawnSync(
    "flyctl",
    ["machine", "exec", "811d3e3f522648", "-a", "nyayagrid-staging", "--timeout", String(timeout), cmd],
    { encoding: "utf8", maxBuffer: 16_000_000 },
  );
}

const health = spawnSync(
  "curl.exe",
  ["-sS", "https://nyayagrid-staging.fly.dev/api/health/ready"],
  { encoding: "utf8" },
);
let healthJson = null;
try {
  healthJson = JSON.parse(health.stdout || "{}");
} catch {
  healthJson = { raw: (health.stdout || "").slice(0, 300) };
}

const probeCmd = `node -e "fetch('${coverageUrl}').then(r=>{if(!r.ok)throw new Error('http_'+r.status);return r.text()}).then(t=>{require('fs').writeFileSync('/tmp/cl-cov.cjs',t); const {spawnSync}=require('child_process'); const r=spawnSync('node',['/tmp/cl-cov.cjs'],{encoding:'utf8',env:process.env,maxBuffer:16*1024*1024}); process.stdout.write(r.stdout||''); process.stderr.write((r.stderr||'').slice(0,500)); process.exit(r.status||0)}).catch(e=>{console.log(JSON.stringify({ok:false,err:String(e.message||e)}));process.exit(1)})"`;
const probe = fly(probeCmd, 180);
let cov = null;
try {
  cov = JSON.parse((probe.stdout || "").trim());
} catch {
  cov = { ok: false, raw: (probe.stdout || "").slice(0, 1000), err: (probe.stderr || "").slice(0, 400) };
}

const outPath = path.join(
  __dirname,
  "..",
  "packages",
  "research",
  "corpus",
  "reports",
  "wave2-staging-cl-coverage.json",
);
const report = {
  generatedAt: new Date().toISOString(),
  gitSha: sha,
  health: {
    status: health.status,
    featureAgents: healthJson?.featureAgents ?? healthJson?.features?.agents ?? null,
    ok: health.status === 0,
    body: healthJson,
  },
  coverage: cov,
  notes: [
    "CourtListener deepen is bounded live ingest — not full national case-law depth.",
    "Legal Research remains corpus-only (no general Web).",
    "FEATURE_AGENTS must remain 0.",
  ],
};
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: true, wrote: outPath, totals: cov?.totals, courtMapping: cov?.courtMapping, featureAgents: report.health.featureAgents }, null, 2));
