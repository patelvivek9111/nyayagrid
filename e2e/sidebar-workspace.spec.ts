import { test, expect } from "@playwright/test";

test.describe("Sidebar workspace context", () => {
  test("primary nav stays visible and there is no permanent Firm select", async ({ page }) => {
    await page.goto("/app");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("link", { name: "Ask Nyaya" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Clients" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Calendar" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Time" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Billing" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Inbox" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Research" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Holds & privacy" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
    await expect(page.getByText("Other workspaces")).toBeVisible();
    await expect(page.getByRole("link", { name: "Client view" })).toBeVisible();
    await expect(page.locator("aside select")).toHaveCount(0);
    await expect(page.getByLabel("Firm")).toHaveCount(0);
  });

  test("single-org users do not see a switcher; multi-org users can switch context", async ({
    page,
  }) => {
    await page.goto("/app");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Other workspaces")).toBeVisible({ timeout: 15_000 });

    const res = await page.request.get("/api/v1/organizations");
    expect(res.ok()).toBeTruthy();
    const orgs = ((await res.json()).organizations ?? []) as Array<{ id: string; name: string }>;
    const switcher = page.getByRole("button", { name: "Switch workspace" });

    if (orgs.length <= 1) {
      await expect(switcher).toHaveCount(0);
      return;
    }

    await expect(switcher).toBeVisible();
    const startId = await page.evaluate(() =>
      localStorage.getItem("nyayagrid.activeOrganizationId"),
    );

    await switcher.click();
    const dialog = page.getByRole("dialog", { name: "Switch workspace" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Current")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await switcher.click();
    await expect(dialog).toBeVisible();
    const otherBtn = dialog.locator("button[aria-pressed='false']").first();
    await otherBtn.scrollIntoViewIfNeeded();
    const mattersWait = page.waitForRequest(
      (req) =>
        req.method() === "GET" &&
        req.url().includes("/api/v1/matters?organizationId=") &&
        !req.url().includes(`organizationId=${startId}`),
    );
    await otherBtn.click();
    await expect(dialog).toBeHidden();
    const mattersReq = await mattersWait;
    const switchedId = new URL(mattersReq.url()).searchParams.get("organizationId");
    expect(switchedId).toBeTruthy();
    expect(switchedId).not.toBe(startId);
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem("nyayagrid.activeOrganizationId")))
      .toBe(switchedId);

    const casesRes = await page.request.get(`/api/v1/matters?organizationId=${switchedId}`);
    expect(casesRes.ok()).toBeTruthy();

    const first = orgs.find((org) => org.id === startId) ?? orgs[0]!;
    await switcher.click();
    const restore = dialog.getByRole("button", { name: first.name, exact: true });
    await restore.scrollIntoViewIfNeeded();
    await restore.click();
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem("nyayagrid.activeOrganizationId")))
      .toBe(first.id);
  });

  test("cases, clients, calendar, and billing stay organization-scoped", async ({ page }) => {
    const orgRes = await page.request.get("/api/v1/organizations");
    const orgs = ((await orgRes.json()).organizations ?? []) as Array<{ id: string }>;
    test.skip(orgs.length === 0, "no organization for this identity");
    const orgId = orgs[0]!.id;
    const matters = await page.request.get(`/api/v1/matters?organizationId=${orgId}`);
    expect(matters.ok()).toBeTruthy();
    const clients = await page.request.get(`/api/v1/clients?organizationId=${orgId}`);
    expect(clients.ok()).toBeTruthy();
    const calendar = await page.request.get(`/api/v1/calendar?organizationId=${orgId}`);
    expect(calendar.ok()).toBeTruthy();
    const invoices = await page.request.get(`/api/v1/invoices?organizationId=${orgId}`);
    expect(invoices.ok()).toBeTruthy();
  });
});
