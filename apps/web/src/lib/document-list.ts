/**
 * Case Documents list findability helpers.
 * Filename/title metadata only — not content, vector, or Ask search.
 */

export const DOCUMENT_SEARCH_QUERY_MAX = 100;

export type DocumentListStatusFilter = "ready" | "processing" | "attention";
export type DocumentListSort = "newest" | "oldest" | "name_asc" | "name_desc";

export const READY_PROCESSING_STATES = ["ready"] as const;

export const IN_FLIGHT_PROCESSING_STATES = [
  "uploaded",
  "awaiting_malware_scan",
  "unscanned_development",
  "scan_clean",
  "extracting_text",
  "chunking",
  "embedding",
  "indexed",
] as const;

export const ATTENTION_PROCESSING_STATES = [
  "scan_blocked",
  "quarantined",
  "malware_scan_failed",
  "extraction_failed",
  "failed",
  "requires_ocr",
] as const;

export function normalizeDocumentSearchQuery(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, DOCUMENT_SEARCH_QUERY_MAX);
}

/** Escape LIKE/ILIKE wildcards so user input is literal, not a pattern. */
export function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function ilikeContainsPattern(normalizedQuery: string): string | null {
  const q = normalizeDocumentSearchQuery(normalizedQuery);
  if (!q) return null;
  return `%${escapeIlikePattern(q)}%`;
}

export function processingStatesForFilter(
  filter: DocumentListStatusFilter | null | undefined,
): readonly string[] | null {
  if (filter === "ready") return READY_PROCESSING_STATES;
  if (filter === "processing") return IN_FLIGHT_PROCESSING_STATES;
  if (filter === "attention") return ATTENTION_PROCESSING_STATES;
  return null;
}

export function parseDocumentListStatus(
  raw: string | null | undefined,
): DocumentListStatusFilter | null {
  if (raw === "ready" || raw === "processing" || raw === "attention") return raw;
  return null;
}

export function parseDocumentListSort(raw: string | null | undefined): DocumentListSort {
  if (raw === "oldest" || raw === "name_asc" || raw === "name_desc") return raw;
  return "newest";
}

export function documentMatchesNameQuery(
  rawQuery: string,
  fields: { title: string; originalFilename?: string | null },
): boolean {
  const q = normalizeDocumentSearchQuery(rawQuery).toLowerCase();
  if (!q) return true;
  return (
    fields.title.toLowerCase().includes(q) ||
    (fields.originalFilename ?? "").toLowerCase().includes(q)
  );
}

export function documentMatchesStatusFilter(
  processingState: string,
  filter: DocumentListStatusFilter | null | undefined,
): boolean {
  const states = processingStatesForFilter(filter);
  if (!states) return true;
  return (states as readonly string[]).includes(processingState);
}

export function filterMatterDocumentList<
  T extends { title: string; originalFilename?: string | null; processingState: string },
>(
  rows: T[],
  opts: { q?: string; status?: DocumentListStatusFilter | null },
): T[] {
  return rows.filter(
    (row) =>
      documentMatchesNameQuery(opts.q ?? "", row) &&
      documentMatchesStatusFilter(row.processingState, opts.status ?? null),
  );
}

export function documentListCountLabel(params: {
  loaded: number;
  total: number | null | undefined;
  hasQuery: boolean;
  hasStatus: boolean;
}): string {
  const total = typeof params.total === "number" ? params.total : null;
  const filtered = params.hasQuery || params.hasStatus;
  if (total == null) {
    if (params.loaded === 1) return "1 document";
    return `${params.loaded} documents`;
  }
  if (filtered) {
    if (total === 0) return "0 matching documents";
    if (params.loaded < total) return `Showing ${params.loaded} of ${total} matching documents`;
    return total === 1 ? "1 matching document" : `${total} matching documents`;
  }
  if (params.loaded < total) return `Showing ${params.loaded} of ${total} documents`;
  return total === 1 ? "1 document" : `${total} documents`;
}

export type DocumentProcessingSummary = {
  ready: number;
  processing: number;
  attention: number;
  total: number;
};

export function emptyDocumentProcessingSummary(): DocumentProcessingSummary {
  return { ready: 0, processing: 0, attention: 0, total: 0 };
}

/** Groups stored processingState counts using the same buckets as list filters. */
export function tallyDocumentProcessing(
  rows: Array<{ processingState: string; count: number }>,
): DocumentProcessingSummary {
  const summary = emptyDocumentProcessingSummary();
  for (const row of rows) {
    const n = Number(row.count);
    if (!Number.isFinite(n) || n <= 0) continue;
    summary.total += n;
    if (documentMatchesStatusFilter(row.processingState, "ready")) summary.ready += n;
    else if (documentMatchesStatusFilter(row.processingState, "processing")) summary.processing += n;
    else if (documentMatchesStatusFilter(row.processingState, "attention")) summary.attention += n;
  }
  return summary;
}

export function parseDocumentProcessingSummary(raw: unknown): DocumentProcessingSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const ready = Number(value.ready);
  const processing = Number(value.processing);
  const attention = Number(value.attention);
  const total = Number(value.total);
  if (![ready, processing, attention, total].every((n) => Number.isFinite(n) && n >= 0)) return null;
  return { ready, processing, attention, total };
}

export function processingSummaryChip(filter: DocumentListStatusFilter, count: number): {
  text: string;
  ariaLabel: string;
} {
  if (filter === "ready") {
    return {
      text: `${count} Ready`,
      ariaLabel: count === 1 ? "1 document ready" : `${count} documents ready`,
    };
  }
  if (filter === "processing") {
    return {
      text: `${count} Processing`,
      ariaLabel: count === 1 ? "1 document processing" : `${count} documents processing`,
    };
  }
  return {
    text: count === 1 ? "1 Needs attention" : `${count} Need attention`,
    ariaLabel: count === 1 ? "1 document needs attention" : `${count} documents need attention`,
  };
}
