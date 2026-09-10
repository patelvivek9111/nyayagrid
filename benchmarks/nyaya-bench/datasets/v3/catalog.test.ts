import { describe, expect, it } from "vitest";
import { allTests, catalogFingerprint, catalogStats, V3_MATTERS } from "./catalog";

describe("V3 frozen catalog", () => {
  it("is large enough and has unique test ids", () => {
    const stats = catalogStats();
    expect(stats.matterCount).toBe(30);
    expect(stats.testCount).toBeGreaterThanOrEqual(500);
    const ids = allTests().map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(V3_MATTERS.some((m) => m.kind === "injection")).toBe(true);
    expect(V3_MATTERS.some((m) => m.org === "B")).toBe(true);
    expect(catalogFingerprint()).toHaveLength(64);
  });
});
