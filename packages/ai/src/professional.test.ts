import { describe, expect, it } from "vitest";
import {
  contractAnalysisItemSchema,
  contractAnalysisSchema,
  draftAssertionSchema,
  draftGenerationSchema,
  depositionFindingSchema,
  extractProfessionalChunksFromPrompt,
  findExactCrossDocumentDateConflicts,
  formatProfessionalChunks,
  mergeContradictionCandidates,
  mockContractAnalysis,
  mockContradictionCandidates,
  mockDepositionAnalysis,
  mockDiscoveryClassification,
  mockDraftGeneration,
  mockRedlineSuggestions,
  normalizeAnalysisAttention,
  normalizeConfidenceLevel,
  parseDepositionAnalysis,
  parseContractAnalysis,
  selectRelatedChunksForDeposition,
  buildDepositionAnalysisSystemPrompt,
  type ProfessionalChunk,
} from "./professional";

const chunk: ProfessionalChunk = {
  chunkId: "11111111-1111-1111-1111-111111111111",
  documentId: "22222222-2222-2222-2222-222222222222",
  documentVersionId: "33333333-3333-3333-3333-333333333333",
  page: 1,
  segmentRef: "p1",
  content: "Either party may terminate this Agreement upon thirty (30) days written notice.",
};

describe("professional analysis schemas", () => {
  it("rejects a draft assertion with no source chunk ids", () => {
    expect(() => draftAssertionSchema.parse({ text: "Grounded claim", chunkIds: [] })).toThrow();
    expect(() =>
      draftGenerationSchema.parse({
        content: "Draft body",
        assertions: [{ text: "Ungrounded claim", chunkIds: [] }],
        assumptions: [],
      }),
    ).toThrow();
  });

  it("accepts a draft generation with at least one grounded assertion", () => {
    const parsed = draftGenerationSchema.parse({
      content: "Draft body",
      assertions: [{ text: "Grounded claim", chunkIds: [chunk.chunkId] }],
      assumptions: [],
    });
    expect(parsed.assertions).toHaveLength(1);
  });

  it("rejects a contract analysis item with no source chunk ids", () => {
    expect(() =>
      contractAnalysisItemSchema.parse({
        category: "termination",
        title: "Termination clause",
        explanation: "Review termination notice period.",
        attention: "review",
        sourceChunkIds: [],
      }),
    ).toThrow();

    expect(() =>
      contractAnalysisSchema.parse({
        summary: "Summary",
        items: [
          {
            category: "termination",
            title: "Termination clause",
            explanation: "Review termination notice period.",
            attention: "review",
            sourceChunkIds: [],
          },
        ],
      }),
    ).toThrow();
  });

  it("accepts a contract analysis item with a source chunk id", () => {
    const parsed = contractAnalysisSchema.parse({
      summary: "Summary",
      items: [
        {
          category: "termination",
          title: "Termination clause",
          explanation: "Review termination notice period.",
          attention: "review",
          sourceChunkIds: [chunk.chunkId],
        },
      ],
    });
    expect(parsed.items).toHaveLength(1);
  });

  it("keeps a valid contract item when a sibling row is malformed", () => {
    const parsed = parseContractAnalysis({
      summary: "Review this instrument.",
      items: [
        {
          category: "notice",
          title: "Formal notice period",
          explanation: "Formal notice requires 45 days.",
          attention: "High",
          sourceChunkIds: [chunk.chunkId],
        },
        {
          category: "notice",
          title: "Broken row",
          explanation: "x",
          attention: "urgent",
          sourceChunkIds: [],
        },
      ],
    });
    expect(parsed.analysis.items).toHaveLength(1);
    expect(parsed.rejectedMalformed).toBe(1);
    expect(parsed.normalizedCount).toBe(1);
    expect(parsed.analysis.items[0]?.attention).toBe("high_attention");
    expect(parsed.analysis.items[0]?.explanation).toContain("45 days");
  });

  it("rejects a deposition finding with no source chunk ids", () => {
    expect(() =>
      depositionFindingSchema.parse({
        findingType: "denial",
        title: "Notable testimony segment",
        confidence: "medium",
        attention: "review",
        sourceChunkIds: [],
      }),
    ).toThrow();
  });
});

