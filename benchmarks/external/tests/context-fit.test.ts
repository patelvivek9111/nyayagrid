import { describe, expect, it } from "vitest";
import { assessContextFit, assertNoSilentTruncate } from "../src/live/context-fit.js";

describe("context-fit", () => {
  it("marks full context when within window", () => {
    expect(
      assessContextFit({ inputTokensEstimate: 1000, maxOutputTokens: 800, contextWindow: 2000 }),
    ).toBe("FULL_CONTEXT_SUPPORTED");
  });

  it("requires truncation policy when over window", () => {
    expect(
      assessContextFit({
        inputTokensEstimate: 1000,
        maxOutputTokens: 800,
        contextWindow: 1500,
        truncationPolicyDefined: true,
      }),
    ).toBe("REQUIRES_DEFINED_TRUNCATION_POLICY");
  });

  it("ineligible without truncation policy", () => {
    expect(
      assessContextFit({ inputTokensEstimate: 1000, maxOutputTokens: 800, contextWindow: 1500 }),
    ).toBe("INELIGIBLE");
    expect(() => assertNoSilentTruncate("INELIGIBLE")).toThrow(/silent truncation/);
  });
});
