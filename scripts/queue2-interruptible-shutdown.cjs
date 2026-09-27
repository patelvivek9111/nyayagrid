/**
 * Interruptible idle sleep + shutdown coordination for Queue #2 worker.
 * Pure helpers. Zero network. Zero CourtListener. Zero AI.
 *
 * Root cause of Ctrl+C defect: sleepMs used spawnSync(Atomics.wait), which blocks
 * the event loop. SIGINT often killed only the wait child; the parent resumed
 * the loop after spawnSync returned.
 */
"use strict";

const SHUTDOWN_REASONS = Object.freeze({
  SIGINT: "SIGINT",
  SIGTERM: "SIGTERM",
  CODE_CHANGE_DETECTED: "CODE_CHANGE_DETECTED",
  KILL_SWITCH_STOP: "KILL_SWITCH_STOP",
  OPERATOR: "OPERATOR",
});

/**
 * Create an interruptible sleep controller bound to a shared runtime flag.
 * sleep() resolves early when cancel() is called or runtime.shuttingDown becomes true.
 */
function createInterruptibleSleep(runtime = {}) {
  let timer = null;
  let rejectPending = null;
  let sleeping = false;
  let cancelCount = 0;

  function cancel(reason = "shutdown") {
    cancelCount += 1;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (typeof rejectPending === "function") {
      const rej = rejectPending;
      rejectPending = null;
      sleeping = false;
      // Resolve (not reject) so awaiters can check shuttingDown and exit cleanly.
      rej({ cancelled: true, reason: String(reason || "shutdown") });
    }
    return { cancelled: true, reason: String(reason || "shutdown"), cancelCount };
  }

  /**
   * Awaitable sleep. Never uses spawnSync / Atomics.wait.
   * Chunks long waits so shuttingDown is observed promptly even without cancel().
   */
  async function sleep(ms, opts = {}) {
    const total = Math.max(0, Number(ms) || 0);
    if (total <= 0) return { sleptMs: 0, cancelled: false };
    if (runtime.shuttingDown) return { sleptMs: 0, cancelled: true, reason: "already_shutting_down" };

    const chunkMs = Math.max(50, Math.min(1000, Number(opts.chunkMs) || 250));
    const started = Date.now();
    let remaining = total;
    sleeping = true;

    try {
      while (remaining > 0) {
        if (runtime.shuttingDown) {
          return {
            sleptMs: Date.now() - started,
            cancelled: true,
            reason: "shutting_down",
          };
        }
        const slice = Math.min(chunkMs, remaining);
        const result = await new Promise((resolve) => {
          rejectPending = resolve;
          timer = setTimeout(() => {
            timer = null;
            rejectPending = null;
            resolve({ cancelled: false });
          }, slice);
        });
        if (result && result.cancelled) {
          return {
            sleptMs: Date.now() - started,
            cancelled: true,
            reason: result.reason || "cancel",
          };
        }
        remaining -= slice;
      }
      return { sleptMs: Date.now() - started, cancelled: false };
    } finally {
      sleeping = false;
      timer = null;
      rejectPending = null;
    }
  }

  return {
    sleep,
    cancel,
    isSleeping: () => sleeping,
    cancelCount: () => cancelCount,
  };
}

/**
 * Begin shutdown. Idempotent.
 * Sets shuttingDown immediately, cancels pending sleep, stops heartbeat.
 * Caller supplies cleanup hooks (child, persist, lock).
 */
function beginShutdown(runtime, hooks = {}) {
  const reason = String(hooks.reason || "signal");
  const first = runtime.shuttingDown !== true;
  runtime.shuttingDown = true;

  let sleepCancel = null;
  if (typeof hooks.cancelSleep === "function") {
    sleepCancel = hooks.cancelSleep(reason);
  } else if (hooks.sleepController && typeof hooks.sleepController.cancel === "function") {
    sleepCancel = hooks.sleepController.cancel(reason);
  }

  if (typeof hooks.stopHeartbeat === "function") {
    hooks.stopHeartbeat();
  }

  const steps = {
    first,
    reason,
    sleepCancel,
    childCleanup: null,
    persisted: false,
    lockReleased: false,
    skippedWork: true,
  };

  if (!first) {
    return { ...steps, idempotent: true };
  }

  if (typeof hooks.cleanupOwnedChild === "function") {
    try {
      steps.childCleanup = hooks.cleanupOwnedChild(reason) || { invoked: true };
    } catch (err) {
      steps.childCleanup = { ok: false, err: String(err.message || err).slice(0, 200) };
    }
  } else {
    steps.childCleanup = { invoked: false, reason: "no_hook" };
  }

  if (typeof hooks.persistStopped === "function") {
    try {
      hooks.persistStopped(reason);
      steps.persisted = true;
    } catch {
      steps.persisted = false;
    }
  }

  if (typeof hooks.releaseLock === "function") {
    try {
      hooks.releaseLock(reason);
      steps.lockReleased = true;
    } catch {
      steps.lockReleased = false;
    }
  }

  return { ...steps, idempotent: false };
}

/**
 * Guard: expensive control-plane work must not run after shutdown begins.
 */
function shouldSkipWorkForShutdown(runtime) {
  return Boolean(runtime && runtime.shuttingDown);
}

/**
 * Documented Windows / npm shutdown expectations (unit-testable contract).
 */
function windowsNpmShutdownContract() {
  return {
    canonicalCommand: "npm run queue2:worker",
    directCommand: "node scripts/run-queue2-dual-lane.cjs --loop",
    blockingSleepForbidden: true,
    sleepImplementation: "setTimeout_chunked_interruptible",
    eventLoopMustRemainResponsive: true,
    signalHandlers: ["SIGINT", "SIGTERM"],
    // npm on Windows may exit while a spawnSync child held the console focus;
    // interruptible sleep keeps SIGINT on the worker process itself.
    orphanRiskIfBlockingSleep: "spawnSync_Atomics_wait_child_dies_parent_continues",
    lockPreventsSecondWorker: true,
    targetInterruptLatencyMs: 1000,
    notes: [
      "Do not use spawnSync/Atomics.wait for idle sleep.",
      "SIGINT must set shuttingDown before any further cycle work.",
      "Worker lock PID ownership still blocks a second concurrent worker.",
    ],
  };
}

module.exports = {
  SHUTDOWN_REASONS,
  createInterruptibleSleep,
  beginShutdown,
  shouldSkipWorkForShutdown,
  windowsNpmShutdownContract,
};
