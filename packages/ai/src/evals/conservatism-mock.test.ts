import { describe, expect, it } from "vitest";
import {
  buildNyayaSystemPrompt,
  NYAYA_AMENDMENT_EXAMPLE_MARKER,
  NYAYA_AMENDMENT_HEDGE_EXAMPLE_MARKER,
  NYAYA_AMENDMENT_HEDGE_WORKED_EXAMPLE,
  NYAYA_AMENDMENT_WORKED_EXAMPLE,
  NYAYA_FALSE_PREMISE_EXAMPLE_MARKER,
  NYAYA_FALSE_PREMISE_WORKED_EXAMPLE,
  NYAYA_PROMPT_VERSION,
  NYAYA_WORKED_EXAMPLE_MARKER,
} from "../index";
import { GRADED_CASES, gradedCaseToPrompt } from "./graded-cases";
import {
  ConservatismProbeProvider,
  FALSE_RENT_CASE_ID,
  INDEMNITY_AMENDMENT_CASE_ID,
  QA05_INDEMNITY_CASE_ID,
  gradeCaseWithProbe,
  gradePersistentFailsWithProbe,
} from "./conservatism-mock";
import {
  PERSISTENT_CASE_QA_FAIL_IDS,
  diagnoseCaseRecall,
  diagnosePersistentCaseQaFails,
  inspectPromptLayout,
} from "./recall-debug";
import { gradeCitedAnswer } from "./grade";
import { passagesByLabels } from "./golden-matter";

describe("persistent Case Q&A prompt layout", () => {
  it("does not bury answering chunks at the end of a long decoy list", () => {
    const notice = GRADED_CASES.find((c) => c.id === "golden-notice-period")!;
    const noticeLayout = inspectPromptLayout(notice);
    expect(noticeLayout.retrievedCount).toBe(1);
    expect(noticeLayout.answeringIndexes).toEqual([0]);
    expect(noticeLayout.extraNonRequiredCount).toBe(0);

    const rent = GRADED_CASES.find((c) => c.id === "golden-adv-similar-clause-rent-vs-late-fee")!;
    const rentLayout = inspectPromptLayout(rent);
    expect(rentLayout.retrievedCount).toBe(2);
    expect(rentLayout.answeringIndexes[0]).toBe(0);
    expect(rentLayout.answeringIsLast).toBe(false);

    for (const id of PERSISTENT_CASE_QA_FAIL_IDS) {
      const testCase = GRADED_CASES.find((c) => c.id === id)!;
      const layout = inspectPromptLayout(testCase);
      expect(layout.retrievedCount).toBeLessThanOrEqual(3);
      expect(layout.answeringIndexes.length).toBeGreaterThan(0);
    }
  });
});

