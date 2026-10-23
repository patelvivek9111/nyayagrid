import type { NormalizedTask } from "../schema/normalized-task.js";

export type PrbenchSubset = "PRBENCH_LEGAL_ALL" | "PRBENCH_LEGAL_HARD";

export type PrbenchSelectionReport = {
  subset: PrbenchSubset;
  expectedPublishedCount: number | null;
  actualCount: number;
  revision: string | null;
  countMismatch: boolean;
  taskIds: string[];
};

const EXPECTED: Record<PrbenchSubset, number> = {
  PRBENCH_LEGAL_ALL: 500,
  PRBENCH_LEGAL_HARD: 250,
};

export function selectPrbenchSubset(
  tasks: readonly NormalizedTask[],
  subset: PrbenchSubset,
  revision: string | null = null,
): { tasks: NormalizedTask[]; report: PrbenchSelectionReport } {
  let selected: NormalizedTask[];
  if (subset === "PRBENCH_LEGAL_HARD") {
    selected = tasks.filter(
      (t) => t.split === "legal_hard" || t.difficulty === "hard" || t.metadata?.legalHard === true,
    );
  } else {
    selected = tasks.filter(
      (t) => t.split === "legal" || t.split === "legal_hard" || t.benchmarkId === "prbench",
    );
    // Prefer legal-all as the legal split only when both present
    const legalOnly = tasks.filter((t) => t.split === "legal");
    if (legalOnly.length > 0) selected = legalOnly;
  }

  const expected = EXPECTED[subset];
  const report: PrbenchSelectionReport = {
    subset,
    expectedPublishedCount: expected,
    actualCount: selected.length,
    revision,
    countMismatch: selected.length !== expected,
    taskIds: selected.map((t) => t.taskId),
  };
  return { tasks: selected, report };
}
