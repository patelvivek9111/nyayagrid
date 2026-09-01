import { describe, expect, it } from "vitest";
import { findSupportingSpan, resolveValidatedSources } from "./provenance";
import {
  extractDatedEventPropositionsFromText,
  groundTimelineActorsAndTitle,
  matchesRejectedTimelineEvent,
  normalizeTimelineProposal,
} from "./timeline-normalize";

const INVOICE_TEXT = `Harbor Point Office Lease - Invoice and Remittance
Invoice
INV-2601: Amount due $63,750. Invoice date 2026-10-01. Due date 2026-10-31.
Remittance Record
Bank remittance record shows $63,750 transmitted on 2026-11-03 with reference INV-2601.
Dispute Note
Party A email dated 2026-11-05 states payment was received but was three days late.`;

describe("multi-event extraction", () => {
  it("splits invoice issued, due, remittance, and receipt from one source", () => {
    const events = extractDatedEventPropositionsFromText(INVOICE_TEXT, "chunk-inv");
    const types = events.map((event) => event.eventType);
    expect(types).toEqual(expect.arrayContaining(["invoice_issued", "invoice_due", "remittance", "payment_notice"]));
    expect(events.find((event) => event.eventType === "invoice_issued")?.eventDate).toBe("2026-10-01");
    expect(events.find((event) => event.eventType === "invoice_due")?.eventDate).toBe("2026-10-31");
    expect(events.find((event) => event.eventType === "remittance")?.eventDate).toBe("2026-11-03");
    expect(events.find((event) => event.eventType === "payment_notice")?.eventDate).toBe("2026-11-05");
    expect(events.every((event) => event.datePrecision === "exact")).toBe(true);
  });

  it("splits long-form invoice dates the same way", () => {
    const text =
      "INV-2601: Amount due $63,750. Invoice date October 1, 2026. Due date October 31, 2026.";
    const events = extractDatedEventPropositionsFromText(text, "chunk-long");
    expect(events.find((event) => event.eventType === "invoice_issued")?.eventDate).toBe("2026-10-01");
    expect(events.find((event) => event.eventType === "invoice_due")?.eventDate).toBe("2026-10-31");
  });

  it("preserves each classified date after source-wide precision normalization", () => {
    const due = normalizeTimelineProposal(
      {
        title: "Invoice due date",
        description: "Due date 2026-10-31",
        eventType: "invoice_due",
        eventDate: "2026-10-31",
        datePrecision: "exact",
        sourceChunkIds: ["chunk-inv"],
        sourceQuotes: ["Due date 2026-10-31"],
      },
      INVOICE_TEXT,
    );
    expect(due?.eventDate).toBe("2026-10-31");
    expect(due?.datePrecision).toBe("exact");
  });

  it("does not over-split a single effective-date amendment sentence", () => {
    const text = "Section 4 is amended from 30 to 60 days effective January 1, 2027.";
    const events = extractDatedEventPropositionsFromText(text, "chunk-am");
    expect(events.filter((event) => event.eventType === "invoice_issued")).toHaveLength(0);
    expect(events.every((event) => event.eventType !== "invoice_due")).toBe(true);
  });
});

describe("actor grounding", () => {
  it("does not treat badge activity as a named person's physical act", () => {
    const source =
      "2026-11-10 14:47 - Badge JM-001 assigned to Jordan A. Mercer - Records Room - ACCESS GRANTED.";
    const grounded = groundTimelineActorsAndTitle(
      {
        title: "Jordan entered the records room",
        description: "ACCESS GRANTED for assigned badge. The witness entered.",
        eventType: "entry",
        eventDate: "2026-11-10",
        sourceChunkIds: ["log"],
        actors: ["Jordan A. Mercer"],
      },
      source,
    );
    expect(grounded.title).toMatch(/badge assigned to jordan a\. mercer recorded access/i);
    expect(grounded.actors).toEqual([]);
    expect(grounded.eventType).toBe("badge_activity");
  });
});

