/**
 * Safer sequential balanced-10k CL growth. One court at a time; stop on orphan/429.
 * Usage: node scripts/run-tmp-queue2-balanced-10k-session-v2.cjs [maxTotalCalls]
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const maxTotal = Number(process.argv[2] || "200");
const reportPath = path.join(
  root,
  "packages",
  "research",
  "corpus",
  "reports",
  "queue2-balanced-10k-session-v2.json",
);

const PLAN = [
  { lane: "G3", clCourt: "ca3", batchSize: "6", targetMax: "20", maxCalls: "16", tag: "g3-ca3-r1" },
  { lane: "G3", clCourt: "ca4", batchSize: "6", targetMax: "20", maxCalls: "16", tag: "g3-ca4-r1" },
  { lane: "G3", clCourt: "ca6", batchSize: "6", targetMax: "20", maxCalls: "16", tag: "g3-ca6-r1" },
  { lane: "G3", clCourt: "ca2", batchSize: "6", targetMax: "28", maxCalls: "16", tag: "g3-ca2-r2" },
  { lane: "G1", clCourt: "wisctapp", batchSize: "6", targetMax: "15", maxCalls: "18", tag: "g1-wisctapp-r1" },
  { lane: "G1", clCourt: "connappct", batchSize: "6", targetMax: "15", maxCalls: "18", tag: "g1-connappct-r1" },
  { lane: "G1", clCourt: "arizctapp", batchSize: "6", targetMax: "15", maxCalls: "18", tag: "g1-arizctapp-r1" },
  { lane: "G1", clCourt: "nmctapp", batchSize: "6", targetMax: "15", maxCalls: "18", tag: "g1-nmctapp-r1" },
  { lane: "G1", clCourt: "indctapp", batchSize: "6", targetMax: "15", maxCalls: "18", tag: "g1-indctapp-r1" },
  { lane: "G2", clCourt: "neb", batchSize: "6", targetMax: "55", maxCalls: "16", tag: "g2-neb-r1", lte: "1999-12-31", gte: "1960-01-01" },
  { lane: "G2", clCourt: "kan", batchSize: "6", targetMax: "55", maxCalls: "16", tag: "g2-kan-r1", lte: "1999-12-31", gte: "1960-01-01" },
  { lane: "G3", clCourt: "ca8", batchSize: "6", targetMax: "22", maxCalls: "16", tag: "g3-ca8-r1" },
  { lane: "G3", clCourt: "cadc", batchSize: "6", targetMax: "24", maxCalls: "16", tag: "g3-cadc-r1" },
  { lane: "G3", clCourt: "cafc", batchSize: "6", targetMax: "22", maxCalls: "16", tag: "g3-cafc-r1" },
];

function run(args, envExtra) {
  return spawnSync(process.execPath, args, {
    encoding: "utf8",
    maxBuffer: 20_000_000,
    cwd: root,
    env: { ...process.env, ...envExtra },
  });
}

function parseUtf(bufOrText) {
  if (Buffer.isBuffer(bufOrText)) {
    if (bufOrText[0] === 0xff && bufOrText[1] === 0xfe) return bufOrText.toString("utf16le");
    if (bufOrText[1] === 0) return bufOrText.toString("utf16le");
    return bufOrText.toString("utf8");
  }
  return String(bufOrText || "");
}

function lastJson(text) {
  const lines = parseUtf(text)
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

function remoteClear() {
  const r = spawnSync(
    "flyctl",
    ["machine", "exec", "811d3e3f522648", "-a", "nyayagrid-staging", "--timeout", "40", "ps -o pid,ppid,etime,args"],
    { encoding: "utf8", maxBuffer: 4_000_000 },
  );
  const body = `${r.stdout || ""}\n${r.stderr || ""}`;
  const has = /staging-cl-batch-job-bundled|cl-batch-owner/.test(body);
  return { has, body };
}

function waitClear(maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const s = remoteClear();
    if (!s.has) return true;
    spawnSync(process.execPath, ["-e", "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,15000)"]);
  }
  return !remoteClear().has;
}

const accounting = {
  classification: "MANUAL_QUEUE2_BALANCED_10K_SESSION_V2",
  startedAt: new Date().toISOString(),
  maxTotal,
  a2: {
    skipped: true,
    reason: "no_verified_target_expected_res_per_cl_gte_3; 573_U.S._373_deferred; top~6_edges/~2.5cl~2.4",
  },
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

if (remoteClear().has) {
  process.stdout.write("WAIT_CLEAR_START\n");
  if (!waitClear(10 * 60 * 1000)) {
    accounting.stopReason = "orphan_present";
    fs.writeFileSync(reportPath, JSON.stringify(accounting, null, 2));
    process.exit(2);
  }
}

for (const step of PLAN) {
  if (accounting.totalCl >= maxTotal) {
    accounting.stopReason = "session_budget";
    break;
  }
  const remaining = maxTotal - accounting.totalCl;
  const maxCalls = String(Math.min(Number(step.maxCalls), remaining, 20));
  if (Number(maxCalls) < 6) {
    accounting.stopReason = "session_budget_floor";
    break;
  }

  const envExtra = {
    CL_FLY_EXEC_TIMEOUT_SEC: "540",
    CL_RATE_MS: "2200",
    CL_KEEP_DATE_FILTER: step.lte || step.gte ? "1" : "0",
    CL_DATE_FILED_LTE: step.lte || "",
    CL_DATE_FILED_GTE: step.gte || "",
  };

  process.stdout.write(`\n=== ${step.lane} ${step.tag} court=${step.clCourt} maxCalls=${maxCalls} budgetRem=${remaining} ===\n`);
  const r = run(
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
  const text = `${r.stdout || ""}\n${r.stderr || ""}`;
  const j = lastJson(text);
  const fr = j?.fileResult || j || {};
  const cl = Number(fr.sessionApiCalls ?? fr.apiCalls ?? j?.sessionApiCalls ?? 0);
  const imported = Number(fr.items_imported ?? fr.itemsImported ?? fr.imported ?? 0);
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
    ok: (r.status ?? 1) === 0 && imported >= 0,
  };
  accounting.batches.push(row);
  accounting.totalCl += cl;
  accounting.byLane[step.lane].cl += cl;
  accounting.byLane[step.lane].casesAdded += imported;
  process.stdout.write(`${JSON.stringify(row)}\n`);
  fs.writeFileSync(reportPath, JSON.stringify(accounting, null, 2));

  // Do not match X-RateLimit header noise — only real throttle states.
  if (
    status === "rate_limited" ||
    status === "429" ||
    /\bstatus["']?\s*:\s*["']?429\b/i.test(text) ||
    /\bHTTP[_\s]?429\b/i.test(text) ||
    /"reason"\s*:\s*"rate_limited"/i.test(text)
  ) {
    accounting.stopReason = "429";
    break;
  }
  if (status === "quota_paused" && imported === 0 && cl > 0) {
    // session call budget hit with no imports — try next court (cursor may be in duplicate zone)
    process.stdout.write("QUOTA_PAUSED_ZERO_IMPORT continue_next_court\n");
    continue;
  }
  if (/ORPHAN_LANE_A_CHILD|LANE_A_CHILD_SURVIVED_PARENT/i.test(text) || status === "ORPHAN_LANE_A_CHILD") {
    process.stdout.write("ORPHAN_DETECTED wait_clear\n");
    if (!waitClear(12 * 60 * 1000)) {
      accounting.stopReason = "orphan_uncleared";
      break;
    }
    continue;
  }
  if (/MAPPING_INVALID/i.test(text) || row.mappingStatus === "MAPPING_INVALID") {
    process.stdout.write(`SKIP_INVALID ${step.clCourt}\n`);
    continue;
  }
  if ((r.status ?? 1) !== 0 && imported === 0 && cl === 0) {
    // hard launcher failure — stop to avoid thrashing
    if (/ownership|HUMAN_REVIEW|emergency/i.test(text)) {
      accounting.stopReason = "ownership_or_gate";
      break;
    }
  }
}

accounting.finishedAt = new Date().toISOString();
if (!accounting.stopReason) accounting.stopReason = "plan_complete";
fs.writeFileSync(reportPath, JSON.stringify(accounting, null, 2));
process.stdout.write(
  `\nSESSION_DONE ${JSON.stringify({ totalCl: accounting.totalCl, byLane: accounting.byLane, stopReason: accounting.stopReason })}\n`,
);
process.exit(accounting.stopReason === "429" || accounting.stopReason === "orphan_uncleared" ? 1 : 0);
