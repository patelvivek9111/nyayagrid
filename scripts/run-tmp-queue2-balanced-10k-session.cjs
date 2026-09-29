/**
 * Manual Queue #2 balanced 10k multi-lane CL session.
 * Does NOT start queue2:worker. Processes G3 → G1 → G2 batches until budget.
 *
 * Usage:
 *   node scripts/run-tmp-queue2-balanced-10k-session.cjs [maxTotalCalls]
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const maxTotal = Number(process.argv[2] || process.env.QUEUE2_SESSION_BUDGET || "220");
const reportPath = path.join(
  root,
  "packages",
  "research",
  "corpus",
  "reports",
  "queue2-balanced-10k-session.json",
);

/** @type {Array<{lane:string,clCourt:string,state:string,batchSize:string,targetMax:string,maxCalls:string,tag:string,lte?:string,gte?:string}>} */
const PLAN = [
  // G3 — weakest federal circuits; historical then recent fill
  { lane: "G3", clCourt: "ca2", state: "US", batchSize: "8", targetMax: "25", maxCalls: "22", tag: "g3-ca2-hist", lte: "1999-12-31", gte: "1950-01-01" },
  { lane: "G3", clCourt: "ca2", state: "US", batchSize: "8", targetMax: "25", maxCalls: "18", tag: "g3-ca2-fill" },
  { lane: "G3", clCourt: "ca5", state: "US", batchSize: "8", targetMax: "25", maxCalls: "22", tag: "g3-ca5-hist", lte: "1999-12-31", gte: "1950-01-01" },
  { lane: "G3", clCourt: "ca5", state: "US", batchSize: "8", targetMax: "25", maxCalls: "18", tag: "g3-ca5-fill" },
  { lane: "G3", clCourt: "ca3", state: "US", batchSize: "8", targetMax: "24", maxCalls: "22", tag: "g3-ca3-hist", lte: "1999-12-31", gte: "1950-01-01" },
  { lane: "G3", clCourt: "ca4", state: "US", batchSize: "8", targetMax: "24", maxCalls: "20", tag: "g3-ca4-hist", lte: "1999-12-31", gte: "1950-01-01" },
  // G1 — intermediate appellate for underrepresented states
  { lane: "G1", clCourt: "wisctapp", state: "WI", batchSize: "8", targetMax: "20", maxCalls: "24", tag: "g1-wisctapp" },
  { lane: "G1", clCourt: "connappct", state: "CT", batchSize: "8", targetMax: "20", maxCalls: "24", tag: "g1-connappct" },
  { lane: "G1", clCourt: "arizctapp", state: "AZ", batchSize: "8", targetMax: "20", maxCalls: "24", tag: "g1-arizctapp" },
  { lane: "G1", clCourt: "nmctapp", state: "NM", batchSize: "8", targetMax: "18", maxCalls: "22", tag: "g1-nmctapp" },
  { lane: "G1", clCourt: "indctapp", state: "IN", batchSize: "8", targetMax: "18", maxCalls: "22", tag: "g1-indctapp" },
  // G2 — historical high-court for recent-heavy jurisdictions
  { lane: "G2", clCourt: "neb", state: "NE", batchSize: "8", targetMax: "60", maxCalls: "22", tag: "g2-neb-hist", lte: "1999-12-31", gte: "1950-01-01" },
  { lane: "G2", clCourt: "kan", state: "KS", batchSize: "8", targetMax: "60", maxCalls: "22", tag: "g2-kan-hist", lte: "1999-12-31", gte: "1950-01-01" },
  { lane: "G2", clCourt: "ky", state: "KY", batchSize: "8", targetMax: "60", maxCalls: "20", tag: "g2-ky-hist", lte: "1999-12-31", gte: "1950-01-01" },
];

function run(cmd, args, envExtra = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 20_000_000,
    cwd: root,
    env: { ...process.env, ...envExtra },
  });
  return { status: r.status ?? 1, text: `${r.stdout || ""}\n${r.stderr || ""}` };
}

