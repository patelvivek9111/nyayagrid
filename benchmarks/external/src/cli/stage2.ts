/**
 * Stage-2 finalist entrypoint.
 * Requires --allow-paid-model-calls and --max-cost-usd (hard Stage-2 cap).
 * Does NOT auto-start Stage 3. Do not invoke with paid flags until authorized.
 */
import { checkCredentialPresence } from "../live/credentials.js";
import { loadExternalBenchLocalEnv } from "../live/load-local-env.js";
import { runStage2Finalists } from "../live/stage2-executor.js";
import { BudgetLimitError } from "../live/budget.js";
import { UnknownCompletionError } from "../live/retry.js";
import { assertNoAutoEscalation } from "../live/stage-gate.js";

async function main(): Promise<void> {
  loadExternalBenchLocalEnv();
  assertNoAutoEscalation();

  const creds = checkCredentialPresence();
  if (
    creds.OPENAI_API_KEY !== "PRESENT" ||
    creds.ANTHROPIC_API_KEY !== "PRESENT" ||
    creds.XAI_API_KEY !== "PRESENT"
  ) {
    console.error(
      JSON.stringify(
        {
          status: "STAGE2_BLOCKED",
          reason: "credentials_missing",
          credentials: {
            OPENAI_API_KEY: creds.OPENAI_API_KEY,
            ANTHROPIC_API_KEY: creds.ANTHROPIC_API_KEY,
            XAI_API_KEY: creds.XAI_API_KEY,
            GOOGLE_API_KEY: creds.GOOGLE_API_KEY,
            googleMustNotBeUsed: true,
          },
          valuesPrinted: false,
          paidCalls: 0,
          stage3Started: false,
        },
        null,
        2,
      ),
    );
    process.exitCode = 2;
    return;
  }

  try {
    const summary = await runStage2Finalists({ argv: process.argv });
    console.log(JSON.stringify(summary, null, 2));
    if (summary.status !== "STAGE2_COMPLETE") {
      process.exitCode = 2;
    }
  } catch (err) {
    const reason =
      err instanceof BudgetLimitError || err instanceof UnknownCompletionError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    const status =
      err instanceof BudgetLimitError
        ? "STAGE2_BUDGET_STOP"
        : err instanceof UnknownCompletionError
          ? "STAGE2_PARTIAL"
          : "STAGE2_BLOCKED";
    console.error(
      JSON.stringify(
        {
          status,
          reason,
          paidCalls: 0,
          stage3Started: false,
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
