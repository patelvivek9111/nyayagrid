import { and, eq, inArray } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import {
  timelineEvents,
  timelineEventSources,
  matterFacts,
  matterFactSources,
  matterEntities,
  entityAliases,
  entityRoles,
  entitySources,
  deadlineCandidates,
  deadlineCandidateSources,
} from "@nyayagrid/database";
import { writeAuditEvent } from "@nyayagrid/permissions";
import { normalizeEntityName, parseOptionalDate } from "./provenance";

type ReviewAction = "approve" | "edit_and_approve" | "reject";

async function applyStatusUpdate<T extends { id: string }>(params: {
  db: Database;
  table:
    typeof timelineEvents | typeof matterFacts | typeof matterEntities | typeof deadlineCandidates;
  id: string;
  organizationId: string;
  matterId: string;
  userId: string;
  action: ReviewAction;
  rejectionReason?: string | null;
  patch?: Record<string, unknown>;
}): Promise<T> {
  const now = new Date();
  const status =
    params.action === "reject"
      ? "rejected"
      : params.action === "edit_and_approve"
        ? "edited_and_approved"
        : "approved";

  const values: Record<string, unknown> = {
    status,
    updatedAt: now,
    ...(params.patch ?? {}),
  };
  if (status === "rejected") {
    values.rejectedByUserId = params.userId;
    values.rejectedAt = now;
    values.rejectionReason = params.rejectionReason ?? null;
    values.approvedByUserId = null;
    values.approvedAt = null;
  } else {
    values.approvedByUserId = params.userId;
    values.approvedAt = now;
    values.rejectedByUserId = null;
    values.rejectedAt = null;
    values.rejectionReason = null;
  }

  const [updated] = await params.db
    .update(params.table)
    .set(values)
    .where(
      and(
        eq(params.table.id, params.id),
        eq(params.table.organizationId, params.organizationId),
        eq(params.table.matterId, params.matterId),
      ),
    )
    .returning();
  if (!updated) throw new Error("Record not found in matter scope");
  return updated as T;
}

export async function reviewTimelineEvent(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  eventId: string;
  userId: string;
  action: ReviewAction;
  rejectionReason?: string | null;
  edits?: {
    title?: string;
    description?: string | null;
    eventType?: string;
    eventDate?: string | null;
    eventDateEnd?: string | null;
    datePrecision?: "exact" | "approximate" | "month" | "year" | "range" | "unknown";
    actors?: string[];
  };
}) {
  if (params.action !== "reject") {
    const sources = await params.db
      .select()
      .from(timelineEventSources)
      .where(eq(timelineEventSources.timelineEventId, params.eventId))
      .limit(1);
    if (sources.length === 0) {
      throw new Error("Cannot approve a timeline event without source provenance");
    }
  }

  const patch =
    params.action === "edit_and_approve" && params.edits
      ? {
          title: params.edits.title,
          description: params.edits.description,
          eventType: params.edits.eventType,
          eventDate: parseOptionalDate(params.edits.eventDate),
          eventDateEnd: parseOptionalDate(params.edits.eventDateEnd),
          datePrecision: params.edits.datePrecision,
          actors: params.edits.actors,
        }
      : undefined;

  const updated = await applyStatusUpdate({
    db: params.db,
    table: timelineEvents,
    id: params.eventId,
    organizationId: params.organizationId,
    matterId: params.matterId,
    userId: params.userId,
    action: params.action,
    rejectionReason: params.rejectionReason,
    patch,
  });

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: `timeline_event.${params.action}`,
    targetType: "timeline_event",
    targetId: params.eventId,
    metadata: { rejectionReason: params.rejectionReason ?? null },
  });
  if (params.action !== "reject") {
    await incrementalMaterializeGraph(params);
  }
  return updated;
}

export async function createManualTimelineEvent(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  userId: string;
  title: string;
  description?: string | null;
  eventType: string;
  eventDate?: string | null;
  eventDateEnd?: string | null;
  datePrecision?: "exact" | "approximate" | "month" | "year" | "range" | "unknown";
  actors?: string[];
  sourceChunkIds?: string[];
}) {
  const [event] = await params.db
    .insert(timelineEvents)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      title: params.title,
      description: params.description ?? null,
      eventType: params.eventType,
      eventDate: parseOptionalDate(params.eventDate),
      eventDateEnd: parseOptionalDate(params.eventDateEnd),
      datePrecision: params.datePrecision ?? (params.eventDate ? "exact" : "unknown"),
      status: "approved",
      confidence: "high",
      origin: "manual",
      actors: params.actors ?? [],
      createdByUserId: params.userId,
      approvedByUserId: params.userId,
      approvedAt: new Date(),
    })
    .returning();

  if (params.sourceChunkIds?.length) {
    const chunks = await params.db.query.documentChunks.findMany({
      where: (table, ops) =>
        ops.and(
          ops.eq(table.organizationId, params.organizationId),
          ops.eq(table.matterId, params.matterId),
          inArray(table.id, params.sourceChunkIds!),
        ),
    });
    for (const chunk of chunks) {
      await params.db.insert(timelineEventSources).values({
        organizationId: params.organizationId,
        matterId: params.matterId,
        timelineEventId: event!.id,
        documentId: chunk.documentId,
        documentVersionId: chunk.documentVersionId,
        chunkId: chunk.id,
        page: chunk.pageStart,
        segmentRef: chunk.segmentRef,
        supportingText: chunk.content.slice(0, 400),
      });
    }
  }

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "timeline_event.manual_created",
    targetType: "timeline_event",
    targetId: event!.id,
  });
  return event!;
}

