/**
 * Queue #2 database readiness gate.
 *
 * CourtListener traffic is forbidden until staging DB writes can be durable.
 * SQLSTATE 53000 (Neon project quota) is an external infrastructure block.
 *
 * Lane B dbDependency is an audit of the registry runners in
 * scripts/queue2-lane-b-runners.cjs and the production SQL path in
 * scripts/staging-queue2-lane-b.cjs. It is not inferred from task names.
 */
"use strict";

const DATABASE_QUOTA_BLOCKED = "DATABASE_QUOTA_BLOCKED";
const DB_DEPENDENCY = Object.freeze({
  DB_REQUIRED: "DB_REQUIRED",
  DB_READ_ONLY: "DB_READ_ONLY",
  NO_DB_REQUIRED: "NO_DB_REQUIRED",
});

/**
 * Audited classification. Evidence:
 * - NO_DB_REQUIRED: runner body never references DATABASE_URL or sql``.
 *   US reports gap, historical gaps, intermediate mapping, currentness,
 *   daily scorecard, and next-CL prep read or write local report files only.
 *   Depth manifest refresh reranks the local manifest file only.
 *   Corpus integrity and retrieval regression runners are local no-ops
 *   (integrityAudit / retrievalRegression); they do not query staging.
 * - DB_REQUIRED: registry mayMutate true, and the production Lane B monolith
 *   (staging-queue2-lane-b.cjs) performs those writes through postgres
 *   (importAuthority / citation queries). A quota-blocked session cannot
 *   establish that mutation.
 * - DB_READ_ONLY: no current registry runner only reads staging SQL.
 */
const LANE_B_DB_DEPENDENCY = Object.freeze({
  US_REPORTS_GAP_ANALYSIS: DB_DEPENDENCY.NO_DB_REQUIRED,
  NON_CL_PRIMARY_AUTHORITY_INTAKE: DB_DEPENDENCY.DB_REQUIRED,
  USC_DEPTH: DB_DEPENDENCY.DB_REQUIRED,
  CFR_DEPTH: DB_DEPENDENCY.DB_REQUIRED,
  FEDERAL_RULES_DEPTH: DB_DEPENDENCY.DB_REQUIRED,
  CITATION_RERESOLVE: DB_DEPENDENCY.DB_REQUIRED,
  DEPTH_MANIFEST_REFRESH: DB_DEPENDENCY.NO_DB_REQUIRED,
  HISTORICAL_GAP_ANALYSIS: DB_DEPENDENCY.NO_DB_REQUIRED,
  INTERMEDIATE_MAPPING_RESEARCH_NON_CL: DB_DEPENDENCY.NO_DB_REQUIRED,
  CORPUS_INTEGRITY_AUDIT: DB_DEPENDENCY.NO_DB_REQUIRED,
  RETRIEVAL_REGRESSION: DB_DEPENDENCY.NO_DB_REQUIRED,
  CURRENTNESS_AUDIT_LOCAL: DB_DEPENDENCY.NO_DB_REQUIRED,
  NEXT_CL_BATCH_PREPARATION: DB_DEPENDENCY.NO_DB_REQUIRED,
  DAILY_SCORECARD_REFRESH: DB_DEPENDENCY.NO_DB_REQUIRED,
});

const NEON_QUOTA_MESSAGE = /exceeded the quota/i;

function textOf(input) {
  if (input == null) return "";
  if (typeof input === "string") return input;
  return String(input.message || input.err || input.reason || "");
}

function codeOf(input) {
  if (input == null || typeof input === "string") return null;
  return input.code || input.sqlstate || input.SQLSTATE || null;
}

/**
 * Classify a database failure. 53000 is never a CourtListener, parser,
 * mapping, checkpoint, or source failure.
 */
