/**
 * End-to-end pure route planner for model-router v2.
 */

import type { AiGenerateRequest } from "../../provider-contract";
import { classifyBenchmarkTask, type BenchmarkClassifyInput } from "./classify";
import {
  BenchmarkRouterPolicyError,
  buildRouteDecision,
  isIllegalHighStakesDowngrade,
  planHighStakesFallback,
} from "./policy";
import { getBenchmarkModel, isPinnedBenchmarkModelId } from "./registry";
import type {
  BenchmarkFallbackPlan,
  BenchmarkRouteDecision,
  BenchmarkTaskCategory,
  FallbackReasonCode,
} from "./types";

export type PlanBenchmarkRouteInput = {
  request: AiGenerateRequest;
  taskCategory?: BenchmarkTaskCategory;
  highStakesLegal?: boolean;
  experimentalOptIn?: boolean;
  latencySensitive?: boolean;
  costSensitive?: boolean;
  background?: boolean;
  evaluationJudge?: boolean;
  /** Soft budget pressure — warn only; never auto-downgrade Tier-1. */
  budgetExceeded?: boolean;
  /**
   * Explicit developer/admin override. Unsafe high-stakes Gemini still requires
   * experimentalOptIn and is marked experimental — never masquerades as certified.
   */
  manualModelOverride?: string;
};

export type BenchmarkRoutePlan = {
  decision: BenchmarkRouteDecision;
  overrideApplied: boolean;
  overrideVisible: boolean;
};

export function planBenchmarkRoute(input: PlanBenchmarkRouteInput): BenchmarkRoutePlan {
  const classifyInput: BenchmarkClassifyInput = {
    request: input.request,
    taskCategory: input.taskCategory ?? input.request.routing?.benchmarkTaskCategory,
    highStakesLegal: input.highStakesLegal ?? input.request.routing?.highStakesLegal ?? false,
    experimentalOptIn:
      input.experimentalOptIn ?? input.request.routing?.experimentalModelOptIn ?? false,
    latencySensitive: input.latencySensitive ?? input.request.routing?.latencySensitive ?? false,
    costSensitive: input.costSensitive ?? input.request.routing?.costSensitive ?? false,
    background: input.background ?? input.request.routing?.backgroundProcessing ?? false,
    evaluationJudge: input.evaluationJudge ?? input.request.routing?.evaluationJudge ?? false,
  };

  const classification = classifyBenchmarkTask(classifyInput);
  let decision = buildRouteDecision(classification, {
    experimentalOptIn: classifyInput.experimentalOptIn,
    budgetExceeded: input.budgetExceeded,
  });

  const manual = input.manualModelOverride ?? input.request.routing?.modelId?.split(":").pop();
  let overrideApplied = false;
  let overrideVisible = false;

  if (manual && isPinnedBenchmarkModelId(manual)) {
    const entry = getBenchmarkModel(manual);
    if (!entry) {
      throw new BenchmarkRouterPolicyError(`manual override model unknown: ${manual}`);
    }
    if (entry.experimental) {
      if (!classifyInput.experimentalOptIn) {
        throw new BenchmarkRouterPolicyError(
          "Gemini/experimental override requires experimentalModelOptIn",
        );
      }
      if (decision.highStakesLegal && !entry.highStakesLegalAllowed) {
        // Explicit experimental path only — never certified production routing.
        overrideVisible = true;
        decision = {
          ...decision,
          selectedModelId: entry.modelId,
          selectedProvider: entry.provider,
          routingTier: 4,
          routingReason: `EXPERIMENTAL_OVERRIDE to ${entry.modelId}; not certified high-stakes`,
          primaryModelId: entry.modelId,
          fallbackModelId: null,
          afterFallbackFailure: "NONE",
          highStakesLegal: false,
          experimentalOptInRequired: true,
        };
        overrideApplied = true;
      } else if (!decision.highStakesLegal) {
        overrideApplied = true;
        overrideVisible = true;
        decision = {
          ...decision,
          selectedModelId: entry.modelId,
          selectedProvider: entry.provider,
          routingTier: 4,
          routingReason: `EXPERIMENTAL_OVERRIDE to ${entry.modelId}`,
          primaryModelId: entry.modelId,
          fallbackModelId: null,
          experimentalOptInRequired: true,
        };
      }
    } else if (decision.highStakesLegal && !entry.highStakesLegalAllowed) {
      throw new BenchmarkRouterPolicyError(
        `Refusing silent high-stakes override to non-certified model ${manual}`,
      );
    } else if (
      decision.highStakesLegal &&
      entry.modelId !== decision.primaryModelId &&
      entry.modelId !== decision.fallbackModelId
    ) {
      // Allow explicit Tier-2 secondary selection only.
      if (entry.routingTiers.includes(2)) {
        overrideApplied = true;
        overrideVisible = true;
        decision = {
          ...decision,
          selectedModelId: entry.modelId,
          selectedProvider: entry.provider,
          routingTier: 2,
          routingReason: `MANUAL_OVERRIDE certified secondary ${entry.modelId}`,
          primaryModelId: entry.modelId,
          fallbackModelId: null,
          afterFallbackFailure: "FAIL_CLOSED",
        };
      } else {
        throw new BenchmarkRouterPolicyError(
          `Manual override ${manual} is not allowed for high-stakes legal routing`,
        );
      }
    } else if (!decision.highStakesLegal) {
      overrideApplied = true;
      overrideVisible = true;
      decision = {
        ...decision,
        selectedModelId: entry.modelId,
        selectedProvider: entry.provider,
        routingTier: entry.routingTiers[0] ?? decision.routingTier,
        routingReason: `MANUAL_OVERRIDE ${entry.modelId}`,
        primaryModelId: entry.modelId,
        fallbackModelId: entry.fallbackEligible ? decision.fallbackModelId : null,
      };
    }
  }

  if (
    decision.fallbackModelId &&
    isIllegalHighStakesDowngrade({
      highStakesLegal: decision.highStakesLegal,
      toModelId: decision.fallbackModelId,
    })
  ) {
    throw new BenchmarkRouterPolicyError("Illegal high-stakes fallback target in route decision");
  }

  return { decision, overrideApplied, overrideVisible };
}

export function resolveFallbackAfterPrimaryFailure(params: {
  decision: BenchmarkRouteDecision;
  failureCode?: string;
}): BenchmarkFallbackPlan {
  const plan = planHighStakesFallback({
    decision: params.decision,
    primaryFailedModelId: params.decision.selectedModelId,
    failureCode: params.failureCode,
  });
  if (
    plan.toModelId &&
    isIllegalHighStakesDowngrade({
      highStakesLegal: params.decision.highStakesLegal,
      toModelId: plan.toModelId,
    })
  ) {
    return {
      allowed: false,
      fromModelId: params.decision.selectedModelId,
      toModelId: null,
      reasonCode: "FAIL_CLOSED" satisfies FallbackReasonCode,
      failClosed: true,
    };
  }
  return plan;
}
