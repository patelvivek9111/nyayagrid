/**
 * Queue #2 Lane A remote child ownership — pure helpers, zero CL HTTP, zero AI.
 *
 * Root cause of PPID=1 orphans: run-staging-cl-batch-job.cjs spawned with
 *   {detached:true} + child.unref() inside fly machine exec, so the remote
 * node was reparented to init when the spawn helper exited.
 */
"use strict";

const LANE_A_REMOTE_COMMAND = "staging-cl-batch-job-bundled.cjs";

const REMOTE_CHILD_REASONS = Object.freeze({
  LANE_A_CHILD_ALREADY_ACTIVE: "LANE_A_CHILD_ALREADY_ACTIVE",
  ORPHAN_LANE_A_CHILD: "ORPHAN_LANE_A_CHILD",
  MULTIPLE_LANE_A_CHILDREN: "MULTIPLE_LANE_A_CHILDREN",
  LANE_A_CHILD_OWNERSHIP_LOST: "LANE_A_CHILD_OWNERSHIP_LOST",
  LANE_A_CHILD_PID_MISMATCH: "LANE_A_CHILD_PID_MISMATCH",
  LANE_A_CHILD_SURVIVED_PARENT: "LANE_A_CHILD_SURVIVED_PARENT",
  LANE_A_DUPLICATE_SPAWN_ATTEMPT: "LANE_A_DUPLICATE_SPAWN_ATTEMPT",
  LANE_A_CHILD_NO_SESSION: "LANE_A_CHILD_NO_SESSION",
  LANE_A_CHILD_NO_BUDGET: "LANE_A_CHILD_NO_BUDGET",
});

function createRemoteChildOwnership(params = {}) {
  const now = params.now instanceof Date ? params.now : new Date(params.now || Date.now());
  return {
    pid: params.pid != null ? Number(params.pid) : null,
    ppid: params.ppid != null ? Number(params.ppid) : null,
    court: params.court || null,
    sessionId: params.sessionId || null,
    batchId: params.batchId || `lane-a-${params.court || "unk"}-${now.getTime()}`,
    workerId: params.workerId || null,
    processStartNonce: params.processStartNonce || null,
    command: params.command || LANE_A_REMOTE_COMMAND,
    commandFingerprint: params.commandFingerprint || null,
    startedAt: now.toISOString(),
    terminal: false,
    terminalAt: null,
    exitCode: null,
    detachedForbidden: true,
    supervised: true,
  };
}

/**
 * Parse BusyBox/ps-style lines into matching Lane A remote processes.
 * Expected columns: PID PPID COMMAND (or PID COMMAND).
 */