function classifyDatabaseFailure(input) {
  const code = codeOf(input);
  const message = textOf(input);
  const sqlstate = String(code || (message.match(/SQLSTATE[:\s]*([0-9A-Z]{5})/i) || [])[1] || "");
  if (sqlstate === "53000" || NEON_QUOTA_MESSAGE.test(message)) {
    return {
      classification: DATABASE_QUOTA_BLOCKED,
      sqlstate: sqlstate || "53000",
      external: true,
      temporary: true,
      courtListenerFailure: false,
      ingestionParserFailure: false,
      mappingFailure: false,
      checkpointCorruption: false,
      sourceFailure: false,
    };
  }
  if (!input || input.ok === true) {
    return { classification: null, sqlstate: sqlstate || null, external: false };
  }
  return {
    classification: "UNKNOWN_DB_FAILURE",
    sqlstate: sqlstate || null,
    external: true,
    temporary: false,
    courtListenerFailure: false,
    ingestionParserFailure: false,
    mappingFailure: false,
    checkpointCorruption: false,
    sourceFailure: false,
  };
}

/**
 * dbWriteReady is true only when a probe established a usable session.
 * Neon quota rejection fails closed. A successful non-mutating ping
 * (SELECT 1) is enough: SQLSTATE 53000 rejects the session before SQL.
 */
function evaluateDbWriteReadiness(probe) {
  if (!probe || typeof probe !== "object") {
    return {
      dbWriteReady: false,
      classification: "DATABASE_UNAVAILABLE",
      reason: "DATABASE_UNAVAILABLE",
      mutations: 0,
      courtListenerHttpCalls: 0,
    };
  }
  const failure = classifyDatabaseFailure(probe);
  if (failure.classification === DATABASE_QUOTA_BLOCKED) {
    return {
      dbWriteReady: false,
      classification: DATABASE_QUOTA_BLOCKED,
      reason: DATABASE_QUOTA_BLOCKED,
      sqlstate: failure.sqlstate,
      external: true,
      mutations: 0,
      courtListenerHttpCalls: 0,
    };
  }
  if (probe.writable === false || probe.readOnly === true) {
    return {
      dbWriteReady: false,
      classification: "DATABASE_READ_ONLY",
      reason: "DATABASE_READ_ONLY",
      mutations: 0,
      courtListenerHttpCalls: 0,
    };
  }
  if (probe.ok === true && probe.writable !== false) {
    return {
      dbWriteReady: true,
      classification: "DB_READY",
      reason: "DB_READY",
      mutations: 0,
      courtListenerHttpCalls: 0,
    };
  }
  return {
    dbWriteReady: false,
    classification: failure.classification || "DATABASE_UNAVAILABLE",
    reason: failure.classification || "DATABASE_UNAVAILABLE",
    sqlstate: failure.sqlstate,
    mutations: 0,
    courtListenerHttpCalls: 0,
  };
}

function assertCourtListenerAllowed(params = {}) {
  if (params.dbWriteReady !== true) {
    return {
      ok: false,
      reason: "INVARIANT_CL_WHILE_DB_NOT_WRITABLE",
      clRequests: 0,
      executed: false,
    };
  }
  return { ok: true, reason: null, clRequests: 0, executed: false };
}

/**
 * Stop before HTTP. The execute callback is not invoked when the DB is blocked.
 */
function guardCourtListenerAttempt(params = {}) {
  const gate = assertCourtListenerAllowed(params);
  if (!gate.ok) {
    return { executed: false, clRequests: 0, reason: gate.reason, httpExecuted: false };
  }
  if (typeof params.execute === "function") {
    params.execute();
    return { executed: true, clRequests: Number(params.clRequests) || 1, reason: null, httpExecuted: true };
  }
  return { executed: false, clRequests: 0, reason: null, httpExecuted: false };
}

function markQuotaUnknownForExecution(quota) {
  const prior = quota && typeof quota === "object" ? quota : {};
  return {
    ...prior,
    quotaStatus: "UNKNOWN_FOR_EXECUTION",
    executionAuthority: "STALE",
    usableForExecution: false,
    quotaStateConfidence: "STALE",
    quotaStateSource: "historical_not_for_execution",
  };
}

