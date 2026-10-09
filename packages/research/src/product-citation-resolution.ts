/**
 * Shared product-facing citation resolution service (Deepening Pass 5).
 *
 * Single policy over resolveCitationForProduct — do not reimplement per workspace.
 * Never invents authority identity, silently picks among ambiguous matches,
 * claims CORPUS_COMPLETE without corpusComplete, or invents treatment.
 */

import { desc } from "drizzle-orm";
import { legalAuthorities, type Database } from "@nyayagrid/database";
import { extractCitationsFromText } from "./citations";
import {
  resolveCitationForProduct,
  type AuthorityIndexRow,
  type ProductCitationResolution,
  type ProductResolutionOutcome,
  type ResolutionState,
} from "./citation-resolution-contract";
import { getTreatmentDisplay, TREATMENT_UNVERIFIED_NOTICE } from "./treatment";

export type CitationDisplayState =
  | "VERIFIED_IDENTITY"
  | "FULL_TEXT_AVAILABLE"
  | "IDENTITY_VERIFIED_TEXT_NOT_IN_CORPUS"
  | "AMBIGUOUS"
  | "UNRESOLVED"
  | "NOT_CASE_CITATION"
  | "MALFORMED"
  | "TREATMENT_NOT_VERIFIED";

export type AuthorityAttributionPolicy =
  | "ALLOW_IDENTITY"
  | "ALLOW_FULL_TEXT_PROPOSITION"
  | "ABSTAIN_AMBIGUOUS"
  | "ABSTAIN_UNRESOLVED"
  | "NOT_CASE_LANE";

export type ProductCitationCoverage = {
  identityVerified: boolean;
  fullOpinionTextAvailable: boolean;
  fullOpinionTextUnavailableLocally: boolean;
  treatmentVerifiedFromSource: boolean;
  treatmentUnknown: boolean;
  coverageWarning: string | null;
  displayState: CitationDisplayState;
  attribution: AuthorityAttributionPolicy;
};

export type ProductResolvedCitation = ProductCitationResolution & {
  displayCitation: string;
  authorityName: string | null;
  court: string | null;
  decisionDate: string | null;
  coverage: ProductCitationCoverage;
};

export function toAuthorityIndexRow(row: {
  id: string;
  citation?: string | null;
  normalizedCitation?: string | null;
  title?: string | null;
  shortTitle?: string | null;
  court?: string | null;
  courtId?: string | null;
  decisionDate?: string | Date | null;
  sourceProvider?: string | null;
  sourceExternalId?: string | null;
  authorityType?: string | null;
  ingestionStatus?: string | null;
  metadata?: Record<string, unknown> | null;
  corpusComplete?: boolean | null;
}): AuthorityIndexRow {
  const metadata = row.metadata ?? {};
  const corpusComplete =
    row.corpusComplete === true ||
    metadata.corpusComplete === true ||
    metadata.fullTextPresent === true;
  return {
    id: row.id,
    citation: row.citation ?? null,
    normalizedCitation: row.normalizedCitation ?? null,
    title: row.title ?? null,
    shortTitle: row.shortTitle ?? null,
    court: row.court ?? null,
    courtId: row.courtId ?? null,
    decisionDate: row.decisionDate ?? null,
    sourceProvider: row.sourceProvider ?? null,
    sourceExternalId: row.sourceExternalId ?? null,
    authorityType: row.authorityType ?? null,
    ingestionStatus: row.ingestionStatus ?? null,
    metadata,
    corpusComplete,
  };
}

/** Load a bounded authority index snapshot for product resolution (no CourtListener). */
export async function loadAuthorityIndexForProduct(
  db: Database,
  options?: { limit?: number },
): Promise<AuthorityIndexRow[]> {
  const rows = await db
    .select({
      id: legalAuthorities.id,
      citation: legalAuthorities.citation,
      normalizedCitation: legalAuthorities.normalizedCitation,
      title: legalAuthorities.title,
      shortTitle: legalAuthorities.shortTitle,
      court: legalAuthorities.court,
      courtId: legalAuthorities.courtId,
      decisionDate: legalAuthorities.decisionDate,
      sourceProvider: legalAuthorities.sourceProvider,
      sourceExternalId: legalAuthorities.sourceExternalId,
      authorityType: legalAuthorities.authorityType,
      ingestionStatus: legalAuthorities.ingestionStatus,
      metadata: legalAuthorities.metadata,
    })
    .from(legalAuthorities)
    .orderBy(desc(legalAuthorities.updatedAt))
    .limit(options?.limit ?? 5000);
  return rows.map((row) => toAuthorityIndexRow(row));
}

