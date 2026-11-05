/**
 * Staging Clerk — matter audit export authorization.
 * Unauthenticated negative runs without storageState; authenticated probes skip when missing auth file.
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const AUTH_FILE = path.join(process.cwd(), "playwright", ".auth", "staging-user.json");
const hasAuth = fs.existsSync(AUTH_FILE);
const FORGED = "00000000-0000-0000-0000-000000000000";
const BASE = (process.env.STAGING_E2E_BASE_URL ?? "https://staging.nyayagrid.com").replace(
  /\/$/,
  "",
);

test.describe("Staging Clerk audit export (no session)", () => {
  test("missing session cannot export forged matter audit", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ storageState: undefined });
    const res = await ctx.get(`${BASE}/api/v1/matters/${FORGED}/audit/export`);
    expect([401, 403, 404]).toContain(res.status());
    const body = (await res.json().catch(() => ({}))) as { events?: unknown; audit?: unknown };
    expect(body.events).toBeUndefined();
    expect(body.audit).toBeUndefined();
    await ctx.dispose();
  });
});

test.describe("Staging Clerk audit export (authenticated)", () => {
  test.skip(
    !hasAuth,
    "Missing playwright/.auth/staging-user.json — run auth.setup with Clerk staging identity",
  );

  test("forged matter audit export is rejected server-side", async ({ request }) => {
    const res = await request.get(`/api/v1/matters/${FORGED}/audit/export`);
    expect([401, 403, 404]).toContain(res.status());
    const body = (await res.json().catch(() => ({}))) as { events?: unknown; audit?: unknown };
    expect(body.events).toBeUndefined();
    expect(body.audit).toBeUndefined();
  });

  test("authenticated session cannot leak audit events for forged matter", async ({ request }) => {
    const res = await request.get(`/api/v1/matters/${FORGED}/audit/export`);
    expect([401, 403, 404]).toContain(res.status());
    const text = await res.text();
    expect(text.toLowerCase()).not.toMatch(/privileged|attorney.?client|confidential client/);
  });
});
