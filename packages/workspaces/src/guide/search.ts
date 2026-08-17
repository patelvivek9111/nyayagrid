import { sql } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import type { EmbeddingProvider } from "@nyayagrid/ai";

export const GUIDE_CHUNK_TABLE = "guide_document_chunks";
export const GUIDE_DOCUMENT_TABLE = "guide_documents";

/**
 * The only two tables a Guide chunk search query is ever allowed to name. Nothing that holds
 * professional/confidential data (matters, documents, document_chunks, student_case_*) may appear
 * here — see the isolation unit test in search.test.ts, which scans real generated query text for
 * these identifiers using word-boundary matching (so "guide_document_chunks" never false-positives
 * against the forbidden "document_chunks").
 */
export const GUIDE_SEARCH_ALLOWED_TABLES = [GUIDE_CHUNK_TABLE, GUIDE_DOCUMENT_TABLE] as const;

export const FORBIDDEN_PROFESSIONAL_TABLE_NAMES = [
  "matters",
  "matter_members",
  "documents",
  "document_chunks",
  "document_versions",
  "matter_facts",
  "matter_entities",
  "student_case_documents",
  "student_cases",
  "student_case_chunks",
] as const;

/**
 * Pure, DB-free description of the SQL structure the retriever below issues. Kept as plain string
 * templates (not drizzle `sql` objects) specifically so isolation can be unit tested without a
 * database connection: we scan this literal text for forbidden table identifiers.
 */
export function buildGuideChunkSearchSqlTemplates(): { vectorSql: string; ftsSql: string } {
  const vectorSql = `
    SELECT c.id AS chunk_id, c.document_id, c.document_version_id, c.content,
           c.page_start, c.page_end, c.segment_ref,
           (1 - (c.embedding <=> $embedding::vector)) AS score
    FROM ${GUIDE_CHUNK_TABLE} c
    JOIN ${GUIDE_DOCUMENT_TABLE} d ON d.id = c.document_id
    WHERE c.user_id = $userId AND c.embedding IS NOT NULL $documentFilter
    ORDER BY c.embedding <=> $embedding::vector
    LIMIT $limit
  `;
  const ftsSql = `
    SELECT c.id AS chunk_id, c.document_id, c.document_version_id, c.content,
           c.page_start, c.page_end, c.segment_ref,
           ts_rank(to_tsvector('english', c.content), to_tsquery('english', $ftsQuery)) AS score
    FROM ${GUIDE_CHUNK_TABLE} c
    JOIN ${GUIDE_DOCUMENT_TABLE} d ON d.id = c.document_id
    WHERE c.user_id = $userId
      AND to_tsvector('english', c.content) @@ to_tsquery('english', $ftsQuery) $documentFilter
    ORDER BY score DESC
    LIMIT $limit
  `;
  return { vectorSql, ftsSql };
}

/** Throws if any SQL template references a table outside GUIDE_SEARCH_ALLOWED_TABLES. */
export function assertSqlTemplatesAreIsolated(templates: string[]): void {
  for (const template of templates) {
    for (const forbidden of FORBIDDEN_PROFESSIONAL_TABLE_NAMES) {
      const pattern = new RegExp(`\\b${forbidden}\\b`, "i");
      if (pattern.test(template)) {
        throw new Error(
          `Guide search SQL template references forbidden professional table "${forbidden}"`,
        );
      }
    }
  }
}

export type GuideChunkSearchHit = {
  chunkId: string;
  documentId: string;
  documentVersionId: string;
  score: number;
  snippet: string;
  pageStart?: number | null;
  pageEnd?: number | null;
  segmentRef?: string | null;
};

type ChunkRow = {
  chunk_id: string;
  document_id: string;
  document_version_id: string;
  content: string;
  page_start: number | null;
  page_end: number | null;
  segment_ref: string | null;
  score: number | string | null;
};

function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

const SNIPPET_CHARS = 320;

function buildSnippet(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= SNIPPET_CHARS) return normalized;
  return `${normalized.slice(0, SNIPPET_CHARS)}…`;
}

function toTsQuery(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-zA-Z0-9_-]/g, ""))
    .filter((token) => token.length > 1)
    .join(" & ");
}

