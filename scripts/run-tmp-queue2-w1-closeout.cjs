/**
 * Queue #2 Week 1 FINAL closeout — reach ~3500, stop.
 * Env: W1C_CL_BUDGET=200 W1C_CASE_TARGET=110
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const reportPath = path.join(root, "packages/research/corpus/reports/queue2-w1-closeout-ops.json");
const BUDGET = Math.min(Math.max(Number(process.env.W1C_CL_BUDGET || 200), 30), 220);
const CASE_TARGET = Math.min(Math.max(Number(process.env.W1C_CASE_TARGET || 110), 40), 140);
const COURT_CAP = 10;

function lastJson(text) {
  const lines = String(text || "").split(/\n/).map((l) => l.trim()).filter((l) => l.startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch { /* */ }
  }
  return null;
}
function remoteBusy() {
  const r = spawnSync("flyctl", ["machine", "exec", "811d3e3f522648", "-a", "nyayagrid-staging", "--timeout", "40", "ps -o pid,ppid,etime,args"], { encoding: "utf8", maxBuffer: 4e6 });
  return /staging-cl-batch-job-bundled|cl-batch-owner/.test(`${r.stdout || ""}\n${r.stderr || ""}`);
}
function flyNode(script, args, timeoutSec) {
  const r = spawnSync(process.execPath, [path.join(root, "scripts/run-tmp-fly-node.cjs"), script, ...args], {
    encoding: "utf8", maxBuffer: 20e6, cwd: root,
    env: { ...process.env, FLY_TOOL_TIMEOUT_SEC: String(timeoutSec), CL_HARD_TIMEOUT_MS: String(Math.min(timeoutSec * 1000 - 5000, 120000)) },
  });
  return { status: r.status ?? 1, text: `${r.stdout || ""}\n${r.stderr || ""}`, json: lastJson(`${r.stdout || ""}\n${r.stderr || ""}`) };
}
function hist(lane, court, gte, lte, take) {
  const disc = flyNode("scripts/tmp-queue2-s3-hist-discover-v2-bundled.cjs", [court, gte, lte, String(Math.max(take + 2, 8)), "search"], 90);
  let cl = Number(disc.json?.courtListenerHttpCalls || 0);
  if (disc.json?.status === "rate_limited") return { lane, court, gte, lte, imported: 0, cl, status: "429", rateLimited: true };
  let ids = (disc.json?.ids || []).map((x) => x.id).filter(Boolean);
  if (disc.json?.status === "HIST_QUERY_TIMEOUT") {
    const y = gte.slice(0, 4);
    const n = flyNode("scripts/tmp-queue2-s3-hist-discover-v2-bundled.cjs", [court, `${y}-01-01`, `${y}-12-31`, String(take), "search"], 90);
    cl += Number(n.json?.courtListenerHttpCalls || 0);
    ids = (n.json?.ids || []).map((x) => x.id).filter(Boolean);
    if (n.json?.status === "rate_limited") return { lane, court, gte, lte, imported: 0, cl, status: "429", rateLimited: true };
  }
  if (!ids.length) return { lane, court, gte, lte, imported: 0, cl, status: "empty" };
  const slice = ids.slice(0, take);
  const ing = flyNode("scripts/tmp-queue2-s3-hist-ingest-bundled.cjs", [court, slice.join(","), String(slice.length)], 240);
  cl += Number(ing.json?.courtListenerHttpCalls || 0);
  return { lane, court, gte, lte, imported: Number(ing.json?.imported || 0), cl, status: ing.json?.status || "unknown", rateLimited: ing.json?.status === "rate_limited", skipped: Number(ing.json?.skipped || 0) };
}

