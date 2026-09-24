#!/usr/bin/env node
/**
 * Queue #2 mandatory preflight — ZERO corpus mutations.
 * Usage: node scripts/queue2-preflight.cjs
 *        npm run queue2:preflight
 */
"use strict";

const fs = require("fs");
const path = require("path");
const {
  runPreflight,
  loadSafetyConfig,
  fingerprintProductionFiles,
  WORKER_VERSION,
} = require("./queue2-worker-safety.cjs");

const root = path.join(__dirname, "..");
const reports = path.join(root, "packages/research/corpus/reports");

const opts = {
  env: process.env,
  safetyConfig: loadSafetyConfig(),
  allowDisabledForDryRun: process.env.QUEUE2_PREFLIGHT_ALLOW_DISABLED === "1",
  featureAgents: process.env.FEATURE_AGENTS || "0",
  queue2Open: true,
  queue3Open: false,
  dbReachable: process.env.QUEUE2_DB_REACHABLE !== "0",
  storageReachable: process.env.QUEUE2_STORAGE_REACHABLE !== "0",
  networkOk: process.env.QUEUE2_NETWORK_ONLINE !== "0",
  courtListenerKeyPresent: Boolean(process.env.COURTLISTENER_API_KEY),
  workerVersion: WORKER_VERSION,
  freeDiskBytes: process.env.QUEUE2_FREE_DISK_BYTES
    ? Number(process.env.QUEUE2_FREE_DISK_BYTES)
    : undefined,
  tempFreeBytes: process.env.QUEUE2_TEMP_FREE_BYTES
    ? Number(process.env.QUEUE2_TEMP_FREE_BYTES)
    : undefined,
};

const result = runPreflight(opts);
const outPath = path.join(reports, "queue2-preflight-last.json");
fs.mkdirSync(reports, { recursive: true });
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      ...result,
      codeFingerprint: fingerprintProductionFiles(),
      workerVersion: WORKER_VERSION,
    },
    null,
    2,
  ),
);

if (result.ok) {
  console.log("PREFLIGHT_PASS");
} else {
  console.log("PREFLIGHT_FAIL");
  console.log(`reasons=[${result.reasons.join(", ")}]`);
}
console.log(JSON.stringify({ mutations: result.mutations, aiCalls: result.aiCalls, outPath }));
process.exit(result.ok ? 0 : 2);
