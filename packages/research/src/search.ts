import { sql } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import type { EmbeddingProvider } from "@nyayagrid/ai";
import { extractCitationsFromText } from "./citations";
import type { AuthoritySearchFilters, AuthoritySearchHit } from "./provider";

type SqlFragment = ReturnType<typeof sql>;

export const AUTHORITY_CHUNK_TABLE = "legal_authority_chunks";

/** Tables that hold confidential matter content and must never appear in authority search. */
export const FORBIDDEN_MATTER_FIELDS = [
  "documentId",
  "documentVersionId",
  "matterId",
  "organizationId",
] as const;

export type AuthoritySearchOptions = {
  limit?: number;
  /** Include authorities whose ingestion has not completed. Off by default. */
  includeNonReady?: boolean;
  /** Include text from superseded authority versions. Off by default. */
  includeSupersededVersions?: boolean;
  /** Jurisdiction used for citation/title boosting only; filtering still uses filters.jurisdiction. */
  queryJurisdiction?: string | null;
  preferredStateCodes?: string[];
  preferredCircuitIds?: string[];
};

const VECTOR_WEIGHT = 1;
const FTS_WEIGHT = 1.1;
const EXACT_CITATION_BOOST = 0.75;
const TITLE_EXACT_BOOST = 0.35;
const TITLE_PARTIAL_BOOST = 0.15;
const CASE_NAME_COVERAGE_BOOST = 0.55;
const EXTRA_PARTY_PENALTY = 0.35;
const SNIPPET_CHARS = 320;

const TITLE_META_TOKENS = new Set([
  "fed",
  "cir",
  "app",
  "dist",
  "synth",
  "court",
  "appeals",
  "circuit",
  "supreme",
  "f3d",
  "f2d",
  "us",
  "sct",
  "code",
  "stat",
]);

const CASE_NAME_STOP = new Set([
  "what",
  "did",
  "does",
  "hold",
  "held",
  "about",
  "regarding",
  "under",
  "for",
  "the",
  "how",
]);

type ChunkRow = {
  chunk_id: string;
  authority_id: string;
  authority_version_id: string;
  content: string;
  opinion_part: string | null;
  section_ref: string | null;
  page_start: number | null;
  title: string;
  short_title: string | null;
  citation: string | null;
  normalized_citation: string | null;
  authority_type: string;
  jurisdiction: string | null;
  court: string | null;
  decision_date: string | Date | null;
  effective_date: string | Date | null;
  effective_from: string | Date | null;
  effective_to: string | Date | null;
  authority_state: string | null;
  court_id: string | null;
  federal_circuit: string | null;
  court_level: string | null;
  score: number | string | null;
};

function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

function toDateString(value: string | Date | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

function toTsQuery(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-zA-Z0-9_-]/g, ""))
    .filter((token) => token.length > 1)
    .join(" & ");
}

function queryTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3);
}

function partyTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !CASE_NAME_STOP.has(token) && !TITLE_META_TOKENS.has(token));
}

/** Distinctive party tokens from a "A v. B" style query, if present. */
export function caseNameQueryTokens(query: string): string[] {
  const parts = query.toLowerCase().split(/\sv\.?\s/);
  if (parts.length < 2) return [];
  const left = partyTokens(parts[0] ?? "").slice(-4);
  const rightClause = (parts[1] ?? "").split(/\b(?:hold|held|about|regarding|concerning)\b/)[0] ?? "";
  const right = partyTokens(rightClause).slice(0, 4);
  return [...left, ...right];
}

function titleIdentityBoost(title: string, lowerQuery: string, tokens: string[]): number {
  const lowerTitle = title.toLowerCase();
  if (lowerQuery.includes(lowerTitle)) return TITLE_EXACT_BOOST;
  const titleTokens = queryTokens(lowerTitle);
  const overlap = titleTokens.filter((token) => tokens.includes(token)).length;
  let boost = 0;
  if (titleTokens.length > 0 && overlap >= Math.min(2, titleTokens.length)) {
    boost += TITLE_PARTIAL_BOOST * (overlap / titleTokens.length);
  }
  const caseTokens = caseNameQueryTokens(lowerQuery);
  if (caseTokens.length >= 2) {
    const titleParty = new Set(partyTokens(lowerTitle).filter((token) => !/^\d+$/.test(token)));
    const covered = caseTokens.filter((token) => titleParty.has(token)).length;
    boost += CASE_NAME_COVERAGE_BOOST * (covered / caseTokens.length);
    const extra = [...titleParty].filter(
      (token) => !caseTokens.includes(token) && !/^\d+$/.test(token) && token.length > 3,
    );
    boost -= EXTRA_PARTY_PENALTY * extra.length;
  }
  return boost;
}

