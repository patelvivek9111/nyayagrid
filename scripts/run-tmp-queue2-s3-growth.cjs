/**
 * Session 3 high-throughput growth — supervised one-shots only.
 * Prefer recent fills + verified G1/district. Historical via separate phased path.
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const reportPath = path.join(root, "packages/research/corpus/reports/queue2-s3-growth.json");

const PLAN = [
  { lane: "G1", clCourt: "nmctapp", batchSize: "6", targetMax: "18", maxCalls: "16", tag: "s3-g1-nmctapp" },
  { lane: "G1", clCourt: "indctapp", batchSize: "6", targetMax: "18", maxCalls: "16", tag: "s3-g1-indctapp" },
  { lane: "G1", clCourt: "arizctapp", batchSize: "6", targetMax: "25", maxCalls: "16", tag: "s3-g1-arizctapp" },
  { lane: "G1", clCourt: "connappct", batchSize: "6", targetMax: "25", maxCalls: "16", tag: "s3-g1-connappct" },
  { lane: "G1", clCourt: "wisctapp", batchSize: "6", targetMax: "35", maxCalls: "14", tag: "s3-g1-wisctapp" },
  { lane: "G1", clCourt: "utahctapp", batchSize: "6", targetMax: "25", maxCalls: "14", tag: "s3-g1-utahctapp" },
  { lane: "G3", clCourt: "ca5", batchSize: "6", targetMax: "25", maxCalls: "14", tag: "s3-g3-ca5" },
  { lane: "G3", clCourt: "ca3", batchSize: "6", targetMax: "25", maxCalls: "14", tag: "s3-g3-ca3" },
  { lane: "G3", clCourt: "ca10", batchSize: "6", targetMax: "25", maxCalls: "14", tag: "s3-g3-ca10" },
  { lane: "G3", clCourt: "cadc", batchSize: "6", targetMax: "25", maxCalls: "14", tag: "s3-g3-cadc" },
  { lane: "DISTRICT", clCourt: "txsd", batchSize: "4", targetMax: "8", maxCalls: "12", tag: "s3-dist-txsd" },
  { lane: "DISTRICT", clCourt: "dcd", batchSize: "4", targetMax: "8", maxCalls: "12", tag: "s3-dist-dcd" },
  { lane: "DISTRICT", clCourt: "nysd", batchSize: "4", targetMax: "10", maxCalls: "12", tag: "s3-dist-nysd" },
  { lane: "DISTRICT", clCourt: "cacd", batchSize: "4", targetMax: "10", maxCalls: "12", tag: "s3-dist-cacd" },
  { lane: "DISTRICT", clCourt: "ilnd", batchSize: "4", targetMax: "10", maxCalls: "12", tag: "s3-dist-ilnd" },
  { lane: "G3", clCourt: "ca6", batchSize: "6", targetMax: "25", maxCalls: "14", tag: "s3-g3-ca6" },
  { lane: "G3", clCourt: "ca7", batchSize: "6", targetMax: "25", maxCalls: "14", tag: "s3-g3-ca7" },
  { lane: "G3", clCourt: "ca9", batchSize: "6", targetMax: "25", maxCalls: "14", tag: "s3-g3-ca9" },
  { lane: "G3", clCourt: "ca11", batchSize: "6", targetMax: "25", maxCalls: "14", tag: "s3-g3-ca11" },
];

function lastJson(text) {
  const lines = String(text || "").split(/\n/).map((l) => l.trim()).filter((l) => l.startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try { return JSON.parse(lines[i]); } catch { /* keep */ }
  }
  return null;
}
function remoteBusy() {
  const r = spawnSync("flyctl", ["machine", "exec", "811d3e3f522648", "-a", "nyayagrid-staging", "--timeout", "40", "ps -o pid,ppid,etime,args"], { encoding: "utf8", maxBuffer: 4_000_000 });
  return /staging-cl-batch-job-bundled|cl-batch-owner/.test(`${r.stdout || ""}\n${r.stderr || ""}`);
}

const acc = {
  classification: "MANUAL_QUEUE2_BALANCED_10K_SESSION_3_GROWTH",
  startedAt: new Date().toISOString(),
  batches: [],
  byLane: { G1: { cl: 0, casesAdded: 0 }, G3: { cl: 0, casesAdded: 0 }, DISTRICT: { cl: 0, casesAdded: 0 } },
  totalCl: 0,
  stopReason: null,
};
if (remoteBusy()) {
  acc.stopReason = "remote_child_present";
  fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
  process.exit(2);
}

for (const step of PLAN) {
  process.stdout.write(`\n=== ${step.lane} ${step.tag} ===\n`);
  const r = spawnSync(
    process.execPath,
    ["scripts/run-tmp-manual-cl-oneshot.cjs", step.clCourt, step.batchSize, step.targetMax, step.maxCalls, step.tag],
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
  const status = fr.status || j?.status || j?.reason || "unknown";
  const row = { lane: step.lane, clCourt: step.clCourt, tag: step.tag, exit: r.status ?? 1, status, cl, imported };
  acc.batches.push(row);
  acc.totalCl += cl;
  if (acc.byLane[step.lane]) {
    acc.byLane[step.lane].cl += cl;
    acc.byLane[step.lane].casesAdded += imported;
  }
  process.stdout.write(`${JSON.stringify(row)}\n`);
  fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));

  if (status === "rate_limited" || status === "HIST_QUERY_TIMEOUT" || /\bHTTP[_\s]?429\b/.test(text)) {
    acc.stopReason = status === "HIST_QUERY_TIMEOUT" ? "408_timeout_killed" : "429";
    break;
  }
  if ((r.status ?? 1) !== 0 && /LANE_A_CHILD_SURVIVED_PARENT|ORPHAN_LANE_A_CHILD|408|HIST_QUERY_TIMEOUT/.test(text)) {
    acc.stopReason = "408_or_orphan_stop";
    break;
  }
  if (/MAPPING_INVALID|unmapped_court/.test(text)) {
    process.stdout.write(`SKIP mapping ${step.clCourt}\n`);
    continue;
  }
}

acc.finishedAt = new Date().toISOString();
if (!acc.stopReason) acc.stopReason = "plan_complete";
fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
process.stdout.write(`\nGROWTH_DONE ${JSON.stringify({ totalCl: acc.totalCl, byLane: acc.byLane, stop: acc.stopReason })}\n`);
process.exit(acc.stopReason === "429" || acc.stopReason.startsWith("408") ? 1 : 0);
