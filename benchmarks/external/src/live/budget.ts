export type BudgetState = {
  maxUsd: number;
  spentUsd: number;
};

export class BudgetLimitError extends Error {
  readonly code = "STOP_BUDGET_LIMIT" as const;
  constructor(message: string) {
    super(message);
    this.name = "BudgetLimitError";
  }
}

export function parseMaxCostUsd(argv: readonly string[]): number | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--max-cost-usd") {
      const next = argv[i + 1];
      if (next === undefined) return null;
      const n = Number(next);
      return Number.isFinite(n) ? n : null;
    }
    if (arg?.startsWith("--max-cost-usd=")) {
      const n = Number(arg.slice("--max-cost-usd=".length));
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

export function assertBudgetConfigured(maxUsd: number | null): asserts maxUsd is number {
  if (maxUsd === null || maxUsd <= 0) {
    throw new Error(
      "Live benchmark requires --max-cost-usd with a positive USD limit (env alone is insufficient).",
    );
  }
}

export function worstCaseCallCostUsd(input: {
  inputTokens: number;
  outputTokens: number;
  inputPer1M: number;
  outputPer1M: number;
}): number {
  return (
    (input.inputTokens / 1_000_000) * input.inputPer1M +
    (input.outputTokens / 1_000_000) * input.outputPer1M
  );
}

export function assertNextCallWithinBudget(state: BudgetState, worstCaseNextUsd: number): void {
  if (state.spentUsd + worstCaseNextUsd > state.maxUsd + 1e-9) {
    throw new BudgetLimitError(
      `STOP_BUDGET_LIMIT: spent=${state.spentUsd.toFixed(4)} worstCaseNext=${worstCaseNextUsd.toFixed(4)} max=${state.maxUsd.toFixed(4)}`,
    );
  }
}

export function recordSpend(state: BudgetState, actualUsd: number): BudgetState {
  return { ...state, spentUsd: state.spentUsd + actualUsd };
}

export function remainingBudgetUsd(state: BudgetState): number {
  return Math.max(0, state.maxUsd - state.spentUsd);
}
