/**
 * Queue #2 recovery readiness after Neon DATABASE_QUOTA_BLOCKED.
 * Deterministic. Zero CourtListener HTTP. Zero corpus mutations. Zero AI.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  planDatabaseQuotaRecovery,
  classifyTargetJobReadiness,
  normalizeCanonicalCounts,
  targetProgressFromCounts,
  assertPageSubsetCheckpointSemantics,
  evaluateIngestDbWriteReadiness,
  FIRST_RECOVERY_CANARY,
  VT_READINESS,
  RECOVERY_STEP_ORDER,
} = require("./queue2-recovery-path.cjs");
const { resolveLaneABatchBounds, canonicalLaneACount, namedLaneACounts } = require("./queue2-lane-a-dispatch.cjs");
const { assertLauncherForbidsDetach, maySpawnLaneARemoteChild } = require("./queue2-lane-a-remote-child.cjs");
const { CANARY_MAX_SESSION_CL_REQUESTS } = require("./queue2-lane-a-child-lifecycle.cjs");
const { pageResumeUrl } = require("./cl-batch-resume-cursor.cjs");

const ROOT = path.join(__dirname, "..");
const MANIFEST = path.join(ROOT, "packages/research/corpus/reports/queue2-lane-a-depth-manifest.json");
const STATE = path.join(ROOT, "packages/research/corpus/reports/queue2-dual-lane-state.json");
const NOW = new Date("2026-09-27T03:30:00.000Z");
const NEON = {
  ok: false,
  code: "53000",
  message: "Your account or project has exceeded the quota. Upgrade your plan to increase limits.",
  mutations: 0,
  courtListenerHttpCalls: 0,
};

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} ${name}`);
}

function load(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function blockedState() {
  const state = load(STATE);
  state.databaseBlock = {
    classification: "DATABASE_QUOTA_BLOCKED",
    since: "2026-09-27T02:02:30.000Z",
    recovered: false,
  };
  state.dbWriteReady = false;
  state.laneAStatus = "BLOCKED";
  return state;
}

test("DB blocked → recovery does not launch CourtListener or children", () => {
  const plan = planDatabaseQuotaRecovery({
    state: blockedState(),
    manifest: load(MANIFEST),
    dbProbe: NEON,
    now: NOW,
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.blocked, true);
  assert.equal(plan.allowCourtListener, false);
  assert.equal(plan.clRequests, 0);
  assert.equal(plan.childLaunches, 0);
  assert.equal(plan.mutations, 0);
  assert.equal(plan.aiCalls, 0);
  assert.equal(plan.queue3, "NOT_OPEN");
  assert.equal(plan.steps[0].id, "DB_WRITE_READY");
  assert.equal(plan.steps[0].ok, false);
});

test("DB recovers → manifest refresh before target selection; stale SC laneA → VT", () => {
  const plan = planDatabaseQuotaRecovery({
    state: blockedState(),
    manifest: load(MANIFEST),
    dbProbe: { ok: true, writable: true, mutations: 0 },
    remoteProcesses: [],
    targetJob: null,
    now: NOW,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.steps.find((s) => s.id === "REFRESH_MANIFEST").ok, true);
  assert.equal(plan.steps.find((s) => s.id === "SELECT_TARGET").ok, true);
  const refreshIdx = plan.steps.findIndex((s) => s.id === "REFRESH_MANIFEST");
  const selectIdx = plan.steps.findIndex((s) => s.id === "SELECT_TARGET");
  assert.ok(refreshIdx < selectIdx);
  assert.equal(plan.nextTarget.court, "mo");
  assert.equal(plan.nextTarget.jurisdiction, "MO");
  assert.ok(
    plan.nextTarget.qualifyingCaseCount >= 20 && plan.nextTarget.qualifyingCaseCount <= 45,
    `qualifyingCaseCount=${plan.nextTarget.qualifyingCaseCount}`,
  );
  assert.equal(plan.nextTarget.target, 45);
  assert.equal(plan.nextTarget.mappingStatus, "VERIFIED");
  assert.equal(plan.state.laneA.court, "mo");
  assert.notEqual(plan.state.laneA.court, "wva");
  assert.deepEqual(plan.inventedCheckpoints, []);
  assert.equal(plan.queue2, "#2");
  assert.equal(plan.queue3, "NOT_OPEN");
});

test("manual progress can change MO count before resume; already complete skips MO", () => {
  const manifest = load(MANIFEST);
  const drifted = planDatabaseQuotaRecovery({
    state: blockedState(),
    manifest,
    dbProbe: { ok: true, writable: true, mutations: 0 },
    liveCountsByCourt: { mo: { qualifyingCaseCount: 28, clCaseCount: 28, authorityCount: 49 } },
    remoteProcesses: [],
    now: NOW,
  });
  assert.equal(drifted.nextTarget.court, "mo");
  assert.equal(drifted.nextTarget.qualifyingCaseCount, 28);
  assert.equal(drifted.state.laneA.qualifyingCaseCount, 28);

  const done = planDatabaseQuotaRecovery({
    state: blockedState(),
    manifest,
    dbProbe: { ok: true, writable: true, mutations: 0 },
    liveCountsByCourt: { mo: { qualifyingCaseCount: 45, clCaseCount: 45 } },
    remoteProcesses: [],
    now: NOW,
  });
  assert.notEqual(done.nextTarget.court, "mo");
  assert.ok(done.state.completedCourts.includes("mo"));
  assert.ok(done.state.completedCourts.includes("wva"));
});

test("VT READY_FIRST_START / PAUSED_RESUMABLE / invalid HOLD", () => {
  const none = classifyTargetJobReadiness({ court: "vt", job: null });
  assert.equal(none.classification, VT_READINESS.READY_FIRST_START);
  assert.equal(none.safeFirstStart, true);
  assert.equal(none.fields.cursor, null);

  const paused = classifyTargetJobReadiness({
    court: "vt",
    job: {
      status: "quota_paused",
      cursor: "cl-opinion-11100000",
      next_page_url: "https://www.courtlistener.com/api/rest/v4/opinions/?cursor=abc",
      last_successful_external_id: "cl-opinion-11100000",
      items_imported: 5,
      api_calls: 12,
      target_max: 45,
      batch_size: 5,
      last_error: null,
      started_at: "2026-09-26T20:00:00.000Z",
      updated_at: "2026-09-26T20:10:00.000Z",
    },
    ownerAlive: false,
  });
  assert.equal(paused.classification, VT_READINESS.PAUSED_RESUMABLE);
  assert.equal(paused.safeResume, true);
  assert.equal(paused.fields.cursor, "cl-opinion-11100000");
  assert.equal(paused.fields.items_imported, 5);
  assert.equal(paused.fields.api_calls, 12);
  assert.equal(paused.fields.target_max, 45);

  const bad = classifyTargetJobReadiness({
    court: "vt",
    job: {
      status: "quota_paused",
      items_imported: 20,
      cursor: null,
      next_page_url: null,
      last_successful_external_id: null,
    },
  });
  assert.equal(bad.classification, VT_READINESS.HOLD);
  assert.equal(bad.hold, true);

  const blocked = classifyTargetJobReadiness({
    court: "vt",
    inspection: { blocked: true, classification: "DATABASE_QUOTA_BLOCKED", reason: "DATABASE_QUOTA_BLOCKED" },
  });
  assert.equal(blocked.classification, VT_READINESS.LIVE_INSPECTION_BLOCKED);
});

test("qualifyingCaseCount controls completion; cl/total cannot falsely complete", () => {
  const named = normalizeCanonicalCounts({
    qualifyingCaseCount: 20,
    clCaseCount: 45,
    totalCaseCount: 50,
    authorityCount: 41,
  });
  assert.equal(named.qualifyingCaseCount, 20);
  assert.equal(named.clCaseCount, 45);
  assert.equal(named.totalCaseCount, 50);
  assert.equal(named.authorityCount, 41);
  const progress = targetProgressFromCounts(named, 45);
  assert.equal(progress.targetSatisfied, false);
  assert.equal(progress.remaining, 25);

  assert.equal(canonicalLaneACount({ db: { clCases: 45, cases: 50 } }), null);
  assert.equal(canonicalLaneACount({ db: { qualifyingCases: 20, clCases: 45, cases: 50 } }), 20);
  const fields = namedLaneACounts({
    db: { qualifyingCases: 20, clCases: 19, cases: 22, authorities: 41 },
  });
  assert.equal(fields.qualifyingCaseCount, 20);
  assert.equal(fields.clCaseCount, 19);
  assert.equal(fields.totalCaseCount, 22);
  assert.equal(fields.authorityCount, 41);

  const complete = targetProgressFromCounts(
    normalizeCanonicalCounts({ qualifyingCaseCount: 45, clCaseCount: 40, totalCaseCount: 40 }),
    45,
  );
  assert.equal(complete.targetSatisfied, true);
});

test("first recovery canary <=2 authorities and <=5 CL; one parent probe; child bootstrap off", () => {
  assert.equal(FIRST_RECOVERY_CANARY.maxQualifyingAuthorities, 2);
  assert.equal(FIRST_RECOVERY_CANARY.maxClRequests, 5);
  assert.equal(FIRST_RECOVERY_CANARY.maxParentQuotaProbes, 1);
  assert.equal(FIRST_RECOVERY_CANARY.childBootstrapUsage, "0");
  assert.equal(CANARY_MAX_SESSION_CL_REQUESTS, 5);
  const bounds = resolveLaneABatchBounds({
    canaryRequired: true,
    maxQualifyingAuthorities: FIRST_RECOVERY_CANARY.maxQualifyingAuthorities,
    maxClRequests: FIRST_RECOVERY_CANARY.maxClRequests,
    remainingAuthorities: 25,
    usableRequests: 28,
    requestsPerAuthorityEstimate: 2.3,
  });
  assert.ok(bounds.authorities <= 2);
  assert.ok(bounds.maxClRequests <= 5);
  assert.equal(bounds.caps.canaryAuth, 2);
  assert.equal(bounds.caps.canaryReq, 5);

  const plan = planDatabaseQuotaRecovery({
    state: blockedState(),
    manifest: load(MANIFEST),
    dbProbe: { ok: true, writable: true, mutations: 0 },
    remoteProcesses: [],
    now: NOW,
  });
  assert.equal(plan.canary.maxQualifyingAuthorities, 2);
  assert.equal(plan.canary.maxClRequests, 5);
  assert.equal(plan.parentQuotaProbesAllowed, 1);
  assert.equal(plan.childBootstrapUsage, "0");
  assert.equal(plan.state.canary.firstRecovery, true);
  assert.deepEqual(
    plan.stepOrder,
    RECOVERY_STEP_ORDER,
  );
});

test("process gate before CL; attached child invariants unchanged", () => {
  const orphan = planDatabaseQuotaRecovery({
    state: blockedState(),
    manifest: load(MANIFEST),
    dbProbe: { ok: true, writable: true, mutations: 0 },
    remoteProcesses: [{ pid: 9, ppid: 1, args: "staging-cl-batch-job-bundled.cjs" }],
    now: NOW,
  });
  assert.equal(orphan.ok, false);
  assert.equal(orphan.allowCourtListener, false);
  assert.equal(orphan.clRequests, 0);
  assert.equal(orphan.childLaunches, 0);
  assert.equal(orphan.humanReview?.required ?? orphan.state.humanReview?.required, true);
  assert.ok(
    (orphan.state.humanReview?.reasons || []).includes("ORPHAN_LANE_A_CHILD") ||
      orphan.reason === "ORPHAN_LANE_A_CHILD",
  );

  const multi = planDatabaseQuotaRecovery({
    state: blockedState(),
    manifest: load(MANIFEST),
    dbProbe: { ok: true, writable: true, mutations: 0 },
    remoteProcesses: [
      { pid: 1, ppid: 1, args: "staging-cl-batch-job-bundled.cjs" },
      { pid: 2, ppid: 1, args: "staging-cl-batch-job-bundled.cjs" },
    ],
    now: NOW,
  });
  assert.equal(multi.ok, false);
  assert.equal(multi.allowCourtListener, false);
  assert.equal(multi.clRequests, 0);
  assert.equal(multi.reason, "MULTIPLE_LANE_A_CHILDREN");

  const launcher = fs.readFileSync(path.join(__dirname, "run-staging-cl-batch-job.cjs"), "utf8");
  assert.equal(assertLauncherForbidsDetach(launcher).ok, true);
  const spawn = maySpawnLaneARemoteChild(
    { laneAChild: { pid: 42, terminal: false, court: "vt" } },
    { allowLaunch: true },
  );
  assert.equal(spawn.ok, false);
});

test("worker process gate precedes parent quota probe (live path order)", () => {
  const src = fs.readFileSync(path.join(__dirname, "run-queue2-dual-lane.cjs"), "utf8");
  const cycleStart = src.indexOf("async function runWorkerCycle");
  const cycleEnd = src.indexOf("\nasync function sleepMs", cycleStart);
  const cycle = src.slice(cycleStart, cycleEnd > 0 ? cycleEnd : undefined);
  const sleepIdx = src.indexOf("async function sleepMs");
  assert.ok(sleepIdx > 0, "async sleepMs required");
  const sleepBody = src.slice(sleepIdx, sleepIdx + 800);
  assert.equal(/Atomics\.wait/.test(sleepBody), false, "blocking Atomics.wait sleep must be removed");
  assert.ok(src.includes("createInterruptibleSleep"), "interruptible sleep required");
  assert.ok(src.includes("shouldSkipWorkForShutdown"), "shutdown guards required");
  const preCl = cycle.indexOf("LANE_A_PROCESS_GATE_PRE_CL");
  const quotaFn = cycle.indexOf("runQuotaProbe(");
  const processGateBlocks = cycle.indexOf("processGateBlocksCl");
  assert.ok(preCl > 0, "missing LANE_A_PROCESS_GATE_PRE_CL");
  assert.ok(processGateBlocks > 0, "missing processGateBlocksCl");
  assert.ok(quotaFn > preCl, "runQuotaProbe must follow pre-CL process gate");
  assert.equal(cycle.includes("remoteProcesses: []"), false);
});

test("VT first-start clears inherited SC resume fields", () => {
  const state = blockedState();
  state.laneA = {
    court: "sc",
    jurisdiction: "SC",
    checkpoint: "cl-opinion-11201513",
    cursor: "cl-opinion-11201513",
    lastSuccessfulExternalId: "cl-opinion-11201513",
    targetStatus: "COMPLETE_FOR_CURRENT_DEPTH",
    jobStatus: "completed",
    count: 45,
    target: 45,
  };
  const plan = planDatabaseQuotaRecovery({
    state,
    manifest: load(MANIFEST),
    dbProbe: { ok: true, writable: true, mutations: 0 },
    remoteProcesses: [],
    targetJob: null,
    now: NOW,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.state.laneA.court, "mo");
  assert.equal(plan.state.laneA.jobLifecycle, "READY_FIRST_START");
  assert.equal(plan.state.laneA.checkpoint, null);
  assert.equal(plan.state.laneA.cursor, null);
  assert.equal(plan.state.laneA.lastSuccessfulExternalId, null);
  assert.equal(plan.state.laneA.nextPageUrl, null);
});

test("page subset checkpoint resumes from last opinion actually handled", () => {
  const discover =
    "https://www.courtlistener.com/api/rest/v4/opinions/?cluster__docket__court=vt&order_by=-id&page_size=20";
  const providerNext =
    "https://www.courtlistener.com/api/rest/v4/opinions/?cluster__docket__court=vt&cursor=cD0xMDk5OTk5OQ%3D%3D&order_by=-id&page_size=20";
  const check = assertPageSubsetCheckpointSemantics({
    processedCount: 2,
    hitCount: 20,
    nextPage: providerNext,
    discoverUrl: discover,
    lastSeenExternalId: "cl-opinion-11123456",
    pageSize: 5,
  });
  assert.equal(check.ok, true);
  assert.equal(check.skippedUnhandledItems, false);
  const url = pageResumeUrl({
    processedCount: 2,
    hitCount: 20,
    nextPage: providerNext,
    discoverUrl: discover,
    lastSeenExternalId: "cl-opinion-11123456",
    pageSize: 5,
  });
  assert.notEqual(url, providerNext);
  assert.equal(Buffer.from(new URL(url).searchParams.get("cursor"), "base64").toString(), "p=11123456");

  const bad = assertPageSubsetCheckpointSemantics({
    processedCount: 2,
    hitCount: 20,
    nextPage: providerNext,
    discoverUrl: null,
    lastSeenExternalId: null,
    pageSize: 5,
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, "REGRESSED_TO_PROVIDER_NEXT_PAGE_SKIP");
});

test("ingest DB write readiness is non-mutating; rollback proof optional", () => {
  const blocked = evaluateIngestDbWriteReadiness(NEON);
  assert.equal(blocked.dbWriteReady, false);
  const select1 = evaluateIngestDbWriteReadiness({ ok: true, mutations: 0 });
  assert.equal(select1.dbWriteReady, true);
  assert.equal(select1.ingestPathReady, true);
  assert.equal(select1.mutations, 0);
  const rollback = evaluateIngestDbWriteReadiness({
    ok: true,
    writeProbeMode: "rollback_txn",
    rollbackOk: true,
    mutations: 0,
  });
  assert.equal(rollback.writeProof, "rollback_safe_transaction");
  assert.equal(rollback.mutations, 0);
});

test("Queue #3 NOT OPEN and AI calls=0 on recovery plan", () => {
  const plan = planDatabaseQuotaRecovery({
    state: blockedState(),
    manifest: load(MANIFEST),
    dbProbe: { ok: true, writable: true, mutations: 0 },
    remoteProcesses: [],
    now: NOW,
  });
  assert.equal(plan.queue3, "NOT_OPEN");
  assert.equal(plan.state.queue3, "NOT_OPEN");
  assert.equal(plan.state.featureAgents, "0");
  assert.equal(plan.aiCalls, 0);
  assert.equal(plan.mutations, 0);
  assert.equal(plan.clRequests, 0);
});

console.log(
  JSON.stringify({
    ok: true,
    tests: passed,
    suite: "queue2-recovery-readiness",
    workerStarted: false,
    courtListenerHttpCalls: 0,
    corpusMutations: 0,
    aiCalls: 0,
  }),
);
