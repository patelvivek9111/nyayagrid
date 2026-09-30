#!/usr/bin/env node
/**
 * queue2:morning — print overnight morning readiness WITHOUT CourtListener or mutations.
 * Usage: npm run queue2:morning
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const reports = path.join(__dirname, "..", "packages/research/corpus/reports");

function read(name) {
  const p = path.join(reports, name);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

const pack = read("queue2-morning-execution-pack.json");
const score = read("queue2-week1-scorecard.json");
const integrity = read("queue2-integrity-full-pass.json");
const dual = read("queue2-dual-value-case-queue.json");
const courtMap = read("court-map-audit.json");

if (!pack) {
  console.log(JSON.stringify({ ok: false, reason: "missing_morning_execution_pack" }, null, 2));
  process.exit(2);
}

const out = {
  ok: true,
  classification: "QUEUE2_MORNING_READINESS",
  generatedAt: new Date().toISOString(),
  courtListenerHttpCalls: 0,
  mutations: 0,
  safety: {
    workerStarted: false,
    clCalls: 0,
    acquisitionStarted: false,
  },
  liveBaseline: pack.liveBaseline,
  week1: pack.week1 || score,
  week1Status: score?.status || null,
  quotaNeeded: pack.quotaNeeded,
  topBatches: (pack.priorityBatches || []).slice(0, 15),
  batchCount: (pack.priorityBatches || []).length,
  plannedCases: pack.quotaNeeded?.plannedCases,
  dualValueTop5: (dual?.top20 || []).slice(0, 5).map((t) => ({
    citation: t.normalizedCitation,
    dualValueScore: t.dualValueScore,
    edges: t.unresolvedCitationEdges,
  })),
  knownCourtMappings: {
    valid: courtMap?.valid,
    conflicting: courtMap?.conflicting,
    unknown: courtMap?.unknown,
  },
  integrity: integrity,
  stopConditions: pack.stopConditions,
  externalVerificationNeeded: pack.externalVerificationNeeded,
  zeroCLWork: pack.zeroCLWork,
};
console.log(JSON.stringify(out, null, 2));
