import { createHash } from "node:crypto";
import type { NormalizedTask } from "../schema/normalized-task.js";

export const SCREENING_SEED = "nyayagrid-external-screening-v1";

export const SCREENING_TARGETS = {
  prbenchHard: 32,
  legalbench: 24,
  legalbenchRag: 150,
} as const;

function stableHash(seed: string, id: string): string {
  return createHash("sha256").update(`${seed}:${id}`).digest("hex");
}

/**
 * Deterministic stratified selection: sort by hash(seed:taskId), take first N.
 * Does not cherry-pick by model performance.
 */
export function deterministicSelect(
  tasks: readonly NormalizedTask[],
  count: number,
  seed: string = SCREENING_SEED,
): NormalizedTask[] {
  const ranked = [...tasks].sort((a, b) =>
    stableHash(seed, a.taskId).localeCompare(stableHash(seed, b.taskId)),
  );
  return ranked.slice(0, Math.min(count, ranked.length));
}

export function buildScreeningSelection(input: {
  prbenchHard: readonly NormalizedTask[];
  legalbench: readonly NormalizedTask[];
  legalbenchRag: readonly NormalizedTask[];
  seed?: string;
}): {
  selectionMethod: "deterministic_stratified";
  seed: string;
  prbenchHardTaskIds: string[];
  legalbenchTaskIds: string[];
  legalbenchRagTaskIds: string[];
  targets: typeof SCREENING_TARGETS;
  actual: { prbenchHard: number; legalbench: number; legalbenchRag: number };
} {
  const seed = input.seed ?? SCREENING_SEED;
  const pr = deterministicSelect(input.prbenchHard, SCREENING_TARGETS.prbenchHard, seed);
  const lb = deterministicSelect(input.legalbench, SCREENING_TARGETS.legalbench, `${seed}:lb`);
  const rag = deterministicSelect(
    input.legalbenchRag,
    SCREENING_TARGETS.legalbenchRag,
    `${seed}:rag`,
  );
  return {
    selectionMethod: "deterministic_stratified",
    seed,
    prbenchHardTaskIds: pr.map((t) => t.taskId),
    legalbenchTaskIds: lb.map((t) => t.taskId),
    legalbenchRagTaskIds: rag.map((t) => t.taskId),
    targets: SCREENING_TARGETS,
    actual: {
      prbenchHard: pr.length,
      legalbench: lb.length,
      legalbenchRag: rag.length,
    },
  };
}
