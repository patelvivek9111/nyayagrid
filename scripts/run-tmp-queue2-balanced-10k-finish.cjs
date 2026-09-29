/**
 * Final productive CL batches — no false orphan waits on success.
 * Usage: node scripts/run-tmp-queue2-balanced-10k-finish.cjs
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const reportPath = path.join(root, "packages/research/corpus/reports/queue2-balanced-10k-finish.json");

const PLAN = [
  { lane: "G3", clCourt: "ca8", batchSize: "6", targetMax: "22", maxCalls: "15", tag: "g3-ca8-f1" },
  { lane: "G3", clCourt: "cadc", batchSize: "6", targetMax: "24", maxCalls: "15", tag: "g3-cadc-f1" },
  { lane: "G3", clCourt: "cafc", batchSize: "6", targetMax: "22", maxCalls: "15", tag: "g3-cafc-f1" },
  { lane: "G3", clCourt: "ca11", batchSize: "6", targetMax: "22", maxCalls: "15", tag: "g3-ca11-f1" },
  { lane: "G1", clCourt: "wisctapp", batchSize: "6", targetMax: "25", maxCalls: "15", tag: "g1-wisctapp-f2" },
  { lane: "G1", clCourt: "utahctapp", batchSize: "6", targetMax: "15", maxCalls: "15", tag: "g1-utahctapp-f1" },
  { lane: "G1", clCourt: "kyctapp", batchSize: "6", targetMax: "15", maxCalls: "15", tag: "g1-kyctapp-f1" },
];

function lastJson(text) {
  const lines = String(text || "")
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      /* keep */
    }
  }
  return null;
}

function remoteBusy() {
  const r = spawnSync(
    "flyctl",
    ["machine", "exec", "811d3e3f522648", "-a", "nyayagrid-staging", "--timeout", "40", "ps -o pid,ppid,etime,args"],
    { encoding: "utf8", maxBuffer: 4_000_000 },
  );
  return /staging-cl-batch-job-bundled|cl-batch-owner/.test(`${r.stdout || ""}\n${r.stderr || ""}`);
}

function waitClear(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!remoteBusy()) return true;
    spawnSync(process.execPath, ["-e", "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10000)"]);
  }
  return !remoteBusy();
}

const acc = {
  classification: "MANUAL_QUEUE2_BALANCED_10K_FINISH",
  startedAt: new Date().toISOString(),
  batches: [],
  byLane: { G1: { cl: 0, casesAdded: 0 }, G3: { cl: 0, casesAdded: 0 } },
  totalCl: 0,
  stopReason: null,
};

if (remoteBusy()) {
  process.stdout.write("WAIT_INITIAL_CLEAR\n");
  if (!waitClear(8 * 60 * 1000)) {
    acc.stopReason = "orphan_present";
    fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
    process.exit(2);
  }
}

for (const step of PLAN) {
  process.stdout.write(`\n=== ${step.lane} ${step.tag} ${step.clCourt} ===\n`);
  const r = spawnSync(
    process.execPath,
    [
      "scripts/run-tmp-manual-cl-oneshot.cjs",
      step.clCourt,
      step.batchSize,
      step.targetMax,
      step.maxCalls,
      step.tag,
    ],
    {
      encoding: "utf8",
      maxBuffer: 20_000_000,
      cwd: root,
      env: { ...process.env, CL_FLY_EXEC_TIMEOUT_SEC: "540", CL_RATE_MS: "2200", CL_KEEP_DATE_FILTER: "0" },
    },
  );
  const text = `${r.stdout || ""}\n${r.stderr || ""}`;
  const j = lastJson(text);
  const fr = j?.fileResult || j || {};
  const cl = Number(fr.sessionApiCalls ?? fr.apiCalls ?? 0);
  const imported = Number(fr.items_imported ?? fr.itemsImported ?? 0);
  const status = fr.status || j?.status || j?.reason || "unknown";
  const row = { ...step, exit: r.status ?? 1, status, cl, imported };
  acc.batches.push(row);
  acc.totalCl += cl;
  if (acc.byLane[step.lane]) {
    acc.byLane[step.lane].cl += cl;
    acc.byLane[step.lane].casesAdded += imported;
  }
  process.stdout.write(`${JSON.stringify(row)}\n`);
  fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));

  if (status === "rate_limited" || /\bHTTP[_\s]?429\b/.test(text)) {
    acc.stopReason = "429";
    break;
  }
  // Only wait if oneshot itself failed with survived/orphan
  if ((r.status ?? 1) !== 0 && /LANE_A_CHILD_SURVIVED_PARENT|ORPHAN_LANE_A_CHILD/.test(text)) {
    process.stdout.write("WAIT_REAL_ORPHAN\n");
    if (!waitClear(10 * 60 * 1000)) {
      acc.stopReason = "orphan_uncleared";
      break;
    }
  }
}

acc.finishedAt = new Date().toISOString();
if (!acc.stopReason) acc.stopReason = "plan_complete";
fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
process.stdout.write(`\nFINISH_DONE ${JSON.stringify({ totalCl: acc.totalCl, byLane: acc.byLane, stop: acc.stopReason })}\n`);
process.exit(acc.stopReason === "429" ? 1 : 0);
