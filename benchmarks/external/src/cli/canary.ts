/**
 * ONE-CALL canary entrypoint.
 * Requires --allow-paid-model-calls and --max-cost-usd 1 (hard canary cap).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { getRegistryDir } from "../paths.js";
import { checkCredentialPresence, allCredentialsPresent } from "../live/credentials.js";
import { loadExternalBenchLocalEnv } from "../live/load-local-env.js";
import { runLiveCanary } from "../live/canary-executor.js";
import { BudgetLimitError } from "../live/budget.js";
import { UnknownCompletionError } from "../live/retry.js";
import { LiveProviderError } from "../providers/live-errors.js";

async function main(): Promise<void> {
  loadExternalBenchLocalEnv();
  const plan = JSON.parse(
    readFileSync(path.join(getRegistryDir(), "canary-plan.json"), "utf8"),
  ) as {
    task: { taskId: string };
    response_model: { exactModelId: string };
    cost: { hard_cap_usd: number };
  };

  const creds = checkCredentialPresence();
  if (!allCredentialsPresent(creds)) {
    console.error(
      JSON.stringify(
        {
          status: "LIVE_CANARY_BLOCKED",
          reason: "credentials_missing",
          credentials: creds,
          valuesPrinted: false,
          paidCalls: 0,
        },
        null,
        2,
      ),
    );
    process.exitCode = 2;
    return;
  }

  try {
    const summary = await runLiveCanary({ argv: process.argv });
    console.log(JSON.stringify(summary, null, 2));
    if (summary.status !== "LIVE_CANARY_PASS") {
      process.exitCode = 2;
    }
  } catch (err) {
    const reason =
      err instanceof BudgetLimitError
        ? err.message
        : err instanceof UnknownCompletionError
          ? err.message
          : err instanceof LiveProviderError
            ? `${err.code}: ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err);
    const status =
      err instanceof BudgetLimitError
        ? "LIVE_CANARY_BUDGET_STOP"
        : err instanceof UnknownCompletionError
          ? "LIVE_CANARY_UNKNOWN_COMPLETION"
          : "LIVE_CANARY_BLOCKED";
    console.error(
      JSON.stringify(
        {
          status,
          reason,
          prepared: {
            taskId: plan.task.taskId,
            model: plan.response_model.exactModelId,
            hardCapUsd: plan.cost.hard_cap_usd,
          },
          paidCalls: 0,
          valuesPrinted: false,
        },
        null,
        2,
      ),
    );
    process.exitCode = 2;
  }
}

main();
