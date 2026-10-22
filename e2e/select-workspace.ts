import { expect, type Page } from "@playwright/test";

/** Matches apps/web ACTIVE_ORG_STORAGE_KEY — drives ActiveOrganizationProvider selection. */
const ACTIVE_ORG_STORAGE_KEY = "nyayagrid.activeOrganizationId";

export type SelectWorkspaceOptions = {
  organizationId: string;
  organizationName?: string;
  matterId?: string;
};

/**
 * Prefer an explicit organization id when known (API create path). Falls back to switching by name.
 * Always persists the active org id so later API/UI calls stay on the intended tenant.
 *
 * ActiveOrganizationProvider only reads localStorage on mount, so a storage write alone does not
 * update React state. When the workspace switcher is unavailable (or already shows the target),
 * reload so the provider re-reads the pinned id — but only when the pinned id actually changed.
 */
export async function selectWorkspace(
  page: Page,
  organizationNameOrOptions: string | SelectWorkspaceOptions,
  organizationId?: string,
) {
  const options: SelectWorkspaceOptions =
    typeof organizationNameOrOptions === "string"
      ? { organizationName: organizationNameOrOptions, organizationId: organizationId ?? "" }
      : organizationNameOrOptions;

  // localStorage throws SecurityError on about:blank / opaque origins. Several specs
  // call selectWorkspace before the first goto; land on the app origin first.
  if (!/^https?:\/\//i.test(page.url())) {
    await page.goto("/app");
    await page.waitForLoadState("domcontentloaded");
  }

  let storageChanged = false;
  if (options.organizationId) {
    const previous = await page.evaluate(
      (key) => localStorage.getItem(key),
      ACTIVE_ORG_STORAGE_KEY,
    );
    storageChanged = previous !== options.organizationId;
    await page.evaluate(
      ({ key, id }) => {
        localStorage.setItem(key, id);
      },
      { key: ACTIVE_ORG_STORAGE_KEY, id: options.organizationId },
    );
  }

  const organizationName = options.organizationName?.trim() ?? "";
  const other = page.getByText("Other workspaces");
  const switcher = page.getByRole("button", { name: "Switch workspace" });

  const hasOther = await other.isVisible({ timeout: 2_000 }).catch(() => false);
  let switchedViaUi = false;

  if (hasOther && (await switcher.count()) > 0 && organizationName) {
    const currentLabel = (
      (await switcher
        .first()
        .innerText()
        .catch(() => "")) ?? ""
    ).trim();
    if (!currentLabel.includes(organizationName)) {
      await switcher.click();
      const dialog = page.getByRole("dialog", { name: "Switch workspace" });
      await expect(dialog).toBeVisible();
      const option = dialog.getByRole("button", { name: organizationName, exact: true }).or(
        dialog.getByRole("button", {
          name: new RegExp(organizationName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        }),
      );
      await expect(option.first()).toBeVisible({ timeout: 15_000 });
      await option
        .first()
        .scrollIntoViewIfNeeded()
        .catch(() => undefined);
      await option.first().click();
      await expect(dialog).toBeHidden();
      switchedViaUi = true;
    }
  }

  if (options.organizationId && storageChanged && !switchedViaUi) {
    await page.reload();
    await page.waitForLoadState("networkidle");
  }
}
