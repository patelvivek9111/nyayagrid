/**
 * Server-side authority eligibility for research grounding.
 *
 * IDENTITY_RESOLVED, TEXT_AVAILABLE, FULL_TEXT_VERIFIED, SOURCE_VERIFIED, and
 * CURRENTNESS_VERIFIED are separate conditions — never collapsed into one flag.
 */

export type AuthorityEligibilityClass =
  | "IDENTITY_RESOLVED"
  | "TEXT_AVAILABLE"
  | "FULL_TEXT_VERIFIED"
  | "SOURCE_VERIFIED"
  | "CURRENTNESS_VERIFIED"
  | "IDENTITY_ONLY"
  | "PARTIAL_TEXT"
  | "FAILED_INGESTION"
  | "SOURCE_UNVERIFIED"
  | "CONFLICTING_METADATA";

export type AuthorityEligibilityInput = {
  authorityId: string;
  /** Non-empty opinion/chunk text available for this authority. */
  hasTextContent: boolean;
  /** Total characters across text chunks when known. */
  textCharCount?: number | null;
  hasEmbedding?: boolean | null;
  canonicalSourceUrl?: string | null;
  sourceExternalId?: string | null;
  sourceProvider?: string | null;
  ingestionStatus?: string | null;
  /** Raw metadata.identityOnly when present. */
  identityOnly?: boolean | null;
  /** Raw metadata.corpusComplete when present. */
  corpusComplete?: boolean | null;
  /** Minimum chars to treat text as usable for quotation (default 500). */
  minQuoteChars?: number;
};

export type AuthorityEligibility = {
  authorityId: string;
  /** May appear in citation-identity / metadata UI. */
  allowIdentityLookup: boolean;
  /** May contribute retrieved chunks to grounded answers. */
  allowFullTextGrounding: boolean;
  /** May be quoted as opinion text. */
  allowOpinionQuote: boolean;
  classes: AuthorityEligibilityClass[];
  reasons: string[];
  conflictingMetadata: boolean;
};

const DEFAULT_MIN_QUOTE_CHARS = 500;

function hasProvenance(input: AuthorityEligibilityInput): boolean {
  const url = input.canonicalSourceUrl?.trim();
  const ext = input.sourceExternalId?.trim();
  return Boolean(url) && Boolean(ext);
}

/**
 * Classify an authority for retrieval and quotation. Conservative on conflicting flags:
 * identityOnly=true AND corpusComplete=true does not grant quote rights unless real text exists.
 */
export function classifyAuthorityEligibility(
  input: AuthorityEligibilityInput,
): AuthorityEligibility {
  const minChars = input.minQuoteChars ?? DEFAULT_MIN_QUOTE_CHARS;
  const chars = input.textCharCount ?? (input.hasTextContent ? minChars : 0);
  const identityOnly = input.identityOnly === true;
  const corpusComplete = input.corpusComplete === true;
  const conflictingMetadata = identityOnly && corpusComplete;
  const failed = typeof input.ingestionStatus === "string" && /fail/i.test(input.ingestionStatus);

  const classes: AuthorityEligibilityClass[] = [];
  const reasons: string[] = [];

  if (failed) {
    classes.push("FAILED_INGESTION");
    reasons.push("ingestion_status indicates failure");
  }
  if (conflictingMetadata) {
    classes.push("CONFLICTING_METADATA");
    reasons.push("identityOnly=true and corpusComplete=true; treating conservatively");
  }

  const hasRealText = input.hasTextContent && chars > 0;
  const quoteReady = hasRealText && chars >= minChars;
  const provenanceOk = hasProvenance(input);

  if (identityOnly && !hasRealText) {
    classes.push("IDENTITY_ONLY");
    classes.push("IDENTITY_RESOLVED");
    reasons.push("identity-only metadata without usable text chunks");
    return {
      authorityId: input.authorityId,
      allowIdentityLookup: true,
      allowFullTextGrounding: false,
      allowOpinionQuote: false,
      classes,
      reasons,
      conflictingMetadata,
    };
  }

  if (!hasRealText) {
    classes.push("IDENTITY_RESOLVED");
    if (!provenanceOk) classes.push("SOURCE_UNVERIFIED");
    reasons.push("no usable text content available");
    return {
      authorityId: input.authorityId,
      allowIdentityLookup: true,
      allowFullTextGrounding: false,
      allowOpinionQuote: false,
      classes,
      reasons,
      conflictingMetadata,
    };
  }

  classes.push("TEXT_AVAILABLE");
  if (quoteReady && provenanceOk) {
    classes.push("FULL_TEXT_VERIFIED");
    classes.push("SOURCE_VERIFIED");
  } else if (hasRealText && chars < minChars) {
    classes.push("PARTIAL_TEXT");
    reasons.push(`text present but below quote threshold (${chars}<${minChars})`);
  }
  if (!provenanceOk) {
    classes.push("SOURCE_UNVERIFIED");
    reasons.push("missing canonical_source_url and/or source_external_id");
  }
  // Currentness is never inferred from absence of contrary treatment.
  // Callers may add CURRENTNESS_VERIFIED only after an explicit currentness check.

  const allowOpinionQuote = quoteReady && provenanceOk && !failed;
  const allowFullTextGrounding = hasRealText && !failed;

  if (identityOnly && hasRealText) {
    reasons.push(
      "identityOnly flag set but text chunks exist; using content/provenance checks, not the flag alone",
    );
  }

  return {
    authorityId: input.authorityId,
    allowIdentityLookup: true,
    allowFullTextGrounding,
    allowOpinionQuote,
    classes,
    reasons,
    conflictingMetadata,
  };
}

/** Reject opinion quotation when eligibility forbids it. */
export function assertOpinionQuoteAllowed(
  eligibility: AuthorityEligibility,
  context = "authority",
): void {
  if (!eligibility.allowOpinionQuote) {
    throw new Error(
      `OPINION_QUOTE_FORBIDDEN: ${context} ${eligibility.authorityId} classes=${eligibility.classes.join(",")}`,
    );
  }
}
