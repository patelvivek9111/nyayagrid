/**
 * Queue #2 canonical status consistency invariants.
 * Zero network. Zero corpus mutation. Zero AI. Does NOT start the worker.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  assertCanonicalStatusConsistency,
  buildReconciledStoppedStatus,
  buildOperatorStatus,
  CANONICAL_REPORTS_DIR,
} = require("./queue2-worker-observability.cjs");
const { applyTargetAlreadyComplete } = require("./queue2-lane-a-dispatch.cjs");
const { neverOpenQueue3 } = require("./queue2-autonomy-policy.cjs");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("review=false cannot coexist with currentLane=HUMAN_REVIEW_REQUIRED", () => {
  const bad = {
    runtimeState: "STOPPED",
    currentLane: "HUMAN_REVIEW_REQUIRED",
    freshness: "STOPPED",
    currentTask: "NONE",
    currentCourt: "mich",
    currentJurisdiction: "MI",
    review: { humanReviewRequired: false, reasons: [] },
  };
  const r = assertCanonicalStatusConsistency(bad);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.includes("currentLane=HUMAN_REVIEW_REQUIRED")));
});

test("review=false cannot coexist with freshness=HUMAN_REVIEW_REQUIRED", () => {
  const bad = {
    runtimeState: "STOPPED",
    currentLane: "STOPPED",
    freshness: "HUMAN_REVIEW_REQUIRED",
    currentTask: "NONE",
    currentCourt: "mich",
    currentJurisdiction: "MI",
    review: { humanReviewRequired: false, reasons: [] },
  };
  const r = assertCanonicalStatusConsistency(bad);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.includes("freshness=HUMAN_REVIEW_REQUIRED")));
});

test("currentCourt=mich cannot coexist with currentJurisdiction=WI", () => {
  const bad = {
    runtimeState: "STOPPED",
    currentLane: "STOPPED",
    freshness: "STOPPED",
    currentTask: "NONE",
    currentCourt: "mich",
    currentJurisdiction: "WI",
    review: { humanReviewRequired: false, reasons: [] },
  };
  const r = assertCanonicalStatusConsistency(bad);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => /mich/.test(v) && /WI|MI/.test(v)));
});

test("active target switch clears/relocates prior-target cursor/checkpoint metadata", () => {
  const state = {
    laneA: {
      court: "wis",
      jurisdiction: "WI",
      count: 44,
      target: 45,
      checkpoint: "cl-opinion-9886466",
      cursor: "cl-opinion-9886466",
      lastSuccessfulExternalId: "cl-opinion-9886466",
      nextPageUrl: "https://www.courtlistener.com/api/rest/v4/opinions/?docket__court=wis&cursor=x",
      lastSuccessfulAt: "2026-09-25T00:42:40.438Z",
    },
    humanReview: { required: true, reasons: ["LANE_A_ZERO_PROGRESS"], details: [] },
  };
  const next = applyTargetAlreadyComplete(state, {
    canonicalCount: 45,
    target: 45,
    checkpoint: "cl-opinion-9886466",
    nextTarget: {
      court: "mich",
      jurisdiction: "MI",
      count: 20,
      target: 45,
      checkpoint: null,
      status: "READY",
      mappingStatus: "VERIFIED",
    },
  });
  assert.equal(next.laneA.court, "mich");
  assert.equal(next.laneA.jurisdiction, "MI");
  assert.equal(next.laneA.checkpoint, null);
  assert.equal(next.laneA.cursor, null);
  assert.equal(next.laneA.lastSuccessfulExternalId, null);
  assert.equal(next.laneA.nextPageUrl, null);
  assert.equal(next.laneA.lastSuccessfulAt, null);
  assert.equal(next.completedCourtEvidence.wis.checkpoint, "cl-opinion-9886466");
  assert.ok(next.completedCourtEvidence.wis.nextPageUrl.includes("docket__court=wis"));
  assert.equal(next.humanReview.required, false);
});

test("stopped clean state is internally consistent", () => {
  const state = {
    laneA: {
      court: "mich",
      jurisdiction: "MI",
      count: 20,
      target: 45,
      checkpoint: null,
      cursor: null,
      lastSuccessfulExternalId: null,
      nextPageUrl: null,
      lastSuccessfulAt: null,
      mappingStatus: "VERIFIED",
      jobStatus: "ready",
    },
    humanReview: { required: false, reasons: [] },
    runtimeState: "STOPPED",
    quota: {},
  };
  const status = buildReconciledStoppedStatus({
    state,
    priorStatus: {
      corpus: { authorities: 3008, cases: 1691, clCases: 1646 },
      health: { retrieval: "ok", orphanCount: 0, duplicateSourceIdCount: 0, database: "ok", featureAgents: "0" },
    },
    laneReason: "WI COMPLETE_FOR_CURRENT_DEPTH; next=mich",
  });
  assert.equal(status.runtimeState, "STOPPED");
  assert.equal(status.currentLane, "STOPPED");
  assert.equal(status.freshness, "STOPPED");
  assert.equal(status.currentTask, "NONE");
  assert.equal(status.currentCourt, "mich");
  assert.equal(status.currentJurisdiction, "MI");
  assert.equal(status.jurisdiction, "MI");
  assert.equal(status.currentCount, 20);
  assert.equal(status.targetCount, 45);
  assert.equal(status.checkpoint, null);
  assert.equal(status.review.humanReviewRequired, false);
  assert.deepEqual(status.review.reasons, []);
  assert.equal(assertCanonicalStatusConsistency(status).ok, true);
});

test("buildOperatorStatus clears stale HUMAN_REVIEW labels when review=false", () => {
  const status = buildOperatorStatus({
    state: {
      laneA: { court: "mich", jurisdiction: "MI", count: 20, target: 45 },
      humanReview: { required: false, reasons: [] },
      runtimeState: "STOPPED",
    },
    currentLane: "HUMAN_REVIEW_REQUIRED",
    freshness: "HUMAN_REVIEW_REQUIRED",
    currentTask: "await_human_review",
    runtimeState: "STOPPED",
  });
  assert.equal(status.currentLane, "STOPPED");
  assert.equal(status.freshness, "STOPPED");
  assert.equal(status.currentTask, "NONE");
  assert.equal(status.currentJurisdiction, "MI");
});

test("canonical committed status is consistent", () => {
  const status = JSON.parse(
    fs.readFileSync(path.join(CANONICAL_REPORTS_DIR, "corpus-worker-status.json"), "utf8"),
  );
  const check = assertCanonicalStatusConsistency(status);
  assert.equal(check.ok, true, check.violations.join("; "));
  assert.equal(status.currentCourt, "sc");
  assert.equal(status.currentJurisdiction, "SC");
  assert.equal(status.runtimeState, "STOPPED");
  assert.equal(status.review.humanReviewRequired, false);
});

test("no corpus mutation / no AI / Queue #3 never opens", () => {
  const q3 = neverOpenQueue3({});
  assert.equal(q3.queue3, "NOT_OPEN");
  assert.equal(q3.featureAgents, "0");
});

console.log(
  JSON.stringify({
    ok: true,
    tests: passed,
    suite: "queue2-status-consistency",
    workerStarted: false,
    aiCalls: 0,
    corpusMutations: 0,
  }),
);
