import { describe, expect, it } from "vitest";
import {
  authorityRelevanceExplanationSchema,
  buildQueryDecompositionSystemPrompt,
  buildResearchSynthesisSystemPrompt,
  extractResearchAuthorityChunksFromPrompt,
  formatResearchAuthorityChunks,
  legalPropositionSchema,
  memoPropositionSchema,
  mockLegalIssueExtraction,
  mockQueryDecomposition,
  mockResearchMemo,
  mockResearchSynthesis,
  mockQuoteCandidates,
  queryDecompositionSchema,
  researchMemoSchema,
  researchSynthesisSchema,
  type ResearchAuthorityChunk,
} from "./research";
import { MockAIProvider } from "./index";
import { formatProfessionalChunks, type ProfessionalChunk } from "./professional";

const authorityChunk: ResearchAuthorityChunk = {
  authorityId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  chunkId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  citation: "Mock v. Example, 123 F.3d 456 (2020)",
  court: "Example Circuit",
  date: "2020-01-15",
  content:
    "A party may recover damages only upon proving breach of a material term and resulting harm.",
};

const matterChunk: ProfessionalChunk = {
  chunkId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  documentId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  documentVersionId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
  page: 2,
  segmentRef: "p2",
  content: "Plaintiff alleges material breach of the termination notice provision.",
};

describe("research schemas", () => {
  it("rejects a legal proposition with no authority ids", () => {
    expect(() =>
      legalPropositionSchema.parse({
        text: "Unsupported proposition",
        authorityIds: [],
        chunkIds: [],
      }),
    ).toThrow();

    expect(() =>
      researchSynthesisSchema.parse({
        conciseAnswer: "Answer",
        legalPropositions: [{ text: "Unsupported proposition", authorityIds: [], chunkIds: [] }],
        supportingAuthorities: [],
        contraryAuthorities: [],
        importantDistinctions: [],
        jurisdictionCaveats: [],
        unresolvedIssues: [],
        coverageWarnings: [],
        sources: [],
      }),
    ).toThrow();
  });

  it("rejects invalid UUIDs on research schemas", () => {
    expect(() =>
      legalPropositionSchema.parse({
        text: "Proposition",
        authorityIds: ["not-a-uuid"],
        chunkIds: [],
      }),
    ).toThrow();

    expect(() =>
      authorityRelevanceExplanationSchema.parse({
        authorityId: "bad-id",
        explanation: "Explanation",
        supportingChunkIds: [authorityChunk.chunkId],
        limitations: [],
      }),
    ).toThrow();

    expect(() =>
      memoPropositionSchema.parse({
        text: "Memo proposition",
        authorityIds: ["1234"],
        chunkIds: [],
      }),
    ).toThrow();
  });

  it("accepts grounded research synthesis with authority-backed propositions", () => {
    const parsed = researchSynthesisSchema.parse({
      conciseAnswer: "Grounded answer",
      legalPropositions: [
        {
          text: "Material breach requires failure of a material term.",
          authorityIds: [authorityChunk.authorityId],
          chunkIds: [authorityChunk.chunkId],
        },
      ],
      supportingAuthorities: [authorityChunk.authorityId],
      contraryAuthorities: [],
      importantDistinctions: [],
      jurisdictionCaveats: [],
      unresolvedIssues: [],
      coverageWarnings: [],
      sources: [
        {
          authorityId: authorityChunk.authorityId,
          chunkId: authorityChunk.chunkId,
          quote: authorityChunk.content.slice(0, 80),
        },
      ],
    });
    expect(parsed.legalPropositions).toHaveLength(1);
  });

  it("accepts query decomposition with at least one sub-query", () => {
    const parsed = queryDecompositionSchema.parse({
      subQueries: [{ query: "What is the standard for material breach?", priority: "primary" }],
      jurisdictionHints: ["Federal"],
      coverageWarnings: [],
    });
    expect(parsed.subQueries).toHaveLength(1);
  });
});

