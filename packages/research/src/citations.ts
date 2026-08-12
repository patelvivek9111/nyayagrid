import { or, sql } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import { legalAuthorities } from "@nyayagrid/database";

export type CitationConfidence = "high" | "low" | "unknown";

export type CitationKind = "case" | "statute" | "regulation" | "constitution" | "rule" | "other";

export type ParsedCitation = {
  /** Always the citation text exactly as it appeared in the source. */
  raw: string;
  /** Canonical form, or null when normalization would be a guess. */
  normalized: string | null;
  reporter?: string | null;
  volume?: number | null;
  page?: number | null;
  section?: string | null;
  type?: CitationKind | null;
  pinpoint?: string | null;
  parser?: string | null;
  confidence: CitationConfidence;
};

export interface CitationParser {
  readonly name: string;
  readonly type: CitationKind;
  /** Global regex used to locate candidate citations inside a body of text. */
  readonly pattern: RegExp;
  build(match: RegExpMatchArray): ParsedCitation | null;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeCitationWhitespace(raw: string): string {
  return collapseWhitespace(raw)
    .replace(/\s*§\s*/g, " § ")
    .replace(/\s+,/g, ",");
}

function toInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export class USReportsParser implements CitationParser {
  readonly name = "us-reports";
  readonly type: CitationKind = "case";
  readonly pattern = /\b(\d{1,3})\s+U\.?\s?S\.?\s+(\d{1,4})\b/g;

  build(match: RegExpMatchArray): ParsedCitation | null {
    const volume = toInt(match[1]);
    const page = toInt(match[2]);
    if (volume === null || page === null) return null;
    return {
      raw: match[0],
      normalized: `${volume} U.S. ${page}`,
      reporter: "U.S.",
      volume,
      page,
      type: "case",
      parser: this.name,
      confidence: "high",
    };
  }
}

export class FederalReporterParser implements CitationParser {
  readonly name = "federal-reporter";
  readonly type: CitationKind = "case";
  readonly pattern = /\b(\d{1,4})\s+F\.(\s?Supp\.)?(?:\s?(2d|3d|4th))?\s+(\d{1,4})\b/g;

