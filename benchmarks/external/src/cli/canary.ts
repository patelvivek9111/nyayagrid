/**
 * ONE-CALL canary entrypoint.
 * Refuses without two-step paid authorization. This task must not execute paid calls.
 */
import { assertLivePaidExecutionAuthorized } from "../live/authorization.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getRegistryDir } from "../paths.js";
import { checkCredentialPresence, allCredentialsPresent } from "../live/credentials.js";

function main(): void {
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
    assertLivePaidExecutionAuthorized({ argv: process.argv });
  } catch (err) {
    console.error(
      JSON.stringify(
        {
          status: "LIVE_CANARY_BLOCKED",
          reason: err instanceof Error ? err.message : String(err),
          prepared: {
            taskId: plan.task.taskId,
            model: plan.response_model.exactModelId,
            hardCapUsd: plan.cost.hard_cap_usd,
          },
          paidCalls: 0,
        },
        null,
        2,
      ),
    );
    process.exitCode = 2;
    return;
  }

  // Authorization present — still do not auto-run inference in this scaffold without
  // an explicit future executor. Fail closed until live executor is wired.
  console.error(
    JSON.stringify(
      {
        status: "LIVE_CANARY_BLOCKED",
        reason: "live_executor_not_wired_for_paid_inference",
        note: "Preflight prepared canary; paid executor lands in a later authorized task.",
        paidCalls: 0,
      },
      null,
      2,
    ),
  );
  process.exitCode = 2;
}

main();
