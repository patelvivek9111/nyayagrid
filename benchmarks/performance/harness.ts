export type PercentileSample = number[];

export function percentile(samples: number[], p: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank] ?? null;
}

export function summarizeLatencies(samples: number[]) {
  if (samples.length === 0) {
    return { n: 0, min: null, max: null, p50: null, p95: null, p99: null, mean: null };
  }
  const sum = samples.reduce((a, b) => a + b, 0);
  return {
    n: samples.length,
    min: Math.min(...samples),
    max: Math.max(...samples),
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    mean: Math.round(sum / samples.length),
  };
}

export type ClassifiedError =
  | "ok"
  | "rate_limit"
  | "provider_429"
  | "timeout"
  | "pool"
  | "other";

export function classifyFailure(error: unknown): ClassifiedError {
  const message = error instanceof Error ? error.message : String(error);
  if (/RATE_LIMITED|Too many requests/i.test(message)) return "rate_limit";
  if (/\b429\b/.test(message)) return "provider_429";
  if (/timed out|timeout|aborted/i.test(message)) return "timeout";
  if (/max clients|too many connections|pool/i.test(message)) return "pool";
  return "other";
}

export async function runConcurrent<T>(
  concurrency: number,
  total: number,
  worker: (index: number) => Promise<T>,
): Promise<{ results: T[]; elapsedMs: number }> {
  const started = performance.now();
  let next = 0;
  const results: T[] = [];
  async function runOne() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= total) return;
      results[index] = await worker(index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => runOne()));
  return { results, elapsedMs: Math.round(performance.now() - started) };
}

export type LoadBand = "small" | "medium" | "large";

export const CONTROLLED_BETA_LOAD_MODEL = {
  users: { firms: "3–8", activeProfessionals: "10–25", concurrentActive: [1, 5, 10, 20] },
  cases: {
    small: { documents: "5–10", pages: "50–150" },
    medium: { documents: "25–50", pages: "300–800" },
    large: { documents: "100–200", pages: "1,500–4,000" },
  },
  operations: [
    "ask_nyaya",
    "upload_ingest",
    "contract_analysis",
    "deposition_analysis",
    "compare",
    "research",
    "agent_run",
    "timeline_extract",
  ],
} as const;

export function syntheticPage(page: number, words = 420): string {
  const sentence = `Synthetic page ${page} records a dated obligation, a party name, and a dollar amount for load testing. `;
  return sentence.repeat(Math.ceil(words / 12)).slice(0, words * 6);
}
