import { describe, expect, it } from "vitest";
import { buildCacheKey, contentHashFromText } from "../src/live/cache-key.js";

describe("cache-key", () => {
  it("is stable for same inputs", () => {
    const input = {
      revision: "rev1",
      taskId: "t1",
      contentHash: contentHashFromText("hello"),
      provider: "openai",
      modelId: "gpt-6.1-sol",
      settingsHash: "s1",
      promptHashes: ["p1", "p2"],
      schemaVersion: 1,
      kind: "response" as const,
    };
    expect(buildCacheKey(input)).toBe(buildCacheKey(input));
  });

  it("changes when model changes", () => {
    const base = {
      revision: "rev1",
      taskId: "t1",
      contentHash: "abc",
      provider: "openai",
      modelId: "gpt-6.1-sol",
      settingsHash: "s1",
      promptHashes: ["p1"],
      schemaVersion: 1,
      kind: "response" as const,
    };
    const other = { ...base, modelId: "gpt-6-luna" };
    expect(buildCacheKey(base)).not.toBe(buildCacheKey(other));
  });
});
