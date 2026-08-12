import { describe, expect, it } from "vitest";
import {
  citedAnswerSchema,
  createAIProviderFromEnv,
  MockAIProvider,
  MockEmbeddingProvider,
  validateCitedAnswerAgainstPassages,
  buildNyayaUserPrompt,
  EMBEDDING_DIMENSIONS,
} from "./index";

describe("MockAIProvider", () => {
  it("returns insufficient evidence without sources", async () => {
    const provider = new MockAIProvider();
    const result = await provider.generate({
      messages: [
        {
          role: "user",
          content: buildNyayaUserPrompt("What is the deadline?", []),
        },
      ],
    });
    expect(result.provider).toBe("mock");
    const parsed = citedAnswerSchema.parse(JSON.parse(result.text));
    expect(parsed.sources).toEqual([]);
    expect(parsed.evidenceState).toBe("insufficient");
  });

  it("grounds answer when passages support the question", async () => {
    const provider = new MockAIProvider();
    const passages = [
      {
        chunkId: "c1",
        documentId: "d1",
        documentVersionId: "v1",
        page: 1,
        segmentRef: "p1",
        quote: "The agreement was signed on January 15, 2024.",
      },
    ];
    const result = await provider.generate({
      messages: [
        {
          role: "user",
          content: buildNyayaUserPrompt("When was the agreement signed?", passages),
        },
      ],
    });
    const parsed = citedAnswerSchema.parse(JSON.parse(result.text));
    expect(parsed.evidenceState).toBe("grounded");
    expect(parsed.sources[0]?.chunkId).toBe("c1");
  });
});

describe("citation validation", () => {
  it("rejects citations not in retrieved context", () => {
    const result = validateCitedAnswerAgainstPassages(
      {
        answer: "Invented",
        sources: [
          {
            chunkId: "fake",
            documentId: "d9",
            documentVersionId: "v9",
            quote: "not real",
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
          quote: "real quote",
        },
      ],
    );
    expect(result.answer.evidenceState).toBe("insufficient");
    expect(result.rejectedCitations).toBe(1);
  });
});

describe("embeddings", () => {
  it("creates deterministic mock vectors", async () => {
    const provider = new MockEmbeddingProvider();
    const [a, b] = await provider.embed(["hello world", "hello world"]);
    expect(a).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(a).toEqual(b);
  });
});

describe("createAIProviderFromEnv", () => {
  it("defaults to mock", () => {
    const previous = process.env.AI_PROVIDER;
    delete process.env.AI_PROVIDER;
    expect(createAIProviderFromEnv().name).toBe("mock");
    if (previous) process.env.AI_PROVIDER = previous;
  });
});
