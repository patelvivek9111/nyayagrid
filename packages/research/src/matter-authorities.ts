import { and, desc, eq, inArray } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import { legalAuthorities, matterAuthorities } from "@nyayagrid/database";
import { writeAuditEvent } from "@nyayagrid/permissions";
import { getTreatmentSummaryLine } from "./treatment";

export const MATTER_AUTHORITY_STATUSES = [
  "saved",
  "key_authority",
  "rejected",
  "not_relevant",
] as const;

export type MatterAuthorityStatus = (typeof MATTER_AUTHORITY_STATUSES)[number];

export type MatterAuthority = typeof matterAuthorities.$inferSelect;

export type MatterAuthorityListItem = MatterAuthority & {
  authority: {
    id: string;
    title: string;
    shortTitle: string | null;
    citation: string | null;
    normalizedCitation: string | null;
    authorityType: string;
    jurisdiction: string | null;
    court: string | null;
    decisionDate: string | null;
    ingestionStatus: string;
    treatmentStatus: string;
    /** Always includes the unverified-treatment notice unless a source reported treatment. */
    treatmentSummary: string;
  };
};

async function assertAuthorityExists(db: Database, authorityId: string) {
  const [authority] = await db
    .select({ id: legalAuthorities.id, title: legalAuthorities.title })
    .from(legalAuthorities)
    .where(eq(legalAuthorities.id, authorityId))
    .limit(1);
  if (!authority) throw new Error("Legal authority not found in corpus");
  return authority;
}

/**
 * Link a corpus authority to a matter.
 *
 * Matter access itself is checked by the API layer; this function still scopes every write by
 * organizationId + matterId so a mismatched pair can never mutate another tenant's row.
 */
export async function saveAuthorityToMatter(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  authorityId: string;
  userId: string;
  relevanceNote?: string | null;
  status?: MatterAuthorityStatus;
}): Promise<MatterAuthority> {
  await assertAuthorityExists(params.db, params.authorityId);
  const status = params.status ?? "saved";

  const [row] = await params.db
    .insert(matterAuthorities)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      authorityId: params.authorityId,
      status,
      relevanceNote: params.relevanceNote ?? null,
      addedByUserId: params.userId,
    })
    .onConflictDoUpdate({
      target: [matterAuthorities.matterId, matterAuthorities.authorityId],
      set: {
        status,
        relevanceNote: params.relevanceNote ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) throw new Error("Failed to save authority to matter");

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "matter_authority.saved",
    targetType: "matter_authority",
    targetId: row.id,
    metadata: { authorityId: params.authorityId, status },
  });

  if (status === "key_authority") {
    await writeAuditEvent(params.db, {
      organizationId: params.organizationId,
      actorUserId: params.userId,
      matterId: params.matterId,
      action: "matter_authority.key_authority_marked",
      targetType: "matter_authority",
      targetId: row.id,
      metadata: { authorityId: params.authorityId },
    });
  }

  return row;
}

export async function updateMatterAuthorityStatus(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  authorityId: string;
  userId: string;
  status: MatterAuthorityStatus;
  relevanceNote?: string | null;
}): Promise<MatterAuthority> {
  const [row] = await params.db
    .update(matterAuthorities)
    .set({
      status: params.status,
      ...(params.relevanceNote === undefined ? {} : { relevanceNote: params.relevanceNote }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(matterAuthorities.organizationId, params.organizationId),
        eq(matterAuthorities.matterId, params.matterId),
        eq(matterAuthorities.authorityId, params.authorityId),
      ),
    )
    .returning();
  if (!row) throw new Error("Matter authority not found in matter scope");

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "matter_authority.status_changed",
    targetType: "matter_authority",
    targetId: row.id,
    metadata: { authorityId: params.authorityId, status: params.status },
  });

  if (params.status === "key_authority") {
    await writeAuditEvent(params.db, {
      organizationId: params.organizationId,
      actorUserId: params.userId,
      matterId: params.matterId,
      action: "matter_authority.key_authority_marked",
      targetType: "matter_authority",
      targetId: row.id,
      metadata: { authorityId: params.authorityId },
    });
  }

  return row;
}

export async function listMatterAuthorities(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  statuses?: MatterAuthorityStatus[];
  limit?: number;
}): Promise<MatterAuthorityListItem[]> {
  const conditions = [
    eq(matterAuthorities.organizationId, params.organizationId),
    eq(matterAuthorities.matterId, params.matterId),
  ];
  if (params.statuses?.length) {
    conditions.push(inArray(matterAuthorities.status, params.statuses));
  }

  const rows = await params.db
    .select({
      link: matterAuthorities,
      authority: {
        id: legalAuthorities.id,
        title: legalAuthorities.title,
        shortTitle: legalAuthorities.shortTitle,
        citation: legalAuthorities.citation,
        normalizedCitation: legalAuthorities.normalizedCitation,
        authorityType: legalAuthorities.authorityType,
        jurisdiction: legalAuthorities.jurisdiction,
        court: legalAuthorities.court,
        decisionDate: legalAuthorities.decisionDate,
        ingestionStatus: legalAuthorities.ingestionStatus,
        treatmentStatus: legalAuthorities.treatmentStatus,
        sourceProvider: legalAuthorities.sourceProvider,
      },
    })
    .from(matterAuthorities)
    .innerJoin(legalAuthorities, eq(legalAuthorities.id, matterAuthorities.authorityId))
    .where(and(...conditions))
    .orderBy(desc(matterAuthorities.updatedAt))
    .limit(params.limit ?? 100);

  return rows.map((row) => ({
    ...row.link,
    authority: {
      id: row.authority.id,
      title: row.authority.title,
      shortTitle: row.authority.shortTitle,
      citation: row.authority.citation,
      normalizedCitation: row.authority.normalizedCitation,
      authorityType: row.authority.authorityType,
      jurisdiction: row.authority.jurisdiction,
      court: row.authority.court,
      decisionDate: row.authority.decisionDate,
      ingestionStatus: row.authority.ingestionStatus,
      treatmentStatus: row.authority.treatmentStatus,
      treatmentSummary: getTreatmentSummaryLine({
        treatmentStatus: row.authority.treatmentStatus,
        sourceProvider: row.authority.sourceProvider,
        relationships: [],
      }),
    },
  }));
}

export async function removeMatterAuthority(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  authorityId: string;
  userId: string;
}): Promise<{ removed: boolean }> {
  const [row] = await params.db
    .delete(matterAuthorities)
    .where(
      and(
        eq(matterAuthorities.organizationId, params.organizationId),
        eq(matterAuthorities.matterId, params.matterId),
        eq(matterAuthorities.authorityId, params.authorityId),
      ),
    )
    .returning();
  if (!row) return { removed: false };

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "matter_authority.removed",
    targetType: "matter_authority",
    targetId: row.id,
    metadata: { authorityId: params.authorityId, previousStatus: row.status },
  });

  return { removed: true };
}
