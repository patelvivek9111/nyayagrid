import { sql } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import type { EmbeddingProvider } from "@nyayagrid/ai";
import {
  assertStudentHitsOwnedBy,
  assertStudentQueryIsIsolated,
  type StudentChunkHit,
} from "./isolation";

/**
 * Hybrid retrieval over a student's own uploaded case text.
 *
 * The FROM/JOIN skeleton is a module constant so the isolation guard can inspect exactly what will
 * be queried before anything is sent to Postgres. Only `student_case_chunks` and `student_cases`
 * appear here: matter document chunks live in a different store that this workspace never reads.
 */
const STUDENT_CHUNK_FROM = `
  FROM student_case_chunks c
  JOIN student_cases k ON k.id = c.case_id
`;

const STUDENT_CHUNK_COLUMNS = `
  c.id AS chunk_id,
  c.case_id,
  c.case_version_id,
  c.user_id,
  c.content,
  c.page_start,
  c.page_end,
  c.segment_ref,
  c.opinion_part
`;

const VECTOR_WEIGHT = 1;
const FTS_WEIGHT = 1.1;

type ChunkRow = {
  chunk_id: string;
  case_id: string;
  case_version_id: string;
  user_id: string;
  content: string;
  page_start: number | null;
  page_end: number | null;
  segment_ref: string | null;
  opinion_part: string | null;
  score: number | string | null;
};

function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

function toTsQuery(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-zA-Z0-9_-]/g, ""))
    .filter((token) => token.length > 1)
    .join(" & ");
}

function toOpinionPart(value: string | null): "majority" | "concurrence" | "dissent" | null {
  return value === "majority" || value === "concurrence" || value === "dissent" ? value : null;
}

export type SearchStudentCaseChunksParams = {
  db: Database;
  userId: string;
  query: string;
  /** Restrict to one uploaded case. Omitted means "all cases this user owns". */
  caseId?: string | null;
  /** Restrict to a single stored version; defaults to every version of the matching cases. */
  caseVersionId?: string | null;
  embeddings: EmbeddingProvider;
  limit?: number;
};

/**
 * Search a student's uploaded case passages. Both retrieval passes filter on `c.user_id`, and the
 * results are re-checked against the requesting user before they are returned.
 */
export async function searchStudentCaseChunks(
  params: SearchStudentCaseChunksParams,
): Promise<StudentChunkHit[]> {
  if (!params.userId) throw new Error("userId is required before student retrieval");
  const trimmed = params.query.trim();
  if (!trimmed) return [];

  assertStudentQueryIsIsolated("student_case_chunks_search", STUDENT_CHUNK_FROM);
  assertStudentQueryIsIsolated("student_case_chunks_columns", STUDENT_CHUNK_COLUMNS);

  const limit = params.limit ?? 8;
  const scope = sql`c.user_id = ${params.userId}::uuid AND k.user_id = ${params.userId}::uuid`;
  const caseFilter = params.caseId ? sql` AND c.case_id = ${params.caseId}::uuid` : sql``;
  const versionFilter = params.caseVersionId
    ? sql` AND c.case_version_id = ${params.caseVersionId}::uuid`
    : sql``;

  const execute = (statement: unknown) =>
    (params.db as unknown as { execute: (q: unknown) => Promise<ChunkRow[]> }).execute(
      statement,
    ) as Promise<ChunkRow[]>;

  const [embedding] = await params.embeddings.embed([trimmed]);
  const vectorRows = embedding
    ? await execute(sql`
        SELECT ${sql.raw(STUDENT_CHUNK_COLUMNS)},
          (1 - (c.embedding <=> ${toVectorLiteral(embedding)}::vector)) AS score
        ${sql.raw(STUDENT_CHUNK_FROM)}
        WHERE ${scope}${caseFilter}${versionFilter}
          AND c.embedding IS NOT NULL
        ORDER BY c.embedding <=> ${toVectorLiteral(embedding)}::vector
        LIMIT ${limit * 3}
      `)
    : [];

  const ftsQuery = toTsQuery(trimmed);
  const ftsRows =
    ftsQuery.length > 0
      ? await execute(sql`
          SELECT ${sql.raw(STUDENT_CHUNK_COLUMNS)},
            ts_rank(to_tsvector('english', c.content), to_tsquery('english', ${ftsQuery})) AS score
          ${sql.raw(STUDENT_CHUNK_FROM)}
          WHERE ${scope}${caseFilter}${versionFilter}
            AND to_tsvector('english', c.content) @@ to_tsquery('english', ${ftsQuery})
          ORDER BY score DESC
          LIMIT ${limit * 3}
        `)
      : [];

  const merged = new Map<string, StudentChunkHit>();
  const addRows = (rows: ChunkRow[], weight: number) => {
    for (const row of Array.from(rows)) {
      const score = Number(row.score ?? 0) * weight;
      const existing = merged.get(row.chunk_id);
      if (existing && existing.score >= score) continue;
      merged.set(row.chunk_id, {
        chunkId: row.chunk_id,
        caseId: row.case_id,
        caseVersionId: row.case_version_id,
        userId: row.user_id,
        content: row.content,
        score,
        pageStart: row.page_start,
        pageEnd: row.page_end,
        segmentRef: row.segment_ref,
        opinionPart: toOpinionPart(row.opinion_part),
      });
    }
  };

  addRows(vectorRows, VECTOR_WEIGHT);
  addRows(ftsRows, FTS_WEIGHT);

  const hits = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  assertStudentHitsOwnedBy(hits, params.userId);
  return hits;
}
