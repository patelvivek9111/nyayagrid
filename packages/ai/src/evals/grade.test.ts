import { describe, expect, it } from "vitest";
import { assessNeedMoreDocuments, buildFollowUpRetrievalQuery } from "../need-more-docs";
import { gradeCitedAnswer } from "./grade";
import { GRADED_CASES } from "./graded-cases";
import { passagesByLabels } from "./golden-matter";

describe("assessNeedMoreDocuments", () => {
  it("is false when grounded", () => {
    const result = assessNeedMoreDocuments({
      evidenceState: "grounded",
      retrievedCount: 2,
      unresolvedQuestions: [],
      question: "When does the lease commence?",
    });
    expect(result.needsMoreDocuments).toBe(false);
  });

  it("is true when insufficient with empty retrieval", () => {
    const result = assessNeedMoreDocuments({
      evidenceState: "insufficient",
      retrievedCount: 0,
      unresolvedQuestions: [],
      question: "When was the CAM package sent?",
    });
    expect(result.needsMoreDocuments).toBe(true);
  });
});

describe("buildFollowUpRetrievalQuery", () => {
  it("expands amendment questions", () => {
    const q = buildFollowUpRetrievalQuery("How does the amendment change indemnity?");
    expect(q).toMatch(/amendment indemnity/i);
  });
});

describe("golden graded cases (deterministic validator path)", () => {
  it("grades a faithful grounded answer as pass", () => {
    const retrieved = passagesByLabels("lease_term");
    const passage = retrieved[0]!;
    const grade = gradeCitedAnswer({
      caseId: "unit-lease",
      retrieved,
      question: "When does the lease term commence?",
      rubric: {
        expectEvidenceState: "grounded",
        mustIncludePhrases: ["January 1, 2024"],
        mustCiteChunkIds: ["chunk_lease_term"],
        expectNeedsMoreDocuments: false,
      },
      raw: {
        answer: "The lease term begins on January 1, 2024.",
        sources: [
          {
            chunkId: passage.chunkId,
            documentId: passage.documentId,
            documentVersionId: passage.documentVersionId,
            quote: passage.quote,
          },
        ],
        assumptions: [],
        unresolvedQuestions: [],
        evidenceState: "grounded",
      },
    });
    expect(grade.passed).toBe(true);
  });

  it("fails when quote is not verbatim", () => {
    const retrieved = passagesByLabels("lease_term");
    const passage = retrieved[0]!;
    const grade = gradeCitedAnswer({
      caseId: "unit-missing-cite",
      retrieved,
      question: "When does the lease term commence?",
      rubric: {
        expectEvidenceState: "grounded",
        mustCiteChunkIds: ["chunk_lease_term"],
        expectNeedsMoreDocuments: false,
      },
      raw: {
        answer: "January 1, 2024",
        sources: [
          {
            chunkId: passage.chunkId,
            documentId: passage.documentId,
            documentVersionId: passage.documentVersionId,
            quote: "not in the passage at all and long enough to fail",
          },
        ],
        assumptions: [],
        unresolvedQuestions: [],
        evidenceState: "grounded",
      },
    });
    expect(grade.passed).toBe(false);
  });

  it("exposes the graded case catalog", () => {
    expect(GRADED_CASES.length).toBeGreaterThanOrEqual(5);
  });
});
