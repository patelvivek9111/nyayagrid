/**
 * Queue #2 autonomous worker production safety gate.
 * Deterministic — zero AI. Does not start the worker.
 */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  scoreLaneATarget,
  US_JURISDICTIONS,
  FEDERAL_TARGETS,
  loadOfflineTaskRegistry,
  loadCompletionChecklist,
  neverOpenQueue3,
  assertArkCheckpointIntact,
  detectSystemResume,
  SLEEP_GAP_MS,
  MANIFEST_PATH,
  persistLaneAManifest,
  readJson,
  writeJson,
  REGISTRY_PATH,
  CHECKLIST_PATH,
} = require("./queue2-autonomy-policy.cjs");
const { LANE_A_SEQUENCE, HUMAN_REVIEW_REASONS, restoreState } = require("./queue2-dual-lane-controller.cjs");
const { classifyLock, readLockFile, lockPathFor, defaultReportsDir } = require("./queue2-worker-lock.cjs");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages", "research", "corpus", "reports");
const CONFIG = path.join(ROOT, "packages", "research", "corpus", "config");
const SAFETY_CONFIG_PATH = path.join(CONFIG, "queue2-worker-safety.json");
const SNAPSHOT_PATH = path.join(REPORTS, "queue2-lane-a-corpus-snapshot.json");
const IDEMPOTENCY_LEDGER_PATH = path.join(REPORTS, "queue2-idempotency-ledger.jsonl");
const AUDIT_PATH = path.join(REPORTS, "queue2-worker-audit.jsonl");
const STATE_PATH = path.join(REPORTS, "queue2-dual-lane-state.json");
const VERSION_PATH = path.join(REPORTS, "queue2-worker-versions.json");

const WORKER_VERSION = "queue2-safety-gate-1";
const CHECKPOINT_SCHEMA_VERSION = 1;
const CORPUS_SCHEMA_VERSION = 1;

function defaultSafetyConfig() {
  return {
    schemaVersion: 1,
    killSwitchEnv: "QUEUE2_WORKER_ENABLED",
    budgets: {
      laneA: {
        maxClRequestsPerBatch: 40,
        maxAuthoritiesPerBatch: 25,
        maxRuntimeMs: 20 * 60 * 1000,
        maxDbMutationsPerBatch: 200,
        maxBytesPerBatch: 25_000_000,
      },
      horizon: {
        maxExternalRequests: 200,
        maxNewAuthorities: 100,
        maxActiveRuntimeMs: 60 * 60 * 1000,
      },
      resources: {
        minFreeDiskBytes: 2 * 1024 * 1024 * 1024,
        minTempFreeBytes: 512 * 1024 * 1024,
      },
      backpressure: {
        pendingChunksMax: 5000,
        pendingEmbeddingsMax: 5000,
        citationBacklogMax: 20000,
        failedIngestJobsMax: 25,
      },
    },
    circuitBreakers: {
      courtlistener: { maxFailures: 3, cooldownMs: 30 * 60 * 1000 },
      nonClPrimary: { maxFailures: 5, cooldownMs: 15 * 60 * 1000 },
      database: { maxFailures: 3, cooldownMs: 5 * 60 * 1000 },
      storage: { maxFailures: 3, cooldownMs: 10 * 60 * 1000 },
      embeddings: { maxFailures: 5, cooldownMs: 15 * 60 * 1000 },
      citations: { maxFailures: 5, cooldownMs: 15 * 60 * 1000 },
      retrieval: { maxFailures: 3, cooldownMs: 15 * 60 * 1000 },
    },
    sourceContracts: {
      courtlistener: {
        requiredFields: ["id", "cluster", "court", "date_filed"],
        paginationShape: ["next", "results"],
      },
    },
  };
}

function loadSafetyConfig() {
  const existing = readJson(SAFETY_CONFIG_PATH);
  if (existing) return { ...defaultSafetyConfig(), ...existing, budgets: { ...defaultSafetyConfig().budgets, ...(existing.budgets || {}) } };
  const cfg = defaultSafetyConfig();
  writeJson(SAFETY_CONFIG_PATH, cfg);
  return cfg;
}

/** Kill switch: only QUEUE2_WORKER_ENABLED=1 allows mutation. */
function isWorkerEnabled(env = process.env) {
  return String(env.QUEUE2_WORKER_ENABLED || "") === "1";
}

function killSwitchStatus(env = process.env) {
  if (isWorkerEnabled(env)) return { enabled: true, code: null };
  return { enabled: false, code: "QUEUE2_WORKER_DISABLED" };
}

