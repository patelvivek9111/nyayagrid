import { test, expect } from "@playwright/test";

/**
 * Nyaya Professor (Student Workspace) smoke test. Professor is user-scoped (no organization), so
 * this needs no onboarding step — the dev identity can use it immediately.
 */
const suffix = Date.now().toString(36);
const CASE_TITLE = `E2E Rivera v. Hollis Properties ${suffix}`;
// Content is hashed and deduplicated per-user in the database (`student_cases_user_sha_uidx`), so
// it must be unique per test run, not just per test file — otherwise a second run against the same
// dev-user data hits the unique constraint and the ingest endpoint returns 500.
const CASE_TEXT = [
  "Ms. Rivera remained in possession of the leased unit after the stated notice period expired.",
  "A notice to vacate is effective only upon actual receipt by the tenant, and the record shows",
  "Ms. Rivera never received actual notice before the disputed date. We affirm judgment for Ms. Rivera.",
  `(E2E run ${suffix})`,
].join(" ");

test.describe.serial("Nyaya Professor (student workspace)", () => {
  test("home page loads for the dev identity", async ({ page }) => {
    await page.goto("/professor");
    await expect(page.getByRole("heading", { name: /What are you studying/i })).toBeVisible();
  });

  test("uploads a case to the personal library", async ({ page }) => {
    await page.goto("/professor/cases");
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder(/Case title/).fill(CASE_TITLE);
    await page.getByPlaceholder("Court (optional)").fill("Synthetic Court of Appeals");
    await page.getByPlaceholder(/Paste the full opinion text/).fill(CASE_TEXT);
    await page.getByRole("button", { name: "Add case" }).click();
    await expect(page.getByText(/passages indexed/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: CASE_TITLE })).toBeVisible();
  });

  test("generates a case brief grounded in the uploaded text", async ({ page }) => {
    await page.goto("/professor/cases");
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: CASE_TITLE }).click();
    await expect(page).toHaveURL(/\/professor\/cases\/[^/]+$/);
    await page.getByRole("button", { name: /Generate brief/ }).click();
    await expect(page.getByRole("button", { name: "Regenerate brief" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("No brief generated yet.")).toHaveCount(0);
  });

  test("asks Professor a study question", async ({ page }) => {
    await page.goto("/professor/ask");
    await page.waitForLoadState("networkidle");
    await page
      .getByPlaceholder(/What standard does the majority apply/)
      .fill("What did the majority hold about notice?");
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(page.getByText("Professor", { exact: true })).toBeVisible({ timeout: 20_000 });
  });
});
