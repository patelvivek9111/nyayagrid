/**
 * Parent watchdog: spawn one child per live provider attempt, abort, then force-kill the tree.
 * Never starts a retry while the previous child is alive.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { DirectProviderId } from "../router/direct-provider";
import { CertProviderCircuit } from "./circuit";
import type { CertErrorClass } from "./errors";
import { AttemptLifecycle, LiveAttemptGate } from "./lifecycle";
import { isPidAlive, killProcessTree, waitUntilDead } from "./process-tree";
import type { CertChildFault, CertChildRequest, CertChildResult } from "./protocol";
import { emptyUsageCostUnknown } from "./protocol";
import { backoffMsFor, maxRetriesFor } from "./retry-policy";
import { resolveCertTimeoutConfig, type CertTimeoutConfig } from "./timeouts";

const here = dirname(fileURLToPath(import.meta.url));
const CHILD_SCRIPT = join(here, "provider-call-child.ts");
const HANG_SCRIPT = join(here, "hang-child.ts");

export type IsolatedCallParams = {
  provider: DirectProviderId;
  modelId: string;
  taskId: string;
  messages: CertChildRequest["messages"];
  temperature?: number;
  fault?: CertChildFault;
  /** Test-only: spawn the refuse-exit hang script instead of the provider child. */
  hangForever?: boolean;
  timeouts?: CertTimeoutConfig;
  circuit?: CertProviderCircuit;
  gate?: LiveAttemptGate;
  env?: NodeJS.ProcessEnv;
};

export type IsolatedCallOutcome = CertChildResult & {
  retriesUsed: number;
  hardKilled: boolean;
  childPid: number | null;
  circuitState: string;
  attemptStates: string[];
};

const activeChildren = new Set<ChildProcess>();
let cleanupRegistered = false;

export function registerCertProcessCleanup(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  const stop = () => {
    for (const child of activeChildren) {
      if (child.pid) void killProcessTree(child.pid);
    }
  };
  process.once("SIGINT", () => {
    stop();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    stop();
    process.exit(143);
  });
}

function tsxCli(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve("tsx/package.json")), "dist", "cli.mjs");
}

function spawnTsx(script: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(process.execPath, [tsxCli(), script, ...args], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  activeChildren.add(child);
  child.once("exit", () => activeChildren.delete(child));
  return child;
}

async function waitChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode != null || child.signalCode) return true;
  return await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function readResult(resultPath: string, fallback: CertChildResult): CertChildResult {
  try {
    const raw = readFileSync(resultPath, "utf8").trim();
    if (!raw) return fallback;
    return JSON.parse(raw) as CertChildResult;
  } catch {
    return fallback;
  }
}

function lineageKey(params: IsolatedCallParams): string {
  return `${params.provider}:${params.modelId}:task:${params.taskId}`;
}