describe("deposition analysis normalization", () => {
  const validFinding = {
    findingType: "denial",
    title: "Witness denied entering the records room",
    explanation: "The witness testified that they never entered the records room.",
    confidence: "high",
    attention: "review",
    sourceChunkIds: [chunk.chunkId],
    supportingQuotes: ["No, I never entered the records room."],
  };

  it("reuses existing numeric confidence thresholds", () => {
    expect(normalizeConfidenceLevel(0.91)).toBe("high");
    expect(normalizeConfidenceLevel(0.4)).toBe("medium");
    expect(normalizeConfidenceLevel(0.2)).toBe("low");
    expect(normalizeConfidenceLevel("HIGH")).toBe("high");
  });

  it("maps attention representation variants without changing the persisted enum", () => {
    expect(normalizeAnalysisAttention("High")).toBe("high_attention");
    expect(normalizeAnalysisAttention("HIGH")).toBe("high_attention");
    expect(normalizeAnalysisAttention("high")).toBe("high_attention");
    expect(normalizeAnalysisAttention("Medium")).toBe("review");
    expect(normalizeAnalysisAttention("low")).toBe("informational");
    expect(normalizeAnalysisAttention("urgent")).toBe("urgent");
  });

  it("accepts AN1-style High/numeric variants and persists canonical enums", () => {
    const parsed = parseDepositionAnalysis({
      summary: "Review testimony.",
      findings: [
        {
          ...validFinding,
          confidence: 0.91,
          attention: "High",
          findingType: "Denial",
        },
      ],
    });
    expect(parsed.rejectedMalformed).toBe(0);
    expect(parsed.normalizedCount).toBe(1);
    expect(parsed.analysis.findings).toHaveLength(1);
    expect(parsed.analysis.findings[0]?.confidence).toBe("high");
    expect(parsed.analysis.findings[0]?.attention).toBe("high_attention");
    expect(parsed.analysis.findings[0]?.findingType).toBe("denial");
  });

  it("keeps a valid finding when a sibling row is malformed", () => {
    const parsed = parseDepositionAnalysis({
      summary: "Mixed payload",
      findings: [
        validFinding,
        {
          findingType: "denial",
          title: "Broken row",
          confidence: "not-a-level",
          attention: "urgent",
          sourceChunkIds: [chunk.chunkId],
        },
      ],
    });
    expect(parsed.analysis.findings).toHaveLength(1);
    expect(parsed.analysis.findings[0]?.title).toBe(validFinding.title);
    expect(parsed.rejectedMalformed).toBe(1);
  });

  it("demotes a parsed inconsistency that pairs physical denial with credential activity", () => {
    const parsed = parseDepositionAnalysis({
      summary: "Review testimony.",
      findings: [
        {
          findingType: "inconsistency",
          title: "Warehouse denial versus badge log",
          explanation:
            "The witness denied entering the Ohio warehouse. A badge assigned to them recorded ACCESS GRANTED.",
          confidence: "high",
          attention: "review",
          sourceChunkIds: [chunk.chunkId],
          supportingQuotes: [
            "A. I never entered the Ohio warehouse.",
            "Badge WH-19 assigned to Alex Rivera — ACCESS GRANTED.",
          ],
        },
      ],
    });
    expect(parsed.analysis.findings[0]?.findingType).toBe("tension");
    expect(parsed.normalizedCount).toBeGreaterThan(0);
  });

  it("does not rewrite factual meaning when normalizing", () => {
    const parsed = parseDepositionAnalysis({
      summary: null,
      findings: [
        {
          ...validFinding,
          title: "Witness denied entering the records room",
          explanation: "The witness testified that they never entered.",
          confidence: "High",
        },
      ],
    });
    expect(parsed.analysis.findings[0]?.title).toBe("Witness denied entering the records room");
    expect(parsed.analysis.findings[0]?.explanation).toContain("never entered");
  });

  it("round-robins related chunks across documents", () => {
    const chunks: ProfessionalChunk[] = [
      {
        ...chunk,
        chunkId: "11111111-1111-4111-8111-111111111111",
        documentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
      {
        ...chunk,
        chunkId: "22222222-2222-4222-8222-222222222222",
        documentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
      {
        ...chunk,
        chunkId: "33333333-3333-4333-8333-333333333333",
        documentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
    ];
    const selected = selectRelatedChunksForDeposition(chunks, 2);
    expect(selected).toHaveLength(2);
    expect(new Set(selected.map((row) => row.documentId)).size).toBe(2);
  });
});

describe("professional chunk formatting", () => {
  it("round-trips chunks through the prompt format", () => {
    const prompt = formatProfessionalChunks([chunk]);
    const extracted = extractProfessionalChunksFromPrompt(`Sources:\n${prompt}`);
    expect(extracted).toHaveLength(1);
    expect(extracted[0]?.chunkId).toBe(chunk.chunkId);
    expect(extracted[0]?.content).toBe(chunk.content);
  });
});

describe("mock professional analysis helpers", () => {
  const userPrompt = `Document: Services Agreement\nSources:\n${formatProfessionalChunks([chunk])}`;

  it("mockDraftGeneration grounds content in the provided source chunk", () => {
    const result = mockDraftGeneration(`Draft type: memo\n${userPrompt}`);
    expect(result.assertions).toHaveLength(1);
    expect(result.assertions[0]?.chunkIds).toEqual([chunk.chunkId]);
  });

  it("mockContractAnalysis flags termination language with a cited item", () => {
    const result = mockContractAnalysis(userPrompt);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]?.sourceChunkIds).toEqual([chunk.chunkId]);
    expect(result.items[0]?.attention).toBe("high_attention");
  });

  it("mockRedlineSuggestions only fires on risk-flagged language", () => {
    const noRisk = mockRedlineSuggestions(userPrompt);
    expect(noRisk.suggestions).toEqual([]);

    const riskyChunk: ProfessionalChunk = {
      ...chunk,
      content: "The Company may withhold approval in its sole discretion.",
    };
    const riskyPrompt = `Document: Services Agreement\nSources:\n${formatProfessionalChunks([riskyChunk])}`;
    const withRisk = mockRedlineSuggestions(riskyPrompt);
    expect(withRisk.suggestions.length).toBeGreaterThan(0);
    expect(withRisk.suggestions[0]?.chunkId).toBe(chunk.chunkId);
  });

  it("mockDepositionAnalysis flags denial/admission language with citations", () => {
    const denialChunk: ProfessionalChunk = {
      ...chunk,
      content: "No, I never signed anything of the sort and I deny agreeing to those terms.",
    };
    const prompt = `Transcript: Deposition\nSources:\n${formatProfessionalChunks([denialChunk])}`;
    const result = mockDepositionAnalysis(prompt);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0]?.sourceChunkIds).toEqual([chunk.chunkId]);
  });

  it("deposition prompt requires canonical enums and empty findings when nothing material exists", () => {
    const prompt = buildDepositionAnalysisSystemPrompt();
    expect(prompt).toMatch(/never a number, never High/);
    expect(prompt).toMatch(/informational, review, or high_attention/);
    expect(prompt).toMatch(/Return no finding rather than inventing one/);
    expect(prompt).toMatch(/not independent proof of a named person's physical conduct/);
  });

  it("mockDiscoveryClassification never marks privilege final and uses unknown by default", () => {
    const result = mockDiscoveryClassification("Excerpt:\nGeneral business correspondence.");
    expect(result.privilege).toBe("unknown");

    const privileged = mockDiscoveryClassification(
      "Excerpt:\nMemo from outside counsel reflecting attorney work product.",
    );
    expect(privileged.privilege).toBe("potentially_privileged");
  });

  it("finds the golden CAM send-date conflict across depo and PM email", () => {
    const depo: ProfessionalChunk = {
      chunkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      documentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      documentVersionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      content:
        "Q: When did you send the February CAM package? A: I emailed the package on February 28, 2025, and Tenant confirmed receipt the same day.",
    };
    const pmEmail: ProfessionalChunk = {
      chunkId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      documentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      documentVersionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      content:
        "Following up — the February CAM package was uploaded to the portal on March 3, 2025; I do not see an earlier transmission.",
    };
    const estimate: ProfessionalChunk = {
      chunkId: "11111111-1111-4111-8111-111111111111",
      documentId: pmEmail.documentId,
      documentVersionId: pmEmail.documentVersionId,
      content:
        "Separately, the estimated February CAM worksheet was prepared internally on February 15, 2025, and is not a transmittal to Tenant.",
    };
    const found = findExactCrossDocumentDateConflicts([depo, pmEmail, estimate]);
    expect(found.candidates).toHaveLength(1);
    expect(found.candidates[0]?.sideA.chunkIds).toEqual([depo.chunkId]);
    expect(found.candidates[0]?.sideB.chunkIds).toEqual([pmEmail.chunkId]);
  });

  it("prefers the CAM send-date pair in the mock contradiction path", () => {
    const depo: ProfessionalChunk = {
      chunkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      documentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      documentVersionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      content:
        "Q: When did you send the February CAM package? A: I emailed the package on February 28, 2025.",
    };
    const pmEmail: ProfessionalChunk = {
      chunkId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      documentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      documentVersionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      content:
        "The February CAM package was uploaded to the portal on March 3, 2025; I do not see an earlier transmission.",
    };
    const result = mockContradictionCandidates(
      `Matter: SYNTH\nSources:\n${formatProfessionalChunks([depo, pmEmail])}`,
    );
    expect(result.candidates[0]?.title).toMatch(/CAM send dates/i);
  });

  it("mergeContradictionCandidates keeps deterministic CAM pairs first", () => {
    const cam = findExactCrossDocumentDateConflicts([
      {
        chunkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        documentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        documentVersionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        content: "I emailed the February CAM package on February 28, 2025.",
      },
      {
        chunkId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        documentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        documentVersionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        content: "The February CAM package was uploaded on March 3, 2025 transmission.",
      },
    ]).candidates;
    const merged = mergeContradictionCandidates(
      [
        {
          title: "Other tension",
          explanation: "Unrelated pair.",
          confidence: "low",
          sideA: { chunkIds: ["11111111-1111-4111-8111-111111111111"], summary: "A" },
          sideB: { chunkIds: ["22222222-2222-4222-8222-222222222222"], summary: "B" },
        },
      ],
      cam,
    );
    expect(merged[0]?.title).toMatch(/CAM send dates/i);
    expect(merged).toHaveLength(2);
  });
});