/** Exported for unit tests: identity ranking without a database. */
export function authorityIdentityBoost(params: {
  title: string;
  shortTitle?: string | null;
  citation?: string | null;
  normalizedCitation?: string | null;
  query: string;
}): number {
  const lowerQuery = params.query.toLowerCase();
  const tokens = queryTokens(params.query);
  const queryCitations = new Set(
    extractCitationsFromText(params.query)
      .map((citation) => citation.normalized)
      .filter((value): value is string => Boolean(value)),
  );
  let boost = 0;
  if (params.normalizedCitation && queryCitations.has(params.normalizedCitation)) {
    boost += EXACT_CITATION_BOOST;
  } else if (params.citation && lowerQuery.includes(params.citation.toLowerCase())) {
    boost += EXACT_CITATION_BOOST;
  }
  const titles = [params.title, params.shortTitle].filter((value): value is string => Boolean(value));
  let bestTitle = 0;
  for (const title of titles) {
    bestTitle = Math.max(bestTitle, titleIdentityBoost(title, lowerQuery, tokens));
  }
  return boost + bestTitle;
}

export function caseNameCoverage(title: string, query: string): number {
  const caseTokens = caseNameQueryTokens(query);
  if (caseTokens.length < 2) return 0;
  const titleParty = new Set(partyTokens(title).filter((token) => !/^\d+$/.test(token)));
  return caseTokens.filter((token) => titleParty.has(token)).length / caseTokens.length;
}

/**
 * When the query names A v. B and an exact party match is in the hit set,
 * drop weaker near-name competitors so they cannot occupy the citation list.
 */
export function suppressWeakerCaseNameHits<T extends { title: string }>(hits: T[], query: string): T[] {
  const caseTokens = caseNameQueryTokens(query);
  if (caseTokens.length < 2 || hits.length === 0) return hits;
  const scores = hits.map((hit) => caseNameCoverage(hit.title, query));
  const best = Math.max(...scores);
  if (best < 1) return hits;
  return hits.filter((_, index) => scores[index] === best);
}

export function diversifyAuthorityHits<T extends { authorityId: string; score: number }>(
  hits: T[],
  limit: number,
): T[] {
  const sorted = [...hits].sort((a, b) => b.score - a.score);
  const first: T[] = [];
  const rest: T[] = [];
  const seen = new Set<string>();
  for (const hit of sorted) {
    if (!seen.has(hit.authorityId)) {
      seen.add(hit.authorityId);
      first.push(hit);
    } else {
      rest.push(hit);
    }
  }
  return [...first, ...rest].slice(0, limit);
}

function buildSnippet(content: string, tokens: string[]): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= SNIPPET_CHARS) return normalized;
  const lower = normalized.toLowerCase();
  const hitIndex = tokens
    .map((token) => lower.indexOf(token))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  if (hitIndex === undefined) return `${normalized.slice(0, SNIPPET_CHARS)}…`;
  const start = Math.max(0, hitIndex - Math.floor(SNIPPET_CHARS / 3));
  const end = Math.min(normalized.length, start + SNIPPET_CHARS);
  return `${start > 0 ? "…" : ""}${normalized.slice(start, end)}${end < normalized.length ? "…" : ""}`;
}

/**
 * Runtime guard: authority search results must never carry matter-scoped identifiers. A leak here
 * would mean confidential document chunks were mixed into the shared research corpus results.
 */
export function assertAuthorityHitsOnly(hits: AuthoritySearchHit[]) {
  for (const hit of hits) {
    const record = hit as unknown as Record<string, unknown>;
    for (const field of FORBIDDEN_MATTER_FIELDS) {
      if (record[field] !== undefined) {
        throw new Error(`Authority search result leaked matter-scoped field "${field}"`);
      }
    }
    if (!hit.authorityId || !hit.authorityVersionId || !hit.chunkId) {
      throw new Error("Authority search result is missing authority provenance");
    }
  }
}

