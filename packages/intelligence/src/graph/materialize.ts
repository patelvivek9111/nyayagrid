import { and, eq, inArray, isNull } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import {
  graphNodes,
  graphEdges,
  graphEdgeSources,
  graphMaterializationRuns,
  matterEntities,
  timelineEvents,
  timelineEventSources,
  matterFacts,
  matterFactSources,
  deadlineCandidates,
  deadlineCandidateSources,
  documents,
  tasks,
  entityRoles,
} from "@nyayagrid/database";
import { writeAuditEvent } from "@nyayagrid/permissions";

const APPROVED = ["approved", "edited_and_approved"] as const;

export type CanonicalRef = {
  canonicalEntityType: string;
  canonicalEntityId: string;
  nodeType:
    | "person"
    | "organization"
    | "client"
    | "document"
    | "event"
    | "fact"
    | "deadline"
    | "task"
    | "matter"
    | "other";
  displayName: string;
  origin?: "ai" | "manual";
  metadata?: Record<string, unknown>;
};

export async function upsertGraphNode(
  db: Database,
  params: {
    organizationId: string;
    matterId: string;
    userId?: string | null;
  } & CanonicalRef,
) {
  const existing = await db.query.graphNodes.findFirst({
    where: (table, ops) =>
      ops.and(
        ops.eq(table.matterId, params.matterId),
        ops.eq(table.organizationId, params.organizationId),
        ops.eq(table.canonicalEntityType, params.canonicalEntityType),
        ops.eq(table.canonicalEntityId, params.canonicalEntityId),
      ),
  });
  if (existing) {
    const [updated] = await db
      .update(graphNodes)
      .set({
        displayName: params.displayName,
        nodeType: params.nodeType,
        metadata: params.metadata ?? existing.metadata ?? {},
        updatedAt: new Date(),
      })
      .where(eq(graphNodes.id, existing.id))
      .returning();
    return updated!;
  }
  const [created] = await db
    .insert(graphNodes)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      nodeType: params.nodeType,
      canonicalEntityType: params.canonicalEntityType,
      canonicalEntityId: params.canonicalEntityId,
      displayName: params.displayName,
      metadata: params.metadata ?? {},
      origin: params.origin ?? "ai",
      status: "approved",
      createdByUserId: params.userId ?? null,
    })
    .returning();
  return created!;
}

export function edgeDedupeKey(params: {
  fromNodeId: string;
  toNodeId: string;
  relationshipType: string;
  direction?: string;
}): string {
  return `${params.fromNodeId}|${params.relationshipType}|${params.toNodeId}|${params.direction ?? "directed"}`;
}

export async function upsertGraphEdge(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  fromNodeId: string;
  toNodeId: string;
  relationshipType: string;
  label?: string | null;
  direction?: "directed" | "undirected";
  origin: "ai" | "manual";
  status: "proposed" | "approved" | "edited_and_approved";
  confidence?: "low" | "medium" | "high" | null;
  userId?: string | null;
  metadata?: Record<string, unknown>;
  sources?: Array<{
    documentId: string;
    documentVersionId: string;
    chunkId: string;
    page?: number | null;
    segmentRef?: string | null;
    supportingText: string;
  }>;
}) {
  const dedupeKey = edgeDedupeKey({
    fromNodeId: params.fromNodeId,
    toNodeId: params.toNodeId,
    relationshipType: params.relationshipType,
    direction: params.direction,
  });

  const [existing] = await params.db
    .select()
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.organizationId, params.organizationId),
        eq(graphEdges.matterId, params.matterId),
        eq(graphEdges.dedupeKey, dedupeKey),
        inArray(graphEdges.status, ["proposed", "approved", "edited_and_approved"]),
      ),
    )
    .limit(1);

  let edge = existing;
  if (!edge) {
    const [created] = await params.db
      .insert(graphEdges)
      .values({
        organizationId: params.organizationId,
        matterId: params.matterId,
        fromNodeId: params.fromNodeId,
        toNodeId: params.toNodeId,
        relationshipType: params.relationshipType,
        label: params.label ?? null,
        direction: params.direction ?? "directed",
        origin: params.origin,
        status: params.status,
        confidence: params.confidence ?? null,
        metadata: params.metadata ?? {},
        dedupeKey,
        createdByUserId: params.userId ?? null,
        approvedByUserId: params.status !== "proposed" ? (params.userId ?? null) : null,
        approvedAt: params.status !== "proposed" ? new Date() : null,
      })
      .returning();
    edge = created!;
  }

  for (const source of params.sources ?? []) {
    await params.db
      .insert(graphEdgeSources)
      .values({
        organizationId: params.organizationId,
        matterId: params.matterId,
        graphEdgeId: edge.id,
        documentId: source.documentId,
        documentVersionId: source.documentVersionId,
        chunkId: source.chunkId,
        page: source.page ?? null,
        segmentRef: source.segmentRef ?? null,
        supportingText: source.supportingText,
      })
      .onConflictDoNothing();
  }

  return { edge, merged: Boolean(existing) };
}

