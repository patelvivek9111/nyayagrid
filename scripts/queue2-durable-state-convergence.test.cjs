/**
 * Durable Queue #2 state / observability convergence tests.
 * Zero CourtListener, zero corpus mutations, zero AI, zero worker start.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  convergeDurableQueue2State,
  persistConvergedQueue2State,
  buildConvergedOperatorStatus,
  atomicWriteJson,
  normalizeCompletionEvidence,
  loadNeonHoldArtifact,
} = require("./queue2-durable-state-convergence.cjs");
const { isValidCompletionEvidence } = require("./queue2-manual-progress.cjs");

const ROOT = path.join(__dirname, "..");
const MANIFEST = path.join(ROOT, "packages/research/corpus/reports/queue2-lane-a-depth-manifest.json");
const STATE = path.join(ROOT, "packages/research/corpus/reports/queue2-dual-lane-state.json");
const NOW = new Date("2026-09-27T04:00:00.000Z");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} ${name}`);
}

function load(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "queue2-converge-"));
}

test("stale completed laneA converges to VT without fabricating a checkpoint", () => {
  const result = convergeDurableQueue2State({
    state: load(STATE),
    manifest: load(MANIFEST),
    neonHold: loadNeonHoldArtifact(),
    forceDatabaseQuotaBlocked: true,
    now: NOW,
  });
  assert.equal(result.ok, true);
  assert.equal(result.state.laneA.court, "vt");
  assert.equal(result.state.laneA.jurisdiction, "VT");
  assert.ok(
    result.state.laneA.qualifyingCaseCount >= 20 && result.state.laneA.qualifyingCaseCount <= 22,
    `qualifyingCaseCount=${result.state.laneA.qualifyingCaseCount}`,
  );
  assert.ok(result.state.laneA.count >= 20 && result.state.laneA.count <= 22, `count=${result.state.laneA.count}`);
  assert.equal(result.state.laneA.target, 45);
  assert.equal(result.state.laneA.mappingStatus, "VERIFIED");
  assert.ok(
    result.state.laneA.targetStatus === "READY" || result.state.laneA.targetStatus === "PARTIAL",
    `targetStatus=${result.state.laneA.targetStatus}`,
  );
  assert.ok(
    result.state.laneA.jobLifecycle === "READY_FIRST_START" ||
      result.state.laneA.jobLifecycle === "PAUSED_RESUMABLE",
    `jobLifecycle=${result.state.laneA.jobLifecycle}`,
  );
  assert.ok(
    result.state.laneA.checkpoint == null || result.state.laneA.checkpoint === "cl-opinion-9925231",
    `checkpoint=${result.state.laneA.checkpoint}`,
  );
  assert.deepEqual(result.inventedCheckpoints, []);
  assert.equal(result.clRequests, 0);
  assert.equal(result.childLaunches, 0);
  assert.equal(result.mutations, 0);
  assert.equal(result.aiCalls, 0);
  assert.equal(result.queue3, "NOT_OPEN");
  assert.equal(result.state.runtimeState, "STOPPED");
});

test("SC history preserved and all completed courts have evidence", () => {
  const result = convergeDurableQueue2State({
    state: load(STATE),
    manifest: load(MANIFEST),
    forceDatabaseQuotaBlocked: true,
    neonHold: loadNeonHoldArtifact(),
    now: NOW,
  });
  const completed = ["wis", "mich", "nm", "utah", "sd", "idaho", "wyo", "neb", "sc"];
  assert.ok(result.completedCourts.length >= 9, `completedCourts=${result.completedCourts.length}`);
  for (const court of completed) {
    assert.ok(result.state.completedCourts.includes(court), court);
    const ev = result.state.completedCourtEvidence[court];
    assert.equal(isValidCompletionEvidence(ev), true, court);
    assert.equal(ev.status, "COMPLETE_FOR_CURRENT_DEPTH");
    assert.equal(ev.court, court);
    assert.ok(["manual", "autonomous", "canonical_manifest_reconciliation"].includes(ev.source), ev.source);
  }
  assert.equal(result.state.completedCourtEvidence.sc.checkpoint, "cl-opinion-11201513");
  assert.equal(result.state.completedCourtEvidence.sc.jurisdiction, "SC");
  assert.equal(result.state.completedCourtEvidence.wis.checkpoint, "cl-opinion-9886466");
  assert.ok(result.completedEvidenceCount >= 9);
});

test("null checkpoint remains null when unsupported", () => {
  const ev = normalizeCompletionEvidence(
    "me",
    { jurisdiction: "ME", currentCases: 65, targetCases: 45, checkpoint: null, mappingStatus: "VERIFIED" },
    { status: "COMPLETE_FOR_CURRENT_DEPTH", count: 65, target: 45 },
    NOW.toISOString(),
  );
  assert.equal(ev.checkpoint, null);
  assert.equal(ev.lastSuccessfulExternalId, null);
});

test("manual completion recognized and next target selected", () => {
  const manifest = load(MANIFEST);
  const state = load(STATE);
  // Simulate stale MI-as-current after manual completion elsewhere already listed.
  state.laneA = {
    court: "sc",
    jurisdiction: "SC",
    count: 45,
    target: 45,
    checkpoint: "cl-opinion-11201513",
    targetStatus: "COMPLETE_FOR_CURRENT_DEPTH",
    jobStatus: "completed",
    mappingStatus: "VERIFIED",
  };
  const result = convergeDurableQueue2State({
    state,
    manifest,
    forceDatabaseQuotaBlocked: true,
    neonHold: loadNeonHoldArtifact(),
    now: NOW,
  });
  assert.equal(result.state.laneA.court, "vt");
  assert.ok(result.state.completedCourts.includes("sc"));
  assert.equal(result.state.completedCourtEvidence.mich.source, "manual");
});

test("status current target matches state; DB block separated from app health; quota stale", () => {
  const result = convergeDurableQueue2State({
    state: load(STATE),
    manifest: load(MANIFEST),
    forceDatabaseQuotaBlocked: true,
    neonHold: loadNeonHoldArtifact(),
    now: NOW,
  });
  const status = buildConvergedOperatorStatus(result.state, {
    now: NOW,
    corpus: { authorities: 3208, cases: 1891, clCases: 1846 },
    health: { databaseConnectivity: "unknown", retrieval: "ok" },
  });
  assert.equal(status.currentCourt, "vt");
  assert.equal(status.currentJurisdiction, "VT");
  assert.ok(
    status.qualifyingCaseCount >= 20 && status.qualifyingCaseCount <= 22,
    `qualifyingCaseCount=${status.qualifyingCaseCount}`,
  );
  assert.equal(status.targetCount, 45);
  assert.ok(
    status.depthStatus === "READY" || status.depthStatus === "PARTIAL",
    `depthStatus=${status.depthStatus}`,
  );
  assert.ok(
    status.jobLifecycle === "READY_FIRST_START" || status.jobLifecycle === "PAUSED_RESUMABLE",
    `jobLifecycle=${status.jobLifecycle}`,
  );
  assert.ok(
    status.checkpoint == null || status.checkpoint === "cl-opinion-9925231",
    `checkpoint=${status.checkpoint}`,
  );
  assert.equal(status.worker, "STOPPED");
  assert.equal(status.lock, null);
  assert.equal(status.health.database, "external_block");
  assert.equal(status.health.databaseConnectivity, "unknown");
  assert.equal(status.execution.databaseWriteReady, false);
  assert.equal(status.execution.blockReason, "DATABASE_QUOTA_BLOCKED");
  assert.equal(status.execution.database.sqlState, "53000");
  assert.equal(status.execution.database.externalBlock, true);
  assert.equal(status.quota.executionAuthority, false);
  assert.equal(status.quota.freshness, "STALE");
  assert.equal(status.quota.reason, "DB_BLOCKED_BEFORE_CL_PROBE");
  assert.equal(status.quota.dayRemaining, null);
  assert.equal(status.quota.safeRequests, null);
  assert.equal(status.quota.historicalObservation.dayRemaining != null, true);
  assert.equal(status.queue3, "NOT_OPEN");
});

test("fresh CL quota replaces stale after recovery fixture", () => {
  const result = convergeDurableQueue2State({
    state: load(STATE),
    manifest: load(MANIFEST),
    clearDbBlock: true,
    now: NOW,
  });
  result.state.databaseBlock = {
    classification: "RECOVERED",
    recoveredFrom: "DATABASE_QUOTA_BLOCKED",
    recovered: true,
  };
  result.state.dbWriteReady = true;
  result.state.quota = {
    windows: { minute: { remaining: 30 }, hour: { remaining: 300 }, day: { remaining: 726 } },
    lastSafeRequests: 28,
    quotaStatus: "FRESH",
    executionAuthority: "probe.limits",
    usableForExecution: true,
    quotaStateConfidence: "AUTHORITATIVE_API",
    lastProbeAt: NOW.toISOString(),
  };
  const status = buildConvergedOperatorStatus(result.state, { now: NOW });
  assert.equal(status.execution.databaseWriteReady, true);
  assert.equal(status.quota.executionAuthority, true);
  assert.equal(status.quota.freshness, "FRESH");
  assert.equal(status.quota.dayRemaining, 726);
});

test("atomic write; reconciliation failure leaves old files intact", () => {
  const dir = tmpDir();
  const statePath = path.join(dir, "queue2-dual-lane-state.json");
  const statusPath = path.join(dir, "corpus-worker-status.json");
  const prior = { keep: true, laneA: { court: "sc" } };
  atomicWriteJson(statePath, prior);
  atomicWriteJson(statusPath, { currentCourt: "sc" });

  const fail = persistConvergedQueue2State({
    state: load(STATE),
    manifest: { targets: null },
    statePath,
    statusPath,
    dryRun: false,
    now: NOW,
  });
  assert.equal(fail.ok, false);
  assert.equal(fail.persisted, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(statePath, "utf8")), prior);

  const ok = persistConvergedQueue2State({
    state: load(STATE),
    manifest: load(MANIFEST),
    neonHold: loadNeonHoldArtifact(),
    forceDatabaseQuotaBlocked: true,
    statePath,
    statusPath,
    dryRun: false,
    now: NOW,
    corpus: { authorities: 3208, cases: 1891, clCases: 1846 },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.persisted, true);
  const written = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  assert.equal(written.laneA.court, "vt");
  assert.equal(status.currentCourt, "vt");
  assert.equal(ok.clRequests, 0);
  assert.equal(ok.childLaunches, 0);
  assert.equal(ok.mutations, 0);
  assert.equal(ok.aiCalls, 0);
});

test("dry-run reconciliation makes 0 CL calls / children / mutations", () => {
  const dir = tmpDir();
  const statePath = path.join(dir, "queue2-dual-lane-state.json");
  const statusPath = path.join(dir, "corpus-worker-status.json");
  fs.writeFileSync(statePath, JSON.stringify(load(STATE), null, 2));
  const dry = persistConvergedQueue2State({
    state: load(STATE),
    manifest: load(MANIFEST),
    neonHold: loadNeonHoldArtifact(),
    forceDatabaseQuotaBlocked: true,
    statePath,
    statusPath,
    dryRun: true,
    now: NOW,
  });
  assert.equal(dry.ok, true);
  assert.equal(dry.persisted, false);
  assert.equal(dry.dryRun, true);
  assert.equal(dry.state.laneA.court, "vt");
  assert.equal(fs.existsSync(statusPath), false);
  assert.equal(dry.clRequests, 0);
  assert.equal(dry.childLaunches, 0);
  assert.equal(dry.mutations, 0);
  assert.equal(dry.aiCalls, 0);
  assert.equal(dry.queue3, "NOT_OPEN");
});

console.log(
  JSON.stringify({
    ok: true,
    tests: passed,
    suite: "queue2-durable-state-convergence",
    workerStarted: false,
    courtListenerHttpCalls: 0,
    corpusMutations: 0,
    aiCalls: 0,
  }),
);
