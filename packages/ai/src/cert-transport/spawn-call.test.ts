import { describe, expect, it } from "vitest";
import { CertProviderCircuit } from "./circuit";
import { LiveAttemptGate, AttemptLifecycle } from "./lifecycle";
import { isPidAlive, killProcessTree, assertNumericPid } from "./process-tree";
import { CERT_RETRY_MAX } from "./retry-policy";
import { runIsolatedProviderCall } from "./spawn-call";
import { resolveCertTimeoutConfig } from "./timeouts";

const shortTimeouts = {
  requestTimeoutMs: 8_000,
  hardWatchdogMs: 12_000,
  terminationWaitMs: 5_000,
  maxBodyBytes: 1_000,
};

describe("cert attempt lifecycle", () => {
  it("never transitions RUNNING to RETRY_ALLOWED", () => {
    const life = new AttemptLifecycle("t1");
    life.transition("RUNNING");
    expect(() => life.transition("RETRY_ALLOWED")).toThrow(/illegal/);
    life.transition("HARD_KILL_REQUESTED");
    life.transition("TERMINATED");
    life.transition("RETRY_ALLOWED");
    expect(life.retryAllowed).toBe(true);
  });

  it("refuses overlapping live attempts", () => {
    const gate = new LiveAttemptGate();
    gate.begin("google:gemini:task:a");
    expect(() => gate.begin("google:gemini:task:b")).toThrow(/overlap/);
    gate.end("google:gemini:task:a");
    gate.begin("google:gemini:task:b");
    expect(gate.current?.key).toBe("google:gemini:task:b");
    gate.end("google:gemini:task:b");
  });
});

describe("retry policy", () => {
  it("bounds retries by error class", () => {
    expect(CERT_RETRY_MAX.PROVIDER_HARD_TIMEOUT).toBe(1);
    expect(CERT_RETRY_MAX.PROVIDER_REQUEST_TIMEOUT).toBe(1);
    expect(CERT_RETRY_MAX.PROVIDER_RATE_LIMIT).toBe(2);
    expect(CERT_RETRY_MAX.PROVIDER_5XX).toBe(2);
    expect(CERT_RETRY_MAX.PROVIDER_AUTH).toBe(0);
    expect(CERT_RETRY_MAX.PROVIDER_MODEL_UNAVAILABLE).toBe(0);
    expect(CERT_RETRY_MAX.PROVIDER_QUOTA).toBe(0);
    expect(CERT_RETRY_MAX.PROVIDER_TRANSPORT).toBe(1);
    expect(CERT_RETRY_MAX.PROVIDER_MALFORMED_RESPONSE).toBe(1);
  });
});

describe("process tree pid guard", () => {
  it("rejects non-numeric pids", () => {
    expect(() => assertNumericPid(Number.NaN)).toThrow(/pid/);
    expect(() => assertNumericPid(-1)).toThrow(/pid/);
    expect(() => assertNumericPid(1.5)).toThrow(/pid/);
  });
});

