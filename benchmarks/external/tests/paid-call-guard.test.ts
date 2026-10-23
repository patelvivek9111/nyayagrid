import { describe, expect, it } from "vitest";
import { assertPaidCallsAuthorized, isPaidCallsAuthorized } from "../src/guards/paid-call-guard.js";

describe("paid-call-guard", () => {
  it("defaults to unauthorized", () => {
    expect(isPaidCallsAuthorized({ argv: ["node", "script"], env: {} })).toBe(false);
  });

  it("requires budget with argv flag", () => {
    expect(
      isPaidCallsAuthorized({
        argv: ["node", "script", "--allow-paid-model-calls"],
        env: {},
      }),
    ).toBe(false);
  });

  it("allows two-step argv authorization", () => {
    expect(
      isPaidCallsAuthorized({
        argv: ["node", "script", "--allow-paid-model-calls", "--max-cost-usd", "10"],
        env: {},
      }),
    ).toBe(true);
  });

  it("allows env plus budget flag", () => {
    expect(
      isPaidCallsAuthorized({
        argv: ["node", "--max-cost-usd", "1"],
        env: { EXTERNAL_BENCH_ALLOW_PAID_MODEL_CALLS: "1" },
      }),
    ).toBe(true);
  });

  it("throws when asserting without authorization", () => {
    expect(() => assertPaidCallsAuthorized({ argv: ["node"], env: {} }, "test")).toThrow(
      /--max-cost-usd/,
    );
  });
});
