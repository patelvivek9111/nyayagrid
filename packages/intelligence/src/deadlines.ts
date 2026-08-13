export type DeadlineSourceInput = {
  id: string;
  documentId: string;
  chunkId: string;
  page?: number | null;
  supportingText: string;
  documentTitle?: string | null;
};

export type DeadlineRecordInput = {
  id: string;
  title: string;
  description?: string | null;
  dueAt?: Date | string | null;
  dueAtEnd?: Date | string | null;
  datePrecision?: string | null;
  dateKind?: string | null;
  timezone?: string | null;
  status: string;
  origin?: string | null;
  uncertaintyNotes?: string | null;
};

export type PublicDeadline = {
  id: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  dueAtEnd: string | null;
  datePrecision: string;
  dateKind: "explicit" | "inferred";
  timezone: string | null;
  timezoneLabel: string;
  status: string;
  origin: string | null;
  uncertaintyNotes: string | null;
  sources: Array<{
    id: string;
    documentId: string;
    chunkId: string;
    page: number | null;
    supportingText: string;
    documentTitle: string;
  }>;
};

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/**
 * Attorney-facing deadline DTO. Returns null when provenance is missing so a deadline
 * is never shown without a source. dateKind and timezone are always explicit.
 */
export function presentDeadlineForAttorney(
  deadline: DeadlineRecordInput,
  sources: DeadlineSourceInput[],
): PublicDeadline | null {
  if (!Array.isArray(sources) || sources.length === 0) return null;
  const dateKind = deadline.dateKind === "inferred" ? "inferred" : "explicit";
  const timezone = deadline.timezone?.trim() ? deadline.timezone.trim() : null;
  return {
    id: deadline.id,
    title: deadline.title,
    description: deadline.description ?? null,
    dueAt: toIso(deadline.dueAt),
    dueAtEnd: toIso(deadline.dueAtEnd),
    datePrecision: deadline.datePrecision?.trim() || "unknown",
    dateKind,
    timezone,
    timezoneLabel: timezone ?? "timezone unknown",
    status: deadline.status,
    origin: deadline.origin ?? null,
    uncertaintyNotes: deadline.uncertaintyNotes ?? null,
    sources: sources.map((s) => ({
      id: s.id,
      documentId: s.documentId,
      chunkId: s.chunkId,
      page: s.page ?? null,
      supportingText: s.supportingText,
      documentTitle: s.documentTitle?.trim() || "Case document",
    })),
  };
}