describe("title / description consistency", () => {
  it("does not keep a positive entry title for negative testimony", () => {
    const grounded = groundTimelineActorsAndTitle(
      {
        title: "Records Room Entry",
        description: "Jordan F. Mercer did not enter the records room on the day of the review meeting.",
        eventType: "entry",
        eventDate: "2026-11-15",
        sourceChunkIds: ["dep"],
        actors: ["Jordan F. Mercer"],
      },
      "Q. Did you enter the records room that day? A. No. I never entered the records room.",
    );
    expect(grounded.title).toMatch(/denying records-room entry/i);
    expect(grounded.eventType).toBe("testimony");
  });
});

describe("supporting span", () => {
  it("uses an overlapping quote rather than the synthetic header prefix", () => {
    const chunk = `SYNTH - FICTIONAL TEST DOCUMENT - NOT REAL CLIENT WORK Page 1
${INVOICE_TEXT}`;
    const span = findSupportingSpan({
      chunkText: chunk,
      quotes: [],
      title: "Invoice issued",
      description: "Invoice date 2026-10-01",
      eventDate: "2026-10-01",
    });
    expect(span).toBeTruthy();
    expect(span).toContain("2026-10-01");
    expect(span?.startsWith("SYNTH - FICTIONAL")).toBe(false);
  });

  it("matches a whitespace-collapsed quote against multiline chunk text", () => {
    const chunk = "You have thirty (30) days from this notice to cure.\nSigned Camille Ortiz.";
    const quote = chunk.replace(/\s+/g, " ").trim().slice(0, 400);
    const span = findSupportingSpan({
      chunkText: chunk,
      quotes: [quote],
    });
    expect(span).toContain("thirty (30) days");
  });

  it("does not treat a synthetic header prefix as supporting text", () => {
    const span = findSupportingSpan({
      chunkText: "SYNTH - FICTIONAL TEST DOCUMENT - NOT REAL CLIENT WORK Page 1\nGeneral provision only.",
      quotes: [],
      title: "Unrelated heading",
      description: "No overlapping evidence",
      eventDate: null,
    });
    expect(span).toBeNull();
  });

  it("keeps a cited contradiction chunk when quotes and title are absent", () => {
    const sources = resolveValidatedSources({
      organizationId: "org",
      matterId: "matter",
      sourceChunkIds: ["chunk-a"],
      sourceQuotes: [],
      authorized: new Map([
        [
          "chunk-a",
          {
            chunkId: "chunk-a",
            organizationId: "org",
            matterId: "matter",
            documentId: "doc-a",
            documentVersionId: "ver-a",
            page: 1,
            segmentRef: "p1",
            content: "You have ten (10) days from this notice to cure.",
          },
        ],
      ]),
    });
    expect(sources).toHaveLength(1);
    expect(sources[0]?.supportingText).toMatch(/ten \(10\) days/i);
  });
});

describe("duration-derived events", () => {
  it("drops a calculated expiration that is not a source-stated calendar day", () => {
    const result = normalizeTimelineProposal(
      {
        title: "Lease Termination Option",
        description: "The lease will continue for 36 months unless terminated earlier.",
        eventType: "termination",
        eventDate: "2029-03-04",
        datePrecision: "exact",
        sourceChunkIds: ["ag"],
        actors: [],
      },
      "This synthetic agreement is entered as of 2026-03-04. The lease will continue for 36 months unless terminated earlier.",
    );
    expect(result).toBeNull();
  });
});

describe("rejection memory", () => {
  it("suppresses an identical re-proposal from the same document version", () => {
    const rejected = [
      {
        title: "Invoice issued",
        description: "Invoice date 2026-10-01",
        eventType: "invoice_issued",
        eventDate: "2026-10-01",
        documentVersionIds: ["ver-1"],
      },
    ];
    expect(
      matchesRejectedTimelineEvent(
        {
          title: "Invoice issued",
          description: "Invoice date 2026-10-01. Amount due $63,750.",
          eventType: "invoice_issued",
          eventDate: "2026-10-01",
          sourceChunkIds: ["c1"],
          documentVersionIds: ["ver-1"],
        },
        rejected,
      ),
    ).toBe(true);
    expect(
      matchesRejectedTimelineEvent(
        {
          title: "Invoice issued",
          description: "Invoice date 2026-10-01",
          eventType: "invoice_issued",
          eventDate: "2026-10-01",
          sourceChunkIds: ["c1"],
          documentVersionIds: ["ver-2"],
        },
        rejected,
      ),
    ).toBe(false);
  });
});
