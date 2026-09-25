/**
 * Queue #2 existing MI / CourtListener job reconciliation tests.
 * Zero network. Zero corpus mutation. Zero AI. Zero real CL ingestion.
 */
"use strict";

const assert = require("node:assert/strict");
const {
  JOB_CLASSIFICATIONS,
  classifyExistingCorpusIngestJob,
  adoptExistingJobIntoLaneA,
  reconcileStaleRunningGuard,
  isReadyAllowedGivenJob,
  RESUME_EVIDENCE,
} = require("./queue2-existing-job-reconcile.cjs");
const {
  classifyLaneABatchResult,
  reconcileLaneACountSources,
  applyTargetAlreadyComplete,
  resolveLaneABatchBounds,
} = require("./queue2-lane-a-dispatch.cjs");
const { createInitialState } = require("./queue2-dual-lane-controller.cjs");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const MI_JOB = {
  source: "courtlistener",
  cl_court: "mich",
  court_id: "st-mi-high",
  status: "running",
  cursor: "cl-opinion-11250867",
  next_page_url: null,
  last_successful_external_id: null,
  items_discovered: 60,
  items_fetched: 19,
  items_imported: 19,
  api_calls: 9,
  target_max: 45,
  batch_size: 3,
  started_at: "2026-09-23T22:13:41.420Z",
  updated_at: "2026-09-25T17:18:20.995Z",
  completed_at: null,
};

test("A: READY target + existing resumable running job → NOT READY / PARTIAL", () => {
  assert.equal(isReadyAllowedGivenJob(MI_JOB, { ownerAlive: false, cursorValid: true }), false);
  const classified = classifyExistingCorpusIngestJob(MI_JOB, {
    ownerAlive: false,
    cursorValid: true,
    corpusClCases: 19,
  });
  assert.equal(classified.classification, JOB_CLASSIFICATIONS.STALE_RESUMABLE);
  const state = createInitialState();
  state.laneA = {
    ...state.laneA,
    court: "mich",
    count: 20,
    target: 45,
    targetStatus: "READY",
    checkpoint: null,
    jobStatus: "ready",
  };
  const adopted = adoptExistingJobIntoLaneA(state, MI_JOB, classified, {
    qualifyingCases: 20,
    corpusClCases: 19,
    mappingStatus: "VERIFIED",
  });
  assert.equal(adopted.ok, true);
  assert.equal(adopted.state.laneA.targetStatus, "PARTIAL");
  assert.notEqual(adopted.state.laneA.targetStatus, "READY");
  assert.equal(adopted.state.laneA.cursor, "cl-opinion-11250867");
  assert.equal(adopted.state.laneA.checkpoint, "cl-opinion-11250867");
  assert.equal(adopted.state.laneA.resumeEvidenceKind, RESUME_EVIDENCE.CURSOR_ONLY);
});

test("B: stale running + dead owner + valid cursor → STALE_RESUMABLE", () => {
  const c = classifyExistingCorpusIngestJob(MI_JOB, {
    ownerAlive: false,
    processAlive: false,
    cursorValid: true,
    corpusClCases: 19,
  });
  assert.equal(c.classification, JOB_CLASSIFICATIONS.STALE_RESUMABLE);
  assert.equal(c.resumable, true);
});

test("C: stale running + invalid/missing resume evidence → HUMAN_REVIEW", () => {
  const bad = {
    ...MI_JOB,
    cursor: null,
    last_successful_external_id: null,
    next_page_url: null,
  };
  const c = classifyExistingCorpusIngestJob(bad, { ownerAlive: false, cursorValid: true });
  assert.equal(c.classification, JOB_CLASSIFICATIONS.STALE_NONRESUMABLE);
  const adopted = adoptExistingJobIntoLaneA(createInitialState(), bad, c, { qualifyingCases: 20 });
  assert.equal(adopted.ok, false);
  assert.equal(adopted.humanReviewRequired, true);
});

test("D: stale_running_guard does not become LANE_A_COUNT_RECONCILIATION_FAILED before DB reconcile", () => {
  const stdout = JSON.stringify({ ok: false, reason: "stale_running_guard", job: MI_JOB });
  const classified = classifyLaneABatchResult({
    stdout,
    priorCheckpoint: null,
    priorCount: 20,
    target: 45,
  });
  assert.equal(classified.staleRunningGuard, true);
  assert.equal(classified.runnerBatchImported, 0);
  assert.equal(classified.existingJobItemsImported, 19);
  const deferred = reconcileLaneACountSources({
    runtimeCount: 20,
    statusCount: 20,
    manifestCount: 20,
    runnerBatchImported: 0,
    existingJobItemsImported: 19,
    staleRunningGuard: true,
    existingJob: MI_JOB,
    requireLiveDb: true,
    target: 45,
    db: { qualifyingCases: 20, clCases: 19, highCourtClCases: 19, cases: 20 },
  });
  assert.notEqual(deferred.classification, "RECONCILIATION_FAILED");
  assert.equal(deferred.classification, "STALE_RUNNING_GUARD");
  assert.equal(deferred.humanReviewRequired, false);
});

