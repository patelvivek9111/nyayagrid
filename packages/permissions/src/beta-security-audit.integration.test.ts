/**
 * Audit-only security tests for the controlled legal beta.
 * These tests do not change production behavior. They encode isolation invariants
 * that already hold, and document remaining oracles / membership gaps by name.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  createDb,
  closeDb,
  createOrganizationWithDefaults,
  users,
  clients,
  matters,
  matterMembers,
  memberships,
  documents,
  documentVersions,
  documentChunks,
  type Database,
} from "@nyayagrid/database";
import { AuthorizationError, requireCapability, requireMatterAccess } from "./index";
import { createToolRegistry, searchMatterDocumentsTool } from "@nyayagrid/agents";

const runDbTests = process.env.RUN_DB_TESTS === "1";

describe.runIf(runDbTests)("beta security audit isolation", () => {
  const db: Database = createDb(
    process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid",
  );
  const suffix = Date.now().toString(36);
  afterAll(async () => {
    await closeDb(db);
  });

  let ownerId = "";
  let outsiderId = "";
  let guestId = "";
  let lawyerNoMatterId = "";
  let orgId = "";
  let matterId = "";
  let otherOrgId = "";
  let otherMatterId = "";
  let guestRoleId = "";
  let lawyerRoleId = "";

  beforeAll(async () => {
    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `sec_owner_${suffix}`,
        email: `sec_owner_${suffix}@example.nyayagrid.local`,
        name: "Sec Owner",
      })
      .returning();
    const [outsider] = await db
      .insert(users)
      .values({
        authSubject: `sec_out_${suffix}`,
        email: `sec_out_${suffix}@example.nyayagrid.local`,
        name: "Sec Outsider",
      })
      .returning();
    const [guest] = await db
      .insert(users)
      .values({
        authSubject: `sec_guest_${suffix}`,
        email: `sec_guest_${suffix}@example.nyayagrid.local`,
        name: "Sec Guest",
      })
      .returning();
    const [lawyer] = await db
      .insert(users)
      .values({
        authSubject: `sec_lawyer_${suffix}`,
        email: `sec_lawyer_${suffix}@example.nyayagrid.local`,
        name: "Sec Lawyer",
      })
      .returning();
    ownerId = owner!.id;
    outsiderId = outsider!.id;
    guestId = guest!.id;
    lawyerNoMatterId = lawyer!.id;

    const org = await createOrganizationWithDefaults(db, {
      name: `Sec Firm ${suffix}`,
      slug: `sec-firm-${suffix}`,
      type: "firm",
      ownerUserId: ownerId,
    });
    orgId = org.organization.id;
    guestRoleId = org.roleIdByKey.get("client_guest")!;
    lawyerRoleId = org.roleIdByKey.get("lawyer")!;

    await db.insert(memberships).values([
      { organizationId: orgId, userId: guestId, roleId: guestRoleId, status: "active" },
      { organizationId: orgId, userId: lawyerNoMatterId, roleId: lawyerRoleId, status: "active" },
    ]);

    const [otherOwner] = await db
      .insert(users)
      .values({
        authSubject: `sec_other_${suffix}`,
        email: `sec_other_${suffix}@example.nyayagrid.local`,
        name: "Other Owner",
      })
      .returning();
    const otherOrg = await createOrganizationWithDefaults(db, {
      name: `Sec Other ${suffix}`,
      slug: `sec-other-${suffix}`,
      type: "solo",
      ownerUserId: otherOwner!.id,
    });
    otherOrgId = otherOrg.organization.id;

    const [client] = await db
      .insert(clients)
      .values({
        organizationId: orgId,
        clientType: "individual",
        displayName: "Confidential Client",
        createdByUserId: ownerId,
      })
      .returning();
    const [matter] = await db
      .insert(matters)
      .values({
        organizationId: orgId,
        clientId: client!.id,
        matterNumber: `SEC-${suffix}`,
        title: "Confidential matter",
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
        organizationId: otherOrgId,
        clientType: "individual",
        displayName: "Other Client",
        createdByUserId: otherOwner!.id,
      })
      .returning();
    const [otherMatter] = await db
      .insert(matters)
      .values({
        organizationId: otherOrgId,
        clientId: otherClient!.id,
        matterNumber: `SEC-O-${suffix}`,
        title: "Other org matter",
        createdByUserId: otherOwner!.id,
      })
      .returning();
    otherMatterId = otherMatter!.id;
  });

  it("A: denies cross-org matter read", async () => {
    await expect(
      requireMatterAccess(db, {
        userId: ownerId,
        matterId: otherMatterId,
        minAccess: "read",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("D: denies same-org lawyer who is not a matter member", async () => {
    await expect(
      requireMatterAccess(db, {
        userId: lawyerNoMatterId,
        matterId,
        minAccess: "read",
        capability: "matters.view",
      }),
    ).rejects.toThrow(/No matter membership/);
  });

  it("C/D: non-member and client guest cannot satisfy research.run + matter access", async () => {
    await expect(
      requireCapability(db, {
        userId: guestId,
        organizationId: orgId,
        capability: "research.run",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      requireMatterAccess(db, {
        userId: lawyerNoMatterId,
        matterId,
        minAccess: "read",
        capability: "research.run",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("E: client guest cannot approve Memory/Timeline (lacks timeline.manage + edit)", async () => {
    await db.insert(matterMembers).values({
      organizationId: orgId,
      matterId,
      userId: guestId,
      access: "read",
    });
    await expect(
      requireMatterAccess(db, {
        userId: guestId,
        matterId,
        minAccess: "edit",
        capability: "timeline.manage",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("F: agent searchMatterDocuments cannot run for an unauthorized user", async () => {
    const registry = createToolRegistry([searchMatterDocumentsTool]);
    await expect(
      registry.invoke(
        { db, userId: outsiderId, organizationId: orgId, matterId },
        "searchMatterDocuments",
        { query: "confidential" },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("G: deleting a document cascades chunks so they cannot be retrieved by document id", async () => {
    const documentId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    await db.insert(documents).values({
      id: documentId,
      organizationId: orgId,
      matterId,
      title: "to-delete.txt",
      createdByUserId: ownerId,
      processingState: "ready",
    });
    await db.insert(documentVersions).values({
      id: versionId,
      documentId,
      organizationId: orgId,
      versionNumber: 1,
      storageKey: `org/${orgId}/documents/${documentId}/versions/${versionId}/to-delete.txt`,
      contentType: "text/plain",
      byteSize: 12,
      sha256: "0".repeat(64),
      originalFilename: "to-delete.txt",
      uploadedByUserId: ownerId,
    });
    await db.insert(documentChunks).values({
      organizationId: orgId,
      matterId,
      documentId,
      documentVersionId: versionId,
      chunkIndex: 0,
      content: "secret-chunk-should-vanish",
    });

    await db.delete(documents).where(eq(documents.id, documentId));
    const leftover = await db
      .select()
      .from(documentChunks)
      .where(eq(documentChunks.documentId, documentId));
    expect(leftover).toHaveLength(0);
  });

  it("documents the matter existence oracle across tenants (SEC-H4)", async () => {
    await expect(
      requireMatterAccess(db, {
        userId: outsiderId,
        matterId: "00000000-0000-0000-0000-000000000000",
        minAccess: "read",
      }),
    ).rejects.toThrow(/Matter not found/);
    await expect(
      requireMatterAccess(db, {
        userId: outsiderId,
        matterId: otherMatterId,
        minAccess: "read",
      }),
    ).rejects.toThrow(/Not a member of organization/);
  });
});
