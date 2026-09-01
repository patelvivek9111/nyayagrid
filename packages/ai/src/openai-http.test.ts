import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OPENAI_MAX_RETRIES,
  fetchOpenAIWithRetry,
  isRetryableOpenAIStatus,
  parseRetryAfterMs,
} from "./openai-http";

function jsonResponse(status: number, headers?: Record<string, string>): Response {
  return new Response("{}", { status, headers });
}

describe("OpenAI HTTP retry policy", () => {
  it("treats 429 and 5xx as retryable and 400/401/404 as not", () => {
    expect(isRetryableOpenAIStatus(429)).toBe(true);
    expect(isRetryableOpenAIStatus(503)).toBe(true);
    expect(isRetryableOpenAIStatus(500)).toBe(true);
    expect(isRetryableOpenAIStatus(408)).toBe(true);
    expect(isRetryableOpenAIStatus(400)).toBe(false);
    expect(isRetryableOpenAIStatus(401)).toBe(false);
    expect(isRetryableOpenAIStatus(404)).toBe(false);
  });

  it("caps Retry-After seconds and HTTP-date deltas", () => {
    expect(parseRetryAfterMs("120", 0, 8_000)).toBe(8_000);
    expect(parseRetryAfterMs("2", 0, 8_000)).toBe(2_000);
    expect(parseRetryAfterMs(new Date(5_000).toUTCString(), 0, 8_000)).toBe(5_000);
    expect(parseRetryAfterMs("not-a-value")).toBeUndefined();
  });

  it("returns the first successful response without retry", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200));
    const response = await fetchOpenAIWithRetry("https://api.openai.com/v1/chat/completions", {
      method: "POST",
    }, { fetchImpl });
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries 429 honoring Retry-After then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { "retry-after": "0" }))
      .mockResolvedValueOnce(jsonResponse(200));
    const response = await fetchOpenAIWithRetry(
      "https://api.openai.com/v1/chat/completions",
      { method: "POST" },
      { fetchImpl, retryCapMs: 10 },
    );
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries transient 5xx a bounded number of times then throws", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, { "retry-after": "0" }));
    await expect(
      fetchOpenAIWithRetry(
        "https://api.openai.com/v1/chat/completions",
        { method: "POST" },
        { fetchImpl, retryCapMs: 1 },
      ),
    ).rejects.toMatchObject({ name: "OpenAIHttpError", status: 503, retryable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(DEFAULT_OPENAI_MAX_RETRIES + 1);
  });

  it("does not retry non-retryable 4xx", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400));
    await expect(
      fetchOpenAIWithRetry("https://api.openai.com/v1/chat/completions", { method: "POST" }, { fetchImpl }),
    ).rejects.toMatchObject({ status: 400, retryable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stops immediately when the caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async () => jsonResponse(200));
    await expect(
      fetchOpenAIWithRetry(
        "https://api.openai.com/v1/chat/completions",
        { method: "POST", signal: controller.signal },
        { fetchImpl },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
