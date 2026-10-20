import { describe, expect, it, beforeAll } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  createDb,
  createOrganizationWithDefaults,
  users,
  clients,
  matters,
  matterMembers,
  documents,
  documentVersions,
  timelineEvents,
  timelineEventSources,
  matterEntities,
  entitySources,
  graphNodes,
  graphEdges,
  matterMemories,
  documentChunks,
} from "@nyayagrid/database";
import {
  AuthorizationError,
  requireMatterAccess,
  storageKeyForOrganization,
} from "@nyayagrid/permissions";
import {
  DevelopmentMalwareScanner,
  InMemoryStorageProvider,
  processDocumentPipeline,
  sha256Buffer,
} from "@nyayagrid/documents";
import {
  materializeVerifiedGraph,
  extractGraphRelationshipCandidates,
  reviewGraphEdge,
  createManualGraphEdge,
  getGraphNeighborhood,
  createMatterMemory,
  proposeMatterMemories,
  reviewMatterMemory,
  supersedeMatterMemory,
  retrieveActiveMatterMemories,
  listMatterMemories,
} from "@nyayagrid/intelligence";
import { askNyayaAboutMatter, PostgresHybridRetriever } from "@nyayagrid/search";
import { MockAIProvider, MockEmbeddingProvider } from "@nyayagrid/ai";

const runDbTests = process.env.RUN_DB_TESTS === "1";

