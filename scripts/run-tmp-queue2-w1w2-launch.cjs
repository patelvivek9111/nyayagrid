/**
 * Week1 closeout + Week2 launch from queue2-next-cl-recovery-manifest.json
 * Env: W12_CL_BUDGET=320 W12_CASE_TARGET=150
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const reports = path.join(root, "packages/research/corpus/reports");
const reportPath = path.join(reports, "queue2-w1w2-session-ops.json");
const BUDGET = Math.min(Math.max(Number(process.env.W12_CL_BUDGET || 320), 40), 400);
const CASE_TARGET = Math.min(Math.max(Number(process.env.W12_CASE_TARGET || 150), 20), 220);
const COURT_CAP = 12;
const CROSS_AT = 3500;

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
  return { lane, court, gte, lte, imported: Number(ing.json?.imported || 0), cl, status: ing.json?.status || "unknown", rateLimited: ing.json?.status === "rate_limited", skipped: Number(ing.json?.skipped || 0), reason: ing.json?.reason || null };
}

const manifest = JSON.parse(fs.readFileSync(path.join(reports, "queue2-next-cl-recovery-manifest.json"), "utf8"));
const PLAN = [];
for (const b of manifest.batches || []) {
  // Skip A2 standalone and known-weak intermediate for first pass efficiency
  if (b.lane === "A2_DUAL_VALUE") continue;
  if (b.lane === "G1_STATE_INTERMEDIATE") continue;
  // Skip blind weak circuit patterns
  if (b.lane === "G3_FEDERAL_HISTORICAL" && ["ca5", "ca3", "ca8"].includes(b.court)) continue;
  const win = String(b.dateWindow || "");
  const [gte, lte] = win.includes("..") ? win.split("..") : ["1980-01-01", "1999-12-31"];
  const take = Math.min(Number(b.targetCases || 8), 10);
  const lane = b.lane === "G2_STATE_HISTORICAL" ? "G2" : b.lane === "G3_DISTRICT" ? "DISTRICT" : b.lane === "G3_FEDERAL_HISTORICAL" ? "G3H" : b.lane;
  PLAN.push([lane, b.court, gte, lte, take]);
}

// Extra productive fill if manifest finishes early
const EXTRA = [
  ["G2", "sd", "1970-01-01", "1979-12-31", 6],
  ["G2", "nm", "1970-01-01", "1979-12-31", 6],
  ["G2", "wyo", "1970-01-01", "1979-12-31", 6],
  ["G2", "nd", "1970-01-01", "1979-12-31", 6],
  ["G2", "mont", "1970-01-01", "1979-12-31", 6],
  ["G2", "miss", "1970-01-01", "1979-12-31", 6],
  ["G2", "kan", "1970-01-01", "1979-12-31", 6],
  ["G2", "me", "1970-01-01", "1979-12-31", 6],
  ["G2", "ri", "1970-01-01", "1979-12-31", 6],
  ["G2", "vt", "1970-01-01", "1979-12-31", 6],
  ["G2", "nh", "1970-01-01", "1979-12-31", 6],
  ["G3H", "cadc", "1995-01-01", "1999-12-31", 8],
  ["G3H", "cafc", "1995-01-01", "1999-12-31", 8],
  ["G3H", "cadc", "1985-01-01", "1989-12-31", 6],
  ["G3H", "cafc", "1985-01-01", "1989-12-31", 6],
  ["DISTRICT", "dcd", "2000-01-01", "2010-12-31", 6],
  ["DISTRICT", "txnd", "2000-01-01", "2010-12-31", 6],
  ["DISTRICT", "waed", "1990-01-01", "1999-12-31", 6],
  ["DISTRICT", "cand", "2000-01-01", "2010-12-31", 6],
  ["DISTRICT", "mad", "1990-01-01", "1999-12-31", 6],
  ["DISTRICT", "paed", "1990-01-01", "1999-12-31", 6],
];
for (const row of EXTRA) PLAN.push(row);

const acc = {
  classification: "MANUAL_WEEK1_CLOSEOUT_WEEK2_STRONG_LAUNCH_OPS",
  startedAt: new Date().toISOString(),
  budget: BUDGET,
  caseTarget: CASE_TARGET,
  casesStart: 3490,
  totalCl: 0,
  totalImported: 0,
  byLane: {},
  perCourt: {},
  batches: [],
  crossed3500: null,
  stopReason: null,
  reliability: { "408": 0, "429": 0 },
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

  const estCases = acc.casesStart + acc.totalImported;
  if (!acc.crossed3500 && estCases >= CROSS_AT) {
    acc.crossed3500 = {
      atImported: acc.totalImported,
      estimatedCases: estCases,
      clSoFar: acc.totalCl,
      lane,
      court,
      timestamp: new Date().toISOString(),
    };
    process.stdout.write("CROSSED_3500 " + JSON.stringify(acc.crossed3500) + "\n");
  }

  process.stdout.write(JSON.stringify({ lane, court, imported: row.imported, cl: row.cl, status: row.status, totalCl: acc.totalCl, totalImported: acc.totalImported, estCases }) + "\n");
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
console.log("W12_DONE " + JSON.stringify({ totalCl: acc.totalCl, totalImported: acc.totalImported, byLane: acc.byLane, crossed3500: acc.crossed3500, stop: acc.stopReason }));
process.exit(acc.stopReason === "429" || String(acc.stopReason).includes("remote") ? 1 : 0);
