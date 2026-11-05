/**
 * Staging Clerk — tenant isolation / cross-org negatives.
 *
 * With authenticated storageState: forged IDs must never return foreign data.
 * Without second-org credentials: asserts fail-closed statuses only (no data leak).
 * Cross-org positive/negative with a second identity requires
 * playwright/.auth/staging-user-b.json from a second operator login.
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const AUTH_FILE = path.join(process.cwd(), "playwright", ".auth", "staging-user.json");
const AUTH_FILE_B = path.join(process.cwd(), "playwright", ".auth", "staging-user-b.json");
const hasAuth = fs.existsSync(AUTH_FILE);
const hasAuthB = fs.existsSync(AUTH_FILE_B);
const FORGED = "00000000-0000-0000-0000-000000000000";
const FORGED_ORG = "00000000-0000-0000-0000-000000000001";
const BASE = (process.env.STAGING_E2E_BASE_URL ?? "https://staging.nyayagrid.com").replace(
  /\/$/,
  "",
);

test.describe("Staging Clerk tenant isolation", () => {
  test("unauthenticated context cannot list organizations", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ storageState: undefined });
    const res = await ctx.get(`${BASE}/api/v1/organizations`);
    expect([401, 403]).toContain(res.status());
    await ctx.dispose();
  });

  test("authenticated user never receives forged matter payload", async ({ request }) => {
    test.skip(
      !hasAuth,
      "Missing playwright/.auth/staging-user.json — run auth.setup with Clerk staging identity",
    );
    const res = await request.get(`/api/v1/matters/${FORGED}`);
    expect([401, 403, 404]).toContain(res.status());
    const body = (await res.json().catch(() => ({}))) as { matter?: unknown; data?: unknown };
    expect(body.matter).toBeUndefined();
    expect(body.data).toBeUndefined();
  });

  test("authenticated user never receives forged prosecution case payload", async ({
    request,
  }) => {
    test.skip(
      !hasAuth,
      "Missing playwright/.auth/staging-user.json — run auth.setup with Clerk staging identity",
    );
    const res = await request.get(
      `/api/v1/prosecution/cases/${FORGED}?organizationId=${FORGED_ORG}`,
    );
    expect([401, 403, 404]).toContain(res.status());
    const body = (await res.json().catch(() => ({}))) as {
      criminalCase?: unknown;
      case?: unknown;
      overview?: unknown;
    };
    expect(body.criminalCase).toBeUndefined();
    expect(body.case).toBeUndefined();
    expect(body.overview).toBeUndefined();
  });

  test("authenticated user never receives forged matter documents payload", async ({
    request,
  }) => {
    test.skip(
      !hasAuth,
      "Missing playwright/.auth/staging-user.json — run auth.setup with Clerk staging identity",
    );
    const res = await request.get(`/api/v1/matters/${FORGED}/documents`);
    expect([401, 403, 404]).toContain(res.status());
    const body = (await res.json().catch(() => ({}))) as {
      documents?: unknown;
      items?: unknown;
    };
    expect(body.documents).toBeUndefined();
    expect(body.items).toBeUndefined();
  });

  test("authenticated user cannot manage members of forged org", async ({ request }) => {
    test.skip(
      !hasAuth,
      "Missing playwright/.auth/staging-user.json — run auth.setup with Clerk staging identity",
    );
    const res = await request.get(`/api/v1/organizations/${FORGED_ORG}/members`);
    expect([401, 403, 404]).toContain(res.status());
    const body = (await res.json().catch(() => ({}))) as { members?: unknown };
    expect(body.members).toBeUndefined();
  });

  test("second identity cannot list first identity org as owner without membership", async ({
    playwright,
  }) => {
    test.skip(
      !hasAuth || !hasAuthB,
      "Requires staging-user.json and staging-user-b.json (second interactive Clerk login)",
    );
    const primary = await playwright.request.newContext({ storageState: AUTH_FILE });
    const orgsRes = await primary.get(`${BASE}/api/v1/organizations`);
    expect(orgsRes.ok()).toBeTruthy();
    const orgsBody = (await orgsRes.json()) as {
      organizations?: Array<{ id: string }>;
    };
    const orgId = orgsBody.organizations?.[0]?.id;
    await primary.dispose();
    test.skip(!orgId, "Primary identity has no organizations to probe");

    const secondary = await playwright.request.newContext({ storageState: AUTH_FILE_B });
    const probe = await secondary.get(`${BASE}/api/v1/organizations/${orgId}`);
    expect([401, 403, 404]).toContain(probe.status());
    const body = (await probe.json().catch(() => ({}))) as { organization?: unknown };
    expect(body.organization).toBeUndefined();
    await secondary.dispose();
  });
});
