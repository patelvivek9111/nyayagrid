/**
 * Deepening Pass 4 — authorized LOCAL live certification.
 * RUN_DB_TESTS=1 DATABASE_URL=postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid
 * Production Neon / CourtListener / Corpus Neon: unused.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { count } from "drizzle-orm";
import {
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  clients,
  documents,
  civilEvidenceItems,
  graphEdges,
  graphNodes,
  matters,
  matterEntities,
  matterMembers,
  memberships,
  users,
  tasks,
  and,
  eq,
} from "@nyayagrid/database";
import { randomUUID } from "node:crypto";
import { AuthorizationError } from "@nyayagrid/permissions";
import {
  answerDiscoveryQuestion,
  createDiscoveryProduction,
  createDiscoveryRequestItem,
  createDiscoveryRequestSet,
  createDiscoveryResponse,
  DiscoveryError,
  formatDiscoveryAnswer,
  linkDiscoveryProductionItem,
  linkDiscoveryResponseProduction,
  listDiscoveryRequestSets,
  loadDiscoveryLedgerReview,
  materializeDiscoveryGraph,
  persistDiscoveryLedgerReview,
  runComplexDiscoveryLedgerFixture,
} from "./index";

const runDbTests = process.env.RUN_DB_TESTS === "1";
const provenance = { extractionOrigin: "human" as const, humanEntered: true };

describe.runIf(runDbTests)("Pass 4 discovery live certification (local DB)", () => {
  const db = createDb(
    process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid",
  );
  const suffix = `d4live_${Date.now().toString(36)}`;
  const ids: Record<string, string> = {};
  const docMap = new Map<string, string>();
  let guestRoleId = "";

  beforeAll(async () => {
    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `d4_owner_${suffix}`,
        email: `d4_owner_${suffix}@example.nyayagrid.local`,
        name: "D4 Owner",
      })
      .returning();
    const [outsider] = await db
      .insert(users)
      .values({
        authSubject: `d4_out_${suffix}`,
        email: `d4_out_${suffix}@example.nyayagrid.local`,
        name: "D4 Outsider",
      })
      .returning();
    const [guest] = await db
      .insert(users)
      .values({
        authSubject: `d4_guest_${suffix}`,
        email: `d4_guest_${suffix}@example.nyayagrid.local`,
        name: "D4 Guest",
      })
      .returning();
    ids.owner = owner!.id;
    ids.outsider = outsider!.id;
    ids.guest = guest!.id;

    const orgA = await createOrganizationWithDefaults(db, {
      name: `D4 Firm ${suffix}`,
      slug: `d4-firm-${suffix}`,
      type: "firm",
      ownerUserId: ids.owner!,
    });
    const orgB = await createOrganizationWithDefaults(db, {
      name: `D4 Other ${suffix}`,
      slug: `d4-other-${suffix}`,
      type: "firm",
      ownerUserId: ids.outsider!,
    });
    ids.orgA = orgA.organization.id;
    ids.orgB = orgB.organization.id;
    guestRoleId = orgA.roleIdByKey.get("client_guest")!;

    await db.insert(memberships).values({
      organizationId: ids.orgA!,
      userId: ids.guest!,
      roleId: guestRoleId,
      status: "active",
    });

    const [clientA] = await db
      .insert(clients)
      .values({
        organizationId: ids.orgA!,
        displayName: "River Co Client",
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
        title: `River v Acme Discovery ${suffix}`,
        matterNumber: `D4-${suffix}`,
        status: "open",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [matterB] = await db
      .insert(matters)
      .values({
        organizationId: ids.orgB!,
        clientId: clientB!.id,
        title: `Foreign Matter ${suffix}`,
        matterNumber: `D4F-${suffix}`,
        status: "open",
        createdByUserId: ids.outsider!,
      })
      .returning();
    ids.matterA = matterA!.id;
    ids.matterB = matterB!.id;

    await db.insert(matterMembers).values([
      {
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        userId: ids.owner!,
        access: "manage",
      },
      {
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        userId: ids.guest!,
        access: "read",
      },
      {
        organizationId: ids.orgB!,
        matterId: ids.matterB!,
        userId: ids.outsider!,
        access: "manage",
      },
    ]);

    async function entity(
      matterId: string,
      organizationId: string,
      userId: string,
      displayName: string,
      entityType: "organization" | "person" = "organization",
    ) {
      const [row] = await db
        .insert(matterEntities)
        .values({
          organizationId,
          matterId,
          entityType,
          displayName,
          normalizedName: displayName.toLowerCase(),
          status: "approved",
          origin: "manual",
          createdByUserId: userId,
        })
        .returning();
      return row!.id;
    }

    ids.river = await entity(ids.matterA!, ids.orgA!, ids.owner!, "River Co.");
    ids.acme = await entity(ids.matterA!, ids.orgA!, ids.owner!, "Acme LLC");
    ids.custodian = await entity(
      ids.matterA!,
      ids.orgA!,
      ids.owner!,
      "Jordan Lee",
      "person",
    );
    ids.foreignEntity = await entity(ids.matterB!, ids.orgB!, ids.outsider!, "Foreign Party");

    async function doc(matterId: string, organizationId: string, userId: string, title: string) {
      const [row] = await db
        .insert(documents)
        .values({
          organizationId,
          matterId,
          title,
          createdByUserId: userId,
        })
        .returning();
      return row!.id;
    }

    const fixtureDocKeys = [
      "doc-rfp-1",
      "doc-rog-1",
      "doc-acme-responses",
      "doc-prod-cover-1",
      "doc-prod-cover-2",
      "doc-notice-email",
      "doc-notice-followup",
      "doc-counsel-email",
      "doc-privilege-log",
      "doc-mac-letter",
      "doc-motion-compel",
      "doc-invoice-index",
    ];
    for (const key of fixtureDocKeys) {
      docMap.set(key, await doc(ids.matterA!, ids.orgA!, ids.owner!, `${key} ${suffix}`));
    }
    ids.docB = await doc(ids.matterB!, ids.orgB!, ids.outsider!, `Foreign Doc ${suffix}`);

    const [evidence] = await db
      .insert(civilEvidenceItems)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        label: `Notice evidence ${suffix}`,
        documentId: docMap.get("doc-notice-email")!,
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
        label: `Foreign evidence ${suffix}`,
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
        title: `D4 meet-and-confer task ${suffix}`,
        status: "open",
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.task = task!.id;

    // Foreign request set/item/production for isolation tests
    const foreignSet = await createDiscoveryRequestSet(db, {
      userId: ids.outsider!,
      organizationId: ids.orgB!,
      matterId: ids.matterB!,
      label: "Foreign RFP",
      discoveryType: "REQUEST_FOR_PRODUCTION",
      requestingPartyEntityId: ids.foreignEntity!,
      respondingPartyEntityId: ids.foreignEntity!,
      provenance,
    });
    ids.foreignSet = foreignSet.id;
    const foreignItem = await createDiscoveryRequestItem(db, {
      userId: ids.outsider!,
      organizationId: ids.orgB!,
      matterId: ids.matterB!,
      setId: foreignSet.id,
      requestNumber: "FOREIGN-1",
      title: "Foreign request",
      requestText: "Foreign text",
      status: "OPEN",
      requestingPartyEntityId: ids.foreignEntity!,
      respondingPartyEntityId: ids.foreignEntity!,
      provenance,
    });
    ids.foreignItem = foreignItem.id;
    const foreignProduction = await createDiscoveryProduction(db, {
      userId: ids.outsider!,
      organizationId: ids.orgB!,
      matterId: ids.matterB!,
      label: "Foreign production",
      producingPartyEntityId: ids.foreignEntity!,
      receivingPartyEntityId: ids.foreignEntity!,
      provenance,
    });
    ids.foreignProduction = foreignProduction.id;
  }, 90_000);

  afterAll(async () => {
    await closeDb(db);
  });

  function remapFixture() {
    const { review } = runComplexDiscoveryLedgerFixture();
    const partyMap: Record<string, string> = {
      "party-river": ids.river!,
      "party-acme": ids.acme!,
      "custodian-jordan": ids.custodian!,
    };
    const motionId = randomUUID();
    const communicationId = randomUUID();
    const mapDoc = (id: string | null | undefined) =>
      id ? docMap.get(id) ?? (id.startsWith("doc-") ? docMap.values().next().value! : id) : null;
    const mapParty = (id: string) => partyMap[id] ?? id;
    const mapOpaqueUuid = (id: string | null | undefined) => {
      if (!id) return null;
      if (id === "motion-compel-1") return motionId;
      if (id === "comm-mac-letter") return communicationId;
      if (/^[0-9a-f-]{36}$/i.test(id)) return id;
      return null;
    };

    return {
      ...review,
      matterId: ids.matterA!,
      organizationId: ids.orgA!,
      parties: [
        { partyId: ids.river!, displayName: "River Co." },
        { partyId: ids.acme!, displayName: "Acme LLC" },
      ],
      requestSets: review.requestSets.map((set) => ({
        ...set,
        requestingPartyId: mapParty(set.requestingPartyId),
        respondingPartyId: mapParty(set.respondingPartyId),
        sourceDocumentId: mapDoc(set.sourceDocumentId),
        provenance: {
          ...set.provenance,
          documentId: mapDoc(set.provenance.documentId),
        },
      })),
      items: review.items.map((item) => ({
        ...item,
        requestingPartyId: mapParty(item.requestingPartyId),
        respondingPartyId: mapParty(item.respondingPartyId),
        provenance: {
          ...item.provenance,
          documentId: mapDoc(item.provenance.documentId),
        },
      })),
      responses: review.responses.map((response) => ({
        ...response,
        sourceDocumentId: mapDoc(response.sourceDocumentId),
        provenance: {
          ...response.provenance,
          documentId: mapDoc(response.provenance.documentId),
        },
      })),
      objections: review.objections.map((objection) => ({
        ...objection,
        provenance: {
          ...objection.provenance,
          documentId: mapDoc(objection.provenance.documentId),
        },
      })),
      productions: review.productions.map((production) => ({
        ...production,
        producingPartyId: mapParty(production.producingPartyId),
        receivingPartyId: mapParty(production.receivingPartyId),
        transmittalDocumentId: mapDoc(production.transmittalDocumentId),
        documentIds: production.documentIds.map((d) => mapDoc(d)!).filter(Boolean),
        evidenceIds: production.evidenceIds.map(() => ids.evidence!),
        custodianIds: production.custodianIds.map((c) => mapParty(c)),
        provenance: {
          ...production.provenance,
          documentId: mapDoc(production.provenance.documentId),
        },
        batesRanges: production.batesRanges.map((range) => ({
          ...range,
          provenance: {
            ...range.provenance,
            documentId: mapDoc(range.provenance.documentId),
          },
        })),
      })),
      deficiencies: review.deficiencies.map((deficiency) => ({
        ...deficiency,
        responsiblePartyId: deficiency.responsiblePartyId
          ? mapParty(deficiency.responsiblePartyId)
          : null,
        communicationId: mapOpaqueUuid(deficiency.communicationId),
        meetAndConferId: null,
        motionId: mapOpaqueUuid(deficiency.motionId),
        provenance: {
          ...deficiency.provenance,
          documentId: mapDoc(deficiency.provenance.documentId),
        },
      })),
      privilegeAssertions: review.privilegeAssertions.map((privilege) => ({
        ...privilege,
        assertingPartyId: mapParty(privilege.assertingPartyId),
        documentId: mapDoc(privilege.documentId),
        privilegeLogDocumentId: mapDoc(privilege.privilegeLogDocumentId),
        provenance: {
          ...privilege.provenance,
          documentId: mapDoc(privilege.provenance.documentId),
        },
      })),
      meetAndConferIssues: review.meetAndConferIssues.map((mac) => ({
        ...mac,
        communicationId: mapOpaqueUuid(mac.communicationId),
        provenance: {
          ...mac.provenance,
          documentId: mapDoc(mac.provenance.documentId),
        },
      })),
      motionLinks: review.motionLinks.map((motion) => ({
        ...motion,
        motionId,
        documentId: mapDoc(motion.documentId),
      })),
    };
  }

  it("seeds realistic D4 fixture with full ledger persistence and history", async () => {
    const review = remapFixture();
    const persisted = await persistDiscoveryLedgerReview(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      review,
    });

    expect(persisted.requestSets.length).toBeGreaterThanOrEqual(2);
    expect(persisted.items.some((i) => i.requestNumber === "RFP-12")).toBe(true);
    expect(persisted.items.some((i) => i.requestNumber === "ROG-3")).toBe(true);
    expect(persisted.responses.some((r) => r.isSupplemental)).toBe(true);
    expect(persisted.responses.filter((r) => !r.isSupplemental).length).toBeGreaterThanOrEqual(1);
    expect(persisted.objections.length).toBeGreaterThanOrEqual(1);
    expect(persisted.productions.some((p) => p.isSupplemental)).toBe(true);
    expect(persisted.productions.some((p) => p.batesRanges.some((b) => /ACME000200/.test(b.rawText)))).toBe(
      true,
    );
    expect(persisted.productions.some((p) => p.documentIds.length > 0)).toBe(true);
    expect(persisted.productions.some((p) => p.evidenceIds.includes(ids.evidence!))).toBe(true);
    expect(persisted.productions.some((p) => p.custodianIds.includes(ids.custodian!))).toBe(true);
    expect(persisted.deficiencies.some((d) => d.kind === "MISSING_ATTACHMENT")).toBe(true);
    expect(persisted.deficiencies.some((d) => d.kind === "NO_RESPONSE")).toBe(true);
    expect(persisted.privilegeAssertions.some((p) => p.status === "ASSERTED")).toBe(true);
    expect(persisted.meetAndConferIssues.length).toBeGreaterThanOrEqual(1);
    expect(persisted.batesSignals.length).toBeGreaterThanOrEqual(1);
    expect(persisted.sanctionsConclusion).toBeNull();
    expect(persisted.privilegeLegalConclusion).toBeNull();

    // History preserved: item with supplemental response keeps prior response
    const rfp12 = persisted.items.find((i) => i.requestNumber === "RFP-12")!;
    const history = persisted.responses.filter((r) => r.itemId === rfp12.id);
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history.some((r) => r.isSupplemental)).toBe(true);
    expect(history.some((r) => !r.isSupplemental)).toBe(true);

    // Canonical reuse: document/evidence counts for matter not duplicated by ledger tables
    const [docCount] = await db
      .select({ n: count() })
      .from(documents)
      .where(and(eq(documents.matterId, ids.matterA!), eq(documents.organizationId, ids.orgA!)));
    expect(Number(docCount!.n)).toBe(docMap.size);
  });

  it("enforces security isolation matrix", async () => {
    await expect(
      listDiscoveryRequestSets(db, {
        userId: ids.outsider!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      createDiscoveryRequestSet(db, {
        userId: ids.outsider!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        label: "Cross-org mutation",
        discoveryType: "OTHER",
        requestingPartyEntityId: ids.river!,
        respondingPartyEntityId: ids.acme!,
        provenance,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      createDiscoveryRequestSet(db, {
        userId: ids.owner!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        label: "Cross-matter entity",
        discoveryType: "OTHER",
        requestingPartyEntityId: ids.foreignEntity!,
        respondingPartyEntityId: ids.acme!,
        provenance,
      }),
    ).rejects.toMatchObject({ code: "CROSS_MATTER" });

    const sets = await listDiscoveryRequestSets(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
    });
    const localSet = sets[0]!;
    const localItem = await createDiscoveryRequestItem(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      setId: localSet.id,
      requestNumber: "SEC-CHECK-1",
      title: "Security probe item",
      requestText: "probe",
      status: "OPEN",
      requestingPartyEntityId: ids.river!,
      respondingPartyEntityId: ids.acme!,
      provenance,
    });

    await expect(
      createDiscoveryResponse(db, {
        userId: ids.owner!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        itemId: ids.foreignItem!,
        label: "Foreign request response",
        provenance,
      }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/CROSS_|FOREIGN_|NOT_FOUND|INVALID/) });

    const localResponse = await createDiscoveryResponse(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      itemId: localItem.id,
      label: "Local response for foreign production probe",
      provenance,
    });

    await expect(
      linkDiscoveryResponseProduction(db, {
        userId: ids.owner!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        responseId: localResponse.id,
        productionId: ids.foreignProduction!,
      }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/CROSS_|FOREIGN_|NOT_FOUND|INVALID/) });

    const productions = await db.execute(sql`
      SELECT id FROM discovery_productions WHERE matter_id = ${ids.matterA!} LIMIT 1
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
      createDiscoveryRequestSet(db, {
        userId: ids.owner!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        label: "Foreign motion set",
        discoveryType: "OTHER",
        requestingPartyEntityId: ids.river!,
        respondingPartyEntityId: ids.acme!,
        sourceDocumentId: ids.docB!,
        provenance,
      }),
    ).rejects.toMatchObject({ code: "CROSS_ORG" });

    // Privilege isolation: outsider cannot read privilege assertions
    await expect(
      loadDiscoveryLedgerReview(db, {
        userId: ids.outsider!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    // client_guest mutation denied
    await expect(
      createDiscoveryRequestSet(db, {
        userId: ids.guest!,
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        label: "Guest mutation",
        discoveryType: "OTHER",
        requestingPartyEntityId: ids.river!,
        respondingPartyEntityId: ids.acme!,
        provenance,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    void DiscoveryError;
  });

  it("materializes discovery graph idempotently with canonical reuse", async () => {
    const first = await materializeDiscoveryGraph({
      db,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      userId: ids.owner!,
    });
    expect(first.nodesUpserted).toBeGreaterThan(0);
    expect(first.plan.nodes.some((n) => n.nodeType === "discovery_request_set")).toBe(true);
    expect(first.plan.nodes.some((n) => n.nodeType === "discovery_request_item")).toBe(true);
    expect(first.plan.nodes.some((n) => n.nodeType === "discovery_response")).toBe(true);
    expect(first.plan.nodes.some((n) => n.nodeType === "discovery_production")).toBe(true);
    expect(first.plan.nodes.some((n) => n.nodeType === "discovery_deficiency")).toBe(true);
    expect(first.plan.nodes.some((n) => n.nodeType === "privilege_assertion")).toBe(true);
    expect(first.plan.nodes.some((n) => n.nodeType === "document")).toBe(true);
    expect(first.plan.edges.length).toBeGreaterThan(0);

    const [nodeCount1] = await db
      .select({ n: count() })
      .from(graphNodes)
      .where(eq(graphNodes.matterId, ids.matterA!));
    const [edgeCount1] = await db
      .select({ n: count() })
      .from(graphEdges)
      .where(eq(graphEdges.matterId, ids.matterA!));

    const second = await materializeDiscoveryGraph({
      db,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      userId: ids.owner!,
    });
    expect(second.nodesUpserted).toBe(first.nodesUpserted);
    expect(second.edgesMerged + second.edgesCreated).toBeGreaterThan(0);

    const [nodeCount2] = await db
      .select({ n: count() })
      .from(graphNodes)
      .where(eq(graphNodes.matterId, ids.matterA!));
    const [edgeCount2] = await db
      .select({ n: count() })
      .from(graphEdges)
      .where(eq(graphEdges.matterId, ids.matterA!));
    expect(Number(nodeCount2!.n)).toBe(Number(nodeCount1!.n));
    expect(Number(edgeCount2!.n)).toBe(Number(edgeCount1!.n));

    // Cross-matter: foreign matter materialization must not create edges into matter A nodes
    await materializeDiscoveryGraph({
      db,
      organizationId: ids.orgB!,
      matterId: ids.matterB!,
      userId: ids.outsider!,
    });
    const cross = await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM graph_edges e
      JOIN graph_nodes f ON f.id = e.from_node_id
      JOIN graph_nodes t ON t.id = e.to_node_id
      WHERE e.matter_id = ${ids.matterA!}
        AND (f.matter_id <> ${ids.matterA!} OR t.matter_id <> ${ids.matterA!})
    `);
    expect((cross as unknown as Array<{ n: number }>)[0]?.n ?? 0).toBe(0);
  });

  it("answers discovery Ask questions from persisted matter-scoped data without legal conclusions", async () => {
    const review = await loadDiscoveryLedgerReview(db, {
      userId: ids.owner!,
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
    });

    const questions = [
      "Which discovery requests are still unanswered?",
      "What is the response history for RFP-12?",
      "Which requests have objections without substantive production?",
      "What productions are linked for cure-notice communications?",
      "What Bates ranges were produced on September 18?",
      "What changed in the supplemental production?",
      "What open deficiencies remain?",
      "What meet-and-confer and motion-to-compel relationships are tracked?",
      "Which claim-related evidence is still missing requested production?",
    ];

    for (const question of questions) {
      const answer = answerDiscoveryQuestion({ review, question });
      const text = formatDiscoveryAnswer(answer);
      expect(answer.sanctionsConclusion).toBeNull();
      expect(answer.privilegeLegalConclusion).toBeNull();
      expect(text).not.toMatch(/\bimpose sanctions\b|\bthe document is privileged\b|\bwill win\b/i);
      expect(answer.limitations.length).toBeGreaterThan(0);
    }

    const unanswered = answerDiscoveryQuestion({
      review,
      question: "Which discovery requests are still unanswered?",
    });
    expect(unanswered.items.some((i) => /ROG-3/i.test(i.requestNumber))).toBe(true);

    const bates = answerDiscoveryQuestion({
      review,
      question: "What Bates ranges were produced on September 18?",
    });
    expect(bates.productions.some((p) => p.bates.some((b) => /ACME000200/.test(b)))).toBe(true);

    const objections = answerDiscoveryQuestion({
      review,
      question: "Which requests have objections without substantive production?",
    });
    expect(objections.items.some((i) => /RFP-14/i.test(i.requestNumber))).toBe(true);

    const supplements = answerDiscoveryQuestion({
      review,
      question: "What changed in the supplemental production?",
    });
    expect(supplements.productions.some((p) => /supplement/i.test(p.label))).toBe(true);
  });
});
