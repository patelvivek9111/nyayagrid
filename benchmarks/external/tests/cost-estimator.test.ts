import { describe, expect, it } from "vitest";
import { estimateRunCost } from "../src/cost/estimator.js";

describe("cost estimator", () => {
  it("separates response and judge costs", () => {
    const breakdown = estimateRunCost({
      responseModelId: "openai/gpt-4o-mini",
      responseTokens: { inputTokens: 1_000_000, outputTokens: 0 },
      judgeModelId: "openai/gpt-4o-mini",
      judgeTokens: { inputTokens: 100_000, outputTokens: 10_000 },
      repeatCount: 2,
    });
    expect(breakdown.responseCost).toBeCloseTo(0.3, 5);
    expect(breakdown.judgeCost).toBeGreaterThan(0);
    expect(breakdown.totalCost).toBe(breakdown.responseCost + breakdown.judgeCost);
  });
});
