/**
 * Freeze stage2-claude-challenger-v1-<sha> against the completed GPT/Grok Stage-2 suite.
 */
import { execSync } from "node:child_process";
import {
  buildStage2ClaudeChallengerRunId,
  freezeStage2ClaudeChallengerManifest,
  SOURCE_STAGE2_FINALISTS_RUN_ID,
  verifySourceStage2Integrity,
} from "../live/stage2-claude-challenger-manifest-builder.js";

function parseArgValue(argv: readonly string[], name: string): string | null {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name) return argv[i + 1] ?? null;
    if (argv[i]?.startsWith(`${name}=`)) return argv[i]!.slice(name.length + 1) || null;
  }
  return null;
}

function main(): void {
  const integrity = verifySourceStage2Integrity();
  if (!integrity.ok) {
    console.error(
      JSON.stringify({
        status: "CLAUDE_STAGE2_INVALID",
        reason: "source_stage2_config_hash_mismatch",
        integrity,
        paidCalls: 0,
      }),
    );
    process.exitCode = 2;
    return;
  }

  const gitSha =
    parseArgValue(process.argv, "--git-sha") ??
    execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  const runId = parseArgValue(process.argv, "--run-id") ?? buildStage2ClaudeChallengerRunId(gitSha);
  const frozen = freezeStage2ClaudeChallengerManifest({
    runId,
    gitSha,
    budgetMaxUsd: 95,
  });
  console.log(
    JSON.stringify(
      {
        status: "FROZEN",
        runId,
        configHash: frozen.configHash,
        gitSha,
        sourceStage2RunId: SOURCE_STAGE2_FINALISTS_RUN_ID,
        prbench: frozen.suite.upstream_ids.prbench_legal_hard.length,
        legalbench: frozen.suite.upstream_ids.legalbench.length,
        rag: frozen.suite.upstream_ids.legalbench_rag.length,
        challengerMode: "claude-only",
        doNotDispatch: ["gpt-6.1-sol", "grok-4.7", "gemini-4-argon"],
        budgetMaxUsd: 95,
        paidCalls: 0,
        valuesPrinted: false,
      },
      null,
      2,
    ),
  );
}

main();
