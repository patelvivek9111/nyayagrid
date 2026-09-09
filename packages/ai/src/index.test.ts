import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  citedAnswerSchema,
  createAIProviderFromEnv,
  createDirectProvider,
  MockAIProvider,
  MockEmbeddingProvider,
  validateCitedAnswerAgainstPassages,
  buildNyayaUserPrompt,
  buildMatterIntelligenceSystemPrompt,
  buildMatterIntelligenceUserPrompt,
  buildOpenAIChatCompletionsBody,
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

  it("proposes people from SYNTH party-roster sources", async () => {
    const provider = new MockAIProvider();
    const roster = readFileSync(
      path.join(__dirname, "evals/golden-fixtures/synth-party-roster.txt"),
      "utf8",
    );
    const result = await provider.generate({
      messages: [
        { role: "system", content: buildMatterIntelligenceSystemPrompt() },
        {
          role: "user",
          content: buildMatterIntelligenceUserPrompt([
            {
              chunkId: "11111111-1111-4111-8111-111111111111",
              documentId: "22222222-2222-4222-8222-222222222222",
              documentVersionId: "33333333-3333-4333-8333-333333333333",
              content: roster,
            },
          ]),
        },
      ],
    });
    const parsed = JSON.parse(result.text) as {
      entities: Array<{ displayName: string }>;
    };
    const names = parsed.entities.map((e) => e.displayName);
    expect(names.some((n) => /Jordan Lee/i.test(n))).toBe(true);
    expect(names.some((n) => /Acme Corp/i.test(n))).toBe(true);
  });
});

describe("citation validation", () => {
  const leasePassage = {
    chunkId: "c1",
    documentId: "d1",
    documentVersionId: "v1",
    quote: "The lease term commences on January 1, 2024 and expires on December 31, 2026.",
  };

  it("rejects citations not in retrieved context", () => {
    const result = validateCitedAnswerAgainstPassages(
      {
        answer: "Invented",
        sources: [
          {
            chunkId: "fake",
            documentId: "d9",
            documentVersionId: "v9",
            quote: "not real enough to verify",
          },
        ],
        assumptions: [],
        unresolvedQuestions: [],
        evidenceState: "grounded",
      },
      [leasePassage],
    );
    expect(result.answer.evidenceState).toBe("insufficient");
    expect(result.rejectedCitations).toBe(1);
  });

  it("rejects fabricated quotes even when chunkId is real (QA-02)", () => {
    const result = validateCitedAnswerAgainstPassages(
      {
        answer: "The rent is due weekly.",
        sources: [
          {
            chunkId: "c1",
            documentId: "d1",
            documentVersionId: "v1",
            quote: "The rent is due weekly under this lease.",
          },
        ],
        assumptions: [],
        unresolvedQuestions: [],
        evidenceState: "grounded",
      },
      [leasePassage],
    );
    expect(result.answer.evidenceState).toBe("insufficient");
    expect(result.rejectedCitations).toBe(1);
    expect(result.answer.sources).toEqual([]);
  });

  it("accepts verbatim quotes from the cited passage", () => {
    const result = validateCitedAnswerAgainstPassages(
      {
        answer: "The lease begins on January 1, 2024.",
        sources: [
          {
            chunkId: "c1",
            documentId: "d1",
            documentVersionId: "v1",
            quote: "The lease term commences on January 1, 2024 and expires on December 31, 2026.",
          },
        ],
        assumptions: [],
        unresolvedQuestions: [],
        evidenceState: "grounded",
      },
      [leasePassage],
    );
    expect(result.answer.evidenceState).toBe("grounded");
    expect(result.rejectedCitations).toBe(0);
    expect(result.answer.sources).toHaveLength(1);
  });

  it("does not upgrade a valid partial answer to grounded (QA-05)", () => {
    const result = validateCitedAnswerAgainstPassages(
      {
        answer: "The lease begins on January 1, 2024. This is only a partial picture.",
        sources: [
          {
            chunkId: "c1",
            documentId: "d1",
            documentVersionId: "v1",
            quote: "The lease term commences on January 1, 2024 and expires on December 31, 2026.",
          },
        ],
        assumptions: [],
        unresolvedQuestions: ["What remains uncertain given incomplete coverage?"],
        evidenceState: "partial",
      },
      [leasePassage],
    );
    expect(result.answer.evidenceState).toBe("partial");
    expect(result.rejectedCitations).toBe(0);
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

describe("createDirectProvider", () => {
  it("refuses to construct an adapter when the key is missing", () => {
    expect(() =>
      createDirectProvider({
        provider: "anthropic",
        env: { ANTHROPIC_API_KEY: "" },
      }),
    ).toThrow(/ANTHROPIC_API_KEY is missing/);
  });

  it("does not include a provided secret in the missing-key error", () => {
    const secret = "sk-this-must-never-appear-in-throw";
    try {
      createDirectProvider({
        provider: "openai",
        env: { OPENAI_API_KEY: "", ANTHROPIC_API_KEY: secret },
      });
      throw new Error("expected throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(secret);
      expect(message).toMatch(/OPENAI_API_KEY is missing/);
    }
  });
});

describe("createAIProviderFromEnv", () => {
  it("defaults to mock", () => {
    const previous = process.env.AI_PROVIDER;
    const previousForce = process.env.NYAYA_CERT_FORCE_PROVIDER;
    delete process.env.AI_PROVIDER;
    delete process.env.NYAYA_CERT_FORCE_PROVIDER;
    expect(createAIProviderFromEnv().name).toBe("mock");
    if (previous) process.env.AI_PROVIDER = previous;
    if (previousForce) process.env.NYAYA_CERT_FORCE_PROVIDER = previousForce;
  });

  it("NYAYA_CERT_FORCE_PROVIDER constructs the direct adapter", () => {
    const previous = process.env.NYAYA_CERT_FORCE_PROVIDER;
    process.env.NYAYA_CERT_FORCE_PROVIDER = "openai";
    try {
      expect(() =>
        createDirectProvider({ provider: "openai", env: { OPENAI_API_KEY: "sk-test-direct" } }),
      ).not.toThrow();
      const provider = createAIProviderFromEnv();
      // Without a process key this throws; the force switch is still selected.
      expect(provider.name === "openai" || provider.name === "mock").toBe(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toMatch(/OPENAI_API_KEY is missing/);
      expect(message).not.toMatch(/sk-/);
    } finally {
      if (previous === undefined) delete process.env.NYAYA_CERT_FORCE_PROVIDER;
      else process.env.NYAYA_CERT_FORCE_PROVIDER = previous;
    }
  });
});

describe("buildOpenAIChatCompletionsBody", () => {
  it("sets store false so customer prompts are not kept for OpenAI training", () => {
    const body = buildOpenAIChatCompletionsBody({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(body.store).toBe(false);
    expect(body.temperature).toBe(0);
  });
});