function quotaUsableForExecution(quota) {
  if (!quota || typeof quota !== "object") return false;
  if (quota.usableForExecution === false) return false;
  if (quota.quotaStatus === "UNKNOWN_FOR_EXECUTION") return false;
  if (quota.executionAuthority === "STALE") return false;
  return true;
}

function applyDatabaseQuotaBlock(state, now = new Date()) {
  const next = JSON.parse(JSON.stringify(state || {}));
  const nowIso = (now instanceof Date ? now : new Date(now)).toISOString();
  const checkpoint = next.laneA ? next.laneA.checkpoint ?? null : null;
  next.dbWriteReady = false;
  next.laneAStatus = "BLOCKED";
  next.databaseBlock = {
    classification: DATABASE_QUOTA_BLOCKED,
    since:
      next.databaseBlock?.classification === DATABASE_QUOTA_BLOCKED && next.databaseBlock.since
        ? next.databaseBlock.since
        : nowIso,
    recovered: false,
  };
  next.quota = markQuotaUnknownForExecution(next.quota);
  next.currentLane = "B";
  next.queue = "#2";
  next.queue9 = "CLOSED";
  next.queue3 = "NOT_OPEN";
  next.featureAgents = "0";
  next.metrics = { ...(next.metrics || {}), aiCalls: 0, aiTokens: 0 };
  if (next.laneA) next.laneA.checkpoint = checkpoint;
  if (!next.humanReview) next.humanReview = { required: false, reasons: [], details: [] };
  return next;
}

function recoverDatabaseQuotaBlock(state, now = new Date()) {
  const next = JSON.parse(JSON.stringify(state || {}));
  const prior = next.databaseBlock;
  if (!prior || prior.classification !== DATABASE_QUOTA_BLOCKED || prior.recovered === true) {
    return { state: next, recovered: false };
  }
  const nowIso = (now instanceof Date ? now : new Date(now)).toISOString();
  next.databaseBlock = {
    classification: "RECOVERED",
    recoveredFrom: DATABASE_QUOTA_BLOCKED,
    since: prior.since || nowIso,
    recoveredAt: nowIso,
    recovered: true,
  };
  next.dbWriteReady = true;
  next.laneAStatus = "READY";
  next.quota = markQuotaUnknownForExecution(next.quota);
  next.quotaProbeCache = null;
  next.queue = "#2";
  next.queue3 = "NOT_OPEN";
  next.featureAgents = "0";
  return { state: next, recovered: true };
}

function auditLaneBDbDependency(registry) {
  const tasks = registry?.tasks || [];
  const problems = [];
  const seen = new Set();
  for (const task of tasks) {
    seen.add(task.id);
    const expected = LANE_B_DB_DEPENDENCY[task.id];
    if (!expected) problems.push(`unclassified:${task.id}`);
    else if (task.dbDependency !== expected) {
      problems.push(`mismatch:${task.id}:${task.dbDependency || "missing"}!=${expected}`);
    } else if (!Object.values(DB_DEPENDENCY).includes(task.dbDependency)) {
      problems.push(`invalid:${task.id}`);
    }
  }
  for (const id of Object.keys(LANE_B_DB_DEPENDENCY)) {
    if (!seen.has(id)) problems.push(`registry_missing:${id}`);
  }
  return { ok: problems.length === 0, problems, classes: { ...LANE_B_DB_DEPENDENCY } };
}

module.exports = {
  DATABASE_QUOTA_BLOCKED,
  DB_DEPENDENCY,
  LANE_B_DB_DEPENDENCY,
  classifyDatabaseFailure,
  evaluateDbWriteReadiness,
  assertCourtListenerAllowed,
  guardCourtListenerAttempt,
  markQuotaUnknownForExecution,
  quotaUsableForExecution,
  applyDatabaseQuotaBlock,
  recoverDatabaseQuotaBlock,
  auditLaneBDbDependency,
};