function operationIdCl(sourceId) {
  return `queue2:cl:${String(sourceId)}`;
}
function operationIdNonCl(source, canonicalId, versionOrHash) {
  return `queue2:${source}:${canonicalId}:${versionOrHash}`;
}
function operationIdCitation(sourceAuthority, targetCitation, resolverVersion) {
  return `queue2:citation:${sourceAuthority}:${targetCitation}:${resolverVersion}`;
}
function operationIdChunk(authorityId, contentHash, chunkIndex) {
  return `queue2:chunk:${authorityId}:${contentHash}:${chunkIndex}`;
}

function readIdempotencyLedger(filePath = IDEMPOTENCY_LEDGER_PATH) {
  if (!fs.existsSync(filePath)) return new Set();
  const set = new Set();
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean)) {
    try {
      const row = JSON.parse(line);
      if (row.operationId && row.status === "committed") set.add(row.operationId);
    } catch {
      /* skip */
    }
  }
  return set;
}

function appendIdempotencyRecord(record, filePath = IDEMPOTENCY_LEDGER_PATH) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify({ ...record, at: record.at || new Date().toISOString() })}\n`);
}

function hasCommittedOperation(operationId, ledger = readIdempotencyLedger()) {
  return ledger.has(operationId);
}

/**
 * Atomic checkpoint rule: only advance after durable mutation commit.
 * Simulates / enforces ordering for tests and callers.
 */
function advanceCheckpointSafely(params) {
  const { priorCheckpoint, mutationCommitted, nextCheckpoint } = params;
  if (!mutationCommitted) {
    return { advanced: false, checkpoint: priorCheckpoint, reason: "mutation_not_committed" };
  }
  if (!nextCheckpoint) {
    return { advanced: false, checkpoint: priorCheckpoint, reason: "missing_next_checkpoint" };
  }
  return { advanced: true, checkpoint: nextCheckpoint, reason: "durable_commit_verified" };
}

function appendAuditEvent(event, filePath = AUDIT_PATH) {
  const row = {
    eventId: event.eventId || crypto.randomBytes(8).toString("hex"),
    timestamp: event.timestamp || new Date().toISOString(),
    workerId: event.workerId || null,
    workerVersion: event.workerVersion || WORKER_VERSION,
    lane: event.lane || null,
    task: event.task || null,
    operationId: event.operationId || null,
    jurisdiction: event.jurisdiction || null,
    court: event.court || null,
    priorCheckpoint: event.priorCheckpoint || null,
    resultingCheckpoint: event.resultingCheckpoint || null,
    source: event.source || null,
    inputHash: event.inputHash || null,
    recordsAttempted: event.recordsAttempted ?? null,
    recordsAdded: event.recordsAdded ?? null,
    recordsSkippedIdempotent: event.recordsSkippedIdempotent ?? null,
    failure: event.failure || null,
    nextActionReason: event.nextActionReason || null,
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // Append-only: never rewrite prior lines
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`);
  return row;
}

function fingerprintProductionFiles(root = ROOT) {
  const files = [
    "scripts/run-queue2-dual-lane.cjs",
    "scripts/queue2-dual-lane-controller.cjs",
    "scripts/queue2-worker-observability.cjs",
    "scripts/queue2-worker-lock.cjs",
    "scripts/queue2-autonomy-policy.cjs",
    "scripts/queue2-worker-safety.cjs",
    "packages/research/corpus/config/queue2-offline-task-registry.json",
    "packages/research/corpus/config/queue2-completion-checklist.json",
    "packages/research/corpus/config/queue2-worker-safety.json",
  ];
  const h = crypto.createHash("sha256");
  for (const rel of files) {
    const p = path.join(root, rel);
    h.update(rel);
    h.update("\0");
    if (fs.existsSync(p)) h.update(fs.readFileSync(p));
    h.update("\0");
  }
  return h.digest("hex");
}

function detectCodeChange(startedFingerprint, root = ROOT) {
  const now = fingerprintProductionFiles(root);
  if (!startedFingerprint) return { changed: false, fingerprint: now };
  if (now !== startedFingerprint) {
    return { changed: true, code: "CODE_CHANGE_DETECTED", fingerprint: now, prior: startedFingerprint };
  }
  return { changed: false, fingerprint: now };
}

