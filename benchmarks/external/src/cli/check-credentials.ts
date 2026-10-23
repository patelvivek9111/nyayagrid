/**
 * Presence-only credential check after loading repo-root .env.local.
 * Never prints secret values. Never makes provider calls.
 */
import { checkCredentialPresence, allCredentialsPresent } from "../live/credentials.js";
import { loadExternalBenchLocalEnv } from "../live/load-local-env.js";

function main(): void {
  loadExternalBenchLocalEnv();
  const credentials = checkCredentialPresence();
  console.log(
    JSON.stringify(
      {
        status: allCredentialsPresent(credentials)
          ? "CREDENTIALS_PRESENT"
          : "CREDENTIALS_INCOMPLETE",
        credentials,
        valuesPrinted: false,
        paidCalls: 0,
      },
      null,
      2,
    ),
  );
  if (!allCredentialsPresent(credentials)) process.exitCode = 2;
}

main();
