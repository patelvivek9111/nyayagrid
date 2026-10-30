/**
 * Benchmark-driven production model router (v2) — types only.
 * Activated only when FEATURE_NYAYA_MODEL_ROUTER_V2 is enabled.
 */

import type { ProviderId } from "../../provider-contract";

export const BENCHMARK_ROUTER_V2_VERSION = "nyaya-model-router-v2";

/** Frozen evidence labels — metadata only; runtime never reads artifact files. */
export const BENCHMARK_EVIDENCE_LABELS = {
  gptGrokStage2: "stage2-finalists-v1-044fb482d7bf",
  claudeStage2: "stage2-claude-challenger-v1-2828b09c9e38",
  geminiChallenger: "challenger-screen-v1-bc06ea00c66e",
} as const;

export const PINNED_BENCHMARK_MODEL_IDS = {
  claude: "claude-opus-5-5",
  grok: "grok-4.7",
  gpt: "gpt-6.1-sol",
  gemini: "gemini-4-argon",
} as const;

export type BenchmarkPinnedModelId =
  (typeof PINNED_BENCHMARK_MODEL_IDS)[keyof typeof PINNED_BENCHMARK_MODEL_IDS];

export type RoutingTier = 1 | 2 | 3 | 4;

export type BenchmarkTaskCategory =
  | "HARD_LEGAL_REASONING"
  | "AUTHORITY_ANALYSIS"
  | "LEGAL_RESEARCH_ANSWER"
  | "MATTER_SYNTHESIS_COMPLEX"
  | "CONFLICT_ANALYSIS"
  | "ROUTINE_MATTER_SYNTHESIS"
  | "STRUCTURED_EXTRACTION"
  | "STRUCTURED_TRANSFORMATION"
  | "DRAFTING_REWRITE"
  | "BACKGROUND_PROCESSING"
  | "LATENCY_SENSITIVE_INTERACTION"
  | "EVALUATION_JUDGE"
  | "EXPERIMENTAL";

export type RiskTier = "HIGH_STAKES_LEGAL" | "STANDARD" | "LOW" | "EXPERIMENTAL";

export type FallbackReasonCode =
  | "PRIMARY_TIMEOUT"
  | "PRIMARY_RATE_LIMIT"
  | "PRIMARY_PROVIDER_ERROR"
  | "PRIMARY_AUTH_FAILURE"
  | "PRIMARY_TERMINAL_UNKNOWN"
  | "PRIMARY_UNAVAILABLE"
  | "MANUAL_OVERRIDE"
  | "EXPERIMENTAL_OVERRIDE"
  | "BUDGET_WARNING_NO_DOWNGRADE"
  | "FAIL_CLOSED";

export type ClassificationReasonCode =
  | "EXPLICIT_TASK_CATEGORY"
  | "EXPLICIT_HIGH_STAKES_FLAG"
  | "SUBSYSTEM_CONTRADICTION"
  | "SUBSYSTEM_RESEARCH"
  | "SUBSYSTEM_DRAFT_HIGH_STAKES"
  | "SUBSYSTEM_DRAFT_ROUTINE"
  | "SUBSYSTEM_EXTRACTION"
  | "SUBSYSTEM_ASK_HIGH_RISK"
  | "SUBSYSTEM_ASK_ROUTINE"
  | "LATENCY_SENSITIVE"
  | "COST_SENSITIVE"
  | "BACKGROUND"
  | "EVALUATION_JUDGE"
  | "EXPERIMENTAL_OPT_IN"
  | "DEFAULT_STANDARD";

export type BenchmarkModelRegistryEntry = {
  provider: ProviderId;
  modelId: BenchmarkPinnedModelId;
  routingTiers: readonly RoutingTier[];
  certificationStatus:
    | "CERTIFIED_HIGH_STAKES_LEGAL"
    | "CERTIFIED_SECONDARY_LEGAL"
    | "COST_LATENCY_OPTIMIZED"
    | "EXPERIMENTAL_NOT_CERTIFIED";
  highStakesLegalAllowed: boolean;
  fallbackEligible: boolean;
  experimental: boolean;
  benchmarkEvidenceLabel: string;
  displayName: string;
};

export type BenchmarkRouteClassification = {
  taskCategory: BenchmarkTaskCategory;
  riskTier: RiskTier;
  routingTier: RoutingTier;
  reasonCodes: ClassificationReasonCode[];
};

export type BenchmarkRouteDecision = {
  routerVersion: typeof BENCHMARK_ROUTER_V2_VERSION;
  classification: BenchmarkRouteClassification;
  selectedModelId: BenchmarkPinnedModelId;
  selectedProvider: ProviderId;
  routingTier: RoutingTier;
  routingReason: string;
  primaryModelId: BenchmarkPinnedModelId;
  fallbackModelId: BenchmarkPinnedModelId | null;
  /** After primary+fallback exhausted for high-stakes: FAIL_CLOSED (never GPT/Gemini). */
  afterFallbackFailure: "FAIL_CLOSED" | "PROVIDER_RETRY_SAME_TIER" | "NONE";
  highStakesLegal: boolean;
  experimentalOptInRequired: boolean;
  budgetWarning?: boolean;
  evidenceLabels: typeof BENCHMARK_EVIDENCE_LABELS;
};

export type BenchmarkFallbackPlan = {
  allowed: boolean;
  fromModelId: BenchmarkPinnedModelId;
  toModelId: BenchmarkPinnedModelId | null;
  reasonCode: FallbackReasonCode;
  failClosed: boolean;
};