describe("isolated provider watchdog", () => {
  it(
    "hard-kills a child that ignores abort and leaves no orphan",
    { timeout: 40_000 },
    async () => {
      const circuit = new CertProviderCircuit();
      const gate = new LiveAttemptGate();
      const outcome = await runIsolatedProviderCall({
        provider: "google",
        modelId: "gemini-3.6-flash",
        taskId: "hang-1",
        messages: [{ role: "user", content: "ping" }],
        hangForever: true,
        timeouts: shortTimeouts,
        circuit,
        gate,
      });
      expect(outcome.status).toBe("PROVIDER_HARD_TIMEOUT");
      expect(outcome.costKnown).toBe(false);
      expect(outcome.hardKilled).toBe(true);
      expect(outcome.retriesUsed).toBeLessThanOrEqual(1);
      expect(gate.current).toBeNull();
      if (outcome.childPid) {
        expect(isPidAlive(outcome.childPid)).toBe(false);
      }
      expect(outcome.attemptStates.some((s) => s.includes("TERMINATED"))).toBe(true);
      expect(gate.current).toBeNull();
    },
  );

  it("fault 429 / 500 / malformed / ok without hang", { timeout: 40_000 }, async () => {
    const gate = new LiveAttemptGate();
    const ok = await runIsolatedProviderCall({
      provider: "google",
      modelId: "gemini-3.6-flash",
      taskId: "ok-1",
      messages: [{ role: "user", content: "ping" }],
      fault: "ok",
      timeouts: shortTimeouts,
      gate,
    });
    expect(ok.status).toBe("ok");
    expect(ok.result?.text).toContain("ok");

    const r429 = await runIsolatedProviderCall({
      provider: "google",
      modelId: "gemini-3.6-flash",
      taskId: "429-1",
      messages: [{ role: "user", content: "ping" }],
      fault: "429",
      timeouts: shortTimeouts,
      gate: new LiveAttemptGate(),
    });
    expect(r429.status).toBe("PROVIDER_RATE_LIMIT");

    const r500 = await runIsolatedProviderCall({
      provider: "google",
      modelId: "gemini-3.6-flash",
      taskId: "500-1",
      messages: [{ role: "user", content: "ping" }],
      fault: "500",
      timeouts: shortTimeouts,
      gate: new LiveAttemptGate(),
    });
    expect(r500.status).toBe("PROVIDER_5XX");

    const malformed = await runIsolatedProviderCall({
      provider: "google",
      modelId: "gemini-3.6-flash",
      taskId: "malformed-1",
      messages: [{ role: "user", content: "ping" }],
      fault: "malformed",
      timeouts: shortTimeouts,
      gate: new LiveAttemptGate(),
    });
    expect(malformed.status).toBe("PROVIDER_MALFORMED_RESPONSE");
  });

  it("opens the circuit after two hard hangs and skips later live calls", { timeout: 60_000 }, async () => {
    const circuit = new CertProviderCircuit();
    const first = await runIsolatedProviderCall({
      provider: "google",
      modelId: "gemini-3.6-flash",
      taskId: "hang-a",
      messages: [{ role: "user", content: "ping" }],
      hangForever: true,
      timeouts: shortTimeouts,
      circuit,
      gate: new LiveAttemptGate(),
    });
    expect(first.status).toBe("PROVIDER_HARD_TIMEOUT");
    expect(circuit.getState("google", "gemini-3.6-flash")).toBe("CIRCUIT_OPEN");

    const second = await runIsolatedProviderCall({
      provider: "openai",
      modelId: "gpt-4o-mini",
      taskId: "other-ok",
      messages: [{ role: "user", content: "ping" }],
      fault: "ok",
      timeouts: shortTimeouts,
      circuit,
      gate: new LiveAttemptGate(),
    });
    expect(second.status).toBe("ok");

    const skipped = await runIsolatedProviderCall({
      provider: "google",
      modelId: "gemini-3.6-flash",
      taskId: "hang-b",
      messages: [{ role: "user", content: "ping" }],
      hangForever: true,
      timeouts: shortTimeouts,
      circuit,
      gate: new LiveAttemptGate(),
    });
    expect(skipped.normalizedError).toBe("NOT_RUN_PROVIDER_UNSTABLE");
    expect(skipped.childPid).toBeNull();
  });
});

describe("timeout config", () => {
  it("keeps watchdog above request timeout", () => {
    const cfg = resolveCertTimeoutConfig({
      CERT_REQUEST_TIMEOUT_MS: "45000",
      CERT_HARD_WATCHDOG_MS: "60000",
    });
    expect(cfg.requestTimeoutMs).toBe(45_000);
    expect(cfg.hardWatchdogMs).toBe(60_000);
  });
});

describe("killProcessTree is a no-op for already-dead pids", () => {
  it("does not throw", async () => {
    await expect(killProcessTree(process.pid + 1_000_000)).resolves.toBeUndefined();
  });
});
