import { describe, expect, it, vi } from "vitest";
import type { Database } from "@nyayagrid/database";
import type { EmbeddingProvider } from "@nyayagrid/ai";
import { GuardedAuthorityRetriever, ResearchCorpusUnavailableError } from "../index";

const mockEmbeddings: EmbeddingProvider = {
  name: "mock",
  model: "mock-embed",
  dimensions: 8,
  async embed(texts: string[]) {
    return texts.map(() => Array.from({ length: 8 }, (_, i) => i * 0.01));
  },
};

describe("GuardedAuthorityRetriever", () => {
  it("fails closed when Neon corpus flag is on without CORPUS_DATABASE_URL", async () => {
    const productDb = {} as Database;
    const retriever = new GuardedAuthorityRetriever({
      productDb,
      embeddings: mockEmbeddings,
      env: { FEATURE_NEON_CORPUS_RESEARCH: "1" },
    });
    await expect(retriever.search("Miranda")).rejects.toBeInstanceOf(
      ResearchCorpusUnavailableError,
    );
  });

  it("does not use product DB as silent Neon substitute when flag on", async () => {
    const productDb = {
      execute: vi.fn(async () => {
        throw new Error("product DB should not be queried for corpus when flag on without URL");
      }),
    } as unknown as Database;
    const retriever = new GuardedAuthorityRetriever({
      productDb,
      embeddings: mockEmbeddings,
      env: { FEATURE_NEON_CORPUS_RESEARCH: "1" },
    });
    await expect(retriever.search("test")).rejects.toThrow(
      /RESEARCH_CORPUS_UNAVAILABLE|CORPUS_DATABASE_URL/,
    );
    expect(productDb.execute).not.toHaveBeenCalled();
  });

  it("lookupIdentity returns allowOpinionQuote=false for identity-only classification", async () => {
    const rows = [
      {
        id: "11111111-1111-1111-1111-111111111111",
        canonical_source_url: "https://example.test/a",
        source_external_id: "1",
        source_provider: "courtlistener",
        ingestion_status: "ready",
        identity_only: "true",
        corpus_complete: "false",
        text_chars: 0,
        has_text: false,
        has_emb: false,
      },
    ];
    const productDb = {
      execute: vi.fn(async () => rows),
    } as unknown as Database;
    const retriever = new GuardedAuthorityRetriever({
      productDb,
      embeddings: mockEmbeddings,
      env: { FEATURE_NEON_CORPUS_RESEARCH: "0" },
    });
    const identity = await retriever.lookupIdentity(rows[0]!.id);
    expect(identity?.allowOpinionQuote).toBe(false);
    expect(identity?.eligibility.classes).toContain("IDENTITY_ONLY");
  });
});