function detectClockAnomaly(params = {}) {
  const now = params.now instanceof Date ? params.now : new Date(params.now || Date.now());
  const last = params.lastSeenAt ? new Date(params.lastSeenAt) : null;
  if (!last || Number.isNaN(last.getTime())) return { anomaly: false };
  const delta = now.getTime() - last.getTime();
  if (delta < -60_000) {
    return { anomaly: true, kind: "backwards_clock_jump", deltaMs: delta, event: "CLOCK_REVALIDATION" };
  }
  if (delta > SLEEP_GAP_MS) {
    const resume = detectSystemResume(params.lastSeenAt, now);
    return {
      anomaly: true,
      kind: resume.probableSuspend ? "suspend_or_forward_jump" : "forward_clock_jump",
      deltaMs: delta,
      event: "CLOCK_REVALIDATION",
      probableSuspend: resume.probableSuspend,
    };
  }
  return { anomaly: false, deltaMs: delta };
}

function freeDiskBytes(dirPath = ROOT) {
  try {
    if (typeof fs.statfsSync === "function") {
      const s = fs.statfsSync(dirPath);
      return Number(s.bavail) * Number(s.bsize);
    }
  } catch {
    /* fall through */
  }
  return null; // UNKNOWN — do not invent
}

function evaluateResourceGuards(cfg = loadSafetyConfig(), opts = {}) {
  const free = opts.freeDiskBytes != null ? opts.freeDiskBytes : freeDiskBytes(opts.dirPath || ROOT);
  const tempFree = opts.tempFreeBytes != null ? opts.tempFreeBytes : freeDiskBytes(os.tmpdir());
  const reasons = [];
  if (free == null) {
    /* unknown: do not fail solely on missing platform support; callers may inject */
  } else if (free < cfg.budgets.resources.minFreeDiskBytes) {
    reasons.push("LOW_DISK");
  }
  if (tempFree != null && tempFree < cfg.budgets.resources.minTempFreeBytes) {
    reasons.push("LOW_TEMP_SPACE");
  }
  if (opts.dbReachable === false) reasons.push("DB_UNAVAILABLE");
  if (opts.storageReachable === false) reasons.push("STORAGE_UNAVAILABLE");
  return {
    ok: reasons.length === 0,
    reasons,
    freeDiskBytes: free,
    tempFreeBytes: tempFree,
  };
}

function evaluateBackpressure(metrics = {}, cfg = loadSafetyConfig()) {
  const b = cfg.budgets.backpressure;
  const reasons = [];
  if (Number(metrics.pendingChunks || 0) > b.pendingChunksMax) reasons.push("pending_chunks");
  if (Number(metrics.pendingEmbeddings || 0) > b.pendingEmbeddingsMax) reasons.push("pending_embeddings");
  if (Number(metrics.citationBacklog || 0) > b.citationBacklogMax) reasons.push("citation_backlog");
  if (Number(metrics.failedIngestJobs || 0) > b.failedIngestJobsMax) reasons.push("failed_ingest_jobs");
  return {
    pause: reasons.length > 0,
    code: reasons.length ? "BACKPRESSURE_PAUSE" : null,
    reasons,
  };
}

function createCircuitBreaker(name, cfg) {
  return {
    name,
    state: "closed",
    failures: 0,
    openedAt: null,
    maxFailures: cfg.maxFailures,
    cooldownMs: cfg.cooldownMs,
  };
}

function recordCircuitFailure(breaker, now = new Date()) {
  const next = { ...breaker, failures: breaker.failures + 1 };
  if (next.failures >= next.maxFailures) {
    next.state = "open";
    next.openedAt = now.toISOString();
  }
  return next;
}

function recordCircuitSuccess(breaker) {
  return { ...breaker, failures: 0, state: "closed", openedAt: null };
}

function mayUseCircuit(breaker, now = new Date()) {
  if (breaker.state !== "open") return { allowed: true, breaker };
  const opened = breaker.openedAt ? new Date(breaker.openedAt).getTime() : 0;
  if (now.getTime() - opened >= breaker.cooldownMs) {
    return { allowed: true, breaker: { ...breaker, state: "half-open" } };
  }
  return { allowed: false, breaker, reason: "circuit_open" };
}

function validateSourceContract(source, payload, contracts = loadSafetyConfig().sourceContracts) {
  const contract = contracts[source];
  if (!contract) return { ok: false, reason: "unknown_source_contract" };
  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: "SOURCE_CONTRACT_CHANGED", detail: "payload_missing" };
  }
  for (const field of contract.requiredFields || []) {
    if (!(field in payload) && !(payload.results && payload.results[0] && field in payload.results[0])) {
      // allow list payload with results[0]
      const sample = Array.isArray(payload.results) ? payload.results[0] : null;
      if (!sample || !(field in sample)) {
        return { ok: false, reason: "SOURCE_CONTRACT_CHANGED", detail: `missing_${field}` };
      }
    }
  }
  return { ok: true };
}

function courtToJurisdiction(court) {
  const row = US_JURISDICTIONS.find((u) => u.court === court);
  return row ? row.j : null;
}

