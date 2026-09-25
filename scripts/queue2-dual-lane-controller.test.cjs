const assert = require("node:assert/strict");
const {
  createInitialState,
  restoreState,
  remainingRequestsToFinishCourt,
  hasUsefulClCapacity,
  decideLane,
  applyQuotaFloorTransition,
  applyQuotaRecoveryTransition,
  acquireLaneALock,
  releaseLaneALock,
  recordLaneTime,
  completeLaneBTask,
  isCourtListenerUrl,
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
  USEFUL_CL_MIN,
  LANE_A_SEQUENCE,
} = require("./queue2-dual-lane-controller.cjs");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("lane B produces zero CL requests — guard throws locally", async () => {
  const g = { fetch: async () => ({ ok: true, status: 200 }) };
  installLaneBFetchGuard(g);
  let blocked = 0;
  for (const url of [
    "https://www.courtlistener.com/api/rest/v4/opinions/?page_size=1",
    "https://www.courtlistener.com/api/rest/v4/clusters/",
    "https://www.courtlistener.com/api/rest/v4/dockets/",
    "https://www.courtlistener.com/api/rest/v4/courts/ark/",
    "https://www.courtlistener.com/api/rest/v4/search/",
    "https://www.courtlistener.com/api/rest/v4/api-usage/",
  ]) {
    await assert.rejects(() => g.fetch(url), /LANE_B_CL_BLOCKED/);
    blocked += 1;
  }
  assert.equal(blocked, 6);
  const allowed = await g.fetch("https://uscode.house.gov/view.xhtml?req=test");
  assert.equal(allowed.status, 200);
  uninstallLaneBFetchGuard(g);
});

test("assertLaneBUrlAllowed rejects CL hosts", () => {
  assert.throws(() => assertLaneBUrlAllowed("https://www.courtlistener.com/api/rest/v4/opinions/"), /LANE_B_CL_BLOCKED/);
  assert.equal(isCourtListenerUrl("https://www.ecfr.gov/api/versioner/v1/titles.json"), false);
});

test("quota-floor transition stays in worker and switches to Lane B", () => {
  const state = createInitialState(new Date("2026-09-24T16:00:00.000Z"));
  state.currentLane = "A";
  state.laneA.court = "ark";
  state.laneA.checkpoint = "cl-opinion-111";
  state.laneA.count = 33;
  const next = applyQuotaFloorTransition(state, {
    safeRequests: 0,
    court: "ark",
    checkpoint: "cl-opinion-111",
    count: 33,
    target: 45,
    reason: "quota_floor",
    now: new Date("2026-09-24T16:05:00.000Z"),
    projectedUsefulAt: "2026-09-24T22:06:00.000Z",
  });
  assert.equal(next.currentLane, "B");
  assert.equal(next.laneA.court, "ark");
  assert.equal(next.laneA.checkpoint, "cl-opinion-111");
  assert.equal(next.laneA.count, 33);
  assert.equal(next.laneA.lock, null);
  assert.equal(next.switches.at(-1).to, "B");
});

test("quota-recovery transition resumes Lane A without human prompt when capacity is useful", () => {
  let state = createInitialState(new Date("2026-09-24T16:00:00.000Z"));
  state = applyQuotaFloorTransition(state, {
    safeRequests: 0,
    court: "ark",
    checkpoint: "cl-opinion-111",
    count: 33,
    target: 45,
    now: new Date("2026-09-24T16:05:00.000Z"),
  });
  assert.equal(state.currentLane, "B");
  const { state: recovered, decision } = applyQuotaRecoveryTransition(state, {
    safeRequests: 40,
    now: new Date("2026-09-24T22:10:00.000Z"),
  });
  assert.equal(decision.lane, "A");
  assert.equal(recovered.currentLane, "A");
  assert.equal(recovered.laneA.checkpoint, "cl-opinion-111");
  assert.equal(recovered.laneA.court, "ark");
});

