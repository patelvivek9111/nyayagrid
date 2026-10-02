/**
 * Week2 high-efficiency scale — 1990s underfilled state hist FIRST.
 * No 1970s re-hit. Quarantine ca2/ca4/ca10/cafc/waed/txnd/txsd/mad.
 * Micro-pilot new windows (take<=6); circuit-break early.
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const reportPath = path.join(root, "packages/research/corpus/reports/queue2-w2s-scale-ops.json");
const BUDGET = Math.min(Math.max(Number(process.env.W2S_CL_BUDGET || 260), 40), 280);
const CASE_TARGET = Math.min(Math.max(Number(process.env.W2S_CASE_TARGET || 175), 50), 230);

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
  return { status: r.status ?? 1, json: lastJson(`${r.stdout || ""}\n${r.stderr || ""}`) };
}
function hist(lane, court, gte, lte, take) {
  const disc = flyNode("scripts/tmp-queue2-s3-hist-discover-v2-bundled.cjs", [court, gte, lte, String(Math.max(take + 2, 8)), "search"], 90);
  let cl = Number(disc.json?.courtListenerHttpCalls || 0);
  if (disc.json?.status === "rate_limited") return { lane, court, gte, lte, imported: 0, cl, status: "429", rateLimited: true, searchCl: cl, fetchCl: 0, skipped: 0, emptyPages: 1 };
  let ids = (disc.json?.ids || []).map((x) => x.id).filter(Boolean);
  if (!ids.length) return { lane, court, gte, lte, imported: 0, cl, status: "empty", searchCl: cl, fetchCl: 0, skipped: 0, emptyPages: 1 };
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
    emptyPages: 0,
  };
}

function winKey(court, gte, lte) { return `${court}|${gte}|${lte}`; }

// 1995–1999 underfilled first, then 1990–1994, then 1980s only for still-productive courts.
// Avoid prior-session dense 1990s (idaho/neb/or/mo/ark/colo/tenn/haw/sc/ohio/ky) and empty (la/md/ga).
const PLAN = [
  // Priority underfilled (live lowest totals)
  ["G2", "wva", "1995-01-01", "1999-12-31", 6],
  ["G2", "dc", "1995-01-01", "1999-12-31", 6],
  ["G2", "del", "1995-01-01", "1999-12-31", 6],
  ["G2", "nj", "1995-01-01", "1999-12-31", 6],
  ["G2", "mich", "1995-01-01", "1999-12-31", 6],
  ["G2", "kan", "1995-01-01", "1999-12-31", 6],
  ["G2", "vt", "1995-01-01", "1999-12-31", 6],
  ["G2", "alaska", "1995-01-01", "1999-12-31", 6],
  ["G2", "nev", "1995-01-01", "1999-12-31", 6],
  ["G2", "wash", "1995-01-01", "1999-12-31", 6],
  ["G2", "va", "1995-01-01", "1999-12-31", 6],
  ["G2", "iowa", "1995-01-01", "1999-12-31", 6],
  ["G2", "minn", "1995-01-01", "1999-12-31", 6],
  ["G2", "nc", "1995-01-01", "1999-12-31", 6],
  ["G2", "ind", "1995-01-01", "1999-12-31", 6],
  ["G2", "mass", "1995-01-01", "1999-12-31", 6],
  ["G2", "conn", "1995-01-01", "1999-12-31", 6],
  // Expand productive priority courts into 1990–1994
  ["G2", "wva", "1990-01-01", "1994-12-31", 8],
  ["G2", "dc", "1990-01-01", "1994-12-31", 8],
  ["G2", "del", "1990-01-01", "1994-12-31", 8],
  ["G2", "nj", "1990-01-01", "1994-12-31", 8],
  ["G2", "mich", "1990-01-01", "1994-12-31", 8],
  ["G2", "kan", "1990-01-01", "1994-12-31", 8],
  ["G2", "alaska", "1990-01-01", "1994-12-31", 8],
  ["G2", "va", "1990-01-01", "1994-12-31", 8],
  ["G2", "iowa", "1990-01-01", "1994-12-31", 8],
  ["G2", "minn", "1990-01-01", "1994-12-31", 8],
  ["G2", "nc", "1990-01-01", "1994-12-31", 8],
  ["G2", "ind", "1990-01-01", "1994-12-31", 8],
  ["G2", "mass", "1990-01-01", "1994-12-31", 8],
  ["G2", "conn", "1990-01-01", "1994-12-31", 8],
  // 1980s only for courts that stayed productive
  ["G2", "wva", "1980-01-01", "1989-12-31", 8],
  ["G2", "dc", "1980-01-01", "1989-12-31", 8],
  ["G2", "del", "1980-01-01", "1989-12-31", 8],
  ["G2", "nj", "1980-01-01", "1989-12-31", 8],
  ["G2", "mich", "1980-01-01", "1989-12-31", 8],
  ["G2", "kan", "1980-01-01", "1989-12-31", 8],
  // Proven districts (secondary)
  ["DISTRICT", "cand", "2000-01-01", "2009-12-31", 6],
  ["DISTRICT", "dcd", "2000-01-01", "2009-12-31", 6],
  ["DISTRICT", "flsd", "2000-01-01", "2009-12-31", 5],
  ["DISTRICT", "cand", "1990-01-01", "1999-12-31", 6],
  ["DISTRICT", "dcd", "1990-01-01", "1999-12-31", 6],
  ["DISTRICT", "ilnd", "2000-01-01", "2009-12-31", 5],
  ["DISTRICT", "nysd", "2000-01-01", "2009-12-31", 5],
  ["DISTRICT", "paed", "2000-01-01", "2009-12-31", 5],
  // Proven circuits only (tertiary micro)
  ["G3H", "cadc", "1995-01-01", "2004-12-31", 5],
  ["G3H", "ca1", "1995-01-01", "2004-12-31", 5],
];

const acc = {
  classification: "MANUAL_WEEK2_HIGH_EFFICIENCY_SCALE_OPS",
  startedAt: new Date().toISOString(),
  budget: BUDGET,
  caseTarget: CASE_TARGET,
  casesStart: 3652,
  totalCl: 0,
  totalImported: 0,
  byLane: {},
  perCourt: {},
  perWindow: {},
  batches: [],
  circuitBreaks: [],
  quarantined: [],
  saturation: { DENSE: [], SATURATED: [], QUARANTINED: [] },
  rolling: [],
  stopReason: null,
  reliability: { "408": 0, "429": 0 },
  waste: { empty: 0, rehit: 0, filtered: 0 },
};
if (remoteBusy()) {
  acc.stopReason = "remote_child_present";
  fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
  process.exit(2);
}

const windowStatus = {}; // FRESH|PARTIAL|DENSE|SATURATED|QUARANTINED
const courtBanned = new Set(); // courts that failed micro-pilot this session

function roll(n) {
  const sl = acc.rolling.slice(-n);
  const cl = sl.reduce((s, x) => s + x.cl, 0);
  const imp = sl.reduce((s, x) => s + x.imp, 0);
  return { cl, imp, clPer: imp ? +(cl / imp).toFixed(3) : null };
}

for (const [lane, court, gte, lte, take] of PLAN) {
  if (acc.totalCl >= BUDGET - 4) { acc.stopReason = "budget_exhausted"; break; }
  if (acc.totalImported >= CASE_TARGET) { acc.stopReason = "case_target_met"; break; }

  const wk = winKey(court, gte, lte);
  if (windowStatus[wk] === "QUARANTINED" || windowStatus[wk] === "SATURATED") continue;
  if (courtBanned.has(court) && lane === "G2" && gte.startsWith("1980")) continue;

  const s = acc.perCourt[court] || { imported: 0, cl: 0, consecutiveEmpty: 0, skipped: 0 };
  if (s.consecutiveEmpty >= 1) { acc.circuitBreaks.push({ court, reason: "empty_once" }); continue; }
  if (s.cl >= 8 && s.imported <= 1) {
    acc.circuitBreaks.push({ court, reason: "low_yield" });
    courtBanned.add(court);
    continue;
  }
  if (s.imported >= 2 && s.cl / s.imported > 3.25) {
    acc.circuitBreaks.push({ court, reason: "cl_per" });
    courtBanned.add(court);
    acc.quarantined.push({ court, reason: "cl_per_gt_3.25" });
    continue;
  }
  if (s.imported >= 15) continue; // rotate

  // Session-level efficiency breaker
  const r50 = roll(50);
  const overall = acc.totalImported ? acc.totalCl / acc.totalImported : 0;
  if (acc.totalCl >= 40 && overall > 3.0) { acc.stopReason = "session_efficiency_breaker"; break; }
  if (acc.totalCl >= 50 && r50.clPer != null && r50.clPer > 2.75 && lane !== "G2") {
    acc.circuitBreaks.push({ court, reason: "rolling50_restrict_non_g2", clPer: r50.clPer });
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
    acc.perCourt[court].consecutiveEmpty = 1;
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
    acc.quarantined.push({ court, window: wk, reason: "zero_yield_after_fetch" });
    courtBanned.add(court);
  } else if ((row.imported || 0) > 0) {
    windowStatus[wk] = windowStatus[wk] === "DENSE" ? "DENSE" : "PARTIAL";
  }

  // Micro-pilot fail: 0 cases after >=5 CL
  if ((row.imported || 0) === 0 && (row.cl || 0) >= 5) {
    courtBanned.add(court);
  }

  acc.perWindow[wk] = { imported: (acc.perWindow[wk]?.imported || 0) + (row.imported || 0), cl: (acc.perWindow[wk]?.cl || 0) + (row.cl || 0), status: windowStatus[wk] || "PARTIAL" };
  acc.rolling.push({ cl: row.cl || 0, imp: row.imported || 0 });

  const overallNow = acc.totalImported ? +(acc.totalCl / acc.totalImported).toFixed(3) : null;
  process.stdout.write(JSON.stringify({
    lane, court, gte, lte, imported: row.imported, skipped: row.skipped, cl: row.cl,
    searchCl: row.searchCl, fetchCl: row.fetchCl, status: row.status,
    totalCl: acc.totalCl, totalImported: acc.totalImported, overallClPer: overallNow,
    rolling20: roll(20).clPer, windowStatus: windowStatus[wk] || null,
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
  rolling20: roll(20),
  rolling50: roll(50),
  rolling100: roll(100),
  priorOverall: 3.58,
  priorCont: 2.643,
  improvementVs358: acc.totalImported ? +(3.58 - acc.totalCl / acc.totalImported).toFixed(3) : null,
  improvementVs2643: acc.totalImported ? +(2.643 - acc.totalCl / acc.totalImported).toFixed(3) : null,
  productiveCl: Math.max(0, acc.totalCl - acc.waste.empty - acc.waste.rehit),
};
acc.finishedAt = new Date().toISOString();
if (!acc.stopReason) acc.stopReason = "plan_complete";
fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
console.log("W2S_DONE " + JSON.stringify({
  totalCl: acc.totalCl,
  totalImported: acc.totalImported,
  byLane: acc.byLane,
  efficiency: acc.efficiency,
  stop: acc.stopReason,
  quarantined: acc.quarantined.length,
  reliability: acc.reliability,
}));
process.exit(acc.stopReason === "429" || String(acc.stopReason).includes("remote") || acc.stopReason === "session_efficiency_breaker" ? 1 : 0);
