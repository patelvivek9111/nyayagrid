import { eq, sql } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import { legalAuthorities, legalAuthorityChunks, legalAuthorityVersions } from "@nyayagrid/database";
import { listUsStates, normalizeStateCode } from "@nyayagrid/jurisdiction";
import { isSyntheticBenchSource, US_PRIMARY_CORPUS_PROVIDER } from "./source-classes";
import type { QualityTier } from "./quality-tier";

export type CorpusInventoryRow = {
  id: string;
  authorityType: string;
  jurisdiction: string | null;
  court: string | null;
  courtId: string | null;
  authorityState: string | null;
  federalCircuit: string | null;
  courtLevel: string | null;
  decisionDate: string | null;
  effectiveDate: string | null;
  sourceProvider: string;
  canonicalSourceUrl: string | null;
  citation: string | null;
  metadata: Record<string, unknown> | null;
};

function asState(row: CorpusInventoryRow): string | null {
  return (
    (row.authorityState ? normalizeStateCode(row.authorityState) : null) ??
    (row.jurisdiction ? normalizeStateCode(row.jurisdiction) : null)
  );
}

function tierFromRow(row: CorpusInventoryRow): QualityTier | null {
  const tier = row.metadata?.qualityTier;
  return typeof tier === "string" ? (tier as QualityTier) : null;
}

export type StateCorpusSummary = {
  state: string;
  authorityCount: number;
  realPrimaryCount: number;
  statuteCount: number;
  caseCount: number;
  regulationCount: number;
  stateHighCount: number;
  stateAppellateCount: number;
  normalizedMetadataPercent: number;
  effectiveDateCoveragePercent: number;
  withCanonicalUrlPercent: number;
  tierDistribution: Record<string, number>;
};

export type CorpusInventory = {
  generatedAt: string;
  totalAuthorities: number;
  realPrimaryAuthorities: number;
  syntheticAuthorities: number;
  typeCounts: Record<string, number>;
  realTypeCounts: Record<string, number>;
  tierDistribution: Record<string, number>;
  normalizedStateCount: number;
  normalizedCourtIdCount: number;
  withEffectiveDateCount: number;
  withCanonicalUrlCount: number;
  withDecisionDateCount: number;
  chunkCount: number;
  versionCount: number;
  sourceProviders: Record<string, number>;
  states: Record<string, StateCorpusSummary>;
  unmappedRealCount: number;
};

