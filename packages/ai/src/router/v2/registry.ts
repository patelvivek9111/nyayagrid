/**
 * Canonical pinned model registry for benchmark-driven router v2.
 * Exact IDs only — never latest / recommended / mutable aliases.
 */

import type { ProviderId } from "../../provider-contract";
import {
  BENCHMARK_EVIDENCE_LABELS,
  PINNED_BENCHMARK_MODEL_IDS,
  type BenchmarkModelRegistryEntry,
  type BenchmarkPinnedModelId,
  type RoutingTier,
} from "./types";

export const BENCHMARK_MODEL_REGISTRY: readonly BenchmarkModelRegistryEntry[] = [
  {
    provider: "anthropic",
    modelId: PINNED_BENCHMARK_MODEL_IDS.claude,
    routingTiers: [1] as const,
    certificationStatus: "CERTIFIED_HIGH_STAKES_LEGAL",
    highStakesLegalAllowed: true,
    fallbackEligible: false,
    experimental: false,
    benchmarkEvidenceLabel: BENCHMARK_EVIDENCE_LABELS.claudeStage2,
    displayName: "Claude Opus 5.5",
  },
  {
    provider: "xai",
    modelId: PINNED_BENCHMARK_MODEL_IDS.grok,
    routingTiers: [2] as const,
    certificationStatus: "CERTIFIED_SECONDARY_LEGAL",
    highStakesLegalAllowed: true,
    fallbackEligible: true,
    experimental: false,
    benchmarkEvidenceLabel: BENCHMARK_EVIDENCE_LABELS.gptGrokStage2,
    displayName: "Grok 4.7",
  },
  {
    provider: "openai",
    modelId: PINNED_BENCHMARK_MODEL_IDS.gpt,
    routingTiers: [3] as const,
    certificationStatus: "COST_LATENCY_OPTIMIZED",
    highStakesLegalAllowed: false,
    fallbackEligible: false,
    experimental: false,
    benchmarkEvidenceLabel: BENCHMARK_EVIDENCE_LABELS.gptGrokStage2,
    displayName: "GPT-6.1 Sol",
  },
  {
    provider: "google",
    modelId: PINNED_BENCHMARK_MODEL_IDS.gemini,
    routingTiers: [4] as const,
    certificationStatus: "EXPERIMENTAL_NOT_CERTIFIED",
    highStakesLegalAllowed: false,
    fallbackEligible: false,
    experimental: true,
    benchmarkEvidenceLabel: BENCHMARK_EVIDENCE_LABELS.geminiChallenger,
    displayName: "Gemini 4 Argon",
  },
] as const;

const BY_MODEL = new Map(
  BENCHMARK_MODEL_REGISTRY.map((entry) => [entry.modelId, entry] as const),
);

export function getBenchmarkModel(
  modelId: string,
): BenchmarkModelRegistryEntry | undefined {
  return BY_MODEL.get(modelId as BenchmarkPinnedModelId);
}

export function requireBenchmarkModel(
  modelId: BenchmarkPinnedModelId,
): BenchmarkModelRegistryEntry {
  const entry = getBenchmarkModel(modelId);
  if (!entry) {
    throw new Error(`Unknown benchmark-pinned model: ${modelId}`);
  }
  return entry;
}

export function modelForTier(tier: RoutingTier): BenchmarkModelRegistryEntry {
  const entry = BENCHMARK_MODEL_REGISTRY.find((m) => m.routingTiers.includes(tier));
  if (!entry) throw new Error(`No model registered for routing tier ${tier}`);
  return entry;
}

export function isPinnedBenchmarkModelId(value: string): value is BenchmarkPinnedModelId {
  return BY_MODEL.has(value as BenchmarkPinnedModelId);
}

export function providerForPinnedModel(modelId: BenchmarkPinnedModelId): ProviderId {
  return requireBenchmarkModel(modelId).provider;
}

/** Feature flag env name — default OFF everywhere. */
export const MODEL_ROUTER_V2_ENV = "FEATURE_NYAYA_MODEL_ROUTER_V2";

export function isModelRouterV2Enabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env[MODEL_ROUTER_V2_ENV]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
