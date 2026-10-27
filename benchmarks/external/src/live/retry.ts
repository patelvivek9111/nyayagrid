export type RetryableErrorKind = "429" | "5xx" | "reset" | "timeout";

export type UnknownFailureClassification =
  "UNKNOWN_COMPLETION" | "TIMEOUT_POST_DISPATCH_UNKNOWN" | "TRANSPORT_POST_DISPATCH_UNKNOWN";

export class UnknownCompletionError extends Error {
  readonly code = "UNKNOWN_COMPLETION_REVIEW_REQUIRED" as const;
  readonly failureClassification: UnknownFailureClassification;
  readonly providerCode: string | null;
  constructor(
    message: string,
    opts?: {
      failureClassification?: UnknownFailureClassification;
      providerCode?: string;
    },
  ) {
    super(message);
    this.name = "UnknownCompletionError";
    this.failureClassification = opts?.failureClassification ?? "UNKNOWN_COMPLETION";
    this.providerCode = opts?.providerCode ?? null;
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
