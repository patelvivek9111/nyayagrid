/**
 * Tiny isolated live smoke. 3 structured pings. Does not print secrets.
 */
import { loadCanonicalLocalEnv, repoRootFromHere } from "../load-local-env";
import { isPidAlive, registerCertProcessCleanup, runIsolatedProviderCall } from "./index";

loadCanonicalLocalEnv({ repoRoot: repoRootFromHere(import.meta.url, 4) });
registerCertProcessCleanup();

const pings = 3;
let hangs = 0;
let hardTimeouts = 0;
const pids: number[] = [];

for (let i = 1; i <= pings; i += 1) {
  const started = Date.now();
  const outcome = await runIsolatedProviderCall({
    provider: "google",
    modelId: process.env.GOOGLE_MODEL?.trim() || "gemini-3.6-flash",
    taskId: `smoke-${i}`,
    messages: [
      { role: "system", content: "Reply with JSON only." },
      { role: "user", content: '{"task":"ping"} Return {"ok":true} and nothing else.' },
    ],
    temperature: 0,
  });
  if (outcome.childPid) pids.push(outcome.childPid);
  if (outcome.status === "PROVIDER_HARD_TIMEOUT") {
    hardTimeouts += 1;
    hangs += 1;
  }
  process.stdout.write(
    `smoke ${i}/${pings} status=${outcome.status} hardKilled=${outcome.hardKilled} latencyMs=${Date.now() - started} pidAlive=${outcome.childPid ? isPidAlive(outcome.childPid) : false}\n`,
  );
}

const orphan = pids.some((pid) => isPidAlive(pid));
process.stdout.write(`hardTimeouts=${hardTimeouts} orphan=${orphan}\n`);
if (orphan) process.exitCode = 1;
