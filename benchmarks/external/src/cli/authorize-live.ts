import { readFileSync } from "node:fs";
import path from "node:path";
import { estimateRunCost } from "../cost/estimator.js";
import { isPaidCallsAuthorized } from "../guards/paid-call-guard.js";
import { SCREENING_TARGETS } from "../selectors/screening.js";
import { getRegistryDir } from "../paths.js";

const CANDIDATE_MODELS = [
  { provider: "openai", exactModelId: "TO_BE_PINNED" },
  { provider: "anthropic", exactModelId: "TO_BE_PINNED" },
  { provider: "google", exactModelId: "TO_BE_PINNED" },
  { provider: "xai", exactModelId: "TO_BE_PINNED" },
] as const;

function main(): void {
  const screening = JSON.parse(
    readFileSync(path.join(getRegistryDir(), "screening-suite.json"), "utf8"),
  ) as Record<string, unknown>;

  const taskCount =
    SCREENING_TARGETS.prbenchHard + SCREENING_TARGETS.legalbench + SCREENING_TARGETS.legalbenchRag;

  const perModelEstimate = estimateRunCost({
    responseModelId: "placeholder-response",
    responseTokens: {
      inputTokens: taskCount * 4000,
      outputTokens: taskCount * 800,
    },
    judgeModelId: "placeholder-judge",
    judgeTokens: {
      inputTokens: taskCount * 5000,
      outputTokens: taskCount * 400,
    },
    repeatCount: 1,
  });

  const payload = {
    status: "LIVE_MODEL_BENCHMARK_AUTHORIZATION_REQUIRED",
    defaultLiveCallsAllowed: false,
    paidCallsAuthorizedNow: isPaidCallsAuthorized(),
    authorizationRequired: {
      flag: "--allow-paid-model-calls",
      env: "EXTERNAL_BENCH_ALLOW_PAID_MODEL_CALLS=1",
    },
    candidateModels: CANDIDATE_MODELS,
    screeningTaskCount: taskCount,
    screeningComposition: {
      prbenchLegalHard: SCREENING_TARGETS.prbenchHard,
      legalbench: SCREENING_TARGETS.legalbench,
      legalbenchRag: SCREENING_TARGETS.legalbenchRag,
    },
    screeningSuiteMeta: {
      selectionMethod: screening.selection_method ?? screening.selectionMethod,
      frozen: screening.frozen ?? false,
    },
    estimatedCalls: taskCount * CANDIDATE_MODELS.length,
    estimatedTokens: {
      inputPerModel: taskCount * 4000,
      outputPerModel: taskCount * 800,
      judgeInputPerModel: taskCount * 5000,
      judgeOutputPerModel: taskCount * 400,
    },
    estimatedSpendPerModelUsd: {
      responseModel: perModelEstimate.responseCost,
      judgeModel: perModelEstimate.judgeCost,
      total: perModelEstimate.totalCost,
      currency: perModelEstimate.currency,
      note: "Uses pricing.default.json placeholders; update before live runs.",
    },
    estimatedSpendAllCandidatesUsd: perModelEstimate.totalCost * CANDIDATE_MODELS.length,
    requiredProviderKeys: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "XAI_API_KEY"],
    nyayaBenchRole: "REGRESSION_ONLY",
    message: "STOP. Do not perform paid model benchmarking without explicit authorization.",
  };

  console.log(JSON.stringify(payload, null, 2));
  console.log("LIVE_MODEL_BENCHMARK_AUTHORIZATION_REQUIRED");
  if (!isPaidCallsAuthorized()) {
    process.exitCode = 2;
  }
}

main();
