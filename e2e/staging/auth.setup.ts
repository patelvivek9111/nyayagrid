/**
 * Staging Clerk auth setup for WP-05 authenticated E2E.
 *
 * Modes (priority):
 * 1) Reuse playwright/.auth/staging-user.json when session still valid
 * 2) Optional: E2E_CLERK_USER_EMAIL + CLERK_SECRET_KEY + CLERK_PUBLISHABLE_KEY
 *    via @clerk/testing (installed). Note: Clerk's emailAddress helper does not
 *    satisfy MFA — use only for synthetic users allowed without MFA under policy,
 *    otherwise use interactive mode.
 * 3) Interactive headed Clerk login when STAGING_AUTH_INTERACTIVE=1 — human
 *    completes sign-in including MFA; storageState saved locally
 *
 * MFA must remain enabled on the Clerk instance and in NyayaGrid policy.
 * Never prints cookies/tokens. Never targets production host.
 */
import { test as setup, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const AUTH_DIR = path.join(process.cwd(), "playwright", ".auth");
const AUTH_FILE = path.join(AUTH_DIR, "staging-user.json");
const BASE = (process.env.STAGING_E2E_BASE_URL ?? "https://staging.nyayagrid.com").replace(
  /\/$/,
  "",
);
const WAIT_MS = Number(process.env.STAGING_AUTH_WAIT_MS ?? 10 * 60_000);

function assertStagingHost(url: string): void {
  const host = new URL(url).hostname;
  if (/nyayagrid\.com$/i.test(host) && !/staging/i.test(url)) {
    throw new Error("Refusing Clerk auth setup against non-staging nyayagrid.com host");
  }
}

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
  assertStagingHost(BASE);
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  if (fs.existsSync(AUTH_FILE) && process.env.STAGING_AUTH_FORCE !== "1") {
    if (await sessionValid(AUTH_FILE)) return;
  }

  const email = process.env.E2E_CLERK_USER_EMAIL?.trim();
  const secret = process.env.CLERK_SECRET_KEY?.trim();
  const publishable =
    process.env.CLERK_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();

  if (email && secret && publishable) {
    try {
      const testing = await import("@clerk/testing/playwright");
      if (testing.clerk && testing.clerkSetup) {
        // Align env names expected by clerkSetup / Backend API helpers.
        process.env.CLERK_PUBLISHABLE_KEY = publishable;
        process.env.CLERK_SECRET_KEY = secret;
        await testing.clerkSetup({ dotenv: false });
        // Prefer an unprotected page that loads Clerk JS (marketing/home).
        await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
        await testing.clerk.signIn({ page, emailAddress: email });
        await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
        await expect(page).not.toHaveURL(/sign-in/);
        const session = await page.request.get(`${BASE}/api/v1/session`);
        expect(session.ok()).toBeTruthy();
        const sessionBody = (await session.json()) as { ok?: boolean; provider?: string };
        expect(sessionBody.ok).toBe(true);
        expect(sessionBody.provider).toBe("clerk");
        await page.context().storageState({ path: AUTH_FILE });
        return;
      }
    } catch {
      // Fall through — MFA-enrolled users or missing Testing Token often fail here.
    }
  }

  if (process.env.STAGING_AUTH_INTERACTIVE !== "1") {
    setup.skip(
      true,
      "Set E2E_CLERK_USER_EMAIL+CLERK_SECRET_KEY+CLERK_PUBLISHABLE_KEY (@clerk/testing) or STAGING_AUTH_INTERACTIVE=1 for headed Clerk login (MFA preserved)",
    );
    return;
  }

  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
  // Human completes Clerk sign-in (including MFA) in the headed window.
  // Do not paste passwords or OTP codes into chat/source.
  await page.waitForURL(/\/app(\/|$)/, { timeout: WAIT_MS });
  await expect(page).not.toHaveURL(/sign-in/);

  const session = await page.request.get(`${BASE}/api/v1/session`);
  expect(session.ok()).toBeTruthy();
  const sessionBody = (await session.json()) as { ok?: boolean; provider?: string };
  expect(sessionBody.ok).toBe(true);
  expect(sessionBody.provider).toBe("clerk");

  await page.context().storageState({ path: AUTH_FILE });
});
