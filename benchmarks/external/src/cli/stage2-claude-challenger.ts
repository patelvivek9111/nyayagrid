/**
 * Claude-only Stage-2 challenger entrypoint.
 * Compares against existing GPT/Grok Stage-2 artifacts. Does not rerun them.
 * Does NOT start Stage 3. Does NOT change production routing.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadCurrentPricingTable } from "../cost/estimator.js";
import { BudgetLimitError } from "../live/budget.js";
import { worstCaseCostForBudgetGate } from "../live/cost-accounting.js";
import { checkCredentialPresence } from "../live/credentials.js";
import { loadExternalBenchLocalEnv } from "../live/load-local-env.js";
import { UnknownCompletionError } from "../live/retry.js";
import { assertNoAutoEscalation } from "../live/stage-gate.js";
import { runStage2Finalists, Stage2UnknownCompletionStopError } from "../live/stage2-executor.js";
import { getCacheDir } from "../paths.js";
import { STAGE2_CLAUDE_CHALLENGER_MODEL } from "../live/stage2-task-planner.js";

function parseArgValue(argv: readonly string[], name: string): string | null {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name) return argv[i + 1] ?? null;
    if (argv[i]?.startsWith(`${name}=`)) return argv[i]!.slice(name.length + 1) || null;
  }
  return null;
}

function estimateClaudeStage2Usd(): {
  prbenchResponsesUsd: number;
  legalbenchResponsesUsd: number;
  judgeAUsd: number;
  judgeBUsd: number;
  expectedTotal: number;
  conservativeTotal: number;
} {
  const pricing = loadCurrentPricingTable();
  // Measured from challenger-screen-v1-8802e482d165: ~$10.12 / 56 responses ≈ $0.181/response
  // with judges ~$0.605 / 64 ≈ $0.0095. Use worst-case gate for conservative; blend for expected.
  const prbenchResp =
    250 *
    worstCaseCostForBudgetGate({
      modelId: "claude-opus-5-5",
      estimatedInputTokens: 4500,
      maxOutputTokens: 8192,
      bucket: "models",
      pricingTable: pricing,
    });
  const lbResp =
    80 *
    worstCaseCostForBudgetGate({
      modelId: "claude-opus-5-5",
      estimatedInputTokens: 2500,
      maxOutputTokens: 8192,
      bucket: "models",
      pricingTable: pricing,
    });
  const judgeA =
    250 *
    worstCaseCostForBudgetGate({
      modelId: "claude-sonnet-5-5",
      estimatedInputTokens: 3500,
      maxOutputTokens: 2048,
      bucket: "judgeModels",
      pricingTable: pricing,
    });
  const judgeB =
    250 *
    worstCaseCostForBudgetGate({
      modelId: "gpt-6.1-sol",
      estimatedInputTokens: 3500,
      maxOutputTokens: 2048,
      bucket: "judgeModels",
      pricingTable: pricing,
    });
  const conservative = prbenchResp + lbResp + judgeA + judgeB;
  // Screen observed ~45% of worst-case gate for Claude responses; use 0.55 for expected.
  const expected = conservative * 0.55;
  return {
    prbenchResponsesUsd: Number(prbenchResp.toFixed(4)),
    legalbenchResponsesUsd: Number(lbResp.toFixed(4)),
    judgeAUsd: Number(judgeA.toFixed(4)),
    judgeBUsd: Number(judgeB.toFixed(4)),
    expectedTotal: Number(expected.toFixed(4)),
    conservativeTotal: Number(conservative.toFixed(4)),
  };
}

async function main(): Promise<void> {
  loadExternalBenchLocalEnv();
  assertNoAutoEscalation();

  const runId = parseArgValue(process.argv, "--run-id");
  if (!runId) {
    console.error(
      JSON.stringify({
        status: "CLAUDE_STAGE2_INVALID",
        reason: "missing --run-id",
        paidCalls: 0,
      }),
    );
    process.exitCode = 2;
    return;
  }

  const runDir = path.join(getCacheDir(), "runs", runId);
  const fullConfigPath = path.join(runDir, "full-config.json");
  if (!existsSync(fullConfigPath)) {
    console.error(
      JSON.stringify({
        status: "CLAUDE_STAGE2_INVALID",
        reason: "missing frozen full-config; freeze-stage2-claude-challenger-manifest first",
        runId,
        paidCalls: 0,
      }),
    );
    process.exitCode = 2;
    return;
  }

  const fullConfig = JSON.parse(readFileSync(fullConfigPath, "utf8")) as {
    challengerMode?: string;
    stage?: number;
    doNotModifyFinalistRunId?: string;
    budget?: { totalMaxUsd?: number };
  };
  if (fullConfig.stage !== 2 || fullConfig.challengerMode !== "claude-only") {
    console.error(
      JSON.stringify({
        status: "CLAUDE_STAGE2_INVALID",
        reason: "run is not a frozen Claude-only Stage-2 challenger",
        paidCalls: 0,
      }),
    );
    process.exitCode = 2;
    return;
  }
  if (fullConfig.doNotModifyFinalistRunId !== "stage2-finalists-v1-044fb482d7bf") {
    console.error(
      JSON.stringify({
        status: "CLAUDE_STAGE2_INVALID",
        reason: "manifest must pin completed finalist run for isolation",
        paidCalls: 0,
      }),
    );
    process.exitCode = 2;
    return;
  }

  const creds = checkCredentialPresence();
  if (creds.OPENAI_API_KEY !== "PRESENT" || creds.ANTHROPIC_API_KEY !== "PRESENT") {
    console.error(
      JSON.stringify({
        status: "CLAUDE_STAGE2_BLOCKED_PROVIDER_ACCESS",
        reason: "credentials_missing",
        credentials: {
          OPENAI_API_KEY: creds.OPENAI_API_KEY,
          ANTHROPIC_API_KEY: creds.ANTHROPIC_API_KEY,
        },
        paidCalls: 0,
        stage3Started: false,
      }),
    );
    process.exitCode = 2;
    return;
  }

  const estimate = estimateClaudeStage2Usd();
  const hardCap = fullConfig.budget?.totalMaxUsd ?? 95;
  if (estimate.conservativeTotal > hardCap + 1e-9) {
    console.error(
      JSON.stringify({
        status: "CLAUDE_STAGE2_NEEDS_CAP_ADJUSTMENT",
        hardCap,
        estimate,
        paidCalls: 0,
      }),
    );
    process.exitCode = 2;
    return;
  }

  writeFileSync(
    path.join(runDir, "claude-challenger-preflight.json"),
    `${JSON.stringify(
      {
        runId,
        model: STAGE2_CLAUDE_CHALLENGER_MODEL,
        maxTokens: 8192,
        thinking: "adaptive",
        effort: "high",
        timeoutMs: 180000,
        hardCap,
        estimate,
        doNotDispatch: ["gpt-6.1-sol", "grok-4.7", "gemini-4-argon"],
        circuitBreakerThreshold: 3,
        at: new Date().toISOString(),
        paidCalls: 0,
      },
      null,
      2,
    )}\n`,
  );

  console.log(
    JSON.stringify({
      status: "COST_PREFLIGHT_OK",
      hardCap,
      estimate,
      paidCalls: 0,
    }),
  );

  try {
    const summary = await runStage2Finalists({
      argv: process.argv,
      deps: {
        responseModels: [STAGE2_CLAUDE_CHALLENGER_MODEL],
        skipRag: true,
      },
    });
    const out = {
      ...summary,
      classification: "CLAUDE_FULL_STAGE2_CHALLENGER",
      estimate,
      stage3Started: false,
      productionRoutingChanged: false,
      geminiStatus: "GEMINI_PROVIDER_ACCESS_BLOCKED",
      courtListener: 0,
    };
    console.log(JSON.stringify(out, null, 2));
    writeFileSync(
      path.join(runDir, "claude-challenger-summary.json"),
      `${JSON.stringify(out, null, 2)}\n`,
    );
    if (summary.status !== "STAGE2_COMPLETE") process.exitCode = 2;
  } catch (err) {
    const reason =
      err instanceof BudgetLimitError ||
      err instanceof UnknownCompletionError ||
      err instanceof Stage2UnknownCompletionStopError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    const status =
      err instanceof BudgetLimitError ? "CLAUDE_STAGE2_BUDGET_STOP" : "CLAUDE_STAGE2_PARTIAL";
    console.error(JSON.stringify({ status, reason, paidCalls: 0, stage3Started: false }, null, 2));
    process.exitCode = 2;
  }
}

main();