function lastJson(text) {
  const lines = text
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

function extractCalls(j) {
  return Number(
    j?.sessionApiCalls ??
      j?.apiCalls ??
      j?.fileResult?.sessionApiCalls ??
      j?.fileResult?.apiCalls ??
      j?.courtListenerHttpCalls ??
      0,
  );
}

function extractImported(j) {
  return Number(
    j?.itemsImported ??
      j?.imported ??
      j?.fileResult?.itemsImported ??
      j?.fileResult?.imported ??
      j?.qualifyingAdded ??
      0,
  );
}

const accounting = {
  classification: "MANUAL_QUEUE2_BALANCED_10K_SESSION",
  startedAt: new Date().toISOString(),
  maxTotal,
  a2: { skipped: true, reason: "no_verified_target_expected_res_per_cl_gte_3; top_remaining_~6_edges/~2.5_cl~2.4; 573_U.S._373_deferred" },
  batches: [],
  byLane: {
    A2: { cl: 0, casesAdded: 0 },
    G1: { cl: 0, casesAdded: 0 },
    G2: { cl: 0, casesAdded: 0 },
    G3: { cl: 0, casesAdded: 0 },
  },
  totalCl: 0,
  stopReason: null,
};

for (const step of PLAN) {
  if (accounting.totalCl >= maxTotal) {
    accounting.stopReason = "session_budget";
    break;
  }
  const remaining = maxTotal - accounting.totalCl;
  const maxCalls = String(Math.min(Number(step.maxCalls), remaining, 28));
  if (Number(maxCalls) < 4) {
    accounting.stopReason = "session_budget_floor";
    break;
  }

  const envExtra = {
    CL_KEEP_DATE_FILTER: step.lte || step.gte ? "1" : "0",
    CL_DATE_FILED_LTE: step.lte || "",
    CL_DATE_FILED_GTE: step.gte || "",
    CL_FLY_EXEC_TIMEOUT_SEC: "540",
  };

  process.stdout.write(
    `\n=== ${step.lane} ${step.tag} court=${step.clCourt} maxCalls=${maxCalls} remainingBudget=${remaining} ===\n`,
  );
  const batch = run(
    process.execPath,
    [
      "scripts/run-tmp-manual-cl-oneshot.cjs",
      step.clCourt,
      step.batchSize,
      step.targetMax,
      maxCalls,
      step.tag,
    ],
    envExtra,
  );
  const j = lastJson(batch.text);
  const cl = extractCalls(j);
  const imported = extractImported(j);
  const row = {
    ...step,
    maxCallsUsed: maxCalls,
    exit: batch.status,
    status: j?.status || j?.fileResult?.status || j?.reason || "unknown",
    cl,
    imported,
    mappingStatus: j?.mappingStatus || j?.fileResult?.mappingStatus || null,
    checkpoint: j?.checkpoint || j?.fileResult?.checkpoint || j?.lastSuccessfulExternalId || null,
    ok: batch.status === 0,
  };
  accounting.batches.push(row);
  accounting.totalCl += cl;
  accounting.byLane[step.lane].cl += cl;
  accounting.byLane[step.lane].casesAdded += imported;
  process.stdout.write(`${JSON.stringify(row)}\n`);

  if (batch.status !== 0) {
    const text = batch.text.slice(-1200);
    if (/429|rate.?limit/i.test(text) || row.status === "rate_limited") {
      accounting.stopReason = "429";
      break;
    }
    if (/MAPPING_INVALID|mapping.?uncertain/i.test(text) || row.mappingStatus === "MAPPING_INVALID") {
      process.stdout.write(`SKIP mapping invalid for ${step.clCourt}; continue\n`);
      continue;
    }
    if (/quota|LOCAL_QUOTA|safety.?floor/i.test(text)) {
      accounting.stopReason = "quota_floor";
      break;
    }
    // Continue past single-batch failures that are non-fatal zero-progress
    if (/zero|no.?progress|already.?at.?target|target.?met/i.test(String(row.status))) {
      continue;
    }
    process.stdout.write(text);
    // Do not abort whole session on one court failure; continue
    continue;
  }
}

accounting.finishedAt = new Date().toISOString();
if (!accounting.stopReason) accounting.stopReason = "plan_exhausted_or_complete";
fs.writeFileSync(reportPath, JSON.stringify(accounting, null, 2));
process.stdout.write(`\nSESSION_DONE ${JSON.stringify({ totalCl: accounting.totalCl, byLane: accounting.byLane, stopReason: accounting.stopReason })}\n`);
process.exit(accounting.stopReason === "429" ? 1 : 0);
