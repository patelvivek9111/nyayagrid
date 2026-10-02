/**
 * Week2 efficiency cont — underfilled 1990s state hist + proven districts.
 * Avoid already-mined 1970s Tier-A windows. Stricter: stop court after 1 empty OR cl>=6 & imp<=1.
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const reportPath = path.join(root, "packages/research/corpus/reports/queue2-w2e-cont-ops.json");
const BUDGET = Math.min(Math.max(Number(process.env.W2EC_CL_BUDGET || 220), 30), 250);
const CASE_TARGET = Math.min(Math.max(Number(process.env.W2EC_CASE_TARGET || 120), 30), 160);

function lastJson(text) {
  const lines = String(text || "").split(/\n/).map((l) => l.trim()).filter((l) => l.startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i--) { try { return JSON.parse(lines[i]); } catch { /* */ } }
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
  return { status: r.status ?? 1, json: lastJson(`${r.stdout || ""}\n${r.stderr || ""}`) };
}
function hist(lane, court, gte, lte, take) {
  const disc = flyNode("scripts/tmp-queue2-s3-hist-discover-v2-bundled.cjs", [court, gte, lte, String(Math.max(take + 2, 8)), "search"], 90);
  let cl = Number(disc.json?.courtListenerHttpCalls || 0);
  if (disc.json?.status === "rate_limited") return { lane, court, gte, lte, imported: 0, cl, status: "429", rateLimited: true, searchCl: cl, fetchCl: 0, skipped: 0 };
  let ids = (disc.json?.ids || []).map((x) => x.id).filter(Boolean);
  if (!ids.length) return { lane, court, gte, lte, imported: 0, cl, status: "empty", searchCl: cl, fetchCl: 0, skipped: 0 };
  const slice = ids.slice(0, take);
  const ing = flyNode("scripts/tmp-queue2-s3-hist-ingest-bundled.cjs", [court, slice.join(","), String(slice.length)], 240);
  const fetchCl = Number(ing.json?.courtListenerHttpCalls || 0);
  cl += fetchCl;
  return { lane, court, gte, lte, imported: Number(ing.json?.imported || 0), cl, searchCl: cl - fetchCl, fetchCl, status: ing.json?.status || "unknown", rateLimited: ing.json?.status === "rate_limited", skipped: Number(ing.json?.skipped || 0) };
}

// Underfilled / not yet tried this session — 1990–1999 and 2000–2010 only
const PLAN = [
  ["G2", "okla", "1990-01-01", "1999-12-31", 8],
  ["G2", "idaho", "1990-01-01", "1999-12-31", 8],
  ["G2", "neb", "1990-01-01", "1999-12-31", 8],
  ["G2", "or", "1990-01-01", "1999-12-31", 8],
  ["G2", "mo", "1990-01-01", "1999-12-31", 8],
  ["G2", "ark", "1990-01-01", "1999-12-31", 8],
  ["G2", "colo", "1990-01-01", "1999-12-31", 8],
  ["G2", "tenn", "1990-01-01", "1999-12-31", 8],
  ["G2", "haw", "1990-01-01", "1999-12-31", 8],
  ["G2", "sc", "1990-01-01", "1999-12-31", 8],
  ["G2", "ohio", "1990-01-01", "1999-12-31", 8],
  ["G2", "ky", "1990-01-01", "1999-12-31", 8],
  ["G2", "la", "1990-01-01", "1999-12-31", 8],
  ["G2", "md", "1990-01-01", "1999-12-31", 8],
  ["G2", "ga", "1990-01-01", "1994-12-31", 8],
  ["G2", "wash", "1995-01-01", "2004-12-31", 8],
  ["G2", "mich", "1995-01-01", "2004-12-31", 8],
  ["G2", "va", "1995-01-01", "2004-12-31", 8],
  ["G2", "iowa", "1995-01-01", "2004-12-31", 8],
  ["G2", "minn", "1995-01-01", "2004-12-31", 8],
  ["G2", "nj", "1995-01-01", "2004-12-31", 8],
  ["G2", "ala", "2000-01-01", "2010-12-31", 8],
  ["G2", "okla", "2000-01-01", "2010-12-31", 6],
  ["G2", "idaho", "2000-01-01", "2010-12-31", 6],
  ["DISTRICT", "flsd", "2000-01-01", "2009-12-31", 6],
  ["DISTRICT", "cand", "2000-01-01", "2009-12-31", 6],
  ["DISTRICT", "dcd", "2005-01-01", "2015-12-31", 6],
  ["DISTRICT", "ilnd", "2000-01-01", "2009-12-31", 6],
  ["DISTRICT", "nysd", "2000-01-01", "2009-12-31", 6],
  ["DISTRICT", "cacd", "2000-01-01", "2009-12-31", 6],
  ["G3H", "cadc", "2005-01-01", "2015-12-31", 6],
  ["G3H", "ca1", "1990-01-01", "1999-12-31", 6],
];

