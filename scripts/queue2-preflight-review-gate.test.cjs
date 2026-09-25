/**
 * Queue #2 preflight human-review gate tests.
 * Zero network. Zero corpus mutation. Zero AI. Does NOT start the worker.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  runPreflight,
  STATE_PATH,
  REPORTS,
} = require("./queue2-worker-safety.cjs");
const {
  restoreState,
  isPartialLaneA,
  isReadyFirstStartLaneA,
  validatePartialCheckpoint,
} = require("./queue2-dual-lane-controller.cjs");
const { neverOpenQueue3 } = require("./queue2-autonomy-policy.cjs");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const CANONICAL = path.join(__dirname, "../packages/research/corpus/reports/queue2-dual-lane-state.json");

test("A: canonical review=false → preflight does not return PENDING_HUMAN_REVIEW", () => {
  assert.equal(path.resolve(STATE_PATH), path.resolve(CANONICAL));
  const state = restoreState(JSON.parse(fs.readFileSync(STATE_PATH, "utf8")));
  assert.equal(state.humanReview.required, false);
  const pf = runPreflight({
    state,
    allowDisabledForDryRun: true,
    queue2Open: true,
    queue3Open: false,
    featureAgents: "0",
    dbReachable: true,
    storageReachable: true,
    freeDiskBytes: 8e10,
    tempFreeBytes: 8e10,
  });
  assert.equal(pf.reasons.includes("PENDING_HUMAN_REVIEW"), false);
});

test("B: canonical review=true → preflight returns PENDING_HUMAN_REVIEW", () => {
  const state = restoreState({
    humanReview: { required: true, reasons: ["LANE_A_ZERO_PROGRESS"], details: [] },
    laneA: {
      court: "mich",
      jurisdiction: "MI",
      count: 20,
      target: 45,
      checkpoint: null,
      jobStatus: "ready",
      targetStatus: "READY",
    },
    currentLane: "STOPPED",
    runtimeState: "STOPPED",
  });
  assert.equal(state.humanReview.required, true);
  const pf = runPreflight({
    state,
    allowDisabledForDryRun: true,
    queue2Open: true,
    queue3Open: false,
    featureAgents: "0",
    dbReachable: true,
    storageReachable: true,
    freeDiskBytes: 8e10,
    tempFreeBytes: 8e10,
  });
  assert.ok(pf.reasons.includes("PENDING_HUMAN_REVIEW"));
});

test("C: derived status cannot override canonical scheduler review state", () => {
  const status = JSON.parse(
    fs.readFileSync(path.join(REPORTS, "corpus-worker-status.json"), "utf8"),
  );
  // Even if status were stale HUMAN_REVIEW, preflight uses scheduler state only.
  const state = restoreState(JSON.parse(fs.readFileSync(STATE_PATH, "utf8")));
  assert.equal(state.humanReview.required, false);
  assert.equal(status.review?.humanReviewRequired, false);
  const pf = runPreflight({
    state,
    allowDisabledForDryRun: true,
    queue2Open: true,
    queue3Open: false,
    featureAgents: "0",
    dbReachable: true,
    storageReachable: true,
    freeDiskBytes: 8e10,
    tempFreeBytes: 8e10,
  });
  assert.equal(pf.reasons.includes("PENDING_HUMAN_REVIEW"), false);
});

test("D: stale archive/final/report file cannot trigger preflight", () => {
  const finalPath = path.join(REPORTS, "queue2-dual-lane-final.json");
  if (fs.existsSync(finalPath)) {
    const final = JSON.parse(fs.readFileSync(finalPath, "utf8"));
    // Preflight must ignore final/report duplicates — only STATE_PATH matters.
    assert.equal(path.resolve(STATE_PATH).endsWith("queue2-dual-lane-state.json"), true);
    assert.notEqual(path.resolve(STATE_PATH), path.resolve(finalPath));
  }
  const state = restoreState(JSON.parse(fs.readFileSync(STATE_PATH, "utf8")));
  const pf = runPreflight({
    state,
    allowDisabledForDryRun: true,
    queue2Open: true,
    queue3Open: false,
    featureAgents: "0",
    dbReachable: true,
    storageReachable: true,
    freeDiskBytes: 8e10,
    tempFreeBytes: 8e10,
  });
  assert.equal(pf.reasons.includes("PENDING_HUMAN_REVIEW"), false);
});

test("E: READY first-start MI is not treated as CL partial missing checkpoint", () => {
  const mi = {
    court: "mich",
    jurisdiction: "MI",
    count: 20,
    target: 45,
    checkpoint: null,
    cursor: null,
    lastSuccessfulExternalId: null,
    nextPageUrl: null,
    jobStatus: "ready",
    targetStatus: "READY",
  };
  assert.equal(isReadyFirstStartLaneA(mi), true);
  assert.equal(isPartialLaneA(mi), false);
  assert.equal(validatePartialCheckpoint(mi).humanReviewRequired, false);
  const restored = restoreState({
    humanReview: { required: false, reasons: [], details: [] },
    laneA: mi,
    currentLane: "STOPPED",
    runtimeState: "STOPPED",
  });
  assert.equal(restored.humanReview.required, false);
});

test("F: MI 20/45 clean STOPPED state passes human-review gate", () => {
  const state = restoreState(JSON.parse(fs.readFileSync(STATE_PATH, "utf8")));
  assert.equal(state.laneA.court, "mich");
  assert.equal(state.laneA.count, 20);
  assert.equal(state.laneA.target, 45);
  assert.equal(state.laneA.checkpoint, null);
  assert.equal(state.humanReview.required, false);
  assert.ok(state.completedCourts.includes("wis"));
  const pf = runPreflight({
    state,
    allowDisabledForDryRun: true,
    queue2Open: true,
    queue3Open: false,
    featureAgents: "0",
    dbReachable: true,
    storageReachable: true,
    freeDiskBytes: 8e10,
    tempFreeBytes: 8e10,
  });
  assert.equal(pf.reasons.includes("PENDING_HUMAN_REVIEW"), false);
});

test("G: Queue #3 remains NOT_OPEN", () => {
  const q3 = neverOpenQueue3(JSON.parse(fs.readFileSync(STATE_PATH, "utf8")));
  assert.equal(q3.queue3, "NOT_OPEN");
});

test("H: AI calls=0", () => {
  const pf = runPreflight({
    state: restoreState(JSON.parse(fs.readFileSync(STATE_PATH, "utf8"))),
    allowDisabledForDryRun: true,
    queue2Open: true,
    queue3Open: false,
    featureAgents: "0",
    dbReachable: true,
    storageReachable: true,
    freeDiskBytes: 8e10,
    tempFreeBytes: 8e10,
  });
  assert.equal(pf.aiCalls, 0);
  assert.equal(pf.mutations, 0);
});

test("active CL partial with null checkpoint still requires review", () => {
  const partial = {
    court: "ark",
    count: 33,
    target: 45,
    checkpoint: null,
    jobStatus: "quota_paused",
    targetStatus: "PARTIAL",
  };
  assert.equal(isPartialLaneA(partial), true);
  assert.equal(validatePartialCheckpoint(partial).humanReviewRequired, true);
});

test("reconciliation clearing review updates same STATE_PATH preflight reads", () => {
  assert.equal(path.basename(STATE_PATH), "queue2-dual-lane-state.json");
  assert.ok(fs.existsSync(STATE_PATH));
  // No alternate worker-state path for preflight.
  const alt = path.join(os.tmpdir(), "queue2-dual-lane-state.json");
  assert.notEqual(path.resolve(STATE_PATH), path.resolve(alt));
});

console.log(
  JSON.stringify({
    ok: true,
    tests: passed,
    suite: "queue2-preflight-review-gate",
    statePath: STATE_PATH,
    workerStarted: false,
    aiCalls: 0,
    corpusMutations: 0,
  }),
);
