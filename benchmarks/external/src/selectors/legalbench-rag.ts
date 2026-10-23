import type { NormalizedTask } from "../schema/normalized-task.js";

export type LegalBenchRagFilter =
  | { mode: "all" }
  | { mode: "source"; source: string }
  | { mode: "limit"; limit: number }
  | { mode: "task_ids"; taskIds: readonly string[] };

export function filterLegalBenchRagTasks(
  tasks: readonly NormalizedTask[],
  filter: LegalBenchRagFilter,
): NormalizedTask[] {
  switch (filter.mode) {
    case "all":
      return [...tasks];
    case "source":
      return tasks.filter(
        (t) => t.split === filter.source || t.metadata?.upstreamSource === filter.source,
      );
    case "limit":
      return tasks.slice(0, Math.max(0, filter.limit));
    case "task_ids": {
      const set = new Set(filter.taskIds);
      return tasks.filter((t) => set.has(t.taskId));
    }
    default: {
      const _exhaustive: never = filter;
      return _exhaustive;
    }
  }
}