export async function materializeVerifiedGraph(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  userId?: string | null;
  force?: boolean;
}) {
  const idempotencyKey = `materialize_verified_graph:${params.matterId}`;
  const [existingRun] = await params.db
    .select()
    .from(graphMaterializationRuns)
    .where(eq(graphMaterializationRuns.idempotencyKey, idempotencyKey))
    .limit(1);

  if (existingRun?.status === "completed" && !params.force) {
    // Still allow incremental refresh without forcing full skip when caller wants refresh via force=false but content changed.
    // Use force for explicit rebuilds; otherwise always rematerialize nodes/edges idempotently.
  }

  const [run] = existingRun
    ? await params.db
        .update(graphMaterializationRuns)
        .set({ status: "running", lastError: null, updatedAt: new Date() })
        .where(eq(graphMaterializationRuns.id, existingRun.id))
        .returning()
    : await params.db
        .insert(graphMaterializationRuns)
        .values({
          organizationId: params.organizationId,
          matterId: params.matterId,
          idempotencyKey,
          status: "running",
          createdByUserId: params.userId ?? null,
        })
        .returning();

  try {
    let nodesCreated = 0;
    let edgesCreated = 0;

    const entities = await params.db
      .select()
      .from(matterEntities)
      .where(
        and(
          eq(matterEntities.organizationId, params.organizationId),
          eq(matterEntities.matterId, params.matterId),
          inArray(matterEntities.status, [...APPROVED]),
          isNull(matterEntities.mergedIntoEntityId),
        ),
      );
    for (const entity of entities) {
      await upsertGraphNode(params.db, {
        organizationId: params.organizationId,
        matterId: params.matterId,
        userId: params.userId,
        canonicalEntityType: "matter_entity",
        canonicalEntityId: entity.id,
        nodeType: entity.entityType === "organization" ? "organization" : "person",
        displayName: entity.displayName,
        origin: entity.origin as "ai" | "manual",
      });
      nodesCreated += 1;
    }

    const events = await params.db
      .select()
      .from(timelineEvents)
      .where(
        and(
          eq(timelineEvents.organizationId, params.organizationId),
          eq(timelineEvents.matterId, params.matterId),
          inArray(timelineEvents.status, [...APPROVED]),
        ),
      );
    for (const event of events) {
      const eventNode = await upsertGraphNode(params.db, {
        organizationId: params.organizationId,
        matterId: params.matterId,
        userId: params.userId,
        canonicalEntityType: "timeline_event",
        canonicalEntityId: event.id,
        nodeType: "event",
        displayName: event.title,
        origin: event.origin as "ai" | "manual",
        metadata: { eventType: event.eventType },
      });
      nodesCreated += 1;

      const sources = await params.db
        .select()
        .from(timelineEventSources)
        .where(eq(timelineEventSources.timelineEventId, event.id));
      for (const source of sources) {
        const docNode = await upsertGraphNode(params.db, {
          organizationId: params.organizationId,
          matterId: params.matterId,
          userId: params.userId,
          canonicalEntityType: "document",
          canonicalEntityId: source.documentId,
          nodeType: "document",
          displayName: `Document ${source.documentId.slice(0, 8)}`,
          origin: "ai",
        });
        const result = await upsertGraphEdge({
          db: params.db,
          organizationId: params.organizationId,
          matterId: params.matterId,
          fromNodeId: eventNode.id,
          toNodeId: docNode.id,
          relationshipType: "supported_by",
          label: "Supported by document",
          origin: "ai",
          status: "approved",
          confidence: "high",
          userId: params.userId,
          sources: [
            {
              documentId: source.documentId,
              documentVersionId: source.documentVersionId,
              chunkId: source.chunkId,
              page: source.page,
              segmentRef: source.segmentRef,
              supportingText: source.supportingText,
            },
          ],
        });
        if (!result.merged) edgesCreated += 1;
      }
    }

    const facts = await params.db
      .select()
      .from(matterFacts)
      .where(
        and(
          eq(matterFacts.organizationId, params.organizationId),
          eq(matterFacts.matterId, params.matterId),
          inArray(matterFacts.status, [...APPROVED]),
        ),
      );
    for (const fact of facts) {
      const factNode = await upsertGraphNode(params.db, {
        organizationId: params.organizationId,
        matterId: params.matterId,
        userId: params.userId,
        canonicalEntityType: "matter_fact",
        canonicalEntityId: fact.id,
        nodeType: "fact",
        displayName: `${fact.label}: ${fact.value}`.slice(0, 200),
        origin: fact.origin as "ai" | "manual",
      });
      nodesCreated += 1;
      const sources = await params.db
        .select()
        .from(matterFactSources)
        .where(eq(matterFactSources.matterFactId, fact.id));
      for (const source of sources) {
        const docNode = await upsertGraphNode(params.db, {
          organizationId: params.organizationId,
          matterId: params.matterId,
          userId: params.userId,
          canonicalEntityType: "document",
          canonicalEntityId: source.documentId,
          nodeType: "document",
          displayName: `Document ${source.documentId.slice(0, 8)}`,
          origin: "ai",
        });
        const result = await upsertGraphEdge({
          db: params.db,
          organizationId: params.organizationId,
          matterId: params.matterId,
          fromNodeId: factNode.id,
          toNodeId: docNode.id,
          relationshipType: "supported_by",
          origin: "ai",
          status: "approved",
          confidence: "high",
          userId: params.userId,
          sources: [
            {
              documentId: source.documentId,
              documentVersionId: source.documentVersionId,
              chunkId: source.chunkId,
              page: source.page,
              segmentRef: source.segmentRef,
              supportingText: source.supportingText,
            },
          ],
        });
        if (!result.merged) edgesCreated += 1;
      }
    }

    const deadlines = await params.db
      .select()
      .from(deadlineCandidates)
      .where(
        and(
          eq(deadlineCandidates.organizationId, params.organizationId),
          eq(deadlineCandidates.matterId, params.matterId),
          inArray(deadlineCandidates.status, [...APPROVED]),
        ),
      );
    for (const deadline of deadlines) {
      const deadlineNode = await upsertGraphNode(params.db, {
        organizationId: params.organizationId,
        matterId: params.matterId,
        userId: params.userId,
        canonicalEntityType: "deadline_candidate",
        canonicalEntityId: deadline.id,
        nodeType: "deadline",
        displayName: deadline.title,
        origin: deadline.origin as "ai" | "manual",
      });
      nodesCreated += 1;
      const sources = await params.db
        .select()
        .from(deadlineCandidateSources)
        .where(eq(deadlineCandidateSources.deadlineCandidateId, deadline.id));
      for (const source of sources) {
        const docNode = await upsertGraphNode(params.db, {
          organizationId: params.organizationId,
          matterId: params.matterId,
          userId: params.userId,
          canonicalEntityType: "document",
          canonicalEntityId: source.documentId,
          nodeType: "document",
          displayName: `Document ${source.documentId.slice(0, 8)}`,
          origin: "ai",
        });
        const result = await upsertGraphEdge({
          db: params.db,
          organizationId: params.organizationId,
          matterId: params.matterId,
          fromNodeId: deadlineNode.id,
          toNodeId: docNode.id,
          relationshipType: "supported_by",
          origin: "ai",
          status: "approved",
          confidence: "high",
          userId: params.userId,
          sources: [
            {
              documentId: source.documentId,
              documentVersionId: source.documentVersionId,
              chunkId: source.chunkId,
              page: source.page,
              segmentRef: source.segmentRef,
              supportingText: source.supportingText,
            },
          ],
        });
        if (!result.merged) edgesCreated += 1;
      }
    }

    const docs = await params.db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, params.organizationId),
          eq(documents.matterId, params.matterId),
        ),
      );
    for (const doc of docs) {
      await upsertGraphNode(params.db, {
        organizationId: params.organizationId,
        matterId: params.matterId,
        userId: params.userId,
        canonicalEntityType: "document",
        canonicalEntityId: doc.id,
        nodeType: "document",
        displayName: doc.title,
        origin: "manual",
      });
      nodesCreated += 1;
    }

    const matterTasks = await params.db
      .select()
      .from(tasks)
      .where(
        and(eq(tasks.organizationId, params.organizationId), eq(tasks.matterId, params.matterId)),
      );
    for (const task of matterTasks) {
      await upsertGraphNode(params.db, {
        organizationId: params.organizationId,
        matterId: params.matterId,
        userId: params.userId,
        canonicalEntityType: "task",
        canonicalEntityId: task.id,
        nodeType: "task",
        displayName: task.title,
        origin: "manual",
      });
      nodesCreated += 1;
    }

    // Role-backed deterministic edges: entity roles are matter roles, not necessarily graph edges.
    // Only create participated_in when an actor name matches an approved entity on an approved event.
    const roles = await params.db
      .select()
      .from(entityRoles)
      .where(
        and(
          eq(entityRoles.organizationId, params.organizationId),
          eq(entityRoles.matterId, params.matterId),
        ),
      );
    void roles;

    const stats = { nodesCreated, edgesCreated };
    const [completed] = await params.db
      .update(graphMaterializationRuns)
      .set({
        status: "completed",
        stats,
        updatedAt: new Date(),
        completedAt: new Date(),
      })
      .where(eq(graphMaterializationRuns.id, run!.id))
      .returning();

    await writeAuditEvent(params.db, {
      organizationId: params.organizationId,
      actorUserId: params.userId ?? null,
      matterId: params.matterId,
      action: "graph.materialized",
      targetType: "matter",
      targetId: params.matterId,
      metadata: stats,
    });

    return { run: completed!, stats };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Graph materialization failed";
    await params.db
      .update(graphMaterializationRuns)
      .set({ status: "failed", lastError: message, updatedAt: new Date() })
      .where(eq(graphMaterializationRuns.id, run!.id));
    throw error;
  }
}
