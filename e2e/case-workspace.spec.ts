import { test, expect } from "@playwright/test";

const MATTER_ID = process.env.GOLDEN_MATTER_ID ?? "3ad4246b-853d-4e18-97c0-f622781293ce";

test.describe("Case workspace surfaces", () => {
  test("Home is a matter command center", async ({ page }) => {
    await page.goto(`/app/cases/${MATTER_ID}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Key facts" })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Add note" })).toBeVisible();
    await page.getByRole("button", { name: "+ Add note" }).click();
    await expect(page.getByRole("dialog", { name: "Add note" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Add note" })).toBeHidden();
  });

  test("Chats is a case conversation workspace", async ({ page }) => {
    await page.goto(`/app/cases/${MATTER_ID}/chats`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Case Chats" })).toBeVisible();
    await expect(page.getByPlaceholder(/Ask Nyaya about this Case/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  });

  test("Documents is a dense file room", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/app/cases/${MATTER_ID}/documents`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Documents", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Compare versions" })).toBeVisible();
    await expect(page.getByPlaceholder("Search by document name")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open original" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Download" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Compare documents" }).first().click();
    await expect(page.getByRole("dialog", { name: "Compare versions" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("Review is a unified decision inbox", async ({ page }) => {
    await page.goto(`/app/cases/${MATTER_ID}/review`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Review", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^All/ })).toBeVisible();
    const empty = page.getByText("No items waiting for review");
    const queueItem = page.locator("ul button").first();
    if (await empty.isVisible().catch(() => false)) {
      await expect(empty).toBeVisible();
    } else {
      await expect(queueItem).toBeVisible();
      await queueItem.click();
      await expect(page.getByRole("button", { name: "Close" }).first()).toBeVisible();
    }
  });

  test("tablet layout does not overflow Home or Documents", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(`/app/cases/${MATTER_ID}`);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    );
    expect(overflow).toBe(false);
    await page.goto(`/app/cases/${MATTER_ID}/documents`);
    await page.waitForLoadState("networkidle");
    const docsOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    );
    expect(docsOverflow).toBe(false);
  });
});
