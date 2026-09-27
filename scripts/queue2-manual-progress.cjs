/**
 * Reconcile Queue #2 Lane A with manual corpus progress.
 *
 * Completion comes from the canonical depth manifest. Checkpoints are copied
 * only when the manifest or existing evidence already has them.
 *
 * Next-target order matches the verified manual depth rule: largest
 * authority deficit, then fewer high-court cases, then manifest score.
 * That rule selects Vermont after the current completed set.
 */
"use strict";

const { CANARY_MAX_SESSION_CL_REQUESTS } = require("./queue2-lane-a-child-lifecycle.cjs");
const { selectLaneBTask } = require("./queue2-autonomy-policy.cjs");
const {
  DATABASE_QUOTA_BLOCKED,
  evaluateDbWriteReadiness,
  applyDatabaseQuotaBlock,
  recoverDatabaseQuotaBlock,
  assertCourtListenerAllowed,
  quotaUsableForExecution,
} = require("./queue2-db-readiness.cjs");

function courtOf(target) {
  return (target?.preferredCourts || [])[0] || null;
}

function isManifestComplete(target) {
  if (!target || target.federal) return false;
  if (target.status === "COMPLETE_FOR_CURRENT_DEPTH") return true;
  const count = Number(target.currentCases);
  const goal = Number(target.targetCases || 45);
  return (
    target.mappingStatus === "VERIFIED" &&
    target.autonomousIngestBlocked === true &&
    Number.isFinite(count) &&
    count >= goal
  );
}

function isValidCompletionEvidence(evidence, targetCases = 45) {
  if (!evidence || evidence.status !== "COMPLETE_FOR_CURRENT_DEPTH") return false;
  const count = Number(evidence.count ?? evidence.cases);
  const target = Number(evidence.target ?? targetCases);
  if (!Number.isFinite(count) || !Number.isFinite(target) || count < target) return false;
  return true;
}

function evidenceFromCanonicalTarget(target, nowIso) {
  const checkpoint =
    typeof target.checkpoint === "string" && target.checkpoint.length > 0 ? target.checkpoint : null;
  return {
    status: "COMPLETE_FOR_CURRENT_DEPTH",
    count: Number(target.currentCases) || 0,
    cases: Number(target.currentCases) || 0,
    clCases: target.clCases != null ? Number(target.clCases) : null,
    target: Number(target.targetCases) || 45,
    checkpoint,
    source: "canonical_manifest",
    mappingStatus: target.mappingStatus || null,
    reconciledAt: nowIso,
    manualProgressSupported: true,
  };
}

/**
 * Highest remaining verified production-depth deficit.
 * Skips COMPLETE_FOR_CURRENT_DEPTH regardless of who completed the court.
 */
function selectNextProductionDepthTarget(manifest, opts = {}) {
  const exclude = new Set(opts.excludeCourts || []);
  if (opts.excludeCourt) exclude.add(opts.excludeCourt);
  const rows = (manifest?.targets || [])
    .filter((t) => !t.federal)
    .filter((t) => t.mappingStatus === "VERIFIED")
    .filter((t) => !t.autonomousIngestBlocked)
    .filter((t) => t.status === "READY" || t.status === "PARTIAL")
    .filter((t) => t.status !== "COMPLETE_FOR_CURRENT_DEPTH")
    .filter((t) => Number(t.currentCases || 0) < Number(t.targetCases || 45))
    .filter((t) => {
      const court = courtOf(t);
      return court && !exclude.has(court);
    });
  rows.sort(
    (a, b) =>
      (Number(b.authorityDeficit) || 0) - (Number(a.authorityDeficit) || 0) ||
      (Number(a.highCourtCount) || 0) - (Number(b.highCourtCount) || 0) ||
      (Number(b.score) || 0) - (Number(a.score) || 0) ||
      String(a.jurisdiction || "").localeCompare(String(b.jurisdiction || "")),
  );
  const top = rows[0] || null;
  if (!top) return null;
  const checkpoint =
    typeof top.checkpoint === "string" && top.checkpoint.length > 0 ? top.checkpoint : null;
  return {
    court: courtOf(top),
    jurisdiction: top.jurisdiction,
    count: Number(top.currentCases) || 0,
    target: Number(top.targetCases) || 45,
    checkpoint,
    status: top.status,
    score: top.score,
    authorityDeficit: Number(top.authorityDeficit) || 0,
    mappingStatus: top.mappingStatus,
  };
}

