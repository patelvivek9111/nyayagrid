/**
 * Stage-1 screening entrypoint.
 * Requires --allow-paid-model-calls and --max-cost-usd 25 (hard Stage-1 cap).
 * Does NOT auto-start Stage 2.
 */
import { checkCredentialPresence, allCredentialsPresent } from "../live/credentials.js";
import { loadExternalBenchLocalEnv } from "../live/load-local-env.js";
import { runStage1Screening } from "../live/stage1-executor.js";
import { BudgetLimitError } from "../live/budget.js";
import { UnknownCompletionError } from "../live/retry.js";
import { assertNoAutoEscalation } from "../live/stage-gate.js";

async function main(): Promise<void> {
  loadExternalBenchLocalEnv();
  assertNoAutoEscalation();

  const creds = checkCredentialPresence();
  if (!allCredentialsPresent(creds)) {
    console.error(
      JSON.stringify(
        {
          status: "STAGE1_BLOCKED",
          reason: "credentials_missing",
          credentials: creds,
          valuesPrinted: false,
          paidCalls: 0,
          stage2Started: false,
        },
        null,
        2,
      ),
    );
    process.exitCode = 2;
    return;
  }

  try {
    const summary = await runStage1Screening({ argv: process.argv });
    console.log(JSON.stringify(summary, null, 2));
    if (summary.status !== "STAGE1_COMPLETE") {
      process.exitCode = 2;
    }
  } catch (err) {
    const reason =
      err instanceof BudgetLimitError
        ? err.message
        : err instanceof UnknownCompletionError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
    const status =
      err instanceof BudgetLimitError
        ? "STAGE1_BUDGET_STOP"
        : err instanceof UnknownCompletionError
          ? "STAGE1_PARTIAL"
          : "STAGE1_BLOCKED";
    console.error(
      JSON.stringify(
        {
          status,
          reason,
          paidCalls: 0,
          stage2Started: false,
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
