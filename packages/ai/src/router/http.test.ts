import { describe, expect, it, vi } from "vitest";
import { fetchProviderWithRetry, isRetryableProviderStatus } from "./http";
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
});
