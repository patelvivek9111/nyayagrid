export type StageId = 1 | 2 | 3;

/**
 * Whether an *explicit* request to start a stage is allowed given completed stages.
 * Stage 2/3 never auto-start; callers must still require separate authorization.
 */
export function mayStartStage(requested: StageId, completedStages: readonly StageId[]): boolean {
  if (requested === 1) return true;
  if (requested === 2) {
    return completedStages.includes(1);
  }
  if (requested === 3) {
    return completedStages.includes(2);
  }
  return false;
}

/** Hard-coded false: Stage 1 completion must not trigger Stage 2. */
export function autoStartStage2FromStage1(): boolean {
  return false;
}

export function assertNoAutoEscalation(): void {
  if (autoStartStage2FromStage1()) {
    throw new Error("Stage auto-escalation is forbidden for production model selection.");
  }
}
