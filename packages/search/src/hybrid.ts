import { sql } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import type { EmbeddingProvider } from "@nyayagrid/ai";
import { rankByQuestionOverlap } from "@nyayagrid/ai";

export type RetrievalScope = {
  organizationId: string;
  matterId: string;
  workspace: "professional" | "student" | "public";
  allowedDocumentIds?: string[];
};

export type RetrievalQuery = {
  text: string;
  scope: RetrievalScope;
  limit?: number;
};

export type RetrievalHit = {
  documentId: string;
  documentVersionId: string;
  chunkId: string;
  organizationId: string;
  matterId: string;
  score: number;
  quote: string;
  page?: number | null;
  segmentRef?: string | null;
};

export interface Retriever {
  readonly name: string;
  search(query: RetrievalQuery): Promise<RetrievalHit[]>;
}

export function assertHitsWithinScope(hits: RetrievalHit[], scope: RetrievalScope) {
  for (const hit of hits) {
    if (hit.organizationId !== scope.organizationId) {
      throw new Error("Retrieval hit leaked across organization boundary");
    }
    if (hit.matterId !== scope.matterId) {
      throw new Error("Retrieval hit leaked across matter boundary");
    }
  }
}

function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

export class PostgresHybridRetriever implements Retriever {
  readonly name = "postgres-hybrid";

  constructor(
    private readonly db: Database,
    private readonly embeddings: EmbeddingProvider,
  ) {}

  async search(query: RetrievalQuery): Promise<RetrievalHit[]> {
    if (!query.scope.organizationId || !query.scope.matterId) {
      throw new Error("organizationId and matterId are required before retrieval");
    }
    if (query.scope.workspace !== "professional") {
      throw new Error("Phase 2 retrieval is professional-matter scoped only");
    }

    const limit = query.limit ?? 8;
    const [embedding] = await this.embeddings.embed([query.text]);
    if (!embedding) return [];

    const vectorLiteral = toVectorLiteral(embedding);
    const ftsQuery = query.text
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 1)
      .map((t) => t.replace(/[^a-zA-Z0-9_-]/g, ""))
      .filter(Boolean)
      .join(" & ");

    type Row = {
      id: string;
      document_id: string;
      document_version_id: string;
      organization_id: string;
      matter_id: string;
      content: string;
      page_start: number | null;
      segment_ref: string | null;
      score: number;
    };

    const vectorRows = (await (this.db as unknown as { execute: (q: unknown) => Promise<Row[]> })
      .execute(sql`
      SELECT
        id,
        document_id,
        document_version_id,
        organization_id,
        matter_id,
        content,
        page_start,
        segment_ref,
        (1 - (embedding <=> ${vectorLiteral}::vector)) AS score
      FROM document_chunks
      WHERE organization_id = ${query.scope.organizationId}
        AND matter_id = ${query.scope.matterId}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vectorLiteral}::vector
      LIMIT ${limit}
    `)) as Row[];

    const ftsRows =
      ftsQuery.length > 0
        ? ((await (this.db as unknown as { execute: (q: unknown) => Promise<Row[]> }).execute(sql`
            SELECT
              id,
              document_id,
              document_version_id,
              organization_id,
              matter_id,
              content,
              page_start,
              segment_ref,
              ts_rank(to_tsvector('english', content), to_tsquery('english', ${ftsQuery})) AS score
            FROM document_chunks
            WHERE organization_id = ${query.scope.organizationId}
              AND matter_id = ${query.scope.matterId}
              AND to_tsvector('english', content) @@ to_tsquery('english', ${ftsQuery})
            ORDER BY score DESC
            LIMIT ${limit}
          `)) as Row[])
        : [];

    const merged = new Map<string, RetrievalHit>();
    const addRows = (rows: Row[], weight: number) => {
      for (const row of rows) {
        const existing = merged.get(row.id);
        const score = Number(row.score ?? 0) * weight;
        if (!existing || score > existing.score) {
          merged.set(row.id, {
            chunkId: row.id,
            documentId: row.document_id,
            documentVersionId: row.document_version_id,
            organizationId: row.organization_id,
            matterId: row.matter_id,
            score,
            quote: row.content,
            page: row.page_start,
            segmentRef: row.segment_ref,
          });
        }
      }
    };

    addRows(Array.from(vectorRows as Iterable<Row>), 1);
    addRows(Array.from(ftsRows as Iterable<Row>), 1.1);

    const hits = rankByQuestionOverlap(
      query.text,
      [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit),
    );
    assertHitsWithinScope(hits, query.scope);
    return hits;
  }
}

/** In-memory retriever for unit tests without Postgres. */
export class InMemoryMatterRetriever implements Retriever {
  readonly name = "memory";
  constructor(private readonly chunks: RetrievalHit[]) {}

  async search(query: RetrievalQuery): Promise<RetrievalHit[]> {
    const hits = this.chunks.filter(
      (c) =>
        c.organizationId === query.scope.organizationId &&
        c.matterId === query.scope.matterId &&
        c.quote.toLowerCase().includes(query.text.toLowerCase().slice(0, 12)),
    );
    assertHitsWithinScope(hits, query.scope);
    return rankByQuestionOverlap(query.text, hits).slice(0, query.limit ?? 8);
  }
}
