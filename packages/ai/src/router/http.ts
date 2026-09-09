/**
 * Bounded provider HTTP transport shared by all adapters.
 *
 * Retries only 429 (honoring Retry-After when present) and transient 5xx/408.
 * Non-retryable 4xx fail immediately. Total attempts are capped.
 */

import { ProviderError, type ProviderErrorCode } from "./errors";

export const DEFAULT_PROVIDER_MAX_RETRIES = 2;
export const DEFAULT_PROVIDER_RETRY_CAP_MS = 8_000;

const RETRYABLE_STATUS = new Set([408, 429]);

export function isRetryableProviderStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status) || status >= 500;
}

export function parseRetryAfterMs(
  header: string | null,
  nowMs = Date.now(),
  capMs = DEFAULT_PROVIDER_RETRY_CAP_MS,
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
  if (signal?.aborted) throw abortError();
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

/**
 * Extract provider error type/code from a failed HTTP body.
 * Does not include request/prompt bodies. Redacts key-shaped tokens.
 */
export function classifyProviderHttpErrorBody(text: string): string {
  const clipped = text.trim().slice(0, 500);
  if (!clipped) return "";
  try {
    const json = JSON.parse(clipped) as {
      type?: string;
      error?: { type?: string; code?: string; message?: string };
      message?: string;
    };
    const type = json.error?.type ?? json.type ?? "unknown";
    const code = json.error?.code ?? "none";
    const rawMsg = String(json.error?.message ?? json.message ?? "")
      .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
      .replace(/key[=:]\s*\S+/gi, "key=[redacted]")
      .slice(0, 120)
      .replace(/\s+/g, " ")
      .trim();
    return ` type=${type} code=${code}${rawMsg ? ` msg=${rawMsg}` : ""}`;
  } catch {
    return "";
  }
}

function codeForStatus(status: number): ProviderErrorCode {
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "auth";
  if (status === 408) return "timeout";
  if (status >= 500) return "server_error";
  if (status === 404) return "unavailable";
  return "unknown";
}

export async function readResponseText(
  response: Response,
  signal?: AbortSignal,
  maxBytes = 2_000_000,
): Promise<string> {
  if (signal?.aborted) throw abortError();
  const body = response.body;
  if (!body) {
    return await response.text();
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => undefined);
        throw abortError();
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ProviderError({
          provider: "http",
          code: "malformed",
          message: "response body exceeded max bytes",
        });
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readResponseJson(
  response: Response,
  signal?: AbortSignal,
  maxBytes = 2_000_000,
): Promise<unknown> {
  const text = await readResponseText(response, signal, maxBytes);
  return JSON.parse(text) as unknown;
}

export function requestAbortSignal(
  request: { signal?: AbortSignal },
  timeoutMs = 60_000,
): AbortSignal {
  if (request.signal) return request.signal;
  return AbortSignal.timeout(timeoutMs);
}

export type ProviderFetchOptions = {
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  retryCapMs?: number;
  now?: () => number;
  provider: string;
};

/**
 * fetch() with a hard retry budget. 4xx other than 408/429 never retry.
 * Does not log request bodies or Authorization headers.
 */
export async function fetchProviderWithRetry(
  url: string,
  init: RequestInit,
  options: ProviderFetchOptions,
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const isolated = process.env.NYAYA_CERT_ISOLATED === "1";
  const requested = options.maxRetries ?? (isolated ? 0 : DEFAULT_PROVIDER_MAX_RETRIES);
  const maxRetries = Math.min(Math.max(0, requested), DEFAULT_PROVIDER_MAX_RETRIES);
  const retryCapMs = options.retryCapMs ?? DEFAULT_PROVIDER_RETRY_CAP_MS;
  const now = options.now ?? Date.now;
  let attempt = 0;

  while (true) {
    if (init.signal?.aborted) throw abortError();
    const response = await fetchImpl(url, init);
    if (response.ok) return response;

    const retryable = isRetryableProviderStatus(response.status);
    const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"), now(), retryCapMs);
    if (!retryable || attempt >= maxRetries) {
      const extra = classifyProviderHttpErrorBody(
        await readResponseText(response, init.signal ?? undefined, 2_000).catch(() => ""),
      );
      throw new ProviderError({
        provider: options.provider,
        code: codeForStatus(response.status),
        status: response.status,
        retryable,
        retryAfterMs,
        message: `${options.provider} request failed with status ${response.status}${extra}`,
      });
    }

    await discardBody(response);
    const backoff = retryAfterMs ?? Math.min(250 * 2 ** attempt, retryCapMs);
    await sleepMs(backoff, init.signal ?? undefined);
    attempt += 1;
  }
}

export async function generateWithTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  if (signal?.aborted) {
    throw abortError();
  }
  signal?.addEventListener("abort", onOuterAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const timeout = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () =>
      reject(
        signal?.aborted
          ? abortError()
          : Object.assign(new Error(`AI provider timed out after ${timeoutMs}ms`), {
              name: "TimeoutError",
            }),
      ),
    );
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }
}

export function estimateTokensFromMessages(
  messages: Array<{ content: string }>,
): number {
  const chars = messages.reduce((sum, m) => sum + m.content.length, 0);
  return Math.max(1, Math.ceil(chars / 4));
}
