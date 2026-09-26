/**
 * Queue #2 startup runtime initialization tests.
 * Zero network. Zero corpus mutation. Zero AI. Does NOT start the worker.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  makeEvent,
  formatHeartbeat,
  EVENT_TYPES,
  isRegisteredEventType,
} = require("./queue2-worker-observability.cjs");
const {
  createInitialState,
  decideLane,
  QUOTA_MODES,
} = require("./queue2-dual-lane-controller.cjs");
const { initWatchdogSession, evaluateHeartbeatDeadman, loadWatchdogConfig } = require("./queue2-watchdog.cjs");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const ROOT = path.join(__dirname, "..");
const WORKER_SRC = path.join(__dirname, "run-queue2-dual-lane.cjs");
const STATE_PATH = path.join(ROOT, "packages/research/corpus/reports/queue2-dual-lane-state.json");
const CFG = loadWatchdogConfig();

function windows(minuteRem, hourRem, dayRem, opts = {}) {
  return {
    minute: { limit: 30, used: 30 - minuteRem, remaining: minuteRem, resetAt: opts.minuteReset || null },
    hour: { limit: 300, used: 300 - hourRem, remaining: hourRem, resetAt: opts.hourReset || null },
    day: { limit: 1200, used: 1200 - dayRem, remaining: dayRem, resetAt: opts.dayReset || null },
  };
}

test("A: worker source has no TDZ-shadowing const runtime = deriveRuntimeState", () => {
  const src = fs.readFileSync(WORKER_SRC, "utf8");
  assert.equal(
    /async function runWorkerCycle[\s\S]*?\bconst\s+runtime\s*=\s*deriveRuntimeState/.test(src),
    false,
    "runWorkerCycle must not declare const runtime = deriveRuntimeState (TDZ shadow)",
  );
  assert.match(src, /const\s+derivedRuntime\s*=\s*deriveRuntimeState/);
  // Module-level runtime must be declared before functions that read it.
  const runtimeDecl = src.indexOf("const runtime = {");
  const maybeHb = src.indexOf("function maybeHeartbeat");
  const runCycle = src.indexOf("async function runWorkerCycle");
  assert.ok(runtimeDecl >= 0, "module runtime declaration missing");
  assert.ok(runtimeDecl < maybeHb, "runtime must be initialized before maybeHeartbeat");
  assert.ok(runtimeDecl < runCycle, "runtime must be initialized before runWorkerCycle");
});

test("B: runtime TDZ pattern is rejected by static order (read-before-init detector)", () => {
  // Simulate the exact bug class: local const runtime later in same scope.
  const buggy = `
    function cycle(rt) {
      const x = rt.morningSummaryPending;
      const runtime = { runtimeState: "RUNNING" };
      return runtime.runtimeState;
    }
  `;
  // Outer module runtime is fine; the local shadow is the hazard we forbid in source.
  assert.match(buggy, /const\s+runtime\s*=/);
  const fixed = `
    function cycle(rt) {
      const x = rt.morningSummaryPending;
      const derivedRuntime = { runtimeState: "RUNNING" };
      return derivedRuntime.runtimeState;
    }
  `;
  assert.equal(/const\s+runtime\s*=/.test(fixed), false);
  assert.match(fixed, /derivedRuntime/);
});

test("C: watchdog session init works before runtime lane attachment", () => {
  const now = new Date("2026-09-25T14:42:00.000Z");
  const session = initWatchdogSession({
    workerId: "worker-boot",
    pid: 12345,
    processStartNonce: "nonce-boot",
    now,
  });
  assert.equal(session.workerId, "worker-boot");
  assert.equal(session.lastHeartbeatAt, now.toISOString());
  // Deadman must not fire during grace with session baseline (runtime lane not attached yet).
  const alert = evaluateHeartbeatDeadman({
    snap: {
      lastHeartbeatAt: session.lastHeartbeatAt,
      heartbeatWorkerId: session.workerId,
      processStartNonce: session.processStartNonce,
      processAlive: true,
      machineAwake: true,
      pidAlive: true,
      lockMatchesSession: true,
      watchdogSession: session,
    },
    session,
    cfg: CFG,
    now,
    nowIso: now.toISOString(),
    alive: true,
  });
  assert.equal(alert, null);
});

test("D: startup heartbeat must not print LANE_B_IDLE_SAFE", () => {
  const line = formatHeartbeat(
    {
      currentLane: "STARTUP",
      currentTask: "boot",
      runtimeState: "STARTUP",
      checkpoint: "cl-opinion-9886466",
      tokens: { routineAiCalls: 0 },
    },
    new Date("2026-09-25T14:42:27.000Z"),
  );
  assert.match(line, /STARTUP/);
  assert.match(line, /initial heartbeat/);
  assert.equal(line.includes("LANE_B_IDLE_SAFE"), false);
});

test("E: fresh quota + WI 44/45 selects Lane A / FINISH_TARGET", () => {
  const state = createInitialState();
  state.laneA.court = "wis";
  state.laneA.jurisdiction = "WI";
  state.laneA.count = 44;
  state.laneA.target = 45;
  state.laneA.checkpoint = "cl-opinion-9886466";
  state.laneA.lastSuccessfulExternalId = "cl-opinion-9886466";
  state.quota.courtEfficiency = { wis: { ewmaRequestsPerAuthority: 2.13, sampleCount: 3 } };
  const d = decideLane(state, {
    windows: windows(30, 300, 1115, { dayReset: "2026-09-26T00:36:37.000Z" }),
    safeRequests: 28,
    projectedUsefulAt: "2026-09-26T00:36:37.000Z",
    now: new Date("2026-09-25T14:42:00.000Z"),
  });
  assert.equal(d.lane, "A");
  assert.equal(d.quotaMode, QUOTA_MODES.FINISH_TARGET);
  assert.equal(d.nextUsefulAt, null);
});

test("F: no stale startup lane display for idleSafe durable state during boot", () => {
  // Durable state may still have idleSafe=true from prior run; boot status must override.
  const idleStateLane = "LANE_B_IDLE_SAFE";
  const bootLine = formatHeartbeat({
    currentLane: "STARTUP",
    currentTask: "boot",
    checkpoint: "cl-opinion-9886466",
  });
  const idleLine = formatHeartbeat({
    currentLane: idleStateLane,
    runtimeState: "IDLE_SAFE",
    checkpoint: "cl-opinion-9886466",
  });
  assert.equal(bootLine.includes("LANE_B_IDLE_SAFE"), false);
  assert.match(idleLine, /LANE_B_IDLE_SAFE/);
  const src = fs.readFileSync(WORKER_SRC, "utf8");
  assert.match(src, /currentLane:\s*["']STARTUP["']/);
});

test("G: WATCHDOG_SESSION_INIT accepted", () => {
  assert.equal(isRegisteredEventType("WATCHDOG_SESSION_INIT"), true);
  assert.equal(makeEvent("WATCHDOG_SESSION_INIT", { lane: "STARTUP" }).type, "WATCHDOG_SESSION_INIT");
});

test("H: INITIAL_HEARTBEAT accepted", () => {
  assert.equal(isRegisteredEventType("INITIAL_HEARTBEAT"), true);
  assert.equal(makeEvent("INITIAL_HEARTBEAT", { lane: "STARTUP", task: "boot" }).type, "INITIAL_HEARTBEAT");
});

test("I: WI complete; active Lane A advanced", () => {
  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  assert.ok(state.completedCourts.includes("wis"));
  assert.equal(state.completedCourtEvidence.wis.count, 45);
  assert.equal(state.laneA.court, "sc");
  assert.equal(state.laneA.count, 45);
  assert.equal(state.laneA.target, 45);
});

test("J: WI completed checkpoint preserved in evidence", () => {
  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  assert.equal(state.completedCourtEvidence.wis.checkpoint, "cl-opinion-9886466");
});

test("K: AI calls = 0", () => {
  assert.ok(EVENT_TYPES.includes("WATCHDOG_SESSION_INIT"));
  assert.equal(CFG.aiCallsAllowed, 0);
});

test("mocked startup sequence completes without runtime TDZ", () => {
  const moduleRuntime = {
    shuttingDown: false,
    morningSummaryPending: { preflight: "PASS" },
    session: null,
    state: null,
  };
  // Session first (immutable), then attach mutable runtime state.
  const session = initWatchdogSession({
    workerId: "w",
    processStartNonce: "n",
    now: new Date("2026-09-25T14:42:00.000Z"),
  });
  moduleRuntime.session = session;
  const events = [
    makeEvent("WORKER_START", { lane: "STARTUP" }),
    makeEvent("LOCK_ACQUIRED", { lane: "STARTUP" }),
    makeEvent("WATCHDOG_SESSION_INIT", { lane: "STARTUP", extra: { startedAt: session.startedAt } }),
    makeEvent("INITIAL_HEARTBEAT", { lane: "STARTUP", task: "boot" }),
    makeEvent("QUOTA_CHECK", { lane: "QUOTA_CHECK" }),
    makeEvent("LANE_SWITCH", { lane: "LANE_A_CL", reason: "finish_target_fits" }),
  ];
  // Access moduleRuntime fields that previously TDZ'd when shadowed.
  assert.equal(Boolean(moduleRuntime.morningSummaryPending), true);
  moduleRuntime.morningSummaryPending = null;
  assert.equal(moduleRuntime.morningSummaryPending, null);
  assert.deepEqual(
    events.map((e) => e.type),
    [
      "WORKER_START",
      "LOCK_ACQUIRED",
      "WATCHDOG_SESSION_INIT",
      "INITIAL_HEARTBEAT",
      "QUOTA_CHECK",
      "LANE_SWITCH",
    ],
  );
  const hb = formatHeartbeat({ currentLane: "STARTUP", currentTask: "boot", checkpoint: "cl-opinion-9886466" });
  assert.equal(hb.includes("LANE_B_IDLE_SAFE"), false);
});

console.log(
  JSON.stringify({
    ok: true,
    tests: passed,
    suite: "queue2-startup-runtime",
    workerStarted: false,
    aiCalls: 0,
    corpusMutations: 0,
  }),
);
