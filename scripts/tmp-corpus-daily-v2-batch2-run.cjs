#!/usr/bin/env node
/**
 * Batch 2 orchestrator — non-SCOTUS high-value lanes.
 * Cap ~250–275 total CL including prior probe (accounted via BATCH2_PRIOR_CL).
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");
const QUEUE = path.join(REPORTS, "corpus-daily-v2-batch2-demand-queue.json");
const STATE = path.join(REPORTS, "corpus-daily-v2-batch2-run-state.json");
const FINAL = path.join(REPORTS, "corpus-daily-v2-batch2-final.json");

// Total session budget including probe; productive = total - prior
const TOTAL_BUDGET = Math.min(Math.max(Number(process.env.BATCH2_TOTAL_BUDGET || 270), 100), 275);
const PRIOR_CL = Math.max(Number(process.env.BATCH2_PRIOR_CL || 1), 0);
const SAFE_PRODUCTIVE = Math.max(TOTAL_BUDGET - PRIOR_CL, 40);
const BATCH_CL = Math.min(Math.max(Number(process.env.DAILY_V2_BATCH_CL || 60), 40), 75);
const BATCH_ACQUIRE = Math.min(Math.max(Number(process.env.DAILY_V2_BATCH_ACQUIRE || 20), 10), 25);
const CL_RATE_MS = Math.max(Number(process.env.CL_RATE_MS || 4000), 4000);
const NODE_PATH = process.env.NODE_PATH || "C:/Users/patel/Documents/nyayagrid/node_modules";

const LANE_NAMES = ["third_circuit", "edpa", "pa_supreme", "pa_superior", "federal_reporter", "other_controlling"];

function lastJson(text) {
  const t = String(text || "");
  const lines = t
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{") && l.includes('"ok"'));
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      /* */
    }
  }
  let start = t.lastIndexOf('{"ok"');
  if (start < 0) start = t.lastIndexOf("{");
  if (start >= 0) {
    let depth = 0;
    for (let k = start; k < t.length; k++) {
      if (t[k] === "{") depth++;
      else if (t[k] === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(t.slice(start, k + 1));
          } catch {
            /* */
          }
        }
      }
    }
  }
  return null;
}

function runNode(script, args, timeoutSec) {
  const r = spawnSync(process.execPath, [path.join(ROOT, script), ...args], {
    encoding: "utf8",
    maxBuffer: 60e6,
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_PATH,
      CORPUS_DAILY_V2: "1",
      CL_RATE_MS: String(CL_RATE_MS),
      CL_FETCH_TIMEOUT_MS: process.env.CL_FETCH_TIMEOUT_MS || "120000",
    },
    timeout: timeoutSec * 1000,
  });
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  return { status: r.status ?? 1, out, json: lastJson(out), error: r.error ? String(r.error.message || r.error) : null };
}

function census() {
  return runNode("scripts/tmp-corpus-daily-v2-batch2-identity.cjs", [], 120);
}
function reresolve() {
  return runNode("scripts/tmp-queue2-manual-cite-integrity.cjs", [], 300);
}

function emptyLane() {
  return { requests: 0, cases: 0, oldResolves: 0, uniqueTargets: 0, acquired: [] };
}

function classifyActualLane(target, result) {
  if (target?.laneName) return target.laneName;
  const cite = String(result?.citation || target?.citation || "");
  const court = String(result?.court || "").toLowerCase();
  if (/third circuit|us-ca-3|court of appeals for the third/i.test(court)) return "third_circuit";
  if (/eastern district of pennsylvania|e\.d\. pa|edpa|paed/i.test(court) || /f\.?\s*supp/i.test(cite)) {
    if (/eastern district of pennsylvania|e\.d\. pa|edpa/i.test(court)) return "edpa";
  }
  if (/pennsylvania.*supreme|supreme court of pennsylvania/i.test(court)) return "pa_supreme";
  if (/superior court of pennsylvania|pennsylvania.*superior/i.test(court)) return "pa_superior";
  if (/f\.(2d|3d|4th)/i.test(cite)) return "federal_reporter";
  if (/a\.(2d|3d)/i.test(cite)) return "pa_supreme";
  if (/f\.?\s*supp/i.test(cite)) return "edpa";
  return "other_controlling";
}

