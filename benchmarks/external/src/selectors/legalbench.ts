import type { LegalBenchCategory } from "../adapters/legalbench.js";
import type { NormalizedTask } from "../schema/normalized-task.js";

export type LegalBenchFilter =
  | { mode: "all" }
  | { mode: "us_relevant" }
  | { mode: "category"; category: LegalBenchCategory }
  | { mode: "task_ids"; taskIds: readonly string[] }
  | { mode: "upstream_tasks"; upstreamTasks: readonly string[] };

export function filterLegalBenchTasks(
  tasks: readonly NormalizedTask[],
  filter: LegalBenchFilter,
): NormalizedTask[] {
  switch (filter.mode) {
    case "all":
      return [...tasks];
    case "us_relevant":
      return tasks.filter((t) => {
        const cat = t.metadata?.nyayaCategory;
        return (
          cat === "US_RELEVANT" ||
          cat === "CONTRACT" ||
          cat === "STATUTORY" ||
          cat === "CASE_LAW" ||
          cat === "PROCEDURAL" ||
          cat === "GENERAL_LEGAL_REASONING"
        );
      });
    case "category":
      return tasks.filter((t) => t.metadata?.nyayaCategory === filter.category);
    case "task_ids": {
      const set = new Set(filter.taskIds);
      return tasks.filter((t) => set.has(t.taskId));
    }
    case "upstream_tasks": {
      const set = new Set(filter.upstreamTasks);
      return tasks.filter((t) => {
        const up = t.metadata?.upstreamTask;
        return typeof up === "string" && set.has(up);
      });
    }
    default: {
      const _exhaustive: never = filter;
      return _exhaustive;
    }
  }
}
