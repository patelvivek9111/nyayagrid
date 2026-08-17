import { describe, expect, it } from "vitest";
import {
  buildContradictionAnalysisSystemPrompt,
  buildNyayaSystemPrompt,
  buildNyayaSystemPromptWithIntelligence,
  citedAnswerSchema,
  contradictionCandidatesSchema,
  normalizeCitedAnswerRaw,
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

describe("normalizeCitedAnswerRaw (live JSON shape)", () => {
  it("flattens object answers and string lists", () => {
    const parsed = citedAnswerSchema.parse(
      normalizeCitedAnswerRaw({
        answer: { monthlyBaseRent: "$4,000", commencement: "January 1, 2024" },
        sources: [],
        assumptions: "model hedge",
        unresolvedQuestions: "need the amendment",
        evidenceState: "sufficient",
      }),
    );
    expect(parsed.answer).toContain("$4,000");
    expect(parsed.answer).toContain("January 1, 2024");
    expect(parsed.assumptions).toEqual(["model hedge"]);
    expect(parsed.unresolvedQuestions).toEqual(["need the amendment"]);
    expect(parsed.evidenceState).toBe("grounded");
  });

  it("coerces a null answer to an empty string", () => {
    const parsed = citedAnswerSchema.parse(
      normalizeCitedAnswerRaw({
        answer: null,
        sources: [],
        assumptions: [],
        unresolvedQuestions: [],
        evidenceState: "insufficient",
      }),
    );
    expect(parsed.answer).toBe("");
  });

  it("backfills document ids from chunkId before Zod when passages are provided", () => {
    const passages = [
      {
        chunkId: "chunk_lease_rent",
        documentId: "doc_lease",
        documentVersionId: "docv_lease_1",
        quote: "Tenant shall pay Base Rent of four thousand dollars ($4,000).",
      },
    ];
    const parsed = citedAnswerSchema.parse(
      normalizeCitedAnswerRaw(
        {
          answer: "$4,000",
          sources: [{ chunkId: "chunk_lease_rent", quote: passages[0]!.quote }],
          assumptions: [],
          unresolvedQuestions: [],
          evidenceState: "grounded",
        },
        passages,
      ),
    );
    expect(parsed.sources[0]?.documentId).toBe("doc_lease");
    expect(parsed.sources[0]?.documentVersionId).toBe("docv_lease_1");
  });

  it("still requires document ids when passages are not provided", () => {
    expect(() =>
      citedAnswerSchema.parse(
        normalizeCitedAnswerRaw({
          answer: "$4,000",
          sources: [{ chunkId: "chunk_lease_rent", quote: "four thousand dollars ($4,000)" }],
          assumptions: [],
          unresolvedQuestions: [],
          evidenceState: "grounded",
        }),
      ),
    ).toThrow();
  });
});

describe("contradiction confidence coercion", () => {
  const chunkA = "11111111-1111-1111-1111-111111111111";
  const chunkB = "22222222-2222-2222-2222-222222222222";

  it("accepts High and 0.9 as high", () => {
    for (const confidence of ["High", 0.9] as const) {
      const parsed = contradictionCandidatesSchema.parse({
        candidates: [
          {
            title: "Date conflict",
            explanation: "Sources disagree on the meeting date.",
            confidence,
            sideA: { chunkIds: [chunkA], summary: "Source A places the meeting on Monday." },
            sideB: { chunkIds: [chunkB], summary: "Source B places the meeting on Tuesday." },
          },
        ],
      });
      expect(parsed.candidates[0]?.confidence).toBe("high");
    }
  });

  it("still rejects a missing side after confidence coercion", () => {
    expect(() =>
      contradictionCandidatesSchema.parse({
        candidates: [
          {
            title: "One sided",
            explanation: "Missing side B",
            confidence: "High",
            sideA: { chunkIds: [chunkA], summary: "Witness said X happened on Monday." },
          },
        ],
      }),
    ).toThrow();
  });
});

describe("Nyaya / contradiction prompt contracts", () => {
  it("requires a string answer and decoy-resistant citation", () => {
    const prompt = buildNyayaSystemPrompt();
    expect(prompt).toMatch(/answer MUST be a single string/i);
    expect(prompt).toMatch(/near-miss decoy/i);
    expect(prompt).toMatch(/descending relevance/i);
    expect(prompt).toMatch(/Worked example \(SYNTH/i);
    expect(prompt).toMatch(/SYNTH false premise/i);
    expect(prompt).toMatch(/SYNTH amendment/i);
    expect(prompt).toMatch(/SYNTH amendment hedge/i);
    expect(prompt).toMatch(/only a partial picture/i);
    expect(prompt).toMatch(/Do not set grounded merely because an amendment chunk is present/i);
  });

  it("requires verified context to be used as partial without document cites", () => {
    const prompt = buildNyayaSystemPromptWithIntelligence();
    expect(prompt).toMatch(/evidenceState partial/i);
    expect(prompt).toMatch(/never insufficient solely because no document quote exists/i);
  });

  it("forbids numeric confidence and paraphrase-as-conflict", () => {
    const prompt = buildContradictionAnalysisSystemPrompt();
    expect(prompt).toMatch(/lowercase strings low, medium, or high/i);
    expect(prompt).toMatch(/on-or-about/i);
  });
});
