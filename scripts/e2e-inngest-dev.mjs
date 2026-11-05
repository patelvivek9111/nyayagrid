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

const child = spawn(
  "npx",
  ["--yes", "inngest-cli@latest", "dev", "-u", SDK_URL, "-p", INNGEST_PORT],
  { stdio: "inherit", shell: true, env: process.env },
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
