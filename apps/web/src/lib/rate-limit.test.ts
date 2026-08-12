import { beforeEach, describe, expect, it } from "vitest";
import { getRateLimiter, RATE_LIMIT_PRESETS, type InMemoryRateLimiter } from "@nyayagrid/platform";
import { enforceRateLimit } from "./rate-limit";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/api/v1/test", { headers });
}

describe("enforceRateLimit", () => {
  beforeEach(() => {
    (getRateLimiter() as InMemoryRateLimiter).reset();
  });

  it("allows requests under the limit and returns a 429 with Retry-After once exceeded", async () => {
    const preset = RATE_LIMIT_PRESETS.auth; // ip-scoped
    const request = makeRequest({ "x-forwarded-for": "203.0.113.5" });

    for (let i = 0; i < preset.limit; i++) {
      expect(await enforceRateLimit(request, { endpointClass: "auth" })).toBeNull();
    }

    const blocked = await enforceRateLimit(request, { endpointClass: "auth" });
    expect(blocked).not.toBeNull();
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get("Retry-After")).toMatch(/^\d+$/);

    const body = (await blocked?.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  it("scopes ip-based endpoint classes independently per derived IP", async () => {
    const preset = RATE_LIMIT_PRESETS.auth;
    const requestA = makeRequest({ "x-forwarded-for": "203.0.113.10" });
    const requestB = makeRequest({ "x-forwarded-for": "203.0.113.20" });

    for (let i = 0; i < preset.limit; i++) {
      expect(await enforceRateLimit(requestA, { endpointClass: "auth" })).toBeNull();
    }
    expect(await enforceRateLimit(requestA, { endpointClass: "auth" })).not.toBeNull();
    // A different source IP is a separate bucket, so it is unaffected.
    expect(await enforceRateLimit(requestB, { endpointClass: "auth" })).toBeNull();
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", async () => {
    const request = makeRequest({ "x-real-ip": "198.51.100.7" });
    expect(await enforceRateLimit(request, { endpointClass: "auth" })).toBeNull();
  });

  it("honors an explicit ip override for tests, ignoring request headers", async () => {
    const request = makeRequest({ "x-forwarded-for": "203.0.113.99" });
    const preset = RATE_LIMIT_PRESETS.auth;

    for (let i = 0; i < preset.limit; i++) {
      expect(
        await enforceRateLimit(request, { endpointClass: "auth", ip: "192.0.2.99" }),
      ).toBeNull();
    }
    expect(
      await enforceRateLimit(request, { endpointClass: "auth", ip: "192.0.2.99" }),
    ).not.toBeNull();
    // The header-derived IP has its own, still-untouched bucket.
    expect(await enforceRateLimit(request, { endpointClass: "auth" })).toBeNull();
  });

  it("scopes organization-based endpoint classes by organizationId, not the caller's IP", async () => {
    const request = makeRequest();
    const preset = RATE_LIMIT_PRESETS.upload;

    for (let i = 0; i < preset.limit; i++) {
      expect(
        await enforceRateLimit(request, { endpointClass: "upload", organizationId: "org-1" }),
      ).toBeNull();
    }
    expect(
      await enforceRateLimit(request, { endpointClass: "upload", organizationId: "org-1" }),
    ).not.toBeNull();
    // A different organization has its own budget.
    expect(
      await enforceRateLimit(request, { endpointClass: "upload", organizationId: "org-2" }),
    ).toBeNull();
  });
});
