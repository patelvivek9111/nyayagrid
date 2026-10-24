import { describe, expect, it } from "vitest";
import {
  assertNextCallWithinBudget,
  applyPersistedSpend,
  BudgetLimitError,
  parseMaxCostUsd,
  reconstructSpendFromPersistedCosts,
  recordSpend,
  remainingBudgetUsd,
} from "../src/live/budget.js";

describe("budget", () => {
  it("parses max cost flag", () => {
    expect(parseMaxCostUsd(["node", "--max-cost-usd", "12.5"])).toBe(12.5);
    expect(parseMaxCostUsd(["node", "--max-cost-usd=3"])).toBe(3);
  });

  it("stops when next call exceeds budget", () => {
    expect(() => assertNextCallWithinBudget({ maxUsd: 1, spentUsd: 0.9 }, 0.2)).toThrow(
      BudgetLimitError,
    );
  });

  it("tracks spend and remaining", () => {
    const state = recordSpend({ maxUsd: 10, spentUsd: 2 }, 1.5);
    expect(state.spentUsd).toBe(3.5);
    expect(remainingBudgetUsd(state)).toBe(6.5);
  });

  it("reconstructs and applies persisted spend without forgetting prior costs", () => {
    const rebuilt = reconstructSpendFromPersistedCosts(1, [0.4, 0.2]);
    expect(rebuilt.spentUsd).toBeCloseTo(0.6);
    const next = applyPersistedSpend(rebuilt, 0.15);
    expect(next.spentUsd).toBeCloseTo(0.75);
  });
});