function reconcileManualDepthProgress(state, manifest, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now());
  const nowIso = now.toISOString();
  const next = JSON.parse(JSON.stringify(state || {}));
  next.completedCourts = Array.isArray(next.completedCourts) ? [...next.completedCourts] : [];
  next.completedCourtEvidence = { ...(next.completedCourtEvidence || {}) };
  next.queue = "#2";
  next.queue9 = "CLOSED";
  next.queue3 = "NOT_OPEN";
  next.featureAgents = "0";
  const inventedCheckpoints = [];
  const reconciled = [];

  for (const target of manifest?.targets || []) {
    if (!isManifestComplete(target)) continue;
    const court = courtOf(target);
    if (!court) continue;
    if (!next.completedCourts.includes(court)) next.completedCourts.push(court);
    const existing = next.completedCourtEvidence[court];
    if (isValidCompletionEvidence(existing, target.targetCases)) {
      reconciled.push({ court, source: existing.source || "existing_evidence" });
      continue;
    }
    const built = evidenceFromCanonicalTarget(target, nowIso);
    if (built.checkpoint && built.checkpoint !== target.checkpoint) inventedCheckpoints.push(court);
    next.completedCourtEvidence[court] = built;
    reconciled.push({ court, source: "canonical_manifest" });
  }

  const active = next.laneA?.court || null;
  const activeComplete =
    (active && next.completedCourts.includes(active)) ||
    next.laneA?.targetStatus === "COMPLETE_FOR_CURRENT_DEPTH";
  const ownedChild = next.laneAChild && next.laneAChild.terminal !== true && next.laneAChild.pid != null;
  let advanced = false;
  if (activeComplete && !ownedChild) {
    const nxt = selectNextProductionDepthTarget(manifest, { excludeCourts: next.completedCourts });
    if (nxt?.court && nxt.court !== active) {
      const priorCheckpoint = next.laneA?.checkpoint ?? null;
      next.laneA = {
        court: nxt.court,
        jurisdiction: nxt.jurisdiction,
        count: nxt.count,
        target: nxt.target,
        checkpoint: nxt.checkpoint,
        cursor: null,
        lastSuccessfulExternalId: null,
        nextPageUrl: null,
        lastSuccessfulAt: null,
        runner: next.laneA?.runner || "staging-cl-batch-job",
        mappingStatus: nxt.mappingStatus || "VERIFIED",
        manifestVersion: manifest?.version || next.laneA?.manifestVersion || null,
        jobStatus: "ready",
        itemsImported: nxt.count,
        targetStatus: nxt.status || "READY",
        sequence: null,
        lock: null,
        priorCompletedCourt: active,
        priorCompletedCheckpoint: priorCheckpoint,
      };
      advanced = true;
    }
  }

  return {
    state: next,
    inventedCheckpoints,
    reconciled,
    advanced,
    nextCourt: next.laneA?.court || null,
  };
}

