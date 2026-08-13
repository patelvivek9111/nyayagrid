import { and, asc, desc, eq, inArray, isNull, sql } from "@nyayagrid/database";
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
  documents,
  graphNodes,
} from "@nyayagrid/database";

import { presentDeadlineForAttorney } from "./deadlines";

const APPROVED = ["approved", "edited_and_approved"] as const;

export async function getReviewQueueCounts(params: {
  db: Database;
  organizationId: string;
  matterId: string;
}) {
  const [events] = await params.db
    .select({ count: sql<number>`count(*)::int` })
    .from(timelineEvents)
    .where(
      and(
        eq(timelineEvents.organizationId, params.organizationId),
        eq(timelineEvents.matterId, params.matterId),
        eq(timelineEvents.status, "proposed"),
      ),
    );
  const [facts] = await params.db
    .select({ count: sql<number>`count(*)::int` })
    .from(matterFacts)
    .where(
      and(
        eq(matterFacts.organizationId, params.organizationId),
        eq(matterFacts.matterId, params.matterId),
        eq(matterFacts.status, "proposed"),
      ),
    );
  const [entities] = await params.db
    .select({ count: sql<number>`count(*)::int` })
    .from(matterEntities)
    .where(
      and(
        eq(matterEntities.organizationId, params.organizationId),
        eq(matterEntities.matterId, params.matterId),
        eq(matterEntities.status, "proposed"),
        isNull(matterEntities.mergedIntoEntityId),
      ),
    );
  const [deadlines] = await params.db
    .select({ count: sql<number>`count(*)::int` })
    .from(deadlineCandidates)
    .where(
      and(
        eq(deadlineCandidates.organizationId, params.organizationId),
        eq(deadlineCandidates.matterId, params.matterId),
        eq(deadlineCandidates.status, "proposed"),
      ),
    );

  return {
    proposedEvents: events?.count ?? 0,
    proposedFacts: facts?.count ?? 0,
    proposedEntities: entities?.count ?? 0,
    proposedDeadlines: deadlines?.count ?? 0,
  };
}

export async function listTimelineEvents(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  status?: string | string[];
  includeSources?: boolean;
  /** Attach related contradiction finding IDs (read-only; never merges). */
  includeContradictionLinks?: boolean;
}) {
  const statusFilter = params.status
    ? Array.isArray(params.status)
      ? params.status
      : [params.status]
    : [...APPROVED];

  const events = await params.db
    .select()
    .from(timelineEvents)
    .where(
      and(
        eq(timelineEvents.organizationId, params.organizationId),
        eq(timelineEvents.matterId, params.matterId),
        inArray(
          timelineEvents.status,
          statusFilter as Array<"proposed" | "approved" | "edited_and_approved" | "rejected">,
        ),
      ),
    )
    .orderBy(asc(timelineEvents.eventDate), asc(timelineEvents.createdAt));

  if (!params.includeSources && !params.includeContradictionLinks) {
    return events.map((e) => ({
      ...e,
      sources: [] as unknown[],
      relatedFindingIds: [] as string[],
    }));
  }

  const ids = events.map((e) => e.id);
  const sources =
    ids.length === 0 || params.includeSources === false
      ? []
      : await params.db
          .select()
          .from(timelineEventSources)
          .where(inArray(timelineEventSources.timelineEventId, ids));

  const byEvent = new Map<string, typeof sources>();
  for (const source of sources) {
    const list = byEvent.get(source.timelineEventId) ?? [];
    list.push(source);
    byEvent.set(source.timelineEventId, list);
  }

  const withSources = events.map((e) => ({
    ...e,
    sources: byEvent.get(e.id) ?? [],
    relatedFindingIds: [] as string[],
  }));

  if (!params.includeContradictionLinks) return withSources;

  const { listFindings } = await import("./analysis/deposition");
  const findings = await listFindings({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    runType: "contradiction",
    includeSources: true,
    includeTimelineLinks: false,
  });

  const { linkTimelineEventsToContradictionFindings } =
    await import("./analysis/link-contradiction-timeline");
  const related = linkTimelineEventsToContradictionFindings({
    events: withSources.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      eventDate: e.eventDate,
      actors: e.actors,
      status: e.status,
      sources: e.sources,
    })),
    findings: findings.map((f) => ({
      id: f.id,
      title: f.title,
      explanation: f.explanation,
      findingType: f.findingType,
      sources: f.sources,
    })),
  });

  return withSources.map((e) => ({
    ...e,
    relatedFindingIds: related.get(e.id) ?? [],
  }));
}

