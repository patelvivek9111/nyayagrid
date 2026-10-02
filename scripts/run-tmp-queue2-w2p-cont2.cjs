/**
 * Week2 productive expansion CONT2 — finish remaining Tier A courts within leftover quota.
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const reportPath = path.join(root, "packages/research/corpus/reports/queue2-w2p-cont2-ops.json");
const BUDGET = Math.min(Math.max(Number(process.env.W2PC2_CL_BUDGET || 50), 15), 80);
const CASE_TARGET = Math.min(Math.max(Number(process.env.W2PC2_CASE_TARGET || 25), 8), 40);

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
  const disc = flyNode("scripts/tmp-queue2-s3-hist-discover-v2-bundled.cjs", [court, gte, lte, String(Math.max(take + 2, 8)), "search"], 90);
  let cl = Number(disc.json?.courtListenerHttpCalls || 0);
  if (disc.json?.status === "rate_limited") return { lane, court, gte, lte, imported: 0, cl, status: "429", rateLimited: true, searchCl: cl, fetchCl: 0, skipped: 0 };
  const ids = (disc.json?.ids || []).map((x) => x.id).filter(Boolean);
  if (!ids.length) return { lane, court, gte, lte, imported: 0, cl, status: "empty", searchCl: cl, fetchCl: 0, skipped: 0 };
  const slice = ids.slice(0, take);
  const ing = flyNode("scripts/tmp-queue2-s3-hist-ingest-bundled.cjs", [court, slice.join(","), String(slice.length)], 240);
  const fetchCl = Number(ing.json?.courtListenerHttpCalls || 0);
  cl += fetchCl;
  return { lane, court, gte, lte, imported: Number(ing.json?.imported || 0), cl, searchCl: cl - fetchCl, fetchCl, status: ing.json?.status || "unknown", rateLimited: ing.json?.status === "rate_limited", skipped: Number(ing.json?.skipped || 0) };
}

const PLAN = [
  ["G2", "nh", "1990-01-01", "1994-12-31", 6],
  ["G2", "nh", "1980-01-01", "1989-12-31", 8],
  ["G2", "ri", "1990-01-01", "1994-12-31", 6],
  ["G2", "ri", "1980-01-01", "1989-12-31", 8],
  ["G2", "sd", "1990-01-01", "1994-12-31", 6],
  ["G2", "nd", "1990-01-01", "1994-12-31", 6],
  ["G2", "mont", "1990-01-01", "1994-12-31", 6],
  ["G2", "miss", "1990-01-01", "1994-12-31", 6],
  ["G2", "wyo", "1990-01-01", "1994-12-31", 6],
];

const acc = { classification: "MANUAL_WEEK2_PRODUCTIVE_STATE_EXPANSION_CONT2", startedAt: new Date().toISOString(), budget: BUDGET, caseTarget: CASE_TARGET, totalCl: 0, totalImported: 0, byLane: {}, perCourt: {}, batches: [], quarantined: [], rolling: [], stopReason: null, reliability: { "408": 0, "429": 0 }, waste: { empty: 0, rehit: 0 } };
const banned = new Set();

for (const [lane, court, gte, lte, take] of PLAN) {
  if (acc.totalCl >= BUDGET - 3) { acc.stopReason = "budget_exhausted"; break; }
  if (acc.totalImported >= CASE_TARGET) { acc.stopReason = "case_target_met"; break; }
  if (banned.has(court)) continue;
  const s = acc.perCourt[court] || { imported: 0, cl: 0 };
  if (s.cl >= 6 && s.imported <= 1) { banned.add(court); continue; }

  process.stdout.write(`\n=== ${lane} ${court} ${gte}..${lte} ===\n`);
  const row = hist(lane, court, gte, lte, take);
  acc.batches.push(row);
  acc.totalCl += row.cl || 0;
  acc.totalImported += row.imported || 0;
  acc.byLane[lane] = acc.byLane[lane] || { imported: 0, cl: 0, batches: 0 };
  acc.byLane[lane].imported += row.imported || 0;
  acc.byLane[lane].cl += row.cl || 0;
  acc.byLane[lane].batches += 1;
  acc.perCourt[court] = acc.perCourt[court] || { imported: 0, cl: 0 };
  acc.perCourt[court].imported += row.imported || 0;
  acc.perCourt[court].cl += row.cl || 0;
  if (row.status === "empty" || ((row.imported || 0) === 0 && (row.cl || 0) >= 5)) {
    banned.add(court);
    acc.quarantined.push({ court, window: `${court}|${gte}|${lte}`, reason: row.status === "empty" ? "empty" : "zero_yield" });
    if (row.status === "empty") acc.waste.empty += row.cl || 0;
  }
  acc.rolling.push({ cl: row.cl || 0, imp: row.imported || 0 });
  const overall = acc.totalImported ? +(acc.totalCl / acc.totalImported).toFixed(3) : null;
  process.stdout.write(JSON.stringify({ court, gte, imported: row.imported, cl: row.cl, status: row.status, totalCl: acc.totalCl, totalImported: acc.totalImported, overallClPer: overall }) + "\n");
  fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
  if (row.rateLimited || row.status === "429") { acc.reliability["429"] += 1; acc.stopReason = "429"; break; }
  if (acc.totalImported && acc.totalCl / acc.totalImported > 2.9 && acc.totalCl >= 20) { acc.stopReason = "efficiency_breaker"; break; }
}
acc.efficiency = { overall: acc.totalImported ? +(acc.totalCl / acc.totalImported).toFixed(3) : null };
acc.finishedAt = new Date().toISOString();
if (!acc.stopReason) acc.stopReason = "plan_complete";
fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
console.log("W2PC2_DONE " + JSON.stringify({ totalCl: acc.totalCl, totalImported: acc.totalImported, efficiency: acc.efficiency, stop: acc.stopReason, reliability: acc.reliability }));
process.exit(acc.stopReason === "429" ? 1 : 0);