function planManualProgressStartup(params = {}) {
  const now = params.now instanceof Date ? params.now : new Date(params.now || Date.now());
  const reconciled = reconcileManualDepthProgress(params.state, params.manifest, { now });
  let state = reconciled.state;
  const checkpointAfterReconcile = state.laneA ? state.laneA.checkpoint ?? null : null;
  const db = evaluateDbWriteReadiness(params.dbProbe);
  let recovered = false;

  if (state.databaseBlock?.classification === DATABASE_QUOTA_BLOCKED && db.dbWriteReady === true) {
    const rec = recoverDatabaseQuotaBlock(state, now);
    state = rec.state;
    recovered = rec.recovered;
    const refreshed = reconcileManualDepthProgress(state, params.manifest, { now });
    state = refreshed.state;
  }

  if (db.dbWriteReady !== true) {
    const clGate = assertCourtListenerAllowed({ dbWriteReady: false });
    if (clGate.ok) {
      throw new Error("INVARIANT_CL_WHILE_DB_NOT_WRITABLE");
    }
    if (db.classification === DATABASE_QUOTA_BLOCKED) {
      state = applyDatabaseQuotaBlock(state, now);
    } else {
      state.dbWriteReady = false;
      state.currentLane = "B";
      state.queue = "#2";
      state.queue3 = "NOT_OPEN";
    }
    if (state.laneA) state.laneA.checkpoint = checkpointAfterReconcile;
    const laneB = selectLaneBTask({
      ...(params.laneB || {}),
      registry: params.registry,
      now,
      dbWriteReady: false,
      executing: params.executing === true,
    });
    const ranZeroDb =
      Boolean(laneB.task) && laneB.task.dbDependency === "NO_DB_REQUIRED" && laneB.executing === true;
    if (!ranZeroDb) {
      state.idleSafe = true;
      state.currentLane = "B";
      state.laneB = { ...(state.laneB || {}), task: "NONE" };
      if (db.classification === DATABASE_QUOTA_BLOCKED) {
        state.healthyIdle = { status: "HEALTHY_IDLE_SAFE", reason: DATABASE_QUOTA_BLOCKED };
        state.runtimeState = "IDLE_SAFE";
      }
    } else {
      state.idleSafe = false;
      state.healthyIdle = null;
      state.currentLane = "B";
      state.laneB = { ...(state.laneB || {}), task: laneB.currentTask };
    }
    if (!state.humanReview || db.classification === DATABASE_QUOTA_BLOCKED) {
      const priorReasons = (state.humanReview?.reasons || []).filter((r) => r !== DATABASE_QUOTA_BLOCKED);
      state.humanReview = {
        required: priorReasons.length > 0,
        reasons: priorReasons,
        details: state.humanReview?.details || [],
      };
    }
    if (db.classification === "UNKNOWN_DB_FAILURE") {
      const reasons = [...new Set([...(state.humanReview?.reasons || []), "UNKNOWN_DB_FAILURE"])];
      state.humanReview = {
        required: true,
        reasons,
        details: state.humanReview?.details || [],
      };
      state.healthyIdle = null;
      state.idleSafe = false;
    }
    state.metrics = { ...(state.metrics || {}), aiCalls: 0, aiTokens: 0 };
    return {
      state,
      db,
      recovered: false,
      allowCourtListener: false,
      clRequests: 0,
      childLaunches: 0,
      mutations: 0,
      aiCalls: 0,
      checkpointUnchanged: (state.laneA ? state.laneA.checkpoint ?? null : null) === checkpointAfterReconcile,
      inventedCheckpoints: reconciled.inventedCheckpoints,
      nextCourt: state.laneA?.court || null,
      laneB,
      queue2: state.queue,
      queue3: state.queue3,
      canaryMaxClRequests: CANARY_MAX_SESSION_CL_REQUESTS,
    };
  }

  state.dbWriteReady = true;
  state.queue = "#2";
  state.queue3 = "NOT_OPEN";
  state.featureAgents = "0";
  state.metrics = { ...(state.metrics || {}), aiCalls: 0, aiTokens: 0 };
  if (!recovered) {
    // Healthy DB with no quota block keeps the caller's quota object.
    // A recovered block has already marked counters UNKNOWN_FOR_EXECUTION.
  }
  return {
    state,
    db,
    recovered,
    allowCourtListener: true,
    clRequests: 0,
    childLaunches: 0,
    mutations: 0,
    aiCalls: 0,
    checkpointUnchanged: true,
    inventedCheckpoints: reconciled.inventedCheckpoints,
    nextCourt: state.laneA?.court || null,
    quotaUsableForExecution: quotaUsableForExecution(state.quota),
    canaryMaxClRequests: CANARY_MAX_SESSION_CL_REQUESTS,
    queue2: state.queue,
    queue3: state.queue3,
  };
}

module.exports = {
  isManifestComplete,
  isValidCompletionEvidence,
  evidenceFromCanonicalTarget,
  selectNextProductionDepthTarget,
  reconcileManualDepthProgress,
  planManualProgressStartup,
};
