import { test, expect } from "@playwright/test";

/**
 * Queue #9 authenticated staging acceptance (requires setup project storageState).
 * Synthetic matter only. Does not print auth material.
 */
test.describe("Q9 staging recovery acceptance", () => {
  test("session is Clerk-authenticated on staging", async ({ request, baseURL }) => {
    expect(baseURL).toMatch(/staging/i);
    const denied = await fetch(`${baseURL}/api/v1/matters`);
    expect(denied.status).toBe(401);
    const session = await request.get("/api/v1/session");
    expect(session.ok()).toBeTruthy();
    const body = await session.json();
    expect(body.ok).toBe(true);
    expect(body.provider).toBe("clerk");
  });
});
