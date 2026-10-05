import { expect, test } from "@playwright/test";
import { selectWorkspace } from "./select-workspace";

const suffix = Date.now().toString(36);
const ORG_NAME = `E2E Prosecution ${suffix}`;
const ORG_SLUG = `e2e-pros-${suffix}`;
const CASE_NUMBER = `SYN-E2E-${suffix}`;
const provenance = { extractionOrigin: "human", humanEntered: true };

test.describe.serial("signed-in prosecution workspace", () => {
  test.setTimeout(120_000);

  test("dev identity opens a criminal case and walks the prosecution sections", async ({ page }) => {
    const created = await page.request.post("/api/v1/organizations", {
      data: { name: ORG_NAME, slug: ORG_SLUG, type: "firm" },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const orgBody = (await created.json()) as { organization?: { id?: string }; id?: string };
    const organizationId = orgBody.organization?.id ?? orgBody.id;
    expect(organizationId).toBeTruthy();

    await page.goto("/app/prosecution");
    await page.waitForLoadState("networkidle");
    await selectWorkspace(page, ORG_NAME);
    await expect(page.getByRole("link", { name: "Prosecution" })).toBeVisible();

    await page.getByLabel("Case number").fill(CASE_NUMBER);
    await page.getByLabel("Jurisdiction").fill("PA");
    await page.getByLabel("Court id").fill("st-pa-trial");
    await page.getByRole("button", { name: "Open criminal case" }).click();
    await expect(page).toHaveURL(/\/app\/prosecution\/[0-9a-f-]{36}$/i, { timeout: 15_000 });
    const caseId = page.url().split("/").pop()!;

    const sections = page.getByRole("navigation", { name: "Prosecution sections" });
    for (const label of [
      "Overview",
      "Charges",
      "Evidence",
      "Witnesses",
      "Discovery",
      "Timeline",
      "Research",
      "Motions",
      "Hearings",
      "Tasks",
    ]) {
      const link = sections.getByRole("link", { name: label, exact: true });
      await link.click();
      await expect(link).toHaveAttribute("aria-current", "page");
    }

    const defendant = await page.request.post(
      `/api/v1/prosecution/cases/${caseId}/defendants?organizationId=${organizationId}`,
      { data: { displayName: `Defendant ${suffix}`, provenance } },
    );
    expect(defendant.ok(), await defendant.text()).toBeTruthy();
    const defendantId = ((await defendant.json()) as { record: { id: string } }).record.id;

    const agency = await page.request.post(
      `/api/v1/prosecution/cases/${caseId}/agencies?organizationId=${organizationId}`,
      { data: { name: `Agency ${suffix}`, agencyType: "police", jurisdiction: "PA" } },
    );
    expect(agency.ok(), await agency.text()).toBeTruthy();
    const agencyId = ((await agency.json()) as { record: { id: string } }).record.id;

    const officer = await page.request.post(
      `/api/v1/prosecution/cases/${caseId}/officers?organizationId=${organizationId}`,
      {
        data: {
          agencyId,
          name: `Officer ${suffix}`,
          role: "investigator",
          badgeIdentifier: `E2E-${suffix}`,
        },
      },
    );
    expect(officer.ok(), await officer.text()).toBeTruthy();

    const subpoena = await page.request.post(
      `/api/v1/prosecution/cases/${caseId}/subpoenas?organizationId=${organizationId}`,
      {
        data: {
          recipient: "Synthetic Custodian",
          requestScope: "bodycam files",
          status: "issued",
          provenance,
        },
      },
    );
    expect(subpoena.ok(), await subpoena.text()).toBeTruthy();

    const motion = await page.request.post(
      `/api/v1/prosecution/cases/${caseId}/motions?organizationId=${organizationId}`,
      {
        data: {
          motionType: "suppress",
          filingParty: "defense",
          status: "filed",
          provenance,
        },
      },
    );
    expect(motion.ok(), await motion.text()).toBeTruthy();

    const hearing = await page.request.post(
      `/api/v1/prosecution/cases/${caseId}/hearings?organizationId=${organizationId}`,
      {
        data: {
          hearingType: "suppression",
          court: "st-pa-trial",
          judge: "Synthetic Judge",
          participants: [],
          provenance,
        },
      },
    );
    expect(hearing.ok(), await hearing.text()).toBeTruthy();

    const charge = await page.request.post(
      `/api/v1/prosecution/cases/${caseId}/charges?organizationId=${organizationId}`,
      {
        data: {
          defendantId,
          countNumber: `e2e-${suffix}`,
          offenseName: "Synthetic e2e count",
          jurisdiction: "PA",
          provenance,
        },
      },
    );
    expect(charge.ok(), await charge.text()).toBeTruthy();
    const chargeId = ((await charge.json()) as { record: { id: string } }).record.id;

    const disposition = await page.request.post(
      `/api/v1/prosecution/cases/${caseId}/dispositions?organizationId=${organizationId}`,
      {
        data: {
          chargeId,
          result: "pending",
          notes: "Record only. No autonomous recommendation.",
          provenance,
        },
      },
    );
    expect(disposition.ok(), await disposition.text()).toBeTruthy();

    const overview = await page.request.get(
      `/api/v1/prosecution/cases/${caseId}?organizationId=${organizationId}`,
    );
    expect(overview.ok(), await overview.text()).toBeTruthy();
    const overviewBody = (await overview.json()) as {
      overview?: {
        guiltConclusion?: null;
        discoveryDashboard?: unknown;
        agencies?: unknown[];
        motions?: unknown[];
        hearings?: unknown[];
        subpoenas?: unknown[];
      };
    };
    expect(overviewBody.overview?.guiltConclusion ?? null).toBeNull();
    expect(overviewBody.overview?.discoveryDashboard).toBeTruthy();
    expect((overviewBody.overview?.agencies ?? []).length).toBeGreaterThan(0);
    expect((overviewBody.overview?.motions ?? []).length).toBeGreaterThan(0);
    expect((overviewBody.overview?.hearings ?? []).length).toBeGreaterThan(0);
    expect((overviewBody.overview?.subpoenas ?? []).length).toBeGreaterThan(0);

    await page.goto("/app/prosecution");
    await expect(page.getByRole("link", { name: CASE_NUMBER })).toBeVisible();
  });
});
