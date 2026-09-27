/**
 * Generic Lane A live DB probe + prior-canary recovery tests.
 * Deterministic. Zero CourtListener. Zero corpus mutations. AI=0.
 */
"use strict";

const assert = require("node:assert/strict");
const {
  normalizeClCourt,
  resolveJurisdiction,
  CL_COURT_TO_STATE,
} = require("./tmp-queue2-lane-a-live-count-probe.cjs");
const {
  normalizeLiveCountProbeResult,
  evaluateRecoveredPreviousCanary,
  applyRecoveredPreviousCanary,
  RECOVERED_PREVIOUS_CANARY_PASS,
  PRIOR_CANARY_ZERO_PROGRESS,
  LIVE_DB_RECONCILIATION_UNAVAILABLE,
} = require("./queue2-prior-canary-reconcile.cjs");
const { canonicalLaneACount } = require("./queue2-lane-a-dispatch.cjs");
const { targetProgressFromCounts, normalizeCanonicalCounts } = require("./queue2-recovery-path.cjs");
const { isFreshPostRunDbEvidence } = require("./queue2-lane-a-child-lifecycle.cjs");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} ${name}`);
}

const TERMINAL = "2026-09-27T13:41:25.529Z";
const AFTER = "2026-09-27T13:42:00.000Z";

function mockProbe(overrides = {}) {
  return {
    ok: true,
    court: "vt",
    jurisdiction: "VT",
    qualifyingCaseCount: 22,
    highCourtClCases: 22,
    clCaseCount: 22,
    totalCaseCount: 25,
    authorityCount: 43,
    integrity: {
      duplicateSourceIds: 0,
      orphanCount: 0,
      chunkHealthy: true,
      missingEmbeddings: 0,
    },
    jobs: [
      {
        id: "job-vt-1",
        status: "quota_paused",
        cursor: "cl-opinion-9925231",
        last_successful_external_id: "cl-opinion-9925231",
        items_imported: 22,
        api_calls: 13,
        target_max: 45,
        batch_size: 2,
        last_error: null,
        started_at: "2026-09-27T13:40:55.000Z",
        updated_at: "2026-09-27T13:41:20.000Z",
      },
    ],
    job: {
      id: "job-vt-1",
      status: "quota_paused",
      cursor: "cl-opinion-9925231",
      last_successful_external_id: "cl-opinion-9925231",
      items_imported: 22,
      api_calls: 13,
      target_max: 45,
      batch_size: 2,
      updated_at: "2026-09-27T13:41:20.000Z",
    },
    generatedAt: AFTER,
    observedAt: AFTER,
    dbEvidenceObservedAt: AFTER,
    mutations: 0,
    courtListenerHttpCalls: 0,
    ...overrides,
  };
}

test("generic probe court map covers MI / VT / another court", () => {
  assert.equal(normalizeClCourt("mich"), "mich");
  assert.equal(normalizeClCourt("mi"), "mich");
  assert.equal(normalizeClCourt("VT"), "vt");
  assert.equal(resolveJurisdiction("mich"), "MI");
  assert.equal(resolveJurisdiction("vt"), "VT");
  assert.equal(resolveJurisdiction("wis"), "WI");
  assert.equal(CL_COURT_TO_STATE.mich, "MI");
  assert.equal(CL_COURT_TO_STATE.vt, "VT");
  assert.equal(CL_COURT_TO_STATE.wis, "WI");
});

test("returned court mismatch rejected", () => {
  const bad = normalizeLiveCountProbeResult(mockProbe({ court: "mich" }), "vt");
  assert.equal(bad, null);
  const ok = normalizeLiveCountProbeResult(mockProbe({ court: "vt" }), "vt");
  assert.equal(ok.court, "vt");
  assert.equal(ok.qualifyingCaseCount, 22);
});

test("qualifyingCaseCount is canonical; raw cl/total cannot satisfy target", () => {
  const live = normalizeLiveCountProbeResult(
    mockProbe({
      qualifyingCaseCount: 20,
      clCaseCount: 45,
      totalCaseCount: 50,
    }),
    "vt",
  );
  assert.equal(canonicalLaneACount({ db: live }), 20);
  const named = normalizeCanonicalCounts(live);
  assert.equal(named.qualifyingCaseCount, 20);
  assert.equal(named.clCaseCount, 45);
  assert.equal(named.totalCaseCount, 50);
  const progress = targetProgressFromCounts(
    { qualifyingCaseCount: 20, clCaseCount: 45, totalCaseCount: 50 },
    45,
  );
  assert.equal(progress.targetSatisfied, false);
  const falseDb = canonicalLaneACount({
    db: { clCaseCount: 45, totalCaseCount: 50, clCases: 45, cases: 50 },
  });
  assert.equal(falseDb, null);
});

test("fresh timestamp >= runner terminal required; stale rejected", () => {
  const fresh = isFreshPostRunDbEvidence({
    liveDb: mockProbe({ dbEvidenceObservedAt: AFTER }),
    runnerTerminalAt: TERMINAL,
  });
  assert.equal(fresh.ok, true);
  const stale = isFreshPostRunDbEvidence({
    liveDb: mockProbe({
      dbEvidenceObservedAt: "2026-09-27T13:40:00.000Z",
      generatedAt: "2026-09-27T13:40:00.000Z",
      observedAt: "2026-09-27T13:40:00.000Z",
    }),
    dbEvidenceObservedAt: "2026-09-27T13:40:00.000Z",
    runnerTerminalAt: TERMINAL,
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, "db_evidence_before_runner_terminal");
});

test("previous VT canary can be reconciled read-only → RECOVERED_PREVIOUS_CANARY_PASS", () => {
  const liveDb = normalizeLiveCountProbeResult(mockProbe(), "vt");
  const ev = evaluateRecoveredPreviousCanary({
    court: "vt",
    priorQualifyingCount: 20,
    liveDb,
    runnerTerminalAt: TERMINAL,
    sessionClRequests: 5,
    maxSessionClRequests: 5,
    claimedCheckpoint: "cl-opinion-9925231",
    childTerminal: true,
    supervised: true,
    target: 45,
  });
  assert.equal(ev.classification, RECOVERED_PREVIOUS_CANARY_PASS);
  assert.equal(ev.recoveredPass, true);
  assert.equal(ev.anotherCanaryNeeded, false);
  assert.equal(ev.delta, 2);
  assert.equal(ev.checkpoint, "cl-opinion-9925231");
  assert.equal(ev.courtListenerHttpCalls, 0);
  assert.equal(ev.mutations, 0);
  assert.equal(ev.aiCalls, 0);
  assert.equal(ev.childLaunches, 0);
  assert.equal(ev.queue3, "NOT_OPEN");
});

test("successful prior canary does not trigger another CL run", () => {
  const liveDb = normalizeLiveCountProbeResult(mockProbe({ qualifyingCaseCount: 21 }), "vt");
  const ev = evaluateRecoveredPreviousCanary({
    court: "vt",
    priorQualifyingCount: 20,
    liveDb,
    runnerTerminalAt: TERMINAL,
    sessionClRequests: 5,
    claimedCheckpoint: "cl-opinion-9925231",
  });
  assert.equal(ev.anotherCanaryNeeded, false);
  assert.equal(ev.courtListenerHttpCalls, 0);
  assert.equal(ev.childLaunches, 0);
});

test("checkpoint accepted only if DB/job confirms it; no fabricated checkpoint", () => {
  const liveDb = normalizeLiveCountProbeResult(
    mockProbe({
      job: {
        status: "quota_paused",
        cursor: "cl-opinion-OTHER",
        last_successful_external_id: "cl-opinion-OTHER",
      },
      jobs: [],
    }),
    "vt",
  );
  const mismatch = evaluateRecoveredPreviousCanary({
    court: "vt",
    priorQualifyingCount: 20,
    liveDb,
    runnerTerminalAt: TERMINAL,
    sessionClRequests: 5,
    claimedCheckpoint: "cl-opinion-9925231",
  });
  assert.equal(mismatch.hold, true);
  assert.equal(mismatch.recoveredPass, false);
  assert.match(String(mismatch.reason), /CHECKPOINT/);

  const noClaim = evaluateRecoveredPreviousCanary({
    court: "vt",
    priorQualifyingCount: 20,
    liveDb: normalizeLiveCountProbeResult(mockProbe(), "vt"),
    runnerTerminalAt: TERMINAL,
    sessionClRequests: 5,
    claimedCheckpoint: null,
  });
  assert.equal(noClaim.recoveredPass, true);
  assert.equal(noClaim.checkpoint, null);
});

test("duplicates/orphans block recovered pass", () => {
  const dups = evaluateRecoveredPreviousCanary({
    court: "vt",
    priorQualifyingCount: 20,
    liveDb: normalizeLiveCountProbeResult(
      mockProbe({ integrity: { duplicateSourceIds: 1, orphanCount: 0, chunkHealthy: true } }),
      "vt",
    ),
    runnerTerminalAt: TERMINAL,
    sessionClRequests: 5,
    claimedCheckpoint: "cl-opinion-9925231",
  });
  assert.equal(dups.hold, true);
  assert.equal(dups.recoveredPass, false);

  const orphans = evaluateRecoveredPreviousCanary({
    court: "vt",
    priorQualifyingCount: 20,
    liveDb: normalizeLiveCountProbeResult(
      mockProbe({ integrity: { duplicateSourceIds: 0, orphanCount: 2, chunkHealthy: true } }),
      "vt",
    ),
    runnerTerminalAt: TERMINAL,
    sessionClRequests: 5,
    claimedCheckpoint: "cl-opinion-9925231",
  });
  assert.equal(orphans.hold, true);
});

test("LIVE_DB_RECONCILIATION_UNAVAILABLE clears only after valid fresh evidence", () => {
  const stale = evaluateRecoveredPreviousCanary({
    court: "vt",
    priorQualifyingCount: 20,
    liveDb: normalizeLiveCountProbeResult(
      mockProbe({ dbEvidenceObservedAt: "2026-09-27T13:40:00.000Z", generatedAt: "2026-09-27T13:40:00.000Z" }),
      "vt",
    ),
    runnerTerminalAt: TERMINAL,
    sessionClRequests: 5,
    claimedCheckpoint: "cl-opinion-9925231",
  });
  assert.equal(stale.classification, LIVE_DB_RECONCILIATION_UNAVAILABLE);

  const applied = applyRecoveredPreviousCanary(
    {
      queue: "#2",
      queue3: "NOT_OPEN",
      queue9: "CLOSED",
      laneA: { court: "vt", jurisdiction: "VT", count: 20, target: 45, checkpoint: null },
      humanReview: {
        required: true,
        reasons: ["LIVE_DB_RECONCILIATION_UNAVAILABLE", "OTHER_REASON"],
        details: [
          { reason: "LIVE_DB_RECONCILIATION_UNAVAILABLE" },
          { reason: "OTHER_REASON" },
        ],
      },
      canaryMode: "CANARY_REQUIRED",
    },
    evaluateRecoveredPreviousCanary({
      court: "vt",
      priorQualifyingCount: 20,
      liveDb: normalizeLiveCountProbeResult(mockProbe(), "vt"),
      runnerTerminalAt: TERMINAL,
      sessionClRequests: 5,
      claimedCheckpoint: "cl-opinion-9925231",
    }),
    { codeFingerprint: "fp-test", workerVersion: "test", now: new Date(AFTER) },
  );
  assert.equal(applied.applied, true);
  assert.equal(applied.state.humanReview.required, true);
  assert.deepEqual(applied.state.humanReview.reasons, ["OTHER_REASON"]);
  assert.ok(!applied.state.humanReview.reasons.includes("LIVE_DB_RECONCILIATION_UNAVAILABLE"));
  assert.equal(applied.state.laneA.qualifyingCaseCount, 22);
  assert.equal(applied.state.laneA.checkpoint, "cl-opinion-9925231");
  assert.equal(applied.state.canaryMode, "NORMAL");
  assert.equal(applied.state.queue3, "NOT_OPEN");
  assert.equal(applied.mutations, 0);
  assert.equal(applied.aiCalls, 0);
  assert.equal(applied.knownGood.reason, RECOVERED_PREVIOUS_CANARY_PASS);
});

test("zero progress keeps canary required", () => {
  const ev = evaluateRecoveredPreviousCanary({
    court: "vt",
    priorQualifyingCount: 20,
    liveDb: normalizeLiveCountProbeResult(mockProbe({ qualifyingCaseCount: 20 }), "vt"),
    runnerTerminalAt: TERMINAL,
    sessionClRequests: 5,
    claimedCheckpoint: "cl-opinion-9925231",
  });
  assert.equal(ev.classification, PRIOR_CANARY_ZERO_PROGRESS);
  assert.equal(ev.anotherCanaryNeeded, true);
  assert.equal(ev.recoveredPass, false);
});

test("Queue #3 stays NOT_OPEN; AI calls = 0", () => {
  const ev = evaluateRecoveredPreviousCanary({
    court: "vt",
    priorQualifyingCount: 20,
    liveDb: normalizeLiveCountProbeResult(mockProbe(), "vt"),
    runnerTerminalAt: TERMINAL,
    sessionClRequests: 5,
    claimedCheckpoint: "cl-opinion-9925231",
  });
  assert.equal(ev.queue3, "NOT_OPEN");
  assert.equal(ev.aiCalls, 0);
  assert.equal(ev.courtListenerHttpCalls, 0);
  assert.equal(ev.mutations, 0);
});

console.log(`queue2-generic-live-db-probe: ${passed} passed`);