test("persisted restart restores lane, court, checkpoint, and next quota check", () => {
  const saved = applyQuotaFloorTransition(createInitialState(), {
    safeRequests: 3,
    court: "ark",
    checkpoint: "cl-opinion-222",
    count: 33,
    target: 45,
    now: new Date("2026-09-24T16:05:00.000Z"),
    projectedUsefulAt: "2026-09-24T22:06:00.000Z",
  });
  const json = JSON.stringify(saved);
  const restored = restoreState(JSON.parse(json));
  assert.equal(restored.currentLane, "B");
  assert.equal(restored.laneA.court, "ark");
  assert.equal(restored.laneA.checkpoint, "cl-opinion-222");
  assert.equal(restored.laneA.target, 45);
  assert.ok(restored.quota.nextCheckAt);
  assert.equal(restored.queue, "#2");
  assert.equal(restored.queue3, "NOT_OPEN");
});

test("single CL worker lock rejects a second Lane A acquirer", () => {
  const now = new Date("2026-09-24T16:00:00.000Z");
  const first = acquireLaneALock(createInitialState(now), "worker-1", now);
  assert.equal(first.ok, true);
  const second = acquireLaneALock(first.state, "worker-2", now);
  assert.equal(second.ok, false);
  assert.equal(second.reason, "lane_a_already_running");
  const released = releaseLaneALock(first.state, "worker-1", now);
  assert.equal(released.ok, true);
  const third = acquireLaneALock(released.state, "worker-2", now);
  assert.equal(third.ok, true);
});

test("useful-capacity rule: adaptive micro-batch and finish-target replace fixed 25 gate", () => {
  const state = createInitialState();
  state.currentLane = "B";
  state.laneA.count = 0;
  state.laneA.target = 45;
  // Usable 4 (>= micro minimum 3) may start a bounded MICRO_BATCH — not blocked by old 25 gate.
  const drip = decideLane(state, { safeRequests: 4, now: new Date() });
  assert.equal(drip.lane, "A");
  assert.equal(drip.quotaMode, "MICRO_BATCH");
  const batch = decideLane(state, { safeRequests: USEFUL_CL_MIN, now: new Date() });
  assert.equal(batch.lane, "A");
  const finish = createInitialState();
  finish.laneA.count = 40;
  finish.laneA.target = 45;
  finish.laneA.checkpoint = "cl-opinion-finish";
  finish.laneA.lastSuccessfulExternalId = "cl-opinion-finish";
  const remaining = remainingRequestsToFinishCourt(finish.laneA);
  assert.ok(remaining > 0 && remaining < USEFUL_CL_MIN);
  const enoughToFinish = decideLane(finish, { safeRequests: remaining, now: new Date() });
  assert.equal(enoughToFinish.lane, "A");
  assert.ok(
    enoughToFinish.reason === "finish_partial_court" ||
      enoughToFinish.quotaMode === "FINISH_TARGET" ||
      enoughToFinish.quotaMode === "MICRO_BATCH",
  );
});

test("checkpoint preservation across floor and recovery", () => {
  let state = createInitialState();
  state.currentLane = "A";
  state.laneA.court = "ark";
  state.laneA.checkpoint = "cursor-xyz";
  state.laneA.count = 33;
  state = applyQuotaFloorTransition(state, {
    safeRequests: 0,
    checkpoint: "cursor-xyz",
    court: "ark",
    count: 33,
    target: 45,
  });
  const { state: recovered } = applyQuotaRecoveryTransition(state, { safeRequests: 80 });
  assert.equal(recovered.laneA.checkpoint, "cursor-xyz");
  assert.equal(recovered.laneA.court, "ark");
  assert.deepEqual(
    recovered.laneA.sequence,
    LANE_A_SEQUENCE.map((s) => s.court),
  );
});