describe("conservatism worked example", () => {
  it("is present in the matter-qa system prompt used by the 13 cases", () => {
    expect(NYAYA_PROMPT_VERSION).toBe("nyaya-matter-qa-v11");
    expect(buildNyayaSystemPrompt()).toContain(NYAYA_WORKED_EXAMPLE_MARKER);
    expect(buildNyayaSystemPrompt()).toContain(NYAYA_AMENDMENT_EXAMPLE_MARKER);
    expect(buildNyayaSystemPrompt()).toContain(NYAYA_AMENDMENT_HEDGE_EXAMPLE_MARKER);
    expect(buildNyayaSystemPrompt()).toContain(NYAYA_FALSE_PREMISE_EXAMPLE_MARKER);
    expect(buildNyayaSystemPrompt()).toMatch(/chunk_lease_rent/);
    expect(buildNyayaSystemPrompt()).toMatch(/do not set insufficient because chunk_late_fee/i);
    expect(buildNyayaSystemPrompt()).toMatch(
      /Do not set grounded merely because an amendment chunk is present/i,
    );
    for (const id of PERSISTENT_CASE_QA_FAIL_IDS) {
      const testCase = GRADED_CASES.find((c) => c.id === id)!;
      expect(gradedCaseToPrompt(testCase).systemPrompt).toContain(NYAYA_WORKED_EXAMPLE_MARKER);
    }
  });

  it("mock-passes all 13 persistent fails when the example is in the prompt", async () => {
    expect(diagnosePersistentCaseQaFails()).toHaveLength(13);
    const rows = await gradePersistentFailsWithProbe();
    expect(rows).toHaveLength(13);
    expect(rows.filter((r) => !r.passed).map((r) => r.caseId)).toEqual([]);
    expect(rows.find((r) => r.caseId === "golden-partial-hedge-indemnity")?.evidenceState).toBe(
      "partial",
    );
    expect(rows.find((r) => r.caseId === "golden-partial-hedge-term")?.evidenceState).toBe(
      "partial",
    );
  });

  it("returns QA-05 indemnity to partial while indemnity-with-amendment stays grounded", async () => {
    const indemnity = await gradeCaseWithProbe(INDEMNITY_AMENDMENT_CASE_ID);
    const qa05 = await gradeCaseWithProbe(QA05_INDEMNITY_CASE_ID);
    expect(indemnity.passed).toBe(true);
    expect(indemnity.evidenceState).toBe("grounded");
    expect(qa05.passed).toBe(true);
    expect(qa05.evidenceState).toBe("partial");
    expect(qa05.answer?.toLowerCase()).toMatch(/partial picture/);
    expect(qa05.answer?.toLowerCase()).not.toMatch(/is fully settled/);
  });

  it("leaks live-8 grounded on QA-05 indemnity when the hedge contrast is stripped but the grounded amendment example remains", async () => {
    const stripped = buildNyayaSystemPrompt().replace(NYAYA_AMENDMENT_HEDGE_WORKED_EXAMPLE, "");
    expect(stripped).toContain(NYAYA_AMENDMENT_EXAMPLE_MARKER);
    expect(stripped).not.toContain(NYAYA_AMENDMENT_HEDGE_EXAMPLE_MARKER);
    const indemnity = await gradeCaseWithProbe(INDEMNITY_AMENDMENT_CASE_ID, stripped);
    const qa05 = await gradeCaseWithProbe(QA05_INDEMNITY_CASE_ID, stripped);
    expect(indemnity.passed).toBe(true);
    expect(indemnity.evidenceState).toBe("grounded");
    expect(qa05.passed).toBe(false);
    expect(qa05.evidenceState).toBe("grounded");
    expect(qa05.answer?.toLowerCase()).toMatch(/is fully settled/);
    expect(qa05.answer?.toLowerCase()).not.toMatch(/partial picture/);
  });

  it("golden-indemnity-with-amendment required chunk is already in the fixture (model_behavior, not retrieval)", () => {
    const testCase = GRADED_CASES.find((c) => c.id === INDEMNITY_AMENDMENT_CASE_ID)!;
    const row = diagnoseCaseRecall(testCase);
    expect(row.bucket).toBe("model_behavior");
    expect(row.presentRequired).toEqual(["chunk_amend_indemnity"]);
    expect(row.missingRequired).toEqual([]);
    expect(testCase.retrieved.map((p) => p.chunkId)).toContain("chunk_amend_indemnity");
  });

  it("passes indemnity-with-amendment with the amendment example, and still passes the other 12", async () => {
    const rows = await gradePersistentFailsWithProbe();
    expect(rows.filter((r) => !r.passed).map((r) => r.caseId)).toEqual([]);
    expect(rows.find((r) => r.caseId === INDEMNITY_AMENDMENT_CASE_ID)?.passed).toBe(true);
  });

  it("refuses indemnity-with-amendment when the amendment example is stripped but the decoy example remains", async () => {
    const stripped = buildNyayaSystemPrompt().replace(NYAYA_AMENDMENT_WORKED_EXAMPLE, "");
    expect(stripped).toContain(NYAYA_WORKED_EXAMPLE_MARKER);
    expect(stripped).not.toContain(NYAYA_AMENDMENT_EXAMPLE_MARKER);
    expect(stripped).not.toContain(NYAYA_AMENDMENT_HEDGE_EXAMPLE_MARKER);
    const indemnity = await gradeCaseWithProbe(INDEMNITY_AMENDMENT_CASE_ID, stripped);
    expect(indemnity.passed).toBe(false);
    expect(indemnity.evidenceState).toBe("insufficient");
    const rent = await gradeCaseWithProbe("golden-adv-similar-clause-rent-vs-late-fee", stripped);
    expect(rent.passed).toBe(true);
  });

  it("false-rent-amount lands on insufficient with no bait echo when the false-premise example is present", async () => {
    const row = await gradeCaseWithProbe(FALSE_RENT_CASE_ID);
    expect(row.passed).toBe(true);
    expect(row.evidenceState).toBe("insufficient");
    expect(row.answer?.toLowerCase()).not.toMatch(/seven thousand|7,000/);
  });

  it("false-rent-amount echoes the bait and lands on partial when the false-premise example is stripped", async () => {
    const stripped = buildNyayaSystemPrompt().replace(NYAYA_FALSE_PREMISE_WORKED_EXAMPLE, "");
    expect(stripped).toContain(NYAYA_WORKED_EXAMPLE_MARKER);
    expect(stripped).not.toContain(NYAYA_FALSE_PREMISE_EXAMPLE_MARKER);
    const row = await gradeCaseWithProbe(FALSE_RENT_CASE_ID, stripped);
    expect(row.passed).toBe(false);
    expect(row.evidenceState).toBe("partial");
    expect(row.answer?.toLowerCase()).toMatch(/seven thousand/);
  });

  it("refuses the 13 when the worked example is stripped from the system prompt", async () => {
    const provider = new ConservatismProbeProvider();
    const testCase = GRADED_CASES.find(
      (c) => c.id === "golden-adv-similar-clause-rent-vs-late-fee",
    )!;
    const { userPrompt } = gradedCaseToPrompt(testCase);
    const result = await provider.generate({
      messages: [
        { role: "system", content: "Answer only from Sources. No worked example." },
        { role: "user", content: userPrompt },
      ],
    });
    const grade = gradeCitedAnswer({
      caseId: testCase.id,
      raw: JSON.parse(result.text) as unknown,
      retrieved: testCase.retrieved,
      rubric: testCase.rubric,
      question: testCase.question,
      workflow: "case_qa",
    });
    expect(grade.passed).toBe(false);
    expect(grade.answer?.evidenceState).toBe("insufficient");
  });
});

