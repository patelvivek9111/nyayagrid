import { loadCurrentPricingTable, type PricingTable } from "../cost/estimator.js";

export function calculateActualCostUsd(input: {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
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
  return (
    (input.inputTokens / 1_000_000) * entry.inputPer1M +
    (input.outputTokens / 1_000_000) * entry.outputPer1M
  );
}

export function worstCaseCostForBudgetGate(input: {
  modelId: string;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  bucket?: "models" | "judgeModels";
  pricingTable?: PricingTable;
}): number {
  return calculateActualCostUsd({
    modelId: input.modelId,
    inputTokens: input.estimatedInputTokens,
    outputTokens: input.maxOutputTokens,
    bucket: input.bucket,
    pricingTable: input.pricingTable,
  });
}
