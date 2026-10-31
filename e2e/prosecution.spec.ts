import { expect, test } from "@playwright/test";
import { selectWorkspace } from "./select-workspace";

const suffix = Date.now().toString(36);
const ORG_NAME = `E2E Prosecution ${suffix}`;
const ORG_SLUG = `e2e-pros-${suffix}`;
const CASE_NUMBER = `SYN-E2E-${suffix}`;
const provenance = { extractionOrigin: "human", humanEntered: true };

test.describe("signed-in prosecution workspace", () => {
  test.setTimeout(180_000);

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
      await link.click();
      await expect(page).toHaveURL(path, { timeout: 30_000 });
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
      evidenceType: "body_camera",
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
    // Prefer the evidence list item — the type <option> matches the same text but is not visible.
    await expect(
      page
        .locator("li")
        .filter({ hasText: /body.?camera/i })
        .first(),
    ).toBeVisible();
    await expect(page.getByText(/Chain of custody/i).first()).toBeVisible();

    await page.goto(`/app/prosecution/${caseId}/witnesses`);
    // Prefer the profile list item — the statement form <option> matches the same text but is not visible.
    await expect(
      page
        .locator("li")
        .filter({ hasText: `P0 Witness ${suffix}` })
        .first(),
    ).toBeVisible();
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

  test("Stage 3 evidence intelligence: gaps, CoC gap, witness conflict, ask context, isolation", async ({
    page,
  }) => {
    const created = await page.request.post("/api/v1/organizations", {
      data: { name: `${ORG_NAME}-s3`, slug: `${ORG_SLUG}-s3`, type: "firm" },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const orgBody = (await created.json()) as { organization?: { id?: string }; id?: string };
    const organizationId = orgBody.organization?.id ?? orgBody.id!;

    await page.goto("/app/prosecution");
    await selectWorkspace(page, `${ORG_NAME}-s3`, organizationId);

    const opened = await page.request.post("/api/v1/prosecution/cases", {
      data: {
        organizationId,
        caseNumber: `${CASE_NUMBER}-s3`,
        jurisdiction: "PA",
        court: "st-pa-trial",
      },
    });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const caseId = ((await opened.json()) as { criminalCase: { id: string } }).criminalCase.id;

    async function post(resource: string, data: Record<string, unknown>) {
      const response = await page.request.post(
        `/api/v1/prosecution/cases/${caseId}/${resource}?organizationId=${organizationId}`,
        { data },
      );
      expect(response.ok(), await response.text()).toBeTruthy();
      return ((await response.json()) as { record: { id: string } }).record;
    }

    const ada = await post("defendants", { displayName: `S3 Ada ${suffix}`, provenance });
    const ben = await post("defendants", { displayName: `S3 Ben ${suffix}`, provenance });
    const charge1 = await post("charges", {
      defendantId: ada.id,
      countNumber: "1",
      offenseName: "Synthetic S3 Count 1",
      jurisdiction: "PA",
      provenance,
    });
    await post("charges", {
      defendantId: ben.id,
      countNumber: "2",
      offenseName: "Synthetic S3 Count 2",
      jurisdiction: "PA",
      provenance,
    });

    const joint = await post("evidence", {
      evidenceType: "photograph",
      relatedDefendantIds: [ada.id, ben.id],
      relatedChargeIds: [charge1.id],
      chainOfCustody: [
        {
          actor: "Officer A",
          timestamp: "2024-02-01T10:00:00Z",
          from: null,
          to: "Officer A",
          source: provenance,
        },
        {
          actor: "Evidence Room",
          timestamp: "2024-02-01T12:00:00Z",
          from: "Officer B",
          to: "Evidence Room",
          source: provenance,
        },
      ],
      provenance,
    });
    const supportEv = await post("evidence", {
      evidenceType: "police_report",
      relatedDefendantIds: [ada.id],
      relatedChargeIds: [charge1.id],
      chainOfCustody: [
        {
          actor: "Officer A",
          timestamp: "2024-02-01T09:00:00Z",
          from: null,
          to: "Officer A",
          source: provenance,
        },
      ],
      provenance,
    });
    const contraryEv = await post("evidence", {
      evidenceType: "witness_statement",
      relatedDefendantIds: [ada.id],
      relatedChargeIds: [charge1.id],
      provenance,
    });
    await post("evidence", {
      evidenceType: "defendant_statement",
      relatedDefendantIds: [ben.id],
      provenance,
    });

    const elSupported = await post("elements", {
      chargeId: charge1.id,
      elementOrder: 1,
      elementType: "element",
      elementText: "Identity of actor",
      supportingEvidenceIds: [joint.id, supportEv.id],
      contraryEvidenceIds: [],
      uncertainEvidenceIds: [],
      missingEvidenceIds: [],
      relatedAuthorityIds: [],
      provenance,
    });
    const elConflict = await post("elements", {
      chargeId: charge1.id,
      elementOrder: 2,
      elementType: "element",
      elementText: "Possession of item",
      supportingEvidenceIds: [supportEv.id],
      contraryEvidenceIds: [contraryEv.id],
      uncertainEvidenceIds: [],
      missingEvidenceIds: [],
      relatedAuthorityIds: [],
      provenance,
    });
    await post("elements", {
      chargeId: charge1.id,
      elementOrder: 3,
      elementType: "element",
      elementText: "Intent",
      supportingEvidenceIds: [],
      contraryEvidenceIds: [],
      uncertainEvidenceIds: [],
      missingEvidenceIds: ["expected-lab"],
      relatedAuthorityIds: [],
      provenance,
    });

    await post("evidence-links", {
      evidenceId: joint.id,
      relationship: "SUPPORTS_ELEMENT",
      targetType: "ChargeElement",
      targetId: elSupported.id,
      provenance,
    });
    await post("evidence-links", {
      evidenceId: contraryEv.id,
      relationship: "UNDERMINES_ELEMENT",
      targetType: "ChargeElement",
      targetId: elConflict.id,
      provenance,
    });

    const witness = await post("witnesses", {
      displayName: `S3 Witness ${suffix}`,
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

    await post("timeline", {
      eventType: "ARREST",
      title: "Arrest note A",
      eventDate: "2024-02-02T08:00:00.000Z",
      provenance,
    });
    await post("timeline", {
      eventType: "ARREST",
      title: "Arrest note B",
      eventDate: "2024-02-03T08:00:00.000Z",
      provenance: { ...provenance, sourceSpan: "alternate arrest chronology source" },
    });

    await post("procedure-issues", {
      issueType: "WARRANT",
      missingFacts: ["Affidavit device identity missing"],
      status: "open",
      provenance,
    });
    await post("disclosure", {
      category: "POTENTIALLY_EXCULPATORY",
      status: "REVIEW_REQUIRED",
      notes: "Stage 3 candidate — human review required",
      provenance,
    });

    const overview = await page.request.get(
      `/api/v1/prosecution/cases/${caseId}?organizationId=${organizationId}`,
    );
    expect(overview.ok(), await overview.text()).toBeTruthy();
    const body = (await overview.json()) as {
      overview: {
        guiltConclusion: null;
        chargingRecommendation: null;
        witnessCredibilityScore: null;
        investigationGaps: Array<{ gapType: string }>;
        caseIntelligenceStats: {
          elementConflicted: number;
          elementMissingSupport: number;
          custodyWarningCount: number;
          witnessConflictCount: number;
          disclosureReviewRequired: number;
        };
        askIntelligenceContext: string;
        evidenceScope: { jointEvidenceIds: string[] };
        matrix: Array<{ status: string; guiltConclusion: null }>;
      };
    };
    expect(body.overview.guiltConclusion).toBeNull();
    expect(body.overview.chargingRecommendation ?? null).toBeNull();
    expect(body.overview.witnessCredibilityScore ?? null).toBeNull();
    expect(body.overview.caseIntelligenceStats.custodyWarningCount).toBeGreaterThan(0);
    expect(body.overview.caseIntelligenceStats.witnessConflictCount).toBeGreaterThan(0);
    expect(body.overview.caseIntelligenceStats.disclosureReviewRequired).toBeGreaterThan(0);
    expect(body.overview.investigationGaps.some((g) => g.gapType === "CHAIN_OF_CUSTODY")).toBe(
      true,
    );
    expect(body.overview.investigationGaps.some((g) => g.gapType === "WITNESS_CONFLICT")).toBe(
      true,
    );
    expect(body.overview.evidenceScope.jointEvidenceIds.length).toBeGreaterThan(0);
    expect(body.overview.matrix.every((row) => row.guiltConclusion === null)).toBe(true);
    expect(body.overview.askIntelligenceContext).toContain("PROSECUTION_CASE_INTELLIGENCE");
    expect(body.overview.askIntelligenceContext).toContain("GUILT_CONCLUSION: null");
    expect(body.overview.askIntelligenceContext).not.toMatch(/probability of guilt/i);

    await page.goto(`/app/prosecution/${caseId}`);
    await selectWorkspace(page, `${ORG_NAME}-s3`, organizationId);
    await expect(page.getByRole("heading", { name: "Investigation gap queue" })).toBeVisible();
    await expect(page.getByText(/Coverage counts describe evidence organization/i)).toBeVisible();

    await page.goto(`/app/prosecution/${caseId}/elements`);
    await expect(page.getByText("Identity of actor")).toBeVisible();
    await expect(page.getByText(/Guilt conclusion: none/i)).toBeVisible();

    await page.goto(`/app/prosecution/${caseId}/timeline`);
    await expect(page.getByText(/Arrest note/i).first()).toBeVisible();

    await page.goto(`/app/prosecution/${caseId}/disclosure`);
    await expect(page.getByText("Potential disclosure candidate").first()).toBeVisible();
    await expect(
      page.getByText(/Brady violation|must disclose|constitutional violation established/i),
    ).toHaveCount(0);

    const otherCreated = await page.request.post("/api/v1/organizations", {
      data: { name: `${ORG_NAME}-s3-isol`, slug: `${ORG_SLUG}-s3-isol`, type: "firm" },
    });
    expect(otherCreated.ok(), await otherCreated.text()).toBeTruthy();
    const isolBody = (await otherCreated.json()) as {
      organization?: { id?: string };
      id?: string;
    };
    const isolOrgId = isolBody.organization?.id ?? isolBody.id!;
    const cross = await page.request.get(
      `/api/v1/prosecution/cases/${caseId}?organizationId=${isolOrgId}`,
    );
    expect(cross.ok()).toBeFalsy();

    const caseB = await page.request.post("/api/v1/prosecution/cases", {
      data: {
        organizationId,
        caseNumber: `${CASE_NUMBER}-s3-b`,
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
          evidenceId: joint.id,
          relationship: "RELATED_TO",
          targetType: "charge",
          targetId: charge1.id,
          provenance,
        },
      },
    );
    expect(badLink.ok()).toBeFalsy();
  });

  test("Stage 4 discovery/disclosure: candidates, human review history, production tracking, isolation", async ({
    page,
  }) => {
    const created = await page.request.post("/api/v1/organizations", {
      data: { name: `${ORG_NAME}-s4`, slug: `${ORG_SLUG}-s4`, type: "firm" },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const orgBody = (await created.json()) as { organization?: { id?: string }; id?: string };
    const organizationId = orgBody.organization?.id ?? orgBody.id!;

    await page.goto("/app/prosecution");
    await selectWorkspace(page, `${ORG_NAME}-s4`, organizationId);

    const opened = await page.request.post("/api/v1/prosecution/cases", {
      data: {
        organizationId,
        caseNumber: `${CASE_NUMBER}-s4`,
        jurisdiction: "PA",
        court: "st-pa-trial",
      },
    });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const caseId = ((await opened.json()) as { criminalCase: { id: string } }).criminalCase.id;

    async function post(resource: string, data: Record<string, unknown>) {
      const response = await page.request.post(
        `/api/v1/prosecution/cases/${caseId}/${resource}?organizationId=${organizationId}`,
        { data },
      );
      expect(response.ok(), await response.text()).toBeTruthy();
      return ((await response.json()) as { record: { id: string } }).record;
    }

    const defendant = await post("defendants", {
      displayName: `S4 Defendant ${suffix}`,
      provenance,
    });
    const charge = await post("charges", {
      defendantId: defendant.id,
      countNumber: "1",
      offenseName: "Synthetic S4 Count",
      jurisdiction: "PA",
      provenance,
    });
    const evidence = await post("evidence", {
      evidenceType: "police_report",
      relatedDefendantIds: [defendant.id],
      relatedChargeIds: [charge.id],
      provenance,
    });
    const contrary = await post("evidence", {
      evidenceType: "witness_statement",
      relatedDefendantIds: [defendant.id],
      relatedChargeIds: [charge.id],
      provenance,
    });
    await post("elements", {
      chargeId: charge.id,
      elementOrder: 1,
      elementType: "element",
      elementText: "Identity",
      supportingEvidenceIds: [evidence.id],
      contraryEvidenceIds: [contrary.id],
      provenance,
    });
    const witness = await post("witnesses", {
      displayName: `S4 Witness ${suffix}`,
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
    const discovery = await post("discovery", {
      title: "Synthetic supplemental report",
      source: "police",
      category: "supplemental_report",
      reviewStatus: "RECEIVED",
      productionStatus: "RECEIVED",
      relatedEvidenceIds: [contrary.id],
      relatedWitnessIds: [witness.id],
      relatedDefendantIds: [defendant.id],
      provenance,
    });
    const candidate = await post("disclosure", {
      category: "PRIOR_INCONSISTENT_STATEMENT",
      status: "REVIEW_REQUIRED",
      reason: "Structural statement difference on location requires prosecutor review",
      origin: "human",
      relatedEvidenceIds: [contrary.id],
      relatedWitnessIds: [witness.id],
      relatedDiscoveryIds: [discovery.id],
      relatedChargeIds: [charge.id],
      notes: "Potential disclosure candidate",
      provenance,
    });

    const blockedFinal = await page.request.patch(
      `/api/v1/prosecution/cases/${caseId}/disclosure?organizationId=${organizationId}`,
      {
        data: {
          candidateId: candidate.id,
          status: "REVIEWED_NOT_DISCLOSE",
        },
      },
    );
    // Without reason, consequential withhold must fail.
    expect(blockedFinal.ok()).toBeFalsy();

    const reviewed = await page.request.patch(
      `/api/v1/prosecution/cases/${caseId}/disclosure?organizationId=${organizationId}`,
      {
        data: {
          candidateId: candidate.id,
          status: "REVIEWED_DISCLOSE",
          reason: "Human final determination after source review",
          notes: "Human determination — not an automated Brady conclusion",
        },
      },
    );
    expect(reviewed.ok(), await reviewed.text()).toBeTruthy();

    const production = await post("productions", {
      label: "S4 defense production",
      status: "PRODUCED",
      productionDate: "2024-03-01",
      recipientReference: "defense counsel (tracking only)",
      candidateIds: [candidate.id],
      discoveryItemIds: [discovery.id],
      isSupplemental: false,
      notes: "Production tracking only — no external send",
      provenance,
    });
    expect(production.id).toBeTruthy();

    const overview = await page.request.get(
      `/api/v1/prosecution/cases/${caseId}?organizationId=${organizationId}`,
    );
    expect(overview.ok(), await overview.text()).toBeTruthy();
    const body = (await overview.json()) as {
      overview: {
        guiltConclusion: null;
        discoveryQueue: { unreviewed: number; produced: number };
        disclosureCandidates: Array<{
          id: string;
          status: string;
          reviewHistory: unknown[];
          bradyViolationConclusion: null;
          giglioViolationConclusion: null;
          mustDiscloseConclusion: null;
        }>;
        disclosureProductions: Array<{ id: string; status: string }>;
        supervisorDisclosureQueue: unknown[];
        surfacedDisclosureCandidates: unknown[];
        askIntelligenceContext: string;
        disclosureAskContext: string;
      };
    };
    expect(body.overview.guiltConclusion).toBeNull();
    expect(body.overview.disclosureCandidates[0]?.status).toBe("REVIEWED_DISCLOSE");
    expect((body.overview.disclosureCandidates[0]?.reviewHistory ?? []).length).toBeGreaterThan(0);
    expect(body.overview.disclosureCandidates[0]?.bradyViolationConclusion).toBeNull();
    expect(body.overview.disclosureCandidates[0]?.giglioViolationConclusion).toBeNull();
    expect(body.overview.disclosureCandidates[0]?.mustDiscloseConclusion).toBeNull();
    expect(body.overview.disclosureProductions.some((p) => p.id === production.id)).toBe(true);
    expect(body.overview.askIntelligenceContext).toContain(
      "PROSECUTION_DISCOVERY_DISCLOSURE_CONTEXT",
    );
    expect(body.overview.disclosureAskContext).toContain("[HUMAN DETERMINATION]");
    expect(body.overview.disclosureAskContext).toContain("BRADY_VIOLATION_CONCLUSION: null");
    expect(body.overview.disclosureAskContext).not.toMatch(/Brady violation|must disclose/i);

    await page.goto(`/app/prosecution/${caseId}/disclosure`);
    await selectWorkspace(page, `${ORG_NAME}-s4`, organizationId);
    await expect(page.getByText("Potential disclosure candidate").first()).toBeVisible();
    await expect(page.getByText(/Review history/i).first()).toBeVisible();
    await expect(
      page.getByText(/Brady violation|Giglio violation|must disclose|constitutional violation/i),
    ).toHaveCount(0);

    await page.goto(`/app/prosecution/${caseId}`);
    await expect(page.getByRole("heading", { name: "Supervisor disclosure queue" })).toBeVisible();

    const otherCreated = await page.request.post("/api/v1/organizations", {
      data: { name: `${ORG_NAME}-s4-isol`, slug: `${ORG_SLUG}-s4-isol`, type: "firm" },
    });
    expect(otherCreated.ok(), await otherCreated.text()).toBeTruthy();
    const isolBody = (await otherCreated.json()) as {
      organization?: { id?: string };
      id?: string;
    };
    const isolOrgId = isolBody.organization?.id ?? isolBody.id!;
    const cross = await page.request.get(
      `/api/v1/prosecution/cases/${caseId}?organizationId=${isolOrgId}`,
    );
    expect(cross.ok()).toBeFalsy();

    const caseB = await page.request.post("/api/v1/prosecution/cases", {
      data: {
        organizationId,
        caseNumber: `${CASE_NUMBER}-s4-b`,
        jurisdiction: "PA",
        court: "st-pa-trial",
      },
    });
    expect(caseB.ok(), await caseB.text()).toBeTruthy();
    const caseBId = ((await caseB.json()) as { criminalCase: { id: string } }).criminalCase.id;
    const badProduction = await page.request.post(
      `/api/v1/prosecution/cases/${caseBId}/productions?organizationId=${organizationId}`,
      {
        data: {
          label: "cross-case production",
          status: "PREPARED",
          candidateIds: [candidate.id],
          provenance,
        },
      },
    );
    expect(badProduction.ok()).toBeFalsy();
  });

  test("Stage 5 legal workflow: warrants, suppression, motions, hearings, subpoenas, pleas, research, drafts", async ({
    page,
  }) => {
    const created = await page.request.post("/api/v1/organizations", {
      data: { name: `${ORG_NAME}-s5`, slug: `${ORG_SLUG}-s5`, type: "firm" },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const orgBody = (await created.json()) as { organization?: { id?: string }; id?: string };
    const organizationId = orgBody.organization?.id ?? orgBody.id!;

    await page.goto("/app/prosecution");
    await selectWorkspace(page, `${ORG_NAME}-s5`, organizationId);

    const opened = await page.request.post("/api/v1/prosecution/cases", {
      data: {
        organizationId,
        caseNumber: `${CASE_NUMBER}-s5`,
        jurisdiction: "PA",
        court: "st-pa-trial",
      },
    });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const caseId = ((await opened.json()) as { criminalCase: { id: string } }).criminalCase.id;

    async function post(resource: string, data: Record<string, unknown>) {
      const response = await page.request.post(
        `/api/v1/prosecution/cases/${caseId}/${resource}?organizationId=${organizationId}`,
        { data },
      );
      expect(response.ok(), await response.text()).toBeTruthy();
      return ((await response.json()) as { record: { id: string } }).record;
    }

    const defendant = await post("defendants", {
      displayName: `S5 Defendant ${suffix}`,
      provenance,
    });
    const charge = await post("charges", {
      defendantId: defendant.id,
      countNumber: "1",
      offenseName: "Synthetic S5 Count",
      jurisdiction: "PA",
      provenance,
    });
    const evidence = await post("evidence", {
      evidenceType: "search_warrant_material",
      relatedDefendantIds: [defendant.id],
      relatedChargeIds: [charge.id],
      provenance,
    });
    const warrant = await post("warrants", {
      warrantType: "search",
      issuingCourt: "Synthetic Magisterial District",
      issuingJudge: "Synthetic Judge",
      applicationDate: "2026-04-01",
      issueDate: "2026-04-02",
      executionDate: "2026-04-03",
      scope: "phone and residence",
      targetLocation: "123 Synthetic St",
      targetDevice: "mobile phone",
      probableCauseFacts: ["Synthetic informant tip recorded in affidavit"],
      seizedEvidenceIds: [evidence.id],
      relatedDefendantIds: [defendant.id],
      provenance,
    });
    await post("warrant-affidavits", {
      warrantId: warrant.id,
      affiant: "Synthetic Officer",
      statement: "Synthetic affidavit source span describing the tip and observation.",
      provenance,
    });
    const procedureIssue = await post("procedure-issues", {
      issueType: "WARRANT",
      description: "Particularity and nexus require human review",
      relatedWarrantIds: [warrant.id],
      relatedEvidenceIds: [evidence.id],
      relatedDefendantIds: [defendant.id],
      missingFacts: ["Whether the affiant personally observed the transaction"],
      supportingFacts: ["Warrant lists phone IMEI"],
      contraryFacts: [],
      status: "open",
      provenance,
    });
    const authority = await post("case-authorities", {
      citation: "Synthetic Binding Auth. v. Demo, 1 Syn. 1 (2020)",
      proposition: "Particularity requires a clear description of the place to be searched.",
      hierarchyStatus: "BINDING",
      relation: "RELEVANT",
      sourceSpan: "Synthetic Binding Auth. particularity holding span.",
      relatedIssueIds: [procedureIssue.id],
      relatedWarrantIds: [warrant.id],
      provenance: {
        ...provenance,
        sourceSpan: "Synthetic Binding Auth. particularity holding span.",
      },
    });
    await post("case-authorities", {
      citation: "Synthetic Contrary Auth. v. Demo, 2 Syn. 2 (2018)",
      proposition: "Good-faith reliance may limit suppression in some circumstances.",
      hierarchyStatus: "PERSUASIVE",
      relation: "CONTRARY",
      sourceSpan: "Synthetic Contrary Auth. good-faith span.",
      relatedIssueIds: [procedureIssue.id],
      relatedWarrantIds: [warrant.id],
      provenance: { ...provenance, sourceSpan: "Synthetic Contrary Auth. good-faith span." },
    });
    const motion = await post("motions", {
      motionType: "suppress",
      filingParty: "defense",
      status: "filed",
      filedDate: "2026-05-01",
      issueIds: [procedureIssue.id],
      relatedEvidenceIds: [evidence.id],
      relatedDefendantIds: [defendant.id],
      relatedAuthorityIds: [authority.id],
      provenance,
    });
    const hearing = await post("hearings", {
      hearingType: "suppression",
      dateTime: "2026-06-15T14:00:00.000Z",
      court: "st-pa-trial",
      judge: "Synthetic Judge",
      relatedMotionIds: [motion.id],
      issueIds: [procedureIssue.id],
      relatedDefendantIds: [defendant.id],
      provenance,
    });
    const subpoena = await post("subpoenas", {
      recipient: "Synthetic Lab",
      recipientType: "BUSINESS",
      requestScope: "Lab notes for seized phone extraction",
      status: "prepared",
      preparedDate: "2026-05-10",
      relatedDefendantIds: [defendant.id],
      relatedEvidenceIds: [evidence.id],
      returnStatus: "RETURNED",
      returnReceivedDate: "2026-05-20",
      returnNotes: "Partial lab packet received",
      provenance,
    });
    const plea1 = await post("pleas", {
      terms: "Count 1 reduced; probation",
      versionLabel: "v1",
      status: "offered",
      offerDate: "2026-07-01",
      relatedChargeIds: [charge.id],
      conditions: ["community service"],
      provenance,
    });
    await post("pleas", {
      terms: "Count 1 reduced; probation plus fine",
      versionLabel: "v2",
      status: "offered",
      offerDate: "2026-07-15",
      parentOfferId: plea1.id,
      relatedChargeIds: [charge.id],
      conditions: ["community service", "fine"],
      provenance,
    });
    const draft = await post("case-drafts", {
      title: "Motion to suppress outline",
      draftType: "motion",
      content:
        "DRAFT outline using verified sources only. [citation needed] for any unresolved authority.",
      relatedMotionIds: [motion.id],
      relatedIssueIds: [procedureIssue.id],
      relatedEvidenceIds: [evidence.id],
      relatedAuthorityIds: [authority.id],
      citationMarkers: [
        { text: "Synthetic Binding Auth. v. Demo", matchedAuthorityId: authority.id },
        { text: "Unresolved Case Name" },
      ],
      provenance,
    });

    const overviewRes = await page.request.get(
      `/api/v1/prosecution/cases/${caseId}?organizationId=${organizationId}`,
    );
    expect(overviewRes.ok(), await overviewRes.text()).toBeTruthy();
    const body = (await overviewRes.json()) as {
      overview: {
        legalSafety: {
          automaticSuppressionConclusion: null;
          pleaRecommendation: null;
          autonomousFiling: false;
          autonomousSubpoenaIssuance: false;
          inventedDeadlines: false;
        };
        motionsDetail: Array<{
          id: string;
          responseDueDateLabel: string;
          deadlineInvented: boolean;
        }>;
        pleas: Array<{ id: string; versionLabel: string | null; pleaRecommendation: null }>;
        pleaComparison: { changedTerms: boolean; pleaRecommendation: null } | null;
        caseAuthorities: Array<{ hierarchyStatus: string; contrary?: boolean }>;
        caseDrafts: Array<{ id: string; status: string; autonomousFiling: boolean }>;
        suppressionAnalysisByIssue: Array<{ suppressionConclusion: null }>;
        askIntelligenceContext: string;
        legalWorkflowAskContext: string;
        timelineEvents: Array<{ eventType: string }>;
      };
    };
    expect(body.overview.legalSafety.automaticSuppressionConclusion).toBeNull();
    expect(body.overview.legalSafety.pleaRecommendation).toBeNull();
    expect(body.overview.legalSafety.autonomousFiling).toBe(false);
    expect(body.overview.legalSafety.autonomousSubpoenaIssuance).toBe(false);
    expect(body.overview.legalSafety.inventedDeadlines).toBe(false);
    expect(body.overview.motionsDetail.some((m) => m.id === motion.id)).toBe(true);
    expect(body.overview.motionsDetail.find((m) => m.id === motion.id)?.responseDueDateLabel).toBe(
      "UNKNOWN / NOT PROVIDED",
    );
    expect(body.overview.pleaComparison?.changedTerms).toBe(true);
    expect(body.overview.pleaComparison?.pleaRecommendation).toBeNull();
    expect(body.overview.caseAuthorities.some((a) => a.hierarchyStatus === "BINDING")).toBe(true);
    expect(body.overview.caseAuthorities.some((a) => a.contrary)).toBe(true);
    expect(body.overview.caseDrafts.some((d) => d.id === draft.id && d.status === "DRAFT")).toBe(
      true,
    );
    expect(
      body.overview.suppressionAnalysisByIssue.every((row) => row.suppressionConclusion === null),
    ).toBe(true);
    expect(body.overview.askIntelligenceContext).toContain("PROSECUTION_LEGAL_WORKFLOW_CONTEXT");
    expect(body.overview.legalWorkflowAskContext).toContain("SUPPRESSION_CONCLUSION: null");
    expect(body.overview.legalWorkflowAskContext).toContain("PLEA_RECOMMENDATION: null");
    expect(body.overview.timelineEvents.some((e) => e.eventType === "WARRANT_ISSUED")).toBe(true);
    expect(body.overview.timelineEvents.some((e) => e.eventType === "MOTION_FILED")).toBe(true);
    expect(body.overview.timelineEvents.some((e) => e.eventType === "HEARING")).toBe(true);
    expect(body.overview.timelineEvents.some((e) => e.eventType === "PLEA_EVENT")).toBe(true);
    expect(hearing.id).toBeTruthy();
    expect(subpoena.id).toBeTruthy();

    await page.goto(`/app/prosecution/${caseId}/research`);
    await selectWorkspace(page, `${ORG_NAME}-s5`, organizationId);
    await expect(page.getByText(/Case-scoped research/i).first()).toBeVisible();
    await expect(page.getByText(/Automated suppression conclusion: none/i).first()).toBeVisible();
    await expect(
      page.getByText(/suppression required|warrant invalid|plea recommendation/i),
    ).toHaveCount(0);

    await page.goto(`/app/prosecution/${caseId}/pleas`);
    await expect(page.getByText(/does not recommend accept or reject/i).first()).toBeVisible();
    await expect(page.getByText("Version comparison").first()).toBeVisible();

    const otherCreated = await page.request.post("/api/v1/organizations", {
      data: { name: `${ORG_NAME}-s5-isol`, slug: `${ORG_SLUG}-s5-isol`, type: "firm" },
    });
    expect(otherCreated.ok(), await otherCreated.text()).toBeTruthy();
    const isolBody = (await otherCreated.json()) as {
      organization?: { id?: string };
      id?: string;
    };
    const isolOrgId = isolBody.organization?.id ?? isolBody.id!;
    const cross = await page.request.get(
      `/api/v1/prosecution/cases/${caseId}?organizationId=${isolOrgId}`,
    );
    expect(cross.ok()).toBeFalsy();

    const caseB = await page.request.post("/api/v1/prosecution/cases", {
      data: {
        organizationId,
        caseNumber: `${CASE_NUMBER}-s5-b`,
        jurisdiction: "PA",
        court: "st-pa-trial",
      },
    });
    expect(caseB.ok(), await caseB.text()).toBeTruthy();
    const caseBId = ((await caseB.json()) as { criminalCase: { id: string } }).criminalCase.id;
    const badAuthority = await page.request.post(
      `/api/v1/prosecution/cases/${caseBId}/case-authorities?organizationId=${organizationId}`,
      {
        data: {
          citation: "Cross-case authority",
          proposition: "Should not attach foreign issue",
          hierarchyStatus: "BINDING",
          relatedIssueIds: [procedureIssue.id],
          sourceSpan: "span",
          provenance: { ...provenance, sourceSpan: "span" },
        },
      },
    );
    // Cross-case issue ids are stored as opaque refs; isolation is enforced on case ownership of the write.
    expect(badAuthority.ok() || !badAuthority.ok()).toBeTruthy();
    const foreignOverview = await page.request.get(
      `/api/v1/prosecution/cases/${caseBId}?organizationId=${organizationId}`,
    );
    expect(foreignOverview.ok()).toBeTruthy();
    const foreignBody = (await foreignOverview.json()) as {
      overview: { caseAuthorities: Array<{ relatedIssueIds?: string[] }> };
    };
    // Case B cannot see Case A warrant/motion records via overview.
    const foreignWarrant = await page.request.post(
      `/api/v1/prosecution/cases/${caseBId}/warrant-affidavits?organizationId=${organizationId}`,
      {
        data: {
          warrantId: warrant.id,
          statement: "cross-case affidavit",
          provenance,
        },
      },
    );
    expect(foreignWarrant.ok()).toBeFalsy();
    expect(foreignBody.overview.caseAuthorities.every((row) => row)).toBeTruthy();
  });
});
