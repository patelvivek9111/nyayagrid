/**
 * Bridge benchmark-pinned models into NyayaRouter ModelRegistryEntry shape.
 * Used only when FEATURE_NYAYA_MODEL_ROUTER_V2 is ON.
 */

import { CERTIFICATION_SUBSYSTEMS } from "../../provider-contract";
import type { ModelLifecycle, ModelRegistryEntry } from "../registry";
import { BENCHMARK_MODEL_REGISTRY } from "./registry";
import type { BenchmarkModelRegistryEntry } from "./types";

function certificationFor(entry: BenchmarkModelRegistryEntry): ModelRegistryEntry["certification"] {
  const status: ModelLifecycle = entry.highStakesLegalAllowed
    ? "ACTIVE"
    : entry.experimental
      ? "CANDIDATE"
      : "VALIDATED";
  return Object.fromEntries(
    CERTIFICATION_SUBSYSTEMS.map((s) => [s, status]),
  ) as ModelRegistryEntry["certification"];
}

export function toRouterRegistryEntry(entry: BenchmarkModelRegistryEntry): ModelRegistryEntry {
  return {
    id: `${entry.provider}:${entry.modelId}`,
    provider: entry.provider,
    modelId: entry.modelId,
    displayName: entry.displayName,
    status: entry.highStakesLegalAllowed
      ? "ACTIVE"
      : entry.experimental
        ? "CANDIDATE"
        : "VALIDATED",
    capabilities: {
      textGeneration: true,
      structuredOutput: true,
      toolUse: false,
      streaming: false,
    },
    contextWindowTokens: 200_000,
    structuredOutputSupport: true,
    toolUseSupport: false,
    streamingSupport: false,
    certification: certificationFor(entry),
    qualityScore: entry.highStakesLegalAllowed ? 0.9 : entry.experimental ? null : 0.7,
    safetyScore: entry.experimental ? null : 0.8,
    citationReliability: entry.highStakesLegalAllowed ? 0.85 : null,
    structuredReliability: entry.certificationStatus === "COST_LATENCY_OPTIMIZED" ? 0.85 : null,
    notes: `Benchmark router v2; evidence ${entry.benchmarkEvidenceLabel}; ${entry.certificationStatus}`,
  };
}

export function buildBenchmarkRouterRegistryOverlay(): ModelRegistryEntry[] {
  return BENCHMARK_MODEL_REGISTRY.map(toRouterRegistryEntry);
}

export function findBenchmarkRouterEntry(modelId: string): ModelRegistryEntry | undefined {
  const match = BENCHMARK_MODEL_REGISTRY.find((m) => m.modelId === modelId);
  return match ? toRouterRegistryEntry(match) : undefined;
}
