import { eq, sql } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import { legalAuthorities, legalAuthorityChunks, legalAuthorityVersions } from "@nyayagrid/database";
import { listUsStates, normalizeStateCode } from "@nyayagrid/jurisdiction";
import { isSyntheticBenchSource, US_PRIMARY_CORPUS_PROVIDER } from "./source-classes";
import type { QualityTier } from "./quality-tier";

export type CorpusCoverageClass = "no_corpus" | "seed_corpus" | "limited_corpus" | "broader_corpus";

export function classifyJurisdictionCoverage(params: {
  authorityCount: number;
  statuteCount: number;
  caseCount: number;
  regulationCount: number;
  /** Optional: court rules, constitutions, high-court/appellate presence, metadata completeness. */
  ruleCount?: number;
  highCourtCaseCount?: number;
  appellateCaseCount?: number;
  withCanonicalUrlPercent?: number;
  currentnessKnownPercent?: number;
}): CorpusCoverageClass {
  const {
    authorityCount,
    statuteCount,
    caseCount,
    regulationCount,
    ruleCount = 0,
    highCourtCaseCount = 0,
    appellateCaseCount = 0,
    withCanonicalUrlPercent = 0,
    currentnessKnownPercent = 0,
  } = params;
  if (authorityCount === 0) return "no_corpus";

  // Token / shallow seed: 1–2 authorities, or ≤2 statutes with no other primary-law types.
  if (
    authorityCount <= 2 ||
    (statuteCount <= 2 &&
      caseCount === 0 &&
      regulationCount === 0 &&
      ruleCount === 0 &&
      authorityCount <= 5)
  ) {
    return "seed_corpus";
  }

  // Broader requires material multi-type depth plus appellate/high-court signal and provenance.
  // Never claim broader for shallow curated batches alone.
  const multiType =
    statuteCount >= 15 &&
    caseCount >= 20 &&
    (regulationCount > 0 || ruleCount > 0) &&
    (highCourtCaseCount > 0 || appellateCaseCount > 0) &&
    withCanonicalUrlPercent >= 80 &&
    currentnessKnownPercent >= 40;
  if (authorityCount > 100 && multiType) return "broader_corpus";

  // Limited: meaningful statute depth and/or multi-type presence beyond token seed.
  if (
    statuteCount >= 3 ||
    (statuteCount >= 1 && caseCount >= 1) ||
    regulationCount >= 3 ||
    ruleCount >= 3 ||
    authorityCount >= 6
  ) {
    return "limited_corpus";
  }

  return "seed_corpus";
}

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

function asJurisdiction(row: CorpusInventoryRow): string | null {
  const raw = row.authorityState?.trim() || row.jurisdiction?.trim() || null;
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper === "US" || upper === "USA" || upper === "FEDERAL") return "US";
  if (/united\s+states/i.test(raw)) return "US";
  return normalizeStateCode(raw);
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
  coverageClass: CorpusCoverageClass;
};

export type FederalCorpusSummary = {
  authorityCount: number;
  statuteCount: number;
  caseCount: number;
  constitutionCount: number;
  regulationCount: number;
  scotusCount: number;
  coverageClass: CorpusCoverageClass;
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
  federal: FederalCorpusSummary;
  unmappedRealCount: number;
  coverageWaveHint: {
    wave1SupportedStates: string[];
    wave1Federal: boolean;
    remainingNoCorpusStates: number;
  };
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

  const states = [...listUsStates().map((s) => s.code)];
  const byState: Record<string, StateCorpusSummary> = Object.fromEntries(
    states.map((code) => {
      const authorities = realRows.filter((row) => asJurisdiction(row) === code);
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
      const statuteCount = authorities.filter((row) => row.authorityType === "statute").length;
      const caseCount = authorities.filter((row) => row.authorityType === "case").length;
      const regulationCount = authorities.filter((row) => row.authorityType === "regulation").length;
      const ruleCount = authorities.filter((row) => row.authorityType === "rule").length;
      const highCourtCaseCount = authorities.filter((row) => row.courtLevel === "state_high").length;
      const appellateCaseCount = authorities.filter((row) => row.courtLevel === "state_appellate").length;
      const withUrlPercent =
        authorities.length === 0
          ? 0
          : Math.round((withUrl.length / authorities.length) * 1000) / 10;
      return [
        code,
        {
          state: code,
          authorityCount: authorities.length,
          realPrimaryCount: authorities.length,
          statuteCount,
          caseCount,
          regulationCount,
          stateHighCount: highCourtCaseCount,
          stateAppellateCount: appellateCaseCount,
          normalizedMetadataPercent:
            authorities.length === 0
              ? 0
              : Math.round((normalized.length / authorities.length) * 1000) / 10,
          effectiveDateCoveragePercent:
            authorities.length === 0
              ? 0
              : Math.round((withEffective.length / authorities.length) * 1000) / 10,
          withCanonicalUrlPercent: withUrlPercent,
          tierDistribution: tiers,
          coverageClass: classifyJurisdictionCoverage({
            authorityCount: authorities.length,
            statuteCount,
            caseCount,
            regulationCount,
            ruleCount,
            highCourtCaseCount,
            appellateCaseCount,
            withCanonicalUrlPercent: withUrlPercent,
          }),
        },
      ];
    }),
  );

  const federalRows = realRows.filter((row) => asJurisdiction(row) === "US" || row.authorityState === "US");
  const federalStatuteCount = federalRows.filter((row) => row.authorityType === "statute").length;
  const federalCaseCount = federalRows.filter((row) => row.authorityType === "case").length;
  const federalRegulationCount = federalRows.filter((row) => row.authorityType === "regulation").length;
  const federalRuleCount = federalRows.filter((row) => row.authorityType === "rule").length;
  const federalWithUrl = federalRows.filter((row) => row.canonicalSourceUrl).length;
  const federal: FederalCorpusSummary = {
    authorityCount: federalRows.length,
    statuteCount: federalStatuteCount,
    caseCount: federalCaseCount,
    constitutionCount: federalRows.filter((row) => row.authorityType === "constitution").length,
    regulationCount: federalRegulationCount,
    scotusCount: federalRows.filter(
      (row) => row.courtLevel === "scotus" || row.courtId === "us-scotus",
    ).length,
    coverageClass: classifyJurisdictionCoverage({
      authorityCount: federalRows.length,
      statuteCount: federalStatuteCount,
      caseCount: federalCaseCount,
      regulationCount: federalRegulationCount,
      ruleCount: federalRuleCount,
      highCourtCaseCount: federalRows.filter(
        (row) => row.courtLevel === "scotus" || row.courtId === "us-scotus",
      ).length,
      appellateCaseCount: federalRows.filter((row) => row.courtLevel === "circuit").length,
      withCanonicalUrlPercent:
        federalRows.length === 0
          ? 0
          : Math.round((federalWithUrl / federalRows.length) * 1000) / 10,
    }),
  };

  const wave1SupportedStates = Object.values(byState)
    .filter((s) => s.coverageClass !== "no_corpus")
    .map((s) => s.state)
    .sort();

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
    federal,
    unmappedRealCount: realRows.filter((row) => !asJurisdiction(row)).length,
    coverageWaveHint: {
      wave1SupportedStates,
      wave1Federal: federal.authorityCount > 0,
      remainingNoCorpusStates: Object.values(byState).filter((s) => s.coverageClass === "no_corpus")
        .length,
    },
  };
}
