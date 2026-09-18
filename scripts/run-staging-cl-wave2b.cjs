/**
 * Wave 2B orchestrator: short-batch courts with pause on rate_limited.
 * Usage: node scripts/run-staging-cl-wave2b.cjs <sha> [plan]
 * plan = federal | wave1 | all | ca11,cadc,...
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const sha = process.argv[2] || "HEAD";
const planArg = (process.argv[3] || "federal").toLowerCase();

const FEDERAL = [
  { court: "ca11", target: 15, batch: 5 },
  { court: "cadc", target: 15, batch: 5 },
  { court: "cafc", target: 15, batch: 5 },
  { court: "ca7", target: 15, batch: 5 },
  { court: "ca10", target: 15, batch: 5 },
];

const WAVE1 = [
  { court: "cal", target: 12, batch: 4 },
  { court: "calctapp", target: 10, batch: 4 },
  { court: "del", target: 10, batch: 4 },
  { court: "fla", target: 12, batch: 4 },
  { court: "fladistctapp", target: 10, batch: 4 },
  { court: "ill", target: 12, batch: 4 },
  { court: "illappct", target: 10, batch: 4 },
  { court: "mass", target: 12, batch: 4 },
  { court: "massappct", target: 10, batch: 4 },
  { court: "nj", target: 12, batch: 4 },
  { court: "njsuperct", target: 10, batch: 4 },
  { court: "ny", target: 12, batch: 4 },
  { court: "nyappdiv", target: 10, batch: 4 },
  { court: "pa", target: 12, batch: 4 },
  { court: "pasuperct", target: 10, batch: 4 },
  { court: "pacommwlth", target: 8, batch: 4 },
  { court: "tex", target: 12, batch: 4 },
  { court: "texcrimapp", target: 8, batch: 4 },
  { court: "texapp", target: 10, batch: 4 },
  { court: "va", target: 12, batch: 4 },
  { court: "vacapp", target: 10, batch: 4 },
];

function buildPlan() {
  if (planArg === "federal") return FEDERAL;
  if (planArg === "wave1") return WAVE1;
  if (planArg === "all") return [...FEDERAL, ...WAVE1];
  return planArg.split(",").filter(Boolean).map((court) => ({
    court: court.trim(),
    target: 12,
    batch: 4,
  }));
}

const plan = buildPlan();
const results = [];

function runOne(court, batch, target) {
  const r = spawnSync(
    process.execPath,
    [path.join(__dirname, "run-staging-cl-batch-job.cjs"), sha, court, String(batch), String(target)],
    { encoding: "utf8", maxBuffer: 16_000_000 },
  );
  const lines = (r.stdout || "").trim().split("\n").filter(Boolean);
  let last = null;
  for (const line of lines) {
    try {
      const j = JSON.parse(line);
      if (j.result || j.status || j.downloaded) last = j.result || j;
    } catch {
      // ignore
    }
  }
  process.stdout.write(r.stdout || "");
  process.stderr.write((r.stderr || "").slice(0, 500));
  return { exit: r.status, last };
}

console.log(JSON.stringify({ phase: "wave2b_start", sha, plan: plan.map((p) => p.court) }));

for (const item of plan) {
  let rounds = 0;
  const maxRounds = Math.ceil(item.target / item.batch) + 3;
  while (rounds < maxRounds) {
    rounds += 1;
    console.log(JSON.stringify({ phase: "batch", court: item.court, round: rounds }));
    const { last } = runOne(item.court, item.batch, item.target);
    results.push({ court: item.court, round: rounds, result: last });
    const status = last?.status || last?.result?.status;
    if (status === "rate_limited") {
      console.log(
        JSON.stringify({
          ok: true,
          status: "RATE LIMIT WINDOW REACHED",
          completedCourts: [...new Set(results.filter((r) => r.result?.status === "completed").map((r) => r.court))],
          partialCourt: item.court,
          checkpoint: {
            cursor: last?.cursor ?? last?.result?.cursor,
            next_page_url: last?.next_page_url ?? last?.result?.next_page_url,
            lastRetryAfterSec: last?.lastRetryAfterSec ?? last?.result?.lastRetryAfterSec,
          },
          remaining: plan.map((p) => p.court).slice(plan.findIndex((p) => p.court === item.court)),
        }),
      );
      fs.writeFileSync(
        path.join(__dirname, "wave2b-results.json"),
        JSON.stringify({ stopped: "rate_limited", results }, null, 2),
      );
      process.exit(0);
    }
    if (status === "completed") break;
    if (status === "failed" && last?.ok === false) break;
    // paused → continue same court
    spawnSync(process.execPath, [
      "-e",
      "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,8000)",
    ]);
  }
}

fs.writeFileSync(path.join(__dirname, "wave2b-results.json"), JSON.stringify({ ok: true, results }, null, 2));
console.log(JSON.stringify({ ok: true, status: "plan_finished", courts: plan.length, resultsCount: results.length }));
process.exit(0);
