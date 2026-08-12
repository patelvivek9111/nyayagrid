import { defineConfig, devices } from "@playwright/test";

/**
 * Phase 9 — end-to-end tests against the real Next.js app.
 *
 * Runs against AUTH_PROVIDER=dev (the default dev identity, or the `x-nyayagrid-dev-user` request
 * header for a second identity), AI_PROVIDER=mock and EMBEDDING_PROVIDER=mock so the suite never
 * depends on a paid provider or makes a real model call. It does depend on Postgres + MinIO being
 * reachable (`npm run docker:up`) because the app itself requires a database connection to boot —
 * there is no in-memory mode for the web server.
 *
 * First run on a machine: `npx playwright install` (downloads the browser binaries; not needed
 * again unless Playwright itself is upgraded).
 *
 * Local development: if a `npm run dev` server is already running on port 3000, this reuses it
 * (`reuseExistingServer` is only disabled in CI). In CI, Playwright starts its own dev server with
 * the environment below and tears it down afterward.
 */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev -w @nyayagrid/web",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      APP_ENV: "development",
      AUTH_PROVIDER: "dev",
      DEV_AUTH_USER_ID: process.env.DEV_AUTH_USER_ID ?? "dev_user_owner",
      DEV_AUTH_EMAIL: process.env.DEV_AUTH_EMAIL ?? "owner@example.nyayagrid.local",
      DEV_AUTH_NAME: process.env.DEV_AUTH_NAME ?? "Dev Owner",
      AI_PROVIDER: "mock",
      EMBEDDING_PROVIDER: "mock",
      RESEARCH_PROVIDER: "local",
      MALWARE_SCANNER: "development",
      DATABASE_URL:
        process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid",
      STORAGE_PROVIDER: process.env.STORAGE_PROVIDER ?? "minio",
      S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://localhost:9000",
      S3_REGION: process.env.S3_REGION ?? "us-east-1",
      S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? "nyayagrid",
      S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? "nyayagridsecret",
      S3_BUCKET: process.env.S3_BUCKET ?? "nyayagrid-documents",
      S3_FORCE_PATH_STYLE: "true",
      INNGEST_EVENT_KEY: "local",
      INNGEST_SIGNING_KEY: "local",
      INNGEST_DEV: "1",
      NEXT_PUBLIC_APP_URL: BASE_URL,
    },
  },
});
