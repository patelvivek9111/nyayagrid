/**
 * Shared citation-target classification semantics.
 * Classification ≠ authority-resolution state (IDENTITY_UNRESOLVED / AUTHORITY_RESOLVED / CORPUS_COMPLETE).
 * Do not overload resolution flags with artifact semantics.
 */

/**
 * Keep in sync with packages/database CITATION_TARGET_CLASSIFICATIONS / migration 0024.
 * Local constant avoids pulling the full database barrel (drizzle) into unit tests.
 */
export const CITATION_TARGET_CLASSIFICATIONS = [
  "CASE_CITATION",
  "STATUTE",
  "RULE",
  "REGULATION",
  "BARE_PAGE",
  "PIN_CITE_ONLY",
  "YYYY_PAGE_N",
  "RECORD_REFERENCE",
  "EXHIBIT_REFERENCE",
  "DOCKET_REFERENCE",
  "SECTION_REFERENCE",
  "OCR_MALFORMED",
  "PARSER_MALFORMED",
  "NON_CASE_REPORTER",
  "OTHER_NON_CASE",
  "CASE_LIKE_BUT_MALFORMED",
  "UNKNOWN_ARTIFACT",
  "UNKNOWN",
] as const;

export type CitationTargetClassification = (typeof CITATION_TARGET_CLASSIFICATIONS)[number];

/** Deterministic non-case / malformed artifact categories (ineligible for case-identity queue). */
export const CITATION_ARTIFACT_CLASSIFICATIONS = [
  "STATUTE",
  "RULE",
  "REGULATION",
  "BARE_PAGE",
  "PIN_CITE_ONLY",
  "YYYY_PAGE_N",
  "RECORD_REFERENCE",
  "EXHIBIT_REFERENCE",
  "DOCKET_REFERENCE",
  "SECTION_REFERENCE",
  "OCR_MALFORMED",
  "PARSER_MALFORMED",
  "NON_CASE_REPORTER",
  "OTHER_NON_CASE",
  "CASE_LIKE_BUT_MALFORMED",
  "UNKNOWN_ARTIFACT",
] as const satisfies readonly CitationTargetClassification[];

export type CitationArtifactClassification = (typeof CITATION_ARTIFACT_CLASSIFICATIONS)[number];

const ARTIFACT_SET = new Set<string>(CITATION_ARTIFACT_CLASSIFICATIONS);

/**
 * Whether a persisted classification belongs in the true case-identity / CL queue.
 *
 * - CASE_CITATION → eligible
 * - UNKNOWN → conservatively eligible (keep in queue until Chat B backfill classifies)
 * - artifact categories (incl. CASE_LIKE_BUT_MALFORMED) → not eligible
 * - null/undefined → treat as UNKNOWN (pre-migration / unset)
 */
export function isCaseIdentityEligible(
  classification: CitationTargetClassification | string | null | undefined,
): boolean {
  const c = normalizeClassification(classification);
  if (c === "CASE_CITATION" || c === "UNKNOWN") return true;
  return false;
}

/**
 * True when classification is a deterministic non-case/malformed artifact.
 * CASE_LIKE_BUT_MALFORMED is preserved for review but is an artifact (ineligible).
 */
export function isCitationArtifactClassification(
  classification: CitationTargetClassification | string | null | undefined,
): boolean {
  const c = normalizeClassification(classification);
  return ARTIFACT_SET.has(c);
}

/** Strict true-case metric: only confirmed CASE_CITATION (excludes UNKNOWN and artifacts). */
export function isTrueCaseIdentityClassification(
  classification: CitationTargetClassification | string | null | undefined,
): boolean {
  return normalizeClassification(classification) === "CASE_CITATION";
}

export function isUnknownClassification(
  classification: CitationTargetClassification | string | null | undefined,
): boolean {
  return normalizeClassification(classification) === "UNKNOWN";
}

export function normalizeClassification(
  classification: CitationTargetClassification | string | null | undefined,
): CitationTargetClassification {
  if (classification == null || classification === "") return "UNKNOWN";
  if ((CITATION_TARGET_CLASSIFICATIONS as readonly string[]).includes(classification)) {
    return classification as CitationTargetClassification;
  }
  return "UNKNOWN";
}

/** Classifications allowed into case-identity resolver queues (persisted filter). */
export function caseIdentityEligibleClassifications(): CitationTargetClassification[] {
  return ["CASE_CITATION", "UNKNOWN"];
}

export function citationArtifactClassifications(): CitationArtifactClassification[] {
  return [...CITATION_ARTIFACT_CLASSIFICATIONS];
}

/**
 * Queue predicate: exclude persisted artifacts from case-identity / CL queues.
 * When classification is absent, UNKNOWN semantics apply (conservative keep).
 * Does not call CourtListener.
 */
export function filterCaseIdentityQueueByClassification<
  T extends { citationTargetClassification?: CitationTargetClassification | string | null },
>(items: T[]): T[] {
  return items.filter((item) => isCaseIdentityEligible(item.citationTargetClassification));
}
