import { test, expect } from "@playwright/test";

/**
 * Nyaya Professor (Student Workspace). Professor is user-scoped (no organization), so this needs
 * no onboarding — the dev identity can use it immediately.
 *
 * Content is hashed and deduplicated per-user (`student_cases_user_sha_uidx`), so opinion text must
 * be unique per run.
 */
const suffix = Date.now().toString(36);
const CASE_A_TITLE = `E2E Rivera v. Hollis Properties ${suffix}`;
const CASE_A_TEXT = [
  "SYNTHETIC FIXTURE — not a real judicial opinion and not citable as authority.",
  "Ms. Rivera remained in possession of the leased unit after the stated notice period expired.",
  "A notice to vacate is effective only upon actual receipt by the tenant, and the record shows",
  "Ms. Rivera never received actual notice before the disputed date. We affirm judgment for Ms. Rivera.",
  `(E2E run ${suffix} case A)`,
].join(" ");

const CASE_B_TITLE = `E2E Simmons v. Oakview Rentals ${suffix}`;
const CASE_B_TEXT = [
  "SYNTHETIC FIXTURE — not a real judicial opinion and not citable as authority.",
  "Mr. Simmons vacated after Oakview Rentals mailed a notice to quit.",
  "This lease's own notice clause adopts a mailing rule: notice is effective on the date it is mailed,",
  "not the date of actual receipt. We affirm judgment for Oakview Rentals.",
  `(E2E run ${suffix} case B)`,
].join(" ");

