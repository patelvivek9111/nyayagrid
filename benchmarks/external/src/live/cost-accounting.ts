import { loadCurrentPricingTable, type PricingTable } from "../cost/estimator.js";
import { xaiPricingTierForPromptTokens } from "../providers/request-builders.js";

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

  // Gemini: thinking tokens bill as output when exposed separately and not already in output.
  const thinking = Math.max(0, Number(input.thinkingTokens ?? 0) || 0);
  const billedOutput = input.outputTokens + thinking;

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
