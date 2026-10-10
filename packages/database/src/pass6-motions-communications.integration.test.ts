import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  closeDb,
  createDb,
  createOrganizationWithDefaults,
  clients,
  documents,
  isGraphNodeType,
  matters,
  matterEntities,
  matterMembers,
  users,
  matterMotions,
  matterMotionDocuments,
  matterMotionLinks,
  matterCommunications,
  matterCommunicationLinks,
  discoveryDeficiencies,
  discoveryMeetAndConferIssues,
} from "./index";

const runDbTests = process.env.RUN_DB_TESTS === "1";
const provenance = { extractionOrigin: "human" as const, humanEntered: true };

describe.runIf(runDbTests)("Pass 6 matter motions/communications integration", () => {
  const db = createDb(
    process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid",
  );
  const suffix = Date.now().toString(36);
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const [owner] = await db
      .insert(users)
      .values({
        authSubject: `p6_owner_${suffix}`,
        email: `p6_owner_${suffix}@example.nyayagrid.local`,
        name: "Pass6 Owner",
      })
      .returning();
    const [outsider] = await db
      .insert(users)
      .values({
        authSubject: `p6_out_${suffix}`,
        email: `p6_out_${suffix}@example.nyayagrid.local`,
        name: "Outsider",
      })
      .returning();
    ids.owner = owner!.id;
    ids.outsider = outsider!.id;

    const orgA = await createOrganizationWithDefaults(db, {
      name: `Pass6 A ${suffix}`,
      slug: `pass6-a-${suffix}`,
      type: "firm",
      ownerUserId: ids.owner!,
    });
    const orgB = await createOrganizationWithDefaults(db, {
      name: `Pass6 B ${suffix}`,
      slug: `pass6-b-${suffix}`,
      type: "firm",
      ownerUserId: ids.outsider!,
    });
    ids.orgA = orgA.organization.id;
    ids.orgB = orgB.organization.id;

    const [clientA] = await db
      .insert(clients)
      .values({
        organizationId: ids.orgA!,
        clientType: "organization",
        displayName: "Pass6 Client A",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [clientB] = await db
      .insert(clients)
      .values({
        organizationId: ids.orgB!,
        clientType: "organization",
        displayName: "Pass6 Client B",
        createdByUserId: ids.outsider!,
      })
      .returning();

    const [matterA] = await db
      .insert(matters)
      .values({
        organizationId: ids.orgA!,
        clientId: clientA!.id,
        matterNumber: `P6-A-${suffix}`,
        title: `Pass6 Matter A ${suffix}`,
        status: "open",
        createdByUserId: ids.owner!,
      })
      .returning();
    const [matterB] = await db
      .insert(matters)
      .values({
        organizationId: ids.orgB!,
        clientId: clientB!.id,
        matterNumber: `P6-B-${suffix}`,
        title: `Pass6 Matter B ${suffix}`,
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

    const [party] = await db
      .insert(matterEntities)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        entityType: "organization",
        displayName: "Moving Party",
        normalizedName: "moving party",
        status: "approved",
        origin: "manual",
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.party = party!.id;

    const [doc] = await db
      .insert(documents)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        title: `Motion paper ${suffix}`,
        createdByUserId: ids.owner!,
      })
      .returning();
    ids.doc = doc!.id;
  }, 60_000);

  afterAll(async () => {
    await closeDb(db);
  });

  it("has motion/communication tables, indexes, and graph enum values", async () => {
    const tables = await db.execute(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'matter_motions','matter_motion_documents','matter_motion_links',
          'matter_communications','matter_communication_links'
        )
      ORDER BY 1
    `);
    const names = (tables as unknown as Array<{ table_name: string }>).map((r) => r.table_name);
    expect(names).toEqual([
      "matter_communication_links",
      "matter_communications",
      "matter_motion_documents",
      "matter_motion_links",
      "matter_motions",
    ]);

    const enums = await db.execute(sql`
      SELECT e.enumlabel
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE t.typname = 'graph_node_type'
      ORDER BY e.enumsortorder
    `);
    const labels = (enums as unknown as Array<{ enumlabel: string }>).map((r) => r.enumlabel);
    expect(labels).toContain("motion");
    expect(labels).toContain("communication");
    expect(labels).toContain("claim");
    expect(labels).toContain("defense");
    expect(isGraphNodeType("motion")).toBe(true);
    expect(isGraphNodeType("communication")).toBe(true);
  });

  it("persists motions/communications with nullable dates and document links", async () => {
    const [motion] = await db
      .insert(matterMotions)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        motionType: "MOTION_TO_COMPEL",
        title: "Motion to Compel Production",
        status: "DRAFT",
        movingPartyEntityId: ids.party!,
        primaryDocumentId: ids.doc!,
        oppositionDueAt: null,
        disposition: null,
        provenance,
        createdByUserId: ids.owner!,
        updatedByUserId: ids.owner!,
      })
      .returning();
    ids.motion = motion!.id;

    await db.insert(matterMotionDocuments).values({
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      motionId: motion!.id,
      documentId: ids.doc!,
      role: "MOTION",
      sortOrder: 0,
    });

    await db.insert(matterMotionLinks).values({
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      motionId: motion!.id,
      linkType: "EVIDENCE",
      targetId: ids.doc!,
      note: "linked for review",
      provenance,
    });

    const [comm] = await db
      .insert(matterCommunications)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        communicationType: "MEET_AND_CONFER",
        direction: "OUTBOUND",
        status: "DRAFT",
        subject: "Meet and confer re RFP-1",
        senderEntityId: ids.party!,
        primaryDocumentId: ids.doc!,
        followUpNeeded: true,
        followUpDueAt: null,
        provenance,
        createdByUserId: ids.owner!,
        updatedByUserId: ids.owner!,
      })
      .returning();
    ids.comm = comm!.id;

    await db.insert(matterCommunicationLinks).values({
      organizationId: ids.orgA!,
      matterId: ids.matterA!,
      communicationId: comm!.id,
      linkType: "MOTION",
      targetId: motion!.id,
      provenance,
    });

    const [loadedMotion] = await db
      .select()
      .from(matterMotions)
      .where(and(eq(matterMotions.id, motion!.id), eq(matterMotions.matterId, ids.matterA!)));
    expect(loadedMotion?.disposition).toBeNull();
    expect(loadedMotion?.oppositionDueAt).toBeNull();
    expect(loadedMotion?.status).toBe("DRAFT");

    const docs = await db
      .select()
      .from(matterMotionDocuments)
      .where(eq(matterMotionDocuments.motionId, motion!.id));
    expect(docs).toHaveLength(1);
    expect(docs[0]?.documentId).toBe(ids.doc);
  });

  it("hardens discovery FKs to motions/communications and rejects cross-matter motion links", async () => {
    const [def] = await db
      .insert(discoveryDeficiencies)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        kind: "NO_RESPONSE",
        status: "OPEN",
        description: "Pass6 FK check",
        motionId: ids.motion!,
        communicationId: ids.comm!,
        isReviewSignal: true,
        provenance,
        createdByUserId: ids.owner!,
        updatedByUserId: ids.owner!,
      })
      .returning();
    expect(def?.motionId).toBe(ids.motion);
    expect(def?.communicationId).toBe(ids.comm);

    const [mac] = await db
      .insert(discoveryMeetAndConferIssues)
      .values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        label: "MAC for Pass6",
        communicationId: ids.comm!,
        provenance,
        createdByUserId: ids.owner!,
        updatedByUserId: ids.owner!,
      })
      .returning();
    expect(mac?.communicationId).toBe(ids.comm);

    await expect(
      db.insert(matterMotionLinks).values({
        organizationId: ids.orgA!,
        matterId: ids.matterB!,
        motionId: ids.motion!,
        linkType: "TASK",
        targetId: ids.doc!,
        provenance,
      }),
    ).rejects.toThrow();

    await expect(
      db.insert(discoveryDeficiencies).values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        kind: "OTHER",
        status: "OPEN",
        description: "foreign motion",
        motionId: "00000000-0000-4000-8000-000000000099",
        isReviewSignal: true,
        provenance,
        createdByUserId: ids.owner!,
      }),
    ).rejects.toThrow();
  });

  it("rejects forced invalid motion status values", async () => {
    await expect(
      db.insert(matterMotions).values({
        organizationId: ids.orgA!,
        matterId: ids.matterA!,
        motionType: "MOTION_TO_COMPEL",
        title: "Bad status",
        status: "WILL_WIN",
        provenance,
        createdByUserId: ids.owner!,
      }),
    ).rejects.toThrow();
  });
});
