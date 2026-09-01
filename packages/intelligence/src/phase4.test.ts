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

  it("formats active memory for prompts with origin preserved", () => {
    const text = formatActiveMemoryForPrompt([
      {
        title: "Operative agreement",
        content: "Exhibit 12 is operative.",
        memoryType: "document_significance",
        importance: "high",
        origin: "manual",
        status: "approved",
        sourceReference: {},
      },
    ]);
    expect(text).toContain("Approved Matter Memory");
    expect(text).toContain("reviewed user-provided information");
    expect(text).toContain("Exhibit 12");
  });

  it("does not format unreviewed memory as approved context", () => {
    const text = formatActiveMemoryForPrompt([
      {
        title: "Client payment statement",
        content: "Client says payment was made on Friday.",
        memoryType: "user_instruction",
        importance: "normal",
        origin: "manual",
        status: "proposed",
      },
    ]);
    expect(text).toBe("");
  });
});
