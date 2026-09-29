/**
 * Session 2 supervised one-shots only. No long orphan-wait orchestrator.
 * On LANE_A_CHILD_SURVIVED_PARENT / 408: STOP (do not thrash).
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const reportPath = path.join(root, "packages/research/corpus/reports/queue2-s2-growth.json");

const PLAN = [
  { lane: "G1", clCourt: "arizctapp", batchSize: "6", targetMax: "20", maxCalls: "16", tag: "s2-g1-arizctapp" },
  { lane: "G1", clCourt: "connappct", batchSize: "6", targetMax: "20", maxCalls: "16", tag: "s2-g1-connappct" },
  { lane: "G3", clCourt: "ca5", batchSize: "6", targetMax: "25", maxCalls: "16", tag: "s2-g3-ca5-hist", lte: "1999-12-31", gte: "1960-01-01" },
  { lane: "G3", clCourt: "ca3", batchSize: "6", targetMax: "25", maxCalls: "16", tag: "s2-g3-ca3-hist", lte: "1999-12-31", gte: "1960-01-01" },
  { lane: "G3", clCourt: "ca9", batchSize: "6", targetMax: "25", maxCalls: "16", tag: "s2-g3-ca9-hist", lte: "1999-12-31", gte: "1960-01-01" },
  { lane: "DISTRICT", clCourt: "nysd", batchSize: "3", targetMax: "5", maxCalls: "10", tag: "s2-dist-nysd" },
  { lane: "DISTRICT", clCourt: "cacd", batchSize: "3", targetMax: "5", maxCalls: "10", tag: "s2-dist-cacd" },
  { lane: "DISTRICT", clCourt: "ilnd", batchSize: "3", targetMax: "5", maxCalls: "10", tag: "s2-dist-ilnd" },
  { lane: "G1", clCourt: "nmctapp", batchSize: "5", targetMax: "15", maxCalls: "14", tag: "s2-g1-nmctapp" },
  { lane: "G1", clCourt: "wisctapp", batchSize: "6", targetMax: "30", maxCalls: "14", tag: "s2-g1-wisctapp" },
  { lane: "G2", clCourt: "wis", batchSize: "6", targetMax: "70", maxCalls: "14", tag: "s2-g2-wis-hist", lte: "1999-12-31", gte: "1960-01-01" },
  { lane: "G3", clCourt: "ca5", batchSize: "6", targetMax: "30", maxCalls: "14", tag: "s2-g3-ca5-fill" },
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

const acc = {
  classification: "MANUAL_QUEUE2_BALANCED_10K_SESSION_2_GROWTH",
  startedAt: new Date().toISOString(),
  a2: { skipped: true, reason: "no_verified_target_expected_res_per_cl_gte_3_from_prior_refresh" },
  batches: [],
  byLane: {
    G1: { cl: 0, casesAdded: 0 },
    G2: { cl: 0, casesAdded: 0 },
    G3: { cl: 0, casesAdded: 0 },
    DISTRICT: { cl: 0, casesAdded: 0 },
  },
  totalCl: 0,
  stopReason: null,
};

if (remoteBusy()) {
  acc.stopReason = "remote_child_present_at_start";
  fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
  process.stdout.write("HOLD remote child present\n");
  process.exit(2);
}

for (const step of PLAN) {
  process.stdout.write(`\n=== ${step.lane} ${step.tag} ${step.clCourt} ===\n`);
  const env = {
    ...process.env,
    CL_FLY_EXEC_TIMEOUT_SEC: "540",
    CL_RATE_MS: "2200",
    CL_KEEP_DATE_FILTER: step.lte || step.gte ? "1" : "0",
    CL_DATE_FILED_LTE: step.lte || "",
    CL_DATE_FILED_GTE: step.gte || "",
  };
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
    { encoding: "utf8", maxBuffer: 20_000_000, cwd: root, env },
  );
  const text = `${r.stdout || ""}\n${r.stderr || ""}`;
  const j = lastJson(text);
  const fr = j?.fileResult || j || {};
  const cl = Number(fr.sessionApiCalls ?? fr.apiCalls ?? 0);
  const imported = Number(fr.items_imported ?? fr.itemsImported ?? 0);
  const status = fr.status || j?.status || j?.reason || "unknown";
  const row = {
    lane: step.lane,
    clCourt: step.clCourt,
    tag: step.tag,
    exit: r.status ?? 1,
    status,
    cl,
    imported,
    mappingStatus: fr.mappingStatus || j?.mappingStatus || null,
    checkpoint: fr.last_successful_external_id || fr.cursor || null,
  };
  acc.batches.push(row);
  acc.totalCl += cl;
  if (acc.byLane[step.lane]) {
    acc.byLane[step.lane].cl += cl;
    acc.byLane[step.lane].casesAdded += imported;
  }
  process.stdout.write(`${JSON.stringify(row)}\n`);
  fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));

  if (status === "rate_limited" || /\bHTTP[_\s]?429\b/.test(text) || /"status"\s*:\s*429/.test(text)) {
    acc.stopReason = "429";
    break;
  }
  if (
    (r.status ?? 1) !== 0 &&
    /LANE_A_CHILD_SURVIVED_PARENT|ORPHAN_LANE_A_CHILD|408/.test(text)
  ) {
    acc.stopReason = "408_or_orphan_stop";
    process.stdout.write("STOP: 408/orphan — no long wait\n");
    break;
  }
  if (/MAPPING_INVALID|unmapped_court/.test(text) || status === "MAPPING_INVALID") {
    process.stdout.write(`SKIP invalid mapping ${step.clCourt}\n`);
    continue;
  }
}

acc.finishedAt = new Date().toISOString();
if (!acc.stopReason) acc.stopReason = "plan_complete";
fs.writeFileSync(reportPath, JSON.stringify(acc, null, 2));
process.stdout.write(`\nGROWTH_DONE ${JSON.stringify({ totalCl: acc.totalCl, byLane: acc.byLane, stop: acc.stopReason })}\n`);
process.exit(acc.stopReason === "429" || acc.stopReason === "408_or_orphan_stop" ? 1 : 0);
