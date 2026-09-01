import { expect, type Page } from "@playwright/test";

/** Secondary workspace switcher — only rendered when the user can access more than one org. */
export async function selectWorkspace(page: Page, organizationName: string) {
  const switcher = page.getByRole("button", { name: "Switch workspace" });
  await expect(page.getByText("Other workspaces")).toBeVisible({ timeout: 15_000 });
  if ((await switcher.count()) === 0) {
    return;
  }
  await switcher.click();
  const dialog = page.getByRole("dialog", { name: "Switch workspace" });
  await expect(dialog).toBeVisible();
  const option = dialog.getByRole("button", { name: organizationName, exact: true });
  await option.scrollIntoViewIfNeeded();
  await option.click();
  await expect(dialog).toBeHidden();
}