export async function listProposedIntelligence(params: {
  db: Database;
  organizationId: string;
  matterId: string;
}) {
  const events = await params.db
    .select()
    .from(timelineEvents)
    .where(
      and(
        eq(timelineEvents.organizationId, params.organizationId),
        eq(timelineEvents.matterId, params.matterId),
        eq(timelineEvents.status, "proposed"),
      ),
    )
    .orderBy(desc(timelineEvents.createdAt));

  const eventIds = events.map((e) => e.id);
  const eventSources =
    eventIds.length === 0
      ? []
      : await params.db
          .select()
          .from(timelineEventSources)
          .where(inArray(timelineEventSources.timelineEventId, eventIds));

  const facts = await params.db
    .select()
    .from(matterFacts)
    .where(
      and(
        eq(matterFacts.organizationId, params.organizationId),
        eq(matterFacts.matterId, params.matterId),
        eq(matterFacts.status, "proposed"),
      ),
    )
    .orderBy(desc(matterFacts.createdAt));
  const factIds = facts.map((f) => f.id);
  const factSources =
    factIds.length === 0
      ? []
      : await params.db
          .select()
          .from(matterFactSources)
          .where(inArray(matterFactSources.matterFactId, factIds));

  const entities = await params.db
    .select()
    .from(matterEntities)
    .where(
      and(
        eq(matterEntities.organizationId, params.organizationId),
        eq(matterEntities.matterId, params.matterId),
        eq(matterEntities.status, "proposed"),
        isNull(matterEntities.mergedIntoEntityId),
      ),
    )
    .orderBy(desc(matterEntities.createdAt));
  const entityIds = entities.map((e) => e.id);
  const aliases =
    entityIds.length === 0
      ? []
      : await params.db
          .select()
          .from(entityAliases)
          .where(inArray(entityAliases.entityId, entityIds));
  const roles =
    entityIds.length === 0
      ? []
      : await params.db.select().from(entityRoles).where(inArray(entityRoles.entityId, entityIds));
  const entitySrc =
    entityIds.length === 0
      ? []
      : await params.db
          .select()
          .from(entitySources)
          .where(inArray(entitySources.entityId, entityIds));

  const deadlines = await params.db
    .select()
    .from(deadlineCandidates)
    .where(
      and(
        eq(deadlineCandidates.organizationId, params.organizationId),
        eq(deadlineCandidates.matterId, params.matterId),
        eq(deadlineCandidates.status, "proposed"),
      ),
    )
    .orderBy(desc(deadlineCandidates.createdAt));
  const deadlineIds = deadlines.map((d) => d.id);
  const deadlineSources =
    deadlineIds.length === 0
      ? []
      : await params.db
          .select()
          .from(deadlineCandidateSources)
          .where(inArray(deadlineCandidateSources.deadlineCandidateId, deadlineIds));

  return {
    events: events.map((e) => ({
      ...e,
      sources: eventSources.filter((s) => s.timelineEventId === e.id),
    })),
    facts: facts.map((f) => ({
      ...f,
      sources: factSources.filter((s) => s.matterFactId === f.id),
    })),
    entities: entities.map((e) => ({
      ...e,
      aliases: aliases.filter((a) => a.entityId === e.id),
      roles: roles.filter((r) => r.entityId === e.id),
      sources: entitySrc.filter((s) => s.entityId === e.id),
    })),
    deadlines: deadlines.map((d) => ({
      ...d,
      sources: deadlineSources.filter((s) => s.deadlineCandidateId === d.id),
    })),
  };
}

export async function listVerifiedOverviewIntelligence(params: {
  db: Database;
  organizationId: string;
  matterId: string;
}) {
  const recentEvents = await params.db
    .select()
    .from(timelineEvents)
    .where(
      and(
        eq(timelineEvents.organizationId, params.organizationId),
        eq(timelineEvents.matterId, params.matterId),
        inArray(timelineEvents.status, [...APPROVED]),
      ),
    )
    .orderBy(desc(timelineEvents.eventDate), desc(timelineEvents.createdAt))
    .limit(8);

  const facts = await params.db
    .select()
    .from(matterFacts)
    .where(
      and(
        eq(matterFacts.organizationId, params.organizationId),
        eq(matterFacts.matterId, params.matterId),
        inArray(matterFacts.status, [...APPROVED]),
      ),
    )
    .orderBy(desc(matterFacts.updatedAt))
    .limit(12);

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
    )
    .orderBy(asc(matterEntities.displayName))
    .limit(20);

  const entityIds = entities.map((e) => e.id);
  const roles =
    entityIds.length === 0
      ? []
      : await params.db.select().from(entityRoles).where(inArray(entityRoles.entityId, entityIds));

  const upcomingDeadlines = await listMatterDeadlines({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    status: "verified",
  });

  return {
    recentEvents,
    facts,
    entities: entities.map((e) => ({
      ...e,
      roles: roles.filter((r) => r.entityId === e.id),
    })),
    upcomingDeadlines: upcomingDeadlines.slice(0, 10),
  };
}

