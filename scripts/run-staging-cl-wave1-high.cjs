/**
 * Wave-1 state HIGH courts only (no intermediate appellate).
 * Order: NY CA PA NJ FL TX IL MA VA DE
 * Respects soft Retry-After; hard-stops on rate_limited or Retry-After > 300.
 * Usage: node scripts/run-staging-cl-wave1-high.cjs [sha] [startCourt]
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const sha = process.argv[2] || "HEAD";
const startCourt = (process.argv[3] || "ny").toLowerCase();
const HIGH = [
  { court: "ny", target: 20, batch: 5 },
  { court: "cal", target: 20, batch: 5 },
  { court: "pa", target: 20, batch: 5 },
  { court: "nj", target: 20, batch: 5 },
  { court: "fla", target: 20, batch: 5 },
  { court: "tex", target: 20, batch: 5 },
  { court: "ill", target: 20, batch: 5 },
  { court: "mass", target: 20, batch: 5 },
  { court: "va", target: 20, batch: 5 },
  { court: "del", target: 20, batch: 5 },
];

const startIdx = Math.max(0, HIGH.findIndex((h) => h.court === startCourt));
const plan = HIGH.slice(startIdx < 0 ? 0 : startIdx);
const results = [];
const outPath = path.join(__dirname, "wave1-high-results.json");

function sleep(ms) {
  spawnSync(process.execPath, [
    "-e",
    `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${ms})`,
  ]);
}

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
      if (j.fileResult && j.fileResult.status) last = j.fileResult;
      else if (j.via === "db_checkpoint" && j.job && j.job.status) last = j.job;
      else if (j.result || j.status) last = j.result || j;
    } catch {
      // ignore
    }
  }
  process.stdout.write(r.stdout || "");
  process.stderr.write((r.stderr || "").slice(0, 400));
  return { exit: r.status, last };
}

console.log(JSON.stringify({ phase: "wave1_high_start", sha, plan: plan.map((p) => p.court) }));

for (const item of plan) {
  let rounds = 0;
  const maxRounds = Math.ceil(item.target / item.batch) + 6;
  while (rounds < maxRounds) {
    rounds += 1;
    console.log(JSON.stringify({ phase: "batch", court: item.court, round: rounds }));
    const { last } = runOne(item.court, item.batch, item.target);
    results.push({ court: item.court, round: rounds, result: last });
    fs.writeFileSync(outPath, JSON.stringify({ ok: true, results }, null, 2));

    const status = last?.status || last?.result?.status;
    const retrySec = Number(last?.lastRetryAfterSec ?? last?.result?.lastRetryAfterSec ?? 0);

    if (status === "rate_limited" || retrySec > 300) {
      console.log(
        JSON.stringify({
          ok: true,
          status: "RATE LIMIT WINDOW REACHED",
          court: item.court,
          retrySec,
          checkpoint: {
            cursor: last?.cursor ?? null,
            next_page_url: last?.next_page_url ?? null,
            lastRetryAfterSec: retrySec || null,
          },
          remaining: plan.map((p) => p.court).slice(plan.findIndex((p) => p.court === item.court)),
        }),
      );
      fs.writeFileSync(outPath, JSON.stringify({ stopped: "rate_limited", results }, null, 2));
      process.exit(0);
    }
    if (status === "completed") break;
    if (status === "failed" && last?.ok === false) {
      console.log(JSON.stringify({ ok: false, court: item.court, status: "failed", last }));
      break;
    }
    const waitMs = Math.max((retrySec > 0 ? retrySec + 5 : 10) * 1000, 10_000);
    console.log(JSON.stringify({ phase: "soft_wait", court: item.court, waitMs, retrySec }));
    sleep(waitMs);
  }
}

fs.writeFileSync(outPath, JSON.stringify({ ok: true, status: "plan_finished", results }, null, 2));
console.log(JSON.stringify({ ok: true, status: "plan_finished", courts: plan.length, resultsCount: results.length }));
process.exit(0);
