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
  legalbenchExamples: number;
  legalciteExamples: number;
  estimatedProviderRequests: number;
  maxProviderRequests: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedSpendUsd: number;
  conservativeUpperBoundUsd: number;
  recommendedHardCapUsd: number;
  hardCapUsd: number;
  preferredSpendUsd: number;
  withinHardCap: boolean;
  modes: string[];
  routing: Record<string, string>;
  notes: string[];
  gpt61SolLiveVerified: false;
};

export type CostPlanInput = {
  legalbenchExamples?: number;
  legalciteExamples?: number;
  /** Exclude RESEARCH_ONLY datasets from the plan (default true for commercial validation). */
  commercialOnly?: boolean;
  hardCapUsd?: number;
  preferredSpendUsd?: number;
  maxProviderRequests?: number;
  /** Extra headroom multiplier for retries/fallbacks (default 1.25). */
  contingencyMultiplier?: number;
};

export function planProsecutionExternalLiveCost(
  input: CostPlanInput = {},
): ProsecutionExternalLiveCostPlan {
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

  const commercialOnly = input.commercialOnly ?? true;
  const legalbenchExamples = input.legalbenchExamples ?? SAMPLE_TARGETS.legalbench;
  const legalciteExamples = input.legalciteExamples ?? SAMPLE_TARGETS.legalcitebench;
  const plannedExamples = commercialOnly
    ? legalbenchExamples + legalciteExamples
    : legalbenchExamples +
      legalciteExamples +
      SAMPLE_TARGETS.casefacts +
      SAMPLE_TARGETS.legalRagBench;

  const hardCapUsd = input.hardCapUsd ?? 25;
  const preferredSpendUsd = input.preferredSpendUsd ?? 20;
  const maxProviderRequests = input.maxProviderRequests ?? 220;
  const contingencyMultiplier = input.contingencyMultiplier ?? 1.25;

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
    // Fallback linear scale from registry 300-example estimate.
    const per =
      meta.future_live_plan.estimated_spend_usd /
      Math.max(1, meta.future_live_plan.planned_examples);
    claudeTotal = per * highCount;
    gptTotal = per * routineCount * 0.35;
  }

  const estimatedSpendUsd = Number((claudeTotal + gptTotal).toFixed(2));
  const conservativeUpperBoundUsd = Number((estimatedSpendUsd * contingencyMultiplier).toFixed(2));
  const estimatedProviderRequests = Math.min(
    maxProviderRequests,
    Math.ceil(plannedExamples * contingencyMultiplier),
  );

  return {
    suiteId: SUITE_ID,
    suiteVersion: SUITE_VERSION,
    paidExecutionAuthorized: false,
    plannedExamples,
    legalbenchExamples,
    legalciteExamples,
    estimatedProviderRequests,
    maxProviderRequests,
    estimatedInputTokens: highCount * 2500 + routineCount * 1200,
    estimatedOutputTokens: highCount * 900 + routineCount * 400,
    estimatedSpendUsd,
    conservativeUpperBoundUsd,
    recommendedHardCapUsd: hardCapUsd,
    hardCapUsd,
    preferredSpendUsd,
    withinHardCap: conservativeUpperBoundUsd <= hardCapUsd,
    modes: ["NYAYA_PIPELINE"],
    routing: meta.future_live_plan.routing,
    notes: [
      ...meta.future_live_plan.notes,
      "This plan is estimation-only. Do not execute without explicit paid authorization.",
      commercialOnly
        ? `Commercial-only sample: LB=${legalbenchExamples}, Cite=${legalciteExamples} (CaseFacts/LegalRAG RESEARCH_ONLY excluded).`
        : `Includes RESEARCH_ONLY diagnostic slices; do not merge into production acceptance.`,
      `Hard cap $${hardCapUsd}; preferred ≤$${preferredSpendUsd}; max requests ${maxProviderRequests}.`,
      `Contingency multiplier ${contingencyMultiplier} applied to upper-bound spend.`,
    ],
    gpt61SolLiveVerified: false,
  };
}
