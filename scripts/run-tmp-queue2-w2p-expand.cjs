/**
 * Week2 productive state expansion — underfilled windows only.
 * Prefer proven courts on UNMINED eras; micro-pilot new high-deficit states.
 * Quarantine list respected. No 1970s. No cand/dcd 2010s.
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const reportPath = path.join(root, "packages/research/corpus/reports/queue2-w2p-ops.json");
const BUDGET = Math.min(Math.max(Number(process.env.W2P_CL_BUDGET || 250), 30), 280);
const CASE_TARGET = Math.min(Math.max(Number(process.env.W2P_CASE_TARGET || 175), 50), 230);

function lastJson(text) {
  const lines = String(text || "").split(/\n/).map((l) => l.trim()).filter((l) => l.startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch { /* */ }
  }
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
  if (disc.json?.status === "rate_limited") {
    return { lane, court, gte, lte, imported: 0, cl, status: "429", rateLimited: true, searchCl: cl, fetchCl: 0, skipped: 0 };
  }
  const ids = (disc.json?.ids || []).map((x) => x.id).filter(Boolean);
  if (!ids.length) {
    return { lane, court, gte, lte, imported: 0, cl, status: "empty", searchCl: cl, fetchCl: 0, skipped: 0 };
  }
  const slice = ids.slice(0, take);
  const ing = flyNode("scripts/tmp-queue2-s3-hist-ingest-bundled.cjs", [court, slice.join(","), String(slice.length)], 240);
  const fetchCl = Number(ing.json?.courtListenerHttpCalls || 0);
  cl += fetchCl;
  return {
    lane, court, gte, lte,
    imported: Number(ing.json?.imported || 0),
    cl, searchCl: cl - fetchCl, fetchCl,
    status: ing.json?.status || "unknown",
    rateLimited: ing.json?.status === "rate_limited",
    skipped: Number(ing.json?.skipped || 0),
  };
}
function winKey(court, gte, lte) { return `${court}|${gte}|${lte}`; }
function roll(acc, n) {
  const sl = acc.rolling.slice(-n);
  const cl = sl.reduce((s, x) => s + x.cl, 0);
  const imp = sl.reduce((s, x) => s + x.imp, 0);
  return { cl, imp, clPer: imp ? +(cl / imp).toFixed(3) : null };
}

// Unmined / alternate eras for proven courts + micro-pilot high-deficit weak-pre2000 states.
// Explicitly skip quarantined windows from prior sessions.
const PLAN = [
  // Proven courts — unmined 1980s / remaining 1990s
  ["G2", "ind", "1980-01-01", "1989-12-31", 8],
  ["G2", "conn", "1980-01-01", "1989-12-31", 8],
  ["G2", "vt", "1990-01-01", "1994-12-31", 6],
  ["G2", "vt", "1980-01-01", "1989-12-31", 8],
  ["G2", "mass", "1980-01-01", "1989-12-31", 8],
  // High-deficit weak pre-2000 — DIFFERENT windows than quarantined
  ["G2", "mich", "1980-01-01", "1989-12-31", 6],
  ["G2", "nj", "1980-01-01", "1989-12-31", 6],
  ["G2", "nc", "1990-01-01", "1994-12-31", 5],
  ["G2", "nc", "1980-01-01", "1989-12-31", 6],
  ["G2", "wash", "1990-01-01", "1994-12-31", 5],
  ["G2", "wash", "1980-01-01", "1989-12-31", 6],
  ["G2", "va", "1980-01-01", "1989-12-31", 6],
  ["G2", "va", "1995-01-01", "1999-12-31", 5], // already partial; only if still yield
  // More underfilled states (live deficits)
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
  // Secondary districts — NOT 2010s
  ["DISTRICT", "cand", "2000-01-01", "2009-12-31", 5],
  ["DISTRICT", "dcd", "2000-01-01", "2009-12-31", 5],
  ["DISTRICT", "cand", "1990-01-01", "1999-12-31", 5],
  ["DISTRICT", "flsd", "2000-01-01", "2009-12-31", 5],
  // Tertiary circuits
  ["G3H", "cadc", "1990-01-01", "1999-12-31", 5],
  ["G3H", "ca1", "1985-01-01", "1994-12-31", 5],
];

const HARD_SKIP = new Set([
  "iowa|1995-01-01|1999-12-31",
  "minn|1995-01-01|1999-12-31",
  "nc|1995-01-01|1999-12-31",
  "nj|1990-01-01|1994-12-31",
  "mich|1990-01-01|1994-12-31",
  "va|1990-01-01|1994-12-31",
  "cand|2010-01-01|2019-12-31",
  "dcd|2010-01-01|2019-12-31",
]);

const acc = {
  classification: "MANUAL_WEEK2_PRODUCTIVE_STATE_EXPANSION_OPS",
  startedAt: new Date().toISOString(),
  budget: BUDGET,
  caseTarget: CASE_TARGET,
  casesStart: 3754,
  totalCl: 0,
  totalImported: 0,
  byLane: {},
  perCourt: {},
  perWindow: {},
  batches: [],
  circuitBreaks: [],
  quarantined: [],
  saturation: { FRESH: [], PARTIAL: [], DENSE: [], SATURATED: [], QUARANTINED: [] },
  rolling: [],
  stopReason: null,
  reliability: { "408": 0, "429": 0 },
  waste: { empty: 0, rehit: 0 },
};

