import { describe, expect, it } from "vitest";
import { assertHitsWithinScope, InMemoryMatterRetriever } from "./hybrid";

describe("retrieval scope", () => {
  it("rejects cross-org hits", () => {
    expect(() =>
      assertHitsWithinScope(
        [
          {
            documentId: "d1",
            documentVersionId: "v1",
            chunkId: "c1",
            organizationId: "org_b",
            matterId: "m1",
            score: 1,
            quote: "x",
          },
        ],
        { organizationId: "org_a", matterId: "m1", workspace: "professional" },
      ),
    ).toThrow(/organization/);
  });

  it("filters by matter in memory retriever", async () => {
    const retriever = new InMemoryMatterRetriever([
      {
        chunkId: "c1",
        documentId: "d1",
        documentVersionId: "v1",
        organizationId: "org_a",
        matterId: "m1",
        score: 1,
        quote: "termination clause requires thirty days notice",
      },
      {
        chunkId: "c2",
        documentId: "d2",
        documentVersionId: "v2",
        organizationId: "org_a",
        matterId: "m2",
        score: 1,
        quote: "termination clause requires thirty days notice",
      },
    ]);
    const hits = await retriever.search({
      text: "termination clause",
      scope: { organizationId: "org_a", matterId: "m1", workspace: "professional" },
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.matterId).toBe("m1");
  });

  it("never returns Matter A secret text when querying Matter B", async () => {
    const secret = "BETA-SEC-PHRASE-MATTER-A-ONLY-9f3c";
    const retriever = new InMemoryMatterRetriever([
      {
        chunkId: "c-a",
        documentId: "d-a",
        documentVersionId: "v-a",
        organizationId: "org_a",
        matterId: "matter_a",
        score: 1,
        quote: `Confidential settlement figure ${secret}`,
      },
      {
        chunkId: "c-b",
        documentId: "d-b",
        documentVersionId: "v-b",
        organizationId: "org_a",
        matterId: "matter_b",
        score: 1,
        quote: "Public scheduling order for the unrelated matter",
      },
    ]);
    const hits = await retriever.search({
      text: secret,
      scope: { organizationId: "org_a", matterId: "matter_b", workspace: "professional" },
    });
    expect(hits.every((hit) => hit.matterId === "matter_b")).toBe(true);
    expect(hits.some((hit) => hit.quote.includes(secret))).toBe(false);
  });
});
