import { expect, test } from "@playwright/test";
import { selectWorkspace } from "./select-workspace";

const suffix = Date.now().toString(36);
const ORG_NAME = `E2E Prosecution ${suffix}`;
const ORG_SLUG = `e2e-pros-${suffix}`;
const CASE_NUMBER = `SYN-E2E-${suffix}`;

test.describe.serial("signed-in prosecution workspace", () => {
  test.setTimeout(90_000);

  test("dev identity opens a criminal case and walks the prosecution sections", async ({ page }) => {
    const created = await page.request.post("/api/v1/organizations", {
      data: { name: ORG_NAME, slug: ORG_SLUG, type: "firm" },
    });
    expect(created.ok(), await created.text()).toBeTruthy();

    await page.goto("/app/prosecution");
    await page.waitForLoadState("networkidle");
    await selectWorkspace(page, ORG_NAME);
    await expect(page.getByRole("link", { name: "Prosecution" })).toBeVisible();

    await page.getByLabel("Case number").fill(CASE_NUMBER);
    await page.getByLabel("Jurisdiction").fill("PA");
    await page.getByLabel("Court id").fill("st-pa-trial");
    await page.getByRole("button", { name: "Open criminal case" }).click();
    await expect(page).toHaveURL(/\/app\/prosecution\/[0-9a-f-]{36}$/i, { timeout: 15_000 });

    const sections = page.getByRole("navigation", { name: "Prosecution sections" });
    for (const label of ["Overview", "Charges", "Evidence", "Witnesses", "Discovery", "Timeline", "Research", "Motions", "Hearings", "Tasks"]) {
      const link = sections.getByRole("link", { name: label, exact: true });
      await link.click();
      await expect(link).toHaveAttribute("aria-current", "page");
    }

    await page.goto("/app/prosecution");
    await expect(page.getByRole("link", { name: CASE_NUMBER })).toBeVisible();
  });
});
