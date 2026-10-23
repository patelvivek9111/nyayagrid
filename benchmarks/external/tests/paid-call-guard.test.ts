import { describe, expect, it } from "vitest";
import { assertPaidCallsAuthorized, isPaidCallsAuthorized } from "../src/guards/paid-call-guard.js";

describe("paid-call-guard", () => {
  it("defaults to unauthorized", () => {
    expect(isPaidCallsAuthorized({ argv: ["node", "script"], env: {} })).toBe(false);
  });

  it("allows argv flag", () => {
    expect(
      isPaidCallsAuthorized({
        argv: ["node", "script", "--allow-paid-model-calls"],
        env: {},
      }),
    ).toBe(true);
  });

  it("allows dedicated env var", () => {
    expect(
      isPaidCallsAuthorized({
        argv: ["node"],
        env: { EXTERNAL_BENCH_ALLOW_PAID_MODEL_CALLS: "1" },
      }),
    ).toBe(true);
  });

  it("throws when asserting without authorization", () => {
    expect(() => assertPaidCallsAuthorized({ argv: ["node"], env: {} }, "test")).toThrow(
      /EXTERNAL_BENCH_ALLOW_PAID_MODEL_CALLS/,
    );
  });
});
