import { describe, expect, it } from "vitest";
import {
  billedOutputTokensForCost,
  calculateActualCostUsd,
  costUsdFromPersistedUsage,
  thinkingBillingSemanticsForModel,
} from "../src/live/cost-accounting.js";

describe("provider-aware thinking billing semantics", () => {
  it("classifies Anthropic as included_in_output", () => {
    expect(thinkingBillingSemanticsForModel("claude-opus-5-5")).toBe("included_in_output");
    expect(thinkingBillingSemanticsForModel("claude-sonnet-5-5")).toBe("included_in_output");
  });

  it("classifies Gemini as additive_output", () => {
    expect(thinkingBillingSemanticsForModel("gemini-4-argon")).toBe("additive_output");
  });

  it("classifies OpenAI/xAI as ignore", () => {
    expect(thinkingBillingSemanticsForModel("gpt-6.1-sol")).toBe("ignore");
    expect(thinkingBillingSemanticsForModel("grok-4.7")).toBe("ignore");
  });
});

describe("Anthropic thinking tokens must not double-count", () => {
  it("bills output=8192 thinking=4000 as 8192", () => {
    expect(
      billedOutputTokensForCost({
        modelId: "claude-opus-5-5",
        outputTokens: 8192,
        thinkingTokens: 4000,
      }),
    ).toBe(8192);
  });

  it("bills output=5000 thinking=0 as 5000", () => {
    expect(
      billedOutputTokensForCost({
        modelId: "claude-opus-5-5",
        outputTokens: 5000,
        thinkingTokens: 0,
      }),
    ).toBe(5000);
  });

  it("bills output=5000 thinking=2500 as 5000", () => {
    expect(
      billedOutputTokensForCost({
        modelId: "claude-opus-5-5",
        outputTokens: 5000,
        thinkingTokens: 2500,
      }),
    ).toBe(5000);
  });

  it("Anthropic cost ignores thinkingTokens additive", () => {
    const base = calculateActualCostUsd({
      modelId: "claude-opus-5-5",
      inputTokens: 0,
      outputTokens: 1_000_000,
      thinkingTokens: 0,
    });
    const withThinking = calculateActualCostUsd({
      modelId: "claude-opus-5-5",
      inputTokens: 0,
      outputTokens: 1_000_000,
      thinkingTokens: 500_000,
    });
    expect(withThinking).toBe(base);
    expect(base).toBeCloseTo(20); // $20 / 1M output
  });

  it("Sonnet judge bucket also does not add thinking", () => {
    const a = calculateActualCostUsd({
      modelId: "claude-sonnet-5-5",
      inputTokens: 0,
      outputTokens: 1_000_000,
      thinkingTokens: 100_000,
      bucket: "judgeModels",
    });
    const b = calculateActualCostUsd({
      modelId: "claude-sonnet-5-5",
      inputTokens: 0,
      outputTokens: 1_000_000,
      bucket: "judgeModels",
    });
    expect(a).toBe(b);
  });
});

describe("Gemini additive thinking preserved", () => {
  it("still bills Gemini thinking as extra output", () => {
    const without = calculateActualCostUsd({
      modelId: "gemini-4-argon",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    const withThinking = calculateActualCostUsd({
      modelId: "gemini-4-argon",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      thinkingTokens: 500_000,
    });
    expect(withThinking).toBeGreaterThan(without);
    expect(withThinking - without).toBeCloseTo(5);
  });
});

describe("resume persisted usage recomputes corrected Anthropic cost", () => {
  it("ignores inflated fallback when tokens are present", () => {
    const corrected = costUsdFromPersistedUsage({
      modelId: "claude-opus-5-5",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      thinkingTokens: 400_000,
      fallbackCostUsd: 99,
      bucket: "models",
    });
    // input $4 + output $20 = $24 (thinking not added)
    expect(corrected).toBeCloseTo(24);
  });

  it("uses fallback only when token fields are empty", () => {
    expect(
      costUsdFromPersistedUsage({
        modelId: "claude-opus-5-5",
        inputTokens: 0,
        outputTokens: 0,
        fallbackCostUsd: 1.25,
      }),
    ).toBeCloseTo(1.25);
  });
});