export async function reviewMatterFact(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  factId: string;
  userId: string;
  action: ReviewAction;
  rejectionReason?: string | null;
  edits?: { label?: string; value?: string; normalizedValue?: string | null; factKey?: string };
}) {
  if (params.action !== "reject") {
    const sources = await params.db
      .select()
      .from(matterFactSources)
      .where(eq(matterFactSources.matterFactId, params.factId))
      .limit(1);
    if (sources.length === 0) {
      throw new Error("Cannot approve a matter fact without source provenance");
    }
  }
  const updated = await applyStatusUpdate({
    db: params.db,
    table: matterFacts,
    id: params.factId,
    organizationId: params.organizationId,
    matterId: params.matterId,
    userId: params.userId,
    action: params.action,
    rejectionReason: params.rejectionReason,
    patch: params.action === "edit_and_approve" ? params.edits : undefined,
  });
  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: `matter_fact.${params.action}`,
    targetType: "matter_fact",
    targetId: params.factId,
  });
  if (params.action !== "reject") {
    await incrementalMaterializeGraph(params);
  }
  return updated;
}

export async function reviewMatterEntity(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  entityId: string;
  userId: string;
  action: ReviewAction;
  rejectionReason?: string | null;
  edits?: {
    displayName?: string;
    description?: string | null;
    entityType?: "person" | "organization";
    roles?: string[];
    aliases?: string[];
  };
}) {
  if (params.action !== "reject") {
    const sources = await params.db
      .select()
      .from(entitySources)
      .where(eq(entitySources.entityId, params.entityId))
      .limit(1);
    const [entity] = await params.db
      .select()
      .from(matterEntities)
      .where(eq(matterEntities.id, params.entityId))
      .limit(1);
    if (sources.length === 0 && entity?.origin === "ai") {
      throw new Error("Cannot approve an AI entity without source provenance");
    }
  }

  const patch: Record<string, unknown> = {};
  if (params.action === "edit_and_approve" && params.edits) {
    if (params.edits.displayName) {
      patch.displayName = params.edits.displayName;
      patch.normalizedName = normalizeEntityName(params.edits.displayName);
    }
    if (params.edits.description !== undefined) patch.description = params.edits.description;
    if (params.edits.entityType) patch.entityType = params.edits.entityType;
  }

  const updated = await applyStatusUpdate({
    db: params.db,
    table: matterEntities,
    id: params.entityId,
    organizationId: params.organizationId,
    matterId: params.matterId,
    userId: params.userId,
    action: params.action,
    rejectionReason: params.rejectionReason,
    patch,
  });

  if (params.action !== "reject") {
    await params.db
      .update(entityRoles)
      .set({ status: "approved", updatedAt: new Date() })
      .where(and(eq(entityRoles.entityId, params.entityId), eq(entityRoles.status, "proposed")));
  }

  if (params.edits?.roles) {
    for (const role of params.edits.roles) {
      await params.db
        .insert(entityRoles)
        .values({
          organizationId: params.organizationId,
          matterId: params.matterId,
          entityId: params.entityId,
          role,
          status: "approved",
        })
        .onConflictDoNothing();
    }
  }

  if (params.edits?.aliases) {
    for (const alias of params.edits.aliases) {
      await params.db
        .insert(entityAliases)
        .values({
          organizationId: params.organizationId,
          matterId: params.matterId,
          entityId: params.entityId,
          alias,
        })
        .onConflictDoNothing();
    }
  }

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: `matter_entity.${params.action}`,
    targetType: "matter_entity",
    targetId: params.entityId,
  });
  if (params.action !== "reject") {
    await incrementalMaterializeGraph(params);
  }
  return updated;
}

