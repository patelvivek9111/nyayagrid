/**
 * Centralized model pricing metadata. Do not hardcode prices in business logic.
 * Unknown prices stay unknown — never invent a number.
 */

import type { EstimatedCost } from "../provider-contract";

export type ModelPrice = {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
};

/** List prices recorded when Router v1 shipped. Not a bill. */
const PRICE_TABLE: Record<string, ModelPrice> = {
  "gpt-4o": { inputPerMillionUsd: 2.5, outputPerMillionUsd: 10 },
  "gpt-4o-mini": { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
  "gpt-4o-mini-2024-07-18": { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
};

export function lookupModelPrice(modelId: string): ModelPrice | null {
  const exact = PRICE_TABLE[modelId];
  if (exact) return exact;
  const stem = modelId.split(":")[1] ?? modelId;
  return PRICE_TABLE[stem] ?? null;
}

export function estimateCostUsd(params: {
  modelId: string;
  inputTokens?: number;
  outputTokens?: number;
}): EstimatedCost {
  const price = lookupModelPrice(params.modelId);
  if (!price) return { known: false };
  const input = params.inputTokens ?? 0;
  const output = params.outputTokens ?? 0;
  const amountUsd =
    (input / 1_000_000) * price.inputPerMillionUsd +
    (output / 1_000_000) * price.outputPerMillionUsd;
  return { known: true, amountUsd };
}

export function sumEstimatedCosts(costs: EstimatedCost[]): EstimatedCost {
  let total = 0;
  for (const cost of costs) {
    if (!cost.known) return { known: false };
    total += cost.amountUsd;
  }
  return { known: true, amountUsd: total };
}
