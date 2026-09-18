/**
 * Staging Clerk auth setup for Queue #9.
 *
 * Modes (priority):
 * 1) Reuse playwright/.auth/staging-user.json when session still valid
 * 2) Optional: E2E_CLERK_USER_EMAIL + CLERK_SECRET_KEY with @clerk/testing (if installed)
 * 3) Interactive headed Clerk login — human completes sign-in once; storageState saved locally
 *
 * Never prints cookies/tokens. Never targets production host.
 */
import { test as setup, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const AUTH_DIR = path.join(process.cwd(), "playwright", ".auth");
const AUTH_FILE = path.join(AUTH_DIR, "staging-user.json");
const BASE = (process.env.STAGING_E2E_BASE_URL ?? "https://staging.nyayagrid.com").replace(/\/$/, "");
const WAIT_MS = Number(process.env.STAGING_AUTH_WAIT_MS ?? 10 * 60_000);

async function sessionValid(storageStatePath: string): Promise<boolean> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState: storageStatePath });
    const page = await context.newPage();
    const res = await page.request.get(`${BASE}/api/v1/session`);
    if (!res.ok()) return false;
    const body = (await res.json()) as { ok?: boolean; provider?: string };
    return Boolean(body.ok && body.provider === "clerk");
  } catch {
    return false;
  } finally {
    await browser.close();
  }
}

setup("authenticate against staging via Clerk", async ({ page }) => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  if (fs.existsSync(AUTH_FILE) && process.env.STAGING_AUTH_FORCE !== "1") {
    if (await sessionValid(AUTH_FILE)) return;
  }

  const email = process.env.E2E_CLERK_USER_EMAIL?.trim();
  const secret = process.env.CLERK_SECRET_KEY?.trim();
  if (email && secret) {
    try {
      const testing = await import("@clerk/testing/playwright").catch(() => null);
      if (testing?.clerk && testing?.clerkSetup) {
        await testing.clerkSetup();
        await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
        await testing.clerk.signIn({ page, emailAddress: email });
        await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
        await expect(page).not.toHaveURL(/sign-in/);
        await page.context().storageState({ path: AUTH_FILE });
        return;
      }
    } catch {
      // Fall through to interactive Clerk login.
    }
  }

  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
  // Human completes Clerk sign-in in the headed window. Do not paste passwords into chat/source.
  await page.waitForURL(/\/app(\/|$)/, { timeout: WAIT_MS });
  await expect(page).not.toHaveURL(/sign-in/);

  const session = await page.request.get(`${BASE}/api/v1/session`);
  expect(session.ok()).toBeTruthy();
  const sessionBody = (await session.json()) as { ok?: boolean; provider?: string };
  expect(sessionBody.ok).toBe(true);
  expect(sessionBody.provider).toBe("clerk");

  await page.context().storageState({ path: AUTH_FILE });
});
