/**
 * Staging Clerk — Nyaya Prosecution authenticated smoke.
 * Synthetic ID probes only. No real evidence uploads or confidential docs.
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const AUTH_FILE = path.join(process.cwd(), "playwright", ".auth", "staging-user.json");
const hasAuth = fs.existsSync(AUTH_FILE);
const BASE = (process.env.STAGING_E2E_BASE_URL ?? "https://staging.nyayagrid.com").replace(
  /\/$/,
  "",
);

test.describe("Staging Clerk Prosecution (no session)", () => {
  test("unauthenticated prosecution case access is rejected", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ storageState: undefined });
    const res = await ctx.get(
      `${BASE}/api/v1/prosecution/cases/00000000-0000-0000-0000-000000000000`,
    );
    expect([401, 403]).toContain(res.status());
    await ctx.dispose();
  });
});

test.describe("Staging Clerk Prosecution (authenticated)", () => {
  test.skip(
    !hasAuth,
    "Missing playwright/.auth/staging-user.json — run auth.setup with Clerk staging identity",
  );

  test("prosecution workspace route is reachable when authenticated", async ({ page }) => {
    await page.goto("/app/prosecution", { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/sign-in/);
    await expect(page.locator("body")).toBeVisible();
  });

  test("forged criminal case id is rejected server-side", async ({ request }) => {
    const res = await request.get("/api/v1/prosecution/cases/00000000-0000-0000-0000-000000000000");
    expect([401, 403, 404]).toContain(res.status());
    const body = (await res.json()) as { criminalCase?: unknown };
    expect(body.criminalCase).toBeUndefined();
  });

  test("session remains clerk while on prosecution surface", async ({ request }) => {
    const res = await request.get("/api/v1/session");
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { ok?: boolean; provider?: string };
    expect(body.ok).toBe(true);
    expect(body.provider).toBe("clerk");
  });
});
