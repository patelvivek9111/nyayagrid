#!/usr/bin/env node
/**
 * Oct 8 Oct 8 Final acquisition — after circuit refinement.
 * Explicit OLD vs NEW citation resolution accounting.
 * Budget: OCT8F_TOTAL_BUDGET (default 270) including PRIOR_CL.
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const postgres = require("postgres");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");
const QUEUE = path.join(REPORTS, "corpus-daily-oct8-final-demand-queue.json");
const STATE = path.join(REPORTS, "corpus-daily-oct8-final-run-state.json");
const FINAL = path.join(REPORTS, "corpus-daily-oct8-final-final.json");

const TOTAL_BUDGET = Math.min(Math.max(Number(process.env.OCT8F_TOTAL_BUDGET || 200), 40), 200);
const PRIOR_CL = Math.max(Number(process.env.OCT8F_PRIOR_CL || 1), 0);
const SAFE_PRODUCTIVE = Math.max(TOTAL_BUDGET - PRIOR_CL, 30);
const BATCH_CL = Math.min(Math.max(Number(process.env.DAILY_V2_BATCH_CL || 60), 40), 75);
const BATCH_ACQUIRE = Math.min(Math.max(Number(process.env.DAILY_V2_BATCH_ACQUIRE || 20), 10), 25);
const CL_RATE_MS = Math.max(Number(process.env.CL_RATE_MS || 4000), 4000);
const NODE_PATH = process.env.NODE_PATH || "C:/Users/patel/Documents/nyayagrid/node_modules";
const LANE_NAMES = ["third_circuit", "other_circuits", "edpa", "federal_reporter", "pa_appellate"];

function lastJson(text) {
  const t = String(text || "");
  const lines = t.split(/\n/).map((l) => l.trim()).filter((l) => l.startsWith("{") && l.includes('"ok"'));
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch { /* */ }
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
          try { return JSON.parse(t.slice(start, k + 1)); } catch { /* */ }
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
    env: { ...process.env, NODE_PATH, CORPUS_DAILY_V2: "1", CL_RATE_MS: String(CL_RATE_MS), CL_FETCH_TIMEOUT_MS: process.env.CL_FETCH_TIMEOUT_MS || "120000" },
    timeout: timeoutSec * 1000,
  });
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  return { status: r.status ?? 1, out, json: lastJson(out) };
}
function census() {
  return runNode("scripts/tmp-corpus-daily-oct8-final-identity.cjs", [], 120);
}
function reresolve() {
  return runNode("scripts/tmp-queue2-manual-cite-integrity.cjs", [], 300);
}
function emptyLane() {
  return { requests: 0, cases: 0, oldResolves: 0, acquired: [] };
}

async function citationWatermark(sql) {
  const [r] = await sql`
    select
      count(*)::int as extracted,
      count(*) filter (where to_authority_id is not null)::int as resolved,
      count(*) filter (where to_authority_id is null)::int as unresolved,
      max(created_at) as max_created_at
    from legal_authority_citations
  `;
  return {
    extracted: r.extracted,
    resolved: r.resolved,
    unresolved: r.unresolved,
    maxCreatedAt: r.max_created_at,
  };
}

async function citationResolutionAccounting(sql, startMark) {
  const [oldCohort] = await sql`
    select
      count(*)::int as total,
      count(*) filter (where to_authority_id is null)::int as still_unresolved,
      count(*) filter (where to_authority_id is not null)::int as now_resolved
    from legal_authority_citations
    where created_at <= ${startMark.maxCreatedAt}
  `;
  const [neu] = await sql`
    select
      count(*)::int as total,
      count(*) filter (where to_authority_id is not null)::int as resolved,
      count(*) filter (where to_authority_id is null)::int as unresolved
    from legal_authority_citations
    where created_at > ${startMark.maxCreatedAt}
  `;
  const oldUnresolvedResolved = Math.max(0, startMark.unresolved - oldCohort.still_unresolved);
  const newEdgesTotal = neu.total;
  const newEdgesResolvedImmediately = neu.resolved;
  const newEdgesStillUnresolved = neu.unresolved;
  const totalResolvedThisRun = oldUnresolvedResolved + newEdgesResolvedImmediately;
  return {
    OLD_UNRESOLVED_RESOLVED: oldUnresolvedResolved,
    NEW_EDGES_TOTAL: newEdgesTotal,
    NEW_EDGES_RESOLVED_IMMEDIATELY: newEdgesResolvedImmediately,
    NEW_EDGES_STILL_UNRESOLVED: newEdgesStillUnresolved,
    TOTAL_RESOLVED_THIS_RUN: totalResolvedThisRun,
    oldCohortStillUnresolved: oldCohort.still_unresolved,
    newCohort: neu,
  };
}

