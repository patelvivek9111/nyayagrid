/**
 * Freeze immutable Stage-2 run manifest AFTER CI green on the certification SHA.
 * Zero paid model calls. Does not execute Stage 2.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getRegistryDir } from "../paths.js";
import { loadExternalBenchLocalEnv } from "../live/load-local-env.js";
import { buildStage2RunId, freezeStage2Manifest } from "../live/stage2-manifest-builder.js";
import type { Stage2SuitePlan } from "../live/stage2-task-planner.js";
import type { Stage2ContextProfile } from "../live/stage2-context-profile.js";

function gitSha(): string {
  return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
}

function parseArg(argv: readonly string[], name: string): string | null {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name) return argv[i + 1] ?? null;
    if (argv[i]?.startsWith(`${name}=`)) return argv[i]!.slice(name.length + 1) || null;
  }
  return null;
}

async function main(): Promise<void> {
  loadExternalBenchLocalEnv();
  const sha = parseArg(process.argv, "--git-sha") ?? gitSha();
  const runId = parseArg(process.argv, "--run-id") ?? buildStage2RunId(sha);

  const suitePath = path.join(getRegistryDir(), "stage2-suite.json");
  const profilePath = path.join(getRegistryDir(), "stage2-context-profile.json");
  const costPath = path.join(getRegistryDir(), "stage2-cost-plan.json");
  if (!existsSync(suitePath) || !existsSync(profilePath) || !existsSync(costPath)) {
    throw new Error(
      "Missing stage2-suite/context/cost registry files; run freeze-stage2-suite first",
    );
  }
  const suite = JSON.parse(readFileSync(suitePath, "utf8")) as Stage2SuitePlan;
  const contextProfile = JSON.parse(readFileSync(profilePath, "utf8")) as Stage2ContextProfile;
  const costPlan = JSON.parse(readFileSync(costPath, "utf8")) as {
    recommendedHardCapUsd: number;
  };

  const frozen = freezeStage2Manifest({
    runId,
    gitSha: sha,
    suite,
    contextProfile,
    budgetMaxUsd: costPlan.recommendedHardCapUsd,
  });

  writeFileSync(
    path.join(getRegistryDir(), "stage2-run-pointer.json"),
    `${JSON.stringify(
      {
        runId,
        gitSha: sha,
        configHash: frozen.configHash,
        recommendedHardCapUsd: costPlan.recommendedHardCapUsd,
        paidCalls: 0,
        authorizedNow: false,
        frozenAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );

  console.log(
    JSON.stringify(
      {
        status: "STAGE2_MANIFEST_FROZEN",
        runId,
        gitSha: sha,
        configHash: frozen.configHash,
        recommendedHardCapUsd: costPlan.recommendedHardCapUsd,
        paidCalls: 0,
        stage2Executed: false,
        stage3Started: false,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
