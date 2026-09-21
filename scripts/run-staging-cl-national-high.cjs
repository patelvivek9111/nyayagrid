/**
 * National highest-court sweep after Wave-1 (priority: no-high/appellate first).
 * Usage: node scripts/run-staging-cl-national-high.cjs [sha] [startCourt]
 * All CL traffic via batch job ClRateLimiter; VERIFIED mappings skip /courts/ re-hit.
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { getCourtEntry, shouldSkipIngest } = require("./cl-court-map-registry.cjs");

const sha = process.argv[2] || "HEAD";
const startCourt = (process.argv[3] || "la").toLowerCase();

/** Priority from wave2o-coverage-priority / verified mappings first. */
const PLAN = [
  { court: "la", target: 20, batch: 8 },
  { court: "dc", target: 20, batch: 8 },
  { court: "idaho", target: 20, batch: 8 },
  { court: "mo", target: 20, batch: 8 },
  { court: "miss", target: 20, batch: 8 },
];

const startIdx = Math.max(0, PLAN.findIndex((h) => h.court === startCourt));
const plan = PLAN.slice(startIdx < 0 ? 0 : startIdx);
const results = [];
const outPath = path.join(__dirname, "wave-national-high-results.json");

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
    { encoding: "utf8", maxBuffer: 16_000_000, env: process.env },
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

console.log(
  JSON.stringify({
    phase: "national_high_start",
    sha,
    plan: plan.map((p) => p.court),
    featureAgents: process.env.FEATURE_AGENTS || "0",
  }),
);

for (const item of plan) {
  const entry = getCourtEntry(item.court);
  const gate = shouldSkipIngest(entry);
  if (gate.skip) {
    const skipped = {
      ok: true,
      status: "skipped_mapping",
      reason: gate.reason,
      clCourt: item.court,
      courtListenerHttpCalls: 0,
    };
    console.log(JSON.stringify({ phase: "skip", ...skipped }));
    results.push({ court: item.court, round: 0, result: skipped });
    fs.writeFileSync(outPath, JSON.stringify({ ok: true, results }, null, 2));
    continue;
  }

  let rounds = 0;
  const maxRounds = Math.ceil(item.target / item.batch) + 8;
  while (rounds < maxRounds) {
    rounds += 1;
    console.log(JSON.stringify({ phase: "batch", court: item.court, round: rounds }));
    const { last } = runOne(item.court, item.batch, item.target);
    results.push({ court: item.court, round: rounds, result: last });
    fs.writeFileSync(outPath, JSON.stringify({ ok: true, results }, null, 2));

    const status = last?.status || last?.result?.status;
    const retrySec = Number(last?.lastRetryAfterSec ?? last?.result?.lastRetryAfterSec ?? 0);

    if (status === "quota_paused" || (status === "rate_limited" && retrySec > 300)) {
      console.log(
        JSON.stringify({
          ok: true,
          status: status === "quota_paused" ? "QUOTA SAFETY PAUSE" : "RATE LIMIT WINDOW REACHED",
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
      fs.writeFileSync(outPath, JSON.stringify({ stopped: status || "rate_limited", results }, null, 2));
      process.exit(0);
    }
    if (status === "mapping_invalid" || status === "transient_retry") {
      console.log(JSON.stringify({ ok: true, status, court: item.court, last }));
      break;
    }
    if (status === "rate_limited" && !(retrySec > 0)) {
      console.log(JSON.stringify({ phase: "soft_wait_ambiguous", court: item.court, waitMs: 15000 }));
      sleep(15_000);
      continue;
    }
    if (status === "completed" || status === "already_completed") break;
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
