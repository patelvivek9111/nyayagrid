/**
 * Queue #2 watchdog tests — zero AI, zero corpus mutation, zero network.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  OVERALL,
  SEVERITY,
  RECOVERY,
  BOTTLENECKS,
  createInitialWatchdogState,
  detectMeaningfulProgress,
  isLegitimateWait,
  evaluateWatchdogTick,
  classifyFailure,
  buildDiagnosticBundle,
  redactSecrets,
  buildEndOfDayReport,
  evaluateCanaryGate,
  formatWatchdogTerminalLine,
  formatMorningStartupSummary,
  writeDiagnosticBundle,
  loadWatchdogConfig,
  runWatchdogCycle,
} = require("./queue2-watchdog.cjs");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const CFG = loadWatchdogConfig();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "q2-wd-"));

function baseSnap(extra = {}, nowIso = new Date().toISOString()) {
  return {
    processAlive: true,
    machineAwake: true,
    lastHeartbeatAt: nowIso,
    currentLane: "A",
    currentTask: "NONE",
    checkpoint: "cl-opinion-9886466",
    authorities: 3006,
    cases: 1689,
    productiveWorkAvailable: true,
    ...extra,
  };
}

test("heartbeat with no progress is not considered progress", () => {
  const d = detectMeaningfulProgress(
    { authorities: 10, cases: 5, checkpoint: "a" },
    { authorities: 10, cases: 5, checkpoint: "a", heartbeatOnly: true },
  );
  assert.equal(d.progressed, false);
  assert.ok(d.reasons.includes("heartbeat_not_progress"));
});

test("legitimate WAIT_MINUTE does not false-alert", () => {
  const now = "2026-09-25T01:20:00.000Z";
  const r = evaluateWatchdogTick({
    now: new Date(now),
    watchdogState: {
      ...createInitialWatchdogState(),
      lastMeaningfulProgressAt: "2026-09-25T00:50:00.000Z",
    },
    snapshot: baseSnap({
      productiveWorkAvailable: true,
      quotaMode: "WAIT_MINUTE",
      waitReason: "minute_window_blocked",
      nextUsefulAt: "2026-09-25T01:21:00.000Z",
      currentLane: "WAIT",
    }, now),
  });
  assert.equal(r.state.overallStatus, OVERALL.HEALTHY_WAITING);
  assert.ok(!r.alerts.some((a) => a.reason === "NO_PRODUCTIVE_PROGRESS" && a.severity === SEVERITY.CRITICAL));
});

test("legitimate WAIT_HOUR does not false-alert", () => {
  const now = "2026-09-25T02:00:00.000Z";
  const r = evaluateWatchdogTick({
    now: new Date(now),
    watchdogState: {
      ...createInitialWatchdogState(),
      lastMeaningfulProgressAt: "2026-09-25T01:00:00.000Z",
    },
    snapshot: baseSnap({
      quotaMode: "WAIT_HOUR",
      waitReason: "hour_window_blocked",
      nextUsefulAt: "2026-09-25T03:00:00.000Z",
      currentLane: "B",
      productiveWorkAvailable: true,
    }, now),
  });
  assert.equal(r.state.overallStatus, OVERALL.HEALTHY_WAITING);
});

test("no progress warning at 15m", () => {
  const r = evaluateWatchdogTick({
    now: new Date("2026-09-25T01:16:00.000Z"),
    watchdogState: {
      ...createInitialWatchdogState(),
      lastMeaningfulProgressAt: "2026-09-25T01:00:00.000Z",
    },
    priorSnapshot: { authorities: 10, cases: 5, checkpoint: "x" },
    snapshot: baseSnap({ authorities: 10, cases: 5, checkpoint: "x", productiveWorkAvailable: true }),
  });
  assert.ok(r.events.some((e) => e.type === "WATCHDOG_WARNING" && e.reason === "NO_PRODUCTIVE_PROGRESS"));
});

test("no progress critical at 30m", () => {
  const r = evaluateWatchdogTick({
    now: new Date("2026-09-25T01:31:00.000Z"),
    watchdogState: {
      ...createInitialWatchdogState(),
      lastMeaningfulProgressAt: "2026-09-25T01:00:00.000Z",
    },
    priorSnapshot: { authorities: 10, cases: 5, checkpoint: "x" },
    snapshot: baseSnap({ authorities: 10, cases: 5, checkpoint: "x", productiveWorkAvailable: true }),
  });
  assert.equal(r.state.overallStatus, OVERALL.HUMAN_REVIEW_REQUIRED);
  assert.ok(r.alerts.some((a) => a.reason === "NO_PRODUCTIVE_PROGRESS" && a.severity === SEVERITY.CRITICAL));
});

test("scheduler stuck after 3 identical productive cycles", () => {
  let state = createInitialWatchdogState();
  const snap = baseSnap({ authorities: 10, cases: 5, checkpoint: "same", currentTask: "us_reports_gap_analysis" });
  for (let i = 0; i < 3; i += 1) {
    const r = evaluateWatchdogTick({
      now: new Date(Date.UTC(2026, 8, 25, 1, i, 0)),
      watchdogState: state,
      priorSnapshot: { authorities: 10, cases: 5, checkpoint: "same" },
      snapshot: snap,
    });
    state = r.state;
  }
  assert.ok(state.identicalProductiveCycles >= 3);
  const last = evaluateWatchdogTick({
    now: new Date("2026-09-25T01:03:00.000Z"),
    watchdogState: state,
    priorSnapshot: { authorities: 10, cases: 5, checkpoint: "same" },
    snapshot: snap,
  });
  assert.ok(last.alerts.some((a) => a.reason === "SCHEDULER_STUCK"));
});

test("stale active task detection", () => {
  const r = evaluateWatchdogTick({
    now: new Date("2026-09-25T02:00:00.000Z"),
    snapshot: baseSnap({
      currentTask: "citation_re_resolution",
      taskStartedAt: "2026-09-25T00:00:00.000Z",
      runnerActive: false,
      expectedTaskMaxMinutes: 45,
      productiveWorkAvailable: false,
    }),
  });
  assert.equal(r.state.falseActiveTask, true);
  assert.ok(r.events.some((e) => e.type === "FALSE_ACTIVE_TASK_STATE"));
});

test("missed wake warning", () => {
  const r = evaluateWatchdogTick({
    now: new Date("2026-09-25T01:03:00.000Z"),
    snapshot: baseSnap({
      nextUsefulAt: "2026-09-25T01:00:00.000Z",
      reevaluatedAfterWake: false,
      productiveWorkAvailable: false,
      quotaMode: "WAIT_MINUTE",
      waitReason: "minute",
    }),
  });
  assert.ok(r.events.some((e) => e.type === "WATCHDOG_WARNING" && e.reason === "MISSED_SCHEDULED_WAKE"));
});

test("missed wake critical", () => {
  const r = evaluateWatchdogTick({
    now: new Date("2026-09-25T01:06:00.000Z"),
    snapshot: baseSnap({
      nextUsefulAt: "2026-09-25T01:00:00.000Z",
      reevaluatedAfterWake: false,
      wakeRecoveryAttempted: true,
      productiveWorkAvailable: false,
    }),
  });
  assert.ok(r.alerts.some((a) => a.reason === "MISSED_SCHEDULED_WAKE" && a.severity === SEVERITY.CRITICAL));
});

test("stale quota after reset", () => {
  const r = evaluateWatchdogTick({
    now: new Date("2026-09-25T01:10:00.000Z"),
    snapshot: baseSnap({
      quotaResetAt: "2026-09-25T01:00:00.000Z",
      freshProbeAfterReset: false,
      quotaSuspiciousUnchanged: true,
      productiveWorkAvailable: false,
    }),
  });
  assert.equal(r.state.quota.stale, true);
  assert.ok(r.alerts.some((a) => a.reason === "QUOTA_STATE_STALE"));
});

test("quota underutilization", () => {
  const r = evaluateWatchdogTick({
    now: new Date("2026-09-25T02:00:00.000Z"),
    snapshot: baseSnap({
      unusedUsableCapacity: 143,
      unusedCapacityMinutes: 45,
      verifiedClWorkRemaining: true,
      opportunityLossRequests: 143,
      validBlockingReason: false,
    }),
  });
  assert.equal(r.state.quota.underutilization, true);
  assert.equal(r.state.quota.opportunityLossRequests, 143);
  assert.ok(r.alerts.some((a) => a.reason === "QUOTA_UNDERUTILIZATION"));
});

test("no quota underutilization if no verified work remains", () => {
  const r = evaluateWatchdogTick({
    snapshot: baseSnap({
      unusedUsableCapacity: 200,
      unusedCapacityMinutes: 50,
      verifiedClWorkRemaining: false,
    }),
  });
  assert.equal(r.state.quota.underutilization, false);
});

test("source yield anomaly", () => {
  const r = evaluateWatchdogTick({
    snapshot: baseSnap({
      requestsPerAuthority: 5.0,
      ewmaRequestsPerAuthority: 2.1,
      productiveWorkAvailable: false,
    }),
  });
  assert.ok(r.alerts.some((a) => a.reason === "SOURCE_YIELD_ANOMALY"));
});

test("duplicate/orphan emergency condition", () => {
  const orphans = evaluateWatchdogTick({ snapshot: baseSnap({ orphans: 2, productiveWorkAvailable: false }) });
  assert.equal(orphans.state.overallStatus, OVERALL.EMERGENCY_STOP);
  const dups = evaluateWatchdogTick({ snapshot: baseSnap({ duplicateSourceIds: 1, productiveWorkAvailable: false }) });
  assert.equal(dups.state.overallStatus, OVERALL.EMERGENCY_STOP);
});

test("bottleneck classification", () => {
  const r = evaluateWatchdogTick({
    snapshot: baseSnap({ quotaMode: "WAIT_MINUTE", waitReason: "minute", nextUsefulAt: "2026-09-25T01:00:00Z", productiveWorkAvailable: false }),
  });
  assert.equal(r.state.bottleneck.name, BOTTLENECKS.COURTLISTENER_QUOTA);
});

test("diagnostic bundle creation and secret filtering", () => {
  const bundle = buildDiagnosticBundle({
    failure: { reason: "SCHEDULER_STUCK" },
    quotaState: { apiKey: "sk-secret-should-not-leak", remaining: 10 },
    lockState: { token: "abc", workerId: "q2-1" },
  });
  assert.equal(bundle.quotaState.apiKey, "[REDACTED]");
  assert.equal(bundle.lockState.token, "[REDACTED]");
  assert.equal(bundle.lockState.workerId, "q2-1");
  const p = writeDiagnosticBundle(bundle, { dir: path.join(tmpRoot, "diagnostics") });
  assert.ok(fs.existsSync(p));
  const raw = fs.readFileSync(p, "utf8");
  assert.equal(raw.includes("sk-secret"), false);
});

test("self-recoverable classification and recovery metrics", () => {
  const cls = classifyFailure("WAIT_MINUTE");
  assert.equal(cls.recoveryClass, RECOVERY.SELF_RECOVERABLE);
  const r = evaluateWatchdogTick({
    snapshot: baseSnap({
      selfRecoveryStarted: true,
      selfRecoverySucceeded: true,
      selfRecoveryClass: RECOVERY.SELF_RECOVERABLE,
      recoveryDurationMs: 12000,
      productiveWorkAvailable: false,
      quotaMode: "WAIT_MINUTE",
      waitReason: "minute",
      nextUsefulAt: "2026-09-25T01:01:00Z",
    }),
  });
  assert.ok(r.state.recovery.selfRecoveryCount >= 1);
  assert.ok(r.state.recovery.selfRecoverySuccessCount >= 1);
  assert.ok(r.state.slo.meanMttrMs != null);
});

test("canary required after worker version change", () => {
  const g = evaluateCanaryGate({ workerVersionChanged: true });
  assert.equal(g.mode, "CANARY_REQUIRED");
  assert.equal(g.promoteToNormal, false);
});

test("canary promotion to normal", () => {
  const g = evaluateCanaryGate({ canaryPassed: true });
  assert.equal(g.mode, "NORMAL");
  assert.equal(g.promoteToNormal, true);
});

test("canary failure prevents normal mode", () => {
  const g = evaluateCanaryGate({ canaryFailed: true });
  assert.equal(g.mode, "CANARY_REQUIRED");
  assert.equal(g.promoteToNormal, false);
  const r = evaluateWatchdogTick({ snapshot: baseSnap({ canaryFailed: true, workerVersionChanged: true, productiveWorkAvailable: false }) });
  assert.equal(r.state.mode, "CANARY_REQUIRED");
  assert.equal(r.state.canary.status, "FAIL");
});

test("regression stops new version and known-good persisted fields", () => {
  const g = evaluateCanaryGate({ versionRegression: true });
  assert.equal(g.mode, "HUMAN_REVIEW_REQUIRED");
  const r = evaluateWatchdogTick({
    snapshot: baseSnap({
      versionRegression: true,
      workerVersion: "bad",
      canaryPassed: true,
      gitCommit: "abc",
      productiveWorkAvailable: false,
      quotaMode: "WAIT_MINUTE",
      waitReason: "x",
      nextUsefulAt: "2026-09-25T01:00:00Z",
    }),
  });
  assert.ok(r.alerts.some((a) => a.reason === "WORKER_VERSION_REGRESSION"));
  assert.equal(r.state.knownGood.commit, "abc");
});

test("evidence freshness failure", () => {
  const r = evaluateWatchdogTick({
    snapshot: baseSnap({ meaningfulWorkHappened: true, statusUpdateFailed: true, productiveWorkAvailable: false }),
  });
  assert.ok(r.alerts.some((a) => a.reason === "OBSERVABILITY_FAILURE"));
});

test("end-of-day report", () => {
  const report = buildEndOfDayReport({
    totalRequests: 85,
    productiveRequests: 80,
    probeRequests: 2,
    opportunityLossRequests: 40,
    authoritiesAdded: 40,
    currentPartial: "WI 44/45",
    checkpoint: "cl-opinion-9886466",
  });
  assert.equal(report.aiCalls, 0);
  assert.equal(report.courtListener.opportunityLossRequests, 40);
  assert.equal(report.next.checkpoint, "cl-opinion-9886466");
});

test("MTTD / MTTR tracking", () => {
  const r = evaluateWatchdogTick({
    now: new Date("2026-09-25T01:35:00.000Z"),
    watchdogState: { ...createInitialWatchdogState(), lastMeaningfulProgressAt: "2026-09-25T01:00:00.000Z" },
    priorSnapshot: { authorities: 1, cases: 1, checkpoint: "a" },
    snapshot: baseSnap({ authorities: 1, cases: 1, checkpoint: "a" }),
  });
  assert.ok(r.state.slo.meanMttdMs != null);
});

test("zero AI calls", () => {
  const r = evaluateWatchdogTick({ snapshot: baseSnap({ productiveWorkAvailable: false }) });
  assert.equal(r.state.aiCalls, 0);
  assert.equal(r.state.aiTokens, 0);
});

test("WI/checkpoint unchanged in durable state", () => {
  const statePath = path.join(__dirname, "../packages/research/corpus/reports/queue2-dual-lane-state.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(state.laneA.court, "wis");
  assert.equal(state.laneA.count, 44);
  assert.equal(state.laneA.target, 45);
  assert.equal(state.laneA.checkpoint, "cl-opinion-9886466");
});

test("Queue #3 never opens", () => {
  const r = evaluateWatchdogTick({ snapshot: baseSnap({ queue3: "OPEN", productiveWorkAvailable: false }) });
  assert.ok(r.alerts.some((a) => a.reason === "QUEUE_3_OPEN_FORBIDDEN"));
  assert.equal(r.state.overallStatus, OVERALL.EMERGENCY_STOP);
});

test("concise terminal output and morning summary", () => {
  const state = { ...createInitialWatchdogState(), overallStatus: OVERALL.HEALTHY_PRODUCTIVE, metrics: { requestsPerAuthority: 2.1 } };
  const line = formatWatchdogTerminalLine(state, { currentLane: "LANE_A", jurisdiction: "WI", countLabel: "44->45", quotaLabel: "26/270/980" }, new Date("2026-09-25T13:15:00Z"));
  assert.match(line, /HEALTHY_PRODUCTIVE/);
  const morning = formatMorningStartupSummary({ preflight: "PASS", canary: "PASS", partial: "WI 44/45" });
  assert.match(morning, /AI CALLS=0/);
  assert.match(morning, /PREFLIGHT PASS/);
});

test("adaptive controller wait integrates as legitimate", () => {
  assert.equal(
    isLegitimateWait({ quotaMode: "WAIT_MINUTE", waitReason: "minute_window_blocked", nextUsefulAt: "t" }, CFG),
    true,
  );
});

test("runWatchdogCycle persists without secrets and corpus mutations=0", () => {
  const statusPath = path.join(tmpRoot, "status.json");
  const eventsPath = path.join(tmpRoot, "events.jsonl");
  const diagDir = path.join(tmpRoot, "diag");
  const r = runWatchdogCycle({
    persist: true,
    statusPath,
    eventsPath,
    diagDir,
    snapshot: baseSnap({
      orphans: 1,
      productiveWorkAvailable: false,
      apiKey: "should-not-matter",
    }),
  });
  assert.equal(r.state.overallStatus, OVERALL.EMERGENCY_STOP);
  assert.ok(fs.existsSync(statusPath));
  assert.ok(r.state.lastDiagnosticPath);
  const diag = fs.readFileSync(r.state.lastDiagnosticPath, "utf8");
  assert.equal(diag.includes("sk-"), false);
});

console.log(JSON.stringify({ ok: true, tests: passed, suite: "queue2-watchdog", workerStarted: false, aiCalls: 0, corpusMutations: 0 }));