export function citationDisplayState(resolution: ProductCitationResolution): CitationDisplayState {
  if (resolution.outcome === "AMBIGUOUS") return "AMBIGUOUS";
  if (resolution.outcome === "MALFORMED") return "MALFORMED";
  if (resolution.outcome === "NOT_CASE_CITATION") return "NOT_CASE_CITATION";
  if (
    resolution.outcome === "NOT_FOUND" ||
    resolution.outcome === "DEFERRED" ||
    resolution.authorityState === "IDENTITY_UNRESOLVED" ||
    !resolution.authorityId
  ) {
    return "UNRESOLVED";
  }
  if (resolution.authorityState === "CORPUS_COMPLETE" || resolution.corpusComplete) {
    return "FULL_TEXT_AVAILABLE";
  }
  if (resolution.authorityState === "AUTHORITY_RESOLVED") {
    return "IDENTITY_VERIFIED_TEXT_NOT_IN_CORPUS";
  }
  return "VERIFIED_IDENTITY";
}

export function attributionPolicyForResolution(
  resolution: ProductCitationResolution,
): AuthorityAttributionPolicy {
  if (resolution.outcome === "AMBIGUOUS") return "ABSTAIN_AMBIGUOUS";
  if (resolution.outcome === "NOT_CASE_CITATION" || resolution.outcome === "MALFORMED") {
    return "NOT_CASE_LANE";
  }
  if (
    resolution.outcome !== "RESOLVED_HIGH_CONFIDENCE" ||
    !resolution.authorityId ||
    resolution.confidence !== "HIGH"
  ) {
    return "ABSTAIN_UNRESOLVED";
  }
  if (resolution.authorityState === "CORPUS_COMPLETE" && resolution.corpusComplete) {
    return "ALLOW_FULL_TEXT_PROPOSITION";
  }
  if (
    resolution.authorityState === "AUTHORITY_RESOLVED" ||
    resolution.authorityState === "CORPUS_COMPLETE"
  ) {
    return "ALLOW_IDENTITY";
  }
  return "ABSTAIN_UNRESOLVED";
}

export function coverageForResolution(
  resolution: ProductCitationResolution,
  treatmentStatus?: string | null,
): ProductCitationCoverage {
  const displayState = citationDisplayState(resolution);
  const attribution = attributionPolicyForResolution(resolution);
  const identityVerified =
    Boolean(resolution.authorityId) &&
    (resolution.authorityState === "AUTHORITY_RESOLVED" ||
      resolution.authorityState === "CORPUS_COMPLETE") &&
    resolution.outcome === "RESOLVED_HIGH_CONFIDENCE";
  const fullOpinionTextAvailable = identityVerified && resolution.corpusComplete === true;
  const treatment = getTreatmentDisplay({
    treatmentStatus: treatmentStatus ?? resolution.treatmentVerificationStatus,
  });
  const treatmentVerifiedFromSource = treatment.status === "source_reported";

  let coverageWarning: string | null = null;
  if (displayState === "AMBIGUOUS") {
    coverageWarning =
      "Citation identity is ambiguous among multiple authorities; NyayaGrid will not guess which one was meant.";
  } else if (displayState === "UNRESOLVED") {
    coverageWarning =
      "Citation identity is unresolved in the local authority index; do not treat this citation as verified.";
  } else if (displayState === "IDENTITY_VERIFIED_TEXT_NOT_IN_CORPUS") {
    coverageWarning =
      "Authority identity verified; full opinion text is not yet available in the local corpus.";
  } else if (displayState === "NOT_CASE_CITATION") {
    coverageWarning = "Reference is not treated as a case-authority identity lookup.";
  } else if (displayState === "MALFORMED") {
    coverageWarning = "Citation appears malformed and was not resolved as a case authority.";
  }
  if (!treatmentVerifiedFromSource) {
    coverageWarning = coverageWarning
      ? `${coverageWarning} ${TREATMENT_UNVERIFIED_NOTICE}`
      : TREATMENT_UNVERIFIED_NOTICE;
  }

  return {
    identityVerified,
    fullOpinionTextAvailable,
    fullOpinionTextUnavailableLocally: identityVerified && !fullOpinionTextAvailable,
    treatmentVerifiedFromSource,
    treatmentUnknown: !treatmentVerifiedFromSource,
    coverageWarning,
    displayState: treatmentVerifiedFromSource ? displayState : displayState === "UNRESOLVED" || displayState === "AMBIGUOUS" || displayState === "MALFORMED" || displayState === "NOT_CASE_CITATION"
      ? displayState
      : displayState === "FULL_TEXT_AVAILABLE" || displayState === "IDENTITY_VERIFIED_TEXT_NOT_IN_CORPUS" || displayState === "VERIFIED_IDENTITY"
        ? displayState
        : "TREATMENT_NOT_VERIFIED",
    attribution,
  };
}

