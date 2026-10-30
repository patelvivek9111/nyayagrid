export {
  BENCHMARK_ROUTER_V2_VERSION,
  BENCHMARK_EVIDENCE_LABELS,
  PINNED_BENCHMARK_MODEL_IDS,
  type BenchmarkPinnedModelId,
  type RoutingTier,
  type BenchmarkTaskCategory,
  type RiskTier,
  type FallbackReasonCode,
  type ClassificationReasonCode,
  type BenchmarkModelRegistryEntry,
  type BenchmarkRouteClassification,
  type BenchmarkRouteDecision,
  type BenchmarkFallbackPlan,
} from "./types";
export {
  BENCHMARK_MODEL_REGISTRY,
  MODEL_ROUTER_V2_ENV,
  getBenchmarkModel,
  requireBenchmarkModel,
  modelForTier,
  isPinnedBenchmarkModelId,
  providerForPinnedModel,
  isModelRouterV2Enabled,
} from "./registry";
export { classifyBenchmarkTask, type BenchmarkClassifyInput } from "./classify";
export {
  buildRouteDecision,
  planHighStakesFallback,
  mapOperationalFailureToReason,
  isIllegalHighStakesDowngrade,
  BenchmarkRouterPolicyError,
} from "./policy";
export {
  planBenchmarkRoute,
  resolveFallbackAfterPrimaryFailure,
  type PlanBenchmarkRouteInput,
  type BenchmarkRoutePlan,
} from "./select";
