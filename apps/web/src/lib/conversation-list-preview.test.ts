import { describe, expect, it } from "vitest";
import { conversationListPreview } from "./conversation-list-preview";

describe("conversationListPreview", () => {
  it("uses the latest user question instead of a later assistant answer", () => {
    const result = conversationListPreview([
      { role: "assistant", content: "Physical-entry credentials are in Exhibit C." },
      { role: "user", content: "What are the physical entry credentials?" },
      { role: "assistant", content: "Base rent is $37,650 per month." },
      { role: "user", content: "What is the monthly base rent?" },
    ]);
    expect(result.preview).toBe("What are the physical entry credentials?");
    expect(result.lastRole).toBe("assistant");
  });

  it("falls back to the last message when there is no user turn", () => {
    expect(
      conversationListPreview([{ role: "assistant", content: "Draft work product only." }]),
    ).toEqual({
      preview: "Draft work product only.",
      lastRole: "assistant",
    });
  });

  it("returns empty for no messages and truncates long user text", () => {
    expect(conversationListPreview([])).toEqual({ preview: null, lastRole: null });
    const long = `Q${"x".repeat(200)}`;
    const result = conversationListPreview([{ role: "user", content: long }]);
    expect(result.preview).toHaveLength(160);
    expect(result.lastRole).toBe("user");
  });
});
