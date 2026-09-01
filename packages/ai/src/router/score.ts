/**
 * Transparent deterministic routing score. Unrated fields stay null and cannot invent a win.
 * Auto only considers models that are VALIDATED/ACTIVE for the subsystem.
 */

import type { CertificationSubsystem, ExecutionStrategy } from "../provider-contract";
import type { HealthState } from "./health";
import type { ModelRegistryEntry } from "./registry";
import { isAutoEligible } from "./registry";

export type RoutingScoreBreakdown = {
  modelId: string;
  provider: string;
  eligible: boolean;
  ineligibleReason?: string;
  /** Null until the certification phase rates the model. */
  total: number | null;
  parts: {
    certification: number | null;
    health: number | null;
    quality: number | null;
    safety: number | null;
    citation: number | null;
    structured: number | null;
    latencyPenalty: number | null;
    costPenalty: number | null;
    failurePenalty: number | null;
  };
};

const HEALTH_POINTS: Record<HealthState, number> = {
  HEALTHY: 1,
  DEGRADED: 0.4,
  UNAVAILABLE: 0,
};

export function scoreModel(params: {
  entry: ModelRegistryEntry;
  subsystem: CertificationSubsystem;
  health: HealthState;
  strategy: ExecutionStrategy;
  preferProvider?: string;
  preferModelId?: string;
}): RoutingScoreBreakdown {
  const { entry, subsystem, health, preferProvider, preferModelId } = params;
  if (!isAutoEligible(entry, subsystem)) {
    return {
      modelId: entry.modelId,
      provider: entry.provider,
      eligible: false,
      ineligibleReason: `certification ${entry.certification[subsystem]} is not Auto-eligible for ${subsystem}`,
      total: null,
      parts: {
        certification: null,
        health: null,
        quality: entry.qualityScore,
        safety: entry.safetyScore,
        citation: entry.citationReliability,
        structured: entry.structuredReliability,
        latencyPenalty: null,
        costPenalty: null,
        failurePenalty: null,
      },
    };
  }
  if (health === "UNAVAILABLE") {
    return {
      modelId: entry.modelId,
      provider: entry.provider,
      eligible: false,
      ineligibleReason: "provider health UNAVAILABLE",
      total: null,
      parts: {
        certification: 1,
        health: 0,
        quality: entry.qualityScore,
        safety: entry.safetyScore,
        citation: entry.citationReliability,
        structured: entry.structuredReliability,
        latencyPenalty: null,
        costPenalty: null,
        failurePenalty: null,
      },
    };
  }

  const healthPoints = HEALTH_POINTS[health];
  const preferredBonus = preferProvider && entry.provider === preferProvider ? 0.15 : 0;
  const pinBonus = preferModelId && entry.modelId === preferModelId ? 0.5 : 0;
  const rated = [
    entry.qualityScore,
    entry.safetyScore,
    entry.citationReliability,
    entry.structuredReliability,
  ].filter((v): v is number => v != null);
  // Unrated validated models share a certification floor so Auto can still pick the
  // historical OpenAI route. They do not get fake quality points.
  const qualityFloor = rated.length > 0 ? rated.reduce((a, b) => a + b, 0) / rated.length : 0.5;
  const total = qualityFloor + healthPoints + preferredBonus + pinBonus;

  return {
    modelId: entry.modelId,
    provider: entry.provider,
    eligible: true,
    total,
    parts: {
      certification: 1,
      health: healthPoints,
      quality: entry.qualityScore,
      safety: entry.safetyScore,
      citation: entry.citationReliability,
      structured: entry.structuredReliability,
      latencyPenalty: null,
      costPenalty: null,
      failurePenalty: health === "DEGRADED" ? 0.6 : 0,
    },
  };
}

export function pickHighest(
  scores: RoutingScoreBreakdown[],
): RoutingScoreBreakdown | null {
  const eligible = scores.filter((s) => s.eligible && s.total != null);
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
  return eligible[0] ?? null;
}
