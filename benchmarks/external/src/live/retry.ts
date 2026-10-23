export type RetryableErrorKind = "429" | "5xx" | "reset" | "timeout";

export class UnknownCompletionError extends Error {
  readonly code = "UNKNOWN_COMPLETION_REVIEW_REQUIRED" as const;
  constructor(message: string) {
    super(message);
    this.name = "UnknownCompletionError";
  }
}

const RETRYABLE = new Set<RetryableErrorKind>(["429", "5xx", "reset", "timeout"]);

export function classifyRetryable(kind: string): RetryableErrorKind | null {
  if (RETRYABLE.has(kind as RetryableErrorKind)) {
    return kind as RetryableErrorKind;
  }
  return null;
}

export function computeBackoffMs(attempt: number, baseMs = 500): number {
  return baseMs * 2 ** Math.max(0, attempt);
}

export function shouldRetry(input: {
  kind: RetryableErrorKind | null;
  attempt: number;
  maxRetries?: number;
  completionKnownIncomplete: boolean;
}): boolean {
  const maxRetries = input.maxRetries ?? 2;
  if (!input.kind || !input.completionKnownIncomplete) return false;
  return input.attempt < maxRetries;
}

export function assertCompletionKnown(known: boolean): void {
  if (!known) {
    throw new UnknownCompletionError(
      "UNKNOWN_COMPLETION_REVIEW_REQUIRED: response completion state uncertain; do not charge or cache as success.",
    );
  }
}
