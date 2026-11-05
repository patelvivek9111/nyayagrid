import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Staging Clerk authenticated E2E (WP-05).
 * Does NOT enable DevAuth. Does NOT use production host.
 *
 * Auth artifact: playwright/.auth/staging-user.json (gitignored).
 * Prefer interactive Clerk login (MFA preserved) once, then reuse storageState.
 * Optional automation: @clerk/testing + E2E_CLERK_USER_EMAIL when compatible
 * with MFA policy (see docs/operations/WP05_CLERK_E2E_OPERATOR_SETUP.md).
 */
const STAGING_URL = (process.env.STAGING_E2E_BASE_URL ?? "https://staging.nyayagrid.com").replace(
  /\/$/,
  "",
);
const AUTH_FILE = path.join(__dirname, "playwright/.auth/staging-user.json");
const hasAuthFile = fs.existsSync(AUTH_FILE);
const authStorage = hasAuthFile ? { storageState: AUTH_FILE } : {};

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
      name: "security-negatives",
      testMatch: /security\.clerk\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
      },
    },
    {
      name: "tenant-isolation",
      testMatch: /tenant-isolation\.clerk\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        ...authStorage,
      },
    },
    {
      name: "professional-clerk",
      testMatch: /professional\.clerk\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        ...authStorage,
      },
    },
    {
      name: "prosecution-clerk",
      testMatch: /prosecution\.clerk\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        ...authStorage,
      },
    },
    {
      name: "q9-acceptance",
      testMatch: /q9-recovery\.acceptance\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        ...authStorage,
      },
    },
  ],
});

export { AUTH_FILE, STAGING_URL };
