import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

/**
 * Staging Clerk auth for Queue #9 acceptance.
 * Does NOT enable DevAuth. Does NOT use production host.
 *
 * Auth artifact: playwright/.auth/staging-user.json (gitignored).
 * Preferred: interactive Clerk login once, then reuse storageState.
 * Optional: SMOKE_AUTH_HEADER for API-only scripts (scripts/q9-staging-recovery-acceptance.ts).
 */
const STAGING_URL = (process.env.STAGING_E2E_BASE_URL ?? "https://staging.nyayagrid.com").replace(
  /\/$/,
  "",
);
const AUTH_FILE = path.join(__dirname, "playwright/.auth/staging-user.json");

if (/nyayagrid\.com$/i.test(new URL(STAGING_URL).hostname) && !/staging/i.test(STAGING_URL)) {
  throw new Error("Refusing to run staging auth harness against non-staging nyayagrid.com host");
}

export default defineConfig({
  testDir: "./e2e/staging",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: STAGING_URL,
    trace: "off",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        headless: process.env.STAGING_AUTH_HEADLESS === "1",
      },
    },
    {
      name: "q9-acceptance",
      testMatch: /q9-recovery\.acceptance\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: AUTH_FILE,
      },
    },
  ],
});

export { AUTH_FILE, STAGING_URL };