export async function runIsolatedProviderCall(
  params: IsolatedCallParams,
): Promise<IsolatedCallOutcome> {
  const timeouts = params.timeouts ?? resolveCertTimeoutConfig(params.env ?? process.env);
  const circuit = params.circuit ?? new CertProviderCircuit();
  const gate = params.gate ?? new LiveAttemptGate();
  const attemptStates: string[] = [];
  let retriesUsed = 0;
  let last: CertChildResult | null = null;
  let lastPid: number | null = null;
  let hardKilled = false;

  if (circuit.isOpen(params.provider, params.modelId)) {
    return {
      provider: params.provider,
      model: params.modelId,
      taskId: params.taskId,
      attempt: 0,
      status: "PROVIDER_HARD_TIMEOUT",
      costKnown: false,
      normalizedError: "NOT_RUN_PROVIDER_UNSTABLE",
      retriesUsed: 0,
      hardKilled: false,
      childPid: null,
      circuitState: circuit.getState(params.provider, params.modelId),
      attemptStates: ["CIRCUIT_OPEN"],
    };
  }

  const maxAttempts = 1 + Math.max(
    maxRetriesFor("PROVIDER_HARD_TIMEOUT"),
    maxRetriesFor("PROVIDER_REQUEST_TIMEOUT"),
    maxRetriesFor("PROVIDER_RATE_LIMIT"),
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const life = new AttemptLifecycle(`${lineageKey(params)}#${attempt}`);
    life.transition("RUNNING");
    attemptStates.push(`${life.id}:RUNNING`);
    gate.begin(lineageKey(params));

    const dir = mkdtempSync(join(tmpdir(), "nyaya-cert-call-"));
    const requestPath = join(dir, "request.json");
    const resultPath = join(dir, "result.json");
    const request: CertChildRequest = {
      provider: params.provider,
      modelId: params.modelId,
      taskId: params.taskId,
      attempt,
      requestTimeoutMs: timeouts.requestTimeoutMs,
      messages: params.messages,
      temperature: params.temperature ?? 0,
      fault: params.fault,
    };
    writeFileSync(requestPath, `${JSON.stringify(request)}\n`);

    const env: NodeJS.ProcessEnv = {
      ...(params.env ?? process.env),
      NYAYA_CERT_ISOLATED: "1",
    };
    const child = params.hangForever
      ? spawnTsx(HANG_SCRIPT, [], env)
      : spawnTsx(CHILD_SCRIPT, ["--request", requestPath, "--result", resultPath], env);
    child.stdout?.resume();
    child.stderr?.resume();

    if (!child.pid) {
      gate.end(lineageKey(params));
      throw new Error("failed to spawn cert provider child");
    }
    life.pid = child.pid;
    gate.setPid(child.pid);
    lastPid = child.pid;

    let attemptHardKilled = false;
    const exitedInRequestWindow = await waitChildExit(child, timeouts.requestTimeoutMs);
    if (!exitedInRequestWindow) {
      life.transition("ABORT_REQUESTED");
      attemptStates.push("ABORT_REQUESTED");
      if (process.platform !== "win32") {
        try {
          child.kill("SIGTERM");
        } catch {
          /* ignore */
        }
      }
    }

    const abortWaitMs = Math.max(50, timeouts.hardWatchdogMs - timeouts.requestTimeoutMs);
    const exitedAfterAbort = exitedInRequestWindow
      ? true
      : process.platform === "win32"
        ? false
        : await waitChildExit(child, abortWaitMs);

    if (!exitedAfterAbort) {
      life.transition("HARD_KILL_REQUESTED");
      attemptStates.push("HARD_KILL_REQUESTED");
      await killProcessTree(child.pid);
      attemptHardKilled = true;
      hardKilled = true;
      const dead = await waitUntilDead(child.pid, timeouts.terminationWaitMs);
      if (!dead && isPidAlive(child.pid)) {
        await killProcessTree(child.pid);
        await waitUntilDead(child.pid, timeouts.terminationWaitMs);
      }
    }

    await waitChildExit(child, 1_000);
    life.transition("TERMINATED");
    attemptStates.push("TERMINATED");
    gate.end(lineageKey(params));

    const fallback: CertChildResult = {
      provider: params.provider,
      model: params.modelId,
      taskId: params.taskId,
      attempt,
      status: attemptHardKilled || !exitedInRequestWindow ? "PROVIDER_HARD_TIMEOUT" : "PROVIDER_TRANSPORT",
      costKnown: false,
      normalizedError: attemptHardKilled ? "PROVIDER_HARD_TIMEOUT" : "child exited without result",
    };
    last = emptyUsageCostUnknown(readResult(resultPath, fallback));
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    if (!exitedAfterAbort || attemptHardKilled) {
      last = emptyUsageCostUnknown({
        ...last,
        status: "PROVIDER_HARD_TIMEOUT",
        costKnown: false,
        usage: undefined,
        normalizedError: "PROVIDER_HARD_TIMEOUT",
      });
      circuit.recordHardHang(params.provider, params.modelId);
    }

    if (circuit.isOpen(params.provider, params.modelId) && last.status === "PROVIDER_HARD_TIMEOUT") {
      return {
        ...last,
        retriesUsed,
        hardKilled,
        childPid: lastPid,
        circuitState: circuit.getState(params.provider, params.modelId),
        attemptStates,
      };
    }

    if (last.status === "ok") {
      return {
        ...last,
        retriesUsed,
        hardKilled,
        childPid: lastPid,
        circuitState: circuit.getState(params.provider, params.modelId),
        attemptStates,
      };
    }

    const errorClass = last.status as CertErrorClass;
    const allowed = maxRetriesFor(errorClass);
    if (retriesUsed >= allowed) {
      return {
        ...last,
        retriesUsed,
        hardKilled,
        childPid: lastPid,
        circuitState: circuit.getState(params.provider, params.modelId),
        attemptStates,
      };
    }

    life.transition("RETRY_ALLOWED");
    attemptStates.push("RETRY_ALLOWED");
    retriesUsed += 1;
    const wait = backoffMsFor(errorClass, retriesUsed);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  if (!last) throw new Error("isolated call produced no result");
  return {
    ...last,
    retriesUsed,
    hardKilled,
    childPid: lastPid,
    circuitState: circuit.getState(params.provider, params.modelId),
    attemptStates,
  };
}

export { CHILD_SCRIPT, HANG_SCRIPT };
