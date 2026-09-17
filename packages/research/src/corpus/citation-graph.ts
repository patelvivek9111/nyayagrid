/**
 * Citation graph edge builder from authority text.
 * Edges record citation links only — treatment polarity is handled separately.
 */

import { extractCitationsFromText, type ParsedCitation } from "../citations";

export type CitationEdge = {
  fromAuthorityId: string;
  /** Resolved corpus authority id when resolveNormalizedCitation returns a match. */
  toAuthorityId: string | null;
  rawCitation: string;
  normalizedCitation: string | null;
  citationType: ParsedCitation["type"];
  pinpoint: string | null;
};

export function buildCitationEdgesFromText(params: {
  fromAuthorityId: string;
  text: string;
  resolveNormalizedCitation?: (normalized: string) => string | null;
}): CitationEdge[] {
  const citations = extractCitationsFromText(params.text);
  const edges: CitationEdge[] = [];
  const seen = new Set<string>();

  for (const citation of citations) {
    const normalized = citation.normalized;
    const key = `${normalized ?? citation.raw}|${citation.pinpoint ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let toAuthorityId: string | null = null;
    if (normalized && params.resolveNormalizedCitation) {
      toAuthorityId = params.resolveNormalizedCitation(normalized);
    }

    edges.push({
      fromAuthorityId: params.fromAuthorityId,
      toAuthorityId,
      rawCitation: citation.raw,
      normalizedCitation: normalized,
      citationType: citation.type,
      pinpoint: citation.pinpoint ?? null,
    });
  }

  return edges;
}
