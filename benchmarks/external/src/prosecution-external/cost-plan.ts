import { readFileSync } from "node:fs";
import path from "node:path";
import { getRegistryDir } from "../paths.js";
import { loadCurrentPricingTable, estimateRunCost } from "../cost/estimator.js";
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
  /** Point estimate from current provider pricing + conservative tokens. */
  estimatedSpendUsd: number;
  /** Evidence-backed ceiling used for authorization gates. */
  conservativeUpperBoundUsd: number;
  /** Registry-linear scale of the historical 300-example / $28.50 plan. */
  registryLinearUsd: number;
  /** Why harness vs linear differed. */
  estimateReconciliation: {
    harnessPointUsd: number;
    registryLinearUsd: number;
    chosenConservativeUsd: number;
    reasons: string[];
  };
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
  /** High-stakes share of examples (default 0.7). */
  highStakesShare?: number;
  /** Assumed fallback fraction of high-stakes primary failures (default 0.1). */
  fallbackFraction?: number;
};

/**
 * Reconcile cost estimates for the commercial prosecution external sample.
 *
 * Prior discrepancy (~$2.89 harness vs ~$11.10 linear) came from:
 * 1) Harness used moderate tokens (2.5k/0.9k high-stakes; 1.2k/0.4k routine) at pricing.current.json.
 * 2) Linear scaled the frozen registry 300-example / $28.50 plan ($0.095/example) without
 *    re-pricing against current model rates or the commercial-only 117-example mix.
 *
 * Conservative upper bound = max(point×contingency+fallbackReserve, registryLinear)
 * still must stay ≤ hard cap before paid authorization.
 */
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
  const highStakesShare = input.highStakesShare ?? 0.7;
  const fallbackFraction = input.fallbackFraction ?? 0.1;

  const pricing = loadCurrentPricingTable();
  const highCount = Math.round(plannedExamples * highStakesShare);
  const routineCount = plannedExamples - highCount;
  const fallbackCount = Math.ceil(highCount * fallbackFraction);

  // Conservative token profile (larger than the prior optimistic harness profile).
  const highIn = 3500;
  const highOut = 1100;
  const routineIn = 2000;
  const routineOut = 600;
  const fallbackIn = 2500;
  const fallbackOut = 800;

  const claude = estimateRunCost({
    pricingTable: pricing,
    responseModelId: "claude-opus-5-5",
    responseTokens: { inputTokens: highIn, outputTokens: highOut },
    repeatCount: highCount,
  });
  const gpt = estimateRunCost({
    pricingTable: pricing,
    responseModelId: "gpt-6.1-sol",
    responseTokens: { inputTokens: routineIn, outputTokens: routineOut },
    repeatCount: Math.max(0, routineCount),
  });
  const grokReserve = estimateRunCost({
    pricingTable: pricing,
    responseModelId: "grok-4.7",
    responseTokens: { inputTokens: fallbackIn, outputTokens: fallbackOut },
    repeatCount: fallbackCount,
  });

  const harnessPointUsd = Number(
    (claude.totalCost + gpt.totalCost + grokReserve.totalCost).toFixed(4),
  );
  const registryPerExample =
    meta.future_live_plan.estimated_spend_usd / Math.max(1, meta.future_live_plan.planned_examples);
  const registryLinearUsd = Number((registryPerExample * plannedExamples).toFixed(4));
  const harnessWithContingency = Number((harnessPointUsd * contingencyMultiplier).toFixed(4));
  const conservativeUpperBoundUsd = Number(
    Math.max(harnessWithContingency, registryLinearUsd).toFixed(2),
  );
  const estimatedSpendUsd = Number(harnessPointUsd.toFixed(2));

  const estimatedProviderRequests = Math.min(
    maxProviderRequests,
    Math.ceil((plannedExamples + fallbackCount) * contingencyMultiplier),
  );

  const estimatedInputTokens =
    highCount * highIn + routineCount * routineIn + fallbackCount * fallbackIn;
  const estimatedOutputTokens =
    highCount * highOut + routineCount * routineOut + fallbackCount * fallbackOut;

  return {
    suiteId: SUITE_ID,
    suiteVersion: SUITE_VERSION,
    paidExecutionAuthorized: false,
    plannedExamples,
    legalbenchExamples,
    legalciteExamples,
    estimatedProviderRequests,
    maxProviderRequests,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedSpendUsd,
    conservativeUpperBoundUsd,
    registryLinearUsd: Number(registryLinearUsd.toFixed(2)),
    estimateReconciliation: {
      harnessPointUsd: estimatedSpendUsd,
      registryLinearUsd: Number(registryLinearUsd.toFixed(2)),
      chosenConservativeUsd: conservativeUpperBoundUsd,
      reasons: [
        `Harness point uses pricing.current.json (claude-opus-5-5 @ $4/$20 per 1M, gpt-6.1-sol @ $2/$10, grok-4.7 reserve) with conservative tokens high=${highIn}/${highOut}, routine=${routineIn}/${routineOut}, fallbackReserve=${fallbackFraction}.`,
        `Registry linear scales frozen plan $${meta.future_live_plan.estimated_spend_usd} / ${meta.future_live_plan.planned_examples} examples → $${registryPerExample.toFixed(4)}/example × ${plannedExamples}.`,
        `Conservative upper bound = max(harness×${contingencyMultiplier}, registryLinear) = $${conservativeUpperBoundUsd}.`,
        "Prior ~$2.89 used smaller tokens and omitted explicit Grok fallback reserve; prior ~$11.10 was pure registry-linear without re-pricing.",
      ],
    },
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
      `Contingency multiplier ${contingencyMultiplier}; fallback reserve ${fallbackFraction} of high-stakes.`,
      `Reconciled conservative upper bound $${conservativeUpperBoundUsd} (withinHardCap=${conservativeUpperBoundUsd <= hardCapUsd}).`,
    ],
    gpt61SolLiveVerified: false,
  };
}
