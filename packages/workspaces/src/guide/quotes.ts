/**
 * Standalone quote verification for Guide. Deliberately duplicated (not imported from
 * @nyayagrid/research) so this package never depends on the professional-research stack — Guide
 * stays isolated end to end, including its dependency graph.
 */
export type QuoteValidation = {
  valid: boolean;
  normalizedQuote?: string;
  reason?: string;
};

const MIN_MEANINGFUL_CHARS = 8;
const MIN_MEANINGFUL_WORDS = 2;

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

/** Last line of defense against fabricated quotes: only typography/whitespace are normalized. */
export function validateQuoteAgainstText(quote: string, sourceText: string): QuoteValidation {
  const candidate = stripQuotePackaging(normalizeQuoteText(quote ?? ""));
  const source = normalizeQuoteText(sourceText ?? "");

  if (!candidate) return { valid: false, reason: "Quote is empty." };
  if (!source) return { valid: false, reason: "Source text is empty; nothing can be verified." };
  const wordCount = candidate.split(" ").filter(Boolean).length;
  if (candidate.length < MIN_MEANINGFUL_CHARS || wordCount < MIN_MEANINGFUL_WORDS) {
    return { valid: false, reason: "Quote is too short to verify as meaningful source content." };
  }
  if (!source.includes(candidate)) {
    return { valid: false, reason: "Quote does not appear verbatim in the cited chunk text." };
  }
  return { valid: true, normalizedQuote: candidate };
}
