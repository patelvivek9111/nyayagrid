import { describe, expect, it } from "vitest";
import { matchRelatedByName, presentMatterMemory } from "./present";

describe("presentMatterMemory", () => {
  it("never styles proposed memory as verified", () => {
    const presented = presentMatterMemory({
      id: "m1",
      memoryType: "verified_context",
      title: "Operative lease",
      content: "The SYNTH lease is operative.",
      status: "proposed",
      importance: "normal",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(presented.badge).toBe("suggested");
    expect(presented.badge).not.toBe("verified");
  });

  it("exposes chunk cites and related people", () => {
    const presented = presentMatterMemory({
      id: "m1",
      memoryType: "entity_resolution",
      title: "Jordan Lee is a party",
      content: "Jordan Lee appears on the roster.",
      status: "approved",
      importance: "high",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      sources: [
        {
          id: "s1",
          documentId: "d1",
          chunkId: "c1",
          page: 1,
          supportingText: "Jordan Lee, tenant",
          documentTitle: "Party roster",
        },
      ],
      relatedPeople: [{ id: "e1", displayName: "Jordan Lee" }],
    });
    expect(presented.badge).toBe("verified");
    expect(presented.sources).toHaveLength(1);
    expect(presented.relatedPeople[0]?.displayName).toBe("Jordan Lee");
  });
});

describe("matchRelatedByName", () => {
  it("links memory text to people whose names appear in the content", () => {
    const matches = matchRelatedByName(
      "Jordan Lee is a party to this matter",
      [
        { id: "e1", displayName: "Jordan Lee" },
        { id: "e2", displayName: "Unrelated" },
      ],
      (p) => p.displayName,
    );
    expect(matches.map((m) => m.id)).toEqual(["e1"]);
  });
});