export async function listMatterEntities(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  status?: string | null;
}) {
  const statusClause =
    params.status === "proposed"
      ? eq(matterEntities.status, "proposed")
      : params.status === "verified"
        ? inArray(matterEntities.status, [...APPROVED])
        : inArray(matterEntities.status, ["proposed", "approved", "edited_and_approved"]);

  const entities = await params.db
    .select()
    .from(matterEntities)
    .where(
      and(
        eq(matterEntities.organizationId, params.organizationId),
        eq(matterEntities.matterId, params.matterId),
        isNull(matterEntities.mergedIntoEntityId),
        statusClause,
      ),
    )
    .orderBy(desc(matterEntities.updatedAt));

  if (entities.length === 0) return [];

  const entityIds = entities.map((e) => e.id);
  const [roles, aliases, sources, nodes] = await Promise.all([
    params.db.select().from(entityRoles).where(inArray(entityRoles.entityId, entityIds)),
    params.db.select().from(entityAliases).where(inArray(entityAliases.entityId, entityIds)),
    params.db.select().from(entitySources).where(inArray(entitySources.entityId, entityIds)),
    params.db
      .select({
        id: graphNodes.id,
        canonicalEntityId: graphNodes.canonicalEntityId,
      })
      .from(graphNodes)
      .where(
        and(
          eq(graphNodes.organizationId, params.organizationId),
          eq(graphNodes.matterId, params.matterId),
          eq(graphNodes.canonicalEntityType, "matter_entity"),
          inArray(graphNodes.canonicalEntityId, entityIds),
        ),
      ),
  ]);

  const documentIds = [...new Set(sources.map((s) => s.documentId))];
  const docs =
    documentIds.length === 0
      ? []
      : await params.db
          .select({ id: documents.id, title: documents.title })
          .from(documents)
          .where(inArray(documents.id, documentIds));
  const titleByDoc = new Map(docs.map((d) => [d.id, d.title]));
  const nodeByEntity = new Map(nodes.map((n) => [n.canonicalEntityId, n.id]));

  return entities.map((entity) => ({
    ...entity,
    roles: roles.filter((r) => r.entityId === entity.id),
    aliases: aliases.filter((a) => a.entityId === entity.id),
    sources: sources
      .filter((s) => s.entityId === entity.id)
      .map((s) => ({
        ...s,
        documentTitle: titleByDoc.get(s.documentId) ?? "Case document",
      })),
    graphNodeId: nodeByEntity.get(entity.id) ?? null,
  }));
}

export async function listMatterDeadlines(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  status?: string | null;
}) {
  const statusClause =
    params.status === "proposed"
      ? eq(deadlineCandidates.status, "proposed")
      : params.status === "verified"
        ? inArray(deadlineCandidates.status, [...APPROVED])
        : inArray(deadlineCandidates.status, ["proposed", "approved", "edited_and_approved"]);

  const rows = await params.db
    .select()
    .from(deadlineCandidates)
    .where(
      and(
        eq(deadlineCandidates.organizationId, params.organizationId),
        eq(deadlineCandidates.matterId, params.matterId),
        statusClause,
      ),
    )
    .orderBy(asc(deadlineCandidates.dueAt), desc(deadlineCandidates.updatedAt));

  if (rows.length === 0) return [];

  const ids = rows.map((d) => d.id);
  const sources = await params.db
    .select()
    .from(deadlineCandidateSources)
    .where(inArray(deadlineCandidateSources.deadlineCandidateId, ids));

  const documentIds = [...new Set(sources.map((s) => s.documentId))];
  const docs =
    documentIds.length === 0
      ? []
      : await params.db
          .select({ id: documents.id, title: documents.title })
          .from(documents)
          .where(inArray(documents.id, documentIds));
  const titleByDoc = new Map(docs.map((d) => [d.id, d.title]));

  return rows
    .map((deadline) =>
      presentDeadlineForAttorney(
        deadline,
        sources
          .filter((s) => s.deadlineCandidateId === deadline.id)
          .map((s) => ({
            ...s,
            documentTitle: titleByDoc.get(s.documentId) ?? "Case document",
          })),
      ),
    )
    .filter((d): d is NonNullable<typeof d> => d !== null);
}
