import { test, expect } from "@playwright/test";

/**
 * Professional workspace smoke test, run serially because later steps depend on state (the
 * organization/client/matter) created by earlier ones. Uses DEV auth (the default identity
 * configured by playwright.config.ts) — no sign-in flow exists in dev mode.
 */
const suffix = Date.now().toString(36);
const ORG_NAME = `E2E Firm ${suffix}`;
const ORG_SLUG = `e2e-firm-${suffix}`;
const CLIENT_NAME = `E2E Client ${suffix}`;
const MATTER_TITLE = `E2E Matter ${suffix}`;

let matterId = "";

test.describe.serial("Professional workspace (Nyaya)", () => {
  test("dev access reaches the professional home", async ({ page }) => {
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: "Professional home" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open matters" })).toBeVisible();
  });

  test("creates an organization via onboarding", async ({ page }) => {
    await page.goto("/app/onboarding");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Organization name").fill(ORG_NAME);
    await page.getByLabel("Slug").fill(ORG_SLUG);
    await page.getByRole("button", { name: "Create organization" }).click();
    await expect(page.getByText(new RegExp(`Created ${ORG_NAME}`))).toBeVisible({
      timeout: 15_000,
    });
  });

  test("creates a client under the new organization", async ({ page }) => {
    await page.goto("/app/clients");
    await page.waitForLoadState("networkidle");
    await page.locator("select").first().selectOption({ label: ORG_NAME });
    await page.getByPlaceholder("Display name").fill(CLIENT_NAME);
    await page.getByRole("button", { name: "Create client" }).click();
    await expect(page.getByText(`Created client ${CLIENT_NAME}`)).toBeVisible({
      timeout: 15_000,
    });
  });

  test("creates a matter for that client", async ({ page }) => {
    await page.goto("/app/matters");
    await page.waitForLoadState("networkidle");
    await page.locator("select").first().selectOption({ label: ORG_NAME });
    const clientSelect = page.locator("select").nth(1);
    await expect(clientSelect.locator("option", { hasText: CLIENT_NAME })).toHaveCount(1, {
      timeout: 15_000,
    });
    await clientSelect.selectOption({ label: CLIENT_NAME });
    await page.getByPlaceholder("Matter title").fill(MATTER_TITLE);
    await page.getByRole("button", { name: "Create matter" }).click();
    await expect(page.getByText(/Created matter/)).toBeVisible({ timeout: 15_000 });

    const matterLink = page.getByRole("link", { name: new RegExp(MATTER_TITLE) });
    await expect(matterLink).toBeVisible();
    await matterLink.click();
    await expect(page).toHaveURL(/\/app\/matters\/[^/]+$/);
    matterId = new URL(page.url()).pathname.split("/").pop() ?? "";
    expect(matterId).not.toBe("");
  });

  test("asks Nyaya a question about the matter", async ({ page }) => {
    await page.goto(`/app/matters/${matterId}/nyaya`);
    await expect(page.getByRole("heading", { name: "Ask Nyaya" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder(/Ask a factual question/).fill("When was this matter opened?");
    await page.getByRole("button", { name: "Ask Nyaya" }).last().click();
    // The mock provider always returns *some* answer (grounded or insufficient-evidence); either
    // way a conversation entry renders once the request resolves.
    await expect(page.locator("article").first()).toBeVisible({ timeout: 20_000 });
  });

  test("navigates the matter's Nyaya capability tabs", async ({ page }) => {
    // Each test gets a fresh page (not shared with the previous test), so navigate to the matter
    // explicitly rather than assuming the previous test's page state carries over.
    await page.goto(`/app/matters/${matterId}/nyaya`);
    await page.waitForLoadState("networkidle");
    for (const tab of ["timeline", "graph", "memory", "research", "draft"]) {
      await page.locator(`a[href="/app/matters/${matterId}/${tab}"]`).click();
      await expect(page).toHaveURL(new RegExp(`/app/matters/${matterId}/${tab}$`));
    }
  });

  test("visits Nyaya Research (global, organization-scoped)", async ({ page }) => {
    await page.goto("/app/research");
    await expect(page.getByRole("heading", { name: "Nyaya Research" })).toBeVisible();
    await expect(page.getByPlaceholder(/preliminary injunction/).first()).toBeVisible();
  });
});
