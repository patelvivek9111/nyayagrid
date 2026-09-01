import { describe, expect, it } from "vitest";
import { GRADED_CASES } from "./graded-cases";
import { gradeCitedAnswer } from "./grade";

const CASE_IDS = [
  "golden-access-log-limitation",
  "golden-false-premise-future-effective",
  "golden-invoice-silence-not-proof",
  "golden-email-vs-signed-amendment",
  "golden-supersession-effective-amendment",
  "golden-future-effective-current-term",
  "golden-future-effective-future-term",
  "golden-corroborated-actor-inference",
  "golden-qualifier-preserve-approximately",
  "golden-compatible-approx-exact-date",
  "golden-named-exhibit-missing",
  "golden-guardrail-states-operative-days",
  "golden-evidentiary-tension-testimony-log",
] as const;

function requireCase(id: string) {
  const testCase = GRADED_CASES.find((row) => row.id === id);
  if (!testCase) throw new Error(`missing graded case ${id}`);
  return testCase;
}

function citeAll(testCase: ReturnType<typeof requireCase>) {
  return testCase.retrieved.map((passage) => ({
    chunkId: passage.chunkId,
    documentId: passage.documentId,
    documentVersionId: passage.documentVersionId,
    quote: passage.quote,
  }));
}

describe("evidence-bound graded cases", () => {
  it("registers the general reasoning regressions", () => {
    expect(CASE_IDS.every((id) => GRADED_CASES.some((row) => row.id === id))).toBe(true);
  });

  it("passes a qualified access-log answer and fails physical-entry overclaim", () => {
    const testCase = requireCase("golden-access-log-limitation");
    const passage = testCase.retrieved[0]!;
    const good = gradeCitedAnswer({
      caseId: testCase.id,
      retrieved: testCase.retrieved,
      question: testCase.question,
      rubric: testCase.rubric,
      raw: {
        answer:
          "The access log records ACCESS GRANTED at 14:47 for the badge assigned to Alex Rivera. The log does not independently prove who physically carried the badge.",
        sources: [
          {
            chunkId: passage.chunkId,
            documentId: passage.documentId,
            documentVersionId: passage.documentVersionId,
            quote: passage.quote,
          },
        ],
        assumptions: [],
        unresolvedQuestions: ["Who possessed or used the badge is not established."],
        evidenceState: "partial",
      },
    });
    expect(good.passed, good.dimensions.map((d) => `${d.name}:${d.detail}`).join("; ")).toBe(true);

    const bad = gradeCitedAnswer({
      caseId: testCase.id,
      retrieved: testCase.retrieved,
      question: testCase.question,
      rubric: testCase.rubric,
      raw: {
        answer: "Alex Rivera physically entered the server room at 14:47.",
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
    expect(bad.passed).toBe(false);
    expect(bad.dimensions.some((d) => d.name === "faithfulness" && !d.passed)).toBe(true);
  });

  it("passes a premise challenge and fails an invented retroactivity motive", () => {
    const testCase = requireCase("golden-false-premise-future-effective");
    const passage = testCase.retrieved[0]!;
    const good = gradeCitedAnswer({
      caseId: testCase.id,
      retrieved: testCase.retrieved,
      question: testCase.question,
      rubric: testCase.rubric,
      raw: {
        answer:
          "The supplied documents do not support the premise that Amendment 2 was retroactive. It becomes effective January 1, 2027.",
        sources: [
          {
            chunkId: passage.chunkId,
            documentId: passage.documentId,
            documentVersionId: passage.documentVersionId,
            quote: passage.quote,
          },
        ],
        assumptions: [],
        unresolvedQuestions: ["The documents do not explain a nonexistent retroactive agreement."],
        evidenceState: "partial",
      },
    });
    expect(good.passed, good.dimensions.map((d) => `${d.name}:${d.detail}`).join("; ")).toBe(true);

    const bad = gradeCitedAnswer({
      caseId: testCase.id,
      retrieved: testCase.retrieved,
      question: testCase.question,
      rubric: testCase.rubric,
      raw: {
        answer:
          "The parties made Amendment 2 retroactive to align with the original commencement on March 1, 2024.",
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
    expect(bad.passed).toBe(false);
  });

  it("passes remaining evidence-bound good answers", () => {
    const answers: Record<string, string> = {
      "golden-invoice-silence-not-proof":
        "This invoice does not reflect a service credit. Absence from this invoice does not prove a credit was never provided.",
      "golden-email-vs-signed-amendment":
        "The signed agreement requires thirty (30) days' written notice. The email is informal recollection, not the controlling term.",
      "golden-supersession-effective-amendment":
        "The currently operative notice period is thirty (30) days because the amendment is effective immediately.",
      "golden-future-effective-current-term":
        "The contract currently requires sixty (60) days. The later amendment is signed but not yet effective.",
      "golden-qualifier-preserve-approximately": "Delivery occurred approximately March 12, 2026.",
    };
    for (const [id, answer] of Object.entries(answers)) {
      const testCase = requireCase(id);
      const sources =
        id === "golden-email-vs-signed-amendment" ||
        id === "golden-supersession-effective-amendment"
          ? testCase.retrieved
              .filter((passage) => testCase.rubric.mustCiteChunkIds?.includes(passage.chunkId))
              .map((passage) => ({
                chunkId: passage.chunkId,
                documentId: passage.documentId,
                documentVersionId: passage.documentVersionId,
                quote: passage.quote,
              }))
          : citeAll(testCase);
      const grade = gradeCitedAnswer({
        caseId: testCase.id,
        retrieved: testCase.retrieved,
        question: testCase.question,
        rubric: testCase.rubric,
        raw: {
          answer,
          sources,
          assumptions: [],
          unresolvedQuestions: [],
          evidenceState: testCase.rubric.expectEvidenceState,
        },
      });
      expect(
        grade.passed,
        `${id}: ${grade.dimensions.map((d) => `${d.name}:${d.detail}`).join("; ")}`,
      ).toBe(true);
    }
  });
});
