import { readFileSync } from "node:fs";
import path from "node:path";
import { computeStage1Plan } from "../cost/plan-stage1.js";
import {
  isLivePaidExecutionAuthorized,
  LIVE_MODEL_BENCHMARK_AUTHORIZATION_REQUIRED,
} from "../live/authorization.js";
import { parseMaxCostUsd } from "../live/budget.js";
import { getRegistryDir } from "../paths.js";

function main(): void {
  const screening = JSON.parse(
    readFileSync(path.join(getRegistryDir(), "screening-suite.json"), "utf8"),
  ) as Record<string, unknown>;

  const models = JSON.parse(readFileSync(path.join(getRegistryDir(), "models.json"), "utf8")) as {
    stage_1_response_models?: string[];
  };

  const stage1 = computeStage1Plan();
  const maxUsd = parseMaxCostUsd(process.argv);

  const payload = {
    status: LIVE_MODEL_BENCHMARK_AUTHORIZATION_REQUIRED,
    defaultLiveCallsAllowed: false,
    paidCallsAuthorizedNow: isLivePaidExecutionAuthorized(),
    authorizationRequired: {
      flag: "--allow-paid-model-calls",
      budget: "--max-cost-usd <positive USD>",
      env: "EXTERNAL_BENCH_ALLOW_PAID_MODEL_CALLS=1 (optional second step; budget always required)",
      twoStep: true,
    },
    maxCostUsdParsed: maxUsd,
    candidateModels: models.stage_1_response_models ?? stage1.models,
    screeningComposition: stage1.callCounts,
    screeningSuiteMeta: {
      selectionMethod: screening.selection_method ?? screening.selectionMethod,
      frozen: screening.frozen ?? false,
      license_filter: screening.license_filter ?? null,
      actual: screening.actual ?? null,
    },
    stage_1_cost_usd: stage1.cost,
    requiredProviderKeys: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "XAI_API_KEY"],
    nyayaBenchRole: "REGRESSION_ONLY",
    message:
      "STOP. Do not perform paid model benchmarking without explicit two-step authorization.",
  };

  console.log(JSON.stringify(payload, null, 2));
  console.log(LIVE_MODEL_BENCHMARK_AUTHORIZATION_REQUIRED);
  if (!isLivePaidExecutionAuthorized()) {
    process.exitCode = 2;
  }
}

main();
