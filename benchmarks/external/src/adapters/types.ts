import type { NormalizedTask } from "../schema/normalized-task.js";

export type BenchmarkFetchContext = {
  cacheDir: string;
  revision?: string;
  dryRun?: boolean;
};

export type BenchmarkAdapter = {
  benchmarkId: string;
  load(sourcePath: string): Promise<NormalizedTask[]>;
};
