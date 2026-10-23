/** Conservative default concurrency for paid provider calls. */
export const DEFAULT_PROVIDER_CONCURRENCY = 2;

export function parseConcurrency(argv: readonly string[], fallback = DEFAULT_PROVIDER_CONCURRENCY): number {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--concurrency") {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n >= 1) return Math.min(8, Math.floor(n));
    }
    if (arg?.startsWith("--concurrency=")) {
      const n = Number(arg.slice("--concurrency=".length));
      if (Number.isFinite(n) && n >= 1) return Math.min(8, Math.floor(n));
    }
  }
  return fallback;
}

/**
 * Run async work with a fixed concurrency limit.
 * One rejection fails that item but does not cancel siblings.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown; index: number }>> {
  const limit = Math.max(1, Math.min(8, Math.floor(concurrency)));
  const results: Array<{ ok: true; value: R } | { ok: false; error: unknown; index: number }> =
    new Array(items.length);
  let next = 0;

  async function runOne(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      const item = items[index]!;
      try {
        const value = await worker(item, index);
        results[index] = { ok: true, value };
      } catch (error) {
        results[index] = { ok: false, error, index };
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runOne());
  await Promise.all(workers);
  return results;
}
