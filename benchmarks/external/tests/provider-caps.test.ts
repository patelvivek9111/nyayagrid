import { describe, expect, it } from "vitest";
import {
  assertWithinProviderCaps,
  emptyProviderSpend,
  parseProviderCaps,
  recordProviderSpend,
  ProviderCapError,
} from "../src/live/provider-caps.js";
import { mapWithConcurrency, parseConcurrency } from "../src/live/concurrency.js";

describe("provider caps", () => {
  it("parses per-provider dollar caps from argv", () => {
    const caps = parseProviderCaps([
      "--max-openai-usd",
      "5",
      "--max-judge-usd",
      "3",
      "--max-retries",
      "2",
    ]);
    expect(caps.openai?.maxDollars).toBe(5);
    expect(caps.maxJudgeDollars).toBe(3);
    expect(caps.maxRetries).toBe(2);
  });

  it("stops when provider dollar cap would be exceeded", () => {
    const spend = recordProviderSpend(emptyProviderSpend(), { dollars: 4.5, calls: 10 });
    expect(() =>
      assertWithinProviderCaps({
        provider: "openai",
        caps: { openai: { maxDollars: 5 } },
        spend,
        nextDollarsWorstCase: 1,
      }),
    ).toThrow(ProviderCapError);
  });

  it("allows call under provider cap", () => {
    expect(() =>
      assertWithinProviderCaps({
        provider: "anthropic",
        caps: { anthropic: { maxDollars: 10, maxCalls: 100 } },
        spend: emptyProviderSpend(),
        nextDollarsWorstCase: 0.5,
      }),
    ).not.toThrow();
  });
});

describe("concurrency", () => {
  it("parses and clamps concurrency", () => {
    expect(parseConcurrency(["--concurrency", "3"])).toBe(3);
    expect(parseConcurrency(["--concurrency=99"])).toBe(8);
  });

  it("isolates failures across concurrent workers", async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      return n * 10;
    });
    expect(results[0]).toEqual({ ok: true, value: 10 });
    expect(results[1]?.ok).toBe(false);
    expect(results[2]).toEqual({ ok: true, value: 30 });
  });
});
