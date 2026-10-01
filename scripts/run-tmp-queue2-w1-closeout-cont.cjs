/**
 * Week 1 closeout continuation — finish remaining ~35 to 3500.
 * State hist + cadc/cafc only. No intermediate. No empty-window waste.
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const reportPath = path.join(root, "packages/research/corpus/reports/queue2-w1-closeout-cont-ops.json");
const BUDGET = Math.min(Math.max(Number(process.env.W1C2_CL_BUDGET || 120), 20), 150);
const CASE_TARGET = Math.min(Math.max(Number(process.env.W1C2_CASE_TARGET || 50), 20), 70);
const COURT_CAP = 12;

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

// Proven productive courts/windows from prior sessions
const PLAN = [
  ["G2", "ala", "1980-01-01", "1999-12-31", 8],
  ["G2", "alaska", "1980-01-01", "1999-12-31", 8],
  ["G2", "okla", "1970-01-01", "1989-12-31", 8],
  ["G2", "or", "1970-01-01", "1989-12-31", 8],
  ["G2", "mo", "1970-01-01", "1989-12-31", 8],
  ["G2", "idaho", "1970-01-01", "1989-12-31", 8],
  ["G2", "neb", "1970-01-01", "1989-12-31", 8],
  ["G2", "ark", "1980-01-01", "1999-12-31", 8],
  ["G2", "colo", "1980-01-01", "1999-12-31", 8],
  ["G2", "tenn", "1980-01-01", "1999-12-31", 8],
  ["G2", "kan", "1980-01-01", "1999-12-31", 8],
  ["G2", "me", "1980-01-01", "1999-12-31", 8],
  ["G2", "ri", "1980-01-01", "1999-12-31", 8],
  ["G2", "vt", "1980-01-01", "1999-12-31", 8],
  ["G2", "nh", "1980-01-01", "1999-12-31", 8],
  ["G2", "sd", "1980-01-01", "1999-12-31", 8],
  ["G2", "nd", "1980-01-01", "1999-12-31", 8],
  ["G2", "wyo", "1980-01-01", "1999-12-31", 8],
  ["G2", "mont", "1980-01-01", "1999-12-31", 8],
  ["G2", "miss", "1980-01-01", "1999-12-31", 8],
  ["G3H", "cadc", "2000-01-01", "2010-12-31", 8],
  ["G3H", "cafc", "2000-01-01", "2010-12-31", 8],
  ["G3H", "cadc", "2011-01-01", "2018-12-31", 6],
  ["G3H", "cafc", "2011-01-01", "2018-12-31", 6],
  ["DISTRICT_HIST", "nysd", "2000-01-01", "2010-12-31", 6],
  ["DISTRICT_HIST", "cacd", "2000-01-01", "2010-12-31", 6],
  ["DISTRICT_HIST", "ilnd", "1990-01-01", "1999-12-31", 6],
  ["DISTRICT_HIST", "flsd", "1990-01-01", "1999-12-31", 6],
];

// Ensure COURT_MAP has these high courts
const NEED_MAP = {
  ark: { courtId: "st-ar-high", courtLevel: "state_high", authorityState: "AR", courtName: "Supreme Court of Arkansas", federalCircuit: null, jurisdiction: "AR" },
  colo: { courtId: "st-co-high", courtLevel: "state_high", authorityState: "CO", courtName: "Colorado Supreme Court", federalCircuit: null, jurisdiction: "CO" },
  tenn: { courtId: "st-tn-high", courtLevel: "state_high", authorityState: "TN", courtName: "Supreme Court of Tennessee", federalCircuit: null, jurisdiction: "TN" },
  kan: { courtId: "st-ks-high", courtLevel: "state_high", authorityState: "KS", courtName: "Supreme Court of Kansas", federalCircuit: null, jurisdiction: "KS" },
  me: { courtId: "st-me-high", courtLevel: "state_high", authorityState: "ME", courtName: "Supreme Judicial Court of Maine", federalCircuit: null, jurisdiction: "ME" },
  ri: { courtId: "st-ri-high", courtLevel: "state_high", authorityState: "RI", courtName: "Supreme Court of Rhode Island", federalCircuit: null, jurisdiction: "RI" },
  vt: { courtId: "st-vt-high", courtLevel: "state_high", authorityState: "VT", courtName: "Supreme Court of Vermont", federalCircuit: null, jurisdiction: "VT" },
  nh: { courtId: "st-nh-high", courtLevel: "state_high", authorityState: "NH", courtName: "Supreme Court of New Hampshire", federalCircuit: null, jurisdiction: "NH" },
  sd: { courtId: "st-sd-high", courtLevel: "state_high", authorityState: "SD", courtName: "South Dakota Supreme Court", federalCircuit: null, jurisdiction: "SD" },
  nd: { courtId: "st-nd-high", courtLevel: "state_high", authorityState: "ND", courtName: "North Dakota Supreme Court", federalCircuit: null, jurisdiction: "ND" },
  wyo: { courtId: "st-wy-high", courtLevel: "state_high", authorityState: "WY", courtName: "Wyoming Supreme Court", federalCircuit: null, jurisdiction: "WY" },
  mont: { courtId: "st-mt-high", courtLevel: "state_high", authorityState: "MT", courtName: "Montana Supreme Court", federalCircuit: null, jurisdiction: "MT" },
  miss: { courtId: "st-ms-high", courtLevel: "state_high", authorityState: "MS", courtName: "Supreme Court of Mississippi", federalCircuit: null, jurisdiction: "MS" },
};

const acc = {
  classification: "MANUAL_QUEUE2_WEEK1_CLOSEOUT_CONT_OPS",
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
  note: "Maps must already be in hist-ingest bundle",
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
  // Don't burn more on consecutive empties for same court - continue to next court
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
  if (row.rateLimited || row.status === "429") {
    acc.reliability["429"] += 1;
    acc.stopReason = "429";
    break;
  }
  // If ingest says unmapped, stop that court
  if (row.status && String(row.status).includes("unmapped")) continue;
}

acc.finishedAt = new Date().toISOString();
if (!acc.stopReason) acc.stopReason = "plan_complete";
fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
console.log("W1C2_DONE " + JSON.stringify({ totalCl: acc.totalCl, totalImported: acc.totalImported, byLane: acc.byLane, stop: acc.stopReason }));
process.exit(acc.stopReason === "429" || String(acc.stopReason).includes("remote") ? 1 : 0);