/** Confirms every returned chunk id really belongs to the authority corpus table. */
export async function assertChunksBelongToAuthorityCorpus(db: Database, chunkIds: string[]) {
  if (chunkIds.length === 0) return;
  const rows = (await (db as unknown as { execute: (q: unknown) => Promise<{ id: string }[]> })
    .execute(sql`
      SELECT id FROM legal_authority_chunks
      WHERE id IN (${sql.join(
        chunkIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
    `)) as { id: string }[];
  const found = new Set(Array.from(rows).map((row) => row.id));
  for (const chunkId of chunkIds) {
    if (!found.has(chunkId)) {
      throw new Error(`Search returned chunk ${chunkId} that is not a legal authority chunk`);
    }
  }
}

/**
 * Hybrid full-text + pgvector retrieval over the legal authority corpus.
 *
 * This retriever only ever reads legal_authority_chunks / legal_authorities; matter document
 * chunks are a separate confidential store and are never searched here. By default it returns
 * text from current authority versions only, so superseded language cannot surface as good law.
 */
export class AuthorityHybridRetriever {
  readonly name = "authority-hybrid";

  constructor(
    private readonly db: Database,
    private readonly embeddings: EmbeddingProvider,
  ) {}

  private buildFilterConditions(
    filters: AuthoritySearchFilters,
    options: AuthoritySearchOptions,
  ): SqlFragment[] {
    const conditions: SqlFragment[] = [];
    if (!options.includeNonReady) {
      conditions.push(sql`a.ingestion_status = 'ready'`);
    }
    if (!options.includeSupersededVersions) {
      conditions.push(sql`v.valid_to IS NULL`);
    }
    if (filters.jurisdiction) {
      conditions.push(sql`lower(a.jurisdiction) = lower(${filters.jurisdiction})`);
    }
    if (filters.court) {
      conditions.push(sql`lower(a.court) = lower(${filters.court})`);
    }
    if (filters.authorityType) {
      conditions.push(sql`a.authority_type::text = ${filters.authorityType}`);
    }
    if (filters.dateFrom) {
      conditions.push(sql`a.decision_date >= ${filters.dateFrom}::date`);
    }
    if (filters.dateTo) {
      conditions.push(sql`a.decision_date <= ${filters.dateTo}::date`);
    }
    if (filters.sourceProvider) {
      conditions.push(sql`a.source_provider = ${filters.sourceProvider}`);
    }
    if (filters.title) {
      conditions.push(sql`a.title ILIKE ${`%${filters.title}%`}`);
    }
    if (filters.citation) {
      const parsed = extractCitationsFromText(filters.citation)[0];
      const normalized = parsed?.normalized ?? null;
      conditions.push(
        normalized
          ? sql`(a.normalized_citation = ${normalized} OR a.citation ILIKE ${`%${filters.citation}%`})`
          : sql`a.citation ILIKE ${`%${filters.citation}%`}`,
      );
    }
    return conditions;
  }

  private static combine(conditions: SqlFragment[]): SqlFragment {
    if (conditions.length === 0) return sql`true`;
    return sql.join(conditions, sql` AND `);
  }

