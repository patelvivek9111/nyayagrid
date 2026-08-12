import { and, eq, inArray, type Database, documentChunks } from "@nyayagrid/database";

export type ChunkProvenance = {
  chunkId: string;
  organizationId: string;
  matterId: string;
  documentId: string;
  documentVersionId: string;
  page: number | null;
  segmentRef: string | null;
  content: string;
};

export async function loadAuthorizedChunks(
  db: Database,
  params: {
    organizationId: string;
    matterId: string;
    chunkIds: string[];
  },
): Promise<Map<string, ChunkProvenance>> {
  const unique = [...new Set(params.chunkIds.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select()
    .from(documentChunks)
    .where(
      and(
        eq(documentChunks.organizationId, params.organizationId),
        eq(documentChunks.matterId, params.matterId),
        inArray(documentChunks.id, unique),
      ),
    );
  return new Map(
    rows.map((row) => [
      row.id,
      {
        chunkId: row.id,
        organizationId: row.organizationId,
        matterId: row.matterId,
        documentId: row.documentId,
        documentVersionId: row.documentVersionId,
        page: row.pageStart,
        segmentRef: row.segmentRef,
        content: row.content,
      },
    ]),
  );
}

export function resolveValidatedSources(params: {
  organizationId: string;
  matterId: string;
  sourceChunkIds: string[];
  sourceQuotes: string[];
  authorized: Map<string, ChunkProvenance>;
}): Array<{
  organizationId: string;
  matterId: string;
  documentId: string;
  documentVersionId: string;
  chunkId: string;
  page: number | null;
  segmentRef: string | null;
  supportingText: string;
}> {
  const out: Array<{
    organizationId: string;
    matterId: string;
    documentId: string;
    documentVersionId: string;
    chunkId: string;
    page: number | null;
    segmentRef: string | null;
    supportingText: string;
  }> = [];

  params.sourceChunkIds.forEach((chunkId, index) => {
    const chunk = params.authorized.get(chunkId);
    if (!chunk) return;
    if (chunk.organizationId !== params.organizationId || chunk.matterId !== params.matterId) {
      return;
    }
    const quote = params.sourceQuotes[index]?.trim() || chunk.content.slice(0, 400);
    out.push({
      organizationId: params.organizationId,
      matterId: params.matterId,
      documentId: chunk.documentId,
      documentVersionId: chunk.documentVersionId,
      chunkId: chunk.chunkId,
      page: chunk.page,
      segmentRef: chunk.segmentRef,
      supportingText: quote,
    });
  });

  // Deduplicate by chunkId while retaining first supporting text.
  const seen = new Set<string>();
  return out.filter((s) => {
    if (seen.has(s.chunkId)) return false;
    seen.add(s.chunkId);
    return true;
  });
}

export function parseOptionalDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

export function normalizeEntityName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
