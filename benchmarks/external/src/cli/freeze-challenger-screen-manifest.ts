/**
 * Freeze challenger-screen-v1-<sha> manifest (Claude + optional Gemini).
 * Zero paid calls.
 */
import { execSync } from "node:child_process";
import {
  buildChallengerScreenRunId,
  freezeChallengerScreenManifest,
} from "../live/challenger-screen-manifest-builder.js";
import { loadExternalBenchLocalEnv } from "../live/load-local-env.js";
import { probeGeminiModelAccess } from "../live/gemini-access-probe.js";

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

function parseFlag(argv: readonly string[], name: string): boolean {
  return argv.includes(name);
}

async function main(): Promise<void> {
  loadExternalBenchLocalEnv();
  const sha = gitSha();
  const runId = buildChallengerScreenRunId(sha);
  const claudeOnly = parseFlag(process.argv, "--claude-only");
  const geminiOnly = parseFlag(process.argv, "--gemini-only");
  if (claudeOnly && geminiOnly) {
    console.error(
      JSON.stringify({
        status: "CHALLENGER_SCREEN_INVALID",
        reason: "mutually exclusive --claude-only and --gemini-only",
      }),
    );
    process.exitCode = 2;
    return;
  }

  let includeGemini = !claudeOnly;
  let geminiProbe: Awaited<ReturnType<typeof probeGeminiModelAccess>> | null = null;
  // Models.list is unreliable for AI Studio AQ.* keys (401) even when Interactions
  // generation works. Gemini-only freezes keep Gemini regardless of list probe.
  if (includeGemini || geminiOnly) {
    geminiProbe = await probeGeminiModelAccess({
      apiKey: process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY,
    });
    if (!geminiOnly && geminiProbe.status !== "GEMINI_ACCESS_OK") {
      includeGemini = false;
    }
  }

  const budgetMaxUsd = geminiOnly ? Number(process.env.CHALLENGER_SCREEN_BUDGET_USD ?? 15) : 20;

  try {
    const { manifest, configHash, config } = freezeChallengerScreenManifest({
      runId,
      gitSha: sha,
      budgetMaxUsd,
      includeGemini: geminiOnly ? true : includeGemini,
      geminiOnly,
    });
    console.log(
      JSON.stringify(
        {
          status: "CHALLENGER_SCREEN_MANIFEST_FROZEN",
          runId,
          configHash,
          gitSha: sha,
          budgetMaxUsd: manifest.budgetMaxUsd,
          models: (config as { models?: unknown }).models,
          includeGemini: geminiOnly ? true : includeGemini,
          geminiOnly,
          geminiProbe,
          paidCalls: 0,
          valuesPrinted: false,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/already frozen/.test(message)) {
      console.log(
        JSON.stringify({
          status: "CHALLENGER_SCREEN_MANIFEST_ALREADY_FROZEN",
          runId,
          message,
          paidCalls: 0,
        }),
      );
      return;
    }
    throw err;
  }
}

main();
