import { readFileSync } from "node:fs";
import path from "node:path";
import { getRegistryDir } from "../paths.js";
import { loadDefaultPricingTable, estimateRunCost } from "../cost/estimator.js";
import { SAMPLE_TARGETS, SUITE_ID, SUITE_VERSION } from "./constants.js";

export type ProsecutionExternalLiveCostPlan = {
  suiteId: typeof SUITE_ID;
  suiteVersion: typeof SUITE_VERSION;
  paidExecutionAuthorized: false;
  plannedExamples: number;
  estimatedProviderRequests: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedSpendUsd: number;
  recommendedHardCapUsd: number;
  modes: string[];
  routing: Record<string, string>;
  notes: string[];
  gpt61SolLiveVerified: false;
};

export function planProsecutionExternalLiveCost(): ProsecutionExternalLiveCostPlan {
  const meta = JSON.parse(
    readFileSync(path.join(getRegistryDir(), "prosecution-external-suite.json"), "utf8"),
  ) as {
    future_live_plan: {
      planned_examples: number;
      estimated_provider_requests: number;
      estimated_input_tokens: number;
      estimated_output_tokens: number;
      estimated_spend_usd: number;
      recommended_hard_cap_usd: number;
      notes: string[];
      mode: string;
      routing: Record<string, string>;
    };
  };

  const plannedExamples =
    SAMPLE_TARGETS.legalbench +
    SAMPLE_TARGETS.legalcitebench +
    SAMPLE_TARGETS.casefacts +
    SAMPLE_TARGETS.legalRagBench;

  const pricing = loadDefaultPricingTable();
  const highStakesShare = 0.7;
  const highCount = Math.round(plannedExamples * highStakesShare);
  const routineCount = plannedExamples - highCount;

  let claudeTotal = 0;
  let gptTotal = 0;
  try {
    const claudeModel =
      Object.keys(pricing.models).find((k) => /claude-opus/i.test(k)) ??
      Object.keys(pricing.models).find((k) => /claude/i.test(k));
    const gptModel =
      Object.keys(pricing.models).find((k) => /gpt-4o-mini/i.test(k)) ??
      Object.keys(pricing.models).find((k) => /gpt/i.test(k));
    if (claudeModel) {
      const one = estimateRunCost({
        pricingTable: pricing,
        responseModelId: claudeModel,
        responseTokens: { inputTokens: 2500, outputTokens: 900 },
        repeatCount: highCount,
      });
      claudeTotal = one.totalCost;
    }
    if (gptModel) {
      const one = estimateRunCost({
        pricingTable: pricing,
        responseModelId: gptModel,
        responseTokens: { inputTokens: 1200, outputTokens: 400 },
        repeatCount: routineCount,
      });
      gptTotal = one.totalCost;
    }
  } catch {
    claudeTotal = meta.future_live_plan.estimated_spend_usd * 0.85;
    gptTotal = meta.future_live_plan.estimated_spend_usd * 0.15;
  }

  const estimatedSpendUsd = Number(
    Math.max(claudeTotal + gptTotal, meta.future_live_plan.estimated_spend_usd).toFixed(2),
  );

  return {
    suiteId: SUITE_ID,
    suiteVersion: SUITE_VERSION,
    paidExecutionAuthorized: false,
    plannedExamples,
    estimatedProviderRequests: plannedExamples,
    estimatedInputTokens: highCount * 2500 + routineCount * 1200,
    estimatedOutputTokens: highCount * 900 + routineCount * 400,
    estimatedSpendUsd,
    recommendedHardCapUsd: meta.future_live_plan.recommended_hard_cap_usd,
    modes: ["NYAYA_PIPELINE"],
    routing: meta.future_live_plan.routing,
    notes: [
      ...meta.future_live_plan.notes,
      "This plan is estimation-only. Do not execute without explicit paid authorization.",
      `Fixture-derived sample targets: LB=${SAMPLE_TARGETS.legalbench}, Cite=${SAMPLE_TARGETS.legalcitebench}, CaseFacts=${SAMPLE_TARGETS.casefacts}, LegalRAG=${SAMPLE_TARGETS.legalRagBench}.`,
    ],
    gpt61SolLiveVerified: false,
  };
}