describe("QA-05 partial vs grounded", () => {
  it("keeps model partial as partial when cites are valid (does not upgrade to grounded)", () => {
    const retrieved = passagesByLabels("lease_term");
    const passage = retrieved[0]!;
    const grade = gradeCitedAnswer({
      caseId: "qa05-keep-partial",
      retrieved,
      question: "Is this only a partial picture of commencement?",
      rubric: {
        expectEvidenceState: "partial",
        mustIncludePhrases: ["January 1, 2024"],
        mustCiteChunkIds: ["chunk_lease_term"],
        expectNeedsMoreDocuments: true,
      },
      raw: {
        answer: "The lease term commences on January 1, 2024. This is only a partial picture.",
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
        evidenceState: "partial",
      },
    });
    expect(grade.answer?.evidenceState).toBe("partial");
    expect(grade.passed).toBe(true);
  });

  it("still fails when the model labels a hedge grounded — partial is the right call, not a cite-as-grounded scorer bug", () => {
    const retrieved = passagesByLabels("lease_term");
    const passage = retrieved[0]!;
    const grade = gradeCitedAnswer({
      caseId: "qa05-grounded-hedge",
      retrieved,
      question: "Is this only a partial picture of commencement?",
      rubric: {
        expectEvidenceState: "partial",
        mustIncludePhrases: ["January 1, 2024"],
        mustCiteChunkIds: ["chunk_lease_term"],
        expectNeedsMoreDocuments: true,
      },
      raw: {
        answer: "The lease term commences on January 1, 2024. This is only a partial picture.",
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
        evidenceState: "grounded",
      },
    });
    expect(grade.answer?.evidenceState).toBe("grounded");
    expect(grade.passed).toBe(false);
    expect(grade.dimensions.find((d) => d.name === "evidence_state")?.passed).toBe(false);
  });
});