/**
 * Rebuild Lane A manifest from live corpus snapshot (never invent zeros).
 */
function rebuildLaneAManifestFromSnapshot(snapshot, opts = {}) {
  if (!snapshot || !snapshot.ok || !Array.isArray(snapshot.jurisdictions)) {
    throw Object.assign(new Error("LANE_A_MANIFEST_CORPUS_MISMATCH"), {
      code: "LANE_A_MANIFEST_CORPUS_MISMATCH",
      detail: "snapshot_missing",
    });
  }
  const byJ = Object.fromEntries(snapshot.jurisdictions.map((r) => [r.j, r]));
  const knownGood = opts.knownGoodBaseline || {};
  const targets = [];
  let unknownCount = 0;
  let falseZeroBlocked = 0;

  for (const row of US_JURISDICTIONS) {
    const live = byJ[row.j];
    const seq = LANE_A_SEQUENCE.find((s) => s.court === row.court);
    const targetCases = seq ? seq.target : 45;
    let currentCases = live ? Number(live.cases) : null;
    let currentAuthorities = live ? Number(live.authorities) : null;
    let status;
    let mappingStatus = seq ? "VERIFIED" : live ? "VERIFIED" : "UNKNOWN";
    let blocked = false;

    if (live == null) {
      currentCases = null;
      currentAuthorities = null;
      status = "HUMAN_REVIEW_REQUIRED";
      mappingStatus = "UNKNOWN";
      blocked = true;
      unknownCount += 1;
    } else {
      // Never treat unknown as zero — live object present means real counts.
      if (knownGood[row.j]?.cases != null && currentCases === 0 && knownGood[row.j].cases > 0) {
        blocked = true;
        falseZeroBlocked += 1;
        status = "HUMAN_REVIEW_REQUIRED";
      } else if (currentCases >= targetCases) {
        status = "COMPLETE_FOR_CURRENT_DEPTH";
      } else if (row.court === "ark" || (currentCases > 0 && opts.checkpoints?.[row.court])) {
        status = "PARTIAL";
      } else {
        status = "READY";
      }
    }

    const checkpoint =
      row.court === "ark"
        ? opts.arkCheckpoint || "cl-opinion-9885161"
        : opts.checkpoints?.[row.court] || null;

    // Do not overfeed jurisdictions that already meet current high-court depth target.
    const overfeedBlock = status === "COMPLETE_FOR_CURRENT_DEPTH";

    const entry = {
      jurisdiction: row.j,
      name: row.name,
      preferredCourts: [row.court],
      currentAuthorities,
      currentCases,
      clCases: live ? live.clCases : null,
      highCourtCount: live ? live.highCourt : null,
      intermediateAppellateCount: live ? live.intermediate : null,
      earliestYear: live ? live.oldest : null,
      latestYear: live ? live.newest : null,
      targetCases,
      targetDelta: currentCases == null ? null : Math.max(0, targetCases - currentCases),
      missingCourtLayers: live && live.intermediate === 0 && !["DC"].includes(row.j) ? ["intermediate"] : [],
      historicalGaps: live && live.oldest != null && live.oldest >= 2020 ? ["pre-2000", "historical_thin"] : [],
      doctrinalGaps: [],
      citationDemand: live ? live.citationTargetAbsent : null,
      citationTargetAbsent: live ? live.citationTargetAbsent : null,
      requestEfficiency: 2.3,
      authorityDeficit: currentAuthorities == null ? null : Math.max(0, 101 - currentAuthorities),
      historicalGapScore: live && live.oldest != null && live.oldest >= 2020 ? 40 : live ? 10 : null,
      doctrinalGapScore: live ? 5 : null,
      checkpoint,
      mappingStatus,
      status,
      autonomousIngestBlocked: blocked || mappingStatus === "UNKNOWN" || overfeedBlock,
      dataQuality: live ? "LIVE_DB" : "UNKNOWN",
      score: 0,
    };
    if (!entry.autonomousIngestBlocked && entry.authorityDeficit != null) {
      entry.score = scoreLaneATarget(entry);
      // Prefer resuming verified partial checkpoints.
      if (status === "PARTIAL" && checkpoint) entry.score += 500;
    } else {
      entry.score = Number.NEGATIVE_INFINITY;
    }
    targets.push(entry);
  }

  // Federal aggregate from US row — do not invent per-circuit zeros.
  const us = byJ.US;
  for (const fed of FEDERAL_TARGETS) {
    const blocked = !us;
    const entry = {
      jurisdiction: fed.j,
      name: fed.name,
      preferredCourts: [fed.court],
      currentAuthorities: us ? us.authorities : null,
      currentCases: us ? us.cases : null,
      clCases: us ? us.clCases : null,
      highCourtCount: us ? us.highCourt : null,
      intermediateAppellateCount: us ? us.intermediate : null,
      earliestYear: us ? us.oldest : null,
      latestYear: us ? us.newest : null,
      targetCases: fed.layer === "high" ? 80 : 40,
      targetDelta: null,
      missingCourtLayers: fed.layer === "appellate" ? [] : [],
      historicalGaps: [],
      doctrinalGaps: [],
      citationDemand: us ? us.citationTargetAbsent : null,
      citationTargetAbsent: us ? us.citationTargetAbsent : null,
      requestEfficiency: 2.3,
      authorityDeficit: us ? Math.max(0, 101 - us.authorities) : null,
      historicalGapScore: us ? 5 : null,
      doctrinalGapScore: us ? 5 : null,
      checkpoint: null,
      mappingStatus: us ? "VERIFIED" : "UNKNOWN",
      status: us ? "READY" : "HUMAN_REVIEW_REQUIRED",
      autonomousIngestBlocked: blocked,
      dataQuality: us ? "LIVE_DB_FEDERAL_AGGREGATE" : "UNKNOWN",
      federal: true,
      layer: fed.layer,
      score: us ? 10 : Number.NEGATIVE_INFINITY,
      note: "Per-circuit counts not separately projected; US aggregate used. UNKNOWN avoided.",
    };
    targets.push(entry);
  }

  targets.sort((a, b) => {
    if (a.autonomousIngestBlocked !== b.autonomousIngestBlocked) {
      return a.autonomousIngestBlocked ? 1 : -1;
    }
    return b.score - a.score || String(a.jurisdiction).localeCompare(String(b.jurisdiction));
  });

  const arkLive = byJ.AR;
  const manifest = {
    schemaVersion: 1,
    queue: "#2",
    queue3: "NOT_OPEN",
    featureAgents: "0",
    version: Number(opts.version || 2),
    generatedAt: new Date().toISOString(),
    source: {
      type: "live_db_snapshot",
      snapshotPath: "packages/research/corpus/reports/queue2-lane-a-corpus-snapshot.json",
      snapshotGeneratedAt: snapshot.generatedAt,
      mutationsDuringSnapshot: snapshot.mutations,
    },
    rankingPolicy: [
      "authority-depth weakness",
      "missing appellate layer",
      "historical gaps",
      "doctrinal gaps",
      "citation TARGET_ABSENT demand",
      "request efficiency tiebreaker",
      "UNKNOWN never ranked as zero",
    ],
    scope: { states: 50, dc: true, federal: true, overfeedStrongJurisdictions: false },
    corpusTotals: snapshot.corpus,
    reconciliation: null,
    activePartial: {
      court: "ark",
      jurisdiction: "AR",
      count: arkLive ? arkLive.cases : null,
      target: 45,
      checkpoint: opts.arkCheckpoint || "cl-opinion-9885161",
      status: arkLive && Number(arkLive.cases) >= 45 ? "COMPLETE_FOR_CURRENT_DEPTH" : "PARTIAL",
      mappingStatus: "VERIFIED",
      dataQuality: "LIVE_DB",
    },
    unknownCount,
    falseZeroBlocked,
    targets,
  };

  manifest.reconciliation = reconcileManifestWithSnapshot(manifest, snapshot, opts);
  return manifest;
}