export function enrichProductResolution(
  resolution: ProductCitationResolution,
  authorities: AuthorityIndexRow[],
  treatmentStatus?: string | null,
): ProductResolvedCitation {
  const row = resolution.authorityId
    ? authorities.find((item) => item.id === resolution.authorityId) ?? null
    : null;
  const coverage = coverageForResolution(resolution, treatmentStatus);
  return {
    ...resolution,
    displayCitation: resolution.normalizedCitation ?? resolution.rawCitation,
    authorityName: row?.title ?? row?.shortTitle ?? null,
    court: row?.court ?? null,
    decisionDate: row?.decisionDate ? String(row.decisionDate) : null,
    coverage,
  };
}

/** Batch resolve with a single LocalAuthorityIndex construction path (via resolveCitationForProduct). */
export function resolveCitationsForProduct(params: {
  citations: Array<{ rawCitation: string; normalizedCitation?: string | null }>;
  authorities: AuthorityIndexRow[];
}): ProductResolvedCitation[] {
  return params.citations.map((citation) =>
    enrichProductResolution(
      resolveCitationForProduct({
        rawCitation: citation.rawCitation,
        normalizedCitation: citation.normalizedCitation,
        authorities: params.authorities,
      }),
      params.authorities,
    ),
  );
}

export function extractAndResolveCitationsInText(params: {
  text: string;
  authorities: AuthorityIndexRow[];
}): ProductResolvedCitation[] {
  const extracted = extractCitationsFromText(params.text);
  if (extracted.length === 0) return [];
  return resolveCitationsForProduct({
    citations: extracted.map((row) => ({
      rawCitation: row.raw,
      normalizedCitation: row.normalized ?? null,
    })),
    authorities: params.authorities,
  });
}

/**
 * Resolve-or-abstain for citation-bearing authority assertions.
 * Returns qualifications / suppressions; never invents a substitute authority.
 */
export function applyResolveOrAbstainPolicy(params: {
  resolutions: ProductResolvedCitation[];
}): {
  allowedIdentityAuthorityIds: string[];
  allowedFullTextAuthorityIds: string[];
  qualifications: string[];
  suppressedCitations: string[];
  graphEligibleAuthorityIds: string[];
} {
  const allowedIdentityAuthorityIds: string[] = [];
  const allowedFullTextAuthorityIds: string[] = [];
  const qualifications: string[] = [];
  const suppressedCitations: string[] = [];
  const graphEligibleAuthorityIds: string[] = [];

  for (const resolution of params.resolutions) {
    const { attribution, coverageWarning, displayState } = resolution.coverage;
    if (coverageWarning) qualifications.push(`${resolution.rawCitation}: ${coverageWarning}`);

    if (attribution === "ALLOW_FULL_TEXT_PROPOSITION" && resolution.authorityId) {
      allowedIdentityAuthorityIds.push(resolution.authorityId);
      allowedFullTextAuthorityIds.push(resolution.authorityId);
      graphEligibleAuthorityIds.push(resolution.authorityId);
      continue;
    }
    if (attribution === "ALLOW_IDENTITY" && resolution.authorityId) {
      allowedIdentityAuthorityIds.push(resolution.authorityId);
      graphEligibleAuthorityIds.push(resolution.authorityId);
      qualifications.push(
        `${resolution.rawCitation}: identity-level attribution only (${displayState}); do not treat full-text propositions as corpus-backed unless separately sourced.`,
      );
      continue;
    }
    if (attribution === "ABSTAIN_AMBIGUOUS" || attribution === "ABSTAIN_UNRESOLVED") {
      suppressedCitations.push(resolution.rawCitation);
      continue;
    }
    // NOT_CASE_LANE — no case-authority semantics; leave for other grounding paths.
  }

  return {
    allowedIdentityAuthorityIds: [...new Set(allowedIdentityAuthorityIds)],
    allowedFullTextAuthorityIds: [...new Set(allowedFullTextAuthorityIds)],
    qualifications: [...new Set(qualifications)],
    suppressedCitations: [...new Set(suppressedCitations)],
    graphEligibleAuthorityIds: [...new Set(graphEligibleAuthorityIds)],
  };
}

/** True when a graph edge to this authority is allowed (deterministic identity only). */
export function canLinkAuthorityInGraph(resolution: ProductCitationResolution): boolean {
  return (
    resolution.outcome === "RESOLVED_HIGH_CONFIDENCE" &&
    Boolean(resolution.authorityId) &&
    resolution.confidence === "HIGH" &&
    (resolution.authorityState === "AUTHORITY_RESOLVED" ||
      resolution.authorityState === "CORPUS_COMPLETE")
  );
}

