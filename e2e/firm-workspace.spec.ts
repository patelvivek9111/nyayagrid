import { test, expect } from "@playwright/test";
import { selectWorkspace } from "./select-workspace";

test.describe("Firm workspace surfaces", () => {
  const suffix = Date.now().toString(36);
  const ORG_NAME = `E2E Firm Ops ${suffix}`;
  const ORG_SLUG = `e2e-firm-ops-${suffix}`;
  let organizationId = "";

  test.beforeAll(async ({ request }) => {
    const created = await request.post("/api/v1/organizations", {
      data: { name: ORG_NAME, slug: ORG_SLUG, type: "firm" },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    organizationId = (await created.json()).organization.id as string;
  });

  test("clients is a directory with a create dialog", async ({ page }) => {
    await page.goto("/app/clients");
    await page.waitForLoadState("networkidle");
    await selectWorkspace(page, ORG_NAME, organizationId);
    await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
    const newClient = page
      .getByRole("heading", { name: "Clients", exact: true })
      .locator("xpath=ancestor::div[contains(@class,'justify-between')][1]")
      .getByRole("button", { name: "+ New client" });
    await expect(newClient).toBeVisible();
    await expect(page.locator("main form")).toHaveCount(0);
    await newClient.click();
    await expect(page.getByRole("dialog", { name: "New client" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "New client" })).toBeHidden();
  });

  test("calendar, time, billing, inbox, research, settings, and holds load as operations pages", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    async function openPinned(path: string) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await selectWorkspace(page, ORG_NAME, organizationId);
    }

    await openPinned("/app/calendar");
    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/not Outlook or Google Calendar sync/i)).toBeVisible();

    await openPinned("/app/time");
    await expect(page.getByRole("heading", { name: "Time" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Add time entry/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Suggest from chat/ })).toBeVisible();

    await openPinned("/app/billing");
    await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
    await expect(page.getByText(/not trust accounting/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Create draft invoice" })).toBeVisible();

    await openPinned("/app/inbox");
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Capture email/ }).first()).toBeVisible();
    await expect(page.getByText(/does not send mail/i)).toBeVisible();
    await page
      .getByRole("button", { name: /Capture email/ })
      .first()
      .click();
    await expect(page.getByRole("dialog", { name: "Capture email" })).toBeVisible();
    await page.keyboard.press("Escape");

    await openPinned("/app/research");
    await expect(page.getByRole("heading", { name: "Nyaya Research" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Research", exact: true })).toBeVisible();
    await expect(page.getByText(/not a Westlaw or Lexis equivalent/i)).toBeVisible();

    await openPinned("/app/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await page.getByRole("button", { name: "Firm", exact: true }).click();
    await expect(page.getByRole("button", { name: "Members & access" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Invite member/ })).toBeVisible();
    await page.getByRole("button", { name: /Invite member/ }).click();
    await expect(page.getByRole("dialog", { name: "Invite member" })).toBeVisible();
    await page.keyboard.press("Escape");

    await openPinned("/app/compliance");
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
