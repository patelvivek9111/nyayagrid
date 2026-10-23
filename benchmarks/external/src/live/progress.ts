export type RunProgress = {
  completed: number;
  cached: number;
  paid: number;
  failed: number;
  spendUsd: number;
  remainingBudgetUsd: number;
};

export function createRunProgress(budgetMaxUsd: number): RunProgress {
  return {
    completed: 0,
    cached: 0,
    paid: 0,
    failed: 0,
    spendUsd: 0,
    remainingBudgetUsd: budgetMaxUsd,
  };
}

export function bumpProgress(
  progress: RunProgress,
  event: "completed" | "cached" | "paid" | "failed",
  spendDeltaUsd = 0,
): RunProgress {
  const next = { ...progress };
  next[event] += 1;
  if (event === "completed" || event === "cached" || event === "paid") {
    next.completed += event === "completed" ? 0 : 0;
  }
  if (spendDeltaUsd > 0) {
    next.spendUsd += spendDeltaUsd;
    next.remainingBudgetUsd = Math.max(0, next.remainingBudgetUsd - spendDeltaUsd);
  }
  return next;
}

export function formatProgressLine(progress: RunProgress): string {
  return `completed=${progress.completed} cached=${progress.cached} paid=${progress.paid} failed=${progress.failed} spend=$${progress.spendUsd.toFixed(4)} remaining=$${progress.remainingBudgetUsd.toFixed(4)}`;
}