export async function mergeMatterEntities(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  userId: string;
  keepEntityId: string;
  mergeEntityId: string;
}) {
  if (params.keepEntityId === params.mergeEntityId) {
    throw new Error("Cannot merge an entity into itself");
  }
  const [keep] = await params.db
    .select()
    .from(matterEntities)
    .where(
      and(
        eq(matterEntities.id, params.keepEntityId),
        eq(matterEntities.organizationId, params.organizationId),
        eq(matterEntities.matterId, params.matterId),
      ),
    )
    .limit(1);
  const [merge] = await params.db
    .select()
    .from(matterEntities)
    .where(
      and(
        eq(matterEntities.id, params.mergeEntityId),
        eq(matterEntities.organizationId, params.organizationId),
        eq(matterEntities.matterId, params.matterId),
      ),
    )
    .limit(1);
  if (!keep || !merge) throw new Error("Entity not found in matter scope");

  const aliases = await params.db
    .select()
    .from(entityAliases)
    .where(eq(entityAliases.entityId, merge.id));
  for (const alias of aliases) {
    await params.db
      .insert(entityAliases)
      .values({
        organizationId: params.organizationId,
        matterId: params.matterId,
        entityId: keep.id,
        alias: alias.alias,
      })
      .onConflictDoNothing();
  }
  await params.db
    .insert(entityAliases)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      entityId: keep.id,
      alias: merge.displayName,
    })
    .onConflictDoNothing();

  const roles = await params.db
    .select()
    .from(entityRoles)
    .where(eq(entityRoles.entityId, merge.id));
  for (const role of roles) {
    await params.db
      .insert(entityRoles)
      .values({
        organizationId: params.organizationId,
        matterId: params.matterId,
        entityId: keep.id,
        role: role.role,
        status: role.status,
      })
      .onConflictDoNothing();
  }

  const sources = await params.db
    .select()
    .from(entitySources)
    .where(eq(entitySources.entityId, merge.id));
  for (const source of sources) {
    await params.db
      .insert(entitySources)
      .values({
        organizationId: source.organizationId,
        matterId: source.matterId,
        entityId: keep.id,
        documentId: source.documentId,
        documentVersionId: source.documentVersionId,
        chunkId: source.chunkId,
        page: source.page,
        segmentRef: source.segmentRef,
        supportingText: source.supportingText,
      })
      .onConflictDoNothing();
  }

  await params.db
    .update(matterEntities)
    .set({
      mergedIntoEntityId: keep.id,
      status: "rejected",
      rejectedByUserId: params.userId,
      rejectedAt: new Date(),
      rejectionReason: `Merged into ${keep.id}`,
      updatedAt: new Date(),
    })
    .where(eq(matterEntities.id, merge.id));

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "matter_entity.merged",
    targetType: "matter_entity",
    targetId: keep.id,
    metadata: { mergedEntityId: merge.id },
  });

  return keep;
}

export async function createManualMatterEntity(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  userId: string;
  entityType: "person" | "organization";
  displayName: string;
  description?: string | null;
  roles?: string[];
  aliases?: string[];
}) {
  const [entity] = await params.db
    .insert(matterEntities)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      entityType: params.entityType,
      displayName: params.displayName,
      normalizedName: normalizeEntityName(params.displayName),
      description: params.description ?? null,
      status: "approved",
      confidence: "high",
      origin: "manual",
      createdByUserId: params.userId,
      approvedByUserId: params.userId,
      approvedAt: new Date(),
    })
    .returning();

  for (const alias of params.aliases ?? []) {
    await params.db.insert(entityAliases).values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      entityId: entity!.id,
      alias,
    });
  }
  for (const role of params.roles ?? []) {
    await params.db.insert(entityRoles).values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      entityId: entity!.id,
      role,
      status: "approved",
    });
  }

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "matter_entity.manual_created",
    targetType: "matter_entity",
    targetId: entity!.id,
  });
  await incrementalMaterializeGraph({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    userId: params.userId,
  });
  return entity!;
}

export async function reviewDeadlineCandidate(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  deadlineId: string;
  userId: string;
  action: ReviewAction;
  rejectionReason?: string | null;
  edits?: {
    title?: string;
    description?: string | null;
    dueAt?: string | null;
    dueAtEnd?: string | null;
    datePrecision?: "exact" | "approximate" | "month" | "year" | "range" | "unknown";
    dateKind?: "explicit" | "inferred";
  };
}) {
  if (params.action !== "reject") {
    const sources = await params.db
      .select()
      .from(deadlineCandidateSources)
      .where(eq(deadlineCandidateSources.deadlineCandidateId, params.deadlineId))
      .limit(1);
    if (sources.length === 0) {
      throw new Error("Cannot approve a deadline without source provenance");
    }
  }
  const patch =
    params.action === "edit_and_approve" && params.edits
      ? {
          title: params.edits.title,
          description: params.edits.description,
          dueAt: parseOptionalDate(params.edits.dueAt),
          dueAtEnd: parseOptionalDate(params.edits.dueAtEnd),
          datePrecision: params.edits.datePrecision,
          dateKind: params.edits.dateKind,
        }
      : undefined;
  const updated = await applyStatusUpdate({
    db: params.db,
    table: deadlineCandidates,
    id: params.deadlineId,
    organizationId: params.organizationId,
    matterId: params.matterId,
    userId: params.userId,
    action: params.action,
    rejectionReason: params.rejectionReason,
    patch,
  });
  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: `deadline_candidate.${params.action}`,
    targetType: "deadline_candidate",
    targetId: params.deadlineId,
  });
  if (params.action !== "reject") {
    await incrementalMaterializeGraph(params);
  }
  return updated;
}

async function incrementalMaterializeGraph(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  userId: string;
}) {
  try {
    const { materializeVerifiedGraph } = await import("./graph/materialize");
    await materializeVerifiedGraph({
      db: params.db,
      organizationId: params.organizationId,
      matterId: params.matterId,
      userId: params.userId,
      force: true,
    });
  } catch {
    // Review must succeed even if graph refresh fails; jobs can retry.
  }
}