/**
 * Runtime guard mirroring the legal-authority retriever's runtime check: every hit's chunkId must
 * really exist in guide_document_chunks and belong to the requesting user. This is defense in
 * depth on top of the WHERE clause — a leak here would mean the query itself had a bug.
 */
export async function assertChunksBelongToUser(
  db: Database,
  userId: string,
  chunkIds: string[],
): Promise<void> {
  if (chunkIds.length === 0) return;
  const rows = (await (db as unknown as { execute: (q: unknown) => Promise<{ id: string }[]> })
    .execute(sql`
      SELECT id FROM guide_document_chunks
      WHERE user_id = ${userId}::uuid AND id IN (${sql.join(
        chunkIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
    `)) as { id: string }[];
  const found = new Set(Array.from(rows).map((row) => row.id));
  for (const chunkId of chunkIds) {
    if (!found.has(chunkId)) {
      throw new Error(
        `Guide search returned chunk ${chunkId} that does not belong to user ${userId}`,
      );
    }
  }
}

/**
 * Hybrid full-text + pgvector retrieval scoped to a single user's own guide_document_chunks.
 * Never touches document_chunks (professional), matters, or student_case_* tables — see
 * GUIDE_SEARCH_ALLOWED_TABLES above.
 */
export class GuideDocumentHybridRetriever {
  readonly name = "guide-document-hybrid";

  constructor(
    private readonly db: Database,
    private readonly embeddings: EmbeddingProvider,
  ) {}

  async search(
    userId: string,
    query: string,
    options: { documentId?: string | null; limit?: number } = {},
  ): Promise<GuideChunkSearchHit[]> {
    const limit = options.limit ?? 8;
    const trimmed = query.trim();
    if (!trimmed) return [];

    const documentFilter = options.documentId
      ? sql`AND c.document_id = ${options.documentId}::uuid`
      : sql``;

    const execute = (statement: unknown) =>
      (this.db as unknown as { execute: (q: unknown) => Promise<ChunkRow[]> }).execute(
        statement,
      ) as Promise<ChunkRow[]>;

    const [embedding] = await this.embeddings.embed([trimmed]);
    const vectorRows = embedding
      ? await execute(sql`
          SELECT c.id AS chunk_id, c.document_id, c.document_version_id, c.content,
                 c.page_start, c.page_end, c.segment_ref,
                 (1 - (c.embedding <=> ${toVectorLiteral(embedding)}::vector)) AS score
          FROM guide_document_chunks c
          JOIN guide_documents d ON d.id = c.document_id
          WHERE c.user_id = ${userId}::uuid AND c.embedding IS NOT NULL ${documentFilter}
          ORDER BY c.embedding <=> ${toVectorLiteral(embedding)}::vector
          LIMIT ${limit * 3}
        `)
      : [];

    const ftsQuery = toTsQuery(trimmed);
    const ftsRows =
      ftsQuery.length > 0
        ? await execute(sql`
            SELECT c.id AS chunk_id, c.document_id, c.document_version_id, c.content,
                   c.page_start, c.page_end, c.segment_ref,
                   ts_rank(to_tsvector('english', c.content), to_tsquery('english', ${ftsQuery})) AS score
            FROM guide_document_chunks c
            JOIN guide_documents d ON d.id = c.document_id
            WHERE c.user_id = ${userId}::uuid
              AND to_tsvector('english', c.content) @@ to_tsquery('english', ${ftsQuery})
              ${documentFilter}
            ORDER BY score DESC
            LIMIT ${limit * 3}
          `)
        : [];

    const merged = new Map<string, GuideChunkSearchHit>();
    const addRows = (rows: ChunkRow[], weight: number) => {
      for (const row of Array.from(rows)) {
        const score = Number(row.score ?? 0) * weight;
        const existing = merged.get(row.chunk_id);
        if (existing && existing.score >= score) continue;
        merged.set(row.chunk_id, {
          chunkId: row.chunk_id,
          documentId: row.document_id,
          documentVersionId: row.document_version_id,
          score,
          snippet: buildSnippet(row.content),
          pageStart: row.page_start,
          pageEnd: row.page_end,
          segmentRef: row.segment_ref,
        });
      }
    };
    addRows(vectorRows, 1);
    addRows(ftsRows, 1.1);

    const hits = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
    await assertChunksBelongToUser(
      this.db,
      userId,
      hits.map((hit) => hit.chunkId),
    );
    return hits;
  }
}
