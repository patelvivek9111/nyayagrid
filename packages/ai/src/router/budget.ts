import type { ExecutionStrategy } from "../provider-contract";

export type ExecutionBudget = {
  maxModelCalls: number;
  maxFallbackAttempts: number;
  maxVerifierCalls: number;
  maxEstimatedUsd: number | null;
  maxTokens: number | null;
};

export const STRATEGY_BUDGETS: Record<ExecutionStrategy, ExecutionBudget> = {
  fast: {
    maxModelCalls: 1,
    maxFallbackAttempts: 0,
    maxVerifierCalls: 0,
    maxEstimatedUsd: null,
    maxTokens: null,
  },
  standard: {
    maxModelCalls: 2,
    maxFallbackAttempts: 1,
    maxVerifierCalls: 0,
    maxEstimatedUsd: null,
    maxTokens: null,
  },
  deep: {
    maxModelCalls: 4,
    maxFallbackAttempts: 1,
    maxVerifierCalls: 1,
    maxEstimatedUsd: null,
    maxTokens: null,
  },
};

export function budgetFor(strategy: ExecutionStrategy): ExecutionBudget {
  return { ...STRATEGY_BUDGETS[strategy] };
}

export class BudgetMeter {
  modelCalls = 0;
  fallbackAttempts = 0;
  verifierCalls = 0;
  tokens = 0;
  estimatedUsd = 0;
  costKnown = true;

  constructor(readonly budget: ExecutionBudget) {}

  canCallModel(): boolean {
    return this.modelCalls < this.budget.maxModelCalls;
  }

  canFallback(): boolean {
    return (
      this.canCallModel() && this.fallbackAttempts < this.budget.maxFallbackAttempts
    );
  }

  canVerify(): boolean {
    return this.canCallModel() && this.verifierCalls < this.budget.maxVerifierCalls;
  }

  recordCall(kind: "primary" | "fallback" | "verifier", tokens?: number, usd?: number | null) {
    this.modelCalls += 1;
    if (kind === "fallback") this.fallbackAttempts += 1;
    if (kind === "verifier") this.verifierCalls += 1;
    if (tokens) this.tokens += tokens;
    if (usd == null) this.costKnown = false;
    else this.estimatedUsd += usd;
    if (this.budget.maxTokens != null && this.tokens > this.budget.maxTokens) {
      throw new Error("Execution token budget exceeded");
    }
    if (
      this.budget.maxEstimatedUsd != null &&
      this.costKnown &&
      this.estimatedUsd > this.budget.maxEstimatedUsd
    ) {
      throw new Error("Execution cost budget exceeded");
    }
  }
}
