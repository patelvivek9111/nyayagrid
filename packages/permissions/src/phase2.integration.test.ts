import { describe, expect, it, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  createDb,
  createOrganizationWithDefaults,
  users,
  clients,
  matters,
  matterMembers,
  documents,
  documentVersions,
  documentChunks,
  notes,
  tasks,
  aiArtifacts,
} from "@nyayagrid/database";
import {
  AuthorizationError,
  requireCapability,
  requireMatterAccess,
  storageKeyForOrganization,
} from "@nyayagrid/permissions";
import {
  DevelopmentMalwareScanner,
  InMemoryStorageProvider,
  sha256Buffer,
} from "@nyayagrid/documents";
import { processDocumentPipeline } from "@nyayagrid/documents";
import { askNyayaAboutMatter, PostgresHybridRetriever } from "@nyayagrid/search";
import { MockEmbeddingProvider, MockAIProvider } from "@nyayagrid/ai";

const runDbTests = process.env.RUN_DB_TESTS === "1";

describe.runIf(runDbTests)("phase 2 matter workflow integration", () => {
  const db = createDb(process.env.DATABASE_URL);
  const suffix = Date.now().toString(36);
  let ownerId = "";
  let outsiderId = "";
  let orgId = "";
  let otherOrgId = "";
  let clientId = "";
  let matterId = "";
  let documentId = "";
  let versionId = "";

  beforeAll(async () => {
    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `p2_owner_${suffix}`,
        email: `p2_owner_${suffix}@example.nyayagrid.local`,
        name: "Owner",
      })
      .returning();
    const [outsider] = await db
      .insert(users)
      .values({
        authSubject: `p2_outsider_${suffix}`,
        email: `p2_outsider_${suffix}@example.nyayagrid.local`,
        name: "Outsider",
      })
      .returning();
    ownerId = owner!.id;
    outsiderId = outsider!.id;

    const org = await createOrganizationWithDefaults(db, {
      name: `P2 Firm ${suffix}`,
      slug: `p2-firm-${suffix}`,
      type: "firm",
      ownerUserId: ownerId,
    });
    orgId = org.organization.id;

    const otherOwner = await db
      .insert(users)
      .values({
        authSubject: `p2_other_${suffix}`,
        email: `p2_other_${suffix}@example.nyayagrid.local`,
        name: "Other",
      })
      .returning();
    const other = await createOrganizationWithDefaults(db, {
      name: `Other Firm ${suffix}`,
      slug: `other-firm-${suffix}`,
      type: "solo",
      ownerUserId: otherOwner[0]!.id,
    });
    otherOrgId = other.organization.id;

    const [client] = await db
      .insert(clients)
      .values({
        organizationId: orgId,
        clientType: "individual",
        displayName: "Alex Client",
        firstName: "Alex",
        lastName: "Client",
        createdByUserId: ownerId,
      })
      .returning();
    clientId = client!.id;

    const createdMatter = await db.transaction(async (tx) => {
      const [matter] = await tx
        .insert(matters)
        .values({
          organizationId: orgId,
          clientId,
          matterNumber: `M-${suffix}`,
          title: "Synthetic Contract Matter",
          practiceArea: "Contract dispute",
          jurisdiction: "Ontario",
          createdByUserId: ownerId,
        })
        .returning();
      await tx.insert(matterMembers).values({
        organizationId: orgId,
        matterId: matter!.id,
        userId: ownerId,
        access: "manage",
      });
      return matter!;
    });
    matterId = createdMatter.id;
  }, 60000);

  it("enforces client and matter authorization", async () => {
    await requireCapability(db, {
      userId: ownerId,
      organizationId: orgId,
      capability: "clients.view",
    });
    await expect(
      requireCapability(db, {
        userId: outsiderId,
        organizationId: orgId,
        capability: "clients.view",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await requireMatterAccess(db, {
      userId: ownerId,
      matterId,
      minAccess: "read",
    });
    await expect(
      requireMatterAccess(db, {
        userId: outsiderId,
        matterId,
        minAccess: "read",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("uploads, extracts, chunks, embeds, and answers with citations", async () => {
    const storage = new InMemoryStorageProvider();
    documentId = crypto.randomUUID();
    versionId = crypto.randomUUID();
    const filename = "agreement.txt";
    const body = Buffer.from(
      [
        "This Synthetic Services Agreement was signed on January 15, 2024.",
        "",
        "Either party may terminate the agreement upon thirty days written notice.",
        "",
        "Payment is due on the first day of each month.",
      ].join("\n"),
    );
    const key = storageKeyForOrganization({
      organizationId: orgId,
      documentId,
      versionId,
      filename,
    });
    await storage.putObject({
      key,
      body,
      contentType: "text/plain",
    });

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

    const chunks = await db
      .select()
      .from(documentChunks)
      .where(eq(documentChunks.documentId, documentId));
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.organizationId === orgId && c.matterId === matterId)).toBe(true);

    const retriever = new PostgresHybridRetriever(db, new MockEmbeddingProvider());
    const hits = await retriever.search({
      text: "terminate thirty days",
      scope: { organizationId: orgId, matterId, workspace: "professional" },
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.matterId === matterId && h.organizationId === orgId)).toBe(true);

    const leaked = await retriever.search({
      text: "terminate thirty days",
      scope: { organizationId: otherOrgId, matterId, workspace: "professional" },
    });
    expect(leaked).toHaveLength(0);

    const answer = await askNyayaAboutMatter({
      db,
      retriever,
      organizationId: orgId,
      matterId,
      userId: ownerId,
      question: "What does the agreement say about termination?",
      ai: new MockAIProvider(),
    });
    expect(answer.answer.evidenceState).toBe("grounded");
    expect(answer.answer.sources.length).toBeGreaterThan(0);
    expect(answer.artifact?.id).toBeTruthy();

    const insufficient = await askNyayaAboutMatter({
      db,
      retriever,
      organizationId: orgId,
      matterId,
      userId: ownerId,
      question: "What color was the plaintiff's car?",
      ai: new MockAIProvider(),
    });
    expect(insufficient.answer.evidenceState).toBe("insufficient");

    const [note] = await db
      .insert(notes)
      .values({
        organizationId: orgId,
        matterId,
        title: "Saved Nyaya answer",
        content: answer.answer.answer,
        origin: "nyaya",
        aiArtifactId: answer.artifact!.id,
        citations: answer.answer.sources,
        createdByUserId: ownerId,
      })
      .returning();
    expect(note!.origin).toBe("nyaya");

    const [task] = await db
      .insert(tasks)
      .values({
        organizationId: orgId,
        matterId,
        title: "Review termination clause",
        description: answer.answer.answer.slice(0, 200),
        assignedToUserId: ownerId,
        createdByUserId: ownerId,
        sourceArtifactId: answer.artifact!.id,
        sourceNoteId: note!.id,
      })
      .returning();
    expect(task!.matterId).toBe(matterId);

    const persistedArtifacts = await db
      .select()
      .from(aiArtifacts)
      .where(eq(aiArtifacts.matterId, matterId));
    expect(persistedArtifacts.length).toBeGreaterThan(0);
  }, 120000);

  it("denies an outsider the edit access required to create or patch tasks", async () => {
    await expect(
      requireMatterAccess(db, {
        userId: outsiderId,
        matterId,
        minAccess: "edit",
        capability: "matters.edit",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const allowed = await requireMatterAccess(db, {
      userId: ownerId,
      matterId,
      minAccess: "edit",
      capability: "matters.edit",
    });
    expect(allowed.matter.id).toBe(matterId);
  });
});