function main() {
  if (!process.env.COURTLISTENER_API_KEY?.trim()) {
    console.log(JSON.stringify({ ok: false, reason: "COURTLISTENER_API_KEY missing" }));
    process.exit(2);
  }
  if (!process.env.DATABASE_URL?.trim() || !process.env.OPENAI_API_KEY?.trim()) {
    console.log(JSON.stringify({ ok: false, reason: "missing_env" }));
    process.exit(2);
  }
  if (!fs.existsSync(QUEUE)) {
    console.log(JSON.stringify({ ok: false, reason: "demand queue missing" }));
    process.exit(2);
  }

  const queue = JSON.parse(fs.readFileSync(QUEUE, "utf8"));
  const targets = (queue.targets || []).filter((t) => t.status === "READY_CL");
  const startCensus = census();
  if (!startCensus.json?.ok) {
    console.log(JSON.stringify({ ok: false, reason: "start_identity_failed", detail: startCensus.json || startCensus.out.slice(0, 400) }));
    process.exit(3);
  }
  const startResolve = reresolve();
  const startLive = startCensus.json.live;

  const lanes = Object.fromEntries(LANE_NAMES.map((n) => [n, emptyLane()]));
  const metrics = {
    requestsUsed: 0,
    casesAdded: 0,
    oldResolves: 0,
    uniqueTargetsEliminated: 0,
    newEdges: 0,
    controllingAdded: 0,
    benchmarkRelevantAdded: 0,
    rateLimited: 0,
    gateway502_504: 0,
    longWaitsOver5m: 0,
    acquired: [],
    batches: [],
  };

  const state = {
    classification: "CORPUS_DAILY_V2_BATCH2_RUN",
    startedAt: new Date().toISOString(),
    totalBudget: TOTAL_BUDGET,
    priorCl: PRIOR_CL,
    safeProductive: SAFE_PRODUCTIVE,
    startSnapshot: startLive,
    startResolvedAfterIntegrity: startResolve.json?.resolvedAfter ?? startLive.resolved,
    pointer: 0,
    stopReason: null,
    continue: true,
    metrics,
    lanes,
  };
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));

  const seen = new Set();
  let consecutiveWeak = 0;

  while (state.continue) {
    if (metrics.requestsUsed >= SAFE_PRODUCTIVE) {
      state.stopReason = "SAFE_HOURLY_HEADROOM";
      state.continue = false;
      break;
    }
    if (state.pointer >= targets.length) {
      state.stopReason = "TARGET_QUEUE_EXHAUSTED";
      state.continue = false;
      break;
    }

    const remaining = SAFE_PRODUCTIVE - metrics.requestsUsed;
    const thisBatchCl = Math.min(BATCH_CL, remaining);
    if (thisBatchCl < 8) {
      state.stopReason = "SAFE_HOURLY_HEADROOM";
      state.continue = false;
      break;
    }

    const batchTargets = [];
    while (batchTargets.length < BATCH_ACQUIRE && state.pointer < targets.length) {
      const t = targets[state.pointer++];
      const key = String(t.citation).toLowerCase();
      if (seen.has(key)) continue;
      // Hard reject any US Reports that slipped through
      if (/^\d+\s+u\.?\s*s\.?\s+\d+/i.test(t.citation) && !/supp/i.test(t.citation)) continue;
      seen.add(key);
      batchTargets.push(t);
    }
    if (!batchTargets.length) {
      state.stopReason = "TARGET_QUEUE_EXHAUSTED";
      state.continue = false;
      break;
    }

    const beforeResolved = state.lastResolved ?? (startResolve.json?.resolvedAfter ?? startLive.resolved);
    const beforeUnresolved = state.lastUnresolved ?? startLive.unresolved;
    const beforeExtracted = state.lastExtracted ?? startLive.extracted;
    const beforeCases = state.lastCases ?? startLive.cases;

    const citeArg = batchTargets.map((t) => t.citation).join("|");
    const ingest = runNode(
      "scripts/tmp-queue2-cite-demand-multi-ingest.cjs",
      [citeArg, String(thisBatchCl), String(BATCH_ACQUIRE)],
      Math.max(900, thisBatchCl * 25),
    );
    const ij = ingest.json || {};
    const clUsed = Number(ij.courtListenerHttpCalls || 0);
    metrics.requestsUsed += clUsed;

    if (ij.rateLimited) {
      metrics.rateLimited += 1;
      state.stopReason = "429";
      state.continue = false;
      state.retryAfter = ij.retryAfter || null;
    }

    const results = Array.isArray(ij.results) ? ij.results : [];
    const batchCases = [];
    const laneClApprox = {}; // distribute CL by target preverify+acquire when available

    for (const r of results) {
      const st = String(r.status || "").toLowerCase();
      const bt = batchTargets.find((t) => t.citation === r.citation);
      const laneName = classifyActualLane(bt, r);
      const clReq = Number(r.clRequests || 0);
      laneClApprox[laneName] = (laneClApprox[laneName] || 0) + clReq;

      if (/502|504|temporary_provider|gateway/i.test(String(r.reason || ""))) metrics.gateway502_504 += 1;
      if (st === "already_present" || st === "skipped" || st === "preverify_fail") continue;
      if (st === "imported" || st === "new_version" || st === "inserted" || st === "acquired") {
        const row = {
          citation: r.citation,
          title: r.title || null,
          court: r.court || null,
          authorityId: r.authorityId || null,
          clRequests: clReq,
          reason: bt?.reason || "batch2_demand",
          laneName,
          benchmarkRelevant: Boolean(bt?.benchmarkRelevant),
          status: r.status,
        };
        batchCases.push(row);
        metrics.acquired.push(row);
        metrics.casesAdded += 1;
        metrics.controllingAdded += 1;
        if (row.benchmarkRelevant) metrics.benchmarkRelevantAdded += 1;
        if (!lanes[laneName]) lanes[laneName] = emptyLane();
        lanes[laneName].cases += 1;
        lanes[laneName].acquired.push(row);
      }
    }

    // Attribute remaining CL from deferred/preverify to lanes by attempted targets
    for (const t of batchTargets) {
      const ln = t.laneName || "other_controlling";
      if (!laneClApprox[ln]) laneClApprox[ln] = 0;
    }
    // Normalize lane requests to sum ≈ clUsed
    const attributed = Object.values(laneClApprox).reduce((a, b) => a + b, 0);
    if (attributed > 0 && clUsed > 0) {
      for (const ln of Object.keys(laneClApprox)) {
        lanes[ln] = lanes[ln] || emptyLane();
        lanes[ln].requests += Math.round((laneClApprox[ln] / attributed) * clUsed);
      }
    } else if (clUsed > 0 && batchTargets[0]) {
      const ln = batchTargets[0].laneName || "other_controlling";
      lanes[ln] = lanes[ln] || emptyLane();
      lanes[ln].requests += clUsed;
    }

    const resolve = reresolve();
    const afterCensus = census();
    const afterLive = afterCensus.json?.live || {};
    const afterResolved = resolve.json?.resolvedAfter ?? afterLive.resolved ?? beforeResolved;
    const oldResolves = Math.max(0, afterResolved - beforeResolved);
    const extractedAfter = afterLive.extracted ?? beforeExtracted;
    const unresolvedAfter = afterLive.unresolved ?? beforeUnresolved;
    const newEdges = Math.max(0, extractedAfter - beforeExtracted);

    metrics.oldResolves += oldResolves;
    metrics.uniqueTargetsEliminated += batchCases.length;
    metrics.newEdges += newEdges;

    // Distribute old resolves proportional to cases in batch lanes
    if (batchCases.length && oldResolves) {
      const by = {};
      for (const c of batchCases) by[c.laneName] = (by[c.laneName] || 0) + 1;
      for (const [ln, n] of Object.entries(by)) {
        lanes[ln] = lanes[ln] || emptyLane();
        lanes[ln].oldResolves += Math.round((n / batchCases.length) * oldResolves);
        lanes[ln].uniqueTargets += n;
      }
    }

    state.lastResolved = afterResolved;
    state.lastUnresolved = unresolvedAfter;
    state.lastExtracted = extractedAfter;
    state.lastCases = afterLive.cases ?? beforeCases;

    const health = {
      duplicates: afterLive.duplicates ?? null,
      orphans: afterLive.orphans ?? null,
      missingEmbeddings: afterLive.missingEmbeddings ?? null,
      failed: afterLive.failed ?? null,
      notProcessed: afterLive.notProcessed ?? null,
      status:
        afterLive.duplicates === 0 && afterLive.orphans === 0 && afterLive.missingEmbeddings === 0 && (afterLive.failed === 0 || afterLive.failed == null)
          ? "GREEN"
          : "RED",
    };

    const batchRec = {
      at: new Date().toISOString(),
      attempted: batchTargets.map((t) => ({ citation: t.citation, lane: t.laneName })),
      clUsed,
      casesAdded: batchCases.length,
      oldResolves,
      efficiency: {
        casesPerCl: clUsed ? +(batchCases.length / clUsed).toFixed(3) : null,
        oldResolvesPerCl: clUsed ? +(oldResolves / clUsed).toFixed(3) : null,
      },
      health,
      rateLimited: Boolean(ij.rateLimited),
      acquired: batchCases,
    };
    metrics.batches.push(batchRec);

    const weak =
      batchCases.length === 0 || (clUsed >= 15 && oldResolves / clUsed < 0.15 && batchCases.length / clUsed < 0.12);
    if (weak) consecutiveWeak += 1;
    else consecutiveWeak = 0;
    if (consecutiveWeak >= 3) {
      state.stopReason = "DIMINISHING_RETURNS";
      state.continue = false;
    }
    if (health.status !== "GREEN") {
      state.stopReason = "HEALTH_REGRESSION";
      state.continue = false;
    }

    fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
    console.log(JSON.stringify({ ok: true, event: "batch_complete", requestsUsed: metrics.requestsUsed, casesAdded: metrics.casesAdded, oldResolves: metrics.oldResolves, batch: batchRec, stopReason: state.stopReason }));

    if (!state.continue) break;
  }

  const finalResolve = reresolve();
  const finalCensus = census();
  const endLive = finalCensus.json?.live || {};
  if (!state.stopReason) state.stopReason = "TARGET_QUEUE_EXHAUSTED";
  state.finishedAt = new Date().toISOString();
  state.endSnapshot = endLive;

  const totalClSession = PRIOR_CL + metrics.requestsUsed;
  const totalCl = metrics.requestsUsed || 1;

  const summary = {
    ok: true,
    classification: "DAILY_HIGH_VALUE_COURTLISTENER_STRENGTHENING_BATCH2",
    status:
      state.stopReason === "429" || state.stopReason === "HEALTH_REGRESSION" || state.stopReason === "PROVIDER_FAILURE"
        ? metrics.casesAdded > 0
          ? "CORPUS_DAILY_BATCH2_PARTIAL_QUOTA"
          : "CORPUS_DAILY_BATCH2_BLOCKED"
        : state.stopReason === "SAFE_HOURLY_HEADROOM" || metrics.casesAdded > 0
          ? "CORPUS_DAILY_BATCH2_COMPLETE"
          : "CORPUS_DAILY_BATCH2_PARTIAL_QUOTA",
    stopReason: state.stopReason,
    courtListener: {
      limitMin: 25,
      limitHour: 300,
      limitDay: 1400,
      remainingAtStart: { minute: 25, hour: 300, day: 1100 },
      safeBatchBudget: TOTAL_BUDGET,
      priorProbe: PRIOR_CL,
      productiveRequests: metrics.requestsUsed,
      requestsActuallyUsed: totalClSession,
      rateLimited429: metrics.rateLimited,
      gateway502_504: metrics.gateway502_504,
      longWaitsOver5m: metrics.longWaitsOver5m,
    },
    startSnapshot: startLive,
    laneResults: Object.fromEntries(
      LANE_NAMES.map((n) => [
        n,
        {
          requests: lanes[n]?.requests || 0,
          cases: lanes[n]?.cases || 0,
          oldResolves: lanes[n]?.oldResolves || 0,
        },
      ]),
    ),
    acquisition: {
      casesAdded: metrics.casesAdded,
      controllingAdded: metrics.controllingAdded,
      benchmarkRelevantAdded: metrics.benchmarkRelevantAdded,
      uniqueMissingTargetsEliminated: metrics.uniqueTargetsEliminated,
    },
    citationValue: {
      oldUnresolvedResolved: metrics.oldResolves,
      newEdges: metrics.newEdges,
      netUnresolvedChange: (endLive.unresolved ?? 0) - startLive.unresolved,
      newUnresolved: Math.max(0, (endLive.unresolved ?? 0) - startLive.unresolved + metrics.oldResolves),
    },
    efficiency: {
      casesPerCl: +(metrics.casesAdded / totalCl).toFixed(3),
      oldResolvesPerCl: +(metrics.oldResolves / totalCl).toFixed(3),
      uniqueTargetsPerCl: +(metrics.uniqueTargetsEliminated / totalCl).toFixed(3),
      controllingPerCl: +(metrics.controllingAdded / totalCl).toFixed(3),
      benchmarkPerCl: +(metrics.benchmarkRelevantAdded / totalCl).toFixed(3),
    },
    corpusHealth: {
      duplicates: endLive.duplicates,
      orphans: endLive.orphans,
      missingEmbeddings: endLive.missingEmbeddings,
      failed: endLive.failed,
      notProcessed: endLive.notProcessed,
      status:
        endLive.duplicates === 0 && endLive.orphans === 0 && endLive.missingEmbeddings === 0 ? "GREEN" : "RED",
    },
    endSnapshot: endLive,
    highValueHandoff: metrics.acquired
      .filter((a) => ["third_circuit", "edpa", "pa_supreme", "pa_superior"].includes(a.laneName) || a.benchmarkRelevant)
      .slice(0, 20),
    finalResolve: {
      resolvedAfter: finalResolve.json?.resolvedAfter,
      newResolved: finalResolve.json?.newResolved,
    },
    batches: metrics.batches.length,
  };

  fs.writeFileSync(FINAL, JSON.stringify(summary, null, 2));
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main();
