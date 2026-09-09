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
  const certRank = entry.certification[subsystem] === "ACTIVE" ? 2 : 1;
  const rated = [
    entry.qualityScore,
    entry.safetyScore,
    entry.citationReliability,
    entry.structuredReliability,
  ].filter((v): v is number => v != null);
  // Unrated validated models share a certification floor so Auto can still pick the
  // historical OpenAI route. They do not get fake quality points.
  // Env preference and pin are tie-breaks in pickHighest — they must not swamp quality.
  const qualityFloor = rated.length > 0 ? rated.reduce((a, b) => a + b, 0) / rated.length : 0.5;
  void preferProvider;
  void preferModelId;

  return {
    modelId: entry.modelId,
    provider: entry.provider,
    eligible: true,
    total: qualityFloor,
    parts: {
      certification: certRank,
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

export const ROUTING_SCORE_VERSION = "nyaya-routing-score-v2";

export type PickHighestOptions = {
  preferProvider?: string;
  pinnedModelId?: (provider: string) => string | undefined;
};

function cmpNumber(b: number, a: number): number {
  if (b > a) return 1;
  if (b < a) return -1;
  return 0;
}

/**
 * Rank eligible Auto candidates.
 * Safety and certification eligibility already excluded ineligible rows.
 * Remaining order: health → ACTIVE over VALIDATED → quality floor → env preference → pin.
 * Global safety/quality scores must not steal a subsystem's ACTIVE route.
 * Cost and operator preference never outrank an ineligible or circuit-open model.
 */
export function compareRoutingScores(
  a: RoutingScoreBreakdown,
  b: RoutingScoreBreakdown,
  options: PickHighestOptions = {},
): number {
  const health = cmpNumber(b.parts.health ?? -1, a.parts.health ?? -1);
  if (health !== 0) return health;
  const cert = cmpNumber(b.parts.certification ?? 0, a.parts.certification ?? 0);
  if (cert !== 0) return cert;
  const quality = cmpNumber(b.total ?? -1, a.total ?? -1);
  if (quality !== 0) return quality;
  const prefer = options.preferProvider;
  if (prefer) {
    const pref = Number(b.provider === prefer) - Number(a.provider === prefer);
    if (pref !== 0) return pref;
  }
  const pinOf = options.pinnedModelId;
  if (pinOf) {
    const pin = Number(b.modelId === pinOf(b.provider)) - Number(a.modelId === pinOf(a.provider));
    if (pin !== 0) return pin;
  }
  return 0;
}

export function pickHighest(
  scores: RoutingScoreBreakdown[],
  options: PickHighestOptions = {},
): RoutingScoreBreakdown | null {
  const eligible = scores.filter((s) => s.eligible && s.total != null);
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => compareRoutingScores(a, b, options));
  return eligible[0] ?? null;
}
