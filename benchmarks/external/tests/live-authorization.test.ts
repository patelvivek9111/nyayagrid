import { describe, expect, it } from "vitest";
import { assertPaidCallsAuthorized, isPaidCallsAuthorized } from "../src/guards/paid-call-guard.js";
import { assertLivePaidExecutionAuthorized } from "../src/live/authorization.js";

describe("live authorization two-step", () => {
  it("defaults to unauthorized", () => {
    expect(isPaidCallsAuthorized({ argv: ["node", "script"], env: {} })).toBe(false);
  });

  it("env alone is insufficient without budget flag", () => {
    expect(
      isPaidCallsAuthorized({
        argv: ["node"],
        env: { EXTERNAL_BENCH_ALLOW_PAID_MODEL_CALLS: "1" },
      }),
    ).toBe(false);
  });

  it("budget alone is insufficient without allow flag", () => {
    expect(
      isPaidCallsAuthorized({
        argv: ["node", "script", "--max-cost-usd", "10"],
        env: {},
      }),
    ).toBe(false);
  });

  it("allows argv flag plus positive max cost", () => {
    expect(
      isPaidCallsAuthorized({
        argv: ["node", "script", "--allow-paid-model-calls", "--max-cost-usd", "25"],
        env: {},
      }),
    ).toBe(true);
  });

  it("assertLivePaidExecutionAuthorized returns max cost", () => {
    const auth = assertLivePaidExecutionAuthorized({
      argv: ["node", "--allow-paid-model-calls", "--max-cost-usd", "5"],
      env: {},
    });
    expect(auth.maxCostUsd).toBe(5);
  });

  it("throws when asserting without two-step auth", () => {
    expect(() => assertPaidCallsAuthorized({ argv: ["node"], env: {} }, "test")).toThrow(
      /--max-cost-usd/,
    );
  });
});
