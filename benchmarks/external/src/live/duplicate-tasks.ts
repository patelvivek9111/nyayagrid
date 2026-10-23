import { contentHashFromText } from "./cache-key.js";

export type TaskInputRef = {
  taskId: string;
  contentText: string;
};

export function findDuplicateInputHashes(tasks: readonly TaskInputRef[]): {
  duplicateGroups: string[][];
  uniqueCount: number;
} {
  const byHash = new Map<string, string[]>();
  for (const task of tasks) {
    const hash = contentHashFromText(task.contentText);
    const list = byHash.get(hash) ?? [];
    list.push(task.taskId);
    byHash.set(hash, list);
  }
  const duplicateGroups = [...byHash.values()].filter((g) => g.length > 1);
  return { duplicateGroups, uniqueCount: byHash.size };
}
