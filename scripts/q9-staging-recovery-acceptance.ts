/**
 * Queue #9 staging recovery acceptance (Clerk session required).
 *
 * Auth (pick one; never commit secrets):
 *   SMOKE_AUTH_HEADER   Cookie or Authorization value for staging
 *   or Playwright storageState at playwright/.auth/staging-user.json
 *
 *   npx playwright test -c playwright.staging.config.ts --project=setup
 *   npx tsx scripts/q9-staging-recovery-acceptance.ts
 *
 * Refuses production host. Does not print cookies/tokens.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = (process.env.STAGING_E2E_BASE_URL ?? "https://staging.nyayagrid.com").replace(/\/$/, "");
const AUTH_FILE = path.join(process.cwd(), "playwright", ".auth", "staging-user.json");

if (/nyayagrid\.com$/i.test(new URL(BASE).hostname) && !/staging/i.test(BASE)) {
  throw new Error("Refusing non-staging host");
}

type Result = { name: string; pass: boolean; detail?: string };

async function main() {
  const results: Result[] = [];
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(
    fs.existsSync(AUTH_FILE) ? { storageState: AUTH_FILE } : undefined,
  );
  const page = await context.newPage();

  const headers: Record<string, string> = { "content-type": "application/json" };
  const smoke = process.env.SMOKE_AUTH_HEADER?.trim();
  if (smoke) {
    if (smoke.toLowerCase().startsWith("bearer ")) headers.authorization = smoke;
    else headers.cookie = smoke;
  }

  async function api(pathname: string, init: RequestInit = {}) {
    const res = await page.request.fetch(`${BASE}${pathname}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status(), ok: res.ok(), body };
  }

  const unauth = await fetch(`${BASE}/api/v1/matters`);
  results.push({ name: "unauth_401", pass: unauth.status === 401 });

  const session = await api("/api/v1/session");
  results.push({
    name: "auth_session",
    pass: session.ok && session.body?.provider === "clerk",
    detail: `status=${session.status}`,
  });

  if (!session.ok) {
    console.log(JSON.stringify({ blocked: "authenticated_session_required", results }, null, 2));
    await browser.close();
    process.exit(2);
  }

  console.log(
    JSON.stringify(
      {
        note: "Full matrix is exercised via Cursor browser Clerk session in Phase D; this script verifies auth bootstrap.",
        results,
        authFilePresent: fs.existsSync(AUTH_FILE),
        smokeHeaderPresent: Boolean(smoke),
      },
      null,
      2,
    ),
  );
  await browser.close();
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
