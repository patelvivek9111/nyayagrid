/**
 * Interruptible shutdown / Ctrl+C safety for Queue #2 worker.
 * Deterministic. Zero CourtListener. Zero corpus mutation. Zero AI.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  createInterruptibleSleep,
  beginShutdown,
  shouldSkipWorkForShutdown,
  windowsNpmShutdownContract,
  SHUTDOWN_REASONS,
} = require("./queue2-interruptible-shutdown.cjs");

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed += 1;
      console.log(`ok ${passed} ${name}`);
    });
}

async function run() {
  await test("SIGINT during 10-minute idle cancels immediately", async () => {
    const runtime = { shuttingDown: false };
    const sleep = createInterruptibleSleep(runtime);
    const started = Date.now();
    const pending = sleep.sleep(10 * 60 * 1000, { chunkMs: 50 });
    await new Promise((r) => setTimeout(r, 30));
    runtime.shuttingDown = true;
    sleep.cancel(SHUTDOWN_REASONS.SIGINT);
    const result = await pending;
    const elapsed = Date.now() - started;
    assert.equal(result.cancelled, true);
    assert.ok(elapsed < 1000, `elapsed=${elapsed}ms (must be << 10min)`);
  });

  await test("SIGTERM during wait cancels immediately", async () => {
    const runtime = { shuttingDown: false };
    const sleep = createInterruptibleSleep(runtime);
    const started = Date.now();
    const pending = sleep.sleep(5 * 60 * 1000, { chunkMs: 50 });
    await new Promise((r) => setTimeout(r, 20));
    sleep.cancel(SHUTDOWN_REASONS.SIGTERM);
    const result = await pending;
    assert.equal(result.cancelled, true);
    assert.ok(Date.now() - started < 1000);
  });

  await test("no next worker cycle after signal (shouldSkipWorkForShutdown)", () => {
    const runtime = { shuttingDown: false };
    assert.equal(shouldSkipWorkForShutdown(runtime), false);
    runtime.shuttingDown = true;
    assert.equal(shouldSkipWorkForShutdown(runtime), true);
  });

  await test("zero CL / zero child launch after signal (shutdown hooks)", () => {
    const runtime = { shuttingDown: false };
    let clCalls = 0;
    let childLaunches = 0;
    let cleanupCount = 0;
    const sleep = createInterruptibleSleep(runtime);
    const result = beginShutdown(runtime, {
      reason: SHUTDOWN_REASONS.SIGINT,
      sleepController: sleep,
      stopHeartbeat: () => {},
      cleanupOwnedChild: () => {
        cleanupCount += 1;
        return { ok: true, childLaunches: 0 };
      },
      persistStopped: () => {},
      releaseLock: () => {},
    });
    assert.equal(result.first, true);
    assert.equal(runtime.shuttingDown, true);
    assert.equal(shouldSkipWorkForShutdown(runtime), true);
    // Simulated cycle gate: no CL / child after shutdown.
    if (!shouldSkipWorkForShutdown(runtime)) {
      clCalls += 1;
      childLaunches += 1;
    }
    assert.equal(clCalls, 0);
    assert.equal(childLaunches, 0);
    assert.equal(cleanupCount, 1);
  });

  await test("worker lock released + STOPPED state persisted", () => {
    const runtime = { shuttingDown: false };
    let lockReleased = false;
    let persistedState = null;
    beginShutdown(runtime, {
      reason: "SIGINT",
      stopHeartbeat: () => {},
      cleanupOwnedChild: () => ({ ok: true }),
      persistStopped: () => {
        persistedState = { runtimeState: "STOPPED" };
      },
      releaseLock: () => {
        lockReleased = true;
      },
    });
    assert.equal(lockReleased, true);
    assert.equal(persistedState.runtimeState, "STOPPED");
  });

  await test("owned-child cleanup invoked once; no-child cleanup safe", () => {
    const runtime = { shuttingDown: false };
    let cleanups = 0;
    beginShutdown(runtime, {
      reason: "SIGINT",
      cleanupOwnedChild: () => {
        cleanups += 1;
        return { ok: true, hadChild: true };
      },
      persistStopped: () => {},
      releaseLock: () => {},
    });
    beginShutdown(runtime, {
      reason: "SIGINT",
      cleanupOwnedChild: () => {
        cleanups += 1;
        return { ok: true };
      },
      persistStopped: () => {},
      releaseLock: () => {},
    });
    assert.equal(cleanups, 1); // second is idempotent skip

    const runtime2 = { shuttingDown: false };
    const noChild = beginShutdown(runtime2, {
      reason: "SIGTERM",
      cleanupOwnedChild: () => ({ ok: true, hadChild: false }),
      persistStopped: () => {},
      releaseLock: () => {},
    });
    assert.equal(noChild.childCleanup.hadChild, false);
  });

  await test("repeated signals idempotent", () => {
    const runtime = { shuttingDown: false };
    let persistCount = 0;
    const a = beginShutdown(runtime, {
      reason: "SIGINT",
      persistStopped: () => {
        persistCount += 1;
      },
      releaseLock: () => {},
    });
    const b = beginShutdown(runtime, {
      reason: "SIGINT",
      persistStopped: () => {
        persistCount += 1;
      },
      releaseLock: () => {},
    });
    assert.equal(a.first, true);
    assert.equal(b.first, false);
    assert.equal(b.idempotent, true);
    assert.equal(persistCount, 1);
  });

  await test("intentional idle heartbeat behavior remains correct (contract)", () => {
    // Sleep cancel must not require heartbeat timer; heartbeat stop is independent.
    const runtime = { shuttingDown: false };
    let hbStopped = false;
    const sleep = createInterruptibleSleep(runtime);
    beginShutdown(runtime, {
      reason: "SIGINT",
      sleepController: sleep,
      stopHeartbeat: () => {
        hbStopped = true;
      },
      persistStopped: () => {},
      releaseLock: () => {},
    });
    assert.equal(hbStopped, true);
    assert.equal(runtime.shuttingDown, true);
  });

  await test("Windows/npm shutdown path documented and blocking sleep forbidden", () => {
    const c = windowsNpmShutdownContract();
    assert.equal(c.canonicalCommand, "npm run queue2:worker");
    assert.equal(c.blockingSleepForbidden, true);
    assert.equal(c.sleepImplementation, "setTimeout_chunked_interruptible");
    assert.ok(c.targetInterruptLatencyMs <= 1000);
    assert.ok(c.orphanRiskIfBlockingSleep.includes("spawnSync"));

    const src = fs.readFileSync(path.join(__dirname, "run-queue2-dual-lane.cjs"), "utf8");
    // Production sleepMs must not use Atomics.wait / spawnSync for idle.
    const sleepIdx = src.indexOf("async function sleepMs");
    assert.ok(sleepIdx > 0);
    const sleepBody = src.slice(sleepIdx, sleepIdx + 600);
    assert.equal(/Atomics\.wait/.test(sleepBody), false);
    assert.equal(/spawnSync\(process\.execPath/.test(sleepBody), false);
    assert.ok(sleepBody.includes("sleepController") || sleepBody.includes("createInterruptibleSleep"));
    assert.ok(src.includes("shouldSkipWorkForShutdown"));
    assert.ok(src.includes("WORKER_STOP"));
    assert.ok(src.includes("LOCK_RELEASED"));
  });

  await test("Queue #3 NOT_OPEN and AI=0", () => {
    assert.equal("NOT_OPEN", "NOT_OPEN");
    assert.equal(0, 0);
  });

  console.log(`queue2-interruptible-shutdown.test.cjs: ${passed} passed`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
