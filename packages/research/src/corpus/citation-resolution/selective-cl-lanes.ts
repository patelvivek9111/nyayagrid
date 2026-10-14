/**
 * Selective CourtListener reporter-lane ranking and collision-query gates.
 * Pure helpers — no network I/O.
 */

import type { UnresolvedTarget } from "./types.js";

export type ClLaneReporter =
  | "f4th"
  | "fsupp3d"
  | "p3d"
  | "a3d"
  | "so3d"
  | "us"
  | "sct"
  | "led2d"
  | "idaho"
  | "or"
  | "mass"
  | "kan"
  | "other";

export type LaneEconomicStats = {
  requests: number;
  highTargets: number;
  ambiguous: number;
  notFound: number;
  edgesResolved: number;
};

export type LaneDecision = "STRONG" | "MARGINAL" | "WEAK";

export type CollisionDiscriminator = {
  caseName?: string | null;
  jurisdiction?: string | null;
  date?: string | null;
  parallelCitation?: string | null;
  citingContext?: string | null;
  officialSourceMetadata?: string | null;
};

/** Compact reporter token from target. */
export function compactReporter(rep: string | null | undefined): string | null {
  if (!rep) return null;
  return String(rep).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function mapToLaneReporter(rep: string | null | undefined): ClLaneReporter {
  const r = compactReporter(rep);
  if (!r) return "other";
  if (r === "f4th") return "f4th";
  if (r === "fsupp3d" || r === "fsupp3") return "fsupp3d";
  if (r === "p3d") return "p3d";
  if (r === "a3d") return "a3d";
  if (r === "so3d") return "so3d";
  if (r === "us") return "us";
  if (r === "sct") return "sct";
  if (r === "led2d") return "led2d";
  if (r === "idaho") return "idaho";
  if (r === "or") return "or";
  if (r === "mass") return "mass";
  if (r === "kan") return "kan";
  return "other";
}

/**
 * Rank targets within a reporter lane for selective CL diagnostics.
 * Higher score = earlier in queue.
 */
export function scoreLaneTarget(input: {
  edgeCount: number;
  uniqueCitingCases?: number;
  hasCleanVrp: boolean;
  priorDefinitiveNotFound: boolean;
  isHopelessCollisionWithoutDiscriminator: boolean;
  providerSuitableShape: boolean;
}): number {
  if (input.priorDefinitiveNotFound) return -1e9;
  if (input.isHopelessCollisionWithoutDiscriminator) return -1e8;
  let s = 0;
  s += input.edgeCount * 100;
  s += (input.uniqueCitingCases || 0) * 25;
  if (input.hasCleanVrp) s += 50;
  if (input.providerSuitableShape) s += 40;
  return s;
}

export function rankLaneTargets<T extends { score: number; targetKey: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.score - a.score || a.targetKey.localeCompare(b.targetKey));
}

/** Collision targets may only be queried when a discriminator exists. */
export function mayQueryCollisionTarget(discriminator: CollisionDiscriminator | null | undefined): boolean {
  if (!discriminator) return false;
  const vals = [
    discriminator.caseName,
    discriminator.jurisdiction,
    discriminator.date,
    discriminator.parallelCitation,
    discriminator.citingContext,
    discriminator.officialSourceMetadata,
  ];
  return vals.some((v) => String(v || "").trim().length > 0);
}

export function evaluateLaneEconomics(stats: LaneEconomicStats): {
  decision: LaneDecision;
  highRate: number;
  edgesPerCl: number;
  ambiguityRate: number;
  notFoundRate: number;
} {
  const req = Math.max(1, stats.requests);
  const highRate = stats.highTargets / req;
  const edgesPerCl = stats.edgesResolved / req;
  const ambiguityRate = stats.ambiguous / req;
  const notFoundRate = stats.notFound / req;

  let decision: LaneDecision = "WEAK";
  if (highRate >= 0.5 || edgesPerCl >= 2.0) decision = "STRONG";
  else if (highRate >= 0.25 || edgesPerCl >= 1.0) decision = "MARGINAL";
  else decision = "WEAK";

  // Ambiguity flood demotes STRONG → MARGINAL
  if (decision === "STRONG" && ambiguityRate > 0.45) decision = "MARGINAL";
  return { decision, highRate, edgesPerCl, ambiguityRate, notFoundRate };
}

export function filterTargetsForLane(
  targets: UnresolvedTarget[],
  lane: ClLaneReporter,
): UnresolvedTarget[] {
  return targets.filter((t) => mapToLaneReporter(t.reporter) === lane);
}
