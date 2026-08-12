export type QuoteValidation = {
  valid: boolean;
  /** Whitespace-normalized quote, present only when the quote was verified against the source. */
  normalizedQuote?: string;
  reason?: string;
};

const MIN_MEANINGFUL_CHARS = 12;
const MIN_MEANINGFUL_WORDS = 3;

/**
 * Normalize characters that differ purely by typography (smart quotes, dashes, non-breaking
 * spaces, ligature-style whitespace) so a faithful copy of the source still validates.
 */
export function normalizeQuoteText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019\u201b\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201f\u2033]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

function stripQuotePackaging(value: string): string {
  return value
    .replace(/^["'`\u201c\u201d\u2018\u2019]+/, "")
    .replace(/["'`\u201c\u201d\u2018\u2019]+$/, "")
    .replace(/^\s*(?:\.\.\.|\u2026)\s*/, "")
    .replace(/\s*(?:\.\.\.|\u2026)\s*$/, "")
    .trim();
}

/**
 * Verify that a quote actually appears in the source text. This is the last line of defense
 * against fabricated quotations: only whitespace and typography are normalized, never wording.
 */
export function validateQuoteAgainstText(quote: string, sourceText: string): QuoteValidation {
  const candidate = stripQuotePackaging(normalizeQuoteText(quote ?? ""));
  const source = normalizeQuoteText(sourceText ?? "");

  if (!candidate) {
    return { valid: false, reason: "Quote is empty." };
  }
  if (!source) {
    return { valid: false, reason: "Source text is empty; nothing can be verified." };
  }
  const wordCount = candidate.split(" ").filter(Boolean).length;
  if (candidate.length < MIN_MEANINGFUL_CHARS || wordCount < MIN_MEANINGFUL_WORDS) {
    return {
      valid: false,
      reason: "Quote is too short to verify as meaningful source content.",
    };
  }
  if (!source.includes(candidate)) {
    return {
      valid: false,
      reason: "Quote does not appear verbatim in the cited authority text.",
    };
  }
  return { valid: true, normalizedQuote: candidate };
}

export type QuoteCandidate = {
  quote: string;
  chunkId?: string;
};

export type QuoteValidationResult<T extends QuoteCandidate> = {
  accepted: Array<T & { normalizedQuote: string }>;
  rejected: Array<T & { reason: string }>;
};

/** Filter model-produced quote candidates down to the ones that survive verbatim verification. */
export function validateQuoteCandidates<T extends QuoteCandidate>(
  candidates: T[],
  sourceTextByChunkId: Map<string, string>,
  fallbackSourceText?: string,
): QuoteValidationResult<T> {
  const accepted: Array<T & { normalizedQuote: string }> = [];
  const rejected: Array<T & { reason: string }> = [];

  for (const candidate of candidates) {
    const source = candidate.chunkId
      ? sourceTextByChunkId.get(candidate.chunkId)
      : fallbackSourceText;
    if (!source) {
      rejected.push({ ...candidate, reason: "No source text available for the cited chunk." });
      continue;
    }
    const result = validateQuoteAgainstText(candidate.quote, source);
    if (result.valid && result.normalizedQuote) {
      accepted.push({ ...candidate, normalizedQuote: result.normalizedQuote });
    } else {
      rejected.push({ ...candidate, reason: result.reason ?? "Quote could not be verified." });
    }
  }

  return { accepted, rejected };
}