const acc = { classification: "MANUAL_WEEK2_EFFICIENCY_CONT_OPS", startedAt: new Date().toISOString(), budget: BUDGET, caseTarget: CASE_TARGET, totalCl: 0, totalImported: 0, byLane: {}, perCourt: {}, batches: [], circuitBreaks: [], rolling: [], stopReason: null, reliability: { "408": 0, "429": 0 } };
if (remoteBusy()) { acc.stopReason = "remote_child_present"; fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2)); process.exit(2); }

for (const [lane, court, gte, lte, take] of PLAN) {
  if (acc.totalCl >= BUDGET - 4) { acc.stopReason = "budget_exhausted"; break; }
  if (acc.totalImported >= CASE_TARGET) { acc.stopReason = "case_target_met"; break; }
  const s = acc.perCourt[court] || { imported: 0, cl: 0, consecutiveEmpty: 0 };
  if (s.consecutiveEmpty >= 1) { acc.circuitBreaks.push({ court, reason: "empty_once" }); continue; }
  if (s.cl >= 6 && s.imported <= 1) { acc.circuitBreaks.push({ court, reason: "low_yield" }); continue; }
  if (s.imported >= 3 && s.cl / s.imported > 3.5) { acc.circuitBreaks.push({ court, reason: "cl_per" }); continue; }
  if (s.imported >= 12) continue;

  process.stdout.write(`\n=== ${lane} ${court} ${gte}..${lte} ===\n`);
  const row = hist(lane, court, gte, lte, take);
  acc.batches.push(row);
  acc.totalCl += row.cl || 0;
  acc.totalImported += row.imported || 0;
  acc.byLane[lane] = acc.byLane[lane] || { imported: 0, cl: 0, batches: 0, searchCl: 0, fetchCl: 0, skipped: 0 };
  acc.byLane[lane].imported += row.imported || 0;
  acc.byLane[lane].cl += row.cl || 0;
  acc.byLane[lane].batches += 1;
  acc.byLane[lane].searchCl += row.searchCl || 0;
  acc.byLane[lane].fetchCl += row.fetchCl || 0;
  acc.byLane[lane].skipped += row.skipped || 0;
  acc.perCourt[court] = acc.perCourt[court] || { imported: 0, cl: 0, consecutiveEmpty: 0, skipped: 0 };
  acc.perCourt[court].imported += row.imported || 0;
  acc.perCourt[court].cl += row.cl || 0;
  acc.perCourt[court].skipped += row.skipped || 0;
  if ((row.imported || 0) === 0) acc.perCourt[court].consecutiveEmpty += 1; else acc.perCourt[court].consecutiveEmpty = 0;
  // High skip with low import = already-ingested waste → break court
  if ((row.skipped || 0) >= 4 && (row.imported || 0) <= 1) acc.perCourt[court].consecutiveEmpty = 1;

  acc.rolling.push({ cl: row.cl || 0, imp: row.imported || 0 });
  const overall = acc.totalImported ? +(acc.totalCl / acc.totalImported).toFixed(3) : null;
  process.stdout.write(JSON.stringify({ lane, court, imported: row.imported, skipped: row.skipped, cl: row.cl, searchCl: row.searchCl, fetchCl: row.fetchCl, status: row.status, totalCl: acc.totalCl, totalImported: acc.totalImported, overallClPer: overall }) + "\n");
  fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
  if (row.rateLimited || row.status === "429") { acc.reliability["429"] += 1; acc.stopReason = "429"; break; }
}
function roll(n) {
  const sl = acc.rolling.slice(-n);
  const cl = sl.reduce((s, x) => s + x.cl, 0), imp = sl.reduce((s, x) => s + x.imp, 0);
  return { cl, imp, clPer: imp ? +(cl / imp).toFixed(3) : null };
}
acc.efficiency = { overall: acc.totalImported ? +(acc.totalCl / acc.totalImported).toFixed(3) : null, rolling20: roll(20), priorSession: 3.17 };
acc.finishedAt = new Date().toISOString();
if (!acc.stopReason) acc.stopReason = "plan_complete";
fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
console.log("W2EC_DONE " + JSON.stringify({ totalCl: acc.totalCl, totalImported: acc.totalImported, byLane: acc.byLane, efficiency: acc.efficiency, stop: acc.stopReason }));
process.exit(acc.stopReason === "429" || String(acc.stopReason).includes("remote") ? 1 : 0);
