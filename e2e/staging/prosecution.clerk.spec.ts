/**
 * Staging Clerk — Nyaya Prosecution authenticated smoke.
 * Synthetic ID probes only. No real evidence uploads or confidential docs.
 *
 * Case overview GET requires organizationId; forged probes always include a
 * synthetic org UUID so authenticated runs do not false-fail on 400 validation.
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const AUTH_FILE = path.join(process.cwd(), "playwright", ".auth", "staging-user.json");
const hasAuth = fs.existsSync(AUTH_FILE);
const FORGED_CASE = "00000000-0000-0000-0000-000000000000";
const FORGED_ORG = "00000000-0000-0000-0000-000000000001";
const BASE = (process.env.STAGING_E2E_BASE_URL ?? "https://staging.nyayagrid.com").replace(
  /\/$/,
  "",
);

test.describe("Staging Clerk Prosecution (no session)", () => {
  test("unauthenticated prosecution case access is rejected", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ storageState: undefined });
    const res = await ctx.get(
      `${BASE}/api/v1/prosecution/cases/${FORGED_CASE}?organizationId=${FORGED_ORG}`,
    );
    expect([401, 403]).toContain(res.status());
    await ctx.dispose();
  });

  test("unauthenticated prosecution evidence write is rejected", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ storageState: undefined });
    const res = await ctx.post(
      `${BASE}/api/v1/prosecution/cases/${FORGED_CASE}/evidence?organizationId=${FORGED_ORG}`,
      {
        data: {
          evidenceType: "e2e-synthetic-probe",
          provenance: { humanEntered: true },
        },
      },
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
    const res = await request.get(
      `/api/v1/prosecution/cases/${FORGED_CASE}?organizationId=${FORGED_ORG}`,
    );
    expect([401, 403, 404]).toContain(res.status());
    const body = (await res.json().catch(() => ({}))) as {
      criminalCase?: unknown;
      overview?: unknown;
    };
    expect(body.criminalCase).toBeUndefined();
    expect(body.overview).toBeUndefined();
  });

  test("forged DA office cannot list criminal cases", async ({ request }) => {
    const res = await request.get(`/api/v1/prosecution/cases?organizationId=${FORGED_ORG}`);
    expect([401, 403, 404]).toContain(res.status());
    const body = (await res.json().catch(() => ({}))) as { cases?: unknown };
    if (Array.isArray(body.cases)) {
      expect(body.cases.length).toBe(0);
    } else {
      expect(body.cases).toBeUndefined();
    }
  });

  test("forged case evidence write is rejected server-side", async ({ request }) => {
    const res = await request.post(
      `/api/v1/prosecution/cases/${FORGED_CASE}/evidence?organizationId=${FORGED_ORG}`,
      {
        data: {
          evidenceType: "e2e-synthetic-probe",
          provenance: { humanEntered: true },
        },
      },
    );
    expect([401, 403, 404]).toContain(res.status());
  });

  test("session remains clerk while on prosecution surface", async ({ request }) => {
    const res = await request.get("/api/v1/session");
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { ok?: boolean; provider?: string };
    expect(body.ok).toBe(true);
    expect(body.provider).toBe("clerk");
  });
});
