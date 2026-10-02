/**
 * Short Week2 scale continuation — proven districts + cadc/ca1 only.
 * Strict micro-pilot; stop on 429 or efficiency break.
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const reportPath = path.join(root, "packages/research/corpus/reports/queue2-w2s-cont-ops.json");
const BUDGET = Math.min(Math.max(Number(process.env.W2SC_CL_BUDGET || 14), 5), 20);
const CASE_TARGET = Math.min(Math.max(Number(process.env.W2SC_CASE_TARGET || 8), 3), 15);

function lastJson(text) {
  const lines = String(text || "").split(/\n/).map((l) => l.trim()).filter((l) => l.startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i--) { try { return JSON.parse(lines[i]); } catch { /* */ } }
  return null;
}
function flyNode(script, args, timeoutSec) {
  const r = spawnSync(process.execPath, [path.join(root, "scripts/run-tmp-fly-node.cjs"), script, ...args], {
    encoding: "utf8", maxBuffer: 20e6, cwd: root,
    env: { ...process.env, FLY_TOOL_TIMEOUT_SEC: String(timeoutSec), CL_HARD_TIMEOUT_MS: String(Math.min(timeoutSec * 1000 - 5000, 120000)) },
  });
  return { status: r.status ?? 1, json: lastJson(`${r.stdout || ""}\n${r.stderr || ""}`) };
}
function hist(lane, court, gte, lte, take) {
  const disc = flyNode("scripts/tmp-queue2-s3-hist-discover-v2-bundled.cjs", [court, gte, lte, String(Math.max(take + 2, 6)), "search"], 90);
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

// Only proven productive district/circuit windows; tiny take for remaining hour scrap
const PLAN = [
  ["DISTRICT", "cand", "2010-01-01", "2019-12-31", 4],
  ["DISTRICT", "dcd", "2010-01-01", "2019-12-31", 4],
  ["DISTRICT", "flsd", "2010-01-01", "2019-12-31", 4],
  ["G3H", "cadc", "2000-01-01", "2010-12-31", 4],
];

const acc = { classification: "MANUAL_WEEK2_HIGH_EFFICIENCY_SCALE_CONT", startedAt: new Date().toISOString(), budget: BUDGET, caseTarget: CASE_TARGET, totalCl: 0, totalImported: 0, byLane: {}, perCourt: {}, batches: [], circuitBreaks: [], rolling: [], stopReason: null, reliability: { "408": 0, "429": 0 } };

for (const [lane, court, gte, lte, take] of PLAN) {
  if (acc.totalCl >= BUDGET - 1) { acc.stopReason = "budget_exhausted"; break; }
  if (acc.totalImported >= CASE_TARGET) { acc.stopReason = "case_target_met"; break; }
  const s = acc.perCourt[court] || { imported: 0, cl: 0, consecutiveEmpty: 0 };
  if (s.consecutiveEmpty >= 1) continue;
  if (s.cl >= 5 && s.imported <= 1) { acc.circuitBreaks.push({ court, reason: "low_yield" }); continue; }

  process.stdout.write(`\n=== ${lane} ${court} ${gte}..${lte} ===\n`);
  const row = hist(lane, court, gte, lte, take);
  acc.batches.push(row);
  acc.totalCl += row.cl || 0;
  acc.totalImported += row.imported || 0;
  acc.byLane[lane] = acc.byLane[lane] || { imported: 0, cl: 0, batches: 0, searchCl: 0, fetchCl: 0 };
  acc.byLane[lane].imported += row.imported || 0;
  acc.byLane[lane].cl += row.cl || 0;
  acc.byLane[lane].batches += 1;
  acc.byLane[lane].searchCl += row.searchCl || 0;
  acc.byLane[lane].fetchCl += row.fetchCl || 0;
  acc.perCourt[court] = acc.perCourt[court] || { imported: 0, cl: 0, consecutiveEmpty: 0 };
  acc.perCourt[court].imported += row.imported || 0;
  acc.perCourt[court].cl += row.cl || 0;
  if ((row.imported || 0) === 0) acc.perCourt[court].consecutiveEmpty += 1;
  acc.rolling.push({ cl: row.cl || 0, imp: row.imported || 0 });
  const overall = acc.totalImported ? +(acc.totalCl / acc.totalImported).toFixed(3) : null;
  process.stdout.write(JSON.stringify({ lane, court, imported: row.imported, skipped: row.skipped, cl: row.cl, status: row.status, totalCl: acc.totalCl, totalImported: acc.totalImported, overallClPer: overall }) + "\n");
  fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
  if (row.rateLimited || row.status === "429") { acc.reliability["429"] += 1; acc.stopReason = "429"; break; }
  if (acc.totalImported && acc.totalCl / acc.totalImported > 3.0) { acc.stopReason = "efficiency_breaker"; break; }
}
acc.efficiency = { overall: acc.totalImported ? +(acc.totalCl / acc.totalImported).toFixed(3) : null };
acc.finishedAt = new Date().toISOString();
if (!acc.stopReason) acc.stopReason = "plan_complete";
fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
console.log("W2SC_DONE " + JSON.stringify({ totalCl: acc.totalCl, totalImported: acc.totalImported, byLane: acc.byLane, efficiency: acc.efficiency, stop: acc.stopReason }));
process.exit(acc.stopReason === "429" ? 1 : 0);
