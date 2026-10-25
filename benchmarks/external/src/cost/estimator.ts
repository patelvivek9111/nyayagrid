import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const PricingEntrySchema = z
  .object({
    inputPer1M: z.number(),
    outputPer1M: z.number(),
    cachedInputPer1M: z.number().optional(),
  })
  .passthrough();

const PricingTableSchema = z.object({
  currency: z.string(),
  models: z.record(PricingEntrySchema),
  judgeModels: z.record(PricingEntrySchema).optional(),
});

export type PricingTable = z.infer<typeof PricingTableSchema>;

export type TokenEstimate = {
  inputTokens: number;
  outputTokens: number;
};

export type CostBreakdown = {
  currency: string;
  responseCost: number;
  judgeCost: number;
  totalCost: number;
  repeatCount: number;
};

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export function loadDefaultPricingTable(): PricingTable {
  const currentPath = path.join(moduleDir, "pricing.current.json");
  const fallbackPath = path.join(moduleDir, "pricing.default.json");
  const raw = readFileSync(existsSync(currentPath) ? currentPath : fallbackPath, "utf8");
  return PricingTableSchema.parse(JSON.parse(raw));
}

export function loadCurrentPricingTable(): PricingTable {
  const currentPath = path.join(moduleDir, "pricing.current.json");
  const raw = readFileSync(currentPath, "utf8");
  return PricingTableSchema.parse(JSON.parse(raw));
}

function costForTokens(tokens: TokenEstimate, pricing: z.infer<typeof PricingEntrySchema>): number {
  return (
    (tokens.inputTokens / 1_000_000) * pricing.inputPer1M +
    (tokens.outputTokens / 1_000_000) * pricing.outputPer1M
  );
}

function resolvePricing(
  table: PricingTable,
  modelId: string,
  bucket: "models" | "judgeModels",
): z.infer<typeof PricingEntrySchema> {
  const map = bucket === "models" ? table.models : (table.judgeModels ?? {});
  const entry = map[modelId];
  if (!entry) {
    throw new Error(`No pricing entry for ${bucket} model: ${modelId}`);
  }
  return entry;
}

export type EstimateRunCostOptions = {
  pricingTable?: PricingTable;
  responseModelId: string;
  responseTokens: TokenEstimate;
  judgeModelId?: string;
  judgeTokens?: TokenEstimate;
  repeatCount?: number;
};

export function estimateRunCost(options: EstimateRunCostOptions): CostBreakdown {
  const table = options.pricingTable ?? loadDefaultPricingTable();
  const repeatCount = Math.max(1, options.repeatCount ?? 1);

  const responsePricing = resolvePricing(table, options.responseModelId, "models");
  const perRunResponse = costForTokens(options.responseTokens, responsePricing);

  let perRunJudge = 0;
  if (options.judgeModelId && options.judgeTokens) {
    const judgePricing = resolvePricing(table, options.judgeModelId, "judgeModels");
    perRunJudge = costForTokens(options.judgeTokens, judgePricing);
  }

  const responseCost = perRunResponse * repeatCount;
  const judgeCost = perRunJudge * repeatCount;

  return {
    currency: table.currency,
    responseCost,
    judgeCost,
    totalCost: responseCost + judgeCost,
    repeatCount,
  };
}