  build(match: RegExpMatchArray): ParsedCitation | null {
    const volume = toInt(match[1]);
    const page = toInt(match[4]);
    if (volume === null || page === null) return null;
    const supplement = Boolean(match[2]);
    const series = match[3];
    const reporter = supplement
      ? `F. Supp.${series ? ` ${series}` : ""}`
      : `F.${series ? series : ""}`;
    return {
      raw: match[0],
      normalized: `${volume} ${reporter} ${page}`,
      reporter,
      volume,
      page,
      type: "case",
      parser: this.name,
      confidence: "high",
    };
  }
}

export class StatuteCitationParser implements CitationParser {
  readonly name = "statute";
  readonly type: CitationKind = "statute";
  // The section group never absorbs a trailing period, so "§ 100." yields section "100".
  readonly pattern =
    /\b(?:(\d{1,2})\s+U\.?\s?S\.?\s?C\.?|([A-Z][A-Za-z'’.\- ]{2,60}?Code))\s*§+\s*(\d[A-Za-z0-9\-]*(?:\.[A-Za-z0-9\-]+)*(?:\([^)\s]{1,6}\))*)/g;

  build(match: RegExpMatchArray): ParsedCitation | null {
    const section = match[3];
    if (!section) return null;
    const uscTitle = toInt(match[1]);
    if (uscTitle !== null) {
      return {
        raw: match[0],
        normalized: `${uscTitle} U.S.C. § ${section}`,
        reporter: "U.S.C.",
        volume: uscTitle,
        section,
        type: "statute",
        parser: this.name,
        confidence: "high",
      };
    }
    const code = match[2] ? collapseWhitespace(match[2]) : null;
    if (!code) return null;
    // Unknown code conventions: only whitespace is canonicalized, never the code name itself.
    return {
      raw: match[0],
      normalized: `${code} § ${section}`,
      reporter: code,
      section,
      type: "statute",
      parser: this.name,
      confidence: "low",
    };
  }
}

export class RegulatoryCitationParser implements CitationParser {
  readonly name = "regulation";
  readonly type: CitationKind = "regulation";
  readonly pattern = /\b(\d{1,2})\s+C\.?\s?F\.?\s?R\.?\s*§*\s*(\d+(?:\.[0-9A-Za-z\-]+)*)/g;

  build(match: RegExpMatchArray): ParsedCitation | null {
    const title = toInt(match[1]);
    const section = match[2];
    if (title === null || !section) return null;
    return {
      raw: match[0],
      normalized: `${title} C.F.R. § ${section}`,
      reporter: "C.F.R.",
      volume: title,
      section,
      type: "regulation",
      parser: this.name,
      confidence: "high",
    };
  }
}

export const DEFAULT_CITATION_PARSERS: CitationParser[] = [
  new StatuteCitationParser(),
  new RegulatoryCitationParser(),
  new USReportsParser(),
  new FederalReporterParser(),
];

type CitationMatch = {
  citation: ParsedCitation;
  index: number;
  length: number;
};

const PINPOINT_PATTERN = /^\s*,?\s*at\s+(\d+(?:\s*[-–]\s*\d+)?)/;

function findMatches(text: string, parsers: CitationParser[]): CitationMatch[] {
  const matches: CitationMatch[] = [];
  for (const parser of parsers) {
    const pattern = new RegExp(parser.pattern.source, "g");
    let match = pattern.exec(text);
    while (match) {
      const built = parser.build(match);
      if (built && match.index !== undefined) {
        const pinpointMatch = PINPOINT_PATTERN.exec(text.slice(match.index + match[0].length));
        matches.push({
          citation: {
            ...built,
            pinpoint: pinpointMatch?.[1] ? collapseWhitespace(pinpointMatch[1]) : null,
          },
          index: match.index,
          length: match[0].length,
        });
      }
      if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
      match = pattern.exec(text);
    }
  }
  return matches.sort((a, b) => a.index - b.index || b.length - a.length);
}

function dropOverlaps(matches: CitationMatch[]): CitationMatch[] {
  const kept: CitationMatch[] = [];
  let cursor = -1;
  for (const match of matches) {
    if (match.index < cursor) continue;
    kept.push(match);
    cursor = match.index + match.length;
  }
  return kept;
}

/**
 * Parse a single citation string. Returns confidence "unknown" with normalized=null whenever the
 * input is ambiguous, so callers never store a confidently wrong canonical form.
 */
export function parseCitation(
  raw: string,
  parsers: CitationParser[] = DEFAULT_CITATION_PARSERS,
): ParsedCitation {
  const trimmed = raw.trim();
  const unresolved: ParsedCitation = {
    raw: trimmed,
    normalized: null,
    type: null,
    parser: null,
    confidence: "unknown",
  };
  if (!trimmed) return unresolved;

  for (const parser of parsers) {
    const anchored = new RegExp(`^(?:${parser.pattern.source})$`);
    const match = anchored.exec(trimmed);
    if (!match) continue;
    const built = parser.build(match);
    if (built) return { ...built, raw: trimmed };
  }

  const embedded = dropOverlaps(findMatches(trimmed, parsers));
  const distinct = new Map(embedded.map((m) => [m.citation.normalized ?? m.citation.raw, m]));
  if (distinct.size !== 1) return unresolved;
  const only = [...distinct.values()][0];
  if (!only) return unresolved;
  return { ...only.citation, raw: trimmed };
}

/** Extract every citation found in a body of authority text, preserving raw spans. */
export function extractCitationsFromText(
  text: string,
  parsers: CitationParser[] = DEFAULT_CITATION_PARSERS,
): ParsedCitation[] {
  const kept = dropOverlaps(findMatches(text, parsers));
  const deduped = new Map<string, ParsedCitation>();
  for (const match of kept) {
    const key = `${match.citation.normalized ?? match.citation.raw}|${match.citation.pinpoint ?? ""}`;
    if (!deduped.has(key)) deduped.set(key, match.citation);
  }
  return [...deduped.values()];
}

export type CitationResolution = {
  authorityId: string;
  matchedOn: "normalized_citation" | "citation";
};

/**
 * Resolve a citation to a corpus authority. Returns null when nothing matches or when more than
 * one authority matches, because guessing between candidates would misattribute authority.
 */
export async function resolveCitationAgainstCorpus(
  db: Database,
  citation: string | ParsedCitation,
): Promise<CitationResolution | null> {
  const parsed = typeof citation === "string" ? parseCitation(citation) : citation;
  const raw = normalizeCitationWhitespace(parsed.raw);
  if (!raw && !parsed.normalized) return null;

  const conditions: Array<ReturnType<typeof sql>> = [];
  if (parsed.normalized) {
    conditions.push(sql`${legalAuthorities.normalizedCitation} = ${parsed.normalized}`);
  }
  if (raw) {
    conditions.push(sql`${legalAuthorities.citation} = ${raw}`);
  }
  if (conditions.length === 0) return null;

  const rows = await db
    .select({
      id: legalAuthorities.id,
      normalizedCitation: legalAuthorities.normalizedCitation,
    })
    .from(legalAuthorities)
    .where(or(...conditions))
    .limit(2);

  if (rows.length !== 1) return null;
  const row = rows[0];
  if (!row) return null;
  return {
    authorityId: row.id,
    matchedOn:
      parsed.normalized && row.normalizedCitation === parsed.normalized
        ? "normalized_citation"
        : "citation",
  };
}