export async function buildCorpusInventory(db: Database): Promise<CorpusInventory> {
  const rows = await db
    .select({
      id: legalAuthorities.id,
      authorityType: legalAuthorities.authorityType,
      jurisdiction: legalAuthorities.jurisdiction,
      court: legalAuthorities.court,
      courtId: legalAuthorities.courtId,
      authorityState: legalAuthorities.authorityState,
      federalCircuit: legalAuthorities.federalCircuit,
      courtLevel: legalAuthorities.courtLevel,
      decisionDate: legalAuthorities.decisionDate,
      effectiveDate: legalAuthorities.effectiveDate,
      sourceProvider: legalAuthorities.sourceProvider,
      canonicalSourceUrl: legalAuthorities.canonicalSourceUrl,
      citation: legalAuthorities.citation,
      metadata: legalAuthorities.metadata,
    })
    .from(legalAuthorities);

  const typedRows: CorpusInventoryRow[] = rows.map((row) => ({
    ...row,
    authorityType: String(row.authorityType),
    sourceProvider: row.sourceProvider ?? "",
    decisionDate: row.decisionDate ? String(row.decisionDate) : null,
    effectiveDate: row.effectiveDate ? String(row.effectiveDate) : null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  }));

  const realRows = typedRows.filter(
    (row) => !isSyntheticBenchSource(row.sourceProvider, row.metadata),
  );
  const syntheticRows = typedRows.filter((row) =>
    isSyntheticBenchSource(row.sourceProvider, row.metadata),
  );

  const typeCounts: Record<string, number> = {};
  const realTypeCounts: Record<string, number> = {};
  const tierDistribution: Record<string, number> = {};
  const sourceProviders: Record<string, number> = {};

  for (const row of typedRows) {
    typeCounts[row.authorityType] = (typeCounts[row.authorityType] ?? 0) + 1;
    sourceProviders[row.sourceProvider] = (sourceProviders[row.sourceProvider] ?? 0) + 1;
  }
  for (const row of realRows) {
    realTypeCounts[row.authorityType] = (realTypeCounts[row.authorityType] ?? 0) + 1;
    const tier = tierFromRow(row) ?? "unknown";
    tierDistribution[tier] = (tierDistribution[tier] ?? 0) + 1;
  }

  const [chunkRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(legalAuthorityChunks)
    .innerJoin(legalAuthorities, eq(legalAuthorityChunks.authorityId, legalAuthorities.id))
    .where(eq(legalAuthorities.sourceProvider, US_PRIMARY_CORPUS_PROVIDER));

  const [versionRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(legalAuthorityVersions)
    .innerJoin(legalAuthorities, eq(legalAuthorityVersions.authorityId, legalAuthorities.id))
    .where(eq(legalAuthorities.sourceProvider, US_PRIMARY_CORPUS_PROVIDER));
  const chunkCount = chunkRow?.count ?? 0;
  const versionCount = versionRow?.count ?? 0;

  const states = [...listUsStates().map((s) => s.code), "DC"];
  const byState: Record<string, StateCorpusSummary> = Object.fromEntries(
    states.map((code) => {
      const authorities = realRows.filter((row) => asState(row) === code);
      const normalized = authorities.filter(
        (row) => row.courtId || row.authorityState || row.courtLevel,
      );
      const withEffective = authorities.filter((row) => row.effectiveDate);
      const withUrl = authorities.filter((row) => row.canonicalSourceUrl);
      const tiers: Record<string, number> = {};
      for (const row of authorities) {
        const tier = tierFromRow(row) ?? "unknown";
        tiers[tier] = (tiers[tier] ?? 0) + 1;
      }
      return [
        code,
        {
          state: code,
          authorityCount: authorities.length,
          realPrimaryCount: authorities.length,
          statuteCount: authorities.filter((row) => row.authorityType === "statute").length,
          caseCount: authorities.filter((row) => row.authorityType === "case").length,
          regulationCount: authorities.filter((row) => row.authorityType === "regulation").length,
          stateHighCount: authorities.filter((row) => row.courtLevel === "state_high").length,
          stateAppellateCount: authorities.filter((row) => row.courtLevel === "state_appellate").length,
          normalizedMetadataPercent:
            authorities.length === 0
              ? 0
              : Math.round((normalized.length / authorities.length) * 1000) / 10,
          effectiveDateCoveragePercent:
            authorities.length === 0
              ? 0
              : Math.round((withEffective.length / authorities.length) * 1000) / 10,
          withCanonicalUrlPercent:
            authorities.length === 0
              ? 0
              : Math.round((withUrl.length / authorities.length) * 1000) / 10,
          tierDistribution: tiers,
        },
      ];
    }),
  );

  return {
    generatedAt: new Date().toISOString(),
    totalAuthorities: typedRows.length,
    realPrimaryAuthorities: realRows.length,
    syntheticAuthorities: syntheticRows.length,
    typeCounts,
    realTypeCounts,
    tierDistribution,
    normalizedStateCount: realRows.filter((row) => row.authorityState).length,
    normalizedCourtIdCount: realRows.filter((row) => row.courtId).length,
    withEffectiveDateCount: realRows.filter((row) => row.effectiveDate).length,
    withCanonicalUrlCount: realRows.filter((row) => row.canonicalSourceUrl).length,
    withDecisionDateCount: realRows.filter((row) => row.decisionDate).length,
    chunkCount: chunkCount ?? 0,
    versionCount: versionCount ?? 0,
    sourceProviders,
    states: byState,
    unmappedRealCount: realRows.filter((row) => !asState(row)).length,
  };
}
