/**
 * Staging Clerk — authorization negatives (server-side, no session).
 * Does not require storageState / Clerk credentials.
 */
import { test, expect } from "@playwright/test";

const BASE = (process.env.STAGING_E2E_BASE_URL ?? "https://staging.nyayagrid.com").replace(
  /\/$/,
  "",
);
const FORGED = "00000000-0000-0000-0000-000000000000";
const FORGED_ORG = "00000000-0000-0000-0000-000000000001";

test.describe("Staging Clerk security negatives", () => {
  test("missing session cannot list organizations", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ storageState: undefined });
    const res = await ctx.get(`${BASE}/api/v1/organizations`);
    expect([401, 403]).toContain(res.status());
    await ctx.dispose();
  });

  test("missing session cannot read forged matter", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ storageState: undefined });
    const res = await ctx.get(`${BASE}/api/v1/matters/${FORGED}`);
    expect([401, 403, 404]).toContain(res.status());
    const body = (await res.json().catch(() => ({}))) as { matter?: unknown };
    expect(body.matter).toBeUndefined();
    await ctx.dispose();
  });

  test("missing session cannot list forged matter documents", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ storageState: undefined });
    const res = await ctx.get(`${BASE}/api/v1/matters/${FORGED}/documents`);
    expect([401, 403, 404]).toContain(res.status());
    const body = (await res.json().catch(() => ({}))) as {
      documents?: unknown;
      items?: unknown;
    };
    expect(body.documents).toBeUndefined();
    expect(body.items).toBeUndefined();
    await ctx.dispose();
  });

  test("missing session cannot read forged prosecution case", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ storageState: undefined });
    const res = await ctx.get(
      `${BASE}/api/v1/prosecution/cases/${FORGED}?organizationId=${FORGED_ORG}`,
    );
    expect([401, 403, 404]).toContain(res.status());
    const body = (await res.json().catch(() => ({}))) as {
      criminalCase?: unknown;
      overview?: unknown;
    };
    expect(body.criminalCase).toBeUndefined();
    expect(body.overview).toBeUndefined();
    await ctx.dispose();
  });

  test("missing session cannot list forged org members", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ storageState: undefined });
    const res = await ctx.get(`${BASE}/api/v1/organizations/${FORGED_ORG}/members`);
    expect([401, 403]).toContain(res.status());
    const body = (await res.json().catch(() => ({}))) as { members?: unknown };
    expect(body.members).toBeUndefined();
    await ctx.dispose();
  });

  test("ready health remains public without session", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ storageState: undefined });
    const res = await ctx.get(`${BASE}/api/health/ready`);
    expect(res.ok()).toBeTruthy();
    await ctx.dispose();
  });
});
