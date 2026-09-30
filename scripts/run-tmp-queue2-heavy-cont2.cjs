/**
 * Heavy session continuation after hour 429 — district hist + G2 + G1 only.
 * Env: CONT2_CL_BUDGET=350 CONT2_CASE_TARGET=220
 * No quota probe.
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const reportPath = path.join(root, "packages/research/corpus/reports/queue2-heavy-cont2-ops.json");
const BUDGET = Math.min(Math.max(Number(process.env.CONT2_CL_BUDGET || 350), 20), 450);
const CASE_TARGET = Math.min(Math.max(Number(process.env.CONT2_CASE_TARGET || 220), 40), 300);
const COURT_CAP = 16;

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
function oneshot(court, batchSize, targetMax, maxCalls, tag) {
  const r = spawnSync(process.execPath, ["scripts/run-tmp-manual-cl-oneshot.cjs", court, String(batchSize), String(targetMax), String(maxCalls), tag], {
    encoding: "utf8", maxBuffer: 20e6, cwd: root,
    env: { ...process.env, CL_FLY_EXEC_TIMEOUT_SEC: "540", CL_RATE_MS: "2500", CL_KEEP_DATE_FILTER: "0", CL_ORPHAN_WAIT_MS: "60000" },
  });
  const text = `${r.stdout || ""}\n${r.stderr || ""}`;
  const j = lastJson(text);
  const fr = j?.fileResult || j || {};
  return { lane: "DISTRICT_RECENT", court, imported: Number(fr.items_imported ?? fr.itemsImported ?? 0), cl: Number(fr.sessionApiCalls ?? fr.apiCalls ?? 0), status: fr.status || "unknown", rateLimited: fr.status === "rate_limited" || /\b429\b/.test(text), textHit408: /408|ORPHAN|LANE_A_CHILD/.test(text) };
}

const PLAN = [
  // District hist rotate
  ["hist", "DISTRICT_HIST", "txnd", "1985-01-01", "1994-12-31", 8],
  ["hist", "DISTRICT_HIST", "cand", "1985-01-01", "1994-12-31", 8],
  ["hist", "DISTRICT_HIST", "waed", "1985-01-01", "1994-12-31", 8],
  ["hist", "DISTRICT_HIST", "dcd", "1985-01-01", "1994-12-31", 8],
  ["hist", "DISTRICT_HIST", "njd", "1985-01-01", "1999-12-31", 8],
  ["hist", "DISTRICT_HIST", "paed", "1985-01-01", "1999-12-31", 8],
  ["hist", "DISTRICT_HIST", "mad", "1985-01-01", "1999-12-31", 8],
  ["hist", "DISTRICT_HIST", "flsd", "1985-01-01", "1999-12-31", 8],
  ["hist", "DISTRICT_HIST", "ilnd", "1985-01-01", "1999-12-31", 8],
  ["hist", "DISTRICT_HIST", "txsd", "1985-01-01", "1999-12-31", 8],
  ["hist", "DISTRICT_HIST", "nysd", "1975-01-01", "1989-12-31", 6],
  ["hist", "DISTRICT_HIST", "cacd", "1975-01-01", "1989-12-31", 6],
  // G2 state hist
  ["hist", "G2", "neb", "1980-01-01", "1999-12-31", 8],
  ["hist", "G2", "nc", "1980-01-01", "1999-12-31", 8],
  ["hist", "G2", "idaho", "1980-01-01", "1999-12-31", 8],
  ["hist", "G2", "ala", "1980-01-01", "1999-12-31", 8],
  ["hist", "G2", "alaska", "1980-01-01", "1999-12-31", 8],
  ["hist", "G2", "okla", "1980-01-01", "1999-12-31", 8],
  ["hist", "G2", "or", "1980-01-01", "1999-12-31", 8],
  ["hist", "G2", "mo", "1980-01-01", "1999-12-31", 8],
  // G1 intermediate
  ["hist", "G1", "nyappdiv", "1985-01-01", "1999-12-31", 10],
  ["hist", "G1", "calctapp", "1985-01-01", "1999-12-31", 10],
  ["hist", "G1", "fladistctapp", "1985-01-01", "1999-12-31", 10],
  ["hist", "G1", "massappct", "1985-01-01", "1999-12-31", 10],
  ["hist", "G1", "pasuperct", "1985-01-01", "1999-12-31", 10],
  ["hist", "G1", "illappct", "1985-01-01", "1999-12-31", 10],
  ["hist", "G1", "indctapp", "1985-01-01", "1999-12-31", 10],
  ["hist", "G1", "nmctapp", "1985-01-01", "1999-12-31", 10],
  // more district windows
  ["hist", "DISTRICT_HIST", "txnd", "2000-01-01", "2015-12-31", 6],
  ["hist", "DISTRICT_HIST", "cand", "2000-01-01", "2015-12-31", 6],
  ["hist", "DISTRICT_HIST", "waed", "2000-01-01", "2015-12-31", 6],
  ["hist", "DISTRICT_HIST", "dcd", "2000-01-01", "2015-12-31", 6],
  ["hist", "G2", "neb", "1970-01-01", "1979-12-31", 6],
  ["hist", "G2", "nc", "1970-01-01", "1979-12-31", 6],
  ["hist", "G2", "idaho", "1970-01-01", "1979-12-31", 6],
  ["hist", "G2", "ala", "1970-01-01", "1979-12-31", 6],
  // recent district oneshots
  ["oneshot", "DISTRICT_RECENT", "txsd", null, null, 5],
  ["oneshot", "DISTRICT_RECENT", "njd", null, null, 5],
  ["oneshot", "DISTRICT_RECENT", "paed", null, null, 5],
  ["oneshot", "DISTRICT_RECENT", "mad", null, null, 5],
  ["oneshot", "DISTRICT_RECENT", "flsd", null, null, 5],
  ["oneshot", "DISTRICT_RECENT", "ilnd", null, null, 5],
  ["oneshot", "DISTRICT_RECENT", "dcd", null, null, 5],
  ["oneshot", "DISTRICT_RECENT", "waed", null, null, 5],
];

const acc = { classification: "MANUAL_QUEUE2_HEAVY_CONT2", startedAt: new Date().toISOString(), budget: BUDGET, caseTarget: CASE_TARGET, totalCl: 0, totalImported: 0, byLane: {}, perCourt: {}, batches: [], stopReason: null, reliability: { "408": 0, "429": 0 } };
if (remoteBusy()) { acc.stopReason = "remote_child_present"; fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2)); process.exit(2); }

for (const step of PLAN) {
  if (acc.totalCl >= BUDGET - 5) { acc.stopReason = "budget_exhausted"; break; }
  if (acc.totalImported >= CASE_TARGET) { acc.stopReason = "case_target_met"; break; }
  const [, lane, court, gte, lte, take] = step;
  const courtImported = acc.perCourt[court]?.imported || 0;
  if (courtImported >= COURT_CAP) continue;
  const L = acc.byLane[lane];
  if (L && L.imported >= 8 && L.cl / L.imported > 3.5) { process.stdout.write(`SKIP_INEFF ${lane}\n`); continue; }

  process.stdout.write(`\n=== ${lane} ${court} ${gte || "recent"} ===\n`);
  let row;
  if (step[0] === "hist") row = hist(lane, court, gte, lte, take);
  else row = oneshot(court, 5, 10, Math.min(14, BUDGET - acc.totalCl), `heavy2-${court}`);

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
  process.stdout.write(JSON.stringify({ lane, court, imported: row.imported, cl: row.cl, status: row.status, totalCl: acc.totalCl, totalImported: acc.totalImported }) + "\n");
  fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
  if (row.rateLimited || row.status === "429") { acc.reliability["429"] += 1; acc.stopReason = "429"; break; }
  if (row.textHit408) { acc.reliability["408"] += 1; continue; }
}
acc.finishedAt = new Date().toISOString();
if (!acc.stopReason) acc.stopReason = "plan_complete";
fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
console.log("CONT2_DONE " + JSON.stringify({ totalCl: acc.totalCl, totalImported: acc.totalImported, byLane: acc.byLane, stop: acc.stopReason }));
process.exit(acc.stopReason === "429" || String(acc.stopReason).includes("remote") ? 1 : 0);
