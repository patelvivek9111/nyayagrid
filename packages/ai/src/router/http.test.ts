import { describe, expect, it, vi } from "vitest";
import {
  classifyProviderHttpErrorBody,
  fetchProviderWithRetry,
  isRetryableProviderStatus,
} from "./http";
import { ProviderError } from "./errors";

function jsonResponse(status: number, headers?: Record<string, string>): Response {
  return new Response("{}", { status, headers });
}

describe("provider HTTP retry", () => {
  it("retries 429 a bounded number of times then throws ProviderError", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(429, { "retry-after": "0" }));
    await expect(
      fetchProviderWithRetry(
        "https://example.test/v1",
        { method: "POST" },
        { provider: "openai", fetchImpl, retryCapMs: 1, maxRetries: 2 },
      ),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(isRetryableProviderStatus(429)).toBe(true);
    expect(isRetryableProviderStatus(400)).toBe(false);
  });

  it("classifies Anthropic 400 type without including prompt bodies", () => {
    const extra = classifyProviderHttpErrorBody(
      JSON.stringify({
        type: "error",
        error: { type: "invalid_request_error", message: "messages: text content cannot be empty" },
      }),
    );
    expect(extra).toContain("type=invalid_request_error");
    expect(extra).toContain("text content cannot be empty");
    expect(extra).not.toContain("sk-");
  });

  it("surfaces 400 class on ProviderError without retrying", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            type: "error",
            error: { type: "invalid_request_error", message: "max_tokens: extra fields not permitted" },
          }),
          { status: 400 },
        ),
    );
    await expect(
      fetchProviderWithRetry(
        "https://example.test/v1",
        { method: "POST" },
        { provider: "anthropic", fetchImpl },
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("type=invalid_request_error"),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("disables adapter retries when NYAYA_CERT_ISOLATED=1", async () => {
    const previous = process.env.NYAYA_CERT_ISOLATED;
    process.env.NYAYA_CERT_ISOLATED = "1";
    const fetchImpl = vi.fn(async () => jsonResponse(429, { "retry-after": "0" }));
    try {
      await expect(
        fetchProviderWithRetry(
          "https://example.test/v1",
          { method: "POST" },
          { provider: "google", fetchImpl, retryCapMs: 1 },
        ),
      ).rejects.toBeInstanceOf(ProviderError);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      if (previous === undefined) delete process.env.NYAYA_CERT_ISOLATED;
      else process.env.NYAYA_CERT_ISOLATED = previous;
    }
  });
});
