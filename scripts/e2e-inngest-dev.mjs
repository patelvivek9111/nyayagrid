#!/usr/bin/env node
/**
 * Start the Inngest dev server after the Next.js app is accepting /api/inngest.
 * Playwright (and local e2e) use this so document ingest is not a forgotten extra terminal.
 */
import { spawn } from "node:child_process";

const APP_URL = process.env.E2E_APP_URL ?? "http://127.0.0.1:3000";
const INNGEST_PORT = process.env.E2E_INNGEST_PORT ?? "8288";
const SDK_URL = `${APP_URL.replace(/\/$/, "")}/api/inngest`;

async function waitFor(url, timeoutMs) {
  const started = Date.now();
  let last = "not contacted";
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.status < 500) return;
      last = `HTTP ${res.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Timed out waiting for ${url} (${last})`);
}

await waitFor(SDK_URL, 90_000);

// CI/npx can inherit ignore-scripts=true (or a poisoned npx cache), which skips the
// inngest-cli postinstall that downloads the binary and then fails with:
// "Inngest CLI binary not found." Force scripts on and use a fresh cache when CI=true.
const npxEnv = {
  ...process.env,
  NPM_CONFIG_IGNORE_SCRIPTS: "false",
};
if (process.env.CI) {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  npxEnv.NPM_CONFIG_CACHE = mkdtempSync(join(tmpdir(), "nyaya-npx-"));
}

const child = spawn(
  "npx",
  [
    "--yes",
    "--ignore-scripts=false",
    "inngest-cli@latest",
    "dev",
    "-u",
    SDK_URL,
    "-p",
    INNGEST_PORT,
  ],
  { stdio: "inherit", shell: true, env: npxEnv },
);

function shutdown() {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", shell: true });
    return;
  }
  child.kill("SIGTERM");
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