test("E: live DB count mandatory for existing-job reconciliation", () => {
  const r = reconcileLaneACountSources({
    runtimeCount: 20,
    statusCount: 20,
    manifestCount: 20,
    runnerBatchImported: 0,
    existingJobItemsImported: 19,
    staleRunningGuard: true,
    existingJob: MI_JOB,
    requireLiveDb: true,
    target: 45,
    db: {},
  });
  assert.equal(r.classification, "LIVE_DB_RECONCILIATION_UNAVAILABLE");
  assert.equal(r.humanReviewRequired, true);

  const guard = reconcileStaleRunningGuard({
    state: createInitialState(),
    job: MI_JOB,
    liveDb: null,
    ownerAlive: false,
  });
  assert.equal(guard.reason, "LIVE_DB_RECONCILIATION_UNAVAILABLE");
});

test("F: existingJobItemsImported separated from current runner batch delta", () => {
  const classified = classifyLaneABatchResult({
    stdout: JSON.stringify({ ok: false, reason: "stale_running_guard", job: MI_JOB }),
    priorCount: 20,
    target: 45,
  });
  assert.equal(classified.runnerBatchImported, 0);
  assert.equal(classified.existingJobItemsImported, 19);
  assert.notEqual(classified.runnerBatchImported, classified.existingJobItemsImported);
});

test("G: no duplicate ingestion on resumable job adopt", () => {
  const classified = classifyExistingCorpusIngestJob(MI_JOB, {
    ownerAlive: false,
    cursorValid: true,
    corpusClCases: 19,
  });
  const adopted = adoptExistingJobIntoLaneA(createInitialState(), MI_JOB, classified, {
    qualifyingCases: 20,
  });
  assert.equal(adopted.duplicateIngestionRisk, false);
  assert.ok(adopted.resumeFrom);
});

test("H: canary resumes from durable job state with caps", () => {
  const classified = classifyExistingCorpusIngestJob(MI_JOB, {
    ownerAlive: false,
    cursorValid: true,
    corpusClCases: 19,
  });
  const adopted = adoptExistingJobIntoLaneA(createInitialState(), MI_JOB, classified, {
    qualifyingCases: 20,
  });
  const bounds = resolveLaneABatchBounds({
    canaryRequired: true,
    maxQualifyingAuthorities: 3,
    maxClRequests: 12,
    remainingAuthorities: 25,
    usableRequests: 28,
    requestsPerAuthorityEstimate: 2.3,
    checkpoint: adopted.state.laneA.checkpoint,
  });
  assert.equal(bounds.initialStart, false);
  assert.ok(bounds.authorities <= 3);
  assert.ok(bounds.maxClRequests <= 12);
  assert.equal(adopted.state.laneA.checkpoint, "cl-opinion-11250867");
});

test("I: READY only when no prior resumable job exists", () => {
  assert.equal(isReadyAllowedGivenJob(null), true);
  assert.equal(isReadyAllowedGivenJob(MI_JOB, { ownerAlive: false, cursorValid: true }), false);
  const state = createInitialState();
  const next = applyTargetAlreadyComplete(state, {
    canonicalCount: 45,
    target: 45,
    checkpoint: "cl-opinion-wi",
    nextTarget: {
      court: "mich",
      jurisdiction: "MI",
      count: 20,
      target: 45,
      status: "READY",
      mappingStatus: "VERIFIED",
    },
    nextTargetJob: MI_JOB,
    now: new Date(),
  });
  assert.equal(next.laneA.court, "mich");
  assert.equal(next.laneA.targetStatus, "PARTIAL");
  assert.equal(next.laneA.cursor, "cl-opinion-11250867");
  assert.notEqual(next.laneA.targetStatus, "READY");
});

test("J: Queue #3 remains NOT_OPEN", () => {
  const state = createInitialState();
  assert.equal(state.queue3, "NOT_OPEN");
  const classified = classifyExistingCorpusIngestJob(MI_JOB, { ownerAlive: false, cursorValid: true });
  const adopted = adoptExistingJobIntoLaneA(state, MI_JOB, classified, { qualifyingCases: 20 });
  assert.equal(adopted.state.queue3, "NOT_OPEN");
});

test("stale_running_guard + live DB → EXISTING_JOB_RECONCILED", () => {
  let state = createInitialState();
  state.laneA = {
    ...state.laneA,
    court: "mich",
    count: 20,
    target: 45,
    targetStatus: "READY",
    checkpoint: null,
  };
  state.humanReview = {
    required: true,
    reasons: ["LANE_A_COUNT_RECONCILIATION_FAILED"],
    details: [{ reason: "LANE_A_COUNT_RECONCILIATION_FAILED", detail: "cache spread" }],
  };
  const rec = reconcileStaleRunningGuard({
    state,
    job: MI_JOB,
    liveDb: { qualifyingCases: 20, clCases: 19, highCourtClCases: 19, cases: 20 },
    ownerAlive: false,
    cursorValid: true,
  });
  assert.equal(rec.ok, true);
  assert.equal(rec.classification, "EXISTING_JOB_RECONCILED");
  assert.equal(rec.jobClassification, JOB_CLASSIFICATIONS.STALE_RESUMABLE);
  assert.equal(rec.state.laneA.targetStatus, "PARTIAL");
  assert.equal(rec.state.humanReview.required, false);
  assert.equal(rec.runnerBatchImported, 0);
  assert.equal(rec.existingJobItemsImported, 19);
  assert.equal(rec.canonicalDbCount, 20);
});

console.log(`queue2-existing-job-reconcile.test.cjs: ${passed} passed`);
