import { describe, expect, it } from "vitest";
import { assessNeedMoreDocuments, buildFollowUpRetrievalQuery } from "../need-more-docs";
import { gradeCitedAnswer } from "./grade";
import { GRADED_CASES, gradedCaseToPrompt, EVAL_CASE_QA_RERANK } from "./graded-cases";
import { passagesByLabels } from "./golden-matter";
import {
  LIVE6_COMBINE_DISPUTE_AND_LATE_FEE,
  LIVE6_COMBINE_NOTICE_AND_TERM,
  LIVE6_COMBINE_RENEWAL_AND_EXPIRATION,
  LIVE6_COMBINE_RENT_AND_TERM,
  LIVE6_NEAR_MISS_TERM_SHEET_RENT,
  LIVE6_RENT_VS_LATE_FEE_REPEAT2,
} from "./live6-captured-case-qa";

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
    expect(GRADED_CASES.length).toBeGreaterThanOrEqual(30);
    expect(GRADED_CASES.some((c) => c.rubric.expectEvidenceState === "partial")).toBe(true);
    expect(GRADED_CASES.some((c) => Boolean(c.verifiedIntelligence) && c.retrieved.length === 0)).toBe(
      true,
    );
    expect(GRADED_CASES.filter((c) => c.adversarial).length).toBeGreaterThanOrEqual(5);
    expect(
      GRADED_CASES.filter((c) => (c.rubric.forbiddenChunkIds?.length ?? 0) > 0).length,
    ).toBeGreaterThanOrEqual(5);
    expect(
      GRADED_CASES.filter((c) => (c.rubric.mustCiteChunkIds?.length ?? 0) >= 2).length,
    ).toBeGreaterThanOrEqual(5);
    expect(
      GRADED_CASES.filter(
        (c) =>
          c.id.includes("near-miss") ||
          c.id.includes("similar-clause") ||
          c.id.includes("notice-vs-renewal"),
      ).length,
    ).toBeGreaterThanOrEqual(5);
  });

  it("grades a QA-05 hedge as partial when cites are valid", () => {
    const retrieved = passagesByLabels("lease_term");
    const passage = retrieved[0]!;
    const grade = gradeCitedAnswer({
      caseId: "unit-partial",
      retrieved,
      question: "Is this only a partial picture of commencement?",
      rubric: {
        expectEvidenceState: "partial",
        mustIncludePhrases: ["January 1, 2024"],
        mustCiteChunkIds: ["chunk_lease_term"],
        expectNeedsMoreDocuments: true,
      },
      raw: {
        answer: "The lease term commences on January 1, 2024. The record is not fully settled.",
        sources: [
          {
            chunkId: passage.chunkId,
            documentId: passage.documentId,
            documentVersionId: passage.documentVersionId,
            quote: passage.quote,
          },
        ],
        assumptions: [],
        unresolvedQuestions: ["What remains uncertain given incomplete coverage?"],
        evidenceState: "insufficient",
      },
    });
    expect(grade.answer?.evidenceState).toBe("partial");
    expect(grade.passed).toBe(true);
  });

  it("caps verified intel without document cites at partial (QA-06)", () => {
    const grade = gradeCitedAnswer({
      caseId: "unit-qa06",
      retrieved: [],
      question: "According to verified matter intelligence, when was the CAM package sent?",
      verifiedIntelligence:
        "Verified timeline event: Property manager sent the February CAM package on February 28, 2025.",
      rubric: {
        expectEvidenceState: "partial",
        mustIncludePhrases: ["February 28, 2025"],
        expectNeedsMoreDocuments: true,
      },
      raw: {
        answer:
          "Based on verified matter intelligence: Property manager sent the February CAM package on February 28, 2025.",
        sources: [],
        assumptions: ["Includes verified structured matter intelligence."],
        unresolvedQuestions: [],
        evidenceState: "grounded",
      },
    });
    expect(grade.answer?.evidenceState).toBe("partial");
    expect(grade.passed).toBe(true);
  });

  it("fails citation_relevance when a forbidden decoy chunk is cited", () => {
    const retrieved = [...passagesByLabels("lease_term"), ...passagesByLabels("rent")];
    const rent = retrieved.find((p) => p.chunkId === "chunk_lease_rent")!;
    const grade = gradeCitedAnswer({
      caseId: "unit-forbidden-cite",
      retrieved,
      question: "When does the lease term commence?",
      rubric: {
        expectEvidenceState: "grounded",
        mustIncludePhrases: ["January 1, 2024"],
        mustCiteChunkIds: ["chunk_lease_term"],
        forbiddenChunkIds: ["chunk_lease_rent"],
        expectNeedsMoreDocuments: false,
      },
      raw: {
        answer: "The lease term commences on January 1, 2024.",
        sources: [
          {
            chunkId: rent.chunkId,
            documentId: rent.documentId,
            documentVersionId: rent.documentVersionId,
            quote: rent.quote,
          },
        ],
        assumptions: [],
        unresolvedQuestions: [],
        evidenceState: "grounded",
      },
    });
    expect(grade.passed).toBe(false);
    const relevance = grade.dimensions.find((d) => d.name === "citation_relevance");
    expect(relevance?.passed).toBe(false);
    expect(grade.flags.citationRelevanceFailures).toBeGreaterThan(0);
  });

  it("does not fail faithfulness when the answer echoes a decoy date from the question and states the sourced date", () => {
    const retrieved = passagesByLabels("lease_term");
    const passage = retrieved[0]!;
    const grade = gradeCitedAnswer({
      caseId: "unit-question-echo-date",
      retrieved,
      question: "Did the lease commence on January 15, 2024?",
      rubric: {
        expectEvidenceState: "grounded",
        mustIncludePhrases: ["January 1, 2024"],
        mustCiteChunkIds: ["chunk_lease_term"],
        forbiddenPhrases: ["January 15, 2024"],
        expectNeedsMoreDocuments: false,
      },
      raw: {
        answer:
          "No, the lease does not commence on January 15, 2024. It commences on January 1, 2024.",
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
    expect(grade.dimensions.find((d) => d.name === "faithfulness")?.passed).toBe(true);
  });

  it("still fails faithfulness for an invented date that is not in the question or sources", () => {
    const retrieved = passagesByLabels("lease_term");
    const passage = retrieved[0]!;
    const grade = gradeCitedAnswer({
      caseId: "unit-invented-date",
      retrieved,
      question: "When does the lease term commence?",
      rubric: {
        expectEvidenceState: "grounded",
        mustIncludePhrases: ["January 1, 2024"],
        mustCiteChunkIds: ["chunk_lease_term"],
        expectNeedsMoreDocuments: false,
      },
      raw: {
        answer: "The lease term commences on July 4, 2020.",
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
    expect(grade.passed).toBe(false);
    expect(grade.dimensions.find((d) => d.name === "faithfulness")?.passed).toBe(false);
  });

  it("promotes stock insufficient to partial when verified intel is present and retrieval is empty (QA-06)", () => {
    const grade = gradeCitedAnswer({
      caseId: "unit-qa06-stock-insufficient",
      retrieved: [],
      question: "According to verified matter intelligence, when was the CAM package sent?",
      verifiedIntelligence:
        "Verified timeline event: Property manager sent the February CAM package on February 28, 2025.",
      rubric: {
        expectEvidenceState: "partial",
        mustIncludePhrases: ["February 28, 2025"],
        expectNeedsMoreDocuments: true,
      },
      raw: {
        answer:
          "The available matter documents do not provide sufficient evidence to answer this question.",
        sources: [],
        assumptions: [],
        unresolvedQuestions: [],
        evidenceState: "insufficient",
      },
    });
    expect(grade.answer?.evidenceState).toBe("partial");
    expect(grade.answer?.answer).toMatch(/February 28, 2025/);
    expect(grade.passed).toBe(true);
  });

  it("flattens an object answer so combine facts can still be graded", () => {
    const retrieved = [...passagesByLabels("rent"), ...passagesByLabels("lease_term")];
    const rent = retrieved.find((p) => p.chunkId === "chunk_lease_rent")!;
    const term = retrieved.find((p) => p.chunkId === "chunk_lease_term")!;
    const grade = gradeCitedAnswer({
      caseId: "unit-object-answer",
      retrieved,
      question: "What is the monthly base rent and when does the lease term commence?",
      rubric: {
        expectEvidenceState: "grounded",
        mustIncludePhrases: ["4,000", "January 1, 2024"],
        mustCiteChunkIds: ["chunk_lease_rent", "chunk_lease_term"],
        expectNeedsMoreDocuments: false,
      },
      raw: {
        answer: { monthlyBaseRent: "$4,000", commencement: "January 1, 2024" },
        sources: [
          {
            chunkId: rent.chunkId,
            documentId: rent.documentId,
            documentVersionId: rent.documentVersionId,
            quote: rent.quote,
          },
          {
            chunkId: term.chunkId,
            documentId: term.documentId,
            documentVersionId: term.documentVersionId,
            quote: term.quote,
          },
        ],
        assumptions: [],
        unresolvedQuestions: [],
        evidenceState: "grounded",
      },
    });
    expect(grade.passed).toBe(true);
    expect(grade.answer?.answer).toContain("$4,000");
    expect(grade.answer?.answer).toContain("January 1, 2024");
  });
});

describe("live-6 chunkId-only JSON backfill", () => {
  const cases: Array<{ id: string; raw: unknown }> = [
    { id: "golden-adv-combine-rent-and-term", raw: LIVE6_COMBINE_RENT_AND_TERM },
    { id: "golden-adv-combine-notice-and-term", raw: LIVE6_COMBINE_NOTICE_AND_TERM },
    { id: "golden-adv-combine-dispute-and-late-fee", raw: LIVE6_COMBINE_DISPUTE_AND_LATE_FEE },
    { id: "golden-adv-combine-renewal-and-expiration", raw: LIVE6_COMBINE_RENEWAL_AND_EXPIRATION },
    { id: "golden-adv-near-miss-term-sheet-rent", raw: LIVE6_NEAR_MISS_TERM_SHEET_RENT },
    { id: "golden-adv-similar-clause-rent-vs-late-fee", raw: LIVE6_RENT_VS_LATE_FEE_REPEAT2 },
  ];

  it("parses, validates, and grades the captured live-6 payloads as grounded", () => {
    for (const { id, raw } of cases) {
      const testCase = GRADED_CASES.find((c) => c.id === id);
      expect(testCase, id).toBeDefined();
      const grade = gradeCitedAnswer({
        caseId: id,
        raw,
        retrieved: testCase!.retrieved,
        rubric: testCase!.rubric,
        question: testCase!.question,
        workflow: "case_qa",
      });
      expect(grade.passed, `${id}: ${grade.dimensions.map((d) => `${d.name}:${d.detail}`).join(" | ")}`).toBe(
        true,
      );
      expect(grade.answer?.evidenceState).toBe("grounded");
      expect(grade.answer?.sources.every((s) => s.documentId && s.documentVersionId)).toBe(true);
    }
  });
});

describe("eval retrieval order (rerank isolation)", () => {
  it("keeps fixture passage order in the Case Q&A prompt", () => {
    const testCase = GRADED_CASES.find((c) => c.id === "golden-adv-similar-clause-rent-vs-late-fee");
    expect(testCase).toBeDefined();
    const { userPrompt } = gradedCaseToPrompt(testCase!);
    const positions = testCase!.retrieved.map((p) => userPrompt.indexOf(`chunkId=${p.chunkId}`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(EVAL_CASE_QA_RERANK).toBe(false);
  });
});