test("idempotent non-CL intake keys and no duplicate embeddings or citation edges", () => {
  const edges = new Set();
  const first = insertUnique(
    edges,
    uniqueCitationEdgeKey({ fromAuthorityId: "a", normalizedCitation: "28 U.S.C. § 1331", pinpoint: null }),
  );
  const dup = insertUnique(
    edges,
    uniqueCitationEdgeKey({ fromAuthorityId: "a", normalizedCitation: "28 U.S.C. § 1331", pinpoint: "" }),
  );
  assert.equal(first.inserted, true);
  assert.equal(dup.duplicate, true);

  const embeds = new Set();
  const e1 = insertUnique(
    embeds,
    uniqueEmbeddingKey({ authorityId: "auth-1", chunkIndex: 0, content: "hello statute" }),
  );
  const e2 = insertUnique(
    embeds,
    uniqueEmbeddingKey({ authorityId: "auth-1", chunkIndex: 0, content: "hello statute" }),
  );
  assert.equal(e1.inserted, true);
  assert.equal(e2.duplicate, true);
});

test("Lane B task checkpoint advances without CL", () => {
  let state = createInitialState();
  state = completeLaneBTask(state, "us_reports_gap_analysis", "us-reports-v1", new Date(), {
    minimumIntervalMs: 21600000,
  });
  assert.ok(state.laneB.tasksCompleted.includes("us_reports_gap_analysis"));
  assert.equal(state.laneB.checkpoint, "us-reports-v1");
  assert.equal(state.laneB.task, "NONE");
  assert.equal(state.idleSafe, true);
  assert.ok(state.laneB.lastByTask.us_reports_gap_analysis);
  assert.ok(state.laneB.nextEligibleAt.us_reports_gap_analysis);
});

test("idle metrics stay zero when Lane B records work time", () => {
  let state = createInitialState();
  state = recordLaneTime(state, "B", 12_000, { nonClAuthorities: 3, citationsResolved: 2 });
  assert.equal(state.metrics.idleMs, 0);
  assert.equal(state.metrics.laneBMs, 12_000);
  assert.equal(state.metrics.nonClAuthorities, 3);
});

test("depth classes and historical holes", () => {
  assert.equal(classifyDepth({ authorityDeficitTo101: 90, intermediateAppellate: 0 }), "CRITICAL_DEPTH");
  assert.equal(classifyDepth({ authorityDeficitTo101: 45, intermediateAppellate: 2 }), "HIGH_DEPTH");
  assert.equal(classifyDepth({ authorityDeficitTo101: 20, intermediateAppellate: 8 }), "MEDIUM_DEPTH");
  assert.equal(classifyDepth({ authorityDeficitTo101: 0, intermediateAppellate: 10 }), "LOW_DEPTH");
  const holes = detectHistoricalHoles({ years: [2026, 2026, 2026], nowYear: 2026, uniqueCourts: 1 });
  assert.ok(holes.flags.some((f) => f.kind === "recent_only"));
  assert.ok(holes.targetRanges.includes("pre-2000"));
});

test("U.S. Reports ranking does not fabricate identities", () => {
  const ranked = rankMissingUsReports(
    [
      { normalizedCitation: "347 U.S. 483", inbound: 4 },
      { normalizedCitation: "347 U.S. 483", inbound: 1 },
      { rawCitation: "5 U.S.C. § 706" },
      { normalizedCitation: "410 U.S. 113", inbound: 2 },
    ],
    ["347 U.S. 483"],
  );
  assert.equal(ranked[0].citation, "347 U.S. 483");
  assert.equal(ranked[0].inbound, 5);
  assert.equal(ranked[0].alreadyPresentUnderAlias, true);
  assert.equal(ranked[0].estimatedDecisionIdentity, null);
  assert.equal(ranked[1].citation, "410 U.S. 113");
  assert.equal(parseUsReportsCitation("not a case"), null);
});

test("intermediate gaps stay unresolved without local evidence", () => {
  const rows = researchIntermediateGaps();
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.classification === "UNRESOLVED"));
  assert.ok(rows.every((r) => r.candidateClId == null));
  const promoted = classifyIntermediateCandidate({
    invalidCandidateId: "pacommwlth",
    positiveLocalEvidence: { candidateClId: "pacomm", evidence: "local dump" },
  });
  assert.equal(promoted.classification, "CANDIDATE_NEEDS_SINGLE_CL_VERIFY");
});

console.log(JSON.stringify({ ok: true, tests: passed }));
