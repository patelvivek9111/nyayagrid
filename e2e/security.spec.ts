import { test, expect } from "@playwright/test";

/**
 * API-level authorization smoke tests. These hit the route handlers directly (no browser UI
 * involved) using Playwright's request fixture, which is the resilient way to assert on HTTP
 * status codes without depending on how an error happens to be rendered in the DOM.
 *
 * Dev auth: omitting the `x-nyayagrid-dev-user` header authenticates as the default dev identity
 * (see playwright.config.ts); sending `x-nyayagrid-dev-user: anonymous` is the supported way for
 * DevAuthProvider to report "no identity" (see packages/auth/src/index.ts), which is what an
 * unauthenticated request looks like in this deployment mode.
 */
const NONEXISTENT_MATTER_ID = "00000000-0000-0000-0000-000000000000";

test.describe("API authorization", () => {
  test("unauthenticated request to a matter is rejected with 401", async ({ request }) => {
    const res = await request.get(`/api/v1/matters/${NONEXISTENT_MATTER_ID}`, {
      headers: { "x-nyayagrid-dev-user": "anonymous" },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error?.code).toBe("UNAUTHENTICATED");
  });

  test("unauthenticated request to the ask endpoint is rejected with 401", async ({ request }) => {
    const res = await request.post(`/api/v1/matters/${NONEXISTENT_MATTER_ID}/ask`, {
      headers: { "x-nyayagrid-dev-user": "anonymous", "Content-Type": "application/json" },
      data: { question: "What happened?", mode: "ask" },
    });
    expect(res.status()).toBe(401);
  });

  test("a forged / nonexistent matter id is rejected, never returned as data", async ({
    request,
  }) => {
    const res = await request.get(`/api/v1/matters/${NONEXISTENT_MATTER_ID}`);
    expect([403, 404]).toContain(res.status());
    const body = await res.json();
    expect(body.matter).toBeUndefined();
  });

  test("a forged matter id on the ask endpoint is rejected, never answered", async ({
    request,
  }) => {
    const res = await request.post(`/api/v1/matters/${NONEXISTENT_MATTER_ID}/ask`, {
      headers: { "Content-Type": "application/json" },
      data: { question: "What happened?", mode: "ask" },
    });
    expect([403, 404]).toContain(res.status());
    const body = await res.json();
    expect(body.qa).toBeUndefined();
  });

  test("unauthenticated request to list organizations is rejected with 401", async ({
    request,
  }) => {
    const res = await request.get("/api/v1/organizations", {
      headers: { "x-nyayagrid-dev-user": "anonymous" },
    });
    expect(res.status()).toBe(401);
  });

  test("unauthenticated matter audit export is rejected with 401", async ({ request }) => {
    const res = await request.get(`/api/v1/matters/${NONEXISTENT_MATTER_ID}/audit/export`, {
      headers: { "x-nyayagrid-dev-user": "anonymous" },
    });
    expect(res.status()).toBe(401);
  });
});
