/**
 * Week 2 efficiency-recovery acquisition.
 * Tier A/B state hist + proven districts only. Quarantine ca2/ca4/ca10/cafc empty patterns.
 * Circuit breaker: stop court if consecutiveEmpty>=5 OR (req>=8 && useful<=1) OR cl/case>3.5 after meaningful sample.
 * Env: W2E_CL_BUDGET=300 W2E_CASE_TARGET=180
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const reportPath = path.join(root, "packages/research/corpus/reports/queue2-w2e-session-ops.json");
const BUDGET = Math.min(Math.max(Number(process.env.W2E_CL_BUDGET || 300), 40), 340);
const CASE_TARGET = Math.min(Math.max(Number(process.env.W2E_CASE_TARGET || 180), 40), 250);
const COURT_CAP = 14;
const QUARANTINE = new Set(["ca2", "ca4", "ca10", "cafc"]);

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
  if (disc.json?.status === "rate_limited") return { lane, court, gte, lte, imported: 0, cl, status: "429", rateLimited: true, searchCl: cl, fetchCl: 0 };
  let ids = (disc.json?.ids || []).map((x) => x.id).filter(Boolean);
  if (disc.json?.status === "HIST_QUERY_TIMEOUT") {
    const y = gte.slice(0, 4);
    const n = flyNode("scripts/tmp-queue2-s3-hist-discover-v2-bundled.cjs", [court, `${y}-01-01`, `${y}-12-31`, String(take), "search"], 90);
    cl += Number(n.json?.courtListenerHttpCalls || 0);
    ids = (n.json?.ids || []).map((x) => x.id).filter(Boolean);
    if (n.json?.status === "rate_limited") return { lane, court, gte, lte, imported: 0, cl, status: "429", rateLimited: true, searchCl: cl, fetchCl: 0 };
  }
  if (!ids.length) return { lane, court, gte, lte, imported: 0, cl, status: "empty", searchCl: cl, fetchCl: 0 };
  // Cap take tightly to avoid fetch waste
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

// Tier A/B from forensics + known productive state hist courts with live deficits
const PLAN = [
  // State historical Tier A/B — rotate
  ["G2", "wyo", "1970-01-01", "1979-12-31", 8],
  ["G2", "nd", "1970-01-01", "1979-12-31", 8],
  ["G2", "sd", "1970-01-01", "1979-12-31", 8],
  ["G2", "miss", "1970-01-01", "1979-12-31", 8],
  ["G2", "mont", "1970-01-01", "1979-12-31", 8],
  ["G2", "nh", "1970-01-01", "1979-12-31", 8],
  ["G2", "me", "1970-01-01", "1979-12-31", 8],
  ["G2", "ri", "1970-01-01", "1979-12-31", 6],
  ["G2", "vt", "1970-01-01", "1979-12-31", 6],
  ["G2", "alaska", "1990-01-01", "1999-12-31", 8],
  ["G2", "ala", "1990-01-01", "1999-12-31", 8],
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
  ["G2", "ga", "1970-01-01", "1979-12-31", 8],
  ["G2", "ohio", "1995-01-01", "1999-12-31", 8],
  ["G2", "ky", "1995-01-01", "1999-12-31", 8],
  ["G2", "la", "1995-01-01", "1999-12-31", 8],
  ["G2", "md", "1995-01-01", "1999-12-31", 8],
  // Proven districts only (cand 2.20, dcd 2.33) + micro-pilot others with early stop
  ["DISTRICT", "cand", "1990-01-01", "1999-12-31", 6],
  ["DISTRICT", "dcd", "1995-01-01", "2004-12-31", 6],
  ["DISTRICT", "nysd", "2010-01-01", "2019-12-31", 6],
  ["DISTRICT", "cacd", "2010-01-01", "2019-12-31", 6],
  ["DISTRICT", "ilnd", "2010-01-01", "2019-12-31", 6],
  ["DISTRICT", "flsd", "2010-01-01", "2019-12-31", 6],
  ["DISTRICT", "njd", "2010-01-01", "2019-12-31", 6],
  ["DISTRICT", "paed", "2010-01-01", "2019-12-31", 6],
  // Productive circuit only: cadc (3.0 borderline) as micro; NO ca2/ca4/ca10/cafc
  ["G3H", "cadc", "1970-01-01", "1979-12-31", 6],
  ["G3H", "ca1", "2000-01-01", "2010-12-31", 6],
  // More state fill
  ["G2", "wyo", "1995-01-01", "1999-12-31", 6],
  ["G2", "nd", "1995-01-01", "1999-12-31", 6],
  ["G2", "sd", "1995-01-01", "1999-12-31", 6],
  ["G2", "miss", "1995-01-01", "1999-12-31", 6],
  ["G2", "mont", "1995-01-01", "1999-12-31", 6],
  ["G2", "nh", "1995-01-01", "1999-12-31", 6],
  ["G2", "me", "1995-01-01", "1999-12-31", 6],
];

const acc = {
  classification: "MANUAL_WEEK2_EFFICIENCY_RECOVERY_OPS",
  startedAt: new Date().toISOString(),
  budget: BUDGET,
  caseTarget: CASE_TARGET,
  casesStart: 3568,
  totalCl: 0,
  totalImported: 0,
  byLane: {},
  perCourt: {},
  batches: [],
  quarantined: [],
  circuitBreaks: [],
  rolling: [],
  stopReason: null,
  reliability: { "408": 0, "429": 0 },
};
if (remoteBusy()) {
  acc.stopReason = "remote_child_present";
  fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
  process.exit(2);
}

function courtStats(court) {
  return acc.perCourt[court] || { imported: 0, cl: 0, consecutiveEmpty: 0 };
}
function shouldBreak(court) {
  const s = courtStats(court);
  if (s.consecutiveEmpty >= 2) return "consecutive_empty"; // early stop after empty discovery
  if (s.cl >= 8 && s.imported <= 1) return "low_yield";
  if (s.imported >= 3 && s.cl / s.imported > 3.5) return "cl_per_case";
  return null;
}

for (const [lane, court, gte, lte, take] of PLAN) {
  if (acc.totalCl >= BUDGET - 4) { acc.stopReason = "budget_exhausted"; break; }
  if (acc.totalImported >= CASE_TARGET) { acc.stopReason = "case_target_met"; break; }
  if (QUARANTINE.has(court)) { acc.quarantined.push(court); continue; }
  if ((acc.perCourt[court]?.imported || 0) >= COURT_CAP) continue;
  const br = shouldBreak(court);
  if (br) {
    acc.circuitBreaks.push({ court, reason: br, ...courtStats(court) });
    process.stdout.write(`BREAK ${court} ${br}\n`);
    continue;
  }
  const L = acc.byLane[lane];
  if (L && L.imported >= 8 && L.cl / Math.max(L.imported, 1) > 3.0) {
    process.stdout.write(`SKIP_INEFF_LANE ${lane}\n`);
    continue;
  }

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
  acc.perCourt[court] = acc.perCourt[court] || { imported: 0, cl: 0, consecutiveEmpty: 0, searchCl: 0, fetchCl: 0 };
  acc.perCourt[court].imported += row.imported || 0;
  acc.perCourt[court].cl += row.cl || 0;
  acc.perCourt[court].searchCl += row.searchCl || 0;
  acc.perCourt[court].fetchCl += row.fetchCl || 0;
  if ((row.imported || 0) === 0) acc.perCourt[court].consecutiveEmpty += 1;
  else acc.perCourt[court].consecutiveEmpty = 0;

  acc.rolling.push({ cl: row.cl || 0, imp: row.imported || 0 });
  const overall = acc.totalImported ? acc.totalCl / acc.totalImported : null;
  process.stdout.write(JSON.stringify({
    lane, court, imported: row.imported, cl: row.cl, searchCl: row.searchCl, fetchCl: row.fetchCl,
    status: row.status, totalCl: acc.totalCl, totalImported: acc.totalImported, overallClPer: overall ? +overall.toFixed(3) : null,
  }) + "\n");
  fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));

  if (row.rateLimited || row.status === "429") {
    acc.reliability["429"] += 1;
    acc.stopReason = "429";
    break;
  }
}

function rollingN(n) {
  const slice = acc.rolling.slice(-n);
  const cl = slice.reduce((s, x) => s + x.cl, 0);
  const imp = slice.reduce((s, x) => s + x.imp, 0);
  return { batches: slice.length, cl, imp, clPer: imp ? +(cl / imp).toFixed(3) : null };
}
acc.efficiency = {
  overall: acc.totalImported ? +(acc.totalCl / acc.totalImported).toFixed(3) : null,
  rolling20: rollingN(20),
  rolling50: rollingN(Math.min(50, acc.rolling.length)),
  priorSession: 3.17,
  improvement: acc.totalImported ? +(3.17 - acc.totalCl / acc.totalImported).toFixed(3) : null,
};
acc.finishedAt = new Date().toISOString();
if (!acc.stopReason) acc.stopReason = "plan_complete";
fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
console.log("W2E_DONE " + JSON.stringify({ totalCl: acc.totalCl, totalImported: acc.totalImported, byLane: acc.byLane, efficiency: acc.efficiency, stop: acc.stopReason }));
process.exit(acc.stopReason === "429" || String(acc.stopReason).startsWith("remote") ? 1 : 0);
