/**
 * Normalized provider / router errors. User-facing routes must never serialize transport details.
 */

export type ProviderErrorCode =
  | "timeout"
  | "rate_limit"
  | "server_error"
  | "unavailable"
  | "malformed"
  | "aborted"
  | "auth"
  | "unsupported"
  | "unknown";

export class ProviderError extends Error {
  override readonly name = "ProviderError";
  readonly provider: string;
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly modelId?: string;

  constructor(params: {
    provider: string;
    code: ProviderErrorCode;
    message?: string;
    retryable?: boolean;
    status?: number;
    retryAfterMs?: number;
    modelId?: string;
  }) {
    super(params.message ?? `Provider "${params.provider}" failed (${params.code})`);
    this.provider = params.provider;
    this.code = params.code;
    this.retryable = params.retryable ?? isOperationalProviderFailure(params.code);
    this.status = params.status;
    this.retryAfterMs = params.retryAfterMs;
    this.modelId = params.modelId;
  }
}

export function isOperationalProviderFailure(code: ProviderErrorCode): boolean {
  return (
    code === "timeout" ||
    code === "rate_limit" ||
    code === "server_error" ||
    code === "unavailable" ||
    code === "malformed"
  );
}

/** Safe product failure when no validated execution path remains. */
export const ROUTER_UNAVAILABLE_USER_MESSAGE =
  "Nyaya could not complete this analysis right now. Try again shortly.";

export class RouterUnavailableError extends Error {
  override readonly name = "RouterUnavailableError";
  readonly code = "ROUTER_UNAVAILABLE";
  readonly userMessage = ROUTER_UNAVAILABLE_USER_MESSAGE;

  constructor(internalReason?: string) {
    super(ROUTER_UNAVAILABLE_USER_MESSAGE);
    this.cause = internalReason;
  }
}

export class RouterPolicyError extends Error {
  override readonly name = "RouterPolicyError";
  readonly code = "ROUTER_POLICY";

  constructor(message: string) {
    super(message);
  }
}

export function classifyThrownError(provider: string, error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof RouterUnavailableError) {
    return new ProviderError({ provider, code: "unavailable", message: error.message });
  }
  const err = error instanceof Error ? error : new Error(String(error));
  const message = err.message;
  const name = err.name;
  if (name === "AbortError" || /aborted/i.test(message)) {
    return new ProviderError({ provider, code: "aborted", message, retryable: false });
  }
  if (/timed out|timeout/i.test(message)) {
    return new ProviderError({ provider, code: "timeout", message, retryable: true });
  }
  const statusMatch = message.match(/status (\d{3})/i);
  const status = statusMatch ? Number(statusMatch[1]) : undefined;
  if (status === 429 || /rate limit/i.test(message)) {
    return new ProviderError({
      provider,
      code: "rate_limit",
      message,
      status: status ?? 429,
      retryable: true,
    });
  }
  if (status === 401 || status === 403 || /invalid api key|unauthorized|permission.?denied/i.test(message)) {
    return new ProviderError({ provider, code: "auth", message, status, retryable: false });
  }
  if (
    /insufficient_quota|quota exceeded|billing|resource.?exhausted|spend limit/i.test(message)
  ) {
    return new ProviderError({
      provider,
      code: "unavailable",
      message,
      status,
      retryable: false,
    });
  }
  if (
    status === 404 ||
    /model.?not.?found|does not exist|not available to|not found for api version/i.test(message)
  ) {
    return new ProviderError({
      provider,
      code: "unavailable",
      message,
      status: status ?? 404,
      retryable: false,
    });
  }
  if (status && status >= 500) {
    return new ProviderError({ provider, code: "server_error", message, status, retryable: true });
  }
  if (/missing content|malformed|invalid json|parse/i.test(message)) {
    return new ProviderError({ provider, code: "malformed", message, retryable: true });
  }
  if (
    /enotfound|econnrefused|econnreset|etimedout|enetunreach|network|fetch failed|socket hang up|dns/i.test(
      message,
    )
  ) {
    return new ProviderError({ provider, code: "unavailable", message, retryable: true });
  }
  return new ProviderError({
    provider,
    code: "unknown",
    message,
    status,
    retryable: false,
  });
}

/** Certification/smoke taxonomy. Never a substitute for throwing the raw secret. */
export type CredentialFailureClass =
  | "ABSENT"
  | "INVALID_CREDENTIAL"
  | "MODEL_UNAVAILABLE"
  | "QUOTA_OR_BILLING"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "HARD_TIMEOUT"
  | "SERVER_ERROR"
  | "MALFORMED"
  | "UNKNOWN";

export function classifyCredentialFailure(
  error: unknown,
  provider: string,
): CredentialFailureClass {
  const classified = classifyThrownError(provider, error);
  const message = classified.message;
  if (/PROVIDER_HARD_TIMEOUT/i.test(message) || (classified.code === "aborted" && /hard/i.test(message))) {
    return "HARD_TIMEOUT";
  }
  if (classified.code === "auth") return "INVALID_CREDENTIAL";
  if (/insufficient_quota|quota exceeded|billing|resource.?exhausted|spend limit/i.test(message)) {
    return "QUOTA_OR_BILLING";
  }
  if (
    classified.status === 404 ||
    /model.?not.?found|does not exist|not available to|not found for api version/i.test(message)
  ) {
    return "MODEL_UNAVAILABLE";
  }
  if (classified.code === "rate_limit") return "RATE_LIMIT";
  if (classified.code === "timeout" || classified.code === "aborted") return "TIMEOUT";
  if (classified.code === "server_error") return "SERVER_ERROR";
  if (classified.code === "malformed") return "MALFORMED";
  if (classified.code === "unavailable") return "MODEL_UNAVAILABLE";
  return "UNKNOWN";
}
