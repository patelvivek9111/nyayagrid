/**
 * Queue #2 observability + checkpoint hardening tests (deterministic, no network).
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createInitialState,
  restoreState,
  persistLaneAProgress,
  applyDurableJobCheckpoint,
  applyQuotaFloorTransition,
  applyQuotaRecoveryTransition,
  decideLane,
  HUMAN_REVIEW_REASONS,
} = require("./queue2-dual-lane-controller.cjs");
const {
  validatePartialCheckpoint,
  isPartialLaneA,
  hasDurableCheckpoint,
  reconcileLaneAFromJob,
  evaluateHumanReviewTriggers,
  isHeartbeatStale,
  buildOperatorStatus,
  renderDailyMarkdown,
  makeEvent,
  appendEventLine,
  formatHeartbeat,
  shouldEmitHeartbeat,
  writeObservabilityArtifacts,
  STATUS_LANES,
  HEARTBEAT_INTERVAL_MS,
  STALE_HEARTBEAT_MS,
  wouldRegressCorpusTotals,
  protectCorpusTotalsFromRegression,
  resolveCorpusTotalsForStatus,
  isCanonicalReportsDir,
  CANONICAL_REPORTS_DIR,
} = require("./queue2-worker-observability.cjs");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("partial court requires checkpoint", () => {
  const bad = validatePartialCheckpoint({ court: "ark", count: 33, target: 45, checkpoint: null });
  assert.equal(bad.ok, false);
  assert.equal(bad.humanReviewRequired, true);
  assert.equal(bad.reason, HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT);

  const good = validatePartialCheckpoint({
    court: "ark",
    count: 33,
    target: 45,
    lastSuccessfulExternalId: "cl-opinion-9885161",
  });
  assert.equal(good.ok, true);
  assert.equal(good.laneA.checkpoint, "cl-opinion-9885161");
});

test("persistLaneAProgress refuses null checkpoint on partial", () => {
  let state = createInitialState();
  state.currentLane = "A";
  const blocked = persistLaneAProgress(state, { court: "ark", count: 33, target: 45, checkpoint: null });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.state.humanReview.required, true);
  assert.ok(blocked.state.humanReview.reasons.includes(HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT));

  const ok = persistLaneAProgress(state, {
    court: "ark",
    count: 33,
    target: 45,
    lastSuccessfulExternalId: "cl-opinion-9885161",
    cursor: "cl-opinion-9885160",
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.state.laneA.checkpoint, "cl-opinion-9885161");
});

test("checkpoint recovery from durable job row", () => {
  let state = createInitialState();
  state.laneA = { ...state.laneA, court: "ark", jurisdiction: "AR", count: 33, target: 45, checkpoint: null };
  const job = {
    cl_court: "ark",
    status: "quota_paused",
    cursor: "cl-opinion-9885160",
    last_successful_external_id: "cl-opinion-9885161",
    next_page_url: "https://www.courtlistener.com/api/rest/v4/opinions/?cursor=cD05ODc5OTkx",
    items_imported: 25,
    target_max: 45,
    updated_at: "2026-09-24T03:55:31.381Z",
  };
  const rec = applyDurableJobCheckpoint(state, job, {
    count: 33,
    jurisdiction: "AR",
    mappingStatus: "VERIFIED",
    manifestVersion: 1,
    runner: "staging-cl-batch-job",
  });
  assert.equal(rec.ok, true);
  assert.equal(rec.state.laneA.checkpoint, "cl-opinion-9885161");
  assert.equal(rec.state.laneA.cursor, "cl-opinion-9885160");
  assert.equal(rec.state.laneA.mappingStatus, "VERIFIED");
  assert.equal(rec.state.humanReview.required, false);
});

test("restoreState marks HUMAN_REVIEW when partial+null checkpoint", () => {
  const restored = restoreState({
    currentLane: "A",
    laneA: { court: "ark", jurisdiction: "AR", count: 33, target: 45, checkpoint: null },
  });
  assert.equal(restored.humanReview.required, true);
  assert.equal(restored.currentLane, "B");
  assert.ok(
    restored.humanReview.reasons.includes(HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT),
  );
});

test("restart recovery preserves lane/court/count/target/checkpoint/quota/offline", () => {
  let state = createInitialState(new Date("2026-09-24T16:00:00.000Z"));
  state = applyDurableJobCheckpoint(
    state,
    {
      cl_court: "ark",
      status: "quota_paused",
      cursor: "cl-opinion-9885160",
      last_successful_external_id: "cl-opinion-9885161",
      next_page_url: "https://example.test/page",
      items_imported: 25,
      target_max: 45,
      updated_at: "2026-09-24T03:55:31.381Z",
    },
    { count: 33, jurisdiction: "AR", mappingStatus: "VERIFIED", manifestVersion: 1 },
  ).state;
  state = applyQuotaFloorTransition(state, {
    safeRequests: 0,
    court: "ark",
    checkpoint: state.laneA.checkpoint,
    lastSuccessfulExternalId: state.laneA.lastSuccessfulExternalId,
    cursor: state.laneA.cursor,
    nextPageUrl: state.laneA.nextPageUrl,
    count: 33,
    target: 45,
    now: new Date("2026-09-24T16:05:00.000Z"),
    projectedUsefulAt: "2026-09-24T22:06:00.000Z",
  });
  state.laneB.task = "us_reports_gap_analysis";
  state.laneB.checkpoint = "scorecard-v1";
  const json = JSON.stringify(state);
  const restored = restoreState(JSON.parse(json));
  assert.equal(restored.currentLane, "B");
  assert.equal(restored.laneA.court, "ark");
  assert.equal(restored.laneA.count, 33);
  assert.equal(restored.laneA.target, 45);
  assert.equal(restored.laneA.checkpoint, "cl-opinion-9885161");
  assert.ok(restored.quota.nextCheckAt);
  assert.equal(restored.laneB.task, "us_reports_gap_analysis");
  assert.equal(restored.laneB.checkpoint, "scorecard-v1");
});

test("decideLane blocks Lane A when checkpoint missing", () => {
  const state = createInitialState();
  state.laneA = { ...state.laneA, court: "ark", count: 33, target: 45, checkpoint: null };
  const d = decideLane(state, { safeRequests: 100, now: new Date() });
  assert.equal(d.lane, "B");
  assert.equal(d.needsHumanReview, true);
});

test("quota recovery resumes only with durable checkpoint", () => {
  let state = createInitialState();
  state = applyDurableJobCheckpoint(
    state,
    {
      cl_court: "ark",
      cursor: "cl-opinion-9885160",
      last_successful_external_id: "cl-opinion-9885161",
      status: "quota_paused",
      updated_at: "2026-09-24T03:55:31.381Z",
      target_max: 45,
    },
    { count: 33, jurisdiction: "AR" },
  ).state;
  state = applyQuotaFloorTransition(state, {
    safeRequests: 0,
    checkpoint: state.laneA.checkpoint,
    lastSuccessfulExternalId: state.laneA.lastSuccessfulExternalId,
    count: 33,
    target: 45,
  });
  const { state: recovered, decision } = applyQuotaRecoveryTransition(state, { safeRequests: 80 });
  assert.equal(decision.lane, "A");
  assert.equal(recovered.currentLane, "A");
  assert.equal(recovered.laneA.checkpoint, "cl-opinion-9885161");
});

test("status schema includes required operator fields", () => {
  const state = createInitialState();
  state.laneA.court = "ark";
  state.laneA.jurisdiction = "AR";
  state.laneA.count = 33;
  state.laneA.target = 45;
  state.laneA.checkpoint = "cl-opinion-9885161";
  const status = buildOperatorStatus({
    state,
    corpus: { authorities: 2966, cases: 1649, clCases: 1604, statutes: 904, regulations: 158, rules: 254, authorityGateDeficit: 51 },
    health: { database: "ok", orphanCount: 0, duplicateSourceIdCount: 0, featureAgents: "0", retrieval: "ok" },
  });
  for (const key of [
    "currentLane",
    "currentTask",
    "currentCourt",
    "currentJurisdiction",
    "currentCount",
    "targetCount",
    "checkpoint",
    "laneStartedAt",
    "lastUpdatedAt",
    "nextQuotaCheckAt",
    "quota",
    "today",
    "corpus",
    "health",
    "review",
  ]) {
    assert.ok(key in status, `missing ${key}`);
  }
  assert.ok(STATUS_LANES.includes(status.currentLane));
  assert.equal(status.featureAgents, "0");
  assert.equal(status.review.humanReviewRequired, false);
});

test("event log append is append-only JSONL", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "q2-obs-"));
  const file = path.join(dir, "events.jsonl");
  appendEventLine(file, makeEvent("WORKER_START", { lane: "B", task: "boot" }));
  appendEventLine(file, makeEvent("QUOTA_FLOOR", { lane: "B", court: "ark", reason: "quota_floor" }));
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).type, "WORKER_START");
  assert.equal(JSON.parse(lines[1]).type, "QUOTA_FLOOR");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("human-review triggers (and quota pause is not one)", () => {
  const routine = evaluateHumanReviewTriggers({ quotaFloor: true });
  assert.equal(routine.required, false);

  const missing = evaluateHumanReviewTriggers({ missingDurableCheckpoint: true });
  assert.ok(missing.reasons.includes(HUMAN_REVIEW_REASONS.MISSING_DURABLE_RESUME_CHECKPOINT));

  const high = evaluateHumanReviewTriggers({ reqPerAuthBatches: [3.1, 3.5, 4.0] });
  assert.ok(high.reasons.includes(HUMAN_REVIEW_REASONS.HIGH_REQUESTS_PER_AUTHORITY));

  const notYet = evaluateHumanReviewTriggers({ reqPerAuthBatches: [3.1, 2.0, 4.0] });
  assert.equal(notYet.reasons.includes(HUMAN_REVIEW_REASONS.HIGH_REQUESTS_PER_AUTHORITY), false);

  const complete = evaluateHumanReviewTriggers({ queue2CompletionCandidate: true });
  assert.ok(complete.reasons.includes(HUMAN_REVIEW_REASONS.QUEUE_2_COMPLETION_CANDIDATE));
});

test("stale heartbeat detection", () => {
  const now = new Date("2026-09-24T17:00:00.000Z");
  assert.equal(isHeartbeatStale(null, now), true);
  assert.equal(isHeartbeatStale(new Date(now.getTime() - STALE_HEARTBEAT_MS - 1).toISOString(), now), true);
  assert.equal(isHeartbeatStale(new Date(now.getTime() - 60_000).toISOString(), now), false);
  assert.equal(shouldEmitHeartbeat(new Date(now.getTime() - HEARTBEAT_INTERVAL_MS - 1).toISOString(), now), true);
  assert.equal(shouldEmitHeartbeat(new Date(now.getTime() - 60_000).toISOString(), now), false);
});

test("daily markdown surfaces lane and checkpoint quickly", () => {
  const status = buildOperatorStatus({
    state: {
      ...createInitialState(),
      currentLane: "B",
      laneA: {
        court: "ark",
        jurisdiction: "AR",
        count: 33,
        target: 45,
        checkpoint: "cl-opinion-9885161",
        lastSuccessfulExternalId: "cl-opinion-9885161",
        mappingStatus: "VERIFIED",
        runner: "staging-cl-batch-job",
      },
      quota: {
        nextCheckAt: "2026-09-24T22:06:14.563Z",
        lastSafeRequests: 0,
        hard429Count: 0,
        windows: { day: { remaining: 29, resetAt: "2026-09-24T22:06:14.563Z" } },
      },
      metrics: { nonClAuthorities: 6, citationsResolved: 44, laneBMs: 36000, laneAMs: 0, idleMs: 0 },
    },
  });
  const md = renderDailyMarkdown(status, { laneReason: "CourtListener day safety floor" });
  assert.match(md, /CURRENT LANE/);
  assert.match(md, /LANE_B_OFFLINE/);
  assert.match(md, /cl-opinion-9885161/);
  assert.match(md, /HUMAN REVIEW/);
  const hb = formatHeartbeat(status, new Date("2026-09-24T17:00:00.000Z"));
  assert.match(hb, /LANE_B_OFFLINE/);
});

test("writeObservabilityArtifacts writes status+daily+optional event", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "q2-obs-art-"));
  const status = buildOperatorStatus({ state: createInitialState() });
  writeObservabilityArtifacts(dir, status, {
    event: makeEvent("CHECKPOINT", { court: "ark", checkpoint: "cl-opinion-9885161" }),
  });
  assert.ok(fs.existsSync(path.join(dir, "corpus-worker-status.json")));
  assert.ok(fs.existsSync(path.join(dir, "corpus-worker-daily.md")));
  assert.ok(fs.existsSync(path.join(dir, "corpus-worker-events.jsonl")));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("anti-regression: stale fixture write cannot regress protected status totals", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "q2-obs-protect-"));
  const productionLike = buildOperatorStatus({
    state: createInitialState(),
    corpus: { authorities: 3008, cases: 1691, clCases: 1646, statutes: 904, regulations: 158, rules: 254 },
    manifestVersion: 9,
  });
  writeObservabilityArtifacts(dir, productionLike, { protectCorpusTotals: true });

  const staleFixture = buildOperatorStatus({
    state: createInitialState(),
    corpus: { authorities: 2966, cases: 1649, clCases: 1604, statutes: 904, regulations: 158, rules: 254 },
    manifestVersion: 1,
  });
  const result = writeObservabilityArtifacts(dir, staleFixture, { protectCorpusTotals: true });
  assert.equal(result.corpusProtectionApplied, true);

  const written = JSON.parse(fs.readFileSync(path.join(dir, "corpus-worker-status.json"), "utf8"));
  assert.equal(written.corpus.authorities, 3008);
  assert.equal(written.corpus.cases, 1691);
  assert.equal(written.corpus.clCases, 1646);
  assert.equal(written.manifestVersion, 9);
  assert.equal(wouldRegressCorpusTotals(productionLike, staleFixture), true);

  const protectedMerged = protectCorpusTotalsFromRegression(productionLike, staleFixture);
  assert.equal(protectedMerged.corpus.authorities, 3008);
  assert.equal(protectedMerged.manifestVersion, 9);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("tests must not target canonical production reports dir", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "q2-obs-tmp-"));
  assert.equal(isCanonicalReportsDir(tmp), false);
  assert.equal(isCanonicalReportsDir(CANONICAL_REPORTS_DIR), true);
  // Observability unit tests always use temp dirs — never CANONICAL_REPORTS_DIR.
  assert.notEqual(path.resolve(tmp), path.resolve(CANONICAL_REPORTS_DIR));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("resolveCorpusTotalsForStatus never invents hardcoded 2966 fallback", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "q2-obs-resolve-"));
  const empty = resolveCorpusTotalsForStatus({ reportsDir: dir, corpus: null });
  assert.equal(empty.source, "unavailable");
  assert.equal(empty.authorities, null);
  const explicit = resolveCorpusTotalsForStatus({
    reportsDir: dir,
    corpus: { authorities: 3008, cases: 1691, clCases: 1646 },
  });
  assert.equal(explicit.source, "explicit");
  assert.equal(explicit.authorities, 3008);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("reconcileLaneAFromJob never invents checkpoint", () => {
  const empty = reconcileLaneAFromJob({ court: "ark", count: 33, target: 45 }, { cl_court: "ark", status: "paused" });
  assert.equal(empty.reconciled, false);
  assert.equal(hasDurableCheckpoint(empty.state), false);
  assert.equal(isPartialLaneA(empty.state), true);
});

test("canonical status after rebuild matches live floor and WI durable progress", () => {
  const status = JSON.parse(
    fs.readFileSync(path.join(CANONICAL_REPORTS_DIR, "corpus-worker-status.json"), "utf8"),
  );
  const state = JSON.parse(
    fs.readFileSync(path.join(CANONICAL_REPORTS_DIR, "queue2-dual-lane-state.json"), "utf8"),
  );
  assert.ok(status.corpus.authorities >= 3006);
  assert.ok(status.corpus.cases >= 1689);
  assert.ok(status.corpus.clCases >= 1644);
  assert.ok(status.manifestVersion >= 5);
  assert.equal(status.currentCount, 44);
  assert.equal(status.targetCount, 45);
  assert.equal(status.checkpoint, "cl-opinion-9886466");
  assert.equal(status.runtimeState, "STOPPED");
  assert.equal(status.review.humanReviewRequired, false);
  assert.equal(state.laneA.count, 44);
  assert.equal(state.laneA.checkpoint, "cl-opinion-9886466");
  assert.equal(state.humanReview.required, false);
});

console.log(JSON.stringify({ ok: true, tests: passed }));
