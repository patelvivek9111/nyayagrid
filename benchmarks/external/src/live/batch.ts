export const DEFAULT_BATCH_SIZE_MIN = 5;
export const DEFAULT_BATCH_SIZE_MAX = 10;

export function resolveBatchSize(
  argv: readonly string[],
  fallback = DEFAULT_BATCH_SIZE_MIN,
): number {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--batch-size") {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n)) return clampBatchSize(n);
    }
  }
  return clampBatchSize(fallback);
}

export function clampBatchSize(n: number): number {
  return Math.min(DEFAULT_BATCH_SIZE_MAX, Math.max(1, Math.floor(n)));
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
