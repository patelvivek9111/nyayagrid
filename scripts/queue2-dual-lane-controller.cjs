/**
 * Queue #2 dual-lane controller — pure scheduler (no network).
 *
 * LANE A: CourtListener ingest (single worker).
 * LANE B: strictly zero CourtListener HTTP.
 * Quota recheck is a separate scheduled mechanism (api-usage only).
 *
 * FEATURE_AGENTS must stay 0. Queue #3 is not opened here.
 */

"use strict";

const { createHash } = require("node:crypto");
const {
  validatePartialCheckpoint,
  reconcileLaneAFromJob,
  setHumanReview,
  HUMAN_REVIEW_REASONS,
  isPartialLaneA,
  hasDurableCheckpoint,
} = require("./queue2-worker-observability.cjs");

const QUEUE = "#2";
const USEFUL_CL_MIN = 25;
const MIN_QUOTA_PROBE_GAP_MS = 10 * 60 * 1000;
const LANE_A_LOCK_TTL_MS = 30 * 60 * 1000;
const EST_CL_REQUESTS_PER_CASE = 2.3;

/** Current production-depth CL sequence (Wave 2AG remainder). */
const LANE_A_SEQUENCE = [
  { court: "ark", j: "AR", target: 45 },
  { court: "sd", j: "SD", target: 45 },
  { court: "idaho", j: "ID", target: 45 },
  { court: "wyo", j: "WY", target: 45 },
  { court: "neb", j: "NE", target: 45 },
  { court: "ala", j: "AL", target: 45 },
  { court: "ky", j: "KY", target: 45 },
];

const LANE_B_TASKS = [
  "us_reports_gap_analysis",
  "us_reports_non_cl_intake",
  "usc_cfr_federal_rules_depth",
  "citation_re_resolution",
  "depth_gap_analysis",
  "historical_hole_detection",
  "intermediate_court_research",
  "corpus_integrity",
  "retrieval_validation",
  "depth_scorecard",
];

const CL_HOST_RE = /(?:^|\.)courtlistener\.com$/i;
const CL_BLOCKED_PATHS = [
  "/api/rest/v4/opinions",
  "/api/rest/v4/clusters",
  "/api/rest/v4/dockets",
  "/api/rest/v4/courts",
  "/api/rest/v4/search",
  "/api/rest/v4/api-usage",
];

