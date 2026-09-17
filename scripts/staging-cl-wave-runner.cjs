/**
 * Runs on Fly staging after lean bundle is at /tmp/staging-cl-ingest-lean-bundled.cjs.
 * Env: CL_WAVE_PLAN = JSON array of {court,max} OR uses built-in Wave 2 defaults.
 * Writes /tmp/cl-wave-results.json progressively. Never prints secrets.
 */
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const DEFAULT_PLAN = [
  { court: "scotus", max: 40 },
  { court: "ca1", max: 15 },
  { court: "ca2", max: 15 },
  { court: "ca3", max: 15 },
  { court: "ca4", max: 15 },
  { court: "ca5", max: 15 },
  { court: "ca6", max: 15 },
  { court: "ca7", max: 15 },
  { court: "ca8", max: 15 },
  { court: "ca9", max: 15 },
  { court: "ca10", max: 15 },
  { court: "ca11", max: 15 },
  { court: "cadc", max: 15 },
  { court: "cafc", max: 15 },
  { court: "cal", max: 20 },
  { court: "calctapp", max: 15 },
  { court: "ny", max: 20 },
  { court: "nyappdiv", max: 15 },
  { court: "pa", max: 20 },
  { court: "pasuperct", max: 15 },
  { court: "tex", max: 20 },
  { court: "texapp", max: 15 },
  { court: "nj", max: 20 },
  { court: "njsuperct", max: 15 },
  { court: "fla", max: 20 },
  { court: "fladistctapp", max: 15 },
  { court: "ill", max: 20 },
  { court: "illappct", max: 15 },
  { court: "mass", max: 20 },
  { court: "massappct", max: 15 },
  { court: "va", max: 20 },
  { court: "vacapp", max: 15 },
  { court: "del", max: 15 },
];

function loadPlan() {
  if (process.env.CL_WAVE_PLAN?.trim()) {
    try {
      const parsed = JSON.parse(process.env.CL_WAVE_PLAN);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // fall through
    }
  }
  if (fs.existsSync("/tmp/cl-wave-plan.json")) {
    return JSON.parse(fs.readFileSync("/tmp/cl-wave-plan.json", "utf8"));
  }
  return DEFAULT_PLAN;
}

const plan = loadPlan();
const results = [];
const startedAt = new Date().toISOString();

function writeStatus(status) {
  fs.writeFileSync(
    "/tmp/cl-wave-results.json",
    JSON.stringify(
      {
        status,
        startedAt,
        at: new Date().toISOString(),
        completed: results.length,
        total: plan.length,
        results,
      },
      null,
      2,
    ),
  );
}

writeStatus("running");

for (const item of plan) {
  const court = String(item.court || "").toLowerCase();
  const max = Math.min(Math.max(Number(item.max) || 15, 1), 200);
  const env = {
    ...process.env,
    CL_COURT: court,
    CL_MAX: String(max),
    CL_PROOF: "0",
    CL_RATE_MS: process.env.CL_RATE_MS || "500",
  };
  const r = spawnSync(process.execPath, ["/tmp/staging-cl-ingest-lean-bundled.cjs"], {
    encoding: "utf8",
    env,
    maxBuffer: 32 * 1024 * 1024,
  });
  const out = (r.stdout || "").trim();
  let parsed = null;
  try {
    const lines = out.split("\n").filter(Boolean);
    parsed = JSON.parse(lines[lines.length - 1] || "{}");
  } catch {
    parsed = {
      ok: false,
      parseError: true,
      raw: out.slice(-800),
      stderr: (r.stderr || "").slice(-500),
    };
  }
  results.push({
    court,
    max,
    exit: r.status,
    ok: Boolean(parsed && parsed.ok),
    imported: parsed?.imported ?? null,
    skipped: parsed?.skipped ?? null,
    failed: parsed?.failed ?? null,
    quarantined: parsed?.quarantined ?? null,
    discovered: parsed?.discovered ?? null,
    parsed: parsed?.parsed ?? null,
    citationEdges: parsed?.citationEdges ?? null,
    treatmentSignals: parsed?.treatmentSignals ?? null,
    apiCalls: parsed?.apiCalls ?? null,
    unmappedCourts: parsed?.unmappedCourts ?? null,
    sample: parsed?.sample ?? null,
    reason: parsed?.reason ?? null,
  });
  writeStatus("running");
}

writeStatus("done");
console.log(
  JSON.stringify({
    ok: true,
    status: "done",
    completed: results.length,
    total: plan.length,
    importedSum: results.reduce((s, r) => s + (Number(r.imported) || 0), 0),
    skippedSum: results.reduce((s, r) => s + (Number(r.skipped) || 0), 0),
    failedSum: results.reduce((s, r) => s + (Number(r.failed) || 0), 0),
    apiCallsSum: results.reduce((s, r) => s + (Number(r.apiCalls) || 0), 0),
  }),
);
