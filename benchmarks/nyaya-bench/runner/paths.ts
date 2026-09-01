import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** `benchmarks/nyaya-bench` package root. */
export const BENCH_ROOT = resolve(here, "..");

export const DATASETS_ROOT = join(BENCH_ROOT, "datasets");
export const REPORTS_ROOT = join(BENCH_ROOT, "reports");
export const RUNS_ROOT = join(REPORTS_ROOT, "runs");
/**
 * Historical baselines live under `benchmarks/nyaya-bench/baselines`.
 * Frozen 6W reruns must set NYAYA_BENCH_BASELINES_ROOT to a separate directory so
 * writers cannot overwrite certified artifacts.
 */
export const BASELINES_ROOT = process.env.NYAYA_BENCH_BASELINES_ROOT
  ? resolve(process.env.NYAYA_BENCH_BASELINES_ROOT)
  : join(BENCH_ROOT, "baselines");

export type DatasetId = "v1" | "v2";

export function datasetRoot(dataset: DatasetId): string {
  return join(DATASETS_ROOT, dataset);
}

export function scenariosDir(dataset: DatasetId): string {
  return join(datasetRoot(dataset), "scenarios");
}

export function hiddenGroundTruthDir(dataset: DatasetId): string {
  return join(datasetRoot(dataset), "hidden_ground_truth");
}
