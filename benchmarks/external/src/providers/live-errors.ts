export type LiveProviderErrorCode =
  | "RATE_LIMIT"
  | "TEMPORARY_PROVIDER_ERROR"
  | "TRANSPORT_ERROR"
  | "TRANSPORT_PRE_DISPATCH"
  | "TRANSPORT_POST_DISPATCH_UNKNOWN"
  | "TIMEOUT_PRE_DISPATCH"
  | "TIMEOUT_POST_DISPATCH_UNKNOWN"
  | "AUTH_ERROR"
  | "MODEL_NOT_FOUND"
  | "BAD_REQUEST"
  | "CONTEXT_OVERFLOW"
  | "CONTENT_FILTER_OR_REFUSAL"
  | "UNKNOWN_COMPLETION"
  | "NON_RETRYABLE_PROVIDER_ERROR";

export class LiveProviderError extends Error {
  readonly code: LiveProviderErrorCode;
  readonly provider: string;
  readonly status?: number;
  readonly retryable: boolean;
  readonly completionKnownIncomplete: boolean;

  constructor(input: {
    code: LiveProviderErrorCode;
    provider: string;
    message: string;
    status?: number;
    retryable?: boolean;
    completionKnownIncomplete?: boolean;
  }) {
    super(input.message);
    this.name = "LiveProviderError";
    this.code = input.code;
    this.provider = input.provider;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
    this.completionKnownIncomplete = input.completionKnownIncomplete ?? true;
  }
}

export function isTimeoutLikeError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String((err as { name?: unknown }).name ?? "") : "";
  const message = err instanceof Error ? err.message : String(err);
  return (
    name === "TimeoutError" || name === "AbortError" || /timeout|timed out|aborted/i.test(message)
  );
}

/**
 * Classify fetch abort/transport failures with dispatch awareness.
 * Post-dispatch uncertainty is never retryable.
 */
export function classifyFetchFailure(input: {
  provider: string;
  dispatched: boolean;
  err: unknown;
}): LiveProviderError {
  const message = input.err instanceof Error ? input.err.message : String(input.err);
  const timeout = isTimeoutLikeError(input.err);
  if (input.dispatched) {
    if (timeout) {
      return new LiveProviderError({
        code: "TIMEOUT_POST_DISPATCH_UNKNOWN",
        provider: input.provider,
        message: `${input.provider} timeout after dispatch: ${message}`,
        retryable: false,
        completionKnownIncomplete: false,
      });
    }
    return new LiveProviderError({
      code: "TRANSPORT_POST_DISPATCH_UNKNOWN",
      provider: input.provider,
      message: `${input.provider} transport failure after dispatch: ${message}`,
      retryable: false,
      completionKnownIncomplete: false,
    });
  }
  if (timeout) {
    return new LiveProviderError({
      code: "TIMEOUT_PRE_DISPATCH",
      provider: input.provider,
      message: `${input.provider} timeout before dispatch: ${message}`,
      retryable: true,
      completionKnownIncomplete: true,
    });
  }
  return new LiveProviderError({
    code: "TRANSPORT_PRE_DISPATCH",
    provider: input.provider,
    message: `${input.provider} transport error: ${message}`,
    retryable: true,
    completionKnownIncomplete: true,
  });
}

export function isPostDispatchUnknownError(error: unknown): boolean {
  return (
    error instanceof LiveProviderError &&
    (error.code === "UNKNOWN_COMPLETION" ||
      error.code === "TIMEOUT_POST_DISPATCH_UNKNOWN" ||
      error.code === "TRANSPORT_POST_DISPATCH_UNKNOWN")
  );
}

export function classifyHttpStatus(
  provider: string,
  status: number,
  bodyText: string,
): LiveProviderError {
  const lower = bodyText.toLowerCase();
  if (
    status === 401 ||
    status === 403 ||
    /credit_balance_exhausted|credit balance is too low|no credits remaining|insufficient.?credit|insufficient_quota|billing|invalid.?api.?key|authentication/i.test(
      bodyText,
    )
  ) {
    return new LiveProviderError({
      code: "AUTH_ERROR",
      provider,
      status,
      message: `${provider} auth/billing failed (${status}): ${bodyText.replace(/\s+/g, " ").slice(0, 240)}`,
      retryable: false,
    });
  }
  if (status === 404 || /model[_ ]?not[_ ]?found|does not exist|unknown model/i.test(bodyText)) {
    return new LiveProviderError({
      code: "MODEL_NOT_FOUND",
      provider,
      status,
      message: `${provider} model not found (${status})`,
      retryable: false,
    });
  }
  if (
    status === 400 &&
    (/context[_ ]?(length|window)|too many tokens|maximum context/i.test(bodyText) ||
      /prompt is too long/i.test(lower))
  ) {
    return new LiveProviderError({
      code: "CONTEXT_OVERFLOW",
      provider,
      status,
      message: `${provider} context overflow (${status})`,
      retryable: false,
    });
  }
  if (
    status === 400 ||
    (status >= 400 &&
      status < 500 &&
      status !== 408 &&
      status !== 429 &&
      status !== 401 &&
      status !== 403 &&
      status !== 404)
  ) {
    const snippet = bodyText.replace(/\s+/g, " ").slice(0, 400);
    return new LiveProviderError({
      code: "BAD_REQUEST",
      provider,
      status,
      message: `${provider} bad request (${status}): ${snippet}`,
      retryable: false,
    });
  }
  if (status === 429) {
    return new LiveProviderError({
      code: "RATE_LIMIT",
      provider,
      status,
      message: `${provider} rate limited`,
      retryable: true,
      completionKnownIncomplete: true,
    });
  }
  if (status >= 500 || status === 408) {
    return new LiveProviderError({
      code: "TEMPORARY_PROVIDER_ERROR",
      provider,
      status,
      message: `${provider} temporary error (${status})`,
      retryable: true,
      completionKnownIncomplete: true,
    });
  }
  return new LiveProviderError({
    code: "NON_RETRYABLE_PROVIDER_ERROR",
    provider,
    status,
    message: `${provider} error (${status})`,
    retryable: false,
  });
}

export function isRetryableLiveError(error: unknown): boolean {
  if (!(error instanceof LiveProviderError)) return false;
  if (
    error.code === "UNKNOWN_COMPLETION" ||
    error.code === "TIMEOUT_POST_DISPATCH_UNKNOWN" ||
    error.code === "TRANSPORT_POST_DISPATCH_UNKNOWN"
  ) {
    return false;
  }
  return error.retryable && error.completionKnownIncomplete;
}