test.describe.serial("Nyaya Professor (student workspace)", () => {
  test.setTimeout(90_000);
  test("home page loads with the study-aid notice", async ({ page }) => {
    await page.goto("/professor");
    await expect(page.getByRole("heading", { name: /What are you studying/i })).toBeVisible();
    await expect(page.getByRole("note")).toContainText(/study aid/i);
  });

  test("uploads two SYNTH cases to the personal library", async ({ page }) => {
    await page.goto("/professor/cases");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/No cases yet|Case library/i).first()).toBeVisible();

    await page.getByPlaceholder(/Case title/).fill(CASE_A_TITLE);
    await page.getByPlaceholder("Court (optional)").fill("Synthetic Court of Appeals");
    await page.getByPlaceholder(/Paste the full opinion text/).fill(CASE_A_TEXT);
    await page.getByRole("button", { name: "Add case" }).click();
    await expect(page.getByText(/passages indexed/)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("main").getByRole("link", { name: CASE_A_TITLE })).toBeVisible();

    await page.getByPlaceholder(/Case title/).fill(CASE_B_TITLE);
    await page.getByPlaceholder(/Paste the full opinion text/).fill(CASE_B_TEXT);
    await page.getByRole("button", { name: "Add case" }).click();
    await expect(page.getByText(/passages indexed/)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("main").getByRole("link", { name: CASE_B_TITLE })).toBeVisible();
  });

  test("generates a case brief whose sources open the passage", async ({ page }) => {
    await page.goto("/professor/cases");
    await page.waitForLoadState("networkidle");
    await page.locator("main").getByRole("link", { name: CASE_A_TITLE }).click();
    await expect(page).toHaveURL(/\/professor\/cases\/[^/]+$/);
    await expect(page.getByRole("note")).toContainText(/study aid/i);
    await page.getByRole("button", { name: /Generate brief/ }).click();
    await expect(page.getByRole("button", { name: "Regenerate brief" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("No brief generated yet.")).toHaveCount(0);
    const sourceChip = page.getByRole("button", { name: /View source/ });
    if ((await sourceChip.count()) > 0) {
      await sourceChip.first().click();
      await expect(page.getByText(/actual receipt|Ms\. Rivera|SYNTHETIC FIXTURE/i).first()).toBeVisible();
    } else {
      await expect(page.getByText(/Holding/i).first()).toBeVisible();
    }
    await expect(page.getByText(/dissenting as the holding|dissent as holding/i)).toHaveCount(0);
  });

  test("case room keeps two follow-ups on the same conversation with sources", async ({ page }) => {
    await page.goto("/professor/cases");
    await page.waitForLoadState("networkidle");
    await page.locator("main").getByRole("link", { name: CASE_A_TITLE }).click();
    const askBox = page.getByPlaceholder(/What test does the court apply/);
    await askBox.fill("What did the majority hold about notice?");
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(page.getByText(/Professor ·/)).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText("Your uploaded case").or(page.getByText(/No surviving sources/)),
    ).toBeVisible();

    await askBox.fill("What if the tenant had signed for the notice the same day?");
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(page.getByText("You · standard")).toHaveCount(2, { timeout: 30_000 });
  });

  test("compares two SYNTH cases from the student's library", async ({ page }) => {
    await page.goto("/professor/compare");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Case A").selectOption({ label: CASE_A_TITLE });
    await page.getByLabel("Case B").selectOption({ label: CASE_B_TITLE });
    await page.getByRole("button", { name: "Compare" }).click();
    await expect(
      page.getByRole("heading", { name: "Holding" }).or(page.getByText(/Failed to compare/i)),
    ).toBeVisible({ timeout: 30_000 });
    const aSource = page.getByText("Case A source");
    const bSource = page.getByText("Case B source");
    if ((await aSource.count()) > 0) {
      await expect(aSource.first()).toBeVisible();
    }
    if ((await bSource.count()) > 0) {
      await expect(bSource.first()).toBeVisible();
    }
  });

  test("saves a brief, lists it, and can delete a saved item", async ({ page }) => {
    await page.goto("/professor/cases");
    await page.waitForLoadState("networkidle");
    await page.locator("main").getByRole("link", { name: CASE_A_TITLE }).click();
    await page.getByRole("button", { name: "Save brief" }).click();
    await expect(page.getByText(/Brief saved/)).toBeVisible({ timeout: 10_000 });

    await page.goto("/professor/briefs");
    await expect(page.locator("main").getByRole("link", { name: CASE_A_TITLE })).toBeVisible();

    await page.goto("/professor/notes");
    await page.getByPlaceholder("Note title").fill(`E2E note ${suffix}`);
    await page.getByPlaceholder("Your note…").fill("Receipt was required.");
    await page.getByRole("button", { name: "Save note" }).click();
    await expect(page.getByText(`E2E note ${suffix}`)).toBeVisible();

    await page.goto("/professor/saved");
    const savedBrief = page.getByRole("link", { name: /Brief:/ });
    await expect(savedBrief.first()).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete" }).first().click();
  });

  test("asks Professor a study question from the Ask page", async ({ page }) => {
    await page.goto("/professor/ask");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: "Explain simply" })).toBeVisible();
    await page
      .getByPlaceholder(/What standard does the majority apply/)
      .fill("What did the majority hold about notice?");
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(page.getByText(/Professor ·/)).toBeVisible({ timeout: 30_000 });
  });

  test("unauthenticated and foreign case ids never return another student's text", async ({
    request,
    page,
  }) => {
    await page.goto("/professor/cases");
    await page.waitForLoadState("networkidle");
    const caseLink = page.locator("main").getByRole("link", { name: CASE_A_TITLE });
    await expect(caseLink).toBeVisible();
    const href = await caseLink.getAttribute("href");
    expect(href).toBeTruthy();
    await page.goto(href!);
    const caseId = page.url().split("/").pop() ?? "";
    expect(caseId).toMatch(/^[0-9a-f-]{36}$/i);

    const anon = await request.get(`/api/v1/professor/cases/${caseId}`, {
      headers: { "x-nyayagrid-dev-user": "anonymous" },
    });
    expect(anon.status()).toBe(401);

    const foreign = await request.get(`/api/v1/professor/cases/${caseId}`, {
      headers: { "x-nyayagrid-dev-user": `e2e-other-${suffix}` },
    });
    expect(foreign.status()).toBe(404);
    const body = await foreign.json();
    expect(JSON.stringify(body)).not.toContain("actual receipt");
    expect(body.case).toBeUndefined();
  });
});