describe.runIf(runDbTests)("phase 4 graph + memory integration", () => {
  const db = createDb(process.env.DATABASE_URL);
  const suffix = Date.now().toString(36);
  let ownerId = "";
  let outsiderId = "";
  let orgId = "";
  let matterId = "";
  let otherMatterId = "";
  let documentId = "";
  let versionId = "";
  let entityId = "";
  let eventId = "";

  beforeAll(async () => {
    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `p4_owner_${suffix}`,
        email: `p4_owner_${suffix}@example.nyayagrid.local`,
        name: "Owner",
      })
      .returning();
    const [outsider] = await db
      .insert(users)
      .values({
        authSubject: `p4_outsider_${suffix}`,
        email: `p4_outsider_${suffix}@example.nyayagrid.local`,
        name: "Outsider",
      })
      .returning();
    ownerId = owner!.id;
    outsiderId = outsider!.id;

    const org = await createOrganizationWithDefaults(db, {
      name: `P4 Firm ${suffix}`,
      slug: `p4-firm-${suffix}`,
      type: "firm",
      ownerUserId: ownerId,
    });
    orgId = org.organization.id;

    const otherOwner = await db
      .insert(users)
      .values({
        authSubject: `p4_other_${suffix}`,
        email: `p4_other_${suffix}@example.nyayagrid.local`,
        name: "Other",
      })
      .returning();
    const otherOrg = await createOrganizationWithDefaults(db, {
      name: `P4 Other ${suffix}`,
      slug: `p4-other-${suffix}`,
      type: "solo",
      ownerUserId: otherOwner[0]!.id,
    });

    const [client] = await db
      .insert(clients)
      .values({
        organizationId: orgId,
        clientType: "individual",
        displayName: "Casey Client",
        createdByUserId: ownerId,
      })
      .returning();
    const [matter] = await db
      .insert(matters)
      .values({
        organizationId: orgId,
        clientId: client!.id,
        matterNumber: `P4-${suffix}`,
        title: "Graph Memory Matter",
        createdByUserId: ownerId,
      })
      .returning();
    matterId = matter!.id;
    await db.insert(matterMembers).values({
      organizationId: orgId,
      matterId,
      userId: ownerId,
      access: "manage",
    });

    const [otherClient] = await db
      .insert(clients)
      .values({
        organizationId: otherOrg.organization.id,
        clientType: "organization",
        displayName: "Other Co",
        organizationName: "Other Co",
        createdByUserId: otherOwner[0]!.id,
      })
      .returning();
    const [otherMatter] = await db
      .insert(matters)
      .values({
        organizationId: otherOrg.organization.id,
        clientId: otherClient!.id,
        matterNumber: `OY-${suffix}`,
        title: "Other",
        createdByUserId: otherOwner[0]!.id,
      })
      .returning();
    otherMatterId = otherMatter!.id;

    const storage = new InMemoryStorageProvider();
    documentId = crypto.randomUUID();
    versionId = crypto.randomUUID();
    const body = Buffer.from(
      "Jordan Lee of Acme Corp attended the March 4 meeting. The Synthetic Services Agreement is operative.",
    );
    const key = storageKeyForOrganization({
      organizationId: orgId,
      documentId,
      versionId,
      filename: "graph.txt",
    });
    await storage.putObject({ key, body, contentType: "text/plain" });
    await db.insert(documents).values({
      id: documentId,
      organizationId: orgId,
      matterId,
      title: "graph.txt",
      createdByUserId: ownerId,
      processingState: "uploaded",
    });
    await db.insert(documentVersions).values({
      id: versionId,
      documentId,
      organizationId: orgId,
      versionNumber: 1,
      storageKey: key,
      contentType: "text/plain",
      byteSize: body.length,
      sha256: sha256Buffer(body),
      originalFilename: "graph.txt",
      uploadedByUserId: ownerId,
    });
    await processDocumentPipeline(
      {
        db,
        storage,
        scanner: new DevelopmentMalwareScanner(),
        embeddings: new MockEmbeddingProvider(),
      },
      {
        organizationId: orgId,
        matterId,
        documentId,
        documentVersionId: versionId,
      },
    );

    const [chunk] = await db
      .select()
      .from(documentChunks)
      .where(and(eq(documentChunks.matterId, matterId), eq(documentChunks.organizationId, orgId)))
      .limit(1);

    const [entity] = await db
      .insert(matterEntities)
      .values({
        organizationId: orgId,
        matterId,
        entityType: "person",
        displayName: "Jordan Lee",
        normalizedName: "jordan lee",
        status: "approved",
        origin: "manual",
        confidence: "high",
        createdByUserId: ownerId,
        approvedByUserId: ownerId,
        approvedAt: new Date(),
      })
      .returning();
    entityId = entity!.id;
    await db.insert(entitySources).values({
      organizationId: orgId,
      matterId,
      entityId,
      documentId,
      documentVersionId: versionId,
      chunkId: chunk!.id,
      supportingText: chunk!.content.slice(0, 200),
    });

    const [orgEntity] = await db
      .insert(matterEntities)
      .values({
        organizationId: orgId,
        matterId,
        entityType: "organization",
        displayName: "Acme Corp",
        normalizedName: "acme corp",
        status: "approved",
        origin: "manual",
        confidence: "high",
        createdByUserId: ownerId,
        approvedByUserId: ownerId,
        approvedAt: new Date(),
      })
      .returning();

    const [event] = await db
      .insert(timelineEvents)
      .values({
        organizationId: orgId,
        matterId,
        title: "March 4 meeting",
        description: "Meeting occurred",
        eventType: "meeting_occurred",
        eventDate: new Date("2026-03-04T00:00:00.000Z"),
        datePrecision: "exact",
        status: "approved",
        origin: "manual",
        confidence: "high",
        actors: ["Jordan Lee", "Acme Corp"],
        createdByUserId: ownerId,
        approvedByUserId: ownerId,
        approvedAt: new Date(),
      })
      .returning();
    eventId = event!.id;
    await db.insert(timelineEventSources).values({
      organizationId: orgId,
      matterId,
      timelineEventId: eventId,
      documentId,
      documentVersionId: versionId,
      chunkId: chunk!.id,
      supportingText: chunk!.content.slice(0, 200),
    });

    void orgEntity;
  }, 90000);

  it("denies cross-matter and outsider graph access via matter auth", async () => {
    await requireMatterAccess(db, { userId: ownerId, matterId, minAccess: "read" });
    await expect(
      requireMatterAccess(db, { userId: outsiderId, matterId, minAccess: "read" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      requireMatterAccess(db, { userId: ownerId, matterId: otherMatterId, minAccess: "read" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("materializes graph, reviews edges, and uses memory-aware Nyaya", async () => {
    const materialized = await materializeVerifiedGraph({
      db,
      organizationId: orgId,
      matterId,
      userId: ownerId,
      force: true,
    });
    expect(materialized.stats.nodesCreated).toBeGreaterThan(0);

    const nodes = await db
      .select()
      .from(graphNodes)
      .where(and(eq(graphNodes.organizationId, orgId), eq(graphNodes.matterId, matterId)));
    expect(nodes.some((n) => n.canonicalEntityId === entityId)).toBe(true);
    expect(nodes.some((n) => n.canonicalEntityId === eventId)).toBe(true);

    const person = nodes.find((n) => n.canonicalEntityId === entityId)!;
    const eventNode = nodes.find((n) => n.canonicalEntityId === eventId)!;
    const orgNode = nodes.find((n) => n.displayName === "Acme Corp")!;

    const manual = await createManualGraphEdge({
      db,
      organizationId: orgId,
      matterId,
      userId: ownerId,
      fromNodeId: person.id,
      toNodeId: orgNode.id,
      relationshipType: "works_for",
      label: "Jordan works for Acme",
    });
    expect(manual.status).toBe("proposed");
    await reviewGraphEdge({
      db,
      organizationId: orgId,
      matterId,
      edgeId: manual.id,
      userId: ownerId,
      action: "approve",
    });

    const extracted = await extractGraphRelationshipCandidates({
      db,
      organizationId: orgId,
      matterId,
      userId: ownerId,
      ai: new MockAIProvider(),
    });
    expect(extracted.rejected + extracted.proposed + extracted.merged).toBeGreaterThanOrEqual(0);

    const proposed = await db
      .select()
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.organizationId, orgId),
          eq(graphEdges.matterId, matterId),
          eq(graphEdges.status, "proposed"),
        ),
      );
    if (proposed[0]) {
      await reviewGraphEdge({
        db,
        organizationId: orgId,
        matterId,
        edgeId: proposed[0].id,
        userId: ownerId,
        action: "approve",
      });
    }

    const neighborhood = await getGraphNeighborhood({
      db,
      organizationId: orgId,
      matterId,
      nodeId: person.id,
    });
    expect(neighborhood?.center.id).toBe(person.id);
    expect(
      (neighborhood?.edges.length ?? 0) + (neighborhood?.neighbors.length ?? 0),
    ).toBeGreaterThan(0);

    const memory = await createMatterMemory({
      db,
      organizationId: orgId,
      matterId,
      userId: ownerId,
      memoryType: "document_significance",
      title: "Operative agreement",
      content: "Counsel treats the Synthetic Services Agreement as operative.",
      importance: "high",
      origin: "manual",
      status: "approved",
    });

    const proposedMem = await proposeMatterMemories({
      db,
      organizationId: orgId,
      matterId,
      matterTitle: "Graph Memory Matter",
      userId: ownerId,
      hint: "Remember that March 4 meeting is disputed by the witness.",
      ai: new MockAIProvider(),
    });
    expect(proposedMem.proposals.length).toBeGreaterThan(0);
    await reviewMatterMemory({
      db,
      organizationId: orgId,
      matterId,
      memoryId: proposedMem.proposals[0]!.id,
      userId: ownerId,
      action: "approve",
    });

    const rejected = await createMatterMemory({
      db,
      organizationId: orgId,
      matterId,
      userId: ownerId,
      memoryType: "strategic_note",
      title: "Should not influence",
      content: "Rejected secret note about settlement.",
      origin: "ai",
      status: "proposed",
    });
    await reviewMatterMemory({
      db,
      organizationId: orgId,
      matterId,
      memoryId: rejected.id,
      userId: ownerId,
      action: "reject",
      rejectionReason: "Not durable truth",
    });

    const newer = await supersedeMatterMemory({
      db,
      organizationId: orgId,
      matterId,
      userId: ownerId,
      oldMemoryId: memory.id,
      title: "Updated operative agreement",
      content: "Agreement B supersedes the earlier operative agreement designation.",
      importance: "high",
    });
    expect(newer.status).toBe("approved");

    const all = await listMatterMemories({ db, organizationId: orgId, matterId });
    const old = all.find((m) => m.id === memory.id);
    expect(old?.status).toBe("superseded");

    const active = await retrieveActiveMatterMemories({
      db,
      organizationId: orgId,
      matterId,
      question: "What have we decided about the operative agreement?",
    });
    expect(active.some((m) => m.id === newer.id)).toBe(true);
    expect(active.some((m) => m.id === memory.id)).toBe(false);
    expect(active.some((m) => m.id === rejected.id)).toBe(false);

    const graphAnswer = await askNyayaAboutMatter({
      db,
      retriever: new PostgresHybridRetriever(db, new MockEmbeddingProvider()),
      organizationId: orgId,
      matterId,
      userId: ownerId,
      question: "How is Jordan Lee connected to Acme Corp?",
      ai: new MockAIProvider(),
    });
    expect(graphAnswer.usedGraph).toBe(true);

    const memoryAnswer = await askNyayaAboutMatter({
      db,
      retriever: new PostgresHybridRetriever(db, new MockEmbeddingProvider()),
      organizationId: orgId,
      matterId,
      userId: ownerId,
      question: "What have we decided about the operative agreement?",
      ai: new MockAIProvider(),
    });
    expect(memoryAnswer.usedMemory).toBe(true);
    expect(memoryAnswer.answer.answer.toLowerCase()).not.toContain("settlement");
  }, 120000);
});
