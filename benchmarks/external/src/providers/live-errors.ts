export type LiveProviderErrorCode =
  | "RATE_LIMIT"
  | "TEMPORARY_PROVIDER_ERROR"
  | "TRANSPORT_ERROR"
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

export function classifyHttpStatus(
  provider: string,
  status: number,
  bodyText: string,
): LiveProviderError {
  const lower = bodyText.toLowerCase();
  if (
    status === 401 ||
    status === 403 ||
    /credit balance is too low|insufficient.?credit|billing|invalid.?api.?key|authentication/i.test(
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
  return error instanceof LiveProviderError && error.retryable && error.completionKnownIncomplete;
}
