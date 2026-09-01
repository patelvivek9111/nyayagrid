import { describe, expect, it } from "vitest";
import {
  ATTENTION_PROCESSING_STATES,
  IN_FLIGHT_PROCESSING_STATES,
  documentListCountLabel,
  documentMatchesNameQuery,
  escapeIlikePattern,
  filterMatterDocumentList,
  ilikeContainsPattern,
  normalizeDocumentSearchQuery,
  parseDocumentListSort,
  parseDocumentListStatus,
  parseDocumentProcessingSummary,
  processingStatesForFilter,
  tallyDocumentProcessing,
} from "./document-list";

describe("document list search helpers", () => {
  it("A/B/C/D. normalizes whitespace, case is left to ILIKE, bounds length", () => {
    expect(normalizeDocumentSearchQuery("  invoice  ")).toBe("invoice");
    expect(normalizeDocumentSearchQuery("Master Services")).toBe("Master Services");
    expect(normalizeDocumentSearchQuery("a".repeat(120)).length).toBe(100);
    expect(ilikeContainsPattern("INVOICE")).toBe("%INVOICE%");
    expect(ilikeContainsPattern("amend")).toBe("%amend%");
  });

  it("does not treat user input as a LIKE wildcard", () => {
    expect(escapeIlikePattern("100% draft")).toBe("100\\% draft");
    expect(escapeIlikePattern("Smith_Jones")).toBe("Smith\\_Jones");
    expect(ilikeContainsPattern("%")).toBe("%\\%%");
  });

  it("E. empty query means no pattern (all names)", () => {
    expect(ilikeContainsPattern("")).toBeNull();
    expect(ilikeContainsPattern("   ")).toBeNull();
  });

  it("I/J/K. processing filters map to stored states, not invented legal categories", () => {
    expect(processingStatesForFilter("ready")).toEqual(["ready"]);
    expect(processingStatesForFilter("processing")).toEqual([...IN_FLIGHT_PROCESSING_STATES]);
    expect(processingStatesForFilter("attention")).toEqual([...ATTENTION_PROCESSING_STATES]);
    expect(processingStatesForFilter("processing")).toContain("uploaded");
    expect(processingStatesForFilter("processing")).toContain("embedding");
    expect(processingStatesForFilter("attention")).toContain("failed");
    expect(processingStatesForFilter("attention")).toContain("requires_ocr");
    expect(processingStatesForFilter(null)).toBeNull();
  });

  it("P/Q. processing and failed states are distinct filter buckets and remain listable", () => {
    expect(IN_FLIGHT_PROCESSING_STATES).not.toContain("failed");
    expect(ATTENTION_PROCESSING_STATES).toContain("scan_blocked");
  });

  it("parses sort and status from URL-like values", () => {
    expect(parseDocumentListSort(undefined)).toBe("newest");
    expect(parseDocumentListSort("name_asc")).toBe("name_asc");
    expect(parseDocumentListStatus("ready")).toBe("ready");
    expect(parseDocumentListStatus("pleading")).toBeNull();
  });

  it("count labels do not invent totals", () => {
    expect(documentListCountLabel({ loaded: 23, total: 23, hasQuery: false, hasStatus: false })).toBe(
      "23 documents",
    );
    expect(
      documentListCountLabel({ loaded: 20, total: 23, hasQuery: false, hasStatus: false }),
    ).toBe("Showing 20 of 23 documents");
    expect(documentListCountLabel({ loaded: 4, total: 4, hasQuery: true, hasStatus: false })).toBe(
      "4 matching documents",
    );
  });

  it("A–D/G. processing summary uses the same groups as filters and is page-independent", () => {
    const many = [
      ...Array.from({ length: 65 }, () => ({ processingState: "ready", count: 1 })),
      ...Array.from({ length: 30 }, () => ({ processingState: "embedding", count: 1 })),
      { processingState: "failed", count: 2 },
      { processingState: "requires_ocr", count: 2 },
      { processingState: "scan_blocked", count: 1 },
    ];
    const summary = tallyDocumentProcessing(many);
    expect(summary.ready).toBe(65);
    expect(summary.processing).toBe(30);
    expect(summary.attention).toBe(5);
    expect(summary.total).toBe(100);
    const firstPage = many.slice(0, 50);
    expect(tallyDocumentProcessing(firstPage).total).toBe(50);
    expect(tallyDocumentProcessing(many).total).not.toBe(tallyDocumentProcessing(firstPage).total);
    expect(processingStatesForFilter("attention")).toEqual(expect.arrayContaining(["failed", "requires_ocr", "scan_blocked"]));
  });

  it("H. empty summary is all zeros", () => {
    expect(tallyDocumentProcessing([])).toEqual({ ready: 0, processing: 0, attention: 0, total: 0 });
    expect(parseDocumentProcessingSummary({ ready: 3, processing: 2, attention: 0, total: 5 })).toEqual({
      ready: 3,
      processing: 2,
      attention: 0,
      total: 5,
    });
  });
});

