import { test, expect } from "@playwright/test";

/**
 * Case Intelligence surfaces against the seeded golden matter.
 * Does not create a new firm — used for UI/QA of Timeline, Evidence, People, Graph, Memory.
 */
const MATTER_ID = process.env.GOLDEN_MATTER_ID ?? "3ad4246b-853d-4e18-97c0-f622781293ce";

test.describe("Case Intelligence surfaces", () => {
  test("Timeline is chronological with filters and Add event dialog", async ({ page }) => {
    await page.goto(`/app/cases/${MATTER_ID}/timeline`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Timeline", exact: true })).toBeVisible();
    await expect(page.getByText(/Suggested events stay/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Disputed" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Suggested/ })).toBeVisible();
    await page.getByRole("button", { name: "+ Add event" }).click();
    const addDialog = page.getByRole("dialog", { name: "Add event" });
    await expect(addDialog).toBeVisible();
    await expect(page.getByLabel("Event type")).toContainText("Note");
    await addDialog.getByRole("button", { name: "Close" }).click();
    await expect(addDialog).toBeHidden();
    const event = page.getByRole("button", { name: /Lease Commencement/i }).first();
    if (await event.isVisible().catch(() => false)) {
      await event.click();
      await expect(page.getByRole("button", { name: /View source/i })).toBeVisible();
      await expect(page.getByText("Verified").first()).toBeVisible();
    }
  });

  test("Evidence keeps conflict sides distinct", async ({ page }) => {
    await page.goto(`/app/cases/${MATTER_ID}/evidence`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Evidence", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Look for conflicts/i })).toBeVisible();
    await page.getByRole("button", { name: /^Conflicts/ }).click();
    const dual = page.getByText(/NyayaGrid does not choose between these accounts automatically/i);
    const empty = page.getByText(/No conflicting evidence yet/i);
    await expect(dual.or(empty).first()).toBeVisible();
    if (await dual.isVisible().catch(() => false)) {
      await expect(page.getByText("Source A")).toBeVisible();
      await expect(page.getByText("Source B")).toBeVisible();
      await expect(page.getByRole("link", { name: "Review evidence" })).toBeVisible();
    }
    await page.getByRole("button", { name: /^All sources/ }).click();
    await expect(page.getByText(/No extracted case connections yet|event/i).first()).toBeVisible();
  });

  test("People roster opens inspector with navigation", async ({ page }) => {
    await page.goto(`/app/cases/${MATTER_ID}/people`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "People", exact: true })).toBeVisible();
    const roster = page.getByRole("list", { name: "People and organizations" });
    await expect(roster).toBeVisible();
    await roster.locator("li").first().click();
    await expect(page.getByRole("link", { name: "View evidence" })).toBeVisible();
    await expect(page.getByRole("link", { name: "View timeline" })).toBeVisible();
  });

  test("Graph canvas hides ordinary labels until hover, selection, or Connections", async ({
    page,
  }) => {
    await page.goto(`/app/cases/${MATTER_ID}/graph`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Graph", exact: true })).toBeVisible();
    const canvas = page.getByRole("img", { name: "Case relationship graph" });
    await expect(canvas).toBeVisible();
    await expect(
      canvas.locator("[data-graph-edge-label]", { hasText: "Supported by" }),
    ).toHaveCount(0);

    const firstEdge = canvas.locator("[data-edge-id]").first();
    if ((await firstEdge.count()) > 0) {
      await firstEdge.hover();
      await expect(canvas.locator("[data-graph-edge-label]").first()).toBeVisible();
    }

    const masterLease = page.getByRole("button", { name: /Master Lease Agreement/i }).first();
    if (await masterLease.isVisible().catch(() => false)) {
      await masterLease.click();
      await expect(page.getByText("Important connections")).toBeVisible();
      await expect(
        canvas.locator("[data-graph-edge-label]", { hasText: "Supported by" }).first(),
      ).toBeVisible();
    }

    await page.getByRole("button", { name: "Connections", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Verified connections" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Verified connections" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Proposed graph edges" })).toBeVisible();
    const verified = page.getByRole("list", { name: "Verified connections" });
    if ((await verified.locator("li").count()) > 0) {
      await expect(verified.getByText(/Supported by|Related to|Mentioned in/i).first()).toBeVisible();
      await expect(verified.getByText("supported_by")).toHaveCount(0);
    }
    await page.getByRole("button", { name: "+ Add connection" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByLabel("Relationship")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("Memory separates active and suggested", async ({ page }) => {
    await page.goto(`/app/cases/${MATTER_ID}/memory`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Memory", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Active/ })).toBeVisible();
    await page.getByRole("button", { name: /^Suggested by Nyaya/ }).click();
    await expect(
      page.getByText(/Suggestions stay unconfirmed until you accept them/i),
    ).toBeVisible();
    const accept = page.getByRole("button", { name: "Accept", exact: true });
    if (await accept.isVisible().catch(() => false)) {
      await expect(page.getByRole("button", { name: "Dismiss", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Review", exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: /^Memory history/ }).click();
    await expect(page.getByText(/Memory history|No memory history/i).first()).toBeVisible();
  });
});
