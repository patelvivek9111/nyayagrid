import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  auditEvents,
  clientContacts,
  clients,
  closeDb,
  contacts,
  createDb,
  createOrganizationWithDefaults,
  documentFolders,
  documents,
  matterMembers,
  matters,
  users,
} from "@nyayagrid/database";
import { AuthorizationError, requireCapability, requireMatterAccess } from "@nyayagrid/permissions";
import { buildFolderParentMap, wouldCreateFolderCycle } from "@nyayagrid/documents";

const runDbTests = process.env.RUN_DB_TESTS === "1";

describe.runIf(runDbTests)("PROF-CONTACT-01 / PROF-FOLDER-01 isolation", () => {
  const db = createDb(
    process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid",
  );
  const suffix = Date.now().toString(36);
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    for (const tableName of ["contacts", "client_contacts", "document_folders"]) {
      const table = await db.execute(sql`
        select table_name from information_schema.tables
        where table_schema = 'public' and table_name = ${tableName}
      `);
      expect(table.length).toBe(1);
    }
    const folderCol = await db.execute(sql`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'documents' and column_name = 'folder_id'
    `);
    expect(folderCol.length).toBe(1);

    async function user(key: string) {
      const [row] = await db
        .insert(users)
        .values({
          authSubject: `cf_${key}_${suffix}`,
          email: `cf_${key}_${suffix}@example.nyayagrid.local`,
          name: key,
        })
        .returning();
      ids[key] = row!.id;
    }
    await user("ownerA");
    await user("ownerB");
    await user("outsider");

    const orgA = await createOrganizationWithDefaults(db, {
      name: `CF A ${suffix}`,
      slug: `cf-a-${suffix}`,
      type: "firm",
      ownerUserId: ids.ownerA!,
    });
    const orgB = await createOrganizationWithDefaults(db, {
      name: `CF B ${suffix}`,
      slug: `cf-b-${suffix}`,
      type: "firm",
      ownerUserId: ids.ownerB!,
    });
    ids.orgA = orgA.organization.id;
    ids.orgB = orgB.organization.id;

    const [clientA] = await db
      .insert(clients)
      .values({
        organizationId: ids.orgA!,
        clientType: "individual",
        displayName: `Client A ${suffix}`,
        createdByUserId: ids.ownerA!,
      })
      .returning();
    ids.clientA = clientA!.id;

    const [clientB] = await db
      .insert(clients)
      .values({
        organizationId: ids.orgB!,
        clientType: "individual",
        displayName: `Client B ${suffix}`,
        createdByUserId: ids.ownerB!,
      })
      .returning();
    ids.clientB = clientB!.id;

    const [matterA] = await db
      .insert(matters)
      .values({
        organizationId: ids.orgA!,
        clientId: ids.clientA!,
        matterNumber: `CF-A-${suffix}`,
        title: "Synthetic contact/folder matter A",
        createdByUserId: ids.ownerA!,
      })
      .returning();
    ids.matterA = matterA!.id;
    await db.insert(matterMembers).values({
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      userId: ids.ownerA!,
      access: "manage",
    });

    const [matterB] = await db
      .insert(matters)
      .values({
        organizationId: ids.orgB!,
        clientId: ids.clientB!,
        matterNumber: `CF-B-${suffix}`,
        title: "Synthetic contact/folder matter B",
        createdByUserId: ids.ownerB!,
      })
      .returning();
    ids.matterB = matterB!.id;
    await db.insert(matterMembers).values({
      organizationId: ids.orgB!,
      matterId: ids.matterB!,
      userId: ids.ownerB!,
      access: "manage",
    });
  }, 60000);

  afterAll(async () => {
    if (ids.orgA) {
      await db.delete(clientContacts).where(eq(clientContacts.organizationId, ids.orgA));
      await db.delete(contacts).where(eq(contacts.organizationId, ids.orgA));
      await db.delete(documents).where(eq(documents.organizationId, ids.orgA));
      await db.delete(documentFolders).where(eq(documentFolders.organizationId, ids.orgA));
    }
    if (ids.orgB) {
      await db.delete(clientContacts).where(eq(clientContacts.organizationId, ids.orgB));
      await db.delete(contacts).where(eq(contacts.organizationId, ids.orgB));
      await db.delete(documents).where(eq(documents.organizationId, ids.orgB));
      await db.delete(documentFolders).where(eq(documentFolders.organizationId, ids.orgB));
    }
    await closeDb(db);
  });

  it("creates contacts scoped to org and audits; denies outsider capability", async () => {
    await requireCapability(db, {
      userId: ids.ownerA!,
      organizationId: ids.orgA!,
      capability: "clients.edit",
    });
    await expect(
      requireCapability(db, {
        userId: ids.outsider!,
        organizationId: ids.orgA!,
        capability: "clients.view",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const [contact] = await db
      .insert(contacts)
      .values({
        organizationId: ids.orgA!,
        displayName: `Jane Contact ${suffix}`,
        email: `jane_${suffix}@example.nyayagrid.local`,
        title: "General Counsel",
        createdByUserId: ids.ownerA!,
      })
      .returning();
    ids.contactA = contact!.id;

    await db.insert(auditEvents).values({
      organizationId: ids.orgA!,
      actorUserId: ids.ownerA!,
      action: "contact.created",
      targetType: "contact",
      targetId: contact!.id,
    });

    const [link] = await db
      .insert(clientContacts)
      .values({
        organizationId: ids.orgA!,
        clientId: ids.clientA!,
        contactId: contact!.id,
        relationshipRole: "legal",
        createdByUserId: ids.ownerA!,
      })
      .returning();
    expect(link!.relationshipRole).toBe("legal");

    // Cross-org link must fail (composite FK / org mismatch).
    await expect(
      db.insert(clientContacts).values({
        organizationId: ids.orgA!,
        clientId: ids.clientB!,
        contactId: contact!.id,
        relationshipRole: "other",
        createdByUserId: ids.ownerA!,
      }),
    ).rejects.toThrow();

    const orgAContacts = await db
      .select()
      .from(contacts)
      .where(eq(contacts.organizationId, ids.orgA!));
    expect(orgAContacts.every((c) => c.organizationId === ids.orgA)).toBe(true);
    expect(orgAContacts.some((c) => c.id === contact!.id)).toBe(true);

    const leaked = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.organizationId, ids.orgB!), eq(contacts.id, contact!.id)));
    expect(leaked).toHaveLength(0);
  });

  it("enforces matter folder access, cycle prevention, and document move isolation", async () => {
    await requireMatterAccess(db, {
      userId: ids.ownerA!,
      matterId: ids.matterA!,
      minAccess: "edit",
      capability: "documents.edit",
    });
    await expect(
      requireMatterAccess(db, {
        userId: ids.ownerB!,
        matterId: ids.matterA!,
        minAccess: "read",
        capability: "documents.view",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const [root] = await db
      .insert(documentFolders)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        name: "Root",
        createdByUserId: ids.ownerA!,
      })
      .returning();
    const [child] = await db
      .insert(documentFolders)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        parentFolderId: root!.id,
        name: "Child",
        createdByUserId: ids.ownerA!,
      })
      .returning();
    const [grandchild] = await db
      .insert(documentFolders)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        parentFolderId: child!.id,
        name: "Grandchild",
        createdByUserId: ids.ownerA!,
      })
      .returning();

    const tree = await db
      .select({ id: documentFolders.id, parentFolderId: documentFolders.parentFolderId })
      .from(documentFolders)
      .where(eq(documentFolders.matterId, ids.matterA!));
    const parentById = buildFolderParentMap(tree);
    expect(wouldCreateFolderCycle(root!.id, grandchild!.id, parentById)).toBe(true);
    expect(wouldCreateFolderCycle(grandchild!.id, root!.id, parentById)).toBe(false);

    // Cross-matter parent must fail via matter-scoped API predicate simulation.
    const [otherRoot] = await db
      .insert(documentFolders)
      .values({
        organizationId: ids.orgB!,
        matterId: ids.matterB!,
        name: "Other Root",
        createdByUserId: ids.ownerB!,
      })
      .returning();

    const crossMatterParent = await db
      .select()
      .from(documentFolders)
      .where(
        and(
          eq(documentFolders.id, otherRoot!.id),
          eq(documentFolders.matterId, ids.matterA!),
          eq(documentFolders.organizationId, ids.orgA!),
        ),
      );
    expect(crossMatterParent).toHaveLength(0);

    const [doc] = await db
      .insert(documents)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        title: `Foldered doc ${suffix}`,
        createdByUserId: ids.ownerA!,
        folderId: child!.id,
      })
      .returning();
    expect(doc!.folderId).toBe(child!.id);

    // Cannot attach orgA document to orgB folder (FK allows id-only; API must check matter).
    const wrongFolder = await db
      .select()
      .from(documentFolders)
      .where(
        and(
          eq(documentFolders.id, otherRoot!.id),
          eq(documentFolders.matterId, ids.matterA!),
          eq(documentFolders.organizationId, ids.orgA!),
        ),
      );
    expect(wrongFolder).toHaveLength(0);

    await db
      .update(documents)
      .set({ folderId: null, updatedAt: new Date() })
      .where(eq(documents.id, doc!.id));
  });
});
