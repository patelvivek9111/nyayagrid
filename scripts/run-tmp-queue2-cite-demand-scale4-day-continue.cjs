/**
 * Wait for CourtListener day reset, probe once, continue Scale4 US-dominant run.
 * Zero LLM. No acquisition during wait.
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");
const DAY_RESET = new Date(process.env.CITE_SCALE4_DAY_RESET || "2026-10-03T22:02:34.920900Z");
const HOUR_FLOOR = 25;
const DAY_FLOOR = 50;
const ADD_BUDGET = Math.min(Math.max(Number(process.env.CITE_SCALE4_ADD_BUDGET || 100), 20), 150);

function sleep(ms) {
  const chunk = 60_000;
  let left = ms;
  while (left > 0) {
    const w = Math.min(chunk, left);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, w);
    left -= w;
    process.stdout.write(`WAIT_DAY_RESET leftSec=${Math.ceil(left / 1000)}\n`);
  }
}

function lastJson(text) {
  const t = String(text || "");
  const start = t.lastIndexOf('{"ok"');
  if (start < 0) return null;
  let depth = 0;
  for (let k = start; k < t.length; k++) {
    if (t[k] === "{") depth++;
    else if (t[k] === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(t.slice(start, k + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

const now = Date.now();
const waitMs = Math.max(0, DAY_RESET.getTime() + 20_000 - now);
console.log(JSON.stringify({
  phase: "wait_day_reset",
  now: new Date(now).toISOString(),
  dayReset: DAY_RESET.toISOString(),
  waitMs,
}));
if (waitMs > 0) sleep(waitMs);

const probe = spawnSync(
  process.execPath,
  [path.join(ROOT, "scripts/run-wave2f-fly-tool.cjs"), "scripts/tmp-cl-api-usage-probe.cjs"],
  { encoding: "utf8", maxBuffer: 20e6, cwd: ROOT },
);
const q = lastJson(`${probe.stdout || ""}\n${probe.stderr || ""}`);
if (!q?.limits) {
  console.log(JSON.stringify({ ok: false, reason: "quota_parse_failed" }));
  process.exit(2);
}
const hourRem = Number(q.limits.hour.remaining);
const dayRem = Number(q.limits.day.remaining);
const safeAdd = Math.min(ADD_BUDGET, Math.max(0, hourRem - HOUR_FLOOR), Math.max(0, dayRem - DAY_FLOOR));
const opsPath = path.join(REPORTS, "queue2-cite-demand-scale4-ops.json");
const priorCl = fs.existsSync(opsPath) ? Number(JSON.parse(fs.readFileSync(opsPath, "utf8")).totalCl || 0) : 0;
const targetBudget = priorCl + safeAdd;

const snap = {
  ok: true,
  classification: "CITATION_DEMAND_ADAPTIVE_SCALE_4_QUOTA_DAY_CONTINUE",
  at: new Date().toISOString(),
  limits: q.limits,
  membership: q.membership || null,
  priorCl,
  safeAdd,
  targetBudget,
  hourFloor: HOUR_FLOOR,
  dayFloor: DAY_FLOOR,
};
fs.writeFileSync(path.join(REPORTS, "queue2-cite-demand-scale4-quota-day-continue.json"), JSON.stringify(snap, null, 2));
console.log("QUOTA_DAY_CONTINUE " + JSON.stringify({ hourRem, dayRem, safeAdd, priorCl, targetBudget }));

if (safeAdd < 20) {
  console.log(JSON.stringify({ ok: false, reason: "safe_add_too_small", safeAdd }));
  process.exit(3);
}

const run = spawnSync(process.execPath, [path.join(ROOT, "scripts/run-tmp-queue2-cite-demand-scale4.cjs")], {
  encoding: "utf8",
  maxBuffer: 80e6,
  cwd: ROOT,
  env: { ...process.env, CITE_SCALE4_BUDGET: String(targetBudget), CL_RATE_MS: "5000" },
  stdio: "inherit",
});
process.exit(run.status ?? 1);
