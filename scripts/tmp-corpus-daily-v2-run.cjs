#!/usr/bin/env node
/**
 * Chat B daily CourtListener high-value corpus strengthening orchestrator.
 *
 * - Uses local multi-ingest (no Fly)
 * - Bounded batches (~50–100 CL requests)
 * - One request at a time via existing CL_RATE_MS pacing
 * - Stops on 429 / diminishing returns / safe daily floor
 * - Does NOT re-probe CourtListener quota
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");
const QUEUE = path.join(REPORTS, "corpus-daily-v2-demand-queue.json");
const STATE = path.join(REPORTS, "corpus-daily-v2-run-state.json");
const FINAL = path.join(REPORTS, "corpus-daily-v2-final.json");

const SAFE_DAY_BUDGET = Math.min(Math.max(Number(process.env.DAILY_V2_SAFE_BUDGET || 1050), 100), 1200);
const BATCH_CL = Math.min(Math.max(Number(process.env.DAILY_V2_BATCH_CL || 75), 40), 100);
const BATCH_ACQUIRE = Math.min(Math.max(Number(process.env.DAILY_V2_BATCH_ACQUIRE || 25), 10), 35);
const CL_RATE_MS = Math.max(Number(process.env.CL_RATE_MS || 4000), 4000);
const NODE_PATH = process.env.NODE_PATH || path.join("C:/Users/patel/Documents/nyayagrid/node_modules");

function lastJson(text) {
  const t = String(text || "");
  // Prefer last compact single-line object
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
  // Fallback: brace-match from last {"ok" or last {
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
  return {
    status: r.status ?? 1,
    out,
    json: lastJson(out),
    signal: r.signal || null,
    error: r.error ? String(r.error.message || r.error) : null,
  };
}

function census() {
  return runNode("scripts/tmp-corpus-daily-v2-identity.cjs", [], 120);
}

function reresolve() {
  return runNode("scripts/tmp-queue2-manual-cite-integrity.cjs", [], 300);
}

function classifyCourtBucket(row) {
  const court = String(row.court || row.circuit || "").toLowerCase();
  const cite = String(row.citation || "");
  if (/u\.s\./i.test(cite) && !/supp/i.test(cite)) return "scotus";
  if (/supreme court of the united states|scotus/i.test(court)) return "scotus";
  if (/f\.(2d|3d|4th)/i.test(cite) || /circuit|court of appeals/i.test(court)) return "federal_circuit";
  if (/f\.?\s*supp/i.test(cite) || /district/i.test(court)) return "district";
  if (/high|supreme/i.test(court) && !/united states/i.test(court)) return "state_supreme";
  if (/appellate|superior|intermediate/i.test(court)) return "state_intermediate";
  if (/a\.(2d|3d)|p\.(2d|3d)|s\.e\.|s\.w\.|n\.e\.|n\.w\.|so\./i.test(cite)) return "state_supreme";
  return "other";
}

function emptyMetrics() {
  return {
    requestsUsed: 0,
    casesAdded: 0,
    oldResolves: 0,
    uniqueTargetsEliminated: 0,
    newEdges: 0,
    newUnresolved: 0,
    netUnresolvedChange: 0,
    controllingAdded: 0,
    benchmarkRelevantAdded: 0,
    byCourt: {
      scotus: 0,
      federal_circuit: 0,
      district: 0,
      state_supreme: 0,
      state_intermediate: 0,
      historical: 0,
      other: 0,
    },
    rateLimited: 0,
    gateway502_504: 0,
    longWaitsOver5m: 0,
    acquired: [],
    checkpoints: [],
    batches: [],
  };
}

function saveState(state) {
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
}

function main() {
  if (!process.env.COURTLISTENER_API_KEY?.trim()) {
    console.log(JSON.stringify({ ok: false, reason: "COURTLISTENER_API_KEY missing" }));
    process.exit(2);
  }
  if (!process.env.DATABASE_URL?.trim()) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing" }));
    process.exit(2);
  }
  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.log(JSON.stringify({ ok: false, reason: "OPENAI_API_KEY missing" }));
    process.exit(2);
  }
  if (!fs.existsSync(QUEUE)) {
    console.log(JSON.stringify({ ok: false, reason: "demand queue missing; run demand-queue first" }));
    process.exit(2);
  }

  const queue = JSON.parse(fs.readFileSync(QUEUE, "utf8"));
  const targets = (queue.targets || []).filter((t) => t.status === "READY_CL");
  const startCensus = census();
  if (!startCensus.json?.ok) {
    console.log(JSON.stringify({ ok: false, reason: "start_identity_failed", detail: startCensus.json || startCensus.out.slice(0, 500) }));
    process.exit(3);
  }
  const startResolve = reresolve();
  const startLive = startCensus.json.live;

  const metrics = emptyMetrics();
  const state = {
    classification: "CORPUS_DAILY_V2_RUN",
    startedAt: new Date().toISOString(),
    safeDayBudget: SAFE_DAY_BUDGET,
    batchCl: BATCH_CL,
    batchAcquire: BATCH_ACQUIRE,
    clRateMs: CL_RATE_MS,
    startSnapshot: startLive,
    startResolvedAfterIntegrity: startResolve.json?.resolvedAfter ?? startLive.resolved,
    pointer: 0,
    stopReason: null,
    metrics,
    continue: true,
  };
  saveState(state);

  const seen = new Set();
  let consecutiveWeakBatches = 0;
  const checkpointMarks = [250, 500, 750, 1000];
  const checkpointHit = new Set();

  while (state.continue) {
    if (metrics.requestsUsed >= SAFE_DAY_BUDGET) {
      state.stopReason = "SAFE_DAILY_FLOOR";
      state.continue = false;
      break;
    }
    if (state.pointer >= targets.length) {
      state.stopReason = "TARGET_QUEUE_EXHAUSTED";
      state.continue = false;
      break;
    }

    const remainingBudget = SAFE_DAY_BUDGET - metrics.requestsUsed;
    const thisBatchCl = Math.min(BATCH_CL, remainingBudget);
    if (thisBatchCl < 10) {
      state.stopReason = "SAFE_DAILY_FLOOR";
      state.continue = false;
      break;
    }

    const batchTargets = [];
    while (batchTargets.length < BATCH_ACQUIRE && state.pointer < targets.length) {
      const t = targets[state.pointer++];
      const key = String(t.citation).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      batchTargets.push(t);
    }
    if (!batchTargets.length) {
      state.stopReason = "TARGET_QUEUE_EXHAUSTED";
      state.continue = false;
      break;
    }

    const citeArg = batchTargets.map((t) => t.citation).join("|");
    const beforeResolved = metrics.requestsUsed === 0
      ? (startResolve.json?.resolvedAfter ?? startLive.resolved)
      : (state.lastResolved ?? startLive.resolved);
    const beforeUnresolved = state.lastUnresolved ?? startLive.unresolved;
    const beforeExtracted = state.lastExtracted ?? startLive.extracted;
    const beforeCases = state.lastCases ?? startLive.cases;

    const ingest = runNode(
      "scripts/tmp-queue2-cite-demand-multi-ingest.cjs",
      [citeArg, String(thisBatchCl), String(BATCH_ACQUIRE)],
      Math.max(900, thisBatchCl * 20),
    );
    const ij = ingest.json || {};
    const clUsed = Number(ij.courtListenerHttpCalls || ij.apiCalls || 0);
    metrics.requestsUsed += clUsed;

    if (ij.rateLimited || /rate_limited/i.test(JSON.stringify(ij))) {
      metrics.rateLimited += 1;
      state.stopReason = "429";
      state.continue = false;
      state.retryAfter = ij.retryAfter || ij.lastRetryAfter || null;
    }

    const results = Array.isArray(ij.results) ? ij.results : [];
    const batchCases = [];
    for (const r of results) {
      const st = String(r.status || "").toLowerCase();
      if (st === "already_present" || st === "skipped" || st === "preverify_fail") continue;
      // multi-ingest persist statuses: imported | new_version
      if (st === "imported" || st === "new_version" || st === "inserted" || st === "acquired") {
        const reason = batchTargets.find((t) => t.citation === r.citation)?.reason || "demand_queue";
        const bucket = classifyCourtBucket(r);
        metrics.byCourt[bucket] = (metrics.byCourt[bucket] || 0) + 1;
        if (/u\.s\./i.test(r.citation) || /f\.(2d|3d|4th)/i.test(r.citation) || bucket === "scotus" || bucket === "federal_circuit" || bucket === "state_supreme") {
          metrics.controllingAdded += 1;
        }
        const bt = batchTargets.find((t) => t.citation === r.citation);
        if (bt?.benchmarkRelevant) metrics.benchmarkRelevantAdded += 1;
        if (bt?.historical) metrics.byCourt.historical += 1;
        const row = {
          citation: r.citation,
          title: r.title || null,
          court: r.court || null,
          authorityId: r.authorityId || null,
          clRequests: r.clRequests || 0,
          reason,
          bucket,
          status: r.status,
        };
        batchCases.push(row);
        metrics.acquired.push(row);
        metrics.casesAdded += 1;
      }
      if (/502|504|temporary_provider|gateway/i.test(String(r.reason || r.status || ""))) {
        metrics.gateway502_504 += 1;
      }
    }

    // Resolve + integrity after batch
    const resolve = reresolve();
    const afterCensus = census();
    const afterLive = afterCensus.json?.live || {};
    const afterResolved = resolve.json?.resolvedAfter ?? afterLive.resolved ?? beforeResolved;
    const oldResolves = Math.max(0, afterResolved - beforeResolved);
    // Unique targets: prefer resolve.newResolved if available, else case count of acquired that had demand
    const uniqueTargets = batchCases.length;
    const extractedAfter = afterLive.extracted ?? beforeExtracted;
    const unresolvedAfter = afterLive.unresolved ?? beforeUnresolved;
    const newEdges = Math.max(0, extractedAfter - beforeExtracted);
    const netUnresolved = unresolvedAfter - beforeUnresolved;

    metrics.oldResolves += oldResolves;
    metrics.uniqueTargetsEliminated += uniqueTargets;
    metrics.newEdges += newEdges;
    metrics.netUnresolvedChange = unresolvedAfter - startLive.unresolved;
    metrics.newUnresolved = Math.max(0, metrics.netUnresolvedChange + metrics.oldResolves);

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
        afterLive.duplicates === 0 &&
        afterLive.orphans === 0 &&
        afterLive.missingEmbeddings === 0 &&
        (afterLive.failed === 0 || afterLive.failed == null)
          ? "GREEN"
          : "RED",
    };

    const efficiency = {
      casesPerCl: clUsed ? +(batchCases.length / clUsed).toFixed(3) : null,
      oldResolvesPerCl: clUsed ? +(oldResolves / clUsed).toFixed(3) : null,
      uniqueTargetsPerCl: clUsed ? +(uniqueTargets / clUsed).toFixed(3) : null,
    };

    const batchRec = {
      at: new Date().toISOString(),
      attempted: batchTargets.map((t) => t.citation),
      clUsed,
      casesAdded: batchCases.length,
      oldResolves,
      uniqueTargets,
      newEdges,
      netUnresolvedBatch: unresolvedAfter - beforeUnresolved,
      efficiency,
      health,
      ingestOk: Boolean(ij.ok),
      rateLimited: Boolean(ij.rateLimited),
      acquired: batchCases,
    };
    metrics.batches.push(batchRec);

    // Checkpoint reporting
    for (const mark of checkpointMarks) {
      if (!checkpointHit.has(mark) && metrics.requestsUsed >= mark) {
        checkpointHit.add(mark);
        const decision =
          state.stopReason || health.status !== "GREEN"
            ? "NO"
            : efficiency.oldResolvesPerCl != null && efficiency.oldResolvesPerCl < 0.15 && batchCases.length === 0
              ? "NO"
              : "YES";
        metrics.checkpoints.push({
          mark,
          requests: metrics.requestsUsed,
          cases: metrics.casesAdded,
          oldResolves: metrics.oldResolves,
          uniqueTargets: metrics.uniqueTargetsEliminated,
          health: health.status,
          decision,
        });
      }
    }

    // Diminishing returns: weak if few cases and poor old-resolve yield for consecutive batches
    const weak =
      batchCases.length === 0 ||
      (clUsed >= 20 && oldResolves / clUsed < 0.2 && batchCases.length / clUsed < 0.15);
    if (weak) consecutiveWeakBatches += 1;
    else consecutiveWeakBatches = 0;
    if (consecutiveWeakBatches >= 3) {
      state.stopReason = "DIMINISHING_RETURNS";
      state.continue = false;
    }
    if (health.status !== "GREEN") {
      state.stopReason = "HEALTH_REGRESSION";
      state.continue = false;
    }
    if (state.stopReason === "429") {
      // already set
    }

    saveState(state);
    console.log(
      JSON.stringify({
        ok: true,
        event: "batch_complete",
        requestsUsed: metrics.requestsUsed,
        casesAdded: metrics.casesAdded,
        oldResolves: metrics.oldResolves,
        batch: batchRec,
        stopReason: state.stopReason,
      }),
    );

    if (!state.continue) break;
  }

  // Final resolve + census
  const finalResolve = reresolve();
  const finalCensus = census();
  const endLive = finalCensus.json?.live || {};

  state.finishedAt = new Date().toISOString();
  state.endSnapshot = endLive;
  state.finalResolve = {
    resolvedAfter: finalResolve.json?.resolvedAfter,
    newResolved: finalResolve.json?.newResolved,
    extracted: finalResolve.json?.extracted,
    targetAbsent: finalResolve.json?.targetAbsent,
  };
  if (!state.stopReason) state.stopReason = "TARGET_QUEUE_EXHAUSTED";

  const totalCl = metrics.requestsUsed || 1;
  const summary = {
    ok: true,
    classification: "DAILY_HIGH_VALUE_COURTLISTENER_STRENGTHENING",
    status:
      state.stopReason === "429" || state.stopReason === "HEALTH_REGRESSION" || state.stopReason === "PROVIDER_FAILURE"
        ? "CORPUS_DAILY_PASS_BLOCKED"
        : metrics.requestsUsed >= 800
          ? "CORPUS_DAILY_PASS_COMPLETE"
          : metrics.casesAdded > 0
            ? "CORPUS_DAILY_PASS_PARTIAL_QUOTA"
            : "CORPUS_DAILY_PASS_PARTIAL_QUOTA",
    stopReason: state.stopReason,
    courtListener: {
      limitMin: 25,
      limitHour: 300,
      limitDay: 1400,
      dayRemainingAtStart: 1285,
      safeRunBudget: SAFE_DAY_BUDGET,
      requestsActuallyUsed: metrics.requestsUsed,
      accountUsageTodayAfterRunLocal: 115 + metrics.requestsUsed,
      rateLimited429: metrics.rateLimited,
      gateway502_504: metrics.gateway502_504,
      longWaitsOver5m: metrics.longWaitsOver5m,
    },
    startSnapshot: startLive,
    acquisition: {
      casesAdded: metrics.casesAdded,
      byCourt: metrics.byCourt,
      controllingAdded: metrics.controllingAdded,
      benchmarkRelevantAdded: metrics.benchmarkRelevantAdded,
    },
    citationValue: {
      oldUnresolvedResolved: metrics.oldResolves,
      newEdges: metrics.newEdges,
      newUnresolved: metrics.newUnresolved,
      netUnresolvedChange: (endLive.unresolved ?? 0) - startLive.unresolved,
      uniqueMissingTargetsEliminated: metrics.uniqueTargetsEliminated,
    },
    efficiency: {
      casesPerCl: +(metrics.casesAdded / totalCl).toFixed(3),
      oldResolvesPerCl: +(metrics.oldResolves / totalCl).toFixed(3),
      uniqueTargetsPerCl: +(metrics.uniqueTargetsEliminated / totalCl).toFixed(3),
      controllingPerCl: +(metrics.controllingAdded / totalCl).toFixed(3),
      benchmarkPerCl: +(metrics.benchmarkRelevantAdded / totalCl).toFixed(3),
    },
    checkpoints: metrics.checkpoints,
    corpusHealth: {
      duplicates: endLive.duplicates,
      orphans: endLive.orphans,
      missingEmbeddings: endLive.missingEmbeddings,
      failed: endLive.failed,
      notProcessed: endLive.notProcessed,
      silentCurrent: endLive.silentCurrent,
      presentTargetDefects: endLive.presentTargetDefects,
      status:
        endLive.duplicates === 0 && endLive.orphans === 0 && endLive.missingEmbeddings === 0
          ? "GREEN"
          : "RED",
    },
    endSnapshot: endLive,
    highValueHandoff: metrics.acquired
      .filter((a) => /scotus|federal_circuit|state_supreme/i.test(a.bucket) || /LANE[1235]/i.test(a.reason))
      .slice(0, 25),
    batches: metrics.batches.length,
    stateArtifact: STATE,
  };

  fs.writeFileSync(FINAL, JSON.stringify(summary, null, 2));
  saveState(state);
  console.log(JSON.stringify(summary, null, 2));
}

main();
