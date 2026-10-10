import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  and,
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  clients,
  documents,
  eq,
  isGraphNodeType,
  matters,
  matterEntities,
  matterMembers,
  memberships,
  users,
  civilEvidenceItems,
  matterCommunications,
  tasks,
} from "@nyayagrid/database";
import { AuthorizationError } from "@nyayagrid/permissions";
import {
  createDiscoveryBatesRange,
  createDiscoveryDeficiency,
  createDiscoveryMeetAndConferIssue,
  createDiscoveryObjection,
  createDiscoveryPrivilegeAssertion,
  createDiscoveryProduction,
  createDiscoveryRequestItem,
  createDiscoveryRequestSet,
  createDiscoveryResponse,
  DiscoveryError,
  linkDiscoveryProductionCustodian,
  linkDiscoveryProductionItem,
  linkDiscoveryResponseProduction,
  listDiscoveryRequestSets,
  listDiscoveryResponsesForItem,
  loadDiscoveryLedgerReview,
  persistDiscoveryLedgerReview,
} from "./index";

const runDbTests = process.env.RUN_DB_TESTS === "1";
const provenance = { extractionOrigin: "human" as const, humanEntered: true };

describe.runIf(runDbTests)("discovery production ledger integration", () => {
  const db = createDb(
    process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid",
  );
  const suffix = Date.now().toString(36);
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `disc_owner_${suffix}`,
        email: `disc_owner_${suffix}@example.nyayagrid.local`,
        name: "Discovery Owner",
      })
      .returning();
    const [outsider] = await db
      .insert(users)
      .values({
        authSubject: `disc_out_${suffix}`,
        email: `disc_out_${suffix}@example.nyayagrid.local`,
        name: "Outsider",
      })
      .returning();
    ids.owner = owner!.id;
    ids.outsider = outsider!.id;

    const orgA = await createOrganizationWithDefaults(db, {
      name: `Discovery A ${suffix}`,
      slug: `disc-a-${suffix}`,
      type: "firm",
      ownerUserId: ids.owner!,
    });
    const orgB = await createOrganizationWithDefaults(db, {
      name: `Discovery B ${suffix}`,
      slug: `disc-b-${suffix}`,
      type: "firm",
      ownerUserId: ids.outsider!,
    });
    ids.orgA = orgA.organization.id;
    ids.orgB = orgB.organization.id;

    const [clientA] = await db
      .insert(clients)
      .values({
        organizationId: ids.orgA!,
        displayName: "River Supply",
        clientType: "organization",
        status: "active",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [clientB] = await db
      .insert(clients)
      .values({
        organizationId: ids.orgB!,
        displayName: "Other Client",
        clientType: "organization",
        status: "active",
        createdByUserId: ids.outsider!,
      })
      .returning();

    const [matterA] = await db
      .insert(matters)
      .values({
        organizationId: ids.orgA!,
        clientId: clientA!.id,
        title: `Discovery Matter A ${suffix}`,
        matterNumber: `DISC-A-${suffix}`,
        status: "open",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [matterB] = await db
      .insert(matters)
      .values({
        organizationId: ids.orgB!,
        clientId: clientB!.id,
        title: `Discovery Matter B ${suffix}`,
        matterNumber: `DISC-B-${suffix}`,
        status: "open",
        createdByUserId: ids.outsider!,
      })
      .returning();
    ids.matterA = matterA!.id;
    ids.matterB = matterB!.id;

    await db.insert(matterMembers).values({
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      userId: ids.owner!,
      access: "manage",
    });
    await db.insert(matterMembers).values({
      organizationId: ids.orgB!,
      matterId: ids.matterB!,
      userId: ids.outsider!,
      access: "manage",
    });

    const [plaintiff] = await db
      .insert(matterEntities)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        entityType: "organization",
        displayName: "Plaintiff Co",
        normalizedName: "plaintiff co",
        status: "approved",
        origin: "manual",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [defendant] = await db
      .insert(matterEntities)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        entityType: "organization",
        displayName: "Defendant LLC",
        normalizedName: "defendant llc",
        status: "approved",
        origin: "manual",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [foreignEntity] = await db
      .insert(matterEntities)
      .values({
        organizationId: ids.orgB!,
        matterId: ids.matterB!,
        entityType: "organization",
        displayName: "Foreign Party",
        normalizedName: "foreign party",
        status: "approved",
        origin: "manual",
        createdByUserId: ids.outsider!,
      })
      .returning();
    ids.plaintiff = plaintiff!.id;
    ids.defendant = defendant!.id;
    ids.foreignEntity = foreignEntity!.id;

    const [docA] = await db
      .insert(documents)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        title: `RFP Set ${suffix}`,
        createdByUserId: ids.owner!,
      })
      .returning();
    const [docB] = await db
      .insert(documents)
      .values({
        organizationId: ids.orgB!,
        matterId: ids.matterB!,
        title: `Foreign Doc ${suffix}`,
        createdByUserId: ids.outsider!,
      })
      .returning();
    const [producedDoc] = await db
      .insert(documents)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        title: `Produced Doc ${suffix}`,
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.docA = docA!.id;
    ids.docB = docB!.id;
    ids.producedDoc = producedDoc!.id;

    const [evidence] = await db
      .insert(civilEvidenceItems)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        label: `Evidence ${suffix}`,
        documentId: ids.producedDoc!,
        provenance,
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.evidence = evidence!.id;

    const [foreignEvidence] = await db
      .insert(civilEvidenceItems)
      .values({
        organizationId: ids.orgB!,
        matterId: ids.matterB!,
        label: `Foreign Evidence ${suffix}`,
        documentId: ids.docB!,
        provenance,
        createdByUserId: ids.outsider!,
      })
      .returning();
    ids.foreignEvidence = foreignEvidence!.id;

    const [task] = await db
      .insert(tasks)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        title: `Meet and confer follow-up ${suffix}`,
        status: "open",
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.task = task!.id;
  }, 60_000);

  afterAll(async () => {
    await closeDb(db);
  });

  it("has discovery tables and graph enum values", async () => {
    const tables = await db.execute(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE 'discovery_%'
      ORDER BY table_name
    `);
    const names = (tables as unknown as Array<{ table_name: string }>).map((r) => r.table_name);
    expect(names).toEqual(
      expect.arrayContaining([
        "discovery_request_sets",
        "discovery_request_items",
        "discovery_responses",
        "discovery_objections",
        "discovery_productions",
        "discovery_production_items",
        "discovery_bates_ranges",
        "discovery_deficiencies",
        "discovery_privilege_assertions",
        "discovery_meet_and_confer_issues",
      ]),
    );

    const enums = await db.execute(sql`
      SELECT e.enumlabel
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE t.typname = 'graph_node_type'
      ORDER BY e.enumsortorder
    `);
    const labels = (enums as unknown as Array<{ enumlabel: string }>).map((r) => r.enumlabel);
    expect(labels).toContain("claim");
    expect(labels).toContain("defense");
    expect(labels).toContain("discovery_request_set");
    expect(labels).toContain("privilege_assertion");
    expect(isGraphNodeType("discovery_production")).toBe(true);
  });

  it("persists request sets/items, response history, objections, productions, Bates, deficiencies, privilege, meet-and-confer", async () => {
    const set = await createDiscoveryRequestSet(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      label: "Plaintiff First RFPs",
      discoveryType: "REQUEST_FOR_PRODUCTION",
      requestingPartyEntityId: ids.plaintiff!,
      respondingPartyEntityId: ids.defendant!,
      servedAt: new Date("2026-01-10T00:00:00Z"),
      sourceDocumentId: ids.docA!,
      provenance,
    });
    const item = await createDiscoveryRequestItem(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      setId: set.id,
      requestNumber: "RFP-1",
      title: "All contracts",
      requestText: "Produce all contracts...",
      status: "OPEN",
      requestingPartyEntityId: ids.plaintiff!,
      respondingPartyEntityId: ids.defendant!,
      provenance,
    });

    const initial = await createDiscoveryResponse(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      itemId: item.id,
      label: "Initial response",
      respondedAt: new Date("2026-02-01T00:00:00Z"),
      substantiveText: null,
      provenance,
    });
    await createDiscoveryObjection(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      itemId: item.id,
      responseId: initial.id,
      basis: "overbroad",
      text: "Object as overbroad",
      provenance,
    });
    const supplement = await createDiscoveryResponse(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      itemId: item.id,
      label: "Supplemental response",
      respondedAt: new Date("2026-03-01T00:00:00Z"),
      isSupplemental: true,
      supplementsResponseId: initial.id,
      substantiveText: "Producing documents Bates DEF0001-DEF0010",
      provenance,
    });

    const history = await listDiscoveryResponsesForItem(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      itemId: item.id,
    });
    expect(history).toHaveLength(2);
    expect(history[0]!.id).toBe(initial.id);
    expect(history[1]!.id).toBe(supplement.id);
    expect(history[1]!.isSupplemental).toBe(true);

    const production = await createDiscoveryProduction(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      label: "Production 1",
      producingPartyEntityId: ids.defendant!,
      receivingPartyEntityId: ids.plaintiff!,
      producedAt: new Date("2026-03-01T00:00:00Z"),
      provenance,
    });
    await linkDiscoveryProductionItem(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      productionId: production.id,
      documentId: ids.producedDoc!,
      requestItemId: item.id,
    });
    await linkDiscoveryProductionItem(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      productionId: production.id,
      evidenceId: ids.evidence!,
    });
    await createDiscoveryBatesRange(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      productionId: production.id,
      prefix: "DEF",
      startNumber: 1,
      endNumber: 10,
      rawText: "DEF0001-DEF0010",
      provenance,
    });
    await linkDiscoveryResponseProduction(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      responseId: supplement.id,
      productionId: production.id,
    });
    await linkDiscoveryProductionCustodian(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      productionId: production.id,
      custodianEntityId: ids.defendant!,
    });

    const deficiency = await createDiscoveryDeficiency(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      kind: "PARTIAL_RESPONSE",
      status: "OPEN",
      description: "Missing attachments noted for review",
      itemId: item.id,
      productionId: production.id,
      openedAt: new Date("2026-03-05T00:00:00Z"),
      responsiblePartyEntityId: ids.defendant!,
      provenance,
    });
    await db.insert(matterCommunications).values({
      id: "00000000-0000-4000-8000-0000000000aa",
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      communicationType: "MEET_AND_CONFER",
      direction: "OUTBOUND",
      status: "SENT",
      subject: "March meet and confer letter",
      provenance,
      createdByUserId: ids.owner!,
      updatedByUserId: ids.owner!,
    });
    await createDiscoveryMeetAndConferIssue(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      label: "March meet and confer",
      occurredAt: new Date("2026-03-10T00:00:00Z"),
      deficiencyIds: [deficiency.id],
      taskId: ids.task!,
      communicationId: "00000000-0000-4000-8000-0000000000aa",
      outcomeNotes: "Parties discussing supplemental production",
      provenance,
    });
    await createDiscoveryPrivilegeAssertion(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      status: "ASSERTED",
      assertedBasis: "attorney-client",
      assertingPartyEntityId: ids.defendant!,
      assertedAt: new Date("2026-03-01T00:00:00Z"),
      documentId: ids.producedDoc!,
      productionId: production.id,
      reviewNotes: "Under privilege review",
      courtRulingReferenced: false,
      provenance,
    });

    const review = await loadDiscoveryLedgerReview(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
    });
    expect(review.requestSets.length).toBeGreaterThanOrEqual(1);
    expect(review.items.some((row) => row.requestNumber === "RFP-1")).toBe(true);
    expect(review.responses.length).toBeGreaterThanOrEqual(2);
    expect(review.objections.length).toBeGreaterThanOrEqual(1);
    expect(review.productions.some((row) => row.documentIds.includes(ids.producedDoc!))).toBe(true);
    expect(review.productions.some((row) => row.evidenceIds.includes(ids.evidence!))).toBe(true);
    expect(review.productions.some((row) => row.custodianIds.includes(ids.defendant!))).toBe(true);
    expect(review.productions.some((row) => row.batesRanges.some((b) => b.prefix === "DEF"))).toBe(
      true,
    );
    expect(review.deficiencies.some((row) => row.kind === "PARTIAL_RESPONSE")).toBe(true);
    expect(review.privilegeAssertions.some((row) => row.status === "ASSERTED")).toBe(true);
    expect(review.meetAndConferIssues.some((row) => row.deficiencyIds.length > 0)).toBe(true);
    expect(
      review.meetAndConferIssues.some(
        (row) => row.communicationId === "00000000-0000-4000-8000-0000000000aa",
      ),
    ).toBe(true);
    expect(review.sanctionsConclusion).toBeNull();
    expect(review.privilegeLegalConclusion).toBeNull();
  });

  it("denies cross-org and cross-matter linkage including foreign documents", async () => {
    await expect(
      listDiscoveryRequestSets(db, {
        userId: ids.outsider!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      createDiscoveryRequestSet(db, {
        userId: ids.owner!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        label: "Bad set",
        discoveryType: "INTERROGATORY",
        requestingPartyEntityId: ids.foreignEntity!,
        respondingPartyEntityId: ids.defendant!,
        provenance,
      }),
    ).rejects.toMatchObject({ code: "CROSS_MATTER" });

    const sets = await listDiscoveryRequestSets(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
    });
    const set = sets[0]!;
    await expect(
      createDiscoveryRequestSet(db, {
        userId: ids.owner!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        label: "Foreign doc set",
        discoveryType: "OTHER",
        requestingPartyEntityId: ids.plaintiff!,
        respondingPartyEntityId: ids.defendant!,
        sourceDocumentId: ids.docB!,
        provenance,
      }),
    ).rejects.toMatchObject({ code: "CROSS_ORG" });

    const productions = await db.execute(sql`
      SELECT id FROM discovery_productions
      WHERE matter_id = ${ids.matterA!} LIMIT 1
    `);
    const productionId = (productions as unknown as Array<{ id: string }>)[0]?.id;
    expect(productionId).toBeTruthy();
    await expect(
      linkDiscoveryProductionItem(db, {
        userId: ids.owner!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        productionId: productionId!,
        documentId: ids.docB!,
      }),
    ).rejects.toMatchObject({ code: "CROSS_ORG" });

    await expect(
      linkDiscoveryProductionItem(db, {
        userId: ids.owner!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        productionId: productionId!,
        evidenceId: ids.foreignEvidence!,
      }),
    ).rejects.toMatchObject({ code: "CROSS_MATTER" });

    await expect(
      createDiscoveryDeficiency(db, {
        userId: ids.owner!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        kind: "OTHER",
        motionId: "00000000-0000-4000-8000-000000000099",
        provenance,
      }),
    ).rejects.toMatchObject({ code: "FOREIGN_MOTION" });

    void set;
  });

  it("preserves prior responses when supplements are added via adapter persist/load", async () => {
    const review = await loadDiscoveryLedgerReview(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
    });
    const item = review.items[0]!;
    const priorCount = review.responses.filter((r) => r.itemId === item.id).length;
    expect(priorCount).toBeGreaterThanOrEqual(2);

    const fixtureReview = {
      ...review,
      matterId: ids.matterA!,
      organizationId: ids.orgA!,
      requestSets: [
        {
          id: "fixture-set",
          label: "Fixture ROGs",
          discoveryType: "INTERROGATORY" as const,
          requestingPartyId: ids.plaintiff!,
          respondingPartyId: ids.defendant!,
          servedAt: "2026-04-01T00:00:00.000Z",
          responseDueAt: null,
          isCurrent: true,
          supersededBySetId: null,
          sourceDocumentId: null,
          provenance: {
            documentId: null,
            sourceSpan: null,
            sourcePage: null,
            humanEntered: true,
            extractionOrigin: "deterministic_fixture" as const,
          },
        },
      ],
      items: [
        {
          id: "fixture-item",
          setId: "fixture-set",
          requestNumber: "ROG-1",
          title: "Identify custodians",
          requestText: "Identify all custodians",
          status: "RESPONDED" as const,
          requestingPartyId: ids.plaintiff!,
          respondingPartyId: ids.defendant!,
          servedAt: null,
          responseDueAt: null,
          provenance: {
            documentId: null,
            sourceSpan: null,
            sourcePage: null,
            humanEntered: true,
            extractionOrigin: "deterministic_fixture" as const,
          },
        },
      ],
      responses: [
        {
          id: "fixture-response",
          itemId: "fixture-item",
          label: "ROG answer",
          respondedAt: "2026-04-15T00:00:00.000Z",
          isSupplemental: false,
          supplementsResponseId: null,
          substantiveText: "Custodian: Jane Doe",
          objectionIds: [],
          productionIds: [],
          sourceDocumentId: null,
          provenance: {
            documentId: null,
            sourceSpan: null,
            sourcePage: null,
            humanEntered: true,
            extractionOrigin: "deterministic_fixture" as const,
          },
        },
      ],
      objections: [],
      productions: [],
      deficiencies: [],
      privilegeAssertions: [],
      meetAndConferIssues: [],
      motionLinks: [],
      batesSignals: [],
      coverageWarnings: [],
      sanctionsConclusion: null as null,
      privilegeLegalConclusion: null as null,
      parties: review.parties,
    };

    const persisted = await persistDiscoveryLedgerReview(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      review: fixtureReview,
    });
    expect(persisted.items.some((row) => row.requestNumber === "ROG-1")).toBe(true);
    expect(persisted.responses.some((row) => row.substantiveText?.includes("Jane Doe"))).toBe(true);

    const history = await listDiscoveryResponsesForItem(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      itemId: item.id,
    });
    expect(history.length).toBe(priorCount);
  });

  it("rejects unauthorized mutation", async () => {
    await expect(
      createDiscoveryRequestSet(db, {
        userId: ids.outsider!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        label: "Unauthorized",
        discoveryType: "OTHER",
        requestingPartyEntityId: ids.plaintiff!,
        respondingPartyEntityId: ids.defendant!,
        provenance,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(DiscoveryError).toBeTruthy();
    void memberships;
    void and;
    void eq;
  });
});