function sha256(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

function createInitialState(now = new Date()) {
  const first = LANE_A_SEQUENCE[0];
  return {
    version: 1,
    queue: QUEUE,
    queue9: "CLOSED",
    queue3: "NOT_OPEN",
    featureAgents: "0",
    currentLane: "B",
    updatedAt: now.toISOString(),
    laneA: {
      court: first.court,
      jurisdiction: first.j,
      checkpoint: null,
      cursor: null,
      lastSuccessfulExternalId: null,
      nextPageUrl: null,
      lastSuccessfulAt: null,
      runner: "staging-cl-batch-job",
      mappingStatus: null,
      manifestVersion: 0,
      jobStatus: null,
      itemsImported: null,
      target: first.target,
      count: 0,
      sequence: LANE_A_SEQUENCE.map((s) => s.court),
      lock: null,
    },
    quota: {
      windows: null,
      lastProbeAt: null,
      nextCheckAt: now.toISOString(),
      last429At: null,
      retryAfterSeconds: null,
      lastSafeRequests: 0,
      hard429Count: 0,
    },
    laneB: {
      task: LANE_B_TASKS[0],
      checkpoint: null,
      tasksCompleted: [],
    },
    depthManifestVersion: 0,
    lastCitationResolve: null,
    lastIntegrityAudit: null,
    laneStartedAt: null,
    lastHeartbeatAt: null,
    humanReview: { required: false, reasons: [], details: [] },
    metrics: {
      laneAMs: 0,
      laneBMs: 0,
      idleMs: 0,
      clAuthorities: 0,
      nonClAuthorities: 0,
      citationsResolved: 0,
      quotaChecks: 0,
      laneSwitches: 0,
    },
    switches: [],
  };
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function restoreState(saved, now = new Date()) {
  const base = createInitialState(now);
  if (!saved || typeof saved !== "object") return base;
  const merged = {
    ...base,
    ...saved,
    laneA: { ...base.laneA, ...(saved.laneA || {}) },
    quota: { ...base.quota, ...(saved.quota || {}) },
    laneB: { ...base.laneB, ...(saved.laneB || {}) },
    metrics: { ...base.metrics, ...(saved.metrics || {}) },
    humanReview: {
      required: false,
      reasons: [],
      details: [],
      ...(saved.humanReview || {}),
    },
    switches: Array.isArray(saved.switches) ? saved.switches : [],
  };
  merged.queue = QUEUE;
  merged.queue9 = "CLOSED";
  merged.queue3 = "NOT_OPEN";
  merged.featureAgents = "0";
  merged.version = 1;
  if (merged.currentLane !== "A" && merged.currentLane !== "B") merged.currentLane = "B";
  // Harden: never keep an active partial court with a null checkpoint.
  const check = validatePartialCheckpoint(merged.laneA);
  merged.laneA = check.laneA;
  if (check.humanReviewRequired) {
    Object.assign(
      merged,
      setHumanReview(merged, check.reason, "restoreState refused null checkpoint on partial court"),
    );
    if (merged.currentLane === "A") merged.currentLane = "B";
  }
  return merged;
}

/**
 * Persist Lane A progress. Rejects partial courts without durable checkpoint
 * (never invents a resume position).
 */
function persistLaneAProgress(state, patch = {}, now = new Date()) {
  const next = cloneState(state);
  next.laneA = {
    ...next.laneA,
    ...patch,
    checkpoint:
      patch.checkpoint ??
      patch.lastSuccessfulExternalId ??
      next.laneA.checkpoint ??
      next.laneA.lastSuccessfulExternalId ??
      null,
  };
  if (patch.lastSuccessfulExternalId) {
    next.laneA.lastSuccessfulExternalId = patch.lastSuccessfulExternalId;
    if (!next.laneA.checkpoint) next.laneA.checkpoint = patch.lastSuccessfulExternalId;
  }
  next.updatedAt = now.toISOString();
  const check = validatePartialCheckpoint(next.laneA);
  next.laneA = check.laneA;
  if (check.humanReviewRequired) {
    return {
      ok: false,
      state: setHumanReview(next, check.reason, "persistLaneAProgress blocked null checkpoint"),
      reason: check.reason,
    };
  }
  return { ok: true, state: next, reason: null };
}

/**
 * Copy proven durable job checkpoint into scheduler. Does not invent IDs.
 */
function applyDurableJobCheckpoint(state, job, extras = {}, now = new Date()) {
  const next = cloneState(state);
  const { state: laneA, reconciled, reason } = reconcileLaneAFromJob(next.laneA, job, extras);
  next.laneA = laneA;
  next.updatedAt = now.toISOString();
  if (!reconciled) {
    if (isPartialLaneA(next.laneA) && !hasDurableCheckpoint(next.laneA)) {
      return {
        ok: false,
        state: setHumanReview(
          next,
          HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT,
          reason || "durable job reconcile failed",
        ),
        reason: reason || HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT,
      };
    }
    return { ok: false, state: next, reason: reason || "reconcile_failed" };
  }
  const check = validatePartialCheckpoint(next.laneA);
  next.laneA = check.laneA;
  if (check.humanReviewRequired) {
    return {
      ok: false,
      state: setHumanReview(next, check.reason, "post-reconcile validation"),
      reason: check.reason,
    };
  }
  // Clear prior missing-checkpoint review if reconciled successfully.
  if (next.humanReview?.reasons?.includes(HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT)) {
    next.humanReview.reasons = next.humanReview.reasons.filter(
      (r) => r !== HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT,
    );
    if (next.humanReview.reasons.length === 0) {
      next.humanReview.required = false;
      next.humanReview.details = [];
    }
  }
  return { ok: true, state: next, reason: null };
}

function remainingRequestsToFinishCourt(laneA) {
  const target = Number(laneA?.target) || 0;
  const count = Number(laneA?.count) || 0;
  const casesLeft = Math.max(0, target - count);
  if (casesLeft <= 0) return 0;
  return Math.ceil(casesLeft * EST_CL_REQUESTS_PER_CASE);
}

/**
 * Resume Lane A only for a meaningful bounded batch, not a trivial drip.
 * @param {{ safeRequests: number, remainingRequestsToFinishCourt?: number, minBatch?: number }} params
 */
function hasUsefulClCapacity(params) {
  const safe = Math.max(0, Number(params.safeRequests) || 0);
  const minBatch = params.minBatch ?? USEFUL_CL_MIN;
  const remaining = Math.max(0, Number(params.remainingRequestsToFinishCourt) || 0);
  if (safe >= minBatch) return { useful: true, reason: "min_batch" };
  if (remaining > 0 && safe >= remaining) return { useful: true, reason: "finish_partial_court" };
  return { useful: false, reason: safe <= 0 ? "quota_floor" : "below_useful_capacity" };
}

function projectNextQuotaCheck(params) {
  const nowMs = (params.now instanceof Date ? params.now : new Date(params.now)).getTime();
  const lastProbeMs = params.lastProbeAt
    ? new Date(params.lastProbeAt).getTime()
    : 0;
  const earliest = lastProbeMs + (params.minGapMs ?? MIN_QUOTA_PROBE_GAP_MS);
  const projected =
    params.projectedUsefulAt != null ? new Date(params.projectedUsefulAt).getTime() : nowMs;
  const next = Math.max(nowMs, earliest, projected);
  return new Date(next).toISOString();
}

function quotaProbeDue(state, now = new Date()) {
  if (!state?.quota?.nextCheckAt) return true;
  return now.getTime() >= new Date(state.quota.nextCheckAt).getTime();
}

/**
 * @param {object} state
 * @param {{ safeRequests: number, windows?: object, projectedUsefulAt?: string|Date|null, now?: Date }} quota
 */
function decideLane(state, quota) {
  const now = quota.now || new Date();
  if (state?.humanReview?.required) {
    return {
      lane: "B",
      reason: "human_review_required",
      remainingRequestsToFinishCourt: remainingRequestsToFinishCourt(state.laneA),
      blocked: true,
    };
  }
  const check = validatePartialCheckpoint(state.laneA);
  if (check.humanReviewRequired) {
    return {
      lane: "B",
      reason: check.reason,
      remainingRequestsToFinishCourt: remainingRequestsToFinishCourt(state.laneA),
      blocked: true,
      needsHumanReview: true,
    };
  }
  const remaining = remainingRequestsToFinishCourt(state.laneA);
  const capacity = hasUsefulClCapacity({
    safeRequests: quota.safeRequests,
    remainingRequestsToFinishCourt: remaining,
  });
  if (capacity.useful) {
    return {
      lane: "A",
      reason: capacity.reason,
      remainingRequestsToFinishCourt: remaining,
    };
  }
  return {
    lane: "B",
    reason: capacity.reason,
    remainingRequestsToFinishCourt: remaining,
    nextCheckAt: projectNextQuotaCheck({
      now,
      lastProbeAt: state.quota.lastProbeAt || now.toISOString(),
      projectedUsefulAt: quota.projectedUsefulAt || null,
    }),
  };
}

function applyQuotaSnapshot(state, params) {
  const next = cloneState(state);
  const now = params.now || new Date();
  next.quota.windows = params.windows || next.quota.windows;
  next.quota.lastProbeAt = now.toISOString();
  next.quota.lastSafeRequests = Math.max(0, Number(params.safeRequests) || 0);
  next.quota.nextCheckAt = projectNextQuotaCheck({
    now,
    lastProbeAt: now.toISOString(),
    projectedUsefulAt: params.projectedUsefulAt || null,
  });
  if (params.last429At) next.quota.last429At = params.last429At;
  if (params.retryAfterSeconds != null) next.quota.retryAfterSeconds = params.retryAfterSeconds;
  next.metrics.quotaChecks += 1;
  next.updatedAt = now.toISOString();
  return next;
}

function recordLaneSwitch(state, fromLane, toLane, reason, now = new Date()) {
  const next = cloneState(state);
  next.currentLane = toLane;
  next.metrics.laneSwitches += 1;
  next.switches.push({
    at: now.toISOString(),
    from: fromLane,
    to: toLane,
    reason,
  });
  next.updatedAt = now.toISOString();
  return next;
}

function applyQuotaFloorTransition(state, params) {
  const now = params.now || new Date();
  let next = applyQuotaSnapshot(state, params);
  const checkpoint =
    params.checkpoint ??
    params.lastSuccessfulExternalId ??
    next.laneA.checkpoint ??
    next.laneA.lastSuccessfulExternalId ??
    null;
  next.laneA = {
    ...next.laneA,
    court: params.court ?? next.laneA.court,
    jurisdiction: params.jurisdiction ?? next.laneA.jurisdiction,
    checkpoint,
    cursor: params.cursor ?? next.laneA.cursor,
    lastSuccessfulExternalId:
      params.lastSuccessfulExternalId ?? next.laneA.lastSuccessfulExternalId ?? checkpoint,
    nextPageUrl: params.nextPageUrl ?? next.laneA.nextPageUrl,
    lastSuccessfulAt: params.lastSuccessfulAt ?? next.laneA.lastSuccessfulAt,
    target: params.target ?? next.laneA.target,
    count: params.count ?? next.laneA.count,
    jobStatus: params.jobStatus ?? next.laneA.jobStatus ?? "quota_paused",
    lock: null,
  };
  const check = validatePartialCheckpoint(next.laneA);
  next.laneA = check.laneA;
  if (check.humanReviewRequired) {
    next = setHumanReview(next, check.reason, "quota floor with missing durable checkpoint");
  }
  if (next.currentLane !== "B") {
    next = recordLaneSwitch(next, next.currentLane, "B", params.reason || "quota_floor", now);
  } else {
    next.currentLane = "B";
    next.updatedAt = now.toISOString();
  }
  return next;
}

function applyQuotaRecoveryTransition(state, params) {
  const now = params.now || new Date();
  let next = applyQuotaSnapshot(state, params);
  const decision = decideLane(next, {
    safeRequests: params.safeRequests,
    projectedUsefulAt: params.projectedUsefulAt,
    now,
  });
  if (decision.lane === "A" && next.currentLane !== "A") {
    next = recordLaneSwitch(next, next.currentLane, "A", decision.reason, now);
  }
  return { state: next, decision };
}

function acquireLaneALock(state, workerId, now = new Date(), ttlMs = LANE_A_LOCK_TTL_MS) {
  const lock = state.laneA?.lock;
  if (lock && lock.until && new Date(lock.until).getTime() > now.getTime() && lock.workerId !== workerId) {
    return { ok: false, reason: "lane_a_already_running", state };
  }
  const next = cloneState(state);
  next.laneA.lock = {
    workerId,
    until: new Date(now.getTime() + ttlMs).toISOString(),
  };
  next.updatedAt = now.toISOString();
  return { ok: true, state: next };
}

function releaseLaneALock(state, workerId, now = new Date()) {
  const next = cloneState(state);
  if (next.laneA.lock && next.laneA.lock.workerId && next.laneA.lock.workerId !== workerId) {
    return { ok: false, reason: "lock_owned_by_other", state };
  }
  next.laneA.lock = null;
  next.updatedAt = now.toISOString();
  return { ok: true, state: next };
}

function recordLaneTime(state, lane, durationMs, extras = {}) {
  const next = cloneState(state);
  const ms = Math.max(0, Number(durationMs) || 0);
  if (lane === "A") next.metrics.laneAMs += ms;
  else if (lane === "B") next.metrics.laneBMs += ms;
  else next.metrics.idleMs += ms;
  if (extras.clAuthorities) next.metrics.clAuthorities += extras.clAuthorities;
  if (extras.nonClAuthorities) next.metrics.nonClAuthorities += extras.nonClAuthorities;
  if (extras.citationsResolved) next.metrics.citationsResolved += extras.citationsResolved;
  next.updatedAt = extras.now ? new Date(extras.now).toISOString() : next.updatedAt;
  return next;
}

function completeLaneBTask(state, task, checkpoint, now = new Date()) {
  const next = cloneState(state);
  if (!next.laneB.tasksCompleted.includes(task)) next.laneB.tasksCompleted.push(task);
  next.laneB.checkpoint = checkpoint ?? next.laneB.checkpoint;
  const idx = LANE_B_TASKS.indexOf(task);
  const nextTask = idx >= 0 ? LANE_B_TASKS[(idx + 1) % LANE_B_TASKS.length] : LANE_B_TASKS[0];
  next.laneB.task = nextTask;
  next.updatedAt = now.toISOString();
  return next;
}

function isCourtListenerUrl(url) {
  if (url == null) return false;
  let parsed;
  try {
    parsed = new URL(String(url), "https://www.courtlistener.com");
  } catch {
    return /courtlistener\.com/i.test(String(url));
  }
  return CL_HOST_RE.test(parsed.hostname);
}

function isBlockedLaneBCourtListenerUrl(url) {
  if (!isCourtListenerUrl(url)) return false;
  try {
    const parsed = new URL(String(url), "https://www.courtlistener.com");
    return CL_BLOCKED_PATHS.some((p) => parsed.pathname === p || parsed.pathname.startsWith(`${p}/`));
  } catch {
    return true;
  }
}

function assertLaneBUrlAllowed(url) {
  if (isCourtListenerUrl(url)) {
    const err = new Error(`LANE_B_CL_BLOCKED: ${String(url)}`);
    err.code = "LANE_B_CL_BLOCKED";
    throw err;
  }
  return true;
}

/**
 * Patch fetch so accidental CL calls during Lane B fail locally.
 * Quota recheck must use a separate unguarded fetch, not this wrapper.
 */
function installLaneBFetchGuard(globalObj = globalThis) {
  const original = globalObj.fetch;
  if (typeof original !== "function") {
    throw new Error("fetch unavailable; cannot install Lane B guard");
  }
  if (original.__nyayaLaneBGuard) return original;
  const guarded = async function laneBGuardedFetch(input, init) {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
    assertLaneBUrlAllowed(url);
    return original.call(this, input, init);
  };
  guarded.__nyayaLaneBGuard = true;
  guarded.__nyayaLaneBOriginalFetch = original;
  globalObj.fetch = guarded;
  return guarded;
}

function uninstallLaneBFetchGuard(globalObj = globalThis) {
  const current = globalObj.fetch;
  if (current && current.__nyayaLaneBOriginalFetch) {
    globalObj.fetch = current.__nyayaLaneBOriginalFetch;
  }
}

function uniqueCitationEdgeKey(edge) {
  return [edge.fromAuthorityId, edge.normalizedCitation || edge.rawCitation, edge.pinpoint || ""]
    .join("|")
    .toLowerCase();
}

function uniqueEmbeddingKey(row) {
  return `${row.authorityId}:${row.chunkIndex}:${row.contentHash || sha256(row.content || "")}`;
}

function insertUnique(set, key) {
  if (set.has(key)) return { inserted: false, duplicate: true };
  set.add(key);
  return { inserted: true, duplicate: false };
}

function classifyDepth(params) {
  const deficit = Math.max(0, Number(params.authorityDeficitTo101) || 0);
  const mid = Number(params.intermediateAppellate) || 0;
  if (deficit >= 80 || (deficit >= 50 && mid === 0)) return "CRITICAL_DEPTH";
  if (deficit >= 40 || mid < 5) return "HIGH_DEPTH";
  if (deficit >= 15) return "MEDIUM_DEPTH";
  return "LOW_DEPTH";
}

function detectHistoricalHoles(params) {
  const years = (params.years || []).filter((y) => Number.isFinite(y)).map(Number);
  const nowYear = params.nowYear ?? new Date().getUTCFullYear();
  const flags = [];
  if (years.length === 0) {
    return { flags: [{ kind: "no_dated_cases" }], targetRanges: ["pre-2000", "1980-1999", "1960-1979", "pre-1960"] };
  }
  const newest = Math.max(...years);
  const oldest = Math.min(...years);
  const decades = new Set(years.map((y) => Math.floor(y / 10) * 10));
  if (years.every((y) => y >= nowYear - 1)) flags.push({ kind: "recent_only", label: `${nowYear}/recent concentration` });
  if (decades.size <= 1) flags.push({ kind: "one_decade", decade: [...decades][0] });
  const uniqueCourts = params.uniqueCourts ?? null;
  if (uniqueCourts != null && uniqueCourts <= 1) flags.push({ kind: "one_court" });

  const targetRanges = [];
  if (!years.some((y) => y < 2000)) targetRanges.push("pre-2000");
  if (!years.some((y) => y >= 1980 && y <= 1999)) targetRanges.push("1980-1999");
  if (!years.some((y) => y >= 1960 && y <= 1979)) targetRanges.push("1960-1979");
  if (!years.some((y) => y < 1960)) targetRanges.push("pre-1960");

  return { flags, targetRanges, oldest, newest, decadeCount: decades.size };
}

const US_REPORTS_RE = /\b(\d{1,3})\s+U\.\s*S\.\s+(\d{1,4})\b/;
const SCOTUS_S_CT_RE = /\b(\d{1,3})\s+S\.\s*Ct\.\s+(\d{1,4})\b/;
const SCOTUS_L_ED_RE = /\b(\d{1,3})\s+L\.\s*Ed\.(?:\s*2d)?\s+(\d{1,4})\b/;

function parseUsReportsCitation(raw) {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  const us = US_REPORTS_RE.exec(text);
  if (us) {
    return {
      citation: `${us[1]} U.S. ${us[2]}`,
      reporter: "U.S.",
      volume: Number(us[1]),
      page: Number(us[2]),
      family: "us_reports",
    };
  }
  const sct = SCOTUS_S_CT_RE.exec(text);
  if (sct) {
    return {
      citation: `${sct[1]} S. Ct. ${sct[2]}`,
      reporter: "S. Ct.",
      volume: Number(sct[1]),
      page: Number(sct[2]),
      family: "scotus_sct",
    };
  }
  const led = SCOTUS_L_ED_RE.exec(text);
  if (led) {
    return {
      citation: text,
      reporter: /2d/i.test(text) ? "L. Ed. 2d" : "L. Ed.",
      volume: Number(led[1]),
      page: Number(led[2]),
      family: "scotus_led",
    };
  }
  return null;
}

/**
 * Rank missing U.S. Reports / SCOTUS citations from local TARGET_ABSENT edges.
 * Does not fabricate case identities.
 */
function rankMissingUsReports(edges, presentCitations = []) {
  const present = new Set(
    presentCitations.map((c) => String(c).replace(/\s+/g, " ").trim().toLowerCase()),
  );
  const buckets = new Map();
  for (const edge of edges || []) {
    const parsed = parseUsReportsCitation(edge.normalizedCitation || edge.rawCitation);
    if (!parsed) continue;
    const key = parsed.citation.toLowerCase();
    if (!buckets.has(key)) {
      buckets.set(key, {
        citation: parsed.citation,
        volume: parsed.volume,
        page: parsed.page,
        reporter: parsed.reporter,
        family: parsed.family,
        inbound: 0,
        alreadyPresentUnderAlias: present.has(key),
        estimatedDecisionIdentity: null,
        suitablePublicNonClSource: parsed.family === "us_reports" ? "loc_us_reports_candidate" : "unknown_without_us_reports_parallel",
      });
    }
    buckets.get(key).inbound += Number(edge.inbound || 1);
  }
  return [...buckets.values()].sort((a, b) => b.inbound - a.inbound || a.volume - b.volume || a.page - b.page);
}

/**
 * Intermediate mapping: local evidence only. Never invent IDs.
 * Known-bad IDs stay MAPPING_INVALID unless new local evidence exists.
 */
function classifyIntermediateCandidate(params) {
  const invalidId = params.invalidCandidateId;
  const hypothesized = params.hypothesizedIds || [];
  const liveVerifyForbidden = true;
  if (!params.positiveLocalEvidence) {
    return {
      gapId: invalidId,
      classification: "UNRESOLVED",
      candidateClId: null,
      hypothesizedUnverifiedIds: hypothesized,
      liveVerifyForbidden,
      note: "No local evidence identifies a replacement CourtListener court id. Do not query CourtListener from Lane B.",
    };
  }
  return {
    gapId: invalidId,
    classification: "CANDIDATE_NEEDS_SINGLE_CL_VERIFY",
    candidateClId: params.positiveLocalEvidence.candidateClId,
    evidence: params.positiveLocalEvidence.evidence,
    liveVerifyForbidden,
  };
}

const KNOWN_INTERMEDIATE_GAPS = [
  {
    invalidCandidateId: "pacommwlth",
    courtName: "Commonwealth Court of Pennsylvania",
    hypothesizedIds: ["pacomm", "pa-comm"],
    positiveLocalEvidence: null,
  },
  {
    invalidCandidateId: "njsuperct",
    courtName: "Superior Court of New Jersey, Appellate Division",
    hypothesizedIds: ["njsuper"],
    positiveLocalEvidence: null,
  },
  {
    invalidCandidateId: "vacapp",
    courtName: "Court of Appeals of Virginia",
    hypothesizedIds: [],
    positiveLocalEvidence: null,
  },
];

function researchIntermediateGaps() {
  return KNOWN_INTERMEDIATE_GAPS.map((g) => classifyIntermediateCandidate(g));
}

function logLaneEvent(lane, payload) {
  const tag =
    lane === "A" ? "LANE_A_CL" : lane === "CHECK" ? "QUOTA_CHECK" : lane === "SWITCH" ? "LANE_SWITCH" : "LANE_B_OFFLINE";
  return { tag, at: new Date().toISOString(), ...payload };
}

module.exports = {
  QUEUE,
  USEFUL_CL_MIN,
  MIN_QUOTA_PROBE_GAP_MS,
  LANE_A_SEQUENCE,
  LANE_B_TASKS,
  EST_CL_REQUESTS_PER_CASE,
  createInitialState,
  restoreState,
  cloneState,
  remainingRequestsToFinishCourt,
  hasUsefulClCapacity,
  projectNextQuotaCheck,
  quotaProbeDue,
  decideLane,
  applyQuotaSnapshot,
  applyQuotaFloorTransition,
  applyQuotaRecoveryTransition,
  recordLaneSwitch,
  acquireLaneALock,
  releaseLaneALock,
  recordLaneTime,
  completeLaneBTask,
  isCourtListenerUrl,
  isBlockedLaneBCourtListenerUrl,
  assertLaneBUrlAllowed,
  installLaneBFetchGuard,
  uninstallLaneBFetchGuard,
  uniqueCitationEdgeKey,
  uniqueEmbeddingKey,
  insertUnique,
  classifyDepth,
  detectHistoricalHoles,
  parseUsReportsCitation,
  rankMissingUsReports,
  classifyIntermediateCandidate,
  researchIntermediateGaps,
  KNOWN_INTERMEDIATE_GAPS,
  logLaneEvent,
  sha256,
  persistLaneAProgress,
  applyDurableJobCheckpoint,
  validatePartialCheckpoint,
  reconcileLaneAFromJob,
  setHumanReview,
  isPartialLaneA,
  hasDurableCheckpoint,
  HUMAN_REVIEW_REASONS,
};
