export type StageId = 1 | 2 | 3;

export function mayStartStage(requested: StageId, completedStages: readonly StageId[]): boolean {
  if (requested === 1) return true;
  if (requested === 2) {
    return completedStages.includes(1) && !autoStartStage2FromStage1();
  }
  if (requested === 3) {
    return completedStages.includes(2);
  }
  return false;
}

export function autoStartStage2FromStage1(): boolean {
  return false;
}