  async search(
    query: string,
    filters: AuthoritySearchFilters = {},
    options: AuthoritySearchOptions = {},
  ): Promise<AuthoritySearchHit[]> {
    const limit = options.limit ?? 10;
    const trimmed = query.trim();
    if (!trimmed) return [];

    const where = AuthorityHybridRetriever.combine(this.buildFilterConditions(filters, options));
    const selection = sql`
      c.id AS chunk_id,
      c.authority_id,
      c.authority_version_id,
      c.content,
      c.opinion_part,
      c.section_ref,
      c.page_start,
      a.title,
      a.short_title,
      a.citation,
      a.normalized_citation,
      a.authority_type::text AS authority_type,
      a.jurisdiction,
      a.court,
      a.decision_date,
      a.effective_date,
      v.effective_from,
      v.effective_to,
      a.authority_state,
      a.court_id,
      a.federal_circuit,
      a.court_level
    `;

    const execute = (statement: unknown) =>
      (this.db as unknown as { execute: (q: unknown) => Promise<ChunkRow[]> }).execute(
        statement,
      ) as Promise<ChunkRow[]>;

    const [embedding] = await this.embeddings.embed([trimmed]);
    const vectorRows = embedding
      ? await execute(sql`
          SELECT ${selection},
            (1 - (c.embedding <=> ${toVectorLiteral(embedding)}::vector)) AS score
          FROM legal_authority_chunks c
          JOIN legal_authorities a ON a.id = c.authority_id
          JOIN legal_authority_versions v ON v.id = c.authority_version_id
          WHERE c.embedding IS NOT NULL AND ${where}
          ORDER BY c.embedding <=> ${toVectorLiteral(embedding)}::vector
          LIMIT ${limit * 3}
        `)
      : [];

    const ftsQuery = toTsQuery(trimmed);
    const ftsRows =
      ftsQuery.length > 0
        ? await execute(sql`
            SELECT ${selection},
              ts_rank(to_tsvector('english', c.content), to_tsquery('english', ${ftsQuery})) AS score
            FROM legal_authority_chunks c
            JOIN legal_authorities a ON a.id = c.authority_id
            JOIN legal_authority_versions v ON v.id = c.authority_version_id
            WHERE to_tsvector('english', c.content) @@ to_tsquery('english', ${ftsQuery})
              AND ${where}
            ORDER BY score DESC
            LIMIT ${limit * 3}
          `)
        : [];

    const tokens = queryTokens(trimmed);
    const queryCitations = new Set(
      extractCitationsFromText(trimmed)
        .map((citation) => citation.normalized)
        .filter((value): value is string => Boolean(value)),
    );
    const lowerQuery = trimmed.toLowerCase();

    const merged = new Map<string, AuthoritySearchHit>();
    const addRows = (rows: ChunkRow[], weight: number) => {
      for (const row of Array.from(rows)) {
        const base = Number(row.score ?? 0) * weight;
        const score = base + this.boostFor(row, queryCitations, lowerQuery, tokens, options);
        const existing = merged.get(row.chunk_id);
        if (existing && existing.score >= score) continue;
        merged.set(row.chunk_id, {
          authorityId: row.authority_id,
          authorityVersionId: row.authority_version_id,
          chunkId: row.chunk_id,
          title: row.title,
          citation: row.citation,
          authorityType: row.authority_type,
          jurisdiction: row.jurisdiction,
          court: row.court,
          decisionDate: toDateString(row.decision_date),
          effectiveStart: toDateString(row.effective_from) ?? toDateString(row.effective_date),
          effectiveEnd: toDateString(row.effective_to),
          courtId: row.court_id,
          authorityState: row.authority_state,
          federalCircuit: row.federal_circuit,
          courtLevel: row.court_level,
          score,
          snippet: buildSnippet(row.content, tokens),
          sectionRef: row.section_ref,
          pageStart: row.page_start,
          opinionPart: row.opinion_part,
        });
      }
    };

    addRows(vectorRows, VECTOR_WEIGHT);
    addRows(ftsRows, FTS_WEIGHT);

    const hits = suppressWeakerCaseNameHits(
      diversifyAuthorityHits(
        [...merged.values()].sort((a, b) => b.score - a.score),
        limit,
      ),
      trimmed,
    );
    assertAuthorityHitsOnly(hits);
    await assertChunksBelongToAuthorityCorpus(
      this.db,
      hits.map((hit) => hit.chunkId),
    );
    return hits;
  }

  private boostFor(
    row: ChunkRow,
    queryCitations: Set<string>,
    lowerQuery: string,
    tokens: string[],
    options: AuthoritySearchOptions,
  ): number {
    let boost = 0;
    if (row.normalized_citation && queryCitations.has(row.normalized_citation)) {
      boost += EXACT_CITATION_BOOST;
    } else if (row.citation && lowerQuery.includes(row.citation.toLowerCase())) {
      boost += EXACT_CITATION_BOOST;
    }

    const titles = [row.title, row.short_title].filter((value): value is string => Boolean(value));
    let bestTitle = 0;
    for (const title of titles) {
      bestTitle = Math.max(bestTitle, titleIdentityBoost(title, lowerQuery, tokens));
    }
    boost += bestTitle;
    const preferredStates = new Set(
      (options.preferredStateCodes ?? []).map((code) => code.toUpperCase()),
    );
    if (preferredStates.size > 0) {
      const state = (row.authority_state ?? "").toUpperCase();
      if (state && preferredStates.has(state)) boost += 0.45;
      else if (state && !preferredStates.has(state) && row.court_level !== "scotus") boost -= 0.3;
    }
    const preferredCircuits = new Set(options.preferredCircuitIds ?? []);
    if (preferredCircuits.size > 0 && row.federal_circuit && preferredCircuits.has(row.federal_circuit)) {
      boost += 0.3;
    }
    if (row.court_level === "scotus") boost += 0.55;
    return boost;
  }
}
