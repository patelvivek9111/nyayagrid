import { describe, expect, it } from "vitest";
import {
  assertNextCallWithinBudget,
  applyPersistedSpend,
  BudgetLimitError,
  reconstructSpendFromPersistedCosts,
  recordSpend,
  remainingBudgetUsd,
} from "../src/live/budget.js";

/**
 * Mock-only proof that resume ledgers preserve prior paid spend.
 * No provider calls.
 */
describe("resume spend accounting", () => {
  it("Scenario A: fresh run starts at $0", () => {
    const budget = reconstructSpendFromPersistedCosts(1, []);
    expect(budget.spentUsd).toBe(0);
    expect(remainingBudgetUsd(budget)).toBe(1);
    expect(() => assertNextCallWithinBudget(budget, 0.05)).not.toThrow();
  });

  it("Scenario B: response already $0.50 — resume begins with $0.50 spent", () => {
    const budget = reconstructSpendFromPersistedCosts(1, [0.5]);
    expect(budget.spentUsd).toBeCloseTo(0.5);
    expect(remainingBudgetUsd(budget)).toBeCloseTo(0.5);
  });

  it("Scenario C: response+Judge A $0.80 + Judge B worst $0.30 blocks before request under $1", () => {
    const budget = reconstructSpendFromPersistedCosts(1, [0.5, 0.3]);
    expect(budget.spentUsd).toBeCloseTo(0.8);
    expect(() => assertNextCallWithinBudget(budget, 0.3)).toThrow(BudgetLimitError);
  });

  it("Scenario D: all artifacts cached — resume causes $0 additional spend", () => {
    const prior = reconstructSpendFromPersistedCosts(1, [0.023156, 0.013342, 0.008846]);
    const afterResumeHits = [0.023156, 0.013342, 0.008846].reduce(
      (state, cost) => applyPersistedSpend(state, cost),
      { maxUsd: 1, spentUsd: 0 },
    );
    expect(afterResumeHits.spentUsd).toBeCloseTo(prior.spentUsd);
    // No new paid call recorded beyond reconstructed ledger.
    expect(afterResumeHits.spentUsd).toBeCloseTo(0.045344);
    expect(remainingBudgetUsd(afterResumeHits)).toBeCloseTo(0.954656);
  });

  it("Scenario E: partial judge retry does not reset ledger to zero", () => {
    let budget = reconstructSpendFromPersistedCosts(1, [0.5]); // cached response
    budget = applyPersistedSpend(budget, 0.3); // cached Judge A
    expect(budget.spentUsd).toBeCloseTo(0.8);
    // Retrying only Judge B must still see prior spend.
    expect(() => assertNextCallWithinBudget(budget, 0.3)).toThrow(BudgetLimitError);
    budget = recordSpend(budget, 0.05); // hypothetical small Judge B success under remaining
    expect(budget.spentUsd).toBeCloseTo(0.85);
    expect(budget.spentUsd).not.toBe(0.05);
  });

  it("Scenario F: new process reconstructs prior spend from persisted artifact costs", () => {
    // Simulate process A writing costs, process B reading only persisted numbers.
    const persistedArtifactCosts = [0.023156, 0.013342, 0.008846];
    const processB = reconstructSpendFromPersistedCosts(1, persistedArtifactCosts);
    expect(processB.spentUsd).toBeCloseTo(0.045344);
    expect(() => assertNextCallWithinBudget(processB, 0.96)).toThrow(BudgetLimitError);
    expect(() => assertNextCallWithinBudget(processB, 0.9)).not.toThrow();
  });

  it("ignores non-finite and non-positive persisted costs", () => {
    const budget = reconstructSpendFromPersistedCosts(1, [0.1, NaN, -2, 0, 0.2]);
    expect(budget.spentUsd).toBeCloseTo(0.3);
  });
});
