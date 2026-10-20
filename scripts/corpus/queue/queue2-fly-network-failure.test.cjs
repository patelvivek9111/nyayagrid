/**
 * Fly control-plane / DNS failure classification.
 * Deterministic. Zero CourtListener HTTP. Zero corpus mutations. No worker start.
 */
"use strict";

const assert = require("node:assert/strict");
const {
  classifyDatabaseFailure,
  evaluateDbWriteReadiness,
  isFlyOrControlPlaneNetworkFailure,
  applyNetworkUnavailable,
  clearTransientNetworkHumanReview,
  NETWORK_UNAVAILABLE,
  DATABASE_QUOTA_BLOCKED,
} = require("./queue2-db-readiness.cjs");
const { planManualProgressStartup } = require("./queue2-manual-progress.cjs");
const { classifyLaneABatchResult } = require("./queue2-lane-a-dispatch.cjs");
const {
  LANE_A_RUNNER_STATES,
  mayLaunchLaneAChild,
  isLaneAChildAlive,
} = require("./queue2-lane-a-child-lifecycle.cjs");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} ${name}`);
}

const API_MACHINES_DNS =
  "Error: failed to get VM nyayagrid-staging: lookup api.machines.dev: no such host";
const FLYCTL_METRICS_DNS =
  "lookup flyctl-metrics.fly.dev: no such host";
const COMBINED_FLY_DNS = `${FLYCTL_METRICS_DNS}\n${API_MACHINES_DNS}`;

test("api.machines.dev DNS failure → NETWORK_UNAVAILABLE (not UNKNOWN_DB_FAILURE)", () => {
  const c = classifyDatabaseFailure({ ok: false, message: API_MACHINES_DNS });
  assert.equal(c.classification, NETWORK_UNAVAILABLE);
  assert.equal(c.severity, "WAIT_AND_RETRY");
  assert.equal(c.networkFailure, true);
  assert.notEqual(c.classification, "UNKNOWN_DB_FAILURE");
  assert.notEqual(c.severity, "HUMAN_REVIEW_REQUIRED");
  const ready = evaluateDbWriteReadiness({ ok: false, message: API_MACHINES_DNS });
  assert.equal(ready.dbWriteReady, false);
  assert.equal(ready.classification, NETWORK_UNAVAILABLE);
  assert.equal(ready.courtListenerHttpCalls, 0);
  assert.equal(ready.childLaunches, 0);
  assert.equal(ready.mutations, 0);
});

test("flyctl-metrics DNS noise does not become DB failure / human review", () => {
  assert.equal(isFlyOrControlPlaneNetworkFailure(FLYCTL_METRICS_DNS), true);
  const c = classifyDatabaseFailure({ ok: false, message: FLYCTL_METRICS_DNS });
  assert.equal(c.classification, NETWORK_UNAVAILABLE);
  assert.equal(c.metricsNoiseOnly, true);
  const planned = planManualProgressStartup({
    state: {
      queue: "#2",
      queue3: "NOT_OPEN",
      laneA: { court: "vt", checkpoint: "cp-1", target: 45, count: 20 },
      humanReview: { required: false, reasons: [], details: [] },
    },
    manifest: { targets: [{ court: "vt", target: 45, count: 20 }] },
    dbProbe: { ok: false, message: FLYCTL_METRICS_DNS },
    now: new Date("2026-09-27T13:00:00.000Z"),
    executing: false,
    processGateSafe: false,
  });
  assert.equal(planned.allowCourtListener, false);
  assert.equal(planned.clRequests, 0);
  assert.equal(planned.childLaunches, 0);
  assert.equal(planned.mutations, 0);
  assert.equal(planned.networkUnavailable, true);
  assert.equal(planned.state.waitingForNetwork, true);
  assert.equal(planned.state.runtimeState, "WAITING_FOR_NETWORK");
  assert.equal(planned.state.humanReview.required, false);
  assert.ok(!planned.state.humanReview.reasons.includes("UNKNOWN_DB_FAILURE"));
  assert.equal(planned.state.queue, "#2");
  assert.equal(planned.state.queue3, "NOT_OPEN");
  assert.equal(planned.state.laneA.checkpoint, "cp-1");
});

test("ENOTFOUND / EAI_AGAIN classify as NETWORK_UNAVAILABLE", () => {
  for (const code of ["ENOTFOUND", "EAI_AGAIN", "ENETUNREACH"]) {
    const c = classifyDatabaseFailure({ ok: false, code, message: "getaddrinfo failed" });
    assert.equal(c.classification, NETWORK_UNAVAILABLE, code);
  }
});

test("one parent probe already consumed is preserved across network block", () => {
  const before = {
    queue: "#2",
    queue3: "NOT_OPEN",
    laneA: { court: "vt", checkpoint: "vt-cp", target: 45, count: 20 },
    sessionQuota: {
      sessionClRequests: 1,
      quotaProbeRequests: 1,
      lastProbePurpose: "parent_api_usage",
    },
    humanReview: { required: false, reasons: [], details: [] },
  };
  const after = applyNetworkUnavailable(before, new Date("2026-09-27T13:05:00.000Z"), {
    source: "lane_a_fly_control_plane_launch",
    message: COMBINED_FLY_DNS,
  });
  after.sessionQuota = {
    ...(before.sessionQuota || {}),
    sessionClRequests: Number(before.sessionQuota.sessionClRequests),
    lastProbePreserved: true,
    skipImmediateReprobe: true,
  };
  assert.equal(after.sessionQuota.sessionClRequests, 1);
  assert.equal(after.sessionQuota.lastProbePreserved, true);
  assert.equal(after.sessionQuota.skipImmediateReprobe, true);
  assert.equal(after.laneA.checkpoint, "vt-cp");
  assert.equal(after.waitingForNetwork, true);
  assert.equal(after.humanReview.required, false);
  assert.equal(after.queue, "#2");
  assert.equal(after.queue3, "NOT_OPEN");
});

test("UNKNOWN child + pid=null → UNKNOWN_DUE_TO_NETWORK", () => {
  const classified = classifyLaneABatchResult({
    stdout: COMBINED_FLY_DNS + "\n" + JSON.stringify({ ok: false, pid: null, status: "UNKNOWN" }),
    priorCheckpoint: "vt-cp",
    priorCount: 20,
    target: 45,
  });
  assert.equal(classified.lifecycleState, LANE_A_RUNNER_STATES.UNKNOWN_DUE_TO_NETWORK);
  assert.equal(classified.unknownDueToNetwork, true);
  assert.equal(classified.pid, null);
  assert.equal(classified.terminal, false);
  assert.equal(classified.nonTerminal, true);
  assert.equal(classified.productive, false);
  assert.equal(classified.noProgress, false);
  assert.equal(classified.apiCalls, 0);
  const alive = isLaneAChildAlive({
    pid: null,
    unknownDueToNetwork: true,
    lifecycleState: LANE_A_RUNNER_STATES.UNKNOWN_DUE_TO_NETWORK,
    terminal: false,
  });
  assert.equal(alive, false);
  const launch = mayLaunchLaneAChild({
    laneAChild: {
      pid: null,
      unknownDueToNetwork: true,
      lifecycleState: LANE_A_RUNNER_STATES.UNKNOWN_DUE_TO_NETWORK,
      terminal: false,
      court: "vt",
    },
  });
  assert.equal(launch.ok, false);
  assert.equal(launch.reason, "UNKNOWN_DUE_TO_NETWORK");
});

test("recovery requires process gate before CL; clears misclassified human review", () => {
  const blocked = applyNetworkUnavailable(
    {
      queue: "#2",
      queue3: "NOT_OPEN",
      waitingForNetwork: true,
      laneA: { court: "vt", checkpoint: "vt-cp", target: 45, count: 20 },
      laneAChild: {
        pid: null,
        unknownDueToNetwork: true,
        lifecycleState: LANE_A_RUNNER_STATES.UNKNOWN_DUE_TO_NETWORK,
      },
      humanReview: {
        required: true,
        reasons: ["UNKNOWN_DB_FAILURE"],
        details: [{ reason: "UNKNOWN_DB_FAILURE" }],
      },
      sessionQuota: { sessionClRequests: 1, skipImmediateReprobe: true },
    },
    new Date("2026-09-27T13:10:00.000Z"),
    { source: "test", message: API_MACHINES_DNS },
  );
  // applyNetworkUnavailable strips UNKNOWN_DB_FAILURE immediately (reclassify).
  assert.equal(blocked.humanReview.required, false);

  const hold = clearTransientNetworkHumanReview(
    {
      ...blocked,
      humanReview: {
        required: true,
        reasons: ["UNKNOWN_DB_FAILURE"],
        details: [{ reason: "UNKNOWN_DB_FAILURE" }],
      },
    },
    { processGateSafe: false, markRecovered: false },
  );
  assert.equal(hold.hold, "PROCESS_GATE_REQUIRED");
  assert.equal(hold.cleared, false);

  const recovered = clearTransientNetworkHumanReview(
    {
      ...blocked,
      humanReview: {
        required: true,
        reasons: ["UNKNOWN_DB_FAILURE"],
        details: [{ reason: "UNKNOWN_DB_FAILURE" }],
      },
    },
    {
      processGateSafe: true,
      markRecovered: true,
      clearUnknownChild: true,
      now: new Date("2026-09-27T13:12:00.000Z"),
    },
  );
  assert.equal(recovered.cleared, true);
  assert.equal(recovered.state.humanReview.required, false);
  assert.equal(recovered.state.waitingForNetwork, false);
  assert.equal(recovered.state.laneAChild, null);

  const planned = planManualProgressStartup({
    state: {
      ...blocked,
      waitingForNetwork: true,
      humanReview: { required: true, reasons: ["UNKNOWN_DB_FAILURE"], details: [] },
    },
    manifest: { targets: [{ court: "vt", target: 45, count: 20 }] },
    dbProbe: { ok: true, writable: true },
    now: new Date("2026-09-27T13:12:00.000Z"),
    executing: false,
    processGateSafe: true,
    clearUnknownChild: true,
  });
  assert.equal(planned.allowCourtListener, true);
  assert.equal(planned.state.waitingForNetwork, false);
  assert.equal(planned.state.humanReview.required, false);
  assert.equal(planned.clRequests, 0);
});

test("0 additional CL / no child launch / no corpus mutation while network unavailable", () => {
  const planned = planManualProgressStartup({
    state: {
      queue: "#2",
      queue3: "NOT_OPEN",
      laneA: { court: "vt", checkpoint: "keep-me", target: 45, count: 20 },
      sessionQuota: { sessionClRequests: 1 },
    },
    manifest: { targets: [{ court: "vt", target: 45, count: 20 }] },
    dbProbe: { ok: false, message: COMBINED_FLY_DNS },
    now: new Date("2026-09-27T13:20:00.000Z"),
    executing: false,
  });
  assert.equal(planned.allowCourtListener, false);
  assert.equal(planned.clRequests, 0);
  assert.equal(planned.childLaunches, 0);
  assert.equal(planned.mutations, 0);
  assert.equal(planned.checkpointUnchanged, true);
  assert.equal(planned.state.laneA.checkpoint, "keep-me");
  assert.equal(planned.state.humanReview.required, false);
});

test("no human review for transient network failure", () => {
  const planned = planManualProgressStartup({
    state: {
      queue: "#2",
      humanReview: { required: false, reasons: [], details: [] },
      laneA: { court: "vt", checkpoint: null, target: 45, count: 20 },
    },
    manifest: { targets: [{ court: "vt", target: 45, count: 20 }] },
    dbProbe: { ok: false, message: API_MACHINES_DNS },
    now: new Date("2026-09-27T13:21:00.000Z"),
  });
  assert.equal(planned.state.humanReview.required, false);
  assert.deepEqual(planned.state.humanReview.reasons, []);
  assert.equal(planned.state.healthyIdle.status, "WAITING_FOR_NETWORK");
});

test("true unknown DB error still raises human review", () => {
  const c = classifyDatabaseFailure({
    ok: false,
    code: "XX000",
    message: "internal postgres panic unrelated to network",
  });
  assert.equal(c.classification, "UNKNOWN_DB_FAILURE");
  assert.equal(c.severity, "HUMAN_REVIEW_REQUIRED");
  const planned = planManualProgressStartup({
    state: {
      queue: "#2",
      humanReview: { required: false, reasons: [], details: [] },
      laneA: { court: "vt", checkpoint: "cp", target: 45, count: 20 },
    },
    manifest: { targets: [{ court: "vt", target: 45, count: 20 }] },
    dbProbe: { ok: false, code: "XX000", message: "internal postgres panic unrelated to network" },
    now: new Date("2026-09-27T13:22:00.000Z"),
  });
  assert.equal(planned.allowCourtListener, false);
  assert.equal(planned.state.humanReview.required, true);
  assert.ok(planned.state.humanReview.reasons.includes("UNKNOWN_DB_FAILURE"));
  assert.equal(planned.state.waitingForNetwork, false);
});

test("Neon 53000 remains DATABASE_QUOTA_BLOCKED", () => {
  const c = classifyDatabaseFailure({
    ok: false,
    code: "53000",
    message: "Your account or project has exceeded the quota.",
  });
  assert.equal(c.classification, DATABASE_QUOTA_BLOCKED);
  assert.notEqual(c.classification, NETWORK_UNAVAILABLE);
  const ready = evaluateDbWriteReadiness({
    ok: false,
    code: "53000",
    message: "Your account or project has exceeded the quota.",
  });
  assert.equal(ready.classification, DATABASE_QUOTA_BLOCKED);
  const planned = planManualProgressStartup({
    state: {
      queue: "#2",
      humanReview: { required: false, reasons: [], details: [] },
      laneA: { court: "vt", checkpoint: "cp", target: 45, count: 20 },
    },
    manifest: { targets: [{ court: "vt", target: 45, count: 20 }] },
    dbProbe: {
      ok: false,
      code: "53000",
      message: "Your account or project has exceeded the quota.",
    },
    now: new Date("2026-09-27T13:23:00.000Z"),
  });
  assert.equal(planned.state.healthyIdle.reason, DATABASE_QUOTA_BLOCKED);
  assert.equal(planned.state.humanReview.required, false);
  assert.notEqual(planned.state.waitingForNetwork, true);
});

console.log(`queue2-fly-network-failure: ${passed} passed`);
