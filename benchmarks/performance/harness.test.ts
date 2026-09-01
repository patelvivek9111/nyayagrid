import { describe, expect, it } from "vitest";
import { classifyFailure, percentile, runConcurrent, summarizeLatencies } from "./harness";

describe("performance harness", () => {
  it("computes percentiles", () => {
    const samples = [10, 20, 30, 40, 50];
    expect(percentile(samples, 50)).toBe(30);
    expect(percentile(samples, 95)).toBe(50);
    expect(summarizeLatencies(samples).n).toBe(5);
  });

  it("classifies rate-limit vs provider 429", () => {
    expect(classifyFailure(new Error("RATE_LIMITED"))).toBe("rate_limit");
    expect(classifyFailure(new Error("OpenAI request failed with status 429"))).toBe(
      "provider_429",
    );
    expect(classifyFailure(new Error("timed out after 30000ms"))).toBe("timeout");
  });

  it("runs a bounded concurrent worker pool", async () => {
    let peak = 0;
    let current = 0;
    const { results } = await runConcurrent(3, 9, async (index) => {
      current += 1;
      peak = Math.max(peak, current);
      await new Promise((r) => setTimeout(r, 5));
      current -= 1;
      return index;
    });
    expect(results).toHaveLength(9);
    expect(peak).toBeLessThanOrEqual(3);
  });
});
