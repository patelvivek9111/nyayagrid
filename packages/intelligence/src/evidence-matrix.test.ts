import { describe, expect, it } from "vitest";
import { buildEvidenceMatrix } from "./index";

describe("evidence matrix trust and provenance", () => {
  it("does not treat proposed contradictions as established contrary evidence", () => {
    const matrix = buildEvidenceMatrix({
      facts: [
        {
          id: "fact-1",
          factKey: "notice_period",
          label: "Notice period",
          value: "30 days",
          origin: "ai",
          status: "approved",
        },
      ],
      factSources: [
        {
          matterFactId: "fact-1",
          documentId: "doc-a",
          documentVersionId: "ver-a",
          chunkId: "chunk-a",
          supportingText: "Notice shall be thirty (30) days.",
        },
      ],
      events: [],
      eventSources: [],
      contradictionFindings: [],
      contradictionSources: [],
      importantDocumentIds: new Set(),
    });
    expect(matrix.issues).toHaveLength(1);
    expect(matrix.issues[0]?.supporting[0]?.documentId).toBe("doc-a");
    expect(matrix.issues[0]?.supporting[0]?.chunkId).toBe("chunk-a");
    expect(matrix.issues[0]?.supporting[0]?.trustClass).toBe("source_evidence");
  });

  it("does not attach same-document timeline events as independent fact corroboration", () => {
    const matrix = buildEvidenceMatrix({
      facts: [
        {
          id: "fact-1",
          factKey: "rent",
          label: "Rent",
          value: "4000",
          origin: "ai",
          status: "approved",
        },
      ],
      factSources: [
        {
          matterFactId: "fact-1",
          documentId: "doc-a",
          documentVersionId: "ver-a",
          chunkId: "chunk-fact",
          supportingText: "Monthly rent is 4000.",
        },
      ],
      events: [{ id: "event-1", title: "Lease signed", description: "Signing", origin: "ai" }],
      eventSources: [
        {
          timelineEventId: "event-1",
          documentId: "doc-a",
          documentVersionId: "ver-a",
          chunkId: "chunk-event",
          supportingText: "The parties signed on March 1.",
        },
      ],
      contradictionFindings: [],
      contradictionSources: [],
      importantDocumentIds: new Set(),
    });
    const factIssue = matrix.issues.find((row) => row.issueKey === "rent");
    expect(factIssue?.supporting.every((row) => row.kind === "fact_source")).toBe(true);
    expect(matrix.issues.some((row) => row.issueKey === "event:event-1")).toBe(true);
  });

  it("keeps reviewed tension sides distinct and does not call them proven", () => {
    const matrix = buildEvidenceMatrix({
      facts: [],
      factSources: [],
      events: [],
      eventSources: [],
      contradictionFindings: [
        {
          id: "find-1",
          title: "Access log vs testimony",
          explanation: "Tension on who was present",
          findingType: "tension",
          status: "reviewed",
        },
      ],
      contradictionSources: [
        {
          findingId: "find-1",
          documentId: "doc-a",
          documentVersionId: "ver-a",
          chunkId: "chunk-a",
          supportingText: "Badge 4412 used the rear door.",
          side: "A",
        },
        {
          findingId: "find-1",
          documentId: "doc-b",
          documentVersionId: "ver-b",
          chunkId: "chunk-b",
          supportingText: "Witness said the rear door stayed locked.",
          side: "B",
        },
      ],
      importantDocumentIds: new Set(),
    });
    expect(matrix.issues).toHaveLength(1);
    expect(matrix.issues[0]?.supporting).toHaveLength(1);
    expect(matrix.issues[0]?.contrary).toHaveLength(1);
    expect(JSON.stringify(matrix.issues).toLowerCase()).not.toMatch(/proven contradiction/);
    expect(matrix.issues[0]?.supporting[0]?.trustClass).toBe("disputed");
  });

  it("labels user-origin facts as user assertions", () => {
    const matrix = buildEvidenceMatrix({
      facts: [
        {
          id: "fact-u",
          factKey: "client_note",
          label: "Client said",
          value: "paid in cash",
          origin: "user",
          status: "approved",
        },
      ],
      factSources: [],
      events: [],
      eventSources: [],
      contradictionFindings: [],
      contradictionSources: [],
      importantDocumentIds: new Set(),
    });
    expect(matrix.issues[0]?.label).toMatch(/User assertion/);
    expect(matrix.issues[0]?.gaps.length).toBeGreaterThan(0);
  });
});
