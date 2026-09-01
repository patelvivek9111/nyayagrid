import { test, expect } from "@playwright/test";

test.describe("Firm workspace surfaces", () => {
  test("clients is a directory with a create dialog", async ({ page }) => {
    await page.goto("/app/clients");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
    await expect(page.getByRole("button", { name: /New client/ }).first()).toBeVisible();
    await expect(page.locator("main form")).toHaveCount(0);
    await page
      .getByRole("button", { name: /New client/ })
      .first()
      .click();
    await expect(page.getByRole("dialog", { name: "New client" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "New client" })).toBeHidden();
  });

  test("calendar, time, billing, inbox, research, settings, and holds load as operations pages", async ({
    page,
  }) => {
    await page.goto("/app/calendar");
    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
    await expect(page.getByText(/not Outlook or Google Calendar sync/i)).toBeVisible();

    await page.goto("/app/time");
    await expect(page.getByRole("heading", { name: "Time" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Add time entry/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Suggest from chat/ })).toBeVisible();

    await page.goto("/app/billing");
    await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
    await expect(page.getByText(/not trust accounting/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Create draft invoice" })).toBeVisible();

    await page.goto("/app/inbox");
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Capture email/ }).first()).toBeVisible();
    await expect(page.getByText(/does not send mail/i)).toBeVisible();
    await page
      .getByRole("button", { name: /Capture email/ })
      .first()
      .click();
    await expect(page.getByRole("dialog", { name: "Capture email" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.goto("/app/research");
    await expect(page.getByRole("heading", { name: "Nyaya Research" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Research" })).toBeVisible();
    await expect(page.getByText(/not a comprehensive survey of the law/i)).toBeVisible();

    await page.goto("/app/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Invite member/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Members & access" })).toBeVisible();
    await page.getByRole("button", { name: /Invite member/ }).click();
    await expect(page.getByRole("dialog", { name: "Invite member" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.goto("/app/compliance");
    await expect(page.getByRole("heading", { name: "Holds & privacy" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Place legal hold/ })).toBeVisible();
    await expect(page.getByText(/does not enable training/i)).toBeVisible();
    await page.getByRole("button", { name: /Place legal hold/ }).click();
    await expect(page.getByRole("dialog", { name: "Place legal hold" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("practice pages stay organization-scoped", async ({ page }) => {
    const orgRes = await page.request.get("/api/v1/organizations");
    const orgs = ((await orgRes.json()).organizations ?? []) as Array<{ id: string }>;
    test.skip(orgs.length === 0, "no organization for this identity");
    const orgId = orgs[0]!.id;
    const paths = [
      `/api/v1/clients?organizationId=${orgId}`,
      `/api/v1/calendar?organizationId=${orgId}`,
      `/api/v1/time-entries?organizationId=${orgId}`,
      `/api/v1/invoices?organizationId=${orgId}`,
      `/api/v1/inbox?organizationId=${orgId}`,
      `/api/v1/research/sessions?organizationId=${orgId}`,
      `/api/v1/organizations/${orgId}/members`,
      `/api/v1/organizations/${orgId}/compliance`,
    ];
    for (const path of paths) {
      const res = await page.request.get(path);
      expect(res.ok(), path).toBeTruthy();
    }
  });
});
