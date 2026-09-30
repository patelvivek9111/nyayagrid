/**
 * Session 5 — district expansion across verified mappings.
 * Mix recent oneshots + phased historical windows where useful.
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const reportPath = path.join(root, "packages/research/corpus/reports/queue2-s5-district-growth.json");
const BUDGET = Math.min(Math.max(Number(process.env.S5_DIST_BUDGET || 80), 10), 200);

// Lowest-count first from Session 4 tracker, then geographic diversity
const RECENT = [
  { clCourt: "dcd", batchSize: "5", targetMax: "12", maxCalls: "14", tag: "s5-dist-dcd" },
  { clCourt: "txsd", batchSize: "5", targetMax: "14", maxCalls: "14", tag: "s5-dist-txsd" },
  { clCourt: "njd", batchSize: "5", targetMax: "10", maxCalls: "14", tag: "s5-dist-njd" },
  { clCourt: "paed", batchSize: "5", targetMax: "10", maxCalls: "14", tag: "s5-dist-paed" },
  { clCourt: "mad", batchSize: "5", targetMax: "10", maxCalls: "14", tag: "s5-dist-mad" },
  { clCourt: "flsd", batchSize: "5", targetMax: "10", maxCalls: "14", tag: "s5-dist-flsd" },
  { clCourt: "txnd", batchSize: "5", targetMax: "10", maxCalls: "14", tag: "s5-dist-txnd" },
  { clCourt: "waed", batchSize: "5", targetMax: "10", maxCalls: "14", tag: "s5-dist-waed" },
  { clCourt: "cand", batchSize: "5", targetMax: "10", maxCalls: "14", tag: "s5-dist-cand" },
  { clCourt: "ilnd", batchSize: "4", targetMax: "14", maxCalls: "12", tag: "s5-dist-ilnd" },
  { clCourt: "nysd", batchSize: "4", targetMax: "14", maxCalls: "12", tag: "s5-dist-nysd" },
  { clCourt: "cacd", batchSize: "4", targetMax: "14", maxCalls: "12", tag: "s5-dist-cacd" },
];

const HIST = [
  { court: "njd", gte: "1995-01-01", lte: "1999-12-31" },
  { court: "paed", gte: "1990-01-01", lte: "1994-12-31" },
  { court: "mad", gte: "1980-01-01", lte: "1989-12-31" },
  { court: "flsd", gte: "1995-01-01", lte: "1999-12-31" },
  { court: "dcd", gte: "1990-01-01", lte: "1994-12-31" },
  { court: "txnd", gte: "1995-01-01", lte: "1999-12-31" },
];

function lastJson(text) {
  const lines = String(text || "").split(/\n/).map((l) => l.trim()).filter((l) => l.startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try { return JSON.parse(lines[i]); } catch { /* keep */ }
  }
  const t = String(text || "");
  const start = t.lastIndexOf('{"ok"');
  if (start < 0) return null;
  let depth = 0;
  for (let k = start; k < t.length; k++) {
    if (t[k] === "{") depth++;
    else if (t[k] === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(t.slice(start, k + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function remoteBusy() {
  const r = spawnSync("flyctl", ["machine", "exec", "811d3e3f522648", "-a", "nyayagrid-staging", "--timeout", "40", "ps -o pid,ppid,etime,args"], { encoding: "utf8", maxBuffer: 4_000_000 });
  return /staging-cl-batch-job-bundled|cl-batch-owner/.test(`${r.stdout || ""}\n${r.stderr || ""}`);
}

function flyNode(script, args, timeoutSec) {
  const r = spawnSync(process.execPath, [path.join(root, "scripts/run-tmp-fly-node.cjs"), script, ...args], {
    encoding: "utf8",
    maxBuffer: 16_000_000,
    cwd: root,
    env: { ...process.env, FLY_TOOL_TIMEOUT_SEC: String(timeoutSec), CL_HARD_TIMEOUT_MS: String(Math.min(timeoutSec * 1000 - 5000, 120000)) },
  });
  return { status: r.status ?? 1, text: `${r.stdout || ""}\n${r.stderr || ""}`, json: lastJson(`${r.stdout || ""}\n${r.stderr || ""}`) };
}

const acc = {
  classification: "MANUAL_QUEUE2_BALANCED_10K_SESSION_5_DISTRICT",
  startedAt: new Date().toISOString(),
  budget: BUDGET,
  recent: [],
  hist: [],
  byCourt: {},
  totalCl: 0,
  totalImported: 0,
  stopReason: null,
};

if (remoteBusy()) {
  acc.stopReason = "remote_child_present";
  fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
  process.exit(2);
}

// Historical district windows first (diversity)
for (const step of HIST) {
  if (acc.totalCl >= Math.floor(BUDGET * 0.45)) break;
  process.stdout.write(`\n=== DIST-HIST ${step.court} ${step.gte}..${step.lte} ===\n`);
  const disc = flyNode("scripts/tmp-queue2-s3-hist-discover-v2-bundled.cjs", [step.court, step.gte, step.lte, "8", "search"], 90);
  const dCl = Number(disc.json?.courtListenerHttpCalls || 0);
  acc.totalCl += dCl;
  let ids = (disc.json?.ids || []).map((x) => x.id).filter(Boolean);
  if (disc.json?.status === "HIST_QUERY_TIMEOUT") {
    const year = step.gte.slice(0, 4);
    const narrow = flyNode("scripts/tmp-queue2-s3-hist-discover-v2-bundled.cjs", [step.court, `${year}-01-01`, `${year}-12-31`, "8", "search"], 90);
    acc.totalCl += Number(narrow.json?.courtListenerHttpCalls || 0);
    ids = (narrow.json?.ids || []).map((x) => x.id).filter(Boolean);
  }
  if (!ids.length) {
    acc.hist.push({ ...step, imported: 0, cl: dCl, status: "empty" });
    continue;
  }
  // ensure hist ingest knows district courts — use staging batch oneshot instead if unmapped
  const ing = flyNode("scripts/tmp-queue2-s3-hist-ingest-bundled.cjs", [step.court, ids.slice(0, 5).join(","), "5"], 240);
  const iCl = Number(ing.json?.courtListenerHttpCalls || 0);
  let imported = Number(ing.json?.imported || 0);
  let status = ing.json?.status || "unknown";
  if (ing.json?.reason?.startsWith?.("unmapped") || status === "unknown" && (ing.status ?? 1) !== 0) {
    // fallback: skip hist for unmapped in hist-ingest (should be mapped after s4)
    imported = 0;
    status = ing.json?.reason || "ingest_failed";
  }
  acc.totalCl += iCl;
  acc.totalImported += imported;
  acc.byCourt[step.court] = acc.byCourt[step.court] || { recent: 0, hist: 0, cl: 0 };
  acc.byCourt[step.court].hist += imported;
  acc.byCourt[step.court].cl += dCl + iCl;
  acc.hist.push({ ...step, imported, cl: dCl + iCl, status, discovered: ids.length });
  process.stdout.write(`${JSON.stringify({ court: step.court, imported, cl: dCl + iCl, totalCl: acc.totalCl })}\n`);
  fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
  if (ing.json?.status === "rate_limited" || disc.json?.status === "rate_limited") {
    acc.stopReason = "429";
    break;
  }
}

// Recent district oneshots
if (acc.stopReason !== "429") {
  for (const step of RECENT) {
    if (acc.totalCl >= BUDGET - 3) {
      acc.stopReason = "budget_exhausted";
      break;
    }
    process.stdout.write(`\n=== DIST-RECENT ${step.tag} ===\n`);
    const maxCalls = String(Math.min(Number(step.maxCalls), Math.max(BUDGET - acc.totalCl, 4)));
    const r = spawnSync(
      process.execPath,
      ["scripts/run-tmp-manual-cl-oneshot.cjs", step.clCourt, step.batchSize, step.targetMax, maxCalls, step.tag],
      {
        encoding: "utf8",
        maxBuffer: 20_000_000,
        cwd: root,
        env: { ...process.env, CL_FLY_EXEC_TIMEOUT_SEC: "540", CL_RATE_MS: "2200", CL_KEEP_DATE_FILTER: "0", CL_ORPHAN_WAIT_MS: "90000" },
      },
    );
    const text = `${r.stdout || ""}\n${r.stderr || ""}`;
    const j = lastJson(text);
    const fr = j?.fileResult || j || {};
    const cl = Number(fr.sessionApiCalls ?? fr.apiCalls ?? 0);
    const imported = Number(fr.items_imported ?? fr.itemsImported ?? 0);
    const status = fr.status || j?.status || "unknown";
    acc.totalCl += cl;
    acc.totalImported += imported;
    acc.byCourt[step.clCourt] = acc.byCourt[step.clCourt] || { recent: 0, hist: 0, cl: 0 };
    acc.byCourt[step.clCourt].recent += imported;
    acc.byCourt[step.clCourt].cl += cl;
    acc.recent.push({ court: step.clCourt, imported, cl, status });
    process.stdout.write(`${JSON.stringify({ court: step.clCourt, imported, cl, totalCl: acc.totalCl })}\n`);
    fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
    if (status === "rate_limited" || /\b429\b/.test(text)) {
      acc.stopReason = "429";
      break;
    }
    if (/408|HIST_QUERY_TIMEOUT|ORPHAN/.test(text)) {
      acc.stopReason = "408_or_orphan_stop";
      break;
    }
  }
}

acc.finishedAt = new Date().toISOString();
if (!acc.stopReason) acc.stopReason = "plan_complete";
fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
process.stdout.write(`\nDIST_DONE ${JSON.stringify({ totalCl: acc.totalCl, totalImported: acc.totalImported, byCourt: acc.byCourt, stop: acc.stopReason })}\n`);
process.exit(acc.stopReason === "429" || String(acc.stopReason).startsWith("408") ? 1 : 0);
