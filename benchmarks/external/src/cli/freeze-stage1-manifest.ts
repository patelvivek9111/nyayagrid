import { execSync } from "node:child_process";
import { buildStage1RunId, freezeStage1Manifest } from "../live/stage1-manifest-builder.js";

function gitSha(): string {
  try {
    return execSync(
      "git -c safe.directory=c:/Users/patel/Documents/nyayagrid-integration rev-parse HEAD",
      { encoding: "utf8" },
    ).trim();
  } catch {
    return "UNKNOWN_SHA";
  }
}

function main(): void {
  const sha = gitSha();
  const runId = buildStage1RunId(sha);
  try {
    const { manifest, configHash, config } = freezeStage1Manifest({
      runId,
      gitSha: sha,
      budgetMaxUsd: 25,
    });
    console.log(
      JSON.stringify(
        {
          status: "STAGE1_MANIFEST_FROZEN",
          runId,
          configHash,
          gitSha: sha,
          budgetMaxUsd: manifest.budgetMaxUsd,
          immutable: manifest.immutable,
          credentialsPresence: (config as { credentialsPresence?: unknown }).credentialsPresence,
          modelAccess: (config as { modelAccess?: unknown }).modelAccess,
          paidCalls: 0,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/already frozen/.test(message)) {
      console.log(
        JSON.stringify(
          {
            status: "STAGE1_MANIFEST_ALREADY_FROZEN",
            runId,
            message,
            paidCalls: 0,
          },
          null,
          2,
        ),
      );
      return;
    }
    throw err;
  }
}

main();
