import { loadCurrentPricingTable, type PricingTable } from "../cost/estimator.js";
import { xaiPricingTierForPromptTokens } from "../providers/request-builders.js";

/**
 * How provider-reported thinking/reasoning tokens relate to billed output.
 *
 * - included_in_output: thinking is already inside outputTokens (Anthropic).
 * - additive_output: thinking is separate and bills at output rates (Gemini).
 * - ignore: thinkingTokens are informational or unused for this model.
 */
export type ThinkingBillingSemantics = "included_in_output" | "additive_output" | "ignore";

export function thinkingBillingSemanticsForModel(modelId: string): ThinkingBillingSemantics {
  if (modelId.startsWith("claude-")) {
    // Anthropic: usage.output_tokens is the inclusive billed total;
    // output_tokens_details.thinking_tokens is a read-only subset.
    return "included_in_output";
  }
  if (modelId.startsWith("gemini-")) {
    // Gemini adapters expose thoughts/thinking separately from candidate output.
    return "additive_output";
  }
  // OpenAI / xAI adapters do not currently bill via thinkingTokens.
  return "ignore";
}

export function billedOutputTokensForCost(input: {
  modelId: string;
  outputTokens: number;
  thinkingTokens?: number;
}): number {
  const thinking = Math.max(0, Number(input.thinkingTokens ?? 0) || 0);
  const semantics = thinkingBillingSemanticsForModel(input.modelId);
  if (semantics === "additive_output") {
    return input.outputTokens + thinking;
  }
  // included_in_output | ignore
  return input.outputTokens;
}

export function calculateActualCostUsd(input: {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens?: number;
  cachedInputTokens?: number;
  bucket?: "models" | "judgeModels";
  pricingTable?: PricingTable;
}): number {
  const table = input.pricingTable ?? loadCurrentPricingTable();
  const bucket = input.bucket ?? "models";
  const map = bucket === "models" ? table.models : (table.judgeModels ?? table.models);
  const entry = map[input.modelId] ?? table.models[input.modelId];
  if (!entry) {
    throw new Error(`No pricing for model ${input.modelId}`);
  }

  const billedOutput = billedOutputTokensForCost({
    modelId: input.modelId,
    outputTokens: input.outputTokens,
    thinkingTokens: input.thinkingTokens,
  });

  if (input.modelId === "grok-4.7") {
    const tier = xaiPricingTierForPromptTokens(input.inputTokens);
    const cached = Math.min(
      Math.max(0, Number(input.cachedInputTokens ?? 0) || 0),
      input.inputTokens,
    );
    const uncached = Math.max(0, input.inputTokens - cached);
    // Cached input billed at 10% of short-tier input when cached tokens present; else full tier.
    const cachedRate = tier.inputPer1M * 0.1;
    return (
      (uncached / 1_000_000) * tier.inputPer1M +
      (cached / 1_000_000) * cachedRate +
      (billedOutput / 1_000_000) * tier.outputPer1M
    );
  }

  const cached = Math.min(
    Math.max(0, Number(input.cachedInputTokens ?? 0) || 0),
    input.inputTokens,
  );
  const uncached = Math.max(0, input.inputTokens - cached);
  const cachedRate =
    "cachedInputPer1M" in entry &&
    typeof (entry as { cachedInputPer1M?: number }).cachedInputPer1M === "number"
      ? (entry as { cachedInputPer1M: number }).cachedInputPer1M
      : entry.inputPer1M;

  return (
    (uncached / 1_000_000) * entry.inputPer1M +
    (cached / 1_000_000) * cachedRate +
    (billedOutput / 1_000_000) * entry.outputPer1M
  );
}

/**
 * Recompute spend from persisted token fields using current pricing semantics.
 * Does not mutate artifacts; used on resume cache-hits so inflated historical
 * costEstimateUsd (e.g. Anthropic thinking double-count) does not poison budget.
 */
export function costUsdFromPersistedUsage(input: {
  modelId: string;
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  cachedInputTokens?: number;
  fallbackCostUsd?: number;
  bucket?: "models" | "judgeModels";
  pricingTable?: PricingTable;
}): number {
  const inputTokens = Math.max(0, Number(input.inputTokens ?? 0) || 0);
  const outputTokens = Math.max(0, Number(input.outputTokens ?? 0) || 0);
  if (inputTokens > 0 || outputTokens > 0) {
    return calculateActualCostUsd({
      modelId: input.modelId,
      inputTokens,
      outputTokens,
      thinkingTokens: input.thinkingTokens,
      cachedInputTokens: input.cachedInputTokens,
      bucket: input.bucket,
      pricingTable: input.pricingTable,
    });
  }
  return Math.max(0, Number(input.fallbackCostUsd ?? 0) || 0);
}

export function worstCaseCostForBudgetGate(input: {
  modelId: string;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  bucket?: "models" | "judgeModels";
  pricingTable?: PricingTable;
}): number {
  // Worst-case: no cache discount; for grok use long-context tier if estimate crosses threshold.
  if (input.modelId === "grok-4.7") {
    const tier = xaiPricingTierForPromptTokens(input.estimatedInputTokens);
    return (
      (input.estimatedInputTokens / 1_000_000) * tier.inputPer1M +
      (input.maxOutputTokens / 1_000_000) * tier.outputPer1M
    );
  }
  return calculateActualCostUsd({
    modelId: input.modelId,
    inputTokens: input.estimatedInputTokens,
    outputTokens: input.maxOutputTokens,
    bucket: input.bucket,
    pricingTable: input.pricingTable,
  });
}
