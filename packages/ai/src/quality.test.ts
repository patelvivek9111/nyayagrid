import { describe, expect, it } from "vitest";
import {
  contradictionCandidatesSchema,
  validateCitedAnswerAgainstPassages,
  validateQuoteAgainstText,
} from "./index";

describe("quote fidelity (AGENT_QUALITY QA-02)", () => {
  const source =
    "The lease term commences on January 1, 2024 and expires on December 31, 2026.";

  it("accepts typography-normalized verbatim quotes", () => {
    const result = validateQuoteAgainstText(
      "The lease term commences on January 1, 2024 and expires on December 31, 2026.",
      source,
    );
    expect(result.valid).toBe(true);
  });

  it("rejects altered wording", () => {
    const result = validateQuoteAgainstText(
      "The lease term starts on January 1, 2024 and ends on December 31, 2026.",
      source,
    );
    expect(result.valid).toBe(false);
  });
});

describe("contradiction candidates (AGENT_QUALITY CX-01)", () => {
  const chunkA = "11111111-1111-1111-1111-111111111111";
  const chunkB = "22222222-2222-2222-2222-222222222222";

  it("requires both sides with at least one chunk id", () => {
    expect(() =>
      contradictionCandidatesSchema.parse({
        candidates: [
          {
            title: "One sided",
            explanation: "Missing side B",
            sideA: { chunkIds: [chunkA], summary: "Witness said X happened on Monday." },
          },
        ],
      }),
    ).toThrow();
  });

  it("accepts dual-sided candidates", () => {
    const parsed = contradictionCandidatesSchema.parse({
      candidates: [
        {
          title: "Date conflict",
          explanation: "Sources disagree on the meeting date.",
          sideA: { chunkIds: [chunkA], summary: "Source A places the meeting on Monday." },
          sideB: { chunkIds: [chunkB], summary: "Source B places the meeting on Tuesday." },
        },
      ],
    });
    expect(parsed.candidates).toHaveLength(1);
  });
});

describe("insufficient when all quotes fail", () => {
  it("forces insufficient after quote rejection", () => {
    const result = validateCitedAnswerAgainstPassages(
      {
        answer: "Invented detail.",
        sources: [
          {
            chunkId: "c1",
            documentId: "d1",
            documentVersionId: "v1",
            quote: "This quote was never in the passage at all.",
          },
        ],
        assumptions: [],
        unresolvedQuestions: [],
        evidenceState: "grounded",
      },
      [
        {
          chunkId: "c1",
          documentId: "d1",
          documentVersionId: "v1",
          quote: "The only real sentence in this passage is about jurisdiction.",
        },
      ],
    );
    expect(result.answer.evidenceState).toBe("insufficient");
    expect(result.answer.sources).toEqual([]);
  });
});
