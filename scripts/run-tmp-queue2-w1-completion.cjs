/**
 * Queue #2 Week 1 target completion — state-heavy balanced acquisition toward ~3500.
 * Env: W1_CL_BUDGET=520 W1_CASE_TARGET=250
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const reportPath = path.join(root, "packages/research/corpus/reports/queue2-w1-completion-ops.json");
const BUDGET = Math.min(Math.max(Number(process.env.W1_CL_BUDGET || 520), 40), 700);
const CASE_TARGET = Math.min(Math.max(Number(process.env.W1_CASE_TARGET || 250), 50), 350);
const COURT_CAP = 14;

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

// Interleave: G2 state hist, G1 intermediate, G3H weak circuits, district — state-heavy overall
const PLAN = [];

// --- State historical (priority deficit states) ---
const G2 = [
  ["nc", "1980-01-01", "1999-12-31", 8],
  ["sc", "1980-01-01", "1999-12-31", 8],
  ["haw", "1980-01-01", "1999-12-31", 8],
  ["minn", "1980-01-01", "1999-12-31", 8],
  ["iowa", "1980-01-01", "1999-12-31", 8],
  ["nj", "1980-01-01", "1999-12-31", 8],
  ["wash", "1980-01-01", "1999-12-31", 8],
  ["mich", "1980-01-01", "1999-12-31", 8],
  ["va", "1980-01-01", "1999-12-31", 8],
  ["ohio", "1980-01-01", "1999-12-31", 8],
  ["la", "1970-01-01", "1989-12-31", 6],
  ["nev", "1980-01-01", "1999-12-31", 6],
  ["ky", "1980-01-01", "1999-12-31", 6],
  ["md", "1980-01-01", "1999-12-31", 6],
  ["ga", "1980-01-01", "1999-12-31", 6],
  ["nc", "1970-01-01", "1979-12-31", 6],
  ["sc", "1970-01-01", "1979-12-31", 6],
  ["minn", "1970-01-01", "1979-12-31", 6],
  ["iowa", "1970-01-01", "1979-12-31", 6],
  ["haw", "1970-01-01", "1979-12-31", 6],
];
for (const [court, gte, lte, take] of G2) PLAN.push(["G2", court, gte, lte, take]);

// --- Intermediate ---
const G1 = [
  ["pasuperct", "1985-01-01", "1999-12-31", 10],
  ["illappct", "1985-01-01", "1999-12-31", 10],
  ["indctapp", "1985-01-01", "1999-12-31", 10],
  ["nmctapp", "1985-01-01", "1999-12-31", 8],
  ["kyctapp", "1985-01-01", "1999-12-31", 10],
  ["texapp", "1985-01-01", "1999-12-31", 10],
  ["arizctapp", "1985-01-01", "1999-12-31", 8],
  ["connappct", "1985-01-01", "1999-12-31", 8],
  ["wisctapp", "1985-01-01", "1999-12-31", 8],
  ["utahctapp", "1985-01-01", "1999-12-31", 8],
  ["massappct", "1975-01-01", "1989-12-31", 8],
  ["fladistctapp", "1975-01-01", "1989-12-31", 8],
  ["nyappdiv", "1975-01-01", "1989-12-31", 8],
  ["calctapp", "1975-01-01", "1989-12-31", 8],
];
for (const [court, gte, lte, take] of G1) PLAN.push(["G1", court, gte, lte, take]);

// --- Weak federal circuits (targeted, not dominant) ---
const G3H = [
  ["ca5", "1990-01-01", "1999-12-31", 8],
  ["cadc", "1990-01-01", "1999-12-31", 8],
  ["cafc", "1990-01-01", "1999-12-31", 8],
  ["ca3", "1990-01-01", "1999-12-31", 8],
  ["ca8", "1990-01-01", "1999-12-31", 8],
  ["ca5", "1980-01-01", "1989-12-31", 6],
  ["cadc", "1980-01-01", "1989-12-31", 6],
  ["cafc", "2000-01-01", "2015-12-31", 6],
  ["ca3", "1980-01-01", "1989-12-31", 6],
  ["ca8", "1980-01-01", "1989-12-31", 6],
  ["ca11", "1980-01-01", "1989-12-31", 6],
  ["ca9", "1980-01-01", "1989-12-31", 6],
];
for (const [court, gte, lte, take] of G3H) PLAN.push(["G3H", court, gte, lte, take]);

// --- District hist ---
const DIST = [
  ["njd", "1975-01-01", "1989-12-31", 6],
  ["paed", "1975-01-01", "1989-12-31", 6],
  ["mad", "1975-01-01", "1989-12-31", 6],
  ["flsd", "1975-01-01", "1989-12-31", 6],
  ["ilnd", "1975-01-01", "1989-12-31", 6],
  ["txsd", "1975-01-01", "1989-12-31", 6],
  ["txnd", "1975-01-01", "1989-12-31", 6],
  ["cand", "1975-01-01", "1989-12-31", 6],
  ["waed", "1975-01-01", "1989-12-31", 6],
  ["dcd", "1975-01-01", "1989-12-31", 6],
  ["nysd", "1990-01-01", "1999-12-31", 5],
  ["cacd", "1990-01-01", "1999-12-31", 5],
];
for (const [court, gte, lte, take] of DIST) PLAN.push(["DISTRICT_HIST", court, gte, lte, take]);

// More state hist second pass
const G2b = [
  ["nc", "1990-01-01", "1994-12-31", 6],
  ["sc", "1990-01-01", "1994-12-31", 6],
  ["minn", "1990-01-01", "1994-12-31", 6],
  ["iowa", "1990-01-01", "1994-12-31", 6],
  ["wash", "1990-01-01", "1994-12-31", 6],
  ["mich", "1990-01-01", "1994-12-31", 6],
  ["ohio", "1990-01-01", "1994-12-31", 6],
  ["va", "1990-01-01", "1994-12-31", 6],
];
for (const [court, gte, lte, take] of G2b) PLAN.push(["G2", court, gte, lte, take]);

const acc = {
  classification: "MANUAL_QUEUE2_WEEK1_TARGET_COMPLETION_OPS",
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
};
if (remoteBusy()) {
  acc.stopReason = "remote_child_present";
  fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
  process.exit(2);
}

for (const [lane, court, gte, lte, take] of PLAN) {
  if (acc.totalCl >= BUDGET - 5) { acc.stopReason = "budget_exhausted"; break; }
  if (acc.totalImported >= CASE_TARGET) { acc.stopReason = "case_target_met"; break; }
  if ((acc.perCourt[court]?.imported || 0) >= COURT_CAP) continue;
  const L = acc.byLane[lane];
  if (L && L.imported >= 8 && L.cl / L.imported > 3.5) {
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
  process.stdout.write(JSON.stringify({ lane, court, imported: row.imported, cl: row.cl, status: row.status, totalCl: acc.totalCl, totalImported: acc.totalImported }) + "\n");
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
console.log("W1_DONE " + JSON.stringify({ totalCl: acc.totalCl, totalImported: acc.totalImported, byLane: acc.byLane, stop: acc.stopReason }));
process.exit(acc.stopReason === "429" || String(acc.stopReason).includes("remote") ? 1 : 0);
