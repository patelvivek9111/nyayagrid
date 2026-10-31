import { createHash } from "node:crypto";
import type { NormalizedTask } from "../schema/normalized-task.js";
import { DETERMINISTIC_SEED } from "./constants.js";

function stableHash(seed: string, id: string): string {
  return createHash("sha256").update(`${seed}:${id}`).digest("hex");
}

export function deterministicRank<T extends { taskId: string }>(
  items: readonly T[],
  seed: string = DETERMINISTIC_SEED,
): T[] {
  return [...items].sort((a, b) =>
    stableHash(seed, a.taskId).localeCompare(stableHash(seed, b.taskId)),
  );
}

export function deterministicSelectTasks(
  tasks: readonly NormalizedTask[],
  count: number,
  seed: string = DETERMINISTIC_SEED,
): NormalizedTask[] {
  return deterministicRank(tasks, seed).slice(0, Math.min(count, tasks.length));
}

/**
 * Stratified by a metadata key (e.g. label, taskType, citation category).
 * Round-robin across strata after deterministic ranking within each stratum.
 * Prefers hard/negative strata when `preferKeys` is provided.
 */
export function stratifiedDeterministicSelect(
  tasks: readonly NormalizedTask[],
  count: number,
  stratumKey: string,
  seed: string = DETERMINISTIC_SEED,
  preferKeys: readonly string[] = [],
): NormalizedTask[] {
  const buckets = new Map<string, NormalizedTask[]>();
  for (const task of tasks) {
    const raw = task.metadata?.[stratumKey];
    const key =
      typeof raw === "string" && raw.length > 0
        ? raw
        : typeof task.expectedAnswer === "string"
          ? task.expectedAnswer
          : "UNLABELED";
    const list = buckets.get(key) ?? [];
    list.push(task);
    buckets.set(key, list);
  }

  for (const [k, list] of buckets) {
    buckets.set(k, deterministicRank(list, `${seed}:${k}`));
  }

  const keys = [
    ...preferKeys.filter((k) => buckets.has(k)),
    ...[...buckets.keys()].filter((k) => !preferKeys.includes(k)).sort(),
  ];

  const selected: NormalizedTask[] = [];
  const indices = new Map<string, number>(keys.map((k) => [k, 0]));
  while (selected.length < count) {
    let progressed = false;
    for (const key of keys) {
      if (selected.length >= count) break;
      const list = buckets.get(key) ?? [];
      const i = indices.get(key) ?? 0;
      if (i < list.length) {
        selected.push(list[i]!);
        indices.set(key, i + 1);
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return selected;
}

export function hashSelectionManifest(
  taskIds: readonly string[],
  seed: string = DETERMINISTIC_SEED,
): string {
  return createHash("sha256")
    .update(`${seed}|${taskIds.join("\n")}`)
    .digest("hex");
}
