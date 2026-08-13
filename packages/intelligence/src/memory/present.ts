import { attorneyBadgeKind, isVerifiedReviewStatus } from "../review-status";

export type MemorySourceInput = {
  id: string;
  documentId: string;
  chunkId: string;
  page?: number | null;
  supportingText: string;
  documentTitle?: string | null;
};

export type MemoryRelatedPerson = { id: string; displayName: string };
export type MemoryRelatedEvent = { id: string; title: string };

export type PublicMemory = {
  id: string;
  memoryType: string;
  title: string;
  content: string;
  status: string;
  origin: string | null;
  importance: string;
  confidence: string | null;
  sourceType: string | null;
  rationale: string | null;
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
  badge: "verified" | "suggested" | "historical";
  sources: Array<{
    id: string;
    documentId: string;
    chunkId: string;
    page: number | null;
    supportingText: string;
    documentTitle: string;
  }>;
  relatedPeople: MemoryRelatedPerson[];
  relatedEvents: MemoryRelatedEvent[];
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

export function chunkIdsFromSourceReference(
  sourceReference: Record<string, unknown> | null | undefined,
) {
  if (!sourceReference) return [] as string[];
  return [
    ...asStringArray(sourceReference.chunkIds),
    ...asStringArray(sourceReference.sourceChunkIds),
  ];
}

export function rationaleFromSourceReference(
  sourceReference: Record<string, unknown> | null | undefined,
) {
  const value = sourceReference?.rationale;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Attorney-facing Memory DTO. Proposed entries always get the suggested badge — never verified.
 */
export function presentMatterMemory(params: {
  id: string;
  memoryType: string;
  title: string;
  content: string;
  status: string;
  origin?: string | null;
  importance: string;
  confidence?: string | null;
  sourceType?: string | null;
  sourceReference?: Record<string, unknown> | null;
  supersededBy?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  sources?: MemorySourceInput[];
  relatedPeople?: MemoryRelatedPerson[];
  relatedEvents?: MemoryRelatedEvent[];
}): PublicMemory {
  const createdAt =
    params.createdAt instanceof Date ? params.createdAt.toISOString() : params.createdAt;
  const updatedAt =
    params.updatedAt instanceof Date ? params.updatedAt.toISOString() : params.updatedAt;
  return {
    id: params.id,
    memoryType: params.memoryType,
    title: params.title,
    content: params.content,
    status: params.status,
    origin: params.origin ?? null,
    importance: params.importance,
    confidence: params.confidence ?? null,
    sourceType: params.sourceType ?? null,
    rationale: rationaleFromSourceReference(params.sourceReference),
    supersededBy: params.supersededBy ?? null,
    createdAt,
    updatedAt,
    badge: attorneyBadgeKind(params.status),
    sources: (params.sources ?? []).map((s) => ({
      id: s.id,
      documentId: s.documentId,
      chunkId: s.chunkId,
      page: s.page ?? null,
      supportingText: s.supportingText,
      documentTitle: s.documentTitle?.trim() || "Case document",
    })),
    relatedPeople: params.relatedPeople ?? [],
    relatedEvents: params.relatedEvents ?? [],
  };
}

export function matchRelatedByName<T extends { id: string }>(
  haystack: string,
  candidates: T[],
  nameOf: (item: T) => string,
): T[] {
  const hay = haystack.toLowerCase();
  return candidates.filter((item) => {
    const name = nameOf(item).trim();
    return name.length >= 3 && hay.includes(name.toLowerCase());
  });
}
