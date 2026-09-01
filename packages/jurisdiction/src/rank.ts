import { classifyAuthorityRelationship, relationshipRank } from "./classify";
import { isAuthorityTemporallyApplicable } from "./temporal";
import type {
  AuthorityJurisdictionMetadata,
  AuthorityRelationship,
  MatterJurisdictionContext,
  TemporalApplicability,
} from "./types";

/** Applied after hierarchy. Missing dates stay 0 (UNKNOWN), never treated as applicable. */
export function temporalRank(applicability: TemporalApplicability): number {
  switch (applicability) {
    case "applicable":
      return 0.25;
    case "inapplicable":
      return -2;
    default:
      return 0;
  }
}

export type RankedAuthority<T> = T & {
  hierarchyRelationship: AuthorityRelationship;
  hierarchyReason: string;
  temporalApplicability: ReturnType<typeof isAuthorityTemporallyApplicable>;
  rankingScore: number;
};

export function rankAuthoritiesForMatter<T extends AuthorityJurisdictionMetadata>(
  matter: Pick<
    MatterJurisdictionContext,
    | "jurisdictionMode"
    | "forumType"
    | "primaryState"
    | "governingLawState"
    | "federalCircuit"
    | "relatedJurisdictions"
    | "courtId"
    | "asOfDate"
  >,
  items: T[],
  getScore: (item: T) => number = () => 0,
): RankedAuthority<T>[] {
  return items
    .map((item) => {
      const classified = classifyAuthorityRelationship(matter, item);
      const temporal = isAuthorityTemporallyApplicable(item, matter.asOfDate);
      const rankingScore =
        getScore(item) +
        relationshipRank(classified.relationship) * 0.5 +
        temporalRank(temporal);
      return {
        ...item,
        hierarchyRelationship: classified.relationship,
        hierarchyReason: classified.reason,
        temporalApplicability: temporal,
        rankingScore,
      };
    })
    .sort((a, b) => b.rankingScore - a.rankingScore);
}

export function preferredSearchHints(ctx: MatterJurisdictionContext | null | undefined): {
  preferredStateCodes: string[];
  preferredCircuitIds: string[];
} {
  if (!ctx || ctx.jurisdictionMode === "unknown") {
    return { preferredStateCodes: [], preferredCircuitIds: [] };
  }
  const states = new Set<string>();
  if (ctx.primaryState) states.add(ctx.primaryState);
  if (ctx.governingLawState) states.add(ctx.governingLawState);
  for (const related of ctx.relatedJurisdictions) {
    if (related.stateCode) states.add(related.stateCode);
  }
  return {
    preferredStateCodes: [...states],
    preferredCircuitIds: ctx.federalCircuit ? [ctx.federalCircuit] : [],
  };
}
