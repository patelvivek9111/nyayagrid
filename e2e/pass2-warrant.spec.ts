import { expect, test } from "@playwright/test";
import { selectWorkspace } from "./select-workspace";

const suffix = Date.now().toString(36);
const ORG_NAME = `E2E Pass2 Warrant ${suffix}`;
const ORG_SLUG = `e2e-p2w-${suffix}`;
const CASE_NUMBER = `PASS2-${suffix}`;
const provenance = { extractionOrigin: "human", humanEntered: true };

test.describe.serial("pass2 signed-in warrant suppression flow", () => {
  test.setTimeout(180_000);

  test("multi-warrant suppression review stays separated without decisions", async ({ page }) => {
    const created = await page.request.post("/api/v1/organizations", {
      data: { name: ORG_NAME, slug: ORG_SLUG, type: "firm" },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const orgBody = (await created.json()) as { organization?: { id?: string }; id?: string };
    const organizationId = orgBody.organization?.id ?? orgBody.id!;

    await page.goto("/app/prosecution");
    await page.waitForLoadState("networkidle");
    await selectWorkspace(page, ORG_NAME);

    await page.getByLabel("Case number").fill(CASE_NUMBER);
    await page.getByLabel("Jurisdiction").fill("US");
    await page.getByLabel("Court id").fill("us-d-pa-ed");
    await page.getByRole("button", { name: "Open criminal case" }).click();
    await expect(page).toHaveURL(/\/app\/prosecution\/[0-9a-f-]{36}$/i, { timeout: 15_000 });
    const caseId = page.url().split("/").pop()!;

    const ada = await page.request.post(
      `/api/v1/prosecution/cases/${caseId}/defendants?organizationId=${organizationId}`,
      { data: { displayName: `Ada ${suffix}`, provenance } },
    );
    expect(ada.ok(), await ada.text()).toBeTruthy();
    const adaId = ((await ada.json()) as { record: { id: string } }).record.id;
    const ben = await page.request.post(
      `/api/v1/prosecution/cases/${caseId}/defendants?organizationId=${organizationId}`,
      { data: { displayName: `Ben ${suffix}`, provenance } },
    );
    expect(ben.ok(), await ben.text()).toBeTruthy();
    const benId = ((await ben.json()) as { record: { id: string } }).record.id;

    const evAda = await page.request.post(
      `/api/v1/prosecution/cases/${caseId}/evidence?organizationId=${organizationId}`,
      {
        data: {
          evidenceType: "device",
          storageReference: `ADA-${suffix}`,
          relatedDefendantIds: [adaId],
          provenance,
        },
      },
    );
    expect(evAda.ok(), await evAda.text()).toBeTruthy();
    const evAdaId = ((await evAda.json()) as { record: { id: string } }).record.id;
    const evJoint = await page.request.post(
      `/api/v1/prosecution/cases/${caseId}/evidence?organizationId=${organizationId}`,
      {
        data: {
          evidenceType: "scene_photo",
          storageReference: `JOINT-${suffix}`,
          relatedDefendantIds: [adaId, benId],
          provenance,
        },
      },
    );
    expect(evJoint.ok(), await evJoint.text()).toBeTruthy();
    const evJointId = ((await evJoint.json()) as { record: { id: string } }).record.id;

    const warrantAda = await page.request.post(
      `/api/v1/prosecution/cases/${caseId}/warrants?organizationId=${organizationId}`,
      {
        data: {
          warrantType: "search",
          issuingCourt: "us-d-pa-ed",
          applicationDate: "2026-03-01",
          issueDate: "2026-03-01",
          executionDate: "2026-03-02",
          scope: "Ada phone",
          probableCauseFacts: [],
          seizedEvidenceIds: [evAdaId],
          provenance,
        },
      },
    );
    expect(warrantAda.ok(), await warrantAda.text()).toBeTruthy();
    const warrantAdaId = ((await warrantAda.json()) as { record: { id: string } }).record.id;

    const warrantJoint = await page.request.post(
      `/api/v1/prosecution/cases/${caseId}/warrants?organizationId=${organizationId}`,
      {
        data: {
          warrantType: "search",
          issuingCourt: "us-d-pa-ed",
          applicationDate: "2026-03-10",
          issueDate: "2026-03-11",
          executionDate: "2026-03-12",
          scope: "shared residence",
          probableCauseFacts: ["Observation dated 2026-03-09 at the shared residence."],
          seizedEvidenceIds: [evJointId],
          returnNotes: "Inventory listed a bag.",
          provenance,
        },
      },
    );
    expect(warrantJoint.ok(), await warrantJoint.text()).toBeTruthy();
    const warrantJointId = ((await warrantJoint.json()) as { record: { id: string } }).record.id;

    await page.request.post(
      `/api/v1/prosecution/cases/${caseId}/warrant-affidavits?organizationId=${organizationId}`,
      {
        data: {
          warrantId: warrantJointId,
          affiant: "Officer Pass2",
          statement: "Observation dated 2026-03-09 at the shared residence.",
          provenance,
        },
      },
    );

    await page.request.post(
      `/api/v1/prosecution/cases/${caseId}/timeline?organizationId=${organizationId}`,
      {
        data: {
          eventType: "WARRANT_ISSUED",
          title: "Ada warrant issued",
          eventDate: "2026-03-01T12:00:00.000Z",
          provenance,
        },
      },
    );
    await page.request.post(
      `/api/v1/prosecution/cases/${caseId}/timeline?organizationId=${organizationId}`,
      {
        data: {
          eventType: "WARRANT_EXECUTED",
          title: "Ada warrant executed",
          eventDate: "2026-03-02T12:00:00.000Z",
          provenance,
        },
      },
    );

    const overviewRes = await page.request.get(
      `/api/v1/prosecution/cases/${caseId}?organizationId=${organizationId}`,
    );
    expect(overviewRes.ok(), await overviewRes.text()).toBeTruthy();
    const overview = (await overviewRes.json()) as {
      overview: {
        guiltConclusion: null;
        suppressionReview: {
          suppressionConclusion: null;
          validityConclusion: null;
          guiltConclusion: null;
          warrants: Array<{
            id: string;
            evidence: Array<{ evidenceId: string; storageReference: string | null }>;
          }>;
          issues: Array<{
            warrantId: string | null;
            dimension: string;
            missingFacts: string[];
            authorities: Array<{ citation: string | null; treatment: string; authorityStatus: string }>;
            linkedEvidence: Array<{ evidenceId: string }>;
          }>;
        };
      };
    };

    expect(overview.overview.guiltConclusion).toBeNull();
    expect(overview.overview.suppressionReview.suppressionConclusion).toBeNull();
    expect(overview.overview.suppressionReview.validityConclusion).toBeNull();
    expect(overview.overview.suppressionReview.warrants).toHaveLength(2);

    const adaView = overview.overview.suppressionReview.warrants.find((w) => w.id === warrantAdaId)!;
    const jointView = overview.overview.suppressionReview.warrants.find((w) => w.id === warrantJointId)!;
    expect(adaView.evidence.every((e) => e.evidenceId === evAdaId)).toBeTruthy();
    expect(jointView.evidence.every((e) => e.evidenceId === evJointId)).toBeTruthy();

    const adaIssues = overview.overview.suppressionReview.issues.filter((i) => i.warrantId === warrantAdaId);
    const jointIssues = overview.overview.suppressionReview.issues.filter((i) => i.warrantId === warrantJointId);
    expect(adaIssues.length).toBeGreaterThan(0);
    expect(jointIssues.length).toBeGreaterThan(0);
    expect(adaIssues.some((i) => i.missingFacts.length > 0)).toBeTruthy();
    expect(adaIssues.every((i) => i.linkedEvidence.every((e) => e.evidenceId !== evJointId))).toBeTruthy();
    expect(jointIssues.every((i) => i.linkedEvidence.every((e) => e.evidenceId !== evAdaId))).toBeTruthy();

    const gates = overview.overview.suppressionReview.issues.flatMap((i) =>
      i.authorities.filter((a) => a.citation === "462 U.S. 213").map((a) => ({ dimension: i.dimension, ...a })),
    );
    expect(gates.some((a) => a.dimension === "PROBABLE_CAUSE")).toBeTruthy();
    expect(gates.every((a) => a.treatment === "UNVERIFIED")).toBeTruthy();
    expect(gates.every((a) => a.dimension === "PROBABLE_CAUSE")).toBeTruthy();

    await page.getByRole("navigation", { name: "Prosecution sections" }).getByRole("link", { name: "Warrants", exact: true }).click();
    await expect(page.getByText(/does not decide whether a warrant is valid|does not decide suppression/i)).toBeVisible();
    await expect(page.getByText("Probable Cause").first()).toBeVisible();
    await expect(page.getByText("462 U.S. 213").first()).toBeVisible();
    await expect(page.getByText(/Treatment unverified/i).first()).toBeVisible();
    await expect(page.getByText(/Missing facts/i).first()).toBeVisible();
    await expect(page.getByText(`ADA-${suffix}`)).toBeVisible();
    await expect(page.getByText(`JOINT-${suffix}`)).toBeVisible();
    await expect(page.getByText(/The warrant was valid|evidence should be suppressed|The defendant is guilty/i)).toHaveCount(0);

    const pageText = await page.locator("body").innerText();
    expect(pageText).not.toMatch(/The warrant was valid/i);
    expect(pageText).not.toMatch(/evidence should be suppressed/i);
    expect(pageText).not.toMatch(/\bGUILTY\b/);
  });
});
