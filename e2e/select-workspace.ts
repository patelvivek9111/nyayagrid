import { expect, type Page } from "@playwright/test";

/** Secondary workspace switcher — only rendered when the user can access more than one org. */
export async function selectWorkspace(page: Page, organizationName: string) {
  const other = page.getByText("Other workspaces");
  const switcher = page.getByRole("button", { name: "Switch workspace" });

  // Narrow layouts / single-org sessions may omit the secondary switcher entirely.
  const hasOther = await other.isVisible({ timeout: 8_000 }).catch(() => false);
  if (!hasOther || (await switcher.count()) === 0) {
    return;
  }

  // Already on the requested workspace — do not open the dialog.
  const currentLabel = ((await switcher.first().innerText().catch(() => "")) ?? "").trim();
  if (currentLabel.includes(organizationName)) {
    return;
  }

  await switcher.click();
  const dialog = page.getByRole("dialog", { name: "Switch workspace" });
  await expect(dialog).toBeVisible();
  const option = dialog
    .getByRole("button", { name: organizationName, exact: true })
    .or(
      dialog.getByRole("button", {
        name: new RegExp(organizationName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      }),
    );
  await expect(option.first()).toBeVisible({ timeout: 15_000 });
  await option.first().scrollIntoViewIfNeeded().catch(() => undefined);
  await option.first().click();
  await expect(dialog).toBeHidden();
}
