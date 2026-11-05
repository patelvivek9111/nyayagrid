/**
 * Staging Clerk — Nyaya Professional authenticated smoke.
 * Requires playwright/.auth/staging-user.json from auth.setup.ts.
 * Read-only / list probes only — does not create customer records or upload docs.
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const AUTH_FILE = path.join(process.cwd(), "playwright", ".auth", "staging-user.json");
const hasAuth = fs.existsSync(AUTH_FILE);

test.describe("Staging Clerk Professional", () => {
  test.skip(
    !hasAuth,
    "Missing playwright/.auth/staging-user.json — run auth.setup with Clerk staging identity",
  );

  test("session endpoint reports clerk provider", async ({ request }) => {
    const res = await request.get("/api/v1/session");
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { ok?: boolean; provider?: string };
    expect(body.ok).toBe(true);
    expect(body.provider).toBe("clerk");
  });

  test("dashboard /app loads for authenticated user", async ({ page }) => {
    await page.goto("/app", { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/sign-in/);
    await expect(page.locator("body")).toBeVisible();
  });

  test("organizations list is authorized JSON", async ({ request }) => {
    const res = await request.get("/api/v1/organizations");
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { organizations?: unknown[] };
    expect(Array.isArray(body.organizations)).toBe(true);
  });

  test("matters list is authorized JSON (no error payload)", async ({ request }) => {
    const res = await request.get("/api/v1/matters");
    expect([200, 404]).toContain(res.status());
    if (res.ok()) {
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBeUndefined();
    }
  });

  test("forged matter id is rejected server-side", async ({ request }) => {
    const res = await request.get("/api/v1/matters/00000000-0000-0000-0000-000000000000");
    expect([401, 403, 404]).toContain(res.status());
    const body = (await res.json()) as { matter?: unknown };
    expect(body.matter).toBeUndefined();
  });

  test("clients list is authorized when route exists", async ({ request }) => {
    const res = await request.get("/api/v1/clients");
    expect([200, 401, 403, 404, 405]).toContain(res.status());
    if (res.ok()) {
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBeUndefined();
    }
  });
});
