/**
 * Manual-progress reconciliation and Neon SQLSTATE 53000 gate.
 * Deterministic. No worker start, no CourtListener HTTP, no corpus writes.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  classifyDatabaseFailure,
  evaluateDbWriteReadiness,
  guardCourtListenerAttempt,
  auditLaneBDbDependency,
  quotaUsableForExecution,
  DATABASE_QUOTA_BLOCKED,
  LANE_B_DB_DEPENDENCY,
} = require("./queue2-db-readiness.cjs");
const {
  planManualProgressStartup,
  reconcileManualDepthProgress,
  selectNextProductionDepthTarget,
  isValidCompletionEvidence,
} = require("./queue2-manual-progress.cjs");
const { loadOfflineTaskRegistry, selectLaneBTask } = require("./queue2-autonomy-policy.cjs");
const { runPreflight } = require("./queue2-worker-safety.cjs");
const {
  assertLauncherForbidsDetach,
  maySpawnLaneARemoteChild,
} = require("./queue2-lane-a-remote-child.cjs");
const { CANARY_MAX_SESSION_CL_REQUESTS } = require("./queue2-lane-a-child-lifecycle.cjs");

const ROOT = path.join(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "packages/research/corpus/reports/queue2-lane-a-depth-manifest.json");
const STATE_PATH = path.join(ROOT, "packages/research/corpus/reports/queue2-dual-lane-state.json");
const NOW = new Date("2026-09-27T02:14:00.000Z");
const COMPLETED = ["wis", "mich", "nm", "utah", "sd", "idaho", "wyo", "neb", "sc"];
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

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

test("SQLSTATE 53000 is DATABASE_QUOTA_BLOCKED and not a CourtListener failure", () => {
  const byCode = classifyDatabaseFailure({ code: "53000", message: "quota" });
  const byMessage = classifyDatabaseFailure({
    message: "SQLSTATE 53000 Your account or project has exceeded the quota. Upgrade your plan to increase limits.",
  });
  assert.equal(byCode.classification, DATABASE_QUOTA_BLOCKED);
  assert.equal(byMessage.classification, DATABASE_QUOTA_BLOCKED);
  assert.equal(byCode.courtListenerFailure, false);
  assert.equal(byCode.ingestionParserFailure, false);
  assert.equal(byCode.mappingFailure, false);
  assert.equal(byCode.checkpointCorruption, false);
  assert.equal(byCode.sourceFailure, false);
  const unknown = classifyDatabaseFailure({ code: "08006", message: "connection failure" });
  assert.equal(unknown.classification, "UNKNOWN_DB_FAILURE");
  assert.equal(unknown.courtListenerFailure, false);
  const ready = evaluateDbWriteReadiness(NEON);
  assert.equal(ready.dbWriteReady, false);
  assert.equal(ready.classification, DATABASE_QUOTA_BLOCKED);
});

test("manual completed courts are skipped and Vermont is next on the live manifest", () => {
  const manifest = loadJson(MANIFEST_PATH);
  const saved = loadJson(STATE_PATH);
  const beforeWis = saved.completedCourtEvidence.wis.checkpoint;
  const plan = planManualProgressStartup({
    state: saved,
    manifest,
    dbProbe: NEON,
    now: NOW,
    executing: false,
  });
  assert.equal(plan.nextCourt, "wva");
  assert.equal(plan.state.laneA.jurisdiction, "WV");
  assert.ok(plan.state.laneA.count >= 20 && plan.state.laneA.count <= 45, `count=${plan.state.laneA.count}`);
  assert.equal(plan.state.laneA.target, 45);
  assert.equal(plan.state.laneA.mappingStatus, "VERIFIED");
  assert.ok(
    plan.state.laneA.checkpoint === "cl-opinion-11264687" || plan.state.laneA.checkpoint == null ||
      plan.state.laneA.checkpoint === "cl-opinion-11347355" ||
      state.laneA.checkpoint === "cl-opinion-11347355",
    `checkpoint=${plan.state.laneA.checkpoint}`,
  );
  for (const court of COMPLETED) {
    assert.ok(plan.state.completedCourts.includes(court), court);
    assert.notEqual(plan.state.laneA.court, court);
    assert.equal(isValidCompletionEvidence(plan.state.completedCourtEvidence[court]), true, court);
  }
  assert.equal(plan.state.completedCourtEvidence.wis.checkpoint, beforeWis);
  assert.equal(plan.state.completedCourtEvidence.sc.checkpoint, "cl-opinion-11201513");
  assert.deepEqual(plan.inventedCheckpoints, []);
  assert.ok(
    plan.state.laneAChild == null ||
      plan.state.laneAChild.unknownDueToNetwork === true ||
      plan.state.laneAChild.lifecycleState === "UNKNOWN_DUE_TO_NETWORK",
    "laneAChild must be null or UNKNOWN_DUE_TO_NETWORK",
  );
  assert.equal(plan.childLaunches, 0);
  assert.equal(plan.clRequests, 0);
  assert.equal(plan.mutations, 0);
  assert.equal(plan.aiCalls, 0);
  assert.equal(plan.state.metrics.aiCalls, 0);
  assert.equal(plan.queue2, "#2");
  assert.equal(plan.queue3, "NOT_OPEN");
  assert.equal(plan.state.featureAgents, "0");
  assert.equal(plan.allowCourtListener, false);
  assert.equal(plan.checkpointUnchanged, true);
  assert.equal(plan.state.humanReview.required, false);
  assert.equal(plan.state.databaseBlock.classification, DATABASE_QUOTA_BLOCKED);
  assert.equal(plan.state.laneAStatus, "BLOCKED");
  assert.equal(quotaUsableForExecution(plan.state.quota), false);
  assert.equal(plan.state.quota.quotaStatus, "UNKNOWN_FOR_EXECUTION");
  assert.equal(plan.state.quota.executionAuthority, "STALE");
  assert.ok(Number(plan.state.quota.windows.day.remaining) >= 0);
});

test("completion evidence is rebuilt from the manifest and does not invent a checkpoint", () => {
  const manifest = {
    version: 1,
    targets: [
      {
        jurisdiction: "SC",
        preferredCourts: ["sc"],
        currentCases: 45,
        clCases: 45,
        targetCases: 45,
        status: "COMPLETE_FOR_CURRENT_DEPTH",
        mappingStatus: "VERIFIED",
        autonomousIngestBlocked: true,
        checkpoint: "cl-opinion-11201513",
        authorityDeficit: 35,
      },
      {
        jurisdiction: "ME",
        preferredCourts: ["me"],
        currentCases: 65,
        targetCases: 45,
        status: "COMPLETE_FOR_CURRENT_DEPTH",
        mappingStatus: "VERIFIED",
        autonomousIngestBlocked: true,
        checkpoint: null,
        authorityDeficit: 14,
      },
      {
        jurisdiction: "VT",
        preferredCourts: ["vt"],
        currentCases: 20,
        highCourtCount: 20,
        targetCases: 45,
        status: "READY",
        mappingStatus: "VERIFIED",
        autonomousIngestBlocked: false,
        checkpoint: null,
        authorityDeficit: 60,
        score: 345,
      },
    ],
  };
  const state = {
    laneA: { court: "sc", jobStatus: "completed", targetStatus: "COMPLETE_FOR_CURRENT_DEPTH", checkpoint: "cl-opinion-11201513", count: 45, target: 45 },
    completedCourts: ["sc"],
    completedCourtEvidence: {},
    laneAChild: null,
    quota: { windows: { day: { remaining: 1050 } } },
    humanReview: { required: false, reasons: [], details: [] },
    metrics: { aiCalls: 0, aiTokens: 0 },
  };
  const rec = reconcileManualDepthProgress(state, manifest, { now: NOW });
  assert.equal(rec.state.completedCourtEvidence.me.checkpoint, null);
  assert.equal(rec.state.completedCourtEvidence.me.source, "canonical_manifest_reconciliation");
  assert.equal(rec.state.completedCourtEvidence.sc.checkpoint, "cl-opinion-11201513");
  assert.equal(rec.inventedCheckpoints.length, 0);
  assert.equal(rec.nextCourt, "vt");
  const next = selectNextProductionDepthTarget(manifest, { excludeCourts: rec.state.completedCourts });
  assert.equal(next.court, "vt");
  assert.equal(next.count, 20);
  assert.equal(next.target, 45);
});

test("DB blocked performs zero CourtListener attempts and zero child launches", () => {
  let http = 0;
  const guarded = guardCourtListenerAttempt({
    dbWriteReady: false,
    execute() {
      http += 1;
    },
  });
  assert.equal(guarded.executed, false);
  assert.equal(guarded.clRequests, 0);
  assert.equal(guarded.reason, "INVARIANT_CL_WHILE_DB_NOT_WRITABLE");
  assert.equal(http, 0);
  const manifest = loadJson(MANIFEST_PATH);
  const plan = planManualProgressStartup({
    state: loadJson(STATE_PATH),
    manifest,
    dbProbe: NEON,
    now: NOW,
    executing: true,
  });
  assert.equal(plan.clRequests, 0);
  assert.equal(plan.childLaunches, 0);
  assert.equal(plan.mutations, 0);
  assert.ok(
    plan.state.laneAChild == null ||
      plan.state.laneAChild.unknownDueToNetwork === true ||
      plan.state.laneAChild.lifecycleState === "UNKNOWN_DUE_TO_NETWORK",
    "laneAChild must be null or UNKNOWN_DUE_TO_NETWORK",
  );
  assert.equal(plan.queue2, "#2");
  assert.equal(plan.queue3, "NOT_OPEN");
});

test("zero-DB Lane B may run and DB-required Lane B does not", () => {
  const registry = loadOfflineTaskRegistry();
  const audit = auditLaneBDbDependency(registry);
  assert.equal(audit.ok, true, audit.problems.join(","));
  assert.equal(Object.values(LANE_B_DB_DEPENDENCY).includes("DB_READ_ONLY"), false);
  const manifest = loadJson(MANIFEST_PATH);
  const plan = planManualProgressStartup({
    state: loadJson(STATE_PATH),
    manifest,
    dbProbe: NEON,
    now: NOW,
    executing: true,
    registry,
  });
  assert.equal(plan.laneB.task.dbDependency, "NO_DB_REQUIRED");
  assert.equal(plan.laneB.currentTask, "US_REPORTS_GAP_ANALYSIS");
  assert.equal(plan.state.idleSafe, false);
  for (const row of plan.laneB.evaluations) {
    if (row.dbDependency !== "NO_DB_REQUIRED") {
      assert.equal(row.eligible, false, row.taskId);
      assert.equal(row.reason, "database_quota_blocked");
    }
  }
  const idle = planManualProgressStartup({
    state: loadJson(STATE_PATH),
    manifest,
    dbProbe: NEON,
    now: NOW,
    executing: true,
    registry: {
      tasks: [
        {
          id: "CITATION_RERESOLVE",
          enabled: true,
          mayUseAI: false,
          mayMutate: true,
          dbDependency: "DB_REQUIRED",
          priority: 10,
          eligibility: {},
          legacyIds: [],
          minimumIntervalMs: 0,
        },
      ],
    },
  });
  assert.equal(idle.state.healthyIdle.status, "HEALTHY_IDLE_SAFE");
  assert.equal(idle.state.healthyIdle.reason, DATABASE_QUOTA_BLOCKED);
  assert.equal(idle.state.humanReview.required, false);
  assert.equal(idle.clRequests, 0);
  const direct = selectLaneBTask({
    now: NOW,
    dbWriteReady: false,
    executing: true,
    registry: idle.state ? loadOfflineTaskRegistry() : registry,
    lastByTask: {},
  });
  assert.equal(direct.evaluations.find((e) => e.taskId === "USC_DEPTH").eligible, false);
});

test("DB recovery clears the external block, keeps Vermont, and does not trust stale quota", () => {
  const manifest = loadJson(MANIFEST_PATH);
  const blocked = planManualProgressStartup({
    state: loadJson(STATE_PATH),
    manifest,
    dbProbe: NEON,
    now: NOW,
    executing: false,
  });
  const recovered = planManualProgressStartup({
    state: blocked.state,
    manifest,
    dbProbe: { ok: true, writable: true, mutations: 0, courtListenerHttpCalls: 0 },
    now: new Date("2026-09-27T03:00:00.000Z"),
    executing: false,
  });
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.db.classification, "DB_READY");
  assert.equal(recovered.state.databaseBlock.classification, "RECOVERED");
  assert.equal(recovered.state.databaseBlock.recoveredFrom, DATABASE_QUOTA_BLOCKED);
  assert.equal(recovered.allowCourtListener, true);
  assert.equal(recovered.nextCourt, "wva");
  assert.ok(
    recovered.state.laneA.count >= 20 && recovered.state.laneA.count <= 45,
    `count=${recovered.state.laneA.count}`,
  );
  assert.equal(recovered.state.laneA.target, 45);
  for (const court of COMPLETED) {
    assert.notEqual(recovered.state.laneA.court, court);
    assert.equal(recovered.state.completedCourtEvidence[court].status, "COMPLETE_FOR_CURRENT_DEPTH");
  }
  assert.equal(quotaUsableForExecution(recovered.state.quota), false);
  assert.equal(recovered.state.quota.quotaStatus, "UNKNOWN_FOR_EXECUTION");
  assert.ok(Number(recovered.state.quota.windows.day.remaining) >= 0);
  assert.equal(recovered.canaryMaxClRequests, 5);
  assert.equal(recovered.canaryMaxQualifyingAuthorities, 2);
  assert.equal(CANARY_MAX_SESSION_CL_REQUESTS, 5);
  assert.equal(recovered.childLaunches, 0);
  assert.equal(recovered.clRequests, 0);
  assert.equal(recovered.aiCalls, 0);
  assert.equal(recovered.queue3, "NOT_OPEN");
  const allowed = guardCourtListenerAttempt({ dbWriteReady: recovered.state.dbWriteReady, execute() {} });
  assert.equal(allowed.executed, true);
  const denied = guardCourtListenerAttempt({ dbWriteReady: false, execute() { throw new Error("http"); } });
  assert.equal(denied.executed, false);
});

test("preflight reports an external database block without claiming a code failure", () => {
  const blocked = runPreflight({
    dbProbe: NEON,
    env: { ...process.env, FEATURE_AGENTS: "0" },
    allowDisabledForDryRun: true,
  });
  assert.equal(blocked.result, "PREFLIGHT_EXTERNAL_BLOCK");
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.reasons, [DATABASE_QUOTA_BLOCKED]);
  assert.equal(blocked.mutations, 0);
  assert.equal(blocked.courtListenerHttpCalls, 0);
  assert.equal(blocked.aiCalls, 0);
  assert.equal(blocked.queue["#3"], "NOT_OPEN");
});

test("remote child ownership invariants stay intact", () => {
  const launcher = fs.readFileSync(path.join(__dirname, "run-staging-cl-batch-job.cjs"), "utf8");
  const worker = fs.readFileSync(path.join(__dirname, "run-queue2-dual-lane.cjs"), "utf8");
  assert.equal(assertLauncherForbidsDetach(launcher).ok, true);
  assert.equal(assertLauncherForbidsDetach(worker).ok, true);
  assert.equal(worker.includes("child.unref("), false);
  assert.equal(worker.includes("detached: true"), false);
  const spawn = maySpawnLaneARemoteChild(
    { laneAChild: { pid: 42, terminal: false, court: "vt" } },
    { allowLaunch: true },
  );
  assert.equal(spawn.ok, false);
  assert.equal(spawn.reason, "LANE_A_CHILD_ALREADY_ACTIVE");
  assert.equal(CANARY_MAX_SESSION_CL_REQUESTS, 5);
});

console.log(
  JSON.stringify({
    ok: true,
    tests: passed,
    suite: "queue2-manual-progress-db-gate",
    workerStarted: false,
    courtListenerHttpCalls: 0,
    corpusMutations: 0,
    aiCalls: 0,
  }),
);
