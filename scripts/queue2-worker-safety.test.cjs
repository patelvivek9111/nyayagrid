/**
 * Queue #2 production safety gate tests (deterministic — no worker start, no CL quota).
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  rebuildLaneAManifestFromSnapshot,
  reconcileManifestWithSnapshot,
  validateManifestForLaneA,
  topRankedLaneATargets,
  killSwitchStatus,
  isWorkerEnabled,
  operationIdCl,
  operationIdNonCl,
  operationIdCitation,
  operationIdChunk,
  hasCommittedOperation,
  appendIdempotencyRecord,
  readIdempotencyLedger,
  advanceCheckpointSafely,
  runPreflight,
  evaluateBackpressure,
  evaluateResourceGuards,
  evaluateHorizon,
  runSelfCheck,
  detectCodeChange,
  detectClockAnomaly,
  fingerprintProductionFiles,
  validateSourceContract,
  createCircuitBreaker,
  recordCircuitFailure,
  mayUseCircuit,
  appendAuditEvent,
  checkVersionCompatibility,
  WORKER_VERSION,
  defaultSafetyConfig,
} = require("./queue2-worker-safety.cjs");
const { heartbeatImpliesGitCommit } = require("./queue2-worker-lock.cjs");
const { neverOpenQueue3 } = require("./queue2-autonomy-policy.cjs");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const SNAPSHOT = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../packages/research/corpus/reports/queue2-lane-a-corpus-snapshot.json"),
    "utf8",
  ),
);

test("known jurisdiction with cases cannot emit currentCases=0", () => {
  const m = rebuildLaneAManifestFromSnapshot(SNAPSHOT, {
    arkCheckpoint: "cl-opinion-9885161",
    knownGoodBaseline: { AR: { cases: 33 }, CA: { cases: 37 } },
  });
  const arLive = SNAPSHOT.jurisdictions.find((r) => r.j === "AR");
  const caLive = SNAPSHOT.jurisdictions.find((r) => r.j === "CA");
  const ar = m.targets.find((t) => t.jurisdiction === "AR");
  const ca = m.targets.find((t) => t.jurisdiction === "CA");
  assert.equal(ar.currentCases, arLive.cases);
  assert.ok(ar.currentCases >= 33);
  assert.notEqual(ar.currentCases, 0);
  assert.equal(ca.currentCases, caLive.cases);
  assert.ok(ca.currentCases > 0);
  assert.equal(ar.currentAuthorities, arLive.authorities);
  assert.notEqual(ar.currentAuthorities, null);
});

test("unknown data emits UNKNOWN/null not zero", () => {
  const sparse = {
    ok: true,
    mutations: 0,
    generatedAt: new Date().toISOString(),
    corpus: { authorities: 10, cases: 5, cl_cases: 5 },
    arkCases: 33,
    orphans: 0,
    duplicateSourceIds: 0,
    jurisdictions: [
      {
        j: "AR",
        authorities: 55,
        cases: 33,
        clCases: 33,
        highCourt: 33,
        intermediate: 0,
        oldest: 1931,
        newest: 2026,
        uniqueCourts: 1,
        citationTargetAbsent: 0,
      },
      // CA missing → UNKNOWN
    ],
  };
  const m = rebuildLaneAManifestFromSnapshot(sparse, { arkCheckpoint: "cl-opinion-9885161" });
  const ca = m.targets.find((t) => t.jurisdiction === "CA");
  assert.equal(ca.currentCases, null);
  assert.equal(ca.currentAuthorities, null);
  assert.equal(ca.mappingStatus, "UNKNOWN");
  assert.equal(ca.autonomousIngestBlocked, true);
  assert.equal(ca.score, Number.NEGATIVE_INFINITY);
});

test("aggregate manifest reconciliation and AR 33/45", () => {
  const m = rebuildLaneAManifestFromSnapshot(SNAPSHOT, { arkCheckpoint: "cl-opinion-9885161" });
  assert.equal(m.reconciliation.ok, true);
  assert.ok(m.activePartial.count >= 33);
  assert.equal(m.activePartial.target, 45);
  assert.equal(m.activePartial.checkpoint, "cl-opinion-9885161");
  assert.equal(m.unknownCount, 0);
  assert.equal(m.falseZeroBlocked, 0);
  assert.equal(validateManifestForLaneA(m).ok, true);
});

test("existing depth preserved; strong jurisdiction not falsely empty", () => {
  const m = rebuildLaneAManifestFromSnapshot(SNAPSHOT, { arkCheckpoint: "cl-opinion-9885161" });
  const ms = m.targets.find((t) => t.jurisdiction === "MS");
  assert.ok(ms.currentCases >= 60);
  assert.equal(ms.status, "COMPLETE_FOR_CURRENT_DEPTH");
  assert.equal(ms.autonomousIngestBlocked, true); // do not overfeed
  const top = topRankedLaneATargets(m, 10);
  assert.ok(top.every((t) => t.currentCases > 0));
  assert.ok(!top.some((t) => t.currentCases === 0));
});

test("manifest mismatch blocks preflight", () => {
  const badManifest = rebuildLaneAManifestFromSnapshot(SNAPSHOT, { arkCheckpoint: "cl-opinion-9885161" });
  badManifest.reconciliation = { ok: false, reasons: ["false_zero_CA"] };
  const pf = runPreflight({
    env: { QUEUE2_WORKER_ENABLED: "1", FEATURE_AGENTS: "0" },
    allowDisabledForDryRun: false,
    snapshot: SNAPSHOT,
    manifest: badManifest,
    state: {
      laneA: { court: "ark", count: 33, target: 45, checkpoint: "cl-opinion-9885161" },
      humanReview: { required: false },
      queue3: "NOT_OPEN",
    },
    dbReachable: true,
    storageReachable: true,
    freeDiskBytes: 10e9,
    tempFreeBytes: 5e9,
  });
  assert.equal(pf.ok, false);
  assert.ok(pf.reasons.some((r) => String(r).includes("LANE_A_MANIFEST_CORPUS_MISMATCH")));
  assert.equal(pf.mutations, 0);
});

test("idempotency keys stable and ledger skip", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "q2-idem-"));
  const ledger = path.join(dir, "ledger.jsonl");
  const id = operationIdCl("cl-opinion-9885161");
  assert.equal(id, "queue2:cl:cl-opinion-9885161");
  assert.match(operationIdNonCl("loc", "us-1", "h1"), /^queue2:loc:/);
  assert.match(operationIdCitation("a", "1 U.S. 1", "v1"), /^queue2:citation:/);
  assert.match(operationIdChunk("auth", "hash", 0), /^queue2:chunk:/);
  appendIdempotencyRecord({ operationId: id, status: "committed" }, ledger);
  assert.equal(hasCommittedOperation(id, readIdempotencyLedger(ledger)), true);
  assert.equal(hasCommittedOperation("queue2:cl:other", readIdempotencyLedger(ledger)), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("crash windows: commit without checkpoint advance; failed tx leaves checkpoint", () => {
  const prior = "cl-opinion-9885161";
  const a = advanceCheckpointSafely({
    priorCheckpoint: prior,
    mutationCommitted: true,
    nextCheckpoint: "cl-opinion-999",
  });
  assert.equal(a.advanced, true);
  assert.equal(a.checkpoint, "cl-opinion-999");

  const b = advanceCheckpointSafely({
    priorCheckpoint: prior,
    mutationCommitted: false,
    nextCheckpoint: "cl-opinion-999",
  });
  assert.equal(b.advanced, false);
  assert.equal(b.checkpoint, prior);

  // Stale checkpoint + already committed authority → idempotent skip
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "q2-idem2-"));
  const ledger = path.join(dir, "ledger.jsonl");
  const op = operationIdCl("cl-opinion-already");
  appendIdempotencyRecord({ operationId: op, status: "committed" }, ledger);
  assert.equal(hasCommittedOperation(op, readIdempotencyLedger(ledger)), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("kill switch disabled startup", () => {
  assert.equal(isWorkerEnabled({ QUEUE2_WORKER_ENABLED: "0" }), false);
  assert.equal(killSwitchStatus({}).code, "QUEUE2_WORKER_DISABLED");
  assert.equal(isWorkerEnabled({ QUEUE2_WORKER_ENABLED: "1" }), true);
});

test("mandatory preflight zero mutations", () => {
  const live = rebuildLaneAManifestFromSnapshot(SNAPSHOT, { arkCheckpoint: "cl-opinion-9885161" });
  const pf = runPreflight({
    env: { QUEUE2_WORKER_ENABLED: "1", FEATURE_AGENTS: "0" },
    snapshot: SNAPSHOT,
    manifest: live,
    state: {
      laneA: { court: "ark", count: 33, target: 45, checkpoint: "cl-opinion-9885161" },
      humanReview: { required: false },
      queue3: "NOT_OPEN",
    },
    dbReachable: true,
    storageReachable: true,
    freeDiskBytes: 10e9,
    tempFreeBytes: 5e9,
  });
  assert.equal(pf.mutations, 0);
  assert.equal(pf.aiCalls, 0);
  assert.equal(pf.result, pf.ok ? "PREFLIGHT_PASS" : "PREFLIGHT_FAIL");
  assert.equal(pf.ok, true);
});

test("budgets, backpressure, resources, horizon, self-check", () => {
  const cfg = defaultSafetyConfig();
  assert.ok(cfg.budgets.laneA.maxClRequestsPerBatch > 0);
  const bp = evaluateBackpressure({ pendingChunks: 99999 }, cfg);
  assert.equal(bp.pause, true);
  assert.equal(bp.code, "BACKPRESSURE_PAUSE");
  const low = evaluateResourceGuards(cfg, { freeDiskBytes: 100, tempFreeBytes: 100, dbReachable: true });
  assert.equal(low.ok, false);
  const hz = evaluateHorizon({ externalRequests: 9999 }, cfg);
  assert.equal(hz.boundary, true);
  const sc = runSelfCheck({ orphanCount: 1 });
  assert.equal(sc.ok, false);
  assert.equal(sc.humanReview, true);
});

test("version mismatch, code-change, clock jumps", () => {
  const bad = checkVersionCompatibility(
    { workerVersion: WORKER_VERSION },
    { checkpointSchemaVersion: 999, corpusSchemaVersion: 1, workerVersion: WORKER_VERSION },
  );
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "WORKER_STATE_VERSION_MISMATCH");

  const fp = fingerprintProductionFiles();
  const change = detectCodeChange("not-the-same-fingerprint");
  assert.equal(change.changed, true);
  assert.equal(change.code, "CODE_CHANGE_DETECTED");
  assert.equal(detectCodeChange(fp).changed, false);

  const back = detectClockAnomaly({
    lastSeenAt: new Date("2026-09-24T19:00:00.000Z").toISOString(),
    now: new Date("2026-09-24T18:00:00.000Z"),
  });
  assert.equal(back.anomaly, true);
  assert.equal(back.kind, "backwards_clock_jump");
  const fwd = detectClockAnomaly({
    lastSeenAt: new Date("2026-09-24T10:00:00.000Z").toISOString(),
    now: new Date("2026-09-24T18:00:00.000Z"),
  });
  assert.equal(fwd.anomaly, true);
  assert.equal(fwd.event, "CLOCK_REVALIDATION");
});

test("source contract and circuit breakers", () => {
  const bad = validateSourceContract("courtlistener", { results: [{ id: 1 }] });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, "SOURCE_CONTRACT_CHANGED");
  const good = validateSourceContract("courtlistener", {
    results: [{ id: 1, cluster: 2, court: "ark", date_filed: "2018-01-01" }],
  });
  assert.equal(good.ok, true);

  let br = createCircuitBreaker("courtlistener", { maxFailures: 2, cooldownMs: 60_000 });
  br = recordCircuitFailure(br);
  br = recordCircuitFailure(br);
  assert.equal(br.state, "open");
  assert.equal(mayUseCircuit(br, new Date(br.openedAt)).allowed, false);
});

test("append-only audit and no AI / no heartbeat commit / queue3 closed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "q2-audit-"));
  const file = path.join(dir, "audit.jsonl");
  appendAuditEvent({ lane: "A", operationId: "queue2:cl:1", priorCheckpoint: "a", resultingCheckpoint: "b" }, file);
  appendAuditEvent({ lane: "B", task: "X" }, file);
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(heartbeatImpliesGitCommit(), false);
  assert.equal(neverOpenQueue3({ queue3: "OPEN" }).queue3, "NOT_OPEN");
  const src = fs.readFileSync(path.join(__dirname, "queue2-worker-safety.cjs"), "utf8");
  assert.equal(/openai|anthropic|cursor.?agent/i.test(src), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("worker not started by this suite", () => {
  assert.equal(process.env.QUEUE2_WORKER_STARTED, undefined);
  assert.ok(!process.argv.includes("--loop"));
});

console.log(JSON.stringify({ ok: true, tests: passed, suite: "queue2-worker-safety", workerStarted: false }));
