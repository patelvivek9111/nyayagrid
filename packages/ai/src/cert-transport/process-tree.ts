import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function assertNumericPid(pid: number): number {
  if (!Number.isInteger(pid) || pid <= 0 || pid > 2_147_483_647) {
    throw new Error("pid must be a positive integer produced by the runtime");
  }
  return pid;
}

export function isPidAlive(pid: number): boolean {
  const safe = assertNumericPid(pid);
  try {
    process.kill(safe, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Force-kill a process tree. PID is internally produced and validated; never interpolated
 * into a shell string.
 */
export async function killProcessTree(pid: number): Promise<void> {
  const safe = assertNumericPid(pid);
  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill", ["/PID", String(safe), "/T", "/F"], {
        windowsHide: true,
      });
    } catch {
      /* already gone */
    }
    return;
  }
  try {
    process.kill(-safe, "SIGKILL");
  } catch {
    try {
      process.kill(safe, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

export async function waitUntilDead(pid: number, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!isPidAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !isPidAlive(pid);
}