function parseRemoteLaneAProcesses(psText) {
  const lines = String(psText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const matches = [];
  for (const line of lines) {
    if (!line.includes(LANE_A_REMOTE_COMMAND)) continue;
    if (/\bgrep\b/.test(line)) continue;
    const parts = line.split(/\s+/);
    const pid = Number(parts[0]);
    let ppid = null;
    let cmdStart = 1;
    if (parts.length >= 3 && Number.isFinite(Number(parts[1])) && !String(parts[1]).includes("node")) {
      ppid = Number(parts[1]);
      cmdStart = 2;
    }
    const args = parts.slice(cmdStart).join(" ");
    if (!Number.isFinite(pid)) continue;
    matches.push({
      pid,
      ppid: Number.isFinite(ppid) ? ppid : null,
      args,
      command: LANE_A_REMOTE_COMMAND,
      orphanLikely: ppid === 1,
    });
  }
  return matches;
}

/**
 * Pre-launch process gate. Zero CL. Injectable process list.
 */
function evaluateLaneAProcessGate(params = {}) {
  const processes = Array.isArray(params.processes)
    ? params.processes
    : parseRemoteLaneAProcesses(params.psText || "");
  const ownership = params.laneAChild || null;
  const count = processes.length;

  if (count === 0) {
    return {
      allowLaunch: true,
      count: 0,
      reason: "NO_MATCHING_PROCESS",
      humanReviewRequired: false,
      emergencyStop: false,
      processes,
    };
  }

  if (count > 1) {
    return {
      allowLaunch: false,
      count,
      reason: REMOTE_CHILD_REASONS.MULTIPLE_LANE_A_CHILDREN,
      humanReviewRequired: true,
      emergencyStop: true,
      processes,
      courtListenerHttpCallsAllowed: false,
    };
  }

  const only = processes[0];
  const owned =
    ownership &&
    !ownership.terminal &&
    ownership.pid != null &&
    Number(ownership.pid) === Number(only.pid) &&
    (!ownership.command || only.args.includes(ownership.command || LANE_A_REMOTE_COMMAND));

  if (owned) {
    return {
      allowLaunch: false,
      count: 1,
      reason: REMOTE_CHILD_REASONS.LANE_A_CHILD_ALREADY_ACTIVE,
      humanReviewRequired: false,
      emergencyStop: false,
      superviseExisting: true,
      processes,
      ownedPid: only.pid,
    };
  }

  const orphan =
    only.ppid === 1 ||
    !ownership ||
    ownership.terminal ||
    ownership.pid == null ||
    Number(ownership.pid) !== Number(only.pid);

  return {
    allowLaunch: false,
    count: 1,
    reason: orphan
      ? REMOTE_CHILD_REASONS.ORPHAN_LANE_A_CHILD
      : REMOTE_CHILD_REASONS.LANE_A_CHILD_PID_MISMATCH,
    humanReviewRequired: true,
    emergencyStop: false,
    processes,
    orphanPid: only.pid,
    courtListenerHttpCallsAllowed: false,
  };
}

/**
 * Single-flight: may we spawn a NEW remote child?
 */
function maySpawnLaneARemoteChild(state, processGate) {
  const gate = processGate || evaluateLaneAProcessGate({ laneAChild: state?.laneAChild, processes: [] });
  if (gate.emergencyStop) {
    return { ok: false, reason: gate.reason, gate };
  }
  if (!gate.allowLaunch) {
    return {
      ok: false,
      reason:
        gate.reason === REMOTE_CHILD_REASONS.LANE_A_CHILD_ALREADY_ACTIVE
          ? REMOTE_CHILD_REASONS.LANE_A_CHILD_ALREADY_ACTIVE
          : gate.reason === REMOTE_CHILD_REASONS.ORPHAN_LANE_A_CHILD
            ? REMOTE_CHILD_REASONS.ORPHAN_LANE_A_CHILD
            : REMOTE_CHILD_REASONS.LANE_A_DUPLICATE_SPAWN_ATTEMPT,
      gate,
    };
  }
  // Durable ownership with a known live PID blocks a second spawn.
  // Intent-only records (pid null / launching) do not — attached supervisor fills pid after start.
  if (
    state?.laneAChild &&
    !state.laneAChild.terminal &&
    state.laneAChild.pid != null &&
    Number.isFinite(Number(state.laneAChild.pid))
  ) {
    return {
      ok: false,
      reason: REMOTE_CHILD_REASONS.LANE_A_CHILD_ALREADY_ACTIVE,
      gate,
      pid: state.laneAChild.pid,
    };
  }
  return { ok: true, reason: "CLEAR_TO_SPAWN", gate };
}

/**
 * Child may only make CL requests with ownership + session + budget.
 */
function assertChildMayMakeClRequest(params = {}) {
  const ownership = params.laneAChild || params.ownership || null;
  if (!ownership || ownership.terminal) {
    return { ok: false, reason: REMOTE_CHILD_REASONS.LANE_A_CHILD_OWNERSHIP_LOST };
  }
  if (!params.sessionId && !ownership.sessionId) {
    return { ok: false, reason: REMOTE_CHILD_REASONS.LANE_A_CHILD_NO_SESSION };
  }
  if (!params.batchId && !ownership.batchId) {
    return { ok: false, reason: REMOTE_CHILD_REASONS.LANE_A_CHILD_NO_SESSION };
  }
  const remaining = Number(params.remainingClBudget);
  if (Number.isFinite(remaining) && remaining <= 0) {
    return { ok: false, reason: REMOTE_CHILD_REASONS.LANE_A_CHILD_NO_BUDGET };
  }
  return { ok: true, reason: "OWNED_WITH_BUDGET" };
}

/**
 * Build kill plan for owned child (TERM then KILL). Pure — no network.
 */
function planRemoteChildTermination(ownership, opts = {}) {
  if (!ownership || ownership.pid == null) {
    return { ok: false, reason: "no_owned_pid", steps: [] };
  }
  const graceMs = Number(opts.graceMs) || 8000;
  return {
    ok: true,
    pid: Number(ownership.pid),
    command: ownership.command || LANE_A_REMOTE_COMMAND,
    sessionId: ownership.sessionId,
    batchId: ownership.batchId,
    steps: [
      { action: "VERIFY_IDENTITY", pid: Number(ownership.pid), command: ownership.command },
      { action: "SIGTERM", pid: Number(ownership.pid) },
      { action: "WAIT", ms: graceMs },
      { action: "SIGKILL_IF_ALIVE", pid: Number(ownership.pid) },
      { action: "CONFIRM_EXIT", pid: Number(ownership.pid) },
      { action: "CLEAR_OWNERSHIP" },
    ],
  };
}

function clearLaneAChildOwnership(state, params = {}) {
  const next = JSON.parse(JSON.stringify(state || {}));
  const now = (params.now instanceof Date ? params.now : new Date(params.now || Date.now())).toISOString();
  if (next.laneAChild) {
    next.laneAChild = {
      ...next.laneAChild,
      terminal: true,
      terminalAt: now,
      exitCode: params.exitCode != null ? params.exitCode : next.laneAChild.exitCode,
      clearedReason: params.reason || "confirmed_exit",
    };
  }
  if (params.clearRecord === true) {
    next.laneAChild = null;
  }
  if (params.jobPaused && next.laneA) {
    next.laneA.jobStatus = "quota_paused";
    next.laneA.jobLifecycle = "PAUSED_RESUMABLE";
  }
  next.updatedAt = now;
  return next;
}

/**
 * Detect PID reuse: same PID number but different identity fingerprint.
 */
function detectPidReuse(ownership, liveProcess) {
  if (!ownership || !liveProcess) return { reused: false };
  if (Number(ownership.pid) !== Number(liveProcess.pid)) return { reused: false };
  if (ownership.command && liveProcess.args && !liveProcess.args.includes(ownership.command)) {
    return {
      reused: true,
      reason: REMOTE_CHILD_REASONS.LANE_A_CHILD_PID_MISMATCH,
      humanReviewRequired: true,
    };
  }
  if (
    ownership.startedAt &&
    liveProcess.startedAt &&
    Date.parse(liveProcess.startedAt) < Date.parse(ownership.startedAt) - 1000
  ) {
    return {
      reused: true,
      reason: REMOTE_CHILD_REASONS.LANE_A_CHILD_PID_MISMATCH,
      humanReviewRequired: true,
    };
  }
  return { reused: false };
}

/**
 * Assert launcher must never use detached/unref patterns.
 * Comments are stripped so documentation of the ban does not false-positive.
 */
function assertLauncherForbidsDetach(launcherSource) {
  const src = String(launcherSource || "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "");
  const violations = [];
  if (/detached\s*:\s*true/.test(src)) violations.push("detached:true");
  if (/child\.unref\s*\(/.test(src)) violations.push("child.unref()");
  if (/\snohup\s/.test(src)) violations.push("nohup");
  return { ok: violations.length === 0, violations };
}

/**
 * Exact regression replay (mocked; zero network).
 */
function replayLaneARemoteChildOwnershipFlow() {
  const events = [];
  const push = (type, extra = {}) => events.push({ type, ...extra });
  let state = {
    laneA: {
      court: "mich",
      count: 20,
      target: 45,
      checkpoint: "cl-opinion-11250867",
      jobStatus: "quota_paused",
      jobLifecycle: "PAUSED_RESUMABLE",
    },
    laneAChild: null,
    queue3: "NOT_OPEN",
    humanReview: { required: false, reasons: [], details: [] },
  };

  let gate = evaluateLaneAProcessGate({ processes: [], laneAChild: null });
  let spawn = maySpawnLaneARemoteChild(state, gate);
  push("CYCLE1_SPAWN", spawn);
  state.laneAChild = createRemoteChildOwnership({
    pid: 100,
    ppid: 50,
    court: "mich",
    sessionId: "sess-1",
    batchId: "batch-1",
    workerId: "w1",
    processStartNonce: "n1",
  });
  push("CYCLE1_OWNED", { pid: 100, terminal: false });

  gate = evaluateLaneAProcessGate({
    processes: [{ pid: 100, ppid: 50, args: `node /tmp/${LANE_A_REMOTE_COMMAND}` }],
    laneAChild: state.laneAChild,
  });
  spawn = maySpawnLaneARemoteChild(state, gate);
  push("CYCLE2_BLOCKED", { ok: spawn.ok, reason: spawn.reason });
  if (spawn.ok) return { ok: false, events, reason: "second_spawn_allowed" };

  const term = planRemoteChildTermination(state.laneAChild, { graceMs: 10 });
  push("SIGINT_TERM", term);
  state = clearLaneAChildOwnership(state, {
    clearRecord: true,
    jobPaused: true,
    exitCode: 0,
    reason: "sigint_cleanup",
  });
  push("AFTER_CLEANUP", {
    child: state.laneAChild,
    jobLifecycle: state.laneA.jobLifecycle,
  });

  gate = evaluateLaneAProcessGate({
    processes: [{ pid: 101, ppid: 1, args: `node /tmp/${LANE_A_REMOTE_COMMAND}` }],
    laneAChild: null,
  });
  push("ORPHAN", { reason: gate.reason, allowLaunch: gate.allowLaunch });
  spawn = maySpawnLaneARemoteChild({ laneAChild: null }, gate);
  push("ORPHAN_NO_SPAWN", { ok: spawn.ok, reason: spawn.reason });

  gate = evaluateLaneAProcessGate({
    processes: [
      { pid: 1, ppid: 1, args: LANE_A_REMOTE_COMMAND },
      { pid: 2, ppid: 1, args: LANE_A_REMOTE_COMMAND },
      { pid: 3, ppid: 1, args: LANE_A_REMOTE_COMMAND },
    ],
    laneAChild: null,
  });
  push("MULTI", { reason: gate.reason, emergencyStop: gate.emergencyStop });

  const noCl =
    assertChildMayMakeClRequest({ laneAChild: null, sessionId: "x", remainingClBudget: 5 }).ok ===
    false;

  const ok =
    events.find((e) => e.type === "CYCLE2_BLOCKED")?.ok === false &&
    state.laneAChild === null &&
    state.laneA.jobLifecycle === "PAUSED_RESUMABLE" &&
    gate.emergencyStop === true &&
    gate.reason === REMOTE_CHILD_REASONS.MULTIPLE_LANE_A_CHILDREN &&
    events.find((e) => e.type === "ORPHAN")?.reason === REMOTE_CHILD_REASONS.ORPHAN_LANE_A_CHILD &&
    spawn.ok === false &&
    noCl &&
    state.queue3 === "NOT_OPEN";

  return {
    ok,
    events,
    state,
    courtListenerHttpCalls: 0,
    aiCalls: 0,
    mutations: 0,
    queue3: "NOT_OPEN",
  };
}

module.exports = {
  LANE_A_REMOTE_COMMAND,
  REMOTE_CHILD_REASONS,
  createRemoteChildOwnership,
  parseRemoteLaneAProcesses,
  evaluateLaneAProcessGate,
  maySpawnLaneARemoteChild,
  assertChildMayMakeClRequest,
  planRemoteChildTermination,
  clearLaneAChildOwnership,
  detectPidReuse,
  assertLauncherForbidsDetach,
  replayLaneARemoteChildOwnershipFlow,
};
