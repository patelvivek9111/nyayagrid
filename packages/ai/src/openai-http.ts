/**
 * Bounded OpenAI HTTP transport.
 *
 * Retries only 429 (honoring Retry-After when present) and transient 5xx/408.
 * Non-retryable 4xx fail immediately. Total attempts are capped — never infinite.
 * Callers still wrap generate() in ResilientAIProvider's per-attempt timeout.
 */

export class OpenAIHttpError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(params: {
    status: number;
    retryable: boolean;
    retryAfterMs?: number;
    message?: string;
  }) {
    super(params.message ?? `OpenAI request failed with status ${params.status}`);
    this.name = "OpenAIHttpError";
    this.status = params.status;
    this.retryable = params.retryable;
    this.retryAfterMs = params.retryAfterMs;
  }
}

export const DEFAULT_OPENAI_MAX_RETRIES = 2;
export const DEFAULT_OPENAI_RETRY_CAP_MS = 8_000;

const RETRYABLE_STATUS = new Set([408, 429]);

export function isRetryableOpenAIStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status) || status >= 500;
}

export function parseRetryAfterMs(
  header: string | null,
  nowMs = Date.now(),
  capMs = DEFAULT_OPENAI_RETRY_CAP_MS,
): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (!trimmed) return undefined;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, capMs);
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    return Math.min(Math.max(0, dateMs - nowMs), capMs);
  }
  return undefined;
}

export async function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal?.aborted) {
    throw abortError();
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    /* ignore */
  }
}

export type OpenAIFetchOptions = {
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  retryCapMs?: number;
  now?: () => number;
};

/**
 * fetch() with a hard retry budget. 4xx (other than 408/429) never retry.
 */
export async function fetchOpenAIWithRetry(
  url: string,
  init: RequestInit,
  options: OpenAIFetchOptions = {},
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const isolated = process.env.NYAYA_CERT_ISOLATED === "1";
  const maxRetries = options.maxRetries ?? (isolated ? 0 : DEFAULT_OPENAI_MAX_RETRIES);
  const retryCapMs = options.retryCapMs ?? DEFAULT_OPENAI_RETRY_CAP_MS;
  const now = options.now ?? Date.now;
  let attempt = 0;

  while (true) {
    if (init.signal?.aborted) {
      throw abortError();
    }
    const response = await fetchImpl(url, init);
    if (response.ok) return response;

    const retryable = isRetryableOpenAIStatus(response.status);
    const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"), now(), retryCapMs);
    if (!retryable || attempt >= maxRetries) {
      await discardBody(response);
      throw new OpenAIHttpError({
        status: response.status,
        retryable,
        retryAfterMs,
      });
    }

    await discardBody(response);
    const backoff = retryAfterMs ?? Math.min(250 * 2 ** attempt, retryCapMs);
    await sleepMs(backoff, init.signal ?? undefined);
    attempt += 1;
  }
}