describe("research authority chunk formatting", () => {
  it("round-trips authority chunks through the prompt format", () => {
    const prompt = formatResearchAuthorityChunks([authorityChunk]);
    const extracted = extractResearchAuthorityChunksFromPrompt(`LegalAuthority:\n${prompt}`);
    expect(extracted).toHaveLength(1);
    expect(extracted[0]?.authorityId).toBe(authorityChunk.authorityId);
    expect(extracted[0]?.chunkId).toBe(authorityChunk.chunkId);
    expect(extracted[0]?.content).toBe(authorityChunk.content);
  });
});

describe("mock research helpers", () => {
  const authorityPrompt = `Research question: Material breach standard\nLegalAuthority:\n${formatResearchAuthorityChunks([authorityChunk])}`;
  const matterPrompt = `Matter: Acme v. Beta\nResearch question: Termination notice\nMatterContext:\n${formatProfessionalChunks([matterChunk])}`;

  it("mockQueryDecomposition returns primary and secondary sub-queries for comparative questions", () => {
    const result = mockQueryDecomposition(
      "Research question: Compare termination notice versus material breach\nJurisdiction: Delaware",
    );
    expect(result.subQueries.length).toBeGreaterThanOrEqual(1);
    expect(result.jurisdictionHints).toContain("Delaware");
  });

  it("mockLegalIssueExtraction grounds search concepts in matter context without legal conclusions", () => {
    const result = mockLegalIssueExtraction(matterPrompt);
    expect(result.searchConcepts.length).toBeGreaterThan(0);
    expect(result.searchConcepts[0]?.matterChunkIds).toEqual([matterChunk.chunkId]);
    expect(result.searchConcepts[0]?.rationale).toMatch(/research planning/i);
  });

  it("mockResearchSynthesis cites provided authority passages", () => {
    const result = mockResearchSynthesis(authorityPrompt);
    expect(result.legalPropositions[0]?.authorityIds).toEqual([authorityChunk.authorityId]);
    expect(result.sources[0]?.chunkId).toBe(authorityChunk.chunkId);
    expect(result.coverageWarnings.length).toBeGreaterThan(0);
  });

  it("mockQuoteCandidates copies quotes from authority passages", () => {
    const result = mockQuoteCandidates(
      `Proposition: Material breach\nLegalAuthority:\n${formatResearchAuthorityChunks([authorityChunk])}`,
    );
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0]?.quote).toContain("material term");
  });

  it("mockResearchMemo maps propositions to authority ids", () => {
    const result = mockResearchMemo(
      `Matter: Acme v. Beta\nResearch question: Material breach\nMatterContext:\n${formatProfessionalChunks([matterChunk])}\nLegalAuthority:\n${formatResearchAuthorityChunks([authorityChunk])}`,
    );
    const parsed = researchMemoSchema.parse(result);
    expect(parsed.propositions[0]?.authorityIds).toEqual([authorityChunk.authorityId]);
    expect(parsed.factsAssumptions).toContain("termination notice");
  });
});

describe("MockAIProvider research routing", () => {
  it("routes query decomposition prompts to deterministic JSON", async () => {
    const provider = new MockAIProvider();
    const result = await provider.generate({
      messages: [
        { role: "system", content: buildQueryDecompositionSystemPrompt() },
        { role: "user", content: "Research question: Material breach standard" },
      ],
    });
    const parsed = queryDecompositionSchema.parse(JSON.parse(result.text));
    expect(parsed.subQueries.length).toBeGreaterThan(0);
  });

  it("routes research synthesis prompts to deterministic JSON", async () => {
    const provider = new MockAIProvider();
    const result = await provider.generate({
      messages: [
        { role: "system", content: buildResearchSynthesisSystemPrompt() },
        {
          role: "user",
          content: `Research question: Material breach\nLegalAuthority:\n${formatResearchAuthorityChunks([authorityChunk])}`,
        },
      ],
    });
    const parsed = researchSynthesisSchema.parse(JSON.parse(result.text));
    expect(parsed.legalPropositions.length).toBeGreaterThan(0);
  });
});
