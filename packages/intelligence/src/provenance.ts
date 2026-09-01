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
  event?: {
    title?: string;
    description?: string | null;
    eventDate?: string | null;
  };
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
    const quotes = [params.sourceQuotes[index], ...params.sourceQuotes].filter(
      (value): value is string => Boolean(value?.trim()),
    );
    const supporting =
      findSupportingSpan({
        chunkText: chunk.content,
        quotes,
        title: params.event?.title,
        description: params.event?.description,
        eventDate: params.event?.eventDate ?? null,
      }) ?? fallbackChunkSpan(chunk.content);
    if (!supporting) return;
    out.push({
      organizationId: params.organizationId,
      matterId: params.matterId,
      documentId: chunk.documentId,
      documentVersionId: chunk.documentVersionId,
      chunkId: chunk.chunkId,
      page: chunk.page,
      segmentRef: chunk.segmentRef,
      supportingText: supporting,
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

function fallbackChunkSpan(chunkText: string): string | null {
  const folded = chunkText.replace(/\s+/g, " ").trim();
  if (folded.length < 12) return null;
  if (/^synth\s*-\s*fictional test document/i.test(folded)) return null;
  return folded.slice(0, 400);
}

export function findSupportingSpan(params: {
  chunkText: string;
  quotes: string[];
  title?: string;
  description?: string | null;
  eventDate?: string | null;
}): string | null {
  const text = params.chunkText;
  if (!text.trim()) return null;
  const foldedText = text.replace(/\s+/g, " ").trim();
  for (const quote of params.quotes) {
    const trimmed = quote.trim();
    if (trimmed.length < 8) continue;
    const needle = trimmed.slice(0, Math.min(trimmed.length, 120));
    const foldedNeedle = needle.replace(/\s+/g, " ").trim();
    if (
      text.includes(needle) ||
      text.toLowerCase().includes(needle.toLowerCase()) ||
      foldedText.toLowerCase().includes(foldedNeedle.toLowerCase())
    ) {
      return trimmed.slice(0, 400);
    }
  }
  const iso = params.eventDate?.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1] ?? null;
  if (iso) {
    const index = text.indexOf(iso);
    if (index >= 0) {
      return text
        .slice(Math.max(0, index - 80), index + iso.length + 80)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 400);
    }
  }
  const tokens = tokenize(`${params.title ?? ""} ${params.description ?? ""}`);
  const words = [...tokens].filter((token) => token.length >= 4).slice(0, 4);
  if (words.length === 0) return null;
  const lower = text.toLowerCase();
  let hit = -1;
  for (const word of words) {
    hit = lower.indexOf(word);
    if (hit >= 0) break;
  }
  if (hit < 0) return null;
  const span = text.slice(Math.max(0, hit - 60), hit + 160).replace(/\s+/g, " ").trim();
  if (span.length < 12) return null;
  if (/^synth\s*-\s*fictional test document/i.test(span) && !iso) return null;
  return span.slice(0, 400);
}
