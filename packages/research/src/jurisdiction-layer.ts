import {
  formatJurisdictionRoleDisclosure,
  preferredSearchHints,
  rankAuthoritiesForMatter,
  resolveMatterJurisdictionContext,
  shouldAbstainForUnknownJurisdiction,
  UNKNOWN_JURISDICTION_ABSTENTION,
  type MatterJurisdictionContext,
  type TemporalApplicability,
} from "@nyayagrid/jurisdiction";
import type { Database } from "@nyayagrid/database";
import type { AuthoritySearchHit } from "./provider";
import type { AuthoritySearchOptions } from "./search";

export const COVERAGE_UNVALIDATED_WARNING =
  "Jurisdiction coverage for this Case is UNVALIDATED. The local/public corpus is not a certified survey of this state's law.";

export const COVERAGE_LIMITED_WARNING =
  "Limited authority coverage: the imported corpus for this Case's recorded jurisdiction is incomplete. Do not treat retrieved excerpts as a complete statement of the state's law.";

export function coverageStatusWarnings(coverage: string | null | undefined): string[] {
  if (coverage === "unvalidated") return [COVERAGE_UNVALIDATED_WARNING];
  if (coverage === "limited") return [COVERAGE_LIMITED_WARNING];
  return [];
}

export type LabeledResearchHit<T extends AuthoritySearchHit = AuthoritySearchHit> = T & {
  hierarchyRelationship: string;
  hierarchyReason: string;
  temporalApplicability: TemporalApplicability;
};

export async function loadMatterJurisdictionForResearch(params: {
  db: Database;
  organizationId: string;
  matterId: string | null;
  question: string;
}): Promise<{
  context: MatterJurisdictionContext | null;
  searchOptions: Pick<AuthoritySearchOptions, "preferredStateCodes" | "preferredCircuitIds">;
  warnings: string[];
}> {
  if (!params.matterId) {
    return { context: null, searchOptions: {}, warnings: [] };
  }
  const context = await resolveMatterJurisdictionContext({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
  });
  const hints = preferredSearchHints(context);
  const warnings: string[] = [];
  warnings.push(...coverageStatusWarnings(context?.coverage));
  if (shouldAbstainForUnknownJurisdiction(params.question, context)) {
    warnings.push(UNKNOWN_JURISDICTION_ABSTENTION);
  }
  if (context?.choiceOfLawDistinctFromForum) {
    warnings.push(
      formatJurisdictionRoleDisclosure(context) ??
        `Forum (${context.primaryState ?? context.forumType ?? "unknown"}) is not automatically the governing law (${context.governingLawState}).`,
    );
  }
  return {
    context,
    searchOptions: {
      preferredStateCodes: hints.preferredStateCodes,
      preferredCircuitIds: hints.preferredCircuitIds,
    },
    warnings,
  };
}

/**
 * Labels corpus hits for Case jurisdiction and ranks them.
 * Temporal applicability uses effective start/end only; missing windows stay UNKNOWN
 * and are not treated as currently applicable.
 */
export function labelResearchHits<T extends AuthoritySearchHit>(
  context: MatterJurisdictionContext | null,
  hits: T[],
): LabeledResearchHit<T>[] {
  if (!context) {
    return hits.map((hit) => ({
      ...hit,
      hierarchyRelationship: "unknown",
      hierarchyReason: "No Case jurisdiction context was available.",
      temporalApplicability: "unknown" as const,
    }));
  }
  return rankAuthoritiesForMatter(
    context,
    hits.map((hit) => ({
      ...hit,
      decisionDate: hit.decisionDate,
      effectiveStart: hit.effectiveStart ?? null,
      effectiveEnd: hit.effectiveEnd ?? null,
    })),
    (item) => item.score,
  ).map((ranked) => ({
    ...ranked,
    hierarchyRelationship: ranked.hierarchyRelationship,
    hierarchyReason: ranked.hierarchyReason,
    temporalApplicability: ranked.temporalApplicability,
  }));
}

export function hitToAuthorityMeta(hit: AuthoritySearchHit) {
  return {
    authorityType: hit.authorityType,
    jurisdiction: hit.jurisdiction,
    court: hit.court,
    courtId: hit.courtId,
    authorityState: hit.authorityState,
    federalCircuit: hit.federalCircuit,
    courtLevel: hit.courtLevel,
    decisionDate: hit.decisionDate,
    effectiveStart: hit.effectiveStart ?? null,
    effectiveEnd: hit.effectiveEnd ?? null,
  };
}