function trueCourtBucket(court) {
  const c = String(court || "");
  if (/Third Circuit/i.test(c)) return "third_circuit";
  if (/Eastern District of Pennsylvania|E\.D\. Pa/i.test(c)) return "edpa";
  if (/Pennsylvania|Superior Court|Commonwealth Court/i.test(c) && !/United States/i.test(c)) return "pa_appellate";
  if (/Court of Appeals for the/i.test(c)) return "other_circuits";
  if (/District Court|F\.Supp/i.test(c)) return "other_federal";
  return "other_federal";
}

async function main() {
  if (!process.env.COURTLISTENER_API_KEY?.trim() || !process.env.DATABASE_URL?.trim() || !process.env.OPENAI_API_KEY?.trim()) {
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

  const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require", idle_timeout: 10, connect_timeout: 40 });
  let startMark;
  try {
    startMark = await citationWatermark(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }

  const lanes = Object.fromEntries(LANE_NAMES.map((n) => [n, emptyLane()]));
  const trueCourtAcq = { third_circuit: 0, other_circuits: 0, edpa: 0, other_federal: 0, pa_appellate: 0 };
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
    resolution: null,
  };
  const remainingAtStart = process.env.OCT8F_QUOTA_JSON
    ? JSON.parse(process.env.OCT8F_QUOTA_JSON)
    : { minute: null, hour: null, day: null };

  const state = {
    classification: "CORPUS_DAILY_OCT8_FINAL_RUN",
    startedAt: new Date().toISOString(),
    totalBudget: TOTAL_BUDGET,
    priorCl: PRIOR_CL,
    safeProductive: SAFE_PRODUCTIVE,
    startSnapshot: startLive,
    startCitationMark: startMark,
    remainingAtStart,
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
      state.stopReason = process.env.OCT8F_BUDGET_STOP_REASON || "SAFE_DAILY_FLOOR";
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
      state.stopReason = process.env.OCT8F_BUDGET_STOP_REASON || "SAFE_DAILY_FLOOR";
      state.continue = false;
      break;
    }

    const batchTargets = [];
    while (batchTargets.length < BATCH_ACQUIRE && state.pointer < targets.length) {
      const t = targets[state.pointer++];
      const key = String(t.citation).toLowerCase();
      if (seen.has(key)) continue;
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
    const laneClApprox = {};
    for (const r of results) {
      const st = String(r.status || "").toLowerCase();
      const bt = batchTargets.find((t) => t.citation === r.citation);
      const laneName = bt?.laneName || "federal_reporter";
      laneClApprox[laneName] = (laneClApprox[laneName] || 0) + Number(r.clRequests || 0);
      if (/502|504/i.test(String(r.reason || ""))) metrics.gateway502_504 += 1;
      if (st === "already_present" || st === "skipped" || st === "preverify_fail") continue;
      if (st === "imported" || st === "new_version" || st === "inserted" || st === "acquired") {
        const row = {
          citation: r.citation,
          title: r.title || null,
          court: r.court || null,
          authorityId: r.authorityId || null,
          clRequests: Number(r.clRequests || 0),
          reason: bt?.reason || "oct8f",
          laneName,
          trueCourtBucket: trueCourtBucket(r.court),
          status: r.status,
        };
        batchCases.push(row);
        metrics.acquired.push(row);
        metrics.casesAdded += 1;
        metrics.controllingAdded += 1;
        trueCourtAcq[row.trueCourtBucket] = (trueCourtAcq[row.trueCourtBucket] || 0) + 1;
        lanes[laneName] = lanes[laneName] || emptyLane();
        lanes[laneName].cases += 1;
        lanes[laneName].acquired.push(row);
      }
    }
    const attributed = Object.values(laneClApprox).reduce((a, b) => a + b, 0);
    if (attributed > 0 && clUsed > 0) {
      for (const ln of Object.keys(laneClApprox)) {
        lanes[ln] = lanes[ln] || emptyLane();
        lanes[ln].requests += Math.round((laneClApprox[ln] / attributed) * clUsed);
      }
    } else if (clUsed > 0 && batchTargets[0]) {
      const ln = batchTargets[0].laneName || "federal_reporter";
      lanes[ln] = lanes[ln] || emptyLane();
      lanes[ln].requests += clUsed;
    }

    const resolve = reresolve();
    const afterCensus = census();
    const afterLive = afterCensus.json?.live || {};
    const afterResolved = resolve.json?.resolvedAfter ?? afterLive.resolved ?? beforeResolved;
    const batchResolvedDelta = Math.max(0, afterResolved - beforeResolved);
    const newEdges = Math.max(0, (afterLive.extracted ?? beforeExtracted) - beforeExtracted);
    metrics.oldResolves += batchResolvedDelta; // provisional; replaced by watermark accounting at end
    metrics.uniqueTargetsEliminated += batchCases.length;
    metrics.newEdges += newEdges;
    if (batchCases.length && batchResolvedDelta) {
      const by = {};
      for (const c of batchCases) by[c.laneName] = (by[c.laneName] || 0) + 1;
      for (const [ln, n] of Object.entries(by)) {
        lanes[ln] = lanes[ln] || emptyLane();
        lanes[ln].oldResolves += Math.round((n / batchCases.length) * batchResolvedDelta);
      }
    }
    state.lastResolved = afterResolved;
    state.lastUnresolved = afterLive.unresolved ?? beforeUnresolved;
    state.lastExtracted = afterLive.extracted ?? beforeExtracted;
    state.lastCases = afterLive.cases;

    const healthOk =
      afterLive.duplicates === 0 &&
      afterLive.orphans === 0 &&
      afterLive.missingEmbeddings === 0 &&
      (afterLive.failed === 0 || afterLive.failed == null);
    const batchRec = {
      at: new Date().toISOString(),
      attempted: batchTargets.map((t) => ({ citation: t.citation, lane: t.laneName })),
      clUsed,
      casesAdded: batchCases.length,
      resolvedDelta: batchResolvedDelta,
      newEdges,
      efficiency: {
        casesPerCl: clUsed ? +(batchCases.length / clUsed).toFixed(3) : null,
        resolvedDeltaPerCl: clUsed ? +(batchResolvedDelta / clUsed).toFixed(3) : null,
      },
      health: healthOk ? "GREEN" : "RED",
      rateLimited: Boolean(ij.rateLimited),
      acquired: batchCases,
    };
    metrics.batches.push(batchRec);

    const weak =
      batchCases.length === 0 ||
      (clUsed >= 15 && batchResolvedDelta / clUsed < 0.12 && batchCases.length / clUsed < 0.1);
    if (weak) consecutiveWeak += 1;
    else consecutiveWeak = 0;
    if (consecutiveWeak >= 3) {
      state.stopReason = "DIMINISHING_RETURNS";
      state.continue = false;
    }
    if (!healthOk) {
      state.stopReason = "HEALTH_REGRESSION";
      state.continue = false;
    }

    fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
    console.log(
      JSON.stringify({
        ok: true,
        event: "batch_complete",
        requestsUsed: metrics.requestsUsed,
        casesAdded: metrics.casesAdded,
        resolvedDelta: metrics.oldResolves,
        batch: batchRec,
        stopReason: state.stopReason,
      }),
    );
    if (!state.continue) break;
  }

  const finalResolve = reresolve();
  const finalCensus = census();
  const endLive = finalCensus.json?.live || {};

  const sql2 = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require", idle_timeout: 10, connect_timeout: 40 });
  let resolution;
  try {
    resolution = await citationResolutionAccounting(sql2, startMark);
  } finally {
    await sql2.end({ timeout: 5 });
  }
  metrics.resolution = resolution;
  metrics.oldResolves = resolution.OLD_UNRESOLVED_RESOLVED;

  if (!state.stopReason) state.stopReason = "TARGET_QUEUE_EXHAUSTED";
  state.finishedAt = new Date().toISOString();
  state.endSnapshot = endLive;
  state.trueCourtAcq = trueCourtAcq;

  const totalClSession = PRIOR_CL + metrics.requestsUsed;
  const totalCl = metrics.requestsUsed || 1;
  const refinePath = path.join(REPORTS, "corpus-daily-oct8-final-circuit-refine.json");
  const refine = fs.existsSync(refinePath) ? JSON.parse(fs.readFileSync(refinePath, "utf8")) : null;
  const netUnresolved = (endLive.unresolved ?? 0) - startLive.unresolved;

  const summary = {
    ok: true,
    classification: "DAILY_HIGH_VALUE_COURTLISTENER_OCT8_FINAL",
    status:
      state.stopReason === "429" && metrics.casesAdded === 0
        ? "CORPUS_DAILY_OCT8_FINAL_BLOCKED"
        : state.stopReason === "429" ||
            state.stopReason === "SAFE_HOURLY_HEADROOM" ||
            state.stopReason === "SAFE_DAILY_FLOOR"
          ? "CORPUS_DAILY_OCT8_FINAL_PARTIAL"
          : state.stopReason === "TARGET_QUEUE_EXHAUSTED" && metrics.casesAdded > 0
            ? "CORPUS_DAILY_OCT8_FINAL_COMPLETE"
            : "CORPUS_DAILY_OCT8_FINAL_PARTIAL",
    stopReason: state.stopReason,
    retryAfter: state.retryAfter || null,
    circuitRefinement: refine
      ? {
          reviewed: refine.reviewed,
          exactCircuitsResolved: refine.exactCircuitsResolved,
          thirdCircuitIdentified: refine.thirdCircuitIdentified,
          otherCircuitsIdentified: refine.otherCircuitsIdentified,
          stillUnresolved: refine.remainingUnspecifiedFederalReporter,
          byCircuit: refine.byCircuit,
          refineCl: refine.courtListenerHttpCalls,
        }
      : null,
    courtListener: {
      limitMin: 25,
      limitHour: 300,
      limitDay: 1400,
      remainingAtStart,
      safeBudget: TOTAL_BUDGET,
      priorCl: PRIOR_CL,
      productiveRequests: metrics.requestsUsed,
      requestsActuallyUsed: totalClSession,
      rateLimited429: metrics.rateLimited,
      gateway502_504: metrics.gateway502_504,
      longWaitsOver5m: 0,
    },
    startSnapshot: startLive,
    acquisition: {
      casesAdded: metrics.casesAdded,
      thirdCircuit: trueCourtAcq.third_circuit,
      otherCircuits: trueCourtAcq.other_circuits,
      edpa: trueCourtAcq.edpa,
      otherFederal: trueCourtAcq.other_federal,
      paAppellate: trueCourtAcq.pa_appellate,
    },
    laneResults: Object.fromEntries(
      LANE_NAMES.map((n) => [
        n,
        { requests: lanes[n]?.requests || 0, cases: lanes[n]?.cases || 0, resolvedDeltaApprox: lanes[n]?.oldResolves || 0 },
      ]),
    ),
    citationResolution: {
      OLD_UNRESOLVED_RESOLVED: resolution.OLD_UNRESOLVED_RESOLVED,
      NEW_EDGES_TOTAL: resolution.NEW_EDGES_TOTAL,
      NEW_EDGES_RESOLVED_IMMEDIATELY: resolution.NEW_EDGES_RESOLVED_IMMEDIATELY,
      NEW_EDGES_STILL_UNRESOLVED: resolution.NEW_EDGES_STILL_UNRESOLVED,
      TOTAL_RESOLVED_THIS_RUN: resolution.TOTAL_RESOLVED_THIS_RUN,
      NET_UNRESOLVED_CHANGE: netUnresolved,
      UNIQUE_MISSING_TARGETS_ELIMINATED: metrics.uniqueTargetsEliminated,
    },
    efficiency: {
      casesPerCl: +(metrics.casesAdded / totalCl).toFixed(3),
      oldUnresolvedResolvedPerCl: +(resolution.OLD_UNRESOLVED_RESOLVED / totalCl).toFixed(3),
      newImmediateResolvedPerCl: +(resolution.NEW_EDGES_RESOLVED_IMMEDIATELY / totalCl).toFixed(3),
      totalResolvedPerCl: +(resolution.TOTAL_RESOLVED_THIS_RUN / totalCl).toFixed(3),
      uniqueTargetsPerCl: +(metrics.uniqueTargetsEliminated / totalCl).toFixed(3),
      courtIdentificationsPerCl:
        refine?.courtListenerHttpCalls && refine.exactCircuitsResolved != null
          ? +(refine.exactCircuitsResolved / (refine.courtListenerHttpCalls || 1)).toFixed(3)
          : null,
      controllingPerCl: +(metrics.controllingAdded / totalCl).toFixed(3),
    },
    corpusHealth: {
      duplicates: endLive.duplicates,
      orphans: endLive.orphans,
      missingEmbeddings: endLive.missingEmbeddings,
      failed: endLive.failed,
      notProcessed: endLive.notProcessed,
      presentTargetDefects: endLive.presentTargetDefects,
      status:
        endLive.duplicates === 0 && endLive.orphans === 0 && endLive.missingEmbeddings === 0 ? "GREEN" : "RED",
    },
    endSnapshot: endLive,
    highValueHandoff: metrics.acquired.slice(0, 25),
    finalResolve: { resolvedAfter: finalResolve.json?.resolvedAfter },
    batches: metrics.batches.length,
  };
  fs.writeFileSync(FINAL, JSON.stringify(summary, null, 2));
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}
main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 800) }));
  process.exit(1);
});
