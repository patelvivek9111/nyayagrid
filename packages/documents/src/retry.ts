/**
 * Classify processing failures for background ingest retries.
 * Permanent outcomes (malware, unsupported files) must not loop.
 */
export class RetryableProcessingError extends Error {
  readonly retryable = true as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RetryableProcessingError";
  }
}

const TRANSIENT_PATTERN =
  /\b429\b|Retry-After|timed out|timeout|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|network|503|502|500|temporarily unavailable|too many requests/i;

export function isRetryableProcessingError(error: unknown): boolean {
  if (error instanceof RetryableProcessingError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return TRANSIENT_PATTERN.test(message);
}

export const PERMANENT_INGEST_STATES = [
  "scan_blocked",
  "quarantined",
  "extraction_failed",
  "requires_ocr",
] as const;

export function isPermanentIngestState(state: string): boolean {
  return (PERMANENT_INGEST_STATES as readonly string[]).includes(state);
}
