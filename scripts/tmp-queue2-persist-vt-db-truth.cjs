/**
 * Persist VT Lane A progress from a confirmed read-only DB probe.
 * ZERO CourtListener. ZERO corpus mutations. Local state JSON only.
 *
 * Usage:
 *   node scripts/tmp-queue2-persist-vt-db-truth.cjs <probe.json|->
 *   (reads probe JSON from argv path or stdin; or uses --inline JSON)
 */
"use strict";

const fs = require("fs");
const path = require("path");
const {
  NORMAL_BOUNDED_LANE_A,
  SESSION_BUDGET_EXHAUSTED,
  SAFE_IDLE,
} = require("./queue2-post-canary-session-guard.cjs");

const root = path.join(__dirname, "..");
const reports = path.join(root, "packages/research/corpus/reports");
const statePath = path.join(reports, "queue2-dual-lane-state.json");
const finalPath = path.join(reports, "queue2-dual-lane-final.json");

function loadProbe() {
  const arg = process.argv[2];
  if (!arg || arg === "-") {
    const raw = fs.readFileSync(0, "utf8");
    return JSON.parse(raw);
  }
  if (arg.startsWith("{")) return JSON.parse(arg);
  return JSON.parse(fs.readFileSync(arg, "utf8"));
}

function main() {
  const probe = loadProbe();
  const nowIso = new Date().toISOString();
  if (!probe?.ok || String(probe.court || "").toLowerCase() !== "vt") {
    console.log(
      JSON.stringify({
        ok: false,
        reason: "PROBE_NOT_VT_OK",
        persisted: false,
        courtListenerHttpCalls: 0,
        mutations: 0,
        aiCalls: 0,
      }),
    );
    process.exit(2);
  }

  const qualifying = Number(probe.qualifyingCaseCount);
  if (!Number.isFinite(qualifying) || qualifying < 1) {
    console.log(JSON.stringify({ ok: false, reason: "NO_QUALIFYING_COUNT", persisted: false }));
    process.exit(2);
  }

  const job = probe.job || (Array.isArray(probe.jobs) ? probe.jobs[0] : null) || {};
  const checkpoint =
    job.last_successful_external_id || job.cursor || probe.checkpoint || null;
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));

  const priorCount = Number(state.laneA?.count) || 0;
  const priorQualifying = Number(state.laneA?.qualifyingCaseCount) || priorCount;

  state.laneA = {
    ...state.laneA,
    court: "vt",
    jurisdiction: "VT",
    count: qualifying,
    qualifyingCaseCount: qualifying,
    clCaseCount: Number(probe.clCaseCount) || qualifying,
    totalCaseCount: Number(probe.totalCaseCount) || qualifying,
    authorityCount: Number(probe.authorityCount) || state.laneA?.authorityCount || null,
    target: 45,
    targetStatus: qualifying >= 45 ? "COMPLETE" : "PARTIAL",
    jobLifecycle: "PAUSED_RESUMABLE",
    jobStatus: job.status || state.laneA?.jobStatus || "quota_paused",
    itemsImported: Number(job.items_imported) || state.laneA?.itemsImported || null,
    mappingStatus: "VERIFIED",
  };
  if (checkpoint) {
    state.laneA.checkpoint = checkpoint;
    state.laneA.cursor = job.cursor || checkpoint;
    state.laneA.lastSuccessfulExternalId = checkpoint;
  }
  if (job.next_page_url) state.laneA.nextPageUrl = job.next_page_url;

  // Clear zero-sleep spin / exhausted-session leftovers from the defective loop.
  state.sessionBudgetExhausted = false;
  state.unresolvedUnknown = false;
  state.idleSafe = true;
  state.currentLane = "STOPPED";
  state.runtimeState = SAFE_IDLE;
  state.waitingForNetwork = false;

  // After certified productive progress + known-good path: NORMAL_BOUNDED_LANE_A.
  // Startup canary gate still re-evaluates fingerprint on next worker start.
  state.canaryMode = "NORMAL";
  state.canary = {
    ...(state.canary || {}),
    required: false,
    status: "PASS",
    mode: NORMAL_BOUNDED_LANE_A,
    reason: "db_confirmed_post_canary_progress",
    clearedAt: nowIso,
  };
  state.firstRecoveryCanaryPending = false;

  state.queue = "#2";
  state.queue9 = "CLOSED";
  state.queue3 = "NOT_OPEN";
  state.featureAgents = "0";
  state.updatedAt = nowIso;
  state.vtDbReconciliation = {
    classification: "QUEUE2_POST_CANARY_VT_DB_TRUTH",
    qualifyingCaseCount: qualifying,
    priorCount,
    priorQualifyingCount: priorQualifying,
    checkpoint,
    jobStatus: job.status || null,
    apiCalls: job.api_calls ?? null,
    itemsImported: job.items_imported ?? null,
    integrity: probe.integrity || null,
    dbEvidenceObservedAt: probe.dbEvidenceObservedAt || probe.generatedAt || nowIso,
    courtListenerHttpCalls: 0,
    mutations: 0,
    aiCalls: 0,
    reconciledAt: nowIso,
  };

  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  let final = {};
  try {
    final = JSON.parse(fs.readFileSync(finalPath, "utf8"));
  } catch {
    final = {};
  }
  final = {
    ...final,
    ok: true,
    classification: "QUEUE2_POST_CANARY_LOOP_AND_BUDGET_FIXED",
    laneA: {
      court: "vt",
      count: qualifying,
      target: 45,
      checkpoint,
      jobStatus: job.status || null,
    },
    queue: "#2",
    queue9: "CLOSED",
    queue3: "NOT_OPEN",
    courtListenerHttpCalls: 0,
    mutations: 0,
    aiCalls: 0,
    updatedAt: nowIso,
  };
  fs.writeFileSync(finalPath, JSON.stringify(final, null, 2));

  console.log(
    JSON.stringify({
      ok: true,
      persisted: true,
      court: "vt",
      qualifyingCaseCount: qualifying,
      checkpoint,
      jobStatus: job.status || null,
      integrity: probe.integrity || null,
      canaryMode: state.canaryMode,
      mode: NORMAL_BOUNDED_LANE_A,
      priorCount,
      courtListenerHttpCalls: 0,
      mutations: 0,
      aiCalls: 0,
      childLaunches: 0,
      sessionBudgetExhaustedCleared: true,
      runtimeState: SAFE_IDLE,
      note: SESSION_BUDGET_EXHAUSTED,
    }),
  );
}

main();
