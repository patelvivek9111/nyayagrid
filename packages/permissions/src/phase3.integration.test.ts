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
  matterFacts,
  matterEntities,
  deadlineCandidates,
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
  extractMatterIntelligenceForDocument,
  reviewTimelineEvent,
  reviewMatterFact,
  reviewMatterEntity,
  reviewDeadlineCandidate,
  createManualTimelineEvent,
  mergeMatterEntities,
  listTimelineEvents,
  loadVerifiedMatterIntelligence,
  resolveValidatedSources,
} from "@nyayagrid/intelligence";
import { askNyayaAboutMatter, PostgresHybridRetriever } from "@nyayagrid/search";
import { MockAIProvider, MockEmbeddingProvider } from "@nyayagrid/ai";

const runDbTests = process.env.RUN_DB_TESTS === "1";

describe.runIf(runDbTests)("phase 3 matter intelligence integration", () => {
  const db = createDb(process.env.DATABASE_URL);
  const suffix = Date.now().toString(36);
  let ownerId = "";
  let outsiderId = "";
  let orgId = "";
  let matterId = "";
  let otherMatterId = "";
  let documentId = "";
  let versionId = "";

  beforeAll(async () => {
    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `p3_owner_${suffix}`,
        email: `p3_owner_${suffix}@example.nyayagrid.local`,
        name: "Owner",
      })
      .returning();
    const [outsider] = await db
      .insert(users)
      .values({
        authSubject: `p3_outsider_${suffix}`,
        email: `p3_outsider_${suffix}@example.nyayagrid.local`,
        name: "Outsider",
      })
      .returning();
    ownerId = owner!.id;
    outsiderId = outsider!.id;

    const org = await createOrganizationWithDefaults(db, {
      name: `P3 Firm ${suffix}`,
      slug: `p3-firm-${suffix}`,
      type: "firm",
      ownerUserId: ownerId,
    });
    orgId = org.organization.id;

    const otherOwner = await db
      .insert(users)
      .values({
        authSubject: `p3_other_${suffix}`,
        email: `p3_other_${suffix}@example.nyayagrid.local`,
        name: "Other",
      })
      .returning();
    const otherOrg = await createOrganizationWithDefaults(db, {
      name: `P3 Other ${suffix}`,
      slug: `p3-other-${suffix}`,
      type: "solo",
      ownerUserId: otherOwner[0]!.id,
    });

    const [client] = await db
      .insert(clients)
      .values({
        organizationId: orgId,
        clientType: "individual",
        displayName: "Blake Client",
        createdByUserId: ownerId,
      })
      .returning();

    const [matter] = await db
      .insert(matters)
      .values({
        organizationId: orgId,
        clientId: client!.id,
        matterNumber: `P3-${suffix}`,
        title: "Timeline Matter",
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
        displayName: "Other Client Co",
        organizationName: "Other Client Co",
        createdByUserId: otherOwner[0]!.id,
      })
      .returning();
    const [otherMatter] = await db
      .insert(matters)
      .values({
        organizationId: otherOrg.organization.id,
        clientId: otherClient!.id,
        matterNumber: `OX-${suffix}`,
        title: "Other Matter",
        createdByUserId: otherOwner[0]!.id,
      })
      .returning();
    otherMatterId = otherMatter!.id;
  }, 60000);

  it("isolates timeline access across users and orgs", async () => {
    await requireMatterAccess(db, { userId: ownerId, matterId, minAccess: "read" });
    await expect(
      requireMatterAccess(db, { userId: outsiderId, matterId, minAccess: "read" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      requireMatterAccess(db, { userId: ownerId, matterId: otherMatterId, minAccess: "read" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects hallucinated chunk provenance", () => {
    const sources = resolveValidatedSources({
      organizationId: orgId || "00000000-0000-0000-0000-000000000001",
      matterId: matterId || "00000000-0000-0000-0000-000000000002",
      sourceChunkIds: ["00000000-0000-0000-0000-000000000099"],
      sourceQuotes: ["fake"],
      authorized: new Map(),
    });
    expect(sources).toEqual([]);
  });

  it("extracts, reviews, and answers with verified intelligence", async () => {
    const storage = new InMemoryStorageProvider();
    documentId = crypto.randomUUID();
    versionId = crypto.randomUUID();
    const filename = "timeline-agreement.txt";
    const body = Buffer.from(
      [
        "This Synthetic Services Agreement was signed on March 4, 2026 by Acme Corp and Jordan Lee.",
        "",
        "Payment is due on April 1, 2026.",
        "",
        "Either party may terminate upon thirty days written notice.",
      ].join("\n"),
    );
    const key = storageKeyForOrganization({
      organizationId: orgId,
      documentId,
      versionId,
      filename,
    });
    await storage.putObject({ key, body, contentType: "text/plain" });
    await db.insert(documents).values({
      id: documentId,
      organizationId: orgId,
      matterId,
      title: filename,
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
      originalFilename: filename,
      uploadedByUserId: ownerId,
    });

    const processed = await processDocumentPipeline(
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
    expect(processed.state).toBe("ready");

    const first = await extractMatterIntelligenceForDocument({
      db,
      organizationId: orgId,
      matterId,
      documentId,
      documentVersionId: versionId,
      userId: ownerId,
      ai: new MockAIProvider(),
    });
    expect(first.skipped).toBe(false);

    const second = await extractMatterIntelligenceForDocument({
      db,
      organizationId: orgId,
      matterId,
      documentId,
      documentVersionId: versionId,
      userId: ownerId,
      ai: new MockAIProvider(),
    });
    expect(second.skipped).toBe(true);

    const proposedEvents = await db
      .select()
      .from(timelineEvents)
      .where(and(eq(timelineEvents.organizationId, orgId), eq(timelineEvents.matterId, matterId)));
    expect(proposedEvents.length).toBeGreaterThan(0);

    const [toApprove, toEdit, toReject] = proposedEvents;
    expect(toApprove).toBeTruthy();

    await reviewTimelineEvent({
      db,
      organizationId: orgId,
      matterId,
      eventId: toApprove!.id,
      userId: ownerId,
      action: "approve",
    });
    if (toEdit) {
      await reviewTimelineEvent({
        db,
        organizationId: orgId,
        matterId,
        eventId: toEdit.id,
        userId: ownerId,
        action: "edit_and_approve",
        edits: { title: `${toEdit.title} (edited)` },
      });
    }
    if (toReject) {
      await reviewTimelineEvent({
        db,
        organizationId: orgId,
        matterId,
        eventId: toReject.id,
        userId: ownerId,
        action: "reject",
        rejectionReason: "Not supported by evidence",
      });
    }

    const timeline = await listTimelineEvents({
      db,
      organizationId: orgId,
      matterId,
      includeSources: true,
    });
    expect(
      timeline.every((e) => e.status === "approved" || e.status === "edited_and_approved"),
    ).toBe(true);

    await createManualTimelineEvent({
      db,
      organizationId: orgId,
      matterId,
      userId: ownerId,
      title: "Manual intake call",
      eventType: "meeting_occurred",
      eventDate: "2026-02-01T00:00:00.000Z",
      datePrecision: "exact",
      actors: ["Jordan Lee"],
    });

    const matterFactsRows = await db
      .select()
      .from(matterFacts)
      .where(and(eq(matterFacts.organizationId, orgId), eq(matterFacts.matterId, matterId)));
    if (matterFactsRows[0]) {
      await reviewMatterFact({
        db,
        organizationId: orgId,
        matterId,
        factId: matterFactsRows[0].id,
        userId: ownerId,
        action: "approve",
      });
    }

    const entities = await db
      .select()
      .from(matterEntities)
      .where(
        and(
          eq(matterEntities.organizationId, orgId),
          eq(matterEntities.matterId, matterId),
          eq(matterEntities.status, "proposed"),
        ),
      );
    if (entities[0]) {
      await reviewMatterEntity({
        db,
        organizationId: orgId,
        matterId,
        entityId: entities[0].id,
        userId: ownerId,
        action: "approve",
      });
    }
    if (entities[0] && entities[1]) {
      await mergeMatterEntities({
        db,
        organizationId: orgId,
        matterId,
        userId: ownerId,
        keepEntityId: entities[0].id,
        mergeEntityId: entities[1].id,
      });
    }

    const deadlines = await db
      .select()
      .from(deadlineCandidates)
      .where(
        and(
          eq(deadlineCandidates.organizationId, orgId),
          eq(deadlineCandidates.matterId, matterId),
          eq(deadlineCandidates.status, "proposed"),
        ),
      );
    if (deadlines[0]) {
      await reviewDeadlineCandidate({
        db,
        organizationId: orgId,
        matterId,
        deadlineId: deadlines[0].id,
        userId: ownerId,
        action: "approve",
      });
    }

    const documentId2 = crypto.randomUUID();
    const versionId2 = crypto.randomUUID();
    const body2 = Buffer.from(
      "The parties signed the contract on March 4. Acme Corp confirmed payment is due on April 1, 2026.",
    );
    const key2 = storageKeyForOrganization({
      organizationId: orgId,
      documentId: documentId2,
      versionId: versionId2,
      filename: "confirm.txt",
    });
    await storage.putObject({ key: key2, body: body2, contentType: "text/plain" });
    await db.insert(documents).values({
      id: documentId2,
      organizationId: orgId,
      matterId,
      title: "confirm.txt",
      createdByUserId: ownerId,
      processingState: "uploaded",
    });
    await db.insert(documentVersions).values({
      id: versionId2,
      documentId: documentId2,
      organizationId: orgId,
      versionNumber: 1,
      storageKey: key2,
      contentType: "text/plain",
      byteSize: body2.length,
      sha256: sha256Buffer(body2),
      originalFilename: "confirm.txt",
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
        documentId: documentId2,
        documentVersionId: versionId2,
      },
    );
    await extractMatterIntelligenceForDocument({
      db,
      organizationId: orgId,
      matterId,
      documentId: documentId2,
      documentVersionId: versionId2,
      userId: ownerId,
      ai: new MockAIProvider(),
    });

    const verified = await loadVerifiedMatterIntelligence({
      db,
      organizationId: orgId,
      matterId,
    });
    expect(verified.events.length).toBeGreaterThan(0);

    const approvedTitle = verified.events[0]!.title;
    const answer = await askNyayaAboutMatter({
      db,
      retriever: new PostgresHybridRetriever(db, new MockEmbeddingProvider()),
      organizationId: orgId,
      matterId,
      userId: ownerId,
      question: `What happened before ${approvedTitle}?`,
      ai: new MockAIProvider(),
    });
    expect(answer.usedVerifiedIntelligence).toBe(true);
    expect(answer.answer.answer.toLowerCase()).toMatch(/verified|document|before|event|matter/);
  }, 120000);
});
