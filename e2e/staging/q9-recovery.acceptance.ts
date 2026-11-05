import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Queue #9 authenticated staging acceptance (requires setup project storageState).
 * Synthetic probes only. Does not print auth material.
 */
const AUTH_FILE = path.join(process.cwd(), "playwright", ".auth", "staging-user.json");
const hasAuth = fs.existsSync(AUTH_FILE);

test.describe("Q9 staging recovery acceptance", () => {
  test.skip(
    !hasAuth,
    "Missing playwright/.auth/staging-user.json — run auth.setup with Clerk staging identity",
  );

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
