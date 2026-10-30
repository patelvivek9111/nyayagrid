import { expect, test } from "@playwright/test";
import { selectWorkspace } from "./select-workspace";

const suffix = Date.now().toString(36);
const ORG_NAME = `E2E Prosecution ${suffix}`;
const ORG_SLUG = `e2e-pros-${suffix}`;
const CASE_NUMBER = `SYN-E2E-${suffix}`;
const provenance = { extractionOrigin: "human", humanEntered: true };

test.describe.serial("signed-in prosecution workspace", () => {
  test.setTimeout(120_000);

  test("dev identity opens a criminal case and walks the prosecution sections", async ({
    page,
  }) => {
    const created = await page.request.post("/api/v1/organizations", {
      data: { name: ORG_NAME, slug: ORG_SLUG, type: "firm" },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const orgBody = (await created.json()) as { organization?: { id?: string }; id?: string };
    const organizationId = orgBody.organization?.id ?? orgBody.id;
    expect(organizationId).toBeTruthy();

    await page.goto("/app/prosecution");
    await page.waitForLoadState("networkidle");
    await selectWorkspace(page, ORG_NAME, organizationId);
    await expect(page.getByRole("button", { name: "Open criminal case" })).toBeEnabled({
      timeout: 30_000,
    });

    // API create keeps org/case IDs aligned; UI open path is still exercised below via sections.
    const opened = await page.request.post("/api/v1/prosecution/cases", {
      data: {
        organizationId,
        caseNumber: CASE_NUMBER,
        jurisdiction: "PA",
        court: "st-pa-trial",
      },
    });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const caseId = ((await opened.json()) as { criminalCase: { id: string } }).criminalCase.id;
    await page.goto(`/app/prosecution/${caseId}`);
    await page.waitForLoadState("networkidle");
    await selectWorkspace(page, ORG_NAME, organizationId);

    const sectionRoutes: Array<{ label: string; path: RegExp }> = [
      { label: "Overview", path: new RegExp(`/app/prosecution/${caseId}/?$`, "i") },
      { label: "Charges", path: new RegExp(`/app/prosecution/${caseId}/charges/?$`, "i") },
      { label: "Elements Matrix", path: new RegExp(`/app/prosecution/${caseId}/elements/?$`, "i") },
      { label: "Evidence", path: new RegExp(`/app/prosecution/${caseId}/evidence/?$`, "i") },
      { label: "Witnesses", path: new RegExp(`/app/prosecution/${caseId}/witnesses/?$`, "i") },
      { label: "Discovery", path: new RegExp(`/app/prosecution/${caseId}/discovery/?$`, "i") },
      { label: "Disclosure", path: new RegExp(`/app/prosecution/${caseId}/disclosure/?$`, "i") },
      { label: "Warrants", path: new RegExp(`/app/prosecution/${caseId}/warrants/?$`, "i") },
      { label: "Subpoenas", path: new RegExp(`/app/prosecution/${caseId}/subpoenas/?$`, "i") },
      { label: "Motions", path: new RegExp(`/app/prosecution/${caseId}/motions/?$`, "i") },
      { label: "Hearings", path: new RegExp(`/app/prosecution/${caseId}/hearings/?$`, "i") },
      { label: "Pleas", path: new RegExp(`/app/prosecution/${caseId}/pleas/?$`, "i") },
      { label: "Timeline", path: new RegExp(`/app/prosecution/${caseId}/timeline/?$`, "i") },
      { label: "Research", path: new RegExp(`/app/prosecution/${caseId}/research/?$`, "i") },
      { label: "Tasks", path: new RegExp(`/app/prosecution/${caseId}/tasks/?$`, "i") },
    ];
    const sections = page.getByRole("navigation", { name: "Prosecution sections" });
    for (const { label, path } of sectionRoutes) {
      const link = sections.getByRole("link", { name: label, exact: true });
      await Promise.all([page.waitForURL(path, { timeout: 15_000 }), link.click()]);
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

  test("overview keeps joint evidence, defendant-specific evidence, and separated issues without a guilt conclusion", async ({
    page,
  }) => {
    const created = await page.request.post("/api/v1/organizations", {
      data: { name: `${ORG_NAME}-deep`, slug: `${ORG_SLUG}-deep`, type: "firm" },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const orgBody = (await created.json()) as { organization?: { id?: string }; id?: string };
    const organizationId = orgBody.organization?.id ?? orgBody.id;
    expect(organizationId).toBeTruthy();

    await page.goto("/app/prosecution");
    await page.waitForLoadState("networkidle");
    await selectWorkspace(page, `${ORG_NAME}-deep`, organizationId);
    await page.reload();
    await page.waitForLoadState("networkidle");
    await selectWorkspace(page, `${ORG_NAME}-deep`, organizationId);

    await page.getByLabel("Case number").fill(`${CASE_NUMBER}-2`);
    await page.getByLabel("Jurisdiction").fill("PA");
    await page.getByLabel("Court id").fill("st-pa-trial");
    await page.getByRole("button", { name: "Open criminal case" }).click();
    await expect(page).toHaveURL(/\/app\/prosecution\/[0-9a-f-]{36}$/i, { timeout: 15_000 });
    const caseId = page.url().split("/").pop()!;

    async function post(resource: string, data: Record<string, unknown>) {
      const response = await page.request.post(
        `/api/v1/prosecution/cases/${caseId}/${resource}?organizationId=${organizationId}`,
        { data },
      );
      expect(response.ok(), await response.text()).toBeTruthy();
      return ((await response.json()) as { record: { id: string } }).record;
    }

    const ada = await post("defendants", { displayName: "Synthetic Defendant Ada", provenance });
    const ben = await post("defendants", { displayName: "Synthetic Defendant Ben", provenance });
    await post("charges", {
      defendantId: ada.id,
      countNumber: "1",
      offenseName: "Synthetic theft count",
      jurisdiction: "PA",
      provenance,
    });
    await post("procedure-issues", {
      issueType: "WARRANT",
      missingFacts: ["Affidavit does not identify which device was searched."],
      status: "open",
      provenance,
    });
    await post("evidence", {
      evidenceType: "scene_photo",
      relatedDefendantIds: [ada.id, ben.id],
      provenance,
    });
    await post("evidence", {
      evidenceType: "statement",
      relatedDefendantIds: [ada.id],
      provenance,
    });
    await post("evidence", {
      evidenceType: "statement",
      relatedDefendantIds: [ben.id],
      provenance,
    });

    const rejected = await page.request.post(
      `/api/v1/prosecution/cases/${caseId}/evidence?organizationId=${organizationId}`,
      {
        data: {
          evidenceType: "report",
          relatedDefendantIds: ["00000000-0000-4000-8000-000000000000"],
          provenance,
        },
      },
    );
    expect(rejected.ok()).toBeFalsy();

    await page.goto(`/app/prosecution/${caseId}`);
    await expect(page.getByRole("heading", { name: "Separated issues" })).toBeVisible();
    await expect(page.getByText("Count 1: Synthetic theft count", { exact: false })).toBeVisible();
    await expect(page.getByText("WARRANT — Open")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Evidence scope" })).toBeVisible();
    await expect(page.getByText("Joint items: 1")).toBeVisible();
    await expect(page.getByText("Synthetic Defendant Ada: 1 specific, 1 joint")).toBeVisible();
    await expect(page.getByText("Synthetic Defendant Ben: 1 specific, 1 joint")).toBeVisible();
    await expect(
      page.getByText("Nyaya does not return a guilt verdict or recommend charging decisions."),
    ).toBeVisible();
    await expect(page.getByText(/guilt verdict/i)).toHaveCount(1);
    await expect(page.locator("body")).not.toContainText("GUILTY");
    await expect(page.locator("body")).not.toContainText("probability of guilt");

    const overview = await page.request.get(
      `/api/v1/prosecution/cases/${caseId}?organizationId=${organizationId}`,
    );
    expect(overview.ok(), await overview.text()).toBeTruthy();
    const body = (await overview.json()) as {
      overview?: {
        guiltConclusion?: null;
        evidenceScope?: {
          jointEvidenceIds: string[];
          byDefendant: Array<{
            displayName: string;
            specificEvidenceIds: string[];
            jointEvidenceIds: string[];
          }>;
        };
        issueSeparation?: Array<{ kind: string }>;
      };
    };
    expect(body.overview?.guiltConclusion ?? null).toBeNull();
    expect(body.overview?.evidenceScope?.jointEvidenceIds).toHaveLength(1);
    expect(
      body.overview?.evidenceScope?.byDefendant.every(
        (row) => row.specificEvidenceIds.length === 1,
      ),
    ).toBe(true);
    expect(body.overview?.issueSeparation?.some((row) => row.kind === "procedure")).toBe(true);
  });

  test("P0 office flow: assignment, evidence CoC, witnesses, disclosure human review, isolation", async ({
    page,
  }) => {
    const created = await page.request.post("/api/v1/organizations", {
      data: { name: `${ORG_NAME}-p0`, slug: `${ORG_SLUG}-p0`, type: "firm" },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const orgBody = (await created.json()) as { organization?: { id?: string }; id?: string };
    const organizationId = orgBody.organization?.id ?? orgBody.id!;
    expect(organizationId).toBeTruthy();

    await page.goto("/app/prosecution");
    await selectWorkspace(page, `${ORG_NAME}-p0`, organizationId);

    const opened = await page.request.post("/api/v1/prosecution/cases", {
      data: {
        organizationId,
        caseNumber: `${CASE_NUMBER}-p0`,
        jurisdiction: "PA",
        court: "st-pa-trial",
      },
    });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const caseId = ((await opened.json()) as { criminalCase: { id: string } }).criminalCase.id;

    const seedOverview = await page.request.get(
      `/api/v1/prosecution/cases/${caseId}?organizationId=${organizationId}`,
    );
    expect(seedOverview.ok(), await seedOverview.text()).toBeTruthy();
    const seedBody = (await seedOverview.json()) as {
      overview: {
        assignableMembers: Array<{
          userId: string;
          canBeProsecutor: boolean;
          canBeSupervisor: boolean;
        }>;
      };
    };
    const assignee =
      seedBody.overview.assignableMembers.find((m) => m.canBeProsecutor && m.canBeSupervisor) ??
      seedBody.overview.assignableMembers.find((m) => m.canBeProsecutor);
    expect(assignee?.userId).toBeTruthy();
    const userId = assignee!.userId;

    const assigned = await page.request.patch(`/api/v1/prosecution/cases/${caseId}`, {
      data: {
        organizationId,
        assignedProsecutorId: userId,
        supervisingProsecutorId: userId,
        summary: "P0 assignment smoke",
        priority: "high",
      },
    });
    expect(assigned.ok(), await assigned.text()).toBeTruthy();

    async function post(resource: string, data: Record<string, unknown>) {
      const response = await page.request.post(
        `/api/v1/prosecution/cases/${caseId}/${resource}?organizationId=${organizationId}`,
        { data },
      );
      expect(response.ok(), await response.text()).toBeTruthy();
      return ((await response.json()) as { record: { id: string } }).record;
    }

    const agency = await post("agencies", {
      name: `P0 Agency ${suffix}`,
      agencyType: "police",
      jurisdiction: "PA",
    });
    const agencyPatch = await page.request.patch(`/api/v1/prosecution/cases/${caseId}`, {
      data: { organizationId, investigatingAgencyId: agency.id },
    });
    expect(agencyPatch.ok(), await agencyPatch.text()).toBeTruthy();

    const defendant = await post("defendants", {
      displayName: `P0 Defendant ${suffix}`,
      provenance,
    });
    await post("charges", {
      defendantId: defendant.id,
      countNumber: "p0-1",
      offenseName: "Synthetic P0 count",
      jurisdiction: "PA",
      provenance,
    });
    const evidence = await post("evidence", {
      evidenceType: "bodycam",
      collector: "Officer P0",
      collectionDate: "2024-01-02",
      storageReference: "BOX-P0",
      chainOfCustody: ["Collected by Officer P0", "Logged to evidence room"],
      relatedDefendantIds: [defendant.id],
      provenance,
    });
    const witness = await post("witnesses", {
      displayName: `P0 Witness ${suffix}`,
      witnessType: "civilian",
      provenance,
    });
    await post("statements", {
      witnessId: witness.id,
      statementType: "interview",
      claims: [{ key: "location", value: "Main St", kind: "fact" }],
      provenance,
    });
    await post("statements", {
      witnessId: witness.id,
      statementType: "interview",
      claims: [{ key: "location", value: "Oak Ave", kind: "fact" }],
      provenance,
    });
    await post("discovery", {
      source: "police",
      category: "report",
      notes: "P0 discovery",
      provenance,
    });
    const candidate = await post("disclosure", {
      category: "POTENTIALLY_EXCULPATORY",
      status: "REVIEW_REQUIRED",
      notes: "Potential disclosure candidate for human review",
      provenance,
    });

    const overview = await page.request.get(
      `/api/v1/prosecution/cases/${caseId}?organizationId=${organizationId}`,
    );
    expect(overview.ok(), await overview.text()).toBeTruthy();
    const body = (await overview.json()) as {
      overview: {
        case: {
          assignedProsecutorId: string | null;
          supervisingProsecutorId: string | null;
          investigatingAgencyId: string | null;
        };
        evidenceItems: Array<{
          id: string;
          custodyFindings: Array<{ code: string }>;
          custodyTransfers: unknown[];
        }>;
        witnesses: Array<{ statementComparison: Array<{ label: string }> }>;
        disclosureCandidates: Array<{ id: string; status: string; label: string }>;
        canReviewDisclosure: boolean;
        guiltConclusion: null;
      };
    };
    expect(body.overview.guiltConclusion).toBeNull();
    expect(body.overview.case.assignedProsecutorId).toBe(userId);
    expect(body.overview.case.supervisingProsecutorId).toBe(userId);
    expect(body.overview.case.investigatingAgencyId).toBe(agency.id);
    expect(body.overview.evidenceItems.some((item) => item.id === evidence.id)).toBe(true);
    expect(
      body.overview.evidenceItems.find((item) => item.id === evidence.id)?.custodyTransfers.length,
    ).toBeGreaterThan(0);
    expect(
      body.overview.witnesses[0]?.statementComparison.some((row) => row.label === "CONTRADICTORY"),
    ).toBe(true);
    expect(body.overview.disclosureCandidates[0]?.label).toBe("Potential disclosure candidate");
    expect(body.overview.canReviewDisclosure).toBe(true);

    const reviewed = await page.request.patch(
      `/api/v1/prosecution/cases/${caseId}/disclosure?organizationId=${organizationId}`,
      {
        data: {
          candidateId: candidate.id,
          status: "REVIEWED_NOT_DISCLOSE",
          notes: "Human final determination",
        },
      },
    );
    expect(reviewed.ok(), await reviewed.text()).toBeTruthy();

    await page.goto(`/app/prosecution/${caseId}/disclosure`);
    await selectWorkspace(page, `${ORG_NAME}-p0`, organizationId);
    await expect(page.getByText("Potential disclosure candidate").first()).toBeVisible();
    await expect(
      page.getByText(
        /Brady violation|Giglio violation|must disclose|constitutional violation established/i,
      ),
    ).toHaveCount(0);

    await page.goto(`/app/prosecution/${caseId}/evidence`);
    await expect(page.getByText("bodycam").first()).toBeVisible();
    await expect(page.getByText(/Chain of custody/i).first()).toBeVisible();

    await page.goto(`/app/prosecution/${caseId}/witnesses`);
    await expect(page.getByText(`P0 Witness ${suffix}`).first()).toBeVisible();
    await expect(page.getByText(/Contradictory/i).first()).toBeVisible();

    // Cross-org isolation: second org cannot read this case.
    const otherCreated = await page.request.post("/api/v1/organizations", {
      data: { name: `${ORG_NAME}-isol`, slug: `${ORG_SLUG}-isol`, type: "firm" },
    });
    expect(otherCreated.ok(), await otherCreated.text()).toBeTruthy();
    const isolBody = (await otherCreated.json()) as {
      organization?: { id?: string };
      id?: string;
    };
    const isolOrgId = isolBody.organization?.id ?? isolBody.id;
    expect(isolOrgId).toBeTruthy();
    const cross = await page.request.get(
      `/api/v1/prosecution/cases/${caseId}?organizationId=${isolOrgId}`,
    );
    expect(cross.ok()).toBeFalsy();

    // Second case cannot attach first-case evidence id via link to foreign case inventively:
    const caseB = await page.request.post("/api/v1/prosecution/cases", {
      data: {
        organizationId,
        caseNumber: `${CASE_NUMBER}-p0-b`,
        jurisdiction: "PA",
        court: "st-pa-trial",
      },
    });
    expect(caseB.ok(), await caseB.text()).toBeTruthy();
    const caseBId = ((await caseB.json()) as { criminalCase: { id: string } }).criminalCase.id;
    const badLink = await page.request.post(
      `/api/v1/prosecution/cases/${caseBId}/evidence-links?organizationId=${organizationId}`,
      {
        data: {
          evidenceId: evidence.id,
          relationship: "RELATED_TO",
          targetType: "charge",
          targetId: "00000000-0000-4000-8000-000000000099",
          provenance,
        },
      },
    );
    expect(badLink.ok()).toBeFalsy();
  });
});
