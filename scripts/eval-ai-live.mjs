/**
 * Run live evals in both workspaces even if the first misses the bar.
 * Measurement needs the contract-compare table whether or not Case Q&A passed.
 */
import { spawnSync } from "node:child_process";

function run(workspace) {
  const result = spawnSync("npm", ["run", "eval:ai:live", "-w", workspace], {
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  return result.status ?? 1;
}

const ai = run("@nyayagrid/ai");
const intelligence = run("@nyayagrid/intelligence");
process.exit(ai !== 0 || intelligence !== 0 ? 1 : 0);
