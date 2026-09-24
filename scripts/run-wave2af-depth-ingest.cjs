/**
 * Wave 2AF — Authority-depth Wave 1 ingest.
 * Top 5: LA → DC → NV → TN → MT
 * Historical high-court deepen (+25 cases each, target_max=45).
 * No intermediate discovery (no VERIFIED IDs). Skip pacommwlth/njsuperct/vacapp.
 *
 * Usage: node scripts/run-wave2af-depth-ingest.cjs [startCourt]
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const startCourt = (process.argv[2] || "la").toLowerCase();
const root = path.join(__dirname, "..");
const outPath = path.join(root, "packages/research/corpus/reports/wave2af-depth-ingest.json");

const PLAN = [
  { court: "la", j: "LA", target: 45, batch: 8, dateLte: "2018-12-31", dateGte: "" },
  { court: "dc", j: "DC", target: 45, batch: 8, dateLte: "2018-12-31", dateGte: "" },
  { court: "nev", j: "NV", target: 45, batch: 8, dateLte: "2018-12-31", dateGte: "" },
  { court: "tenn", j: "TN", target: 45, batch: 8, dateLte: "2015-12-31", dateGte: "" },
  { court: "mont", j: "MT", target: 45, batch: 8, dateLte: "2018-12-31", dateGte: "" },
];

const startIdx = Math.max(
  0,
  PLAN.findIndex((h) => h.court === startCourt),
);
const plan = PLAN.slice(startIdx < 0 ? 0 : startIdx);

function runOne(item) {
  const env = {
    ...process.env,
    CL_DAY_TARGET: process.env.CL_DAY_TARGET || "1160",
    CL_HOUR_TARGET: process.env.CL_HOUR_TARGET || "280",
    CL_RATE_MS: process.env.CL_RATE_MS || "2200",
  };
  if (item.dateLte) env.CL_DATE_FILED_LTE = item.dateLte;
  if (item.dateGte) env.CL_DATE_FILED_GTE = item.dateGte;

  const r = spawnSync(
    process.execPath,
    [path.join(__dirname, "run-staging-cl-batch-job.cjs"), "HEAD", item.court, String(item.batch), String(item.target)],
    { encoding: "utf8", cwd: root, env, maxBuffer: 32_000_000 },
  );
  const lines = (r.stdout || "")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { raw: l };
      }
    });
  let last = null;
  for (const j of lines) {
    if (j.fileResult && j.fileResult.status) last = j.fileResult;
    else if (j.via === "db_checkpoint" && j.job && j.job.status) last = j.job;
    else if (j.result || j.status) last = j.result || j;
  }
  return { exit: r.status, last, lines: lines.slice(-8), stderr: (r.stderr || "").slice(0, 500) };
}

const results = [];
console.log(
  JSON.stringify({
    ok: true,
    wave: "2AF",
    plan: plan.map((p) => p.court),
    startCourt,
    featureAgents: "0",
  }),
);

for (const item of plan) {
  console.log(JSON.stringify({ phase: "start", court: item.court, j: item.j, target: item.target, dateLte: item.dateLte }));
  let rounds = 0;
  let done = false;
  while (!done && rounds < 20) {
    rounds += 1;
    const { last, exit, stderr } = runOne(item);
    results.push({ court: item.court, j: item.j, round: rounds, result: last, exit, stderr: stderr || undefined });
    console.log(JSON.stringify({ court: item.court, round: rounds, status: last?.status, imported: last?.items_imported, apiCalls: last?.apiCalls ?? last?.api_calls }));

    const status = last?.status || last?.result?.status;
    const retrySec = Number(last?.lastRetryAfterSec ?? last?.result?.lastRetryAfterSec ?? 0);

    if (status === "completed" || status === "already_completed") {
      done = true;
      break;
    }
    if (status === "quota_paused" || status === "rate_limited") {
      console.log(
        JSON.stringify({
          ok: true,
          status,
          court: item.court,
          reason: last?.reason,
          lastRetryAfterSec: retrySec || null,
          remaining: plan.map((p) => p.court).slice(plan.findIndex((p) => p.court === item.court)),
        }),
      );
      fs.writeFileSync(outPath, JSON.stringify({ ok: true, status, results }, null, 2));
      process.exit(0);
    }
    if (status === "failed" && last?.ok === false) {
      console.log(JSON.stringify({ ok: false, court: item.court, status: "failed", last }));
      fs.writeFileSync(outPath, JSON.stringify({ ok: false, status: "failed", results }, null, 2));
      process.exit(1);
    }
    if (exit !== 0 && !last) {
      // Upload/poll flake — retry same court rather than aborting the wave.
      console.log(JSON.stringify({ ok: true, court: item.court, status: "retry_after_runner_exit", exit, stderr }));
      continue;
    }
    // paused / partial — continue rounds
  }
}

fs.writeFileSync(outPath, JSON.stringify({ ok: true, status: "plan_finished", results }, null, 2));
console.log(JSON.stringify({ ok: true, status: "plan_finished", courts: plan.length, resultsCount: results.length }));