// Closeout plan: state hist primary, district secondary, cadc/cafc only. NO intermediate. NO empty-window circuits.
const PLAN = [
  // State historical — rotate deficit states (prioritize lower CL cost windows that worked)
  ["G2", "nj", "1990-01-01", "1999-12-31", 8],
  ["G2", "mich", "1990-01-01", "1999-12-31", 8],
  ["G2", "wash", "1990-01-01", "1999-12-31", 8],
  ["G2", "va", "1990-01-01", "1999-12-31", 8],
  ["G2", "la", "1990-01-01", "1999-12-31", 8],
  ["G2", "md", "1990-01-01", "1999-12-31", 8],
  ["G2", "ga", "1990-01-01", "1999-12-31", 8],
  ["G2", "ohio", "1970-01-01", "1979-12-31", 6],
  ["G2", "ky", "1970-01-01", "1979-12-31", 6],
  ["G2", "sc", "1995-01-01", "1999-12-31", 6],
  ["G2", "haw", "1995-01-01", "1999-12-31", 6],
  ["G2", "minn", "1995-01-01", "1999-12-31", 6],
  ["G2", "iowa", "1995-01-01", "1999-12-31", 6],
  ["G2", "nc", "1995-01-01", "1999-12-31", 6],
  ["G2", "nev", "1990-01-01", "1999-12-31", 6],
  // District — rotate courts less used last session
  ["DISTRICT_HIST", "dcd", "1990-01-01", "1999-12-31", 6],
  ["DISTRICT_HIST", "txnd", "1990-01-01", "1999-12-31", 6],
  ["DISTRICT_HIST", "nysd", "1990-01-01", "1999-12-31", 5],
  ["DISTRICT_HIST", "cacd", "1990-01-01", "1999-12-31", 5],
  ["DISTRICT_HIST", "njd", "2000-01-01", "2010-12-31", 5],
  ["DISTRICT_HIST", "paed", "2000-01-01", "2010-12-31", 5],
  ["DISTRICT_HIST", "mad", "2000-01-01", "2010-12-31", 5],
  ["DISTRICT_HIST", "flsd", "2000-01-01", "2010-12-31", 5],
  // Productive circuits only
  ["G3H", "cadc", "2000-01-01", "2010-12-31", 6],
  ["G3H", "cafc", "1990-01-01", "1999-12-31", 6],
  ["G3H", "cadc", "1970-01-01", "1979-12-31", 5],
  ["G3H", "cafc", "1980-01-01", "1989-12-31", 5],
  // More state fill if needed
  ["G2", "nj", "1980-01-01", "1989-12-31", 6],
  ["G2", "mich", "1980-01-01", "1989-12-31", 6],
  ["G2", "wash", "1980-01-01", "1989-12-31", 6],
  ["G2", "va", "1980-01-01", "1989-12-31", 6],
  ["G2", "md", "1980-01-01", "1989-12-31", 6],
  ["G2", "ga", "1980-01-01", "1989-12-31", 6],
  ["DISTRICT_HIST", "ilnd", "2000-01-01", "2010-12-31", 5],
  ["DISTRICT_HIST", "waed", "2000-01-01", "2010-12-31", 5],
  ["DISTRICT_HIST", "cand", "1990-01-01", "1999-12-31", 5],
  ["DISTRICT_HIST", "txsd", "2000-01-01", "2010-12-31", 5],
];

const acc = {
  classification: "MANUAL_QUEUE2_WEEK1_FINAL_CLOSEOUT_OPS",
  startedAt: new Date().toISOString(),
  budget: BUDGET,
  caseTarget: CASE_TARGET,
  totalCl: 0,
  totalImported: 0,
  byLane: {},
  perCourt: {},
  batches: [],
  stopReason: null,
  reliability: { "408": 0, "429": 0 },
  emptyWindows: 0,
};
if (remoteBusy()) {
  acc.stopReason = "remote_child_present";
  fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
  process.exit(2);
}

for (const [lane, court, gte, lte, take] of PLAN) {
  if (acc.totalCl >= BUDGET - 4) { acc.stopReason = "budget_exhausted"; break; }
  if (acc.totalImported >= CASE_TARGET) { acc.stopReason = "case_target_met"; break; }
  if ((acc.perCourt[court]?.imported || 0) >= COURT_CAP) continue;
  const L = acc.byLane[lane];
  if (L && L.imported >= 6 && L.cl / Math.max(L.imported, 1) > 3.5) {
    process.stdout.write(`SKIP_INEFF ${lane}\n`);
    continue;
  }
  // Skip lanes with too many empties relative to imports
  if (lane === "G3H" && acc.emptyWindows >= 3 && (acc.byLane.G3H?.imported || 0) < 4) {
    process.stdout.write("SKIP_EMPTY_FED\n");
    continue;
  }

  process.stdout.write(`\n=== ${lane} ${court} ${gte}..${lte} ===\n`);
  const row = hist(lane, court, gte, lte, take);
  acc.batches.push(row);
  acc.totalCl += row.cl || 0;
  acc.totalImported += row.imported || 0;
  if (row.status === "empty") acc.emptyWindows += 1;
  acc.byLane[lane] = acc.byLane[lane] || { imported: 0, cl: 0, batches: 0 };
  acc.byLane[lane].imported += row.imported || 0;
  acc.byLane[lane].cl += row.cl || 0;
  acc.byLane[lane].batches += 1;
  acc.perCourt[court] = acc.perCourt[court] || { imported: 0, cl: 0 };
  acc.perCourt[court].imported += row.imported || 0;
  acc.perCourt[court].cl += row.cl || 0;
  process.stdout.write(JSON.stringify({ lane, court, imported: row.imported, cl: row.cl, status: row.status, totalCl: acc.totalCl, totalImported: acc.totalImported }) + "\n");
  fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
  if (row.rateLimited || row.status === "429") {
    acc.reliability["429"] += 1;
    acc.stopReason = "429";
    break;
  }
}

acc.finishedAt = new Date().toISOString();
if (!acc.stopReason) acc.stopReason = "plan_complete";
fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
console.log("W1C_DONE " + JSON.stringify({ totalCl: acc.totalCl, totalImported: acc.totalImported, byLane: acc.byLane, stop: acc.stopReason }));
process.exit(acc.stopReason === "429" || String(acc.stopReason).includes("remote") ? 1 : 0);