const windowStatus = {};
const courtBanned = new Set();

for (const [lane, court, gte, lte, take] of PLAN) {
  if (acc.totalCl >= BUDGET - 4) { acc.stopReason = "budget_exhausted"; break; }
  if (acc.totalImported >= CASE_TARGET) { acc.stopReason = "case_target_met"; break; }

  const wk = winKey(court, gte, lte);
  if (HARD_SKIP.has(wk)) continue;
  if (windowStatus[wk] === "QUARANTINED" || windowStatus[wk] === "SATURATED" || windowStatus[wk] === "DENSE") continue;
  if (courtBanned.has(court)) continue;
  if (gte.startsWith("197")) continue; // no 1970s this session

  const s = acc.perCourt[court] || { imported: 0, cl: 0, consecutiveEmpty: 0, skipped: 0 };
  if (s.cl >= 10 && s.imported <= 1) {
    acc.circuitBreaks.push({ court, reason: "low_yield" });
    courtBanned.add(court);
    continue;
  }
  if (s.imported >= 3 && s.cl / s.imported > 3.0) {
    acc.circuitBreaks.push({ court, reason: "cl_per" });
    courtBanned.add(court);
    acc.quarantined.push({ court, reason: "cl_per_gt_3.0" });
    continue;
  }
  if (s.imported >= 18) continue;

  const r20 = roll(acc, 20);
  const r50 = roll(acc, 50);
  const overall = acc.totalImported ? acc.totalCl / acc.totalImported : 0;
  if (acc.totalCl >= 40 && overall > 2.75) { acc.stopReason = "session_efficiency_breaker"; break; }
  if (r20.clPer != null && r20.clPer > 3.0) {
    acc.circuitBreaks.push({ court, reason: "rolling20_gt_3", clPer: r20.clPer });
    windowStatus[wk] = "QUARANTINED";
    continue;
  }
  if (r50.clPer != null && r50.clPer > 2.65 && !["ind", "conn", "vt", "wva", "kan", "del", "mass", "dc", "me", "nh", "ri", "sd", "nd", "mont", "miss", "wyo"].includes(court)) {
    continue;
  }

  process.stdout.write(`\n=== ${lane} ${court} ${gte}..${lte} take=${take} ===\n`);
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
  if ((row.imported || 0) === 0) acc.perCourt[court].consecutiveEmpty += 1;
  else acc.perCourt[court].consecutiveEmpty = 0;

  if ((row.skipped || 0) >= 4 && (row.imported || 0) <= 1) {
    acc.waste.rehit += row.cl || 0;
    windowStatus[wk] = "DENSE";
    acc.saturation.DENSE.push(wk);
    acc.perCourt[court].consecutiveEmpty = 1;
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

  acc.perWindow[wk] = {
    imported: (acc.perWindow[wk]?.imported || 0) + (row.imported || 0),
    cl: (acc.perWindow[wk]?.cl || 0) + (row.cl || 0),
    status: windowStatus[wk] || "PARTIAL",
  };
  acc.rolling.push({ cl: row.cl || 0, imp: row.imported || 0 });

  const overallNow = acc.totalImported ? +(acc.totalCl / acc.totalImported).toFixed(3) : null;
  process.stdout.write(JSON.stringify({
    lane, court, gte, lte, imported: row.imported, skipped: row.skipped, cl: row.cl,
    searchCl: row.searchCl, fetchCl: row.fetchCl, status: row.status,
    totalCl: acc.totalCl, totalImported: acc.totalImported, overallClPer: overallNow,
    rolling20: roll(acc, 20).clPer, windowStatus: windowStatus[wk] || null,
  }) + "\n");
  fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));

  if (row.rateLimited || row.status === "429") {
    acc.reliability["429"] += 1;
    acc.stopReason = "429";
    break;
  }
}

acc.efficiency = {
  overall: acc.totalImported ? +(acc.totalCl / acc.totalImported).toFixed(3) : null,
  rolling20: roll(acc, 20),
  rolling50: roll(acc, 50),
  rolling100: roll(acc, 100),
  priorG2: 2.51,
  productiveCl: Math.max(0, acc.totalCl - acc.waste.empty - acc.waste.rehit),
};
acc.finishedAt = new Date().toISOString();
if (!acc.stopReason) acc.stopReason = "plan_complete";
fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
console.log("W2P_DONE " + JSON.stringify({
  totalCl: acc.totalCl,
  totalImported: acc.totalImported,
  byLane: acc.byLane,
  efficiency: acc.efficiency,
  stop: acc.stopReason,
  quarantined: acc.quarantined.length,
  reliability: acc.reliability,
}));
process.exit(acc.stopReason === "429" || acc.stopReason === "session_efficiency_breaker" ? 1 : 0);
