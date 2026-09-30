/**
 * Session 5 continuation — recent district oneshots only (no hist re-run).
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const reportPath = path.join(root, "packages/research/corpus/reports/queue2-s5-district-r3.json");
const BUDGET = Math.min(Math.max(Number(process.env.S5_DIST_BUDGET || 60), 10), 150);

const PLAN = [
  { clCourt: "txsd", batchSize: "5", targetMax: "14", maxCalls: "14", tag: "s5r3-txsd" },
  { clCourt: "njd", batchSize: "5", targetMax: "12", maxCalls: "14", tag: "s5r3-njd" },
  { clCourt: "paed", batchSize: "5", targetMax: "12", maxCalls: "14", tag: "s5r3-paed" },
  { clCourt: "mad", batchSize: "5", targetMax: "12", maxCalls: "14", tag: "s5r3-mad" },
  { clCourt: "flsd", batchSize: "5", targetMax: "12", maxCalls: "14", tag: "s5r3-flsd" },
  { clCourt: "txnd", batchSize: "5", targetMax: "10", maxCalls: "14", tag: "s5r3-txnd" },
  { clCourt: "waed", batchSize: "5", targetMax: "10", maxCalls: "14", tag: "s5r3-waed" },
  { clCourt: "cand", batchSize: "5", targetMax: "10", maxCalls: "14", tag: "s5r3-cand" },
  { clCourt: "ilnd", batchSize: "4", targetMax: "14", maxCalls: "12", tag: "s5r3-ilnd" },
];

function lastJson(text) {
  const lines = String(text || "").split(/\n/).map((l) => l.trim()).filter((l) => l.startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try { return JSON.parse(lines[i]); } catch { /* keep */ }
  }
  return null;
}
function remoteBusy() {
  const r = spawnSync("flyctl", ["machine", "exec", "811d3e3f522648", "-a", "nyayagrid-staging", "--timeout", "40", "ps -o pid,ppid,etime,args"], { encoding: "utf8", maxBuffer: 4_000_000 });
  return /staging-cl-batch-job-bundled|cl-batch-owner/.test(`${r.stdout || ""}\n${r.stderr || ""}`);
}

const acc = { classification: "MANUAL_QUEUE2_S5_DISTRICT_R3", startedAt: new Date().toISOString(), budget: BUDGET, batches: [], totalCl: 0, totalImported: 0, stopReason: null };
if (remoteBusy()) { acc.stopReason = "remote_child_present"; fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2)); process.exit(2); }

for (const step of PLAN) {
  if (acc.totalCl >= BUDGET - 3) { acc.stopReason = "budget_exhausted"; break; }
  process.stdout.write(`\n=== ${step.tag} ===\n`);
  const maxCalls = String(Math.min(Number(step.maxCalls), Math.max(BUDGET - acc.totalCl, 4)));
  const r = spawnSync(process.execPath, ["scripts/run-tmp-manual-cl-oneshot.cjs", step.clCourt, step.batchSize, step.targetMax, maxCalls, step.tag], {
    encoding: "utf8", maxBuffer: 20_000_000, cwd: root,
    env: { ...process.env, CL_FLY_EXEC_TIMEOUT_SEC: "540", CL_RATE_MS: "2500", CL_KEEP_DATE_FILTER: "0", CL_ORPHAN_WAIT_MS: "60000" },
  });
  const text = `${r.stdout || ""}\n${r.stderr || ""}`;
  const j = lastJson(text);
  const fr = j?.fileResult || j || {};
  const cl = Number(fr.sessionApiCalls ?? fr.apiCalls ?? 0);
  const imported = Number(fr.items_imported ?? fr.itemsImported ?? 0);
  const status = fr.status || j?.status || j?.reason || "unknown";
  const row = { court: step.clCourt, cl, imported, status, exit: r.status ?? 1 };
  acc.batches.push(row);
  acc.totalCl += cl;
  acc.totalImported += imported;
  process.stdout.write(`${JSON.stringify(row)}\n`);
  fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
  if (status === "rate_limited" || /\b429\b/.test(text)) { acc.stopReason = "429"; break; }
  if (/408|HIST_QUERY_TIMEOUT|ORPHAN|LANE_A_CHILD/.test(text)) { acc.stopReason = "408_or_orphan_stop"; break; }
}
acc.finishedAt = new Date().toISOString();
if (!acc.stopReason) acc.stopReason = "plan_complete";
fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
process.stdout.write(`\nR3_DONE ${JSON.stringify({ totalCl: acc.totalCl, totalImported: acc.totalImported, stop: acc.stopReason })}\n`);
process.exit(acc.stopReason === "429" || String(acc.stopReason).startsWith("408") ? 1 : 0);