describe("document list matching (filename/title, not contents)", () => {
  const rows = [
    { title: "Amendment 1.pdf", originalFilename: "Amendment 1.pdf", processingState: "ready" },
    { title: "Invoice March.pdf", originalFilename: "Invoice March.pdf", processingState: "ready" },
    { title: "Invoice April.pdf", originalFilename: "Invoice April.pdf", processingState: "embedding" },
    { title: "Lease.pdf", originalFilename: "Lease.pdf", processingState: "indexed" },
    { title: "Scan blocked.pdf", originalFilename: "Scan blocked.pdf", processingState: "failed" },
    { title: "Smith & Jones.pdf", originalFilename: "Smith & Jones.pdf", processingState: "ready" },
  ];

  it("A/B/C. matches exact, partial, and case-insensitive names", () => {
    expect(documentMatchesNameQuery("Master Services Agreement.pdf", { title: "Master Services Agreement.pdf" })).toBe(
      true,
    );
    expect(documentMatchesNameQuery("amend", rows[0]!)).toBe(true);
    expect(documentMatchesNameQuery("INVOICE", rows[1]!)).toBe(true);
    expect(documentMatchesNameQuery("  invoice  ", rows[2]!)).toBe(true);
  });

  it("E. no match", () => {
    expect(filterMatterDocumentList(rows, { q: "exhibit z" })).toHaveLength(0);
  });

  it("F/G. filtering one matter list cannot invent another matter's rows", () => {
    const matterA = [{ title: "Shared.pdf", originalFilename: "Shared.pdf", processingState: "ready", matterId: "A" }];
    const matterB = [{ title: "Shared.pdf", originalFilename: "Shared.pdf", processingState: "ready", matterId: "B" }];
    expect(filterMatterDocumentList(matterA, { q: "Shared" }).every((row) => row.matterId === "A")).toBe(true);
    expect(filterMatterDocumentList(matterB, { q: "Shared" }).every((row) => row.matterId === "B")).toBe(true);
    expect(filterMatterDocumentList(matterA, { q: "Shared" })).not.toEqual(
      filterMatterDocumentList(matterB, { q: "Shared" }),
    );
  });

  it("H. a match beyond the first cursor page is still in the filtered set", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      title: `File-${String(i + 1).padStart(3, "0")}.pdf`,
      originalFilename: `File-${String(i + 1).padStart(3, "0")}.pdf`,
      processingState: "ready",
    }));
    const unfilteredFirstPage = many.slice(0, 20);
    expect(unfilteredFirstPage.some((row) => row.title.includes("087"))).toBe(false);
    const found = filterMatterDocumentList(many, { q: "087" });
    expect(found).toHaveLength(1);
    expect(found[0]?.title).toBe("File-087.pdf");
  });

  it("I/J/K/L. status filters combine with query", () => {
    expect(filterMatterDocumentList(rows, { status: "ready" }).map((r) => r.title)).toEqual([
      "Amendment 1.pdf",
      "Invoice March.pdf",
      "Smith & Jones.pdf",
    ]);
    expect(filterMatterDocumentList(rows, { status: "processing" }).map((r) => r.title)).toEqual([
      "Invoice April.pdf",
      "Lease.pdf",
    ]);
    expect(filterMatterDocumentList(rows, { status: "attention" }).map((r) => r.title)).toEqual(["Scan blocked.pdf"]);
    expect(filterMatterDocumentList(rows, { q: "invoice", status: "ready" }).map((r) => r.title)).toEqual([
      "Invoice March.pdf",
    ]);
  });

  it("P/Q. processing and failed documents remain searchable by name", () => {
    expect(filterMatterDocumentList(rows, { q: "Lease" })).toHaveLength(1);
    expect(filterMatterDocumentList(rows, { q: "Scan blocked" })).toHaveLength(1);
  });

  it("special characters are literal substrings", () => {
    expect(documentMatchesNameQuery("Smith & Jones", rows[5]!)).toBe(true);
    expect(escapeIlikePattern("Smith & Jones")).toBe("Smith & Jones");
  });
});
