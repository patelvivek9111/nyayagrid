/**
 * Tier policy + fail-closed high-stakes fallback rules.
 */

import { modelForTier, requireBenchmarkModel } from "./registry";
import {
  BENCHMARK_EVIDENCE_LABELS,
  BENCHMARK_ROUTER_V2_VERSION,
  PINNED_BENCHMARK_MODEL_IDS,
  type BenchmarkFallbackPlan,
  type BenchmarkRouteClassification,
  type BenchmarkRouteDecision,
  type FallbackReasonCode,
} from "./types";

export function buildRouteDecision(
  classification: BenchmarkRouteClassification,
  opts?: {
    experimentalOptIn?: boolean;
    budgetExceeded?: boolean;
    manualModelId?: string;
  },
): BenchmarkRouteDecision {
  if (classification.routingTier === 4) {
    if (!opts?.experimentalOptIn) {
      throw new BenchmarkRouterPolicyError(
        "Tier-4 Gemini requires explicit experimentalOptIn; never automatic",
      );
    }
    const gemini = modelForTier(4);
    return {
      routerVersion: BENCHMARK_ROUTER_V2_VERSION,
      classification,
      selectedModelId: gemini.modelId,
      selectedProvider: gemini.provider,
      routingTier: 4,
      routingReason: `tier4 experimental ${gemini.modelId}; opt-in required`,
      primaryModelId: gemini.modelId,
      fallbackModelId: null,
      afterFallbackFailure: "NONE",
      highStakesLegal: false,
      experimentalOptInRequired: true,
      evidenceLabels: BENCHMARK_EVIDENCE_LABELS,
    };
  }

  if (classification.routingTier === 1 || classification.riskTier === "HIGH_STAKES_LEGAL") {
    const primary = requireBenchmarkModel(PINNED_BENCHMARK_MODEL_IDS.claude);
    const secondary = requireBenchmarkModel(PINNED_BENCHMARK_MODEL_IDS.grok);
    return {
      routerVersion: BENCHMARK_ROUTER_V2_VERSION,
      classification: {
        ...classification,
        routingTier: 1,
        riskTier: "HIGH_STAKES_LEGAL",
      },
      selectedModelId: primary.modelId,
      selectedProvider: primary.provider,
      routingTier: 1,
      routingReason: [
        `tier1 primary ${primary.modelId}`,
        `fallback ${secondary.modelId}`,
        `task ${classification.taskCategory}`,
        `reasons ${classification.reasonCodes.join(",")}`,
        opts?.budgetExceeded ? "BUDGET_WARNING_NO_DOWNGRADE" : null,
      ]
        .filter(Boolean)
        .join("; "),
      primaryModelId: primary.modelId,
      fallbackModelId: secondary.modelId,
      afterFallbackFailure: "FAIL_CLOSED",
      highStakesLegal: true,
      experimentalOptInRequired: false,
      budgetWarning: opts?.budgetExceeded === true,
      evidenceLabels: BENCHMARK_EVIDENCE_LABELS,
    };
  }

  if (classification.routingTier === 2) {
    const secondary = requireBenchmarkModel(PINNED_BENCHMARK_MODEL_IDS.grok);
    return {
      routerVersion: BENCHMARK_ROUTER_V2_VERSION,
      classification,
      selectedModelId: secondary.modelId,
      selectedProvider: secondary.provider,
      routingTier: 2,
      routingReason: `tier2 certified secondary ${secondary.modelId}`,
      primaryModelId: secondary.modelId,
      fallbackModelId: null,
      afterFallbackFailure: "FAIL_CLOSED",
      highStakesLegal: true,
      experimentalOptInRequired: false,
      evidenceLabels: BENCHMARK_EVIDENCE_LABELS,
    };
  }

  // Tier 3 — GPT only; no cross-provider high-stakes downgrade path.
  const gpt = requireBenchmarkModel(PINNED_BENCHMARK_MODEL_IDS.gpt);
  return {
    routerVersion: BENCHMARK_ROUTER_V2_VERSION,
    classification: { ...classification, routingTier: 3 },
    selectedModelId: gpt.modelId,
    selectedProvider: gpt.provider,
    routingTier: 3,
    routingReason: [
      `tier3 ${gpt.modelId}`,
      `task ${classification.taskCategory}`,
      `reasons ${classification.reasonCodes.join(",")}`,
    ].join("; "),
    primaryModelId: gpt.modelId,
    fallbackModelId: null,
    afterFallbackFailure: "PROVIDER_RETRY_SAME_TIER",
    highStakesLegal: false,
    experimentalOptInRequired: false,
    evidenceLabels: BENCHMARK_EVIDENCE_LABELS,
  };
}

/**
 * Map operational error codes onto typed fallback reason codes.
 */
export function mapOperationalFailureToReason(
  code: string | undefined,
): FallbackReasonCode {
  switch (code) {
    case "timeout":
      return "PRIMARY_TIMEOUT";
    case "rate_limit":
      return "PRIMARY_RATE_LIMIT";
    case "auth":
    case "auth_error":
      return "PRIMARY_AUTH_FAILURE";
    case "unavailable":
      return "PRIMARY_UNAVAILABLE";
    case "unknown":
    case "unknown_completion":
      return "PRIMARY_TERMINAL_UNKNOWN";
    default:
      return "PRIMARY_PROVIDER_ERROR";
  }
}

/**
 * High-stakes fallback: Claude → Grok only. Never GPT or Gemini.
 */
export function planHighStakesFallback(params: {
  decision: BenchmarkRouteDecision;
  primaryFailedModelId: string;
  failureCode?: string;
}): BenchmarkFallbackPlan {
  const reasonCode = mapOperationalFailureToReason(params.failureCode);
  if (!params.decision.highStakesLegal) {
    return {
      allowed: false,
      fromModelId: params.decision.primaryModelId,
      toModelId: null,
      reasonCode,
      failClosed: false,
    };
  }

  if (params.primaryFailedModelId === PINNED_BENCHMARK_MODEL_IDS.claude) {
    return {
      allowed: true,
      fromModelId: PINNED_BENCHMARK_MODEL_IDS.claude,
      toModelId: PINNED_BENCHMARK_MODEL_IDS.grok,
      reasonCode,
      failClosed: false,
    };
  }

  if (params.primaryFailedModelId === PINNED_BENCHMARK_MODEL_IDS.grok) {
    return {
      allowed: false,
      fromModelId: PINNED_BENCHMARK_MODEL_IDS.grok,
      toModelId: null,
      reasonCode: "FAIL_CLOSED",
      failClosed: true,
    };
  }

  return {
    allowed: false,
    fromModelId: params.decision.primaryModelId,
    toModelId: null,
    reasonCode: "FAIL_CLOSED",
    failClosed: true,
  };
}

/** True if a proposed fallback target would be an illegal silent high-stakes downgrade. */
export function isIllegalHighStakesDowngrade(params: {
  highStakesLegal: boolean;
  toModelId: string;
}): boolean {
  if (!params.highStakesLegal) return false;
  return (
    params.toModelId === PINNED_BENCHMARK_MODEL_IDS.gpt ||
    params.toModelId === PINNED_BENCHMARK_MODEL_IDS.gemini
  );
}

export class BenchmarkRouterPolicyError extends Error {
  readonly code = "BENCHMARK_ROUTER_POLICY" as const;
  constructor(message: string) {
    super(message);
    this.name = "BenchmarkRouterPolicyError";
  }
}
