import { test, expect } from "@playwright/test";
import path from "node:path";

/**
 * Professional workspace smoke test for the case-centered UX.
 * Uses DEV auth (configured by playwright.config.ts).
 */
const suffix = Date.now().toString(36);
const ORG_NAME = `E2E Firm ${suffix}`;
const ORG_SLUG = `e2e-firm-${suffix}`;
const CLIENT_NAME = `E2E Client ${suffix}`;
const CASE_TITLE = `E2E Case ${suffix}`;

let matterId = "";

test.describe.serial("Professional workspace (Nyaya)", () => {
  test("dev access reaches New Chat home", async ({ page }) => {
    await page.goto("/app");
    await expect(
      page.getByRole("heading", { name: /What can Nyaya help you with/i }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "New Chat" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Cases" }).first()).toBeVisible();
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

  test("creates a Case", async ({ page }) => {
    await page.goto("/app/cases/new");
    await page.waitForLoadState("networkidle");
    const orgSelect = page.locator("aside select").first();
    await expect(orgSelect).toBeVisible({ timeout: 15_000 });
    await orgSelect.selectOption({ label: ORG_NAME });
    const clientSelect = page.locator("main select").first();
    await expect(clientSelect.locator("option", { hasText: CLIENT_NAME })).toHaveCount(1, {
      timeout: 15_000,
    });
    await clientSelect.selectOption({ label: CLIENT_NAME });
    await page.getByLabel("Case name").fill(CASE_TITLE);
    await page.getByRole("button", { name: "Create Case" }).click();
    await expect(page).toHaveURL(/\/app\/cases\/(?!new$)[^/]+$/, { timeout: 15_000 });
    matterId = new URL(page.url()).pathname.split("/").pop() ?? "";
    expect(matterId).not.toBe("");
    expect(matterId).not.toBe("new");
    await expect(page.getByRole("link", { name: "Home", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Chats", exact: true })).toBeVisible();
  });

  test("starts a Case chat from Chats tab", async ({ page }) => {
    await page.goto(`/app/cases/${matterId}/chats`);
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder(/Start a new Case chat/).fill("When was this matter opened?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/cases/${matterId}/chats/[^/]+$`), {
      timeout: 20_000,
    });
    // Empty case → insufficient evidence honesty path
    await expect(page.getByText("Insufficient evidence", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByText(/couldn.?t find enough verified evidence in this Case/i),
    ).toBeVisible();
    await expect(page.getByText(/Need more documents/i)).toBeVisible();
  });

  test("uploads SYNTH lease and answers with grounded sources", async ({ page }) => {
    test.setTimeout(90_000);
    const fixturePath = path.join(
      process.cwd(),
      "packages/ai/src/evals/golden-fixtures/synth-master-lease-agreement.txt",
    );

    await page.goto(`/app/cases/${matterId}/documents`);
    await page.waitForLoadState("networkidle");
    await page.locator('input[type="file"]').setInputFiles(fixturePath);
    await expect(page.getByText(/Uploaded\. Processing state:\s*ready/i)).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.getByText("ready").first()).toBeVisible();

    await page.goto(`/app/cases/${matterId}/chats`);
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder(/Start a new Case chat/).fill("When does the lease term commence?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/cases/${matterId}/chats/[^/]+$`), {
      timeout: 30_000,
    });

    await expect(page.getByText("Grounded in Case sources", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Sources", { exact: true })).toBeVisible();
    await expect(page.getByText(/January 1,\s*2024/i).first()).toBeVisible();

    await page.getByRole("button", { name: /Open source 1/i }).click();
    await expect(page.getByRole("heading", { name: "Case sources" })).toBeVisible();
    await expect(page.getByText(/January 1,\s*2024/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Open original" }).first()).toBeVisible();
  });

  test("Documents exposes compare entry", async ({ page }) => {
    await page.goto(`/app/cases/${matterId}/documents`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Compare versions" })).toBeVisible();
    await expect(page.getByText(/Diffs are deterministic/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Open original" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Download" }).first()).toBeVisible();
  });

  test("Evidence exposes contradiction surface", async ({ page }) => {
    await page.goto(`/app/cases/${matterId}/evidence`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Conflicting evidence" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Detect contradictions/i })).toBeVisible();
  });

  test("approves a proposed person on People and shows Verified on Case Home", async ({ page }) => {
    test.setTimeout(90_000);
    const rosterPath = path.join(
      process.cwd(),
      "packages/ai/src/evals/golden-fixtures/synth-party-roster.txt",
    );
    await page.goto(`/app/cases/${matterId}/documents`);
    await page.waitForLoadState("networkidle");
    await page.locator('input[type="file"]').setInputFiles(rosterPath);
    await expect(page.getByText(/Uploaded\. Processing state:\s*ready/i)).toBeVisible({
      timeout: 45_000,
    });

    await page.goto(`/app/cases/${matterId}/people`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "People & Organizations" })).toBeVisible();

    const peopleList = page.getByRole("list", { name: "People and organizations" });
    const suggestedRow = peopleList
      .locator("li")
      .filter({ has: page.getByText("Suggested by Nyaya") })
      .first();
    if (!(await suggestedRow.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: "Analyze documents" }).first().click();
      await expect(page.getByRole("button", { name: "Analyze documents" }).first()).toBeEnabled({
        timeout: 30_000,
      });
    }
    await expect(suggestedRow).toBeVisible({ timeout: 30_000 });

    const approvedName = (await suggestedRow.locator("p.font-semibold").textContent())?.trim();
    expect(approvedName).toBeTruthy();
    await suggestedRow.click();
    await page.getByRole("button", { name: "Approve", exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`/app/cases/${matterId}/people`));
    await expect(page.getByRole("link", { name: /Review suggestions/i })).toHaveCount(0);
    await expect(
      peopleList.locator("li").filter({ hasText: approvedName! }).getByText("Verified").first(),
    ).toBeVisible({ timeout: 15_000 });

    await page.goto(`/app/cases/${matterId}`);
    await page.waitForLoadState("networkidle");
    const peoplePanel = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "People & Organizations" }) });
    await expect(peoplePanel.getByText(approvedName!, { exact: false })).toBeVisible();
    await expect(peoplePanel.getByText("Verified").first()).toBeVisible();
  });

  test("creates a task with priority and moves it in progress", async ({ page }) => {
    await page.goto(`/app/cases/${matterId}/tasks`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Tasks & Deadlines" })).toBeVisible();
    await page.getByLabel("Task title").fill("Review notice provision");
    await page.getByLabel("Task description").fill("Check Section 12 against the lease.");
    await page.getByLabel("New task priority").selectOption("high");
    await page.getByRole("button", { name: "Create task" }).click();
    const taskList = page.getByRole("list", { name: "Case tasks" });
    await expect(taskList.getByText("Review notice provision")).toBeVisible();
    await expect(taskList.getByText("high")).toBeVisible();
    await taskList.getByText("Review notice provision").click();
    await page.getByRole("button", { name: "Start" }).click();
    await expect(taskList.getByText("in_progress")).toBeVisible({ timeout: 15_000 });
  });

  test("deadlines show timezone and dateKind honesty", async ({ page }) => {
    await page.goto(`/app/cases/${matterId}/tasks`);
    await page.waitForLoadState("networkidle");
    const suggested = page.getByRole("list", { name: "Suggested deadlines" });
    if (await suggested.isVisible().catch(() => false)) {
      await suggested.locator("li").first().click();
      await expect(page.getByText(/timezone unknown|America\/|UTC/i).first()).toBeVisible();
      await expect(page.getByText(/explicit|inferred/i).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Inspect sources" })).toBeVisible();
    } else {
      await expect(page.getByText(/No deadline suggestions pending review/i)).toBeVisible();
    }
    await expect(page.getByText(/timezone and whether the date was explicit/i)).toBeVisible();
  });

  test("Work hub lists destinations and deep-links an awaiting_approval run", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`/app/cases/${matterId}/work`);
    await page.waitForLoadState("networkidle");
    const dest = page.getByRole("navigation", { name: "Work destinations" });
    for (const label of ["Nyaya", "Draft", "Research", "Analysis", "Review"]) {
      await expect(dest.getByRole("button", { name: label })).toBeVisible();
    }

    const res = await page.request.post(`/api/v1/matters/${matterId}/agents`, {
      data: {
        goal: "Research the termination notice standard under Synthetic Commercial Code and then draft a memo summarizing our matter's notice provision, and propose a follow-up task for attorney review.",
        execute: true,
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = (await res.json()) as {
      mode?: string;
      run?: { run?: { id?: string; status?: string } };
    };
    expect(body.mode).toBe("task");
    expect(body.run?.run?.status).toBe("awaiting_approval");

    await page.goto(`/app/cases/${matterId}/work`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("awaiting approval").first()).toBeVisible({ timeout: 20_000 });
    await page.locator('a[href*="nyaya?runId="]').first().click();
    await expect(page).toHaveURL(new RegExp(`/app/cases/${matterId}/nyaya\\?runId=`));
    await expect(page.getByRole("button", { name: "Approve", exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "Approve", exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Resume run" })).toBeVisible({ timeout: 20_000 });
  });

  test("Memory propose stays Suggested then edit-and-approve", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(`/app/cases/${matterId}/memory`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Nyaya Memory" })).toBeVisible();
    await page.getByLabel("Memory proposal hint").fill("Jordan Lee is a party to this matter");
    const proposeWait = page.waitForResponse(
      (res) => res.url().includes("/memory") && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Propose", exact: true }).click();
    const proposeRes = await proposeWait;
    const proposeBody = (await proposeRes.json()) as { proposals?: Array<{ id?: string }> };
    expect(proposeRes.ok(), JSON.stringify(proposeBody)).toBeTruthy();
    expect(proposeBody.proposals?.length ?? 0).toBeGreaterThan(0);
    await expect(page.getByText(/\d+ suggested/)).toBeVisible({ timeout: 20_000 });
    const proposed = page.getByRole("list", { name: "Proposed memories" });
    const jordan = proposed.locator("li").filter({ hasText: "Jordan Lee" }).first();
    await expect(jordan.getByText("Suggested by Nyaya")).toBeVisible();
    await expect(jordan.getByText("Verified")).toHaveCount(0);
    await jordan.click();
    await page.getByRole("button", { name: "Edit & approve" }).click();
    await expect(page.getByRole("button", { name: /Jordan Lee.*Verified/ })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("Graph proposed edges are Suggested not Verified", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(`/app/cases/${matterId}/graph`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Nyaya Graph" })).toBeVisible();
    await page.getByRole("button", { name: "Materialize from verified intelligence" }).click();
    await expect(
      page.getByRole("button", { name: "Materialize from verified intelligence" }),
    ).toBeEnabled({
      timeout: 20_000,
    });
    const firstNode = page.locator("button.text-left.font-semibold").first();
    if (await firstNode.isVisible().catch(() => false)) {
      await firstNode.click();
      await expect(page.getByText("Invalid request")).toHaveCount(0);
    }
    await page.getByRole("button", { name: "Propose AI relationships" }).click();
    await expect(page.getByRole("button", { name: "Propose AI relationships" })).toBeEnabled({
      timeout: 20_000,
    });
    const proposed = page.getByRole("list", { name: "Proposed graph edges" });
    if (await proposed.isVisible().catch(() => false)) {
      await expect(proposed.getByText("Suggested by Nyaya").first()).toBeVisible();
      await expect(proposed.getByText("Verified")).toHaveCount(0);
      await proposed.locator("li").first().click();
      const inspect = page.getByRole("button", { name: /Inspect sources/i });
      const noSources = page.getByText(/cannot be approved without source provenance/i);
      await expect(inspect.or(noSources).first()).toBeVisible();
      if (await inspect.isVisible()) {
        await page.getByRole("button", { name: "Approve", exact: true }).click();
      }
    } else {
      await expect(page.getByText(/No proposed edges/i)).toBeVisible();
    }
  });

  test("Draft generate shows sources or insufficient then saves a version", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(`/app/cases/${matterId}/draft`);
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Draft title").fill("Notice memo");
    const generateWait = page.waitForResponse(
      (res) => res.url().includes("/drafts") && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Generate with Nyaya" }).click();
    const generateRes = await generateWait;
    expect(generateRes.ok(), `draft generate ${generateRes.status()}`).toBeTruthy();
    await expect(page.getByText("Attorney review required")).toBeVisible({ timeout: 30_000 });
    const sources = page.getByRole("list", { name: "Draft source assertions" });
    const insufficient = page.getByText(/Insufficient source material/i);
    await expect(sources.or(insufficient).first()).toBeVisible();
    await page.getByRole("button", { name: "Save new version" }).click();
    await expect(
      page.getByRole("list", { name: "Draft version history" }).getByText("v2"),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: /send|file/i })).toHaveCount(0);
  });

  test("Timeline keeps suggestions separate from contradictions", async ({ page }) => {
    await page.goto(`/app/cases/${matterId}/timeline`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/Suggested events stay/i)).toBeVisible();
    await expect(page.getByText(/does not collapse them into one timeline/i)).toBeVisible();
    await expect(
      page
        .getByRole("paragraph")
        .filter({ hasText: /Conflicting document/i })
        .getByRole("link", {
          name: "Evidence",
          exact: true,
        }),
    ).toBeVisible();
  });

  test("navigates Case tabs", async ({ page }) => {
    await page.goto(`/app/cases/${matterId}`);
    await page.waitForLoadState("networkidle");
    const tabNav = page.getByRole("navigation", { name: "Case sections" });
    const tabs: Array<[string, string]> = [
      ["Documents", "documents"],
      ["Timeline", "timeline"],
      ["Evidence", "evidence"],
      ["People", "people"],
      ["Graph", "graph"],
      ["Memory", "memory"],
      ["Work", "work"],
    ];
    for (const [tab, segment] of tabs) {
      await tabNav.getByRole("link", { name: tab, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/app/cases/${matterId}/${segment}$`));
    }
    await tabNav.getByRole("link", { name: "Home", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/app/cases/${matterId}$`));
    const workNav = page.getByRole("navigation", { name: "Case work surfaces" });
    for (const tab of ["Draft", "Research", "Analysis", "Review"]) {
      await expect(workNav.getByRole("link", { name: tab, exact: true })).toBeVisible();
    }
    await workNav.getByRole("link", { name: "Draft", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/app/cases/${matterId}/draft$`));
  });

  test("legacy /app/matters redirects to /app/cases", async ({ page }) => {
    await page.goto(`/app/matters/${matterId}`);
    await expect(page).toHaveURL(new RegExp(`/app/cases/${matterId}$`));
    await page.goto(`/app/matters/${matterId}/people`);
    await expect(page).toHaveURL(new RegExp(`/app/cases/${matterId}/people`));
    await page.goto("/app/matters");
    await expect(page).toHaveURL(/\/app\/cases$/);
  });

  test("day in the life: Home and Work reflect upload, people, tasks, and draft", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.goto(`/app/cases/${matterId}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Key facts", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Open questions", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "AI insights", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Notes", exact: true })).toBeVisible();
    await expect(
      page.getByText(/There is no separate Notes tab yet/i),
    ).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Case work surfaces" })).toBeVisible();

    const docs = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Documents" }) });
    await expect(docs.getByText(/synth-master-lease-agreement/i)).toBeVisible();

    const people = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "People & Organizations" }) });
    await expect(people.getByText("Verified").first()).toBeVisible();

    const tasks = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Open Tasks" }) });
    await expect(tasks.getByText("Review notice provision")).toBeVisible();

    await page.goto(`/app/cases/${matterId}/work`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Review notice provision")).toBeVisible();
    await expect(page.getByText("Notice memo")).toBeVisible();
    const dest = page.getByRole("navigation", { name: "Work destinations" });
    await expect(dest.getByRole("button", { name: "Draft" })).toBeVisible();
  });

  test("visits Nyaya Research (global)", async ({ page }) => {
    await page.goto("/app/research");
    await expect(page.getByRole("heading", { name: "Nyaya Research" })).toBeVisible();
  });
});
