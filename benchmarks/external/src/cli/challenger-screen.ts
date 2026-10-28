/**
 * Claude + Gemini Stage-1-equivalent challenger qualification screen.
 * Does NOT start full Stage-2 or Stage-3. Does NOT modify Stage-2 artifacts.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BudgetLimitError } from "../live/budget.js";
import { probeGeminiModelAccess } from "../live/gemini-access-probe.js";
import { loadExternalBenchLocalEnv } from "../live/load-local-env.js";
import { runStage1Screening, type Stage1ResponseModelId } from "../live/stage1-executor.js";
import { assertNoAutoEscalation } from "../live/stage-gate.js";
import { UnknownCompletionError } from "../live/retry.js";
import { getCacheDir, getRegistryDir } from "../paths.js";
import { loadCurrentPricingTable } from "../cost/estimator.js";
import { worstCaseCostForBudgetGate } from "../live/cost-accounting.js";

function parseArgValue(argv: readonly string[], name: string): string | null {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name) return argv[i + 1] ?? null;
    if (argv[i]?.startsWith(`${name}=`)) return argv[i]!.slice(name.length + 1) || null;
  }
  return null;
}

function estimateChallengerWorstCaseUsd(models: readonly Stage1ResponseModelId[]): {
  claudeUsd: number;
  geminiUsd: number;
  judgesUsd: number;
  totalUsd: number;
} {
  const pricing = loadCurrentPricingTable();
  const prbench = 32;
  const legalbench = 24;
  const tasks = prbench + legalbench;
  // Conservative screening-size prompts; Claude uses 8192 output allowance.
  const estIn = 4000;
  let claudeUsd = 0;
  let geminiUsd = 0;
  if (models.includes("claude-opus-5-5")) {
    claudeUsd =
      tasks *
      worstCaseCostForBudgetGate({
        modelId: "claude-opus-5-5",
        estimatedInputTokens: estIn,
        maxOutputTokens: 8192,
        bucket: "models",
        pricingTable: pricing,
      });
  }
  if (models.includes("gemini-4-argon")) {
    geminiUsd =
      tasks *
      worstCaseCostForBudgetGate({
        modelId: "gemini-4-argon",
        estimatedInputTokens: estIn,
        maxOutputTokens: 4096,
        bucket: "models",
        pricingTable: pricing,
      });
  }
  const judgeCalls = prbench * models.length * 2;
  const judgeEach = worstCaseCostForBudgetGate({
    modelId: "claude-sonnet-5-5",
    estimatedInputTokens: 3000,
    maxOutputTokens: 2048,
    bucket: "judgeModels",
    pricingTable: pricing,
  });
  const judgesUsd = judgeCalls * judgeEach;
  return {
    claudeUsd,
    geminiUsd,
    judgesUsd,
    totalUsd: claudeUsd + geminiUsd + judgesUsd,
  };
}

async function main(): Promise<void> {
  loadExternalBenchLocalEnv();
  assertNoAutoEscalation();

  const argv = process.argv;
  const runId = parseArgValue(argv, "--run-id");
  if (!runId) {
    console.error(
      JSON.stringify({ status: "CHALLENGER_SCREEN_INVALID", reason: "missing --run-id" }),
    );
    process.exitCode = 2;
    return;
  }

  const runDir = path.join(getCacheDir(), "runs", runId);
  const fullConfigPath = path.join(runDir, "full-config.json");
  if (!existsSync(fullConfigPath)) {
    console.error(
      JSON.stringify({
        status: "CHALLENGER_SCREEN_INVALID",
        reason: "missing frozen full-config; run freeze-challenger-screen-manifest first",
        runId,
      }),
    );
    process.exitCode = 2;
    return;
  }

  const fullConfig = JSON.parse(readFileSync(fullConfigPath, "utf8")) as {
    models?: { response?: Stage1ResponseModelId[] };
    completedStage2RunId?: string;
    budget?: { totalMaxUsd?: number };
  };
  if (fullConfig.completedStage2RunId !== "stage2-finalists-v1-044fb482d7bf") {
    console.error(
      JSON.stringify({
        status: "CHALLENGER_SCREEN_INVALID",
        reason: "manifest must pin completed Stage-2 run id for isolation",
      }),
    );
    process.exitCode = 2;
    return;
  }

  let models = (fullConfig.models?.response ?? [
    "claude-opus-5-5",
    "gemini-4-argon",
  ]) as Stage1ResponseModelId[];

  // Gemini access gate (non-generation). Drop Gemini if blocked.
  let geminiProbe: Awaited<ReturnType<typeof probeGeminiModelAccess>> | null = null;
  if (models.includes("gemini-4-argon")) {
    geminiProbe = await probeGeminiModelAccess({
      apiKey: process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY,
    });
    if (geminiProbe.status !== "GEMINI_ACCESS_OK") {
      models = models.filter((m) => m !== "gemini-4-argon");
      console.log(
        JSON.stringify({
          status: "GEMINI_PROVIDER_ACCESS_BLOCKED",
          geminiProbe,
          continuingWith: models,
          paidCalls: 0,
        }),
      );
    }
  }

  if (models.length === 0) {
    console.error(
      JSON.stringify({
        status: "CHALLENGER_SCREEN_PROVIDER_BLOCKED",
        reason: "no available challenger models",
        geminiProbe,
      }),
    );
    process.exitCode = 2;
    return;
  }

  const estimate = estimateChallengerWorstCaseUsd(models);
  const hardCap = fullConfig.budget?.totalMaxUsd ?? 20;
  if (estimate.totalUsd > hardCap + 1e-9) {
    console.error(
      JSON.stringify({
        status: "CHALLENGER_SCREEN_NEEDS_CAP_ADJUSTMENT",
        hardCap,
        estimate,
        paidCalls: 0,
      }),
    );
    process.exitCode = 2;
    return;
  }

  writeFileSync(
    path.join(runDir, "challenger-preflight.json"),
    `${JSON.stringify(
      {
        runId,
        models,
        geminiProbe,
        estimate,
        hardCap,
        claudeMaxTokens: 8192,
        geminiMaxOutputTokens: 4096,
        screeningSuiteHash: JSON.parse(
          readFileSync(path.join(getRegistryDir(), "screening-suite.json"), "utf8"),
        ).suite_id,
        paidCalls: 0,
        at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );

  try {
    const summary = await runStage1Screening({
      argv,
      deps: {
        responseModels: models,
        requireOnlySelectedProviderKeys: true,
        interleaveModelsPerTask: true,
        skipRag: true, // model-independent RAG reused offline / already complete
        claudeMaxTokens: 8192,
        geminiMaxOutputTokens: 4096,
        maxCostUsdCeiling: 20,
      },
    });
    const out = {
      ...summary,
      classification: "CLAUDE_GEMINI_CHALLENGER_QUALIFICATION",
      geminiProbe,
      estimate,
      stage2Started: false,
      stage3Started: false,
      productionRoutingChanged: false,
      courtListener: 0,
      note:
        summary.note ??
        (geminiProbe && geminiProbe.status !== "GEMINI_ACCESS_OK"
          ? "Gemini blocked; Claude-only screen"
          : undefined),
    };
    console.log(JSON.stringify(out, null, 2));
    writeFileSync(
      path.join(runDir, "challenger-summary.json"),
      `${JSON.stringify(out, null, 2)}\n`,
    );
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
        ? "CHALLENGER_SCREEN_BUDGET_STOP"
        : "CHALLENGER_SCREEN_PARTIAL";
    console.error(JSON.stringify({ status, reason, paidCalls: 0, stage2Started: false }, null, 2));
    process.exitCode = 2;
  }
}

main();