function reconcileManifestWithSnapshot(manifest, snapshot, opts = {}) {
  const reasons = [];
  const byJ = Object.fromEntries((snapshot.jurisdictions || []).map((r) => [r.j, r]));
  const expectedJ = US_JURISDICTIONS.map((u) => u.j);
  for (const j of expectedJ) {
    if (!byJ[j]) reasons.push(`missing_jurisdiction_${j}`);
  }
  // Known jurisdictions with baseline cases must not show zero in manifest
  for (const t of manifest.targets.filter((x) => !x.federal)) {
    const live = byJ[t.jurisdiction];
    if (live && live.cases > 0 && t.currentCases === 0) {
      reasons.push(`false_zero_${t.jurisdiction}`);
    }
    if (live && t.currentCases !== live.cases) {
      reasons.push(`case_mismatch_${t.jurisdiction}`);
    }
    if (live && t.currentAuthorities !== live.authorities) {
      reasons.push(`authority_mismatch_${t.jurisdiction}`);
    }
  }
  const ark = manifest.activePartial;
  if (ark.count == null || ark.count < 33) reasons.push("ark_count_regressed_below_33");
  if (ark.target !== 45) reasons.push("ark_target_not_45");
  if (ark.checkpoint !== (opts.arkCheckpoint || "cl-opinion-9885161")) reasons.push("ark_checkpoint_mismatch");
  if (snapshot.arkCases != null && snapshot.arkCases !== ark.count) reasons.push("snapshot_ark_mismatch");
  if (snapshot.arkCases != null && snapshot.arkCases < 33) reasons.push("snapshot_ark_regressed_below_33");

  const sumCases = manifest.targets.filter((t) => !t.federal && t.currentCases != null).reduce((a, t) => a + t.currentCases, 0);
  // US counted once in jurisdictions; federal rows are aggregate annotations
  const snapSum = (snapshot.jurisdictions || [])
    .filter((r) => r.j !== "US")
    .reduce((a, r) => a + Number(r.cases || 0), 0);
  const usCases = byJ.US ? byJ.US.cases : 0;
  const expectedTotalCases = snapSum + usCases;
  if (snapshot.corpus?.cases != null && Math.abs(Number(snapshot.corpus.cases) - expectedTotalCases) > 0) {
    // allow only exact jurisdiction rollup vs corpus
    reasons.push(`corpus_case_rollup_mismatch:${snapshot.corpus.cases}!=${expectedTotalCases}`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
    aggregateManifestStateCases: sumCases,
    aggregateSnapshotCases: expectedTotalCases,
    corpusCases: snapshot.corpus?.cases ?? null,
    jurisdictionsPresent: (snapshot.jurisdictions || []).length,
    unknownCount: manifest.unknownCount,
    falseZeroBlocked: manifest.falseZeroBlocked,
  };
}

function validateManifestForLaneA(manifest) {
  if (!manifest?.reconciliation?.ok) {
    return {
      ok: false,
      code: "LANE_A_MANIFEST_CORPUS_MISMATCH",
      reasons: manifest?.reconciliation?.reasons || ["reconciliation_missing"],
    };
  }
  if (manifest.unknownCount > 0) {
    return { ok: false, code: "LANE_A_MANIFEST_CORPUS_MISMATCH", reasons: ["unknown_entries_present"] };
  }
  if (manifest.falseZeroBlocked > 0) {
    return { ok: false, code: "LANE_A_MANIFEST_CORPUS_MISMATCH", reasons: ["false_zero_blocked"] };
  }
  try {
    assertArkCheckpointIntact(manifest);
  } catch (e) {
    return { ok: false, code: "LANE_A_MANIFEST_CORPUS_MISMATCH", reasons: [e.message] };
  }
  return { ok: true };
}

function loadVersions() {
  return (
    readJson(VERSION_PATH) || {
      workerVersion: WORKER_VERSION,
      configVersion: 1,
      laneAManifestVersion: 0,
      laneBRegistryVersion: 1,
      checkpointSchemaVersion: CHECKPOINT_SCHEMA_VERSION,
      corpusSchemaVersion: CORPUS_SCHEMA_VERSION,
      codeFingerprint: null,
    }
  );
}

function checkVersionCompatibility(running = {}, persisted = loadVersions()) {
  const reasons = [];
  if (persisted.checkpointSchemaVersion != null && persisted.checkpointSchemaVersion !== CHECKPOINT_SCHEMA_VERSION) {
    reasons.push("checkpointSchemaVersion");
  }
  if (persisted.corpusSchemaVersion != null && persisted.corpusSchemaVersion !== CORPUS_SCHEMA_VERSION) {
    reasons.push("corpusSchemaVersion");
  }
  if (running.workerVersion && persisted.workerVersion && running.workerVersion !== persisted.workerVersion) {
    // allow forward bump if explicit; mismatch without migration blocks
    if (!running.allowWorkerBump) reasons.push("workerVersion");
  }
  return {
    ok: reasons.length === 0,
    code: reasons.length ? "WORKER_STATE_VERSION_MISMATCH" : null,
    reasons,
  };
}

function evaluateHorizon(counters = {}, cfg = loadSafetyConfig()) {
  const h = cfg.budgets.horizon;
  const hit =
    Number(counters.externalRequests || 0) >= h.maxExternalRequests ||
    Number(counters.newAuthorities || 0) >= h.maxNewAuthorities ||
    Number(counters.activeRuntimeMs || 0) >= h.maxActiveRuntimeMs;
  return { boundary: hit, code: hit ? "SELF_CHECK_BOUNDARY" : null };
}

function runSelfCheck(signals = {}) {
  const reasons = [];
  if (Number(signals.orphanCount || 0) > 0) reasons.push("orphans");
  if (Number(signals.duplicateSourceIdCount || 0) > 0) reasons.push("duplicate_source_ids");
  if (signals.manifestOk === false) reasons.push("manifest");
  if (signals.checkpointOk === false) reasons.push("checkpoint");
  if (signals.retrievalOk === false) reasons.push("retrieval");
  if (signals.backpressurePause) reasons.push("backpressure");
  if (signals.resourcesOk === false) reasons.push("resources");
  if (signals.circuitOpen) reasons.push("circuit_open");
  return {
    ok: reasons.length === 0,
    reasons,
    humanReview: reasons.length > 0,
  };
}

/**
 * Mandatory preflight — ZERO corpus mutations.
 */
function runPreflight(opts = {}) {
  const env = opts.env || process.env;
  const cfg = opts.safetyConfig || loadSafetyConfig();
  const reasons = [];
  const mutations = 0;

  const ks = killSwitchStatus(env);
  if (!ks.enabled && !opts.allowDisabledForDryRun) reasons.push("QUEUE2_WORKER_DISABLED");

  // Queue rules
  reasons.push; // no-op keep lint calm
  if (opts.queue2Open === false) reasons.push("QUEUE_2_NOT_OPEN");
  if (opts.queue3Open === true) reasons.push("QUEUE_3_OPEN_FORBIDDEN");
  if (String(env.FEATURE_AGENTS || opts.featureAgents || "0") !== "0") reasons.push("FEATURE_AGENTS_NOT_0");

  // Registry / checklist
  try {
    const reg = loadOfflineTaskRegistry();
    if (reg.aiPlannerAllowed) reasons.push("AI_PLANNER_ENABLED");
    if (!Array.isArray(reg.tasks) || reg.tasks.length < 1) reasons.push("LANE_B_REGISTRY_INVALID");
  } catch (e) {
    reasons.push(`LANE_B_REGISTRY_INVALID:${e.message}`);
  }
  try {
    const cl = loadCompletionChecklist();
    if (cl.queue3AutoOpen) reasons.push("CHECKLIST_OPENS_QUEUE3");
  } catch (e) {
    reasons.push(`CHECKLIST_INVALID:${e.message}`);
  }

  // Scheduler / AR checkpoint
  const state = opts.state || (fs.existsSync(STATE_PATH) ? restoreState(JSON.parse(fs.readFileSync(STATE_PATH, "utf8"))) : null);
  if (state) {
    try {
      assertArkCheckpointIntact(state);
    } catch (e) {
      reasons.push(`CHECKPOINT:${e.message}`);
    }
    if (state.humanReview?.required) reasons.push("PENDING_HUMAN_REVIEW");
    const st = neverOpenQueue3(state);
    if (st.queue3 !== "NOT_OPEN") reasons.push("QUEUE_3_NOT_CLOSED");
  } else {
    reasons.push("SCHEDULER_STATE_MISSING");
  }

  // Manifest reconciliation
  const snapshot = opts.snapshot || readJson(SNAPSHOT_PATH);
  const manifest = opts.manifest || readJson(MANIFEST_PATH);
  if (!snapshot?.ok) reasons.push("CORPUS_SNAPSHOT_MISSING");
  if (!manifest) reasons.push("LANE_A_MANIFEST_MISSING");
  if (snapshot?.ok && manifest) {
    const recon = manifest.reconciliation || reconcileManifestWithSnapshot(manifest, snapshot, opts);
    if (!recon.ok) {
      reasons.push("LANE_A_MANIFEST_CORPUS_MISMATCH");
      for (const r of recon.reasons.slice(0, 10)) reasons.push(`manifest:${r}`);
    }
    const v = validateManifestForLaneA({ ...manifest, reconciliation: recon });
    if (!v.ok) reasons.push(v.code);
  }

  // Adaptive quota config
  try {
    const { validateAdaptiveQuotaConfig, loadAdaptiveQuotaConfig } = require("./cl-adaptive-quota.cjs");
    const aq = validateAdaptiveQuotaConfig(opts.adaptiveQuota || loadAdaptiveQuotaConfig({ config: cfg }));
    if (!aq.ok) {
      for (const r of aq.reasons) reasons.push(r);
    }
  } catch (e) {
    reasons.push(`ADAPTIVE_QUOTA_CONFIG_INVALID:${e.message}`);
  }

  // Lock
  const lockPath = opts.lockPath || lockPathFor(opts.reportsDir || defaultReportsDir());
  const lock = readLockFile(lockPath);
  const classified = classifyLock(lock, {
    now: opts.now || new Date(),
    workerId: opts.workerId || null,
    isPidAlive: opts.isPidAlive,
  });
  if (classified.status === "ACTIVE" && opts.workerId && lock?.workerId !== opts.workerId) {
    reasons.push("QUEUE2_WORKER_ACTIVE");
  }

  // Versions
  const ver = checkVersionCompatibility(
    { workerVersion: opts.workerVersion || WORKER_VERSION, allowWorkerBump: true },
    opts.persistedVersions || loadVersions(),
  );
  if (!ver.ok) reasons.push(ver.code);

  // Resources
  const res = evaluateResourceGuards(cfg, {
    freeDiskBytes: opts.freeDiskBytes,
    tempFreeBytes: opts.tempFreeBytes,
    dbReachable: opts.dbReachable,
    storageReachable: opts.storageReachable,
  });
  if (!res.ok) reasons.push(...res.reasons);

  // Integrity signals from snapshot
  if (snapshot && Number(snapshot.orphans || 0) > 0) reasons.push("ORPHAN_CHUNKS");
  if (snapshot && Number(snapshot.duplicateSourceIds || 0) > 0) reasons.push("DUPLICATE_SOURCE_IDS");

  // CL credential presence (boolean only)
  const clKeyPresent = Boolean(env.COURTLISTENER_API_KEY || opts.courtListenerKeyPresent);
  // Network optional
  if (opts.networkRequired && opts.networkOk === false) reasons.push("NETWORK_UNAVAILABLE");

  // Clock sanity
  if (opts.lastSeenAt) {
    const clock = detectClockAnomaly({ lastSeenAt: opts.lastSeenAt, now: opts.now || new Date() });
    if (clock.anomaly && clock.kind === "backwards_clock_jump") reasons.push("CLOCK_BACKWARDS");
  }

  const uniqueReasons = [...new Set(reasons)];
  // For dry preflight documentation, kill switch may be reported separately
  const pass = uniqueReasons.length === 0;

  return {
    ok: pass,
    result: pass ? "PREFLIGHT_PASS" : "PREFLIGHT_FAIL",
    reasons: uniqueReasons,
    mutations,
    courtListenerHttpCalls: 0,
    aiCalls: 0,
    aiTokens: 0,
    killSwitch: ks,
    clCredentialPresent: clKeyPresent,
    featureAgents: String(env.FEATURE_AGENTS || "0"),
    queue: { "#2": "OPEN", "#9": "CLOSED", "#3": "NOT_OPEN" },
    ark: state?.laneA
      ? { count: state.laneA.count, target: state.laneA.target, checkpoint: state.laneA.checkpoint }
      : null,
    resource: res,
    generatedAt: new Date().toISOString(),
  };
}

function topRankedLaneATargets(manifest, n = 10) {
  return (manifest.targets || [])
    .filter((t) => !t.federal && !t.autonomousIngestBlocked)
    .slice(0, n)
    .map((t) => ({
      jurisdiction: t.jurisdiction,
      currentCases: t.currentCases,
      target: t.targetCases,
      missingLayer: (t.missingCourtLayers || [])[0] || null,
      mappingStatus: t.mappingStatus,
      score: t.score,
      status: t.status,
      authorities: t.currentAuthorities,
    }));
}

module.exports = {
  WORKER_VERSION,
  CHECKPOINT_SCHEMA_VERSION,
  CORPUS_SCHEMA_VERSION,
  SAFETY_CONFIG_PATH,
  SNAPSHOT_PATH,
  IDEMPOTENCY_LEDGER_PATH,
  AUDIT_PATH,
  VERSION_PATH,
  defaultSafetyConfig,
  loadSafetyConfig,
  isWorkerEnabled,
  killSwitchStatus,
  operationIdCl,
  operationIdNonCl,
  operationIdCitation,
  operationIdChunk,
  readIdempotencyLedger,
  appendIdempotencyRecord,
  hasCommittedOperation,
  advanceCheckpointSafely,
  appendAuditEvent,
  fingerprintProductionFiles,
  detectCodeChange,
  detectClockAnomaly,
  freeDiskBytes,
  evaluateResourceGuards,
  evaluateBackpressure,
  createCircuitBreaker,
  recordCircuitFailure,
  recordCircuitSuccess,
  mayUseCircuit,
  validateSourceContract,
  courtToJurisdiction,
  rebuildLaneAManifestFromSnapshot,
  reconcileManifestWithSnapshot,
  validateManifestForLaneA,
  loadVersions,
  checkVersionCompatibility,
  evaluateHorizon,
  runSelfCheck,
  runPreflight,
  topRankedLaneATargets,
  persistLaneAManifest,
  MANIFEST_PATH,
  REPORTS,
  HUMAN_REVIEW_REASONS,
};
