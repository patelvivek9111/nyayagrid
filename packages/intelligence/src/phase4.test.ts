import { describe, expect, it } from "vitest";
import { edgeDedupeKey } from "./graph/materialize";
import { formatActiveMemoryForPrompt } from "./memory/index";

describe("phase 4 graph/memory helpers", () => {
  it("builds stable edge dedupe keys", () => {
    expect(
      edgeDedupeKey({
        fromNodeId: "a",
        toNodeId: "b",
        relationshipType: "works_for",
      }),
    ).toBe("a|works_for|b|directed");
  });

  it("formats active memory for prompts", () => {
    const text = formatActiveMemoryForPrompt([
      {
        title: "Operative agreement",
        content: "Exhibit 12 is operative.",
        memoryType: "document_significance",
        importance: "high",
      },
    ]);
    expect(text).toContain("Approved Matter Memory");
    expect(text).toContain("Exhibit 12");
  });
});
