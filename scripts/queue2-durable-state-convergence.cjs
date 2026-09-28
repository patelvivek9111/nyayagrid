/**
 * Queue #2 durable control-plane state convergence.
 *
 * Local / deterministic. Zero CourtListener HTTP. Zero corpus mutations. Zero AI.
 * Persists the same canonical target the worker would execute after startup
 * reconciliation, without starting the worker loop.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  reconcileManualDepthProgress,
  selectNextProductionDepthTarget,
  isValidCompletionEvidence,
} = require("./queue2-manual-progress.cjs");
const {
  DATABASE_QUOTA_BLOCKED,
  markQuotaUnknownForExecution,
  quotaUsableForExecution,
} = require("./queue2-db-readiness.cjs");
const {
  buildOperatorStatus,
  isReadyFirstStartLaneA,
} = require("./queue2-worker-observability.cjs");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");
const STATE_PATH = path.join(REPORTS, "queue2-dual-lane-state.json");
const MANIFEST_PATH = path.join(REPORTS, "queue2-lane-a-depth-manifest.json");
const STATUS_PATH = path.join(REPORTS, "corpus-worker-status.json");
const NEON_HOLD_PATH = path.join(REPORTS, "queue2-manual-neon-quota-hold-2026-09-27.json");

/** Known from committed manual-expansion evidence (not invented). */
const MANUAL_COMPLETION_COURTS = new Set([
  "mich",
  "nm",
  "utah",
  "sd",
  "idaho",
  "wyo",
  "neb",
  "sc",
  "vt",
  "nh",
  "okla",
  "nd",
  "ala",
  "ky",
  "alaska",
  "ariz",
  "colo",
  "conn",
  "ga",
  "haw",
  "ind",
  "kan",
  "md",
  "ohio",
  "nc",
  "or",
  "ri",
  "wash",
  "wva",
  "mo",
  "nj",
  "va",
  "del",
  "minn",
]);
const AUTONOMOUS_COMPLETION_COURTS = new Set(["wis"]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function atomicWriteJson(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
  return filePath;
}

function evidenceSourceForCourt(court, existing) {
  // Prefer explicit operator-recorded sources, then known completion class, then reconciliation.
  if (existing?.source === "manual" || existing?.source === "autonomous") return existing.source;
  if (MANUAL_COMPLETION_COURTS.has(court)) return "manual";
  if (AUTONOMOUS_COMPLETION_COURTS.has(court)) return "autonomous";
  if (existing?.source === "canonical_manifest_reconciliation") return existing.source;
  if (existing?.source === "canonical_manifest") return "canonical_manifest_reconciliation";
  return "canonical_manifest_reconciliation";
}

function normalizeCompletionEvidence(court, target, prior, nowIso) {
  const checkpoint =
    (typeof prior?.checkpoint === "string" && prior.checkpoint) ||
    (typeof target?.checkpoint === "string" && target.checkpoint) ||
    null;
  const cursor =
    (typeof prior?.cursor === "string" && prior.cursor) ||
    null;
  const lastSuccessfulExternalId =
    (typeof prior?.lastSuccessfulExternalId === "string" && prior.lastSuccessfulExternalId) ||
    (typeof prior?.jobLastSuccessfulExternalId === "string" && prior.jobLastSuccessfulExternalId) ||
    checkpoint;
  const qualifyingCaseCount = Number(
    prior?.qualifyingCaseCount ??
      prior?.count ??
      target?.currentCases ??
      target?.qualifyingCaseCount ??
      0,
  );
  return {
    jurisdiction: prior?.jurisdiction || target?.jurisdiction || null,
    court,
    status: "COMPLETE_FOR_CURRENT_DEPTH",
    qualifyingCaseCount,
    count: qualifyingCaseCount,
    cases: prior?.cases != null ? Number(prior.cases) : Number(target?.currentCases) || qualifyingCaseCount,
    clCases: prior?.clCases != null ? Number(prior.clCases) : target?.clCases != null ? Number(target.clCases) : null,
    target: Number(prior?.target ?? target?.targetCases ?? 45) || 45,
    checkpoint,
    cursor,
    lastSuccessfulExternalId,
    nextPageUrl: prior?.nextPageUrl ?? null,
    lastSuccessfulAt: prior?.lastSuccessfulAt || null,
    jobStatus: prior?.jobStatus || "completed",
    mappingStatus: prior?.mappingStatus || target?.mappingStatus || "VERIFIED",
    reconciledAt: prior?.reconciledAt || nowIso,
    completedAt: prior?.completedAt || prior?.lastSuccessfulAt || nowIso,
    source: evidenceSourceForCourt(court, prior),
    evidenceSource: "canonical_manifest_and_durable_state",
  };
}

/**
 * Seal a completed prior laneA into evidence before advancing the active target.
 */
function sealPriorLaneAEvidence(laneA, existing, nowIso) {
  if (!laneA?.court) return existing || null;
  const base = existing && isValidCompletionEvidence(existing, laneA.target) ? existing : {};
  return normalizeCompletionEvidence(
    laneA.court,
    {
      jurisdiction: laneA.jurisdiction,
      currentCases: laneA.qualifyingCaseCount ?? laneA.count,
      clCases: laneA.clCaseCount,
      targetCases: laneA.target,
      checkpoint: laneA.checkpoint,
      mappingStatus: laneA.mappingStatus,
    },
    {
      ...base,
      jurisdiction: laneA.jurisdiction,
      qualifyingCaseCount: laneA.qualifyingCaseCount ?? laneA.count,
      count: laneA.count,
      checkpoint: laneA.checkpoint,
      cursor: laneA.cursor,
      lastSuccessfulExternalId: laneA.lastSuccessfulExternalId,
      nextPageUrl: laneA.nextPageUrl,
      lastSuccessfulAt: laneA.lastSuccessfulAt,
      jobStatus: laneA.jobStatus || "completed",
      mappingStatus: laneA.mappingStatus,
      source: evidenceSourceForCourt(laneA.court, existing),
    },
    nowIso,
  );
}

function applyKnownDatabaseQuotaBlock(state, opts = {}) {
  const next = JSON.parse(JSON.stringify(state || {}));
  const hold = opts.neonHold || null;
  const nowIso = (opts.now || new Date()).toISOString();
  if (opts.clearDbBlock === true) {
    return next;
  }
  const blocked =
    opts.forceDatabaseQuotaBlocked === true ||
    next.databaseBlock?.classification === DATABASE_QUOTA_BLOCKED ||
    hold?.blocker?.code === "53000" ||
    hold?.reason === "STAGING_NEON_QUOTA_EXCEEDED";
  if (!blocked) return next;
  next.databaseBlock = {
    classification: DATABASE_QUOTA_BLOCKED,
    sqlState: hold?.blocker?.code || next.databaseBlock?.sqlState || "53000",
    provider: hold?.blocker?.provider || "neon",
    since: next.databaseBlock?.since || hold?.generatedAt || nowIso,
    recovered: false,
    external: true,
    source: hold ? "known_neon_hold_artifact" : "state",
  };
  next.dbWriteReady = false;
  next.laneAStatus = "BLOCKED";
  next.quota = markQuotaUnknownForExecution(next.quota || {});
  next.quota.staleReason = "DB_BLOCKED_BEFORE_CL_PROBE";
  next.quota.freshness = "STALE";
  next.quota.executionAuthority = "STALE";
  next.quota.usableForExecution = false;
  return next;
}

/**
 * Pure convergence: reconcile completed evidence + advance to next target.
 */
function convergeDurableQueue2State(params = {}) {
  const now = params.now instanceof Date ? params.now : new Date(params.now || Date.now());
  const nowIso = now.toISOString();
  const manifest = params.manifest;
  if (!manifest || !Array.isArray(manifest.targets)) {
    return { ok: false, reason: "MANIFEST_MISSING", inventedCheckpoints: [], clRequests: 0, mutations: 0, aiCalls: 0 };
  }

  let state = JSON.parse(JSON.stringify(params.state || {}));
  const priorLaneA = state.laneA ? { ...state.laneA } : null;

  // Seal complete prior laneA into evidence before advancing.
  if (
    priorLaneA?.court &&
    (priorLaneA.targetStatus === "COMPLETE_FOR_CURRENT_DEPTH" ||
      String(priorLaneA.jobStatus || "").toLowerCase() === "completed" ||
      (Array.isArray(state.completedCourts) && state.completedCourts.includes(priorLaneA.court)))
  ) {
    state.completedCourtEvidence = state.completedCourtEvidence || {};
    state.completedCourtEvidence[priorLaneA.court] = sealPriorLaneAEvidence(
      priorLaneA,
      state.completedCourtEvidence[priorLaneA.court],
      nowIso,
    );
    if (!Array.isArray(state.completedCourts)) state.completedCourts = [];
    if (!state.completedCourts.includes(priorLaneA.court)) state.completedCourts.push(priorLaneA.court);
  }

  const reconciled = reconcileManualDepthProgress(state, manifest, { now });
  if (reconciled.inventedCheckpoints?.length) {
    return {
      ok: false,
      reason: "INVENTED_CHECKPOINT_REFUSED",
      inventedCheckpoints: reconciled.inventedCheckpoints,
      clRequests: 0,
      mutations: 0,
      aiCalls: 0,
    };
  }
  state = reconciled.state;

  // Preserve the Queue #2 depth-wave completedCourts list. Manifest reconciliation
  // may see many historically COMPLETE courts; those must not inflate the operator
  // completedCourts sequence. Only prior completed courts + the sealed prior laneA
  // (manual/autonomous completion of the then-current target) are tracked.
  const priorCompleted = Array.isArray(params.state?.completedCourts)
    ? [...params.state.completedCourts]
    : [];
  const trackedCompleted = [];
  for (const court of priorCompleted) {
    if (!trackedCompleted.includes(court)) trackedCompleted.push(court);
  }
  if (priorLaneA?.court && !trackedCompleted.includes(priorLaneA.court)) {
    const sealed =
      priorLaneA.targetStatus === "COMPLETE_FOR_CURRENT_DEPTH" ||
      String(priorLaneA.jobStatus || "").toLowerCase() === "completed" ||
      (Array.isArray(state.completedCourts) && state.completedCourts.includes(priorLaneA.court));
    if (sealed) trackedCompleted.push(priorLaneA.court);
  }
  // Manual completion of the previously-active target: if reconcile advanced away
  // from priorLaneA, priorLaneA is already handled; if priorLaneA was incomplete
  // but manifest now marks it complete, include it.
  if (
    priorLaneA?.court &&
    !trackedCompleted.includes(priorLaneA.court) &&
    Array.isArray(state.completedCourts) &&
    state.completedCourts.includes(priorLaneA.court)
  ) {
    trackedCompleted.push(priorLaneA.court);
  }
  state.completedCourts = trackedCompleted;

  // Enrich every completed court's evidence from manifest (nulls when unsupported).
  state.completedCourtEvidence = state.completedCourtEvidence || {};
  for (const court of state.completedCourts) {
    const target = (manifest.targets || []).find((t) => (t.preferredCourts || [])[0] === court);
    state.completedCourtEvidence[court] = normalizeCompletionEvidence(
      court,
      target,
      state.completedCourtEvidence[court],
      nowIso,
    );
  }
  // Drop non-tracked evidence keys so operator evidence matches completedCourts.
  for (const key of Object.keys(state.completedCourtEvidence)) {
    if (!state.completedCourts.includes(key)) delete state.completedCourtEvidence[key];
  }

  // Ensure active READY_FIRST_START lifecycle when VT-like first start.
  if (state.laneA && isReadyFirstStartLaneA(state.laneA)) {
    state.laneA.jobLifecycle = "READY_FIRST_START";
    state.laneA.jobStatus = state.laneA.jobStatus || "ready";
    state.laneA.targetStatus = state.laneA.targetStatus || "READY";
    state.laneA.checkpoint = state.laneA.checkpoint || null;
    state.laneA.cursor = null;
    state.laneA.lastSuccessfulExternalId = null;
    state.laneA.nextPageUrl = null;
  }

  state = applyKnownDatabaseQuotaBlock(state, {
    neonHold: params.neonHold,
    forceDatabaseQuotaBlocked: params.forceDatabaseQuotaBlocked,
    clearDbBlock: params.clearDbBlock,
    now,
  });

  state.runtimeState = "STOPPED";
  state.currentLane = "STOPPED";
  state.laneAChild = null;
  state.laneALock = null;
  if (state.laneA) state.laneA.lock = null;
  state.queue = "#2";
  state.queue9 = "CLOSED";
  state.queue3 = "NOT_OPEN";
  state.featureAgents = "0";
  state.metrics = { ...(state.metrics || {}), aiCalls: 0, aiTokens: 0 };
  state.updatedAt = nowIso;
  state.stateConvergedAt = nowIso;
  state.stateConvergence = {
    fromCourt: priorLaneA?.court || null,
    toCourt: state.laneA?.court || null,
    advanced: Boolean(reconciled.advanced),
    completedEvidenceCount: Object.keys(state.completedCourtEvidence || {}).length,
  };

  const validation = validateConvergedState(state, manifest);
  if (!validation.ok) {
    return {
      ok: false,
      reason: validation.reason,
      details: validation.details,
      inventedCheckpoints: [],
      clRequests: 0,
      childLaunches: 0,
      mutations: 0,
      aiCalls: 0,
    };
  }

  return {
    ok: true,
    state,
    priorLaneA,
    advanced: reconciled.advanced,
    nextCourt: state.laneA?.court || null,
    completedCourts: state.completedCourts || [],
    completedEvidenceCount: Object.keys(state.completedCourtEvidence || {}).length,
    inventedCheckpoints: [],
    clRequests: 0,
    childLaunches: 0,
    mutations: 0,
    aiCalls: 0,
    queue3: "NOT_OPEN",
  };
}

function validateConvergedState(state, manifest) {
  if (!state?.laneA?.court) return { ok: false, reason: "MISSING_LANEA" };
  if (state.queue3 !== "NOT_OPEN") return { ok: false, reason: "QUEUE3_OPEN" };
  if (Number(state.metrics?.aiCalls || 0) !== 0) return { ok: false, reason: "AI_CALLS_NONZERO" };
  for (const court of state.completedCourts || []) {
    const ev = state.completedCourtEvidence?.[court];
    if (!isValidCompletionEvidence(ev)) {
      return { ok: false, reason: "MISSING_COMPLETION_EVIDENCE", details: { court } };
    }
    if (ev.checkpoint != null && typeof ev.checkpoint !== "string") {
      return { ok: false, reason: "INVALID_CHECKPOINT_TYPE", details: { court } };
    }
  }
  const next = selectNextProductionDepthTarget(manifest, { excludeCourts: state.completedCourts || [] });
  if (next?.court && state.laneA.court !== next.court) {
    // Allow if laneA is incomplete non-complete court that is still current deficit target.
    if (state.laneA.targetStatus === "COMPLETE_FOR_CURRENT_DEPTH") {
      return { ok: false, reason: "STALE_COMPLETED_LANEA", details: { laneA: state.laneA.court, next: next.court } };
    }
  }
  if (state.laneA.targetStatus === "COMPLETE_FOR_CURRENT_DEPTH" && next?.court) {
    return { ok: false, reason: "DID_NOT_ADVANCE", details: { next: next.court } };
  }
  return { ok: true };
}

function buildConvergedOperatorStatus(state, opts = {}) {
  const laneA = state.laneA || {};
  const dbBlock = state.databaseBlock || {};
  const dbBlocked = dbBlock.classification === DATABASE_QUOTA_BLOCKED && dbBlock.recovered !== true;
  const quota = state.quota || {};
  const status = buildOperatorStatus({
    state: {
      ...state,
      currentLane: "STOPPED",
      runtimeState: "STOPPED",
    },
    currentLane: "STOPPED",
    runtimeState: "STOPPED",
    freshness: "STOPPED",
    currentTask: "NONE",
    forceStoppedLane: true,
    now: opts.now,
    corpus: opts.corpus,
    health: {
      ...(opts.health || {}),
      database: dbBlocked ? "external_block" : opts.health?.database || "unknown",
      databaseConnectivity: opts.health?.databaseConnectivity || "unknown",
      featureAgents: "0",
    },
    manifestVersion: laneA.manifestVersion || state.depthManifestVersion || opts.manifestVersion,
  });

  status.worker = "STOPPED";
  status.lock = null;
  status.transition = "NONE";
  status.qualifyingCaseCount =
    laneA.qualifyingCaseCount != null ? Number(laneA.qualifyingCaseCount) : Number(laneA.count) || null;
  status.currentCount = status.qualifyingCaseCount;
  status.targetCount = laneA.target ?? null;
  status.depthStatus = laneA.targetStatus || null;
  status.jobLifecycle = laneA.jobLifecycle || null;
  status.jobStatus = laneA.jobStatus || null;
  status.checkpoint = laneA.checkpoint ?? null;
  status.cursor = laneA.cursor ?? null;
  status.lastSuccessfulExternalId = laneA.lastSuccessfulExternalId ?? null;
  status.nextPageUrl = laneA.nextPageUrl ?? null;
  status.currentCourt = laneA.court || null;
  status.currentJurisdiction = laneA.jurisdiction || null;
  status.jurisdiction = laneA.jurisdiction || null;
  status.nextCourt = laneA.court || null;
  status.nextJurisdiction = laneA.jurisdiction || null;
  status.completedCourts = state.completedCourts || [];
  status.completedCourtEvidenceCount = Object.keys(state.completedCourtEvidence || {}).length;

  status.health = {
    ...status.health,
    database: dbBlocked ? "external_block" : status.health.database,
    databaseConnectivity: status.health.databaseConnectivity || "unknown",
  };
  status.execution = {
    databaseWriteReady: state.dbWriteReady === true && !dbBlocked,
    blockReason: dbBlocked ? DATABASE_QUOTA_BLOCKED : null,
    database: {
      executionReady: state.dbWriteReady === true && !dbBlocked,
      state: dbBlocked ? DATABASE_QUOTA_BLOCKED : state.dbWriteReady === true ? "DB_READY" : "UNKNOWN",
      sqlState: dbBlocked ? dbBlock.sqlState || "53000" : null,
      externalBlock: Boolean(dbBlocked),
    },
    courtListenerAllowed: false,
    childLaunches: 0,
    clRequests: 0,
  };

  const quotaAuthoritative =
    !dbBlocked &&
    quotaUsableForExecution(quota) &&
    (quota.quotaStatus === "FRESH" ||
      quota.quotaStateConfidence === "AUTHORITATIVE_API" ||
      quota.quotaStateConfidence === "AUTHORITATIVE_HEADER");
  status.quota = {
    ...status.quota,
    executionAuthority: quotaAuthoritative,
    freshness: quotaAuthoritative ? "FRESH" : "STALE",
    reason: quotaAuthoritative
      ? null
      : dbBlocked
        ? "DB_BLOCKED_BEFORE_CL_PROBE"
        : quota.staleReason || "STALE_OR_UNKNOWN",
    historicalObservation: {
      minuteRemaining: status.quota.minuteRemaining,
      hourRemaining: status.quota.hourRemaining,
      dayRemaining: status.quota.dayRemaining,
      lastProbeAt: status.quota.lastProbeAt,
    },
  };
  if (!quotaAuthoritative) {
    // Do not present stale counters as current usable quota.
    status.quota.usableForExecution = false;
    status.quota.safeRequests = null;
    status.quota.minuteRemaining = null;
    status.quota.hourRemaining = null;
    status.quota.dayRemaining = null;
  }

  return status;
}

/**
 * Atomic persist of converged state + status. On validation failure, writes nothing.
 */
function persistConvergedQueue2State(params = {}) {
  const statePath = params.statePath || STATE_PATH;
  const statusPath = params.statusPath || STATUS_PATH;
  const priorState = fs.existsSync(statePath) ? readJson(statePath) : null;
  const priorStatus = fs.existsSync(statusPath) ? readJson(statusPath) : null;

  const converged = convergeDurableQueue2State(params);
  if (!converged.ok) {
    return {
      ...converged,
      persisted: false,
      priorStateIntact: true,
      statePath,
      statusPath,
    };
  }

  const status = buildConvergedOperatorStatus(converged.state, {
    now: params.now,
    corpus: params.corpus || priorStatus?.corpus || null,
    health: {
      orphanCount: priorStatus?.health?.orphanCount ?? 0,
      duplicateSourceIdCount: priorStatus?.health?.duplicateSourceIdCount ?? 0,
      missingEmbeddings: priorStatus?.health?.missingEmbeddings ?? 0,
      chunks: priorStatus?.health?.chunks ?? null,
      embeddings: priorStatus?.health?.embeddings ?? null,
      retrieval: priorStatus?.health?.retrieval || "ok",
      databaseConnectivity: "unknown",
    },
    manifestVersion: params.manifest?.version,
  });

  if (params.dryRun === true) {
    return {
      ok: true,
      persisted: false,
      dryRun: true,
      state: converged.state,
      status,
      priorStateIntact: true,
      completedEvidenceCount: converged.completedEvidenceCount,
      inventedCheckpoints: [],
      clRequests: 0,
      childLaunches: 0,
      mutations: 0,
      aiCalls: 0,
      queue3: "NOT_OPEN",
    };
  }

  try {
    atomicWriteJson(statePath, converged.state);
    atomicWriteJson(statusPath, status);
  } catch (err) {
    // Best-effort restore prior state if status write failed after state write.
    try {
      if (priorState) atomicWriteJson(statePath, priorState);
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      reason: "ATOMIC_PERSIST_FAILED",
      detail: String(err.message || err).slice(0, 300),
      persisted: false,
      priorStateIntact: Boolean(priorState),
      clRequests: 0,
      mutations: 0,
      aiCalls: 0,
    };
  }

  return {
    ok: true,
    persisted: true,
    state: converged.state,
    status,
    statePath,
    statusPath,
    advanced: converged.advanced,
    nextCourt: converged.nextCourt,
    completedEvidenceCount: converged.completedEvidenceCount,
    inventedCheckpoints: [],
    clRequests: 0,
    childLaunches: 0,
    mutations: 0,
    aiCalls: 0,
    queue3: "NOT_OPEN",
  };
}

function loadNeonHoldArtifact(filePath = NEON_HOLD_PATH) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return readJson(filePath);
  } catch {
    return null;
  }
}

module.exports = {
  ROOT,
  REPORTS,
  STATE_PATH,
  MANIFEST_PATH,
  STATUS_PATH,
  MANUAL_COMPLETION_COURTS,
  AUTONOMOUS_COMPLETION_COURTS,
  readJson,
  atomicWriteJson,
  evidenceSourceForCourt,
  normalizeCompletionEvidence,
  sealPriorLaneAEvidence,
  applyKnownDatabaseQuotaBlock,
  convergeDurableQueue2State,
  validateConvergedState,
  buildConvergedOperatorStatus,
  persistConvergedQueue2State,
  loadNeonHoldArtifact,
};