/** Memory may store resolution facts — never unsupported treatment conclusions. */
export function memorySafeResolutionFact(resolution: ProductResolvedCitation): {
  allowed: boolean;
  fact: string | null;
  blockedReason: string | null;
} {
  if (
    resolution.outcome === "RESOLVED_HIGH_CONFIDENCE" &&
    resolution.authorityId &&
    resolution.confidence === "HIGH"
  ) {
    return {
      allowed: true,
      fact: `Citation "${resolution.rawCitation}" resolved to authority ${resolution.authorityId} (state=${resolution.authorityState}, method=${resolution.method ?? "unknown"}, corpusComplete=${resolution.corpusComplete}).`,
      blockedReason: null,
    };
  }
  if (resolution.outcome === "AMBIGUOUS") {
    return {
      allowed: true,
      fact: `Citation "${resolution.rawCitation}" is ambiguous among ${resolution.ambiguityAuthorityIds.join(", ")}.`,
      blockedReason: null,
    };
  }
  return {
    allowed: true,
    fact: `Citation "${resolution.rawCitation}" remains unresolved (outcome=${resolution.outcome}).`,
    blockedReason: null,
  };
}

export function blocksUnsupportedTreatmentMemory(text: string): boolean {
  return /\b(still )?good law\b|\boverruled\b|\bnegative treatment\b|\bKeyCite\b|\bShepard/i.test(
    text,
  );
}

export type ProductCitationFixtureBundle = {
  authorities: AuthorityIndexRow[];
  citations: Record<
    | "resolvedCorpusComplete"
    | "resolvedMetadataOnly"
    | "parallel"
    | "ambiguous"
    | "unresolved"
    | "nonCase"
    | "malformed"
    | "matterDocument",
    string
  >;
};

/** Deterministic synthetic fixture for product surfaces and D5 benchmarks. */
export function buildPass5CitationFixture(): ProductCitationFixtureBundle {
  const authorities: AuthorityIndexRow[] = [
    toAuthorityIndexRow({
      id: "auth-brown",
      citation: "347 U.S. 483",
      normalizedCitation: "347 U.S. 483",
      title: "Brown v. Board of Education (synthetic)",
      court: "U.S. Supreme Court",
      decisionDate: "1954-05-17",
      ingestionStatus: "ready",
      corpusComplete: true,
      metadata: { corpusComplete: true, fullTextPresent: true },
    }),
    toAuthorityIndexRow({
      id: "auth-roe-meta",
      citation: "410 U.S. 113",
      normalizedCitation: "410 U.S. 113",
      title: "Roe v. Wade (synthetic metadata)",
      court: "U.S. Supreme Court",
      decisionDate: "1973-01-22",
      ingestionStatus: "metadata_only",
      corpusComplete: false,
    }),
    toAuthorityIndexRow({
      id: "auth-parallel-a",
      citation: "123 F.3d 456",
      normalizedCitation: "123 F.3d 456",
      title: "Synthetic Parallel A",
      court: "U.S. Court of Appeals",
      ingestionStatus: "metadata_only",
      corpusComplete: false,
      metadata: { parallelCitations: ["123 F.3d 456", "1997 WL 12345"] },
    }),
    toAuthorityIndexRow({
      id: "auth-ambig-1",
      citation: "999 F.2d 111",
      normalizedCitation: "999 F.2d 111",
      title: "Ambiguous Synthetic One",
      ingestionStatus: "metadata_only",
      corpusComplete: false,
    }),
    toAuthorityIndexRow({
      id: "auth-ambig-2",
      citation: "999 F.2d 111",
      normalizedCitation: "999 F.2d 111",
      title: "Ambiguous Synthetic Two",
      ingestionStatus: "metadata_only",
      corpusComplete: false,
    }),
  ];

  return {
    authorities,
    citations: {
      resolvedCorpusComplete: "347 U.S. 483",
      resolvedMetadataOnly: "410 U.S. 113",
      parallel: "123 F.3d 456",
      ambiguous: "999 F.2d 111",
      unresolved: "1 Fake. Rep. 999",
      nonCase: "42 U.S.C. § 1983",
      malformed: "2026 Page 2",
      matterDocument: "doc-lease-excerpt",
    },
  };
}

export function formatResolutionForAskContext(resolutions: ProductResolvedCitation[]): string {
  if (resolutions.length === 0) return "";
  const lines = [
    "CITATION_RESOLUTION_REVIEW (product resolver; no invented treatment):",
    ...resolutions.map((row) => {
      return `- raw=${row.rawCitation} outcome=${row.outcome} state=${row.authorityState} authorityId=${row.authorityId ?? "null"} corpusComplete=${row.corpusComplete} display=${row.coverage.displayState} attribution=${row.coverage.attribution}`;
    }),
    `TREATMENT_NOTICE: ${TREATMENT_UNVERIFIED_NOTICE}`,
  ];
  return lines.join("\n");
}

export type { ProductCitationResolution, ProductResolutionOutcome, ResolutionState, AuthorityIndexRow };
