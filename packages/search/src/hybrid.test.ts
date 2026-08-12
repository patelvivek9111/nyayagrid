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
});
