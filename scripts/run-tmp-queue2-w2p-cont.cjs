/**
 * Week2 productive expansion CONT — skip failed exploratories; Tier A/B states only.
 * Soft efficiency: stop only if rolling20>2.75 after >=60 CL of this cont.
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const reportPath = path.join(root, "packages/research/corpus/reports/queue2-w2p-cont-ops.json");
const BUDGET = Math.min(Math.max(Number(process.env.W2PC_CL_BUDGET || 220), 40), 260);
const CASE_TARGET = Math.min(Math.max(Number(process.env.W2PC_CASE_TARGET || 130), 40), 180);

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
function winKey(c, a, b) { return `${c}|${a}|${b}`; }
function roll(acc, n) {
  const sl = acc.rolling.slice(-n);
  const cl = sl.reduce((s, x) => s + x.cl, 0), imp = sl.reduce((s, x) => s + x.imp, 0);
  return { cl, imp, clPer: imp ? +(cl / imp).toFixed(3) : null };
}

const PLAN = [
  // Proven prior performers — remaining decade gaps
  ["G2", "ind", "2000-01-01", "2009-12-31", 6],
  ["G2", "vt", "2000-01-01", "2009-12-31", 6],
  ["G2", "mass", "2000-01-01", "2009-12-31", 6],
  ["G2", "del", "2000-01-01", "2009-12-31", 6],
  ["G2", "dc", "2000-01-01", "2009-12-31", 6],
  ["G2", "kan", "2000-01-01", "2009-12-31", 6],
  ["G2", "wva", "2000-01-01", "2009-12-31", 6],
  // Tier A history expanders
  ["G2", "ala", "1995-01-01", "1999-12-31", 6],
  ["G2", "ala", "1990-01-01", "1994-12-31", 8],
  ["G2", "ala", "1980-01-01", "1989-12-31", 8],
  ["G2", "ariz", "1995-01-01", "1999-12-31", 6],
  ["G2", "ariz", "1990-01-01", "1994-12-31", 8],
  ["G2", "ariz", "1980-01-01", "1989-12-31", 8],
  ["G2", "utah", "1995-01-01", "1999-12-31", 6],
  ["G2", "utah", "1990-01-01", "1994-12-31", 8],
  ["G2", "utah", "1980-01-01", "1989-12-31", 8],
  ["G2", "nm", "1995-01-01", "1999-12-31", 6],
  ["G2", "nm", "1990-01-01", "1994-12-31", 8],
  ["G2", "nm", "1980-01-01", "1989-12-31", 8],
  ["G2", "wis", "1995-01-01", "1999-12-31", 6],
  ["G2", "wis", "1990-01-01", "1994-12-31", 8],
  ["G2", "wis", "1980-01-01", "1989-12-31", 8],
  ["G2", "me", "1990-01-01", "1994-12-31", 6],
  ["G2", "me", "1980-01-01", "1989-12-31", 8],
  ["G2", "nh", "1990-01-01", "1994-12-31", 6],
  ["G2", "nh", "1980-01-01", "1989-12-31", 8],
  ["G2", "ri", "1990-01-01", "1994-12-31", 6],
  ["G2", "ri", "1980-01-01", "1989-12-31", 8],
  ["G2", "sd", "1990-01-01", "1994-12-31", 6],
  ["G2", "sd", "1980-01-01", "1989-12-31", 8],
  ["G2", "nd", "1990-01-01", "1994-12-31", 6],
  ["G2", "nd", "1980-01-01", "1989-12-31", 8],
  ["G2", "mont", "1990-01-01", "1994-12-31", 6],
  ["G2", "mont", "1980-01-01", "1989-12-31", 8],
  ["G2", "miss", "1990-01-01", "1994-12-31", 6],
  ["G2", "miss", "1980-01-01", "1989-12-31", 8],
  ["G2", "wyo", "1990-01-01", "1994-12-31", 6],
  ["G2", "wyo", "1980-01-01", "1989-12-31", 8],
  ["G2", "haw", "1980-01-01", "1989-12-31", 6],
  ["G2", "idaho", "1980-01-01", "1989-12-31", 6],
  ["G2", "neb", "1980-01-01", "1989-12-31", 6],
  ["G2", "or", "1980-01-01", "1989-12-31", 6],
  ["G2", "sc", "1980-01-01", "1989-12-31", 6],
  ["G2", "ark", "1980-01-01", "1989-12-31", 6],
  ["G2", "colo", "1980-01-01", "1989-12-31", 6],
  ["G2", "tenn", "1980-01-01", "1989-12-31", 6],
  // Districts NOT 2010s
  ["DISTRICT", "cand", "2000-01-01", "2009-12-31", 5],
  ["DISTRICT", "dcd", "1990-01-01", "1999-12-31", 5],
  ["DISTRICT", "flsd", "2000-01-01", "2009-12-31", 5],
  ["G3H", "cadc", "1990-01-01", "1999-12-31", 5],
  ["G3H", "ca1", "1985-01-01", "1994-12-31", 5],
];

const HARD_SKIP = new Set([
  "iowa|1995-01-01|1999-12-31", "minn|1995-01-01|1999-12-31", "nc|1995-01-01|1999-12-31",
  "nj|1990-01-01|1994-12-31", "mich|1990-01-01|1994-12-31", "va|1990-01-01|1994-12-31",
  "cand|2010-01-01|2019-12-31", "dcd|2010-01-01|2019-12-31",
  "conn|1980-01-01|1989-12-31", "nj|1980-01-01|1989-12-31", "nc|1980-01-01|1989-12-31",
  "mich|1980-01-01|1989-12-31", "wash|1990-01-01|1994-12-31",
]);

const acc = {
  classification: "MANUAL_WEEK2_PRODUCTIVE_STATE_EXPANSION_CONT",
  startedAt: new Date().toISOString(),
  budget: BUDGET, caseTarget: CASE_TARGET,
  totalCl: 0, totalImported: 0, byLane: {}, perCourt: {}, perWindow: {},
  batches: [], circuitBreaks: [], quarantined: [],
  saturation: { PARTIAL: [], DENSE: [], QUARANTINED: [] },
  rolling: [], stopReason: null, reliability: { "408": 0, "429": 0 },
  waste: { empty: 0, rehit: 0 },
};
const windowStatus = {};
const courtBanned = new Set();

for (const [lane, court, gte, lte, take] of PLAN) {
  if (acc.totalCl >= BUDGET - 4) { acc.stopReason = "budget_exhausted"; break; }
  if (acc.totalImported >= CASE_TARGET) { acc.stopReason = "case_target_met"; break; }
  const wk = winKey(court, gte, lte);
  if (HARD_SKIP.has(wk)) continue;
  if (windowStatus[wk] === "QUARANTINED" || windowStatus[wk] === "DENSE") continue;
  if (courtBanned.has(court)) continue;

  const s = acc.perCourt[court] || { imported: 0, cl: 0 };
  if (s.cl >= 8 && s.imported <= 1) { courtBanned.add(court); continue; }
  if (s.imported >= 3 && s.cl / s.imported > 2.9) { courtBanned.add(court); acc.quarantined.push({ court, reason: "cl_per" }); continue; }
  if (s.imported >= 16) continue;

  const r20 = roll(acc, 20);
  if (acc.totalCl >= 60 && r20.clPer != null && r20.clPer > 2.75) {
    // drop non-core courts
    if (!["ind", "vt", "mass", "del", "dc", "kan", "wva", "ala", "ariz", "utah", "nm", "wis", "me", "nh", "ri", "sd", "nd", "mont", "miss", "wyo"].includes(court)) continue;
  }
  if (acc.totalCl >= 80 && acc.totalImported && acc.totalCl / acc.totalImported > 2.85) {
    acc.stopReason = "session_efficiency_breaker";
    break;
  }

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
  acc.perCourt[court] = acc.perCourt[court] || { imported: 0, cl: 0, skipped: 0 };
  acc.perCourt[court].imported += row.imported || 0;
  acc.perCourt[court].cl += row.cl || 0;
  acc.perCourt[court].skipped += row.skipped || 0;

  if ((row.skipped || 0) >= 4 && (row.imported || 0) <= 1) {
    acc.waste.rehit += row.cl || 0;
    windowStatus[wk] = "DENSE";
    acc.saturation.DENSE.push(wk);
  }
  if (row.status === "empty" || ((row.imported || 0) === 0 && (row.fetchCl || 0) === 0)) {
    acc.waste.empty += row.cl || 0;
    windowStatus[wk] = "QUARANTINED";
    acc.saturation.QUARANTINED.push(wk);
    acc.quarantined.push({ court, window: wk, reason: "empty_search" });
  } else if ((row.imported || 0) === 0 && (row.cl || 0) >= 5) {
    windowStatus[wk] = "QUARANTINED";
    acc.saturation.QUARANTINED.push(wk);
    acc.quarantined.push({ court, window: wk, reason: "zero_yield" });
    courtBanned.add(court);
  } else if ((row.imported || 0) > 0) {
    windowStatus[wk] = "PARTIAL";
    acc.saturation.PARTIAL.push(wk);
  }

  acc.perWindow[wk] = { imported: (acc.perWindow[wk]?.imported || 0) + (row.imported || 0), cl: (acc.perWindow[wk]?.cl || 0) + (row.cl || 0) };
  acc.rolling.push({ cl: row.cl || 0, imp: row.imported || 0 });
  const overall = acc.totalImported ? +(acc.totalCl / acc.totalImported).toFixed(3) : null;
  process.stdout.write(JSON.stringify({ lane, court, gte, imported: row.imported, skipped: row.skipped, cl: row.cl, status: row.status, totalCl: acc.totalCl, totalImported: acc.totalImported, overallClPer: overall, rolling20: roll(acc, 20).clPer }) + "\n");
  fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
  if (row.rateLimited || row.status === "429") { acc.reliability["429"] += 1; acc.stopReason = "429"; break; }
}

acc.efficiency = {
  overall: acc.totalImported ? +(acc.totalCl / acc.totalImported).toFixed(3) : null,
  rolling20: roll(acc, 20), rolling50: roll(acc, 50), rolling100: roll(acc, 100),
  priorG2: 2.51,
  productiveCl: Math.max(0, acc.totalCl - acc.waste.empty - acc.waste.rehit),
};
acc.finishedAt = new Date().toISOString();
if (!acc.stopReason) acc.stopReason = "plan_complete";
fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
console.log("W2PC_DONE " + JSON.stringify({ totalCl: acc.totalCl, totalImported: acc.totalImported, byLane: acc.byLane, efficiency: acc.efficiency, stop: acc.stopReason, reliability: acc.reliability }));
process.exit(acc.stopReason === "429" || acc.stopReason === "session_efficiency_breaker" ? 1 : 0);
