import { test, expect } from "@playwright/test";

/**
 * Nyaya Guide (Public Workspace) smoke test. Guide is user-scoped (no organization) and has no
 * sign-in step in dev mode, same as Professor.
 */
const suffix = Date.now().toString(36);
const DOC_TITLE = `E2E Lease ${suffix}`;
// Content is hashed and deduplicated per-user in the database, so it must be unique per test run
// (not just per test file) — otherwise a second run against the same dev-user data hits the
// `guide_documents_user_sha_uidx` unique constraint and the ingest endpoint returns 500.
const LEASE_TEXT =
  "This residential lease begins on January 1, 2026 and continues on a month-to-month basis " +
  "unless renewed in writing at least 30 days before the end date. Rent is due on the first day " +
  `of each month. (E2E run ${suffix})`;

test.describe.serial("Nyaya Guide (public workspace)", () => {
  test("ask page loads", async ({ page }) => {
    await page.goto("/guide");
    await expect(page.getByRole("heading", { name: "Ask a legal question" })).toBeVisible();
  });

  test("explains a pasted document using only dates written in the text", async ({ page }) => {
    await page.goto("/guide/explain");
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder("Document title").fill(DOC_TITLE);
    await page.getByPlaceholder(/Paste the document text/).fill(LEASE_TEXT);
    await page.getByRole("button", { name: "Add & explain" }).click();
    await expect(page.getByText("Dates found in the document")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/January 1, 2026/).first()).toBeVisible();
    // The "Your documents" list renders each row as a button (selects it for re-explanation), not
    // a link.
    await expect(page.getByRole("button", { name: DOC_TITLE })).toBeVisible();
  });

  test("asks Guide a jurisdiction-sensitive question", async ({ page }) => {
    await page.goto("/guide");
    await page.waitForLoadState("networkidle");
    await page
      .getByPlaceholder(/notice to vacate/)
      .fill("My landlord gave me a notice to vacate — how much notice is required?");
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(page.getByText("Guide", { exact: true })).toBeVisible({ timeout: 20_000 });
  });

  test("organizes a situation with a timeline event", async ({ page }) => {
    await page.goto("/guide/situation");
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder(/Lease dispute with landlord/).fill(`E2E Situation ${suffix}`);
    await page.getByRole("button", { name: "Create situation" }).click();
    await expect(page.getByLabel("Situation")).not.toHaveValue("", { timeout: 15_000 });

    await page.getByPlaceholder("What happened?").fill("Received notice to vacate");
    await page.getByRole("button", { name: "Add event" }).click();
    await expect(page.getByText("Received notice to vacate")).toBeVisible({ timeout: 15_000 });
  });
});
