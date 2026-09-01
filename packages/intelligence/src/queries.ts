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
  graphEdges,
  graphEdgeSources,
  documentAnalyses,
  documentAnalysisItems,
  documentAnalysisSources,
  analysisRuns,
  analysisFindings,
  analysisFindingSources,
  redlineSuggestions,
  matterMemories,
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

  const [graph] = await params.db
    .select({ count: sql<number>`count(*)::int` })
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.organizationId, params.organizationId),
        eq(graphEdges.matterId, params.matterId),
        eq(graphEdges.status, "proposed"),
      ),
    );

  const proposedEvents = events?.count ?? 0;
  const proposedFacts = facts?.count ?? 0;
  const proposedEntities = entities?.count ?? 0;
  const proposedDeadlines = deadlines?.count ?? 0;
  const proposedGraphEdges = graph?.count ?? 0;

  const [contractItems] = await params.db
    .select({ count: sql<number>`count(*)::int` })
    .from(documentAnalysisItems)
    .where(
      and(
        eq(documentAnalysisItems.organizationId, params.organizationId),
        eq(documentAnalysisItems.matterId, params.matterId),
        eq(documentAnalysisItems.status, "proposed"),
      ),
    );
  const [findings] = await params.db
    .select({ count: sql<number>`count(*)::int` })
    .from(analysisFindings)
    .where(
      and(
        eq(analysisFindings.organizationId, params.organizationId),
        eq(analysisFindings.matterId, params.matterId),
        eq(analysisFindings.status, "proposed"),
      ),
    );
  const [redlines] = await params.db
    .select({ count: sql<number>`count(*)::int` })
    .from(redlineSuggestions)
    .where(
      and(
        eq(redlineSuggestions.organizationId, params.organizationId),
        eq(redlineSuggestions.matterId, params.matterId),
        eq(redlineSuggestions.status, "proposed"),
      ),
    );

  const pendingContractItems = contractItems?.count ?? 0;
  const pendingFindings = findings?.count ?? 0;
  const pendingRedlines = redlines?.count ?? 0;
  const intelligencePendingCount =
    proposedEvents + proposedFacts + proposedEntities + proposedDeadlines + proposedGraphEdges;
  const analysisPendingCount = pendingContractItems + pendingFindings + pendingRedlines;

  const [memories] = await params.db
    .select({ count: sql<number>`count(*)::int` })
    .from(matterMemories)
    .where(
      and(
        eq(matterMemories.organizationId, params.organizationId),
        eq(matterMemories.matterId, params.matterId),
        eq(matterMemories.status, "proposed"),
        isNull(matterMemories.supersededBy),
      ),
    );
  const proposedMemories = memories?.count ?? 0;

  return {
    proposedEvents,
    proposedFacts,
    proposedEntities,
    proposedDeadlines,
    proposedGraphEdges,
    intelligencePendingCount,
    analysis: {
      pendingContractItems,
      pendingFindings,
      pendingRedlines,
      pendingCount: analysisPendingCount,
    },
    memory: {
      proposedMemories,
      pendingCount: proposedMemories,
    },
    pendingCount: intelligencePendingCount + analysisPendingCount + proposedMemories,
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

  const graphEdgesProposed = await params.db
    .select()
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.organizationId, params.organizationId),
        eq(graphEdges.matterId, params.matterId),
        eq(graphEdges.status, "proposed"),
      ),
    )
    .orderBy(desc(graphEdges.createdAt));
  const graphEdgeIds = graphEdgesProposed.map((e) => e.id);
  const graphNodeIds = [
    ...new Set(graphEdgesProposed.flatMap((e) => [e.fromNodeId, e.toNodeId])),
  ];
  const graphReviewNodes =
    graphNodeIds.length === 0
      ? []
      : await params.db
          .select()
          .from(graphNodes)
          .where(
            and(
              eq(graphNodes.organizationId, params.organizationId),
              eq(graphNodes.matterId, params.matterId),
              inArray(graphNodes.id, graphNodeIds),
            ),
          );
  const graphNodeById = new Map(graphReviewNodes.map((n) => [n.id, n]));
  const graphReviewSources =
    graphEdgeIds.length === 0
      ? []
      : await params.db
          .select()
          .from(graphEdgeSources)
          .where(inArray(graphEdgeSources.graphEdgeId, graphEdgeIds));
  const graphDocIds = [...new Set(graphReviewSources.map((s) => s.documentId))];
  const graphDocs =
    graphDocIds.length === 0
      ? []
      : await params.db
          .select({ id: documents.id, title: documents.title })
          .from(documents)
          .where(inArray(documents.id, graphDocIds));
  const graphDocTitle = new Map(graphDocs.map((d) => [d.id, d.title]));

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
    graphEdges: graphEdgesProposed.map((e) => ({
      ...e,
      fromName: graphNodeById.get(e.fromNodeId)?.displayName ?? "Unknown",
      toName: graphNodeById.get(e.toNodeId)?.displayName ?? "Unknown",
      sources: graphReviewSources
        .filter((s) => s.graphEdgeId === e.id)
        .map((s) => ({
          id: s.id,
          documentId: s.documentId,
          documentTitle: graphDocTitle.get(s.documentId) ?? "Case document",
          page: s.page,
          supportingText: s.supportingText,
        })),
    })),
  };
}

/** Proposed Analysis objects with an existing review action. Read-only; does not generate Analysis. */
export async function listProposedAnalysisForReview(params: {
  db: Database;
  organizationId: string;
  matterId: string;
}) {
  const contractItems = await params.db
    .select({
      id: documentAnalysisItems.id,
      analysisId: documentAnalysisItems.analysisId,
      category: documentAnalysisItems.category,
      title: documentAnalysisItems.title,
      summary: documentAnalysisItems.summary,
      originalText: documentAnalysisItems.originalText,
      explanation: documentAnalysisItems.explanation,
      attention: documentAnalysisItems.attention,
      status: documentAnalysisItems.status,
      confidence: documentAnalysisItems.confidence,
      documentId: documentAnalyses.documentId,
    })
    .from(documentAnalysisItems)
    .innerJoin(documentAnalyses, eq(documentAnalyses.id, documentAnalysisItems.analysisId))
    .where(
      and(
        eq(documentAnalysisItems.organizationId, params.organizationId),
        eq(documentAnalysisItems.matterId, params.matterId),
        eq(documentAnalysisItems.status, "proposed"),
        eq(documentAnalyses.organizationId, params.organizationId),
        eq(documentAnalyses.matterId, params.matterId),
      ),
    )
    .orderBy(desc(documentAnalysisItems.createdAt));

  const contractItemIds = contractItems.map((i) => i.id);
  const contractSources =
    contractItemIds.length === 0
      ? []
      : await params.db
          .select()
          .from(documentAnalysisSources)
          .where(inArray(documentAnalysisSources.analysisItemId, contractItemIds));

  const findings = await params.db
    .select({
      id: analysisFindings.id,
      findingType: analysisFindings.findingType,
      title: analysisFindings.title,
      explanation: analysisFindings.explanation,
      confidence: analysisFindings.confidence,
      status: analysisFindings.status,
      attention: analysisFindings.attention,
      analysisRunId: analysisFindings.analysisRunId,
      runType: analysisRuns.runType,
      documentId: analysisRuns.documentId,
    })
    .from(analysisFindings)
    .innerJoin(analysisRuns, eq(analysisRuns.id, analysisFindings.analysisRunId))
    .where(
      and(
        eq(analysisFindings.organizationId, params.organizationId),
        eq(analysisFindings.matterId, params.matterId),
        eq(analysisFindings.status, "proposed"),
        eq(analysisRuns.organizationId, params.organizationId),
        eq(analysisRuns.matterId, params.matterId),
      ),
    )
    .orderBy(desc(analysisFindings.createdAt));

  const findingIds = findings.map((f) => f.id);
  const findingSources =
    findingIds.length === 0
      ? []
      : await params.db
          .select()
          .from(analysisFindingSources)
          .where(inArray(analysisFindingSources.findingId, findingIds));

  const redlines = await params.db
    .select()
    .from(redlineSuggestions)
    .where(
      and(
        eq(redlineSuggestions.organizationId, params.organizationId),
        eq(redlineSuggestions.matterId, params.matterId),
        eq(redlineSuggestions.status, "proposed"),
      ),
    )
    .orderBy(desc(redlineSuggestions.createdAt));

  const docIds = [
    ...new Set(
      [
        ...contractItems.map((i) => i.documentId),
        ...contractSources.map((s) => s.documentId),
        ...findings.map((f) => f.documentId),
        ...findingSources.map((s) => s.documentId),
        ...redlines.map((r) => r.documentId),
      ].filter((id): id is string => Boolean(id)),
    ),
  ];
  const docs =
    docIds.length === 0
      ? []
      : await params.db
          .select({ id: documents.id, title: documents.title })
          .from(documents)
          .where(inArray(documents.id, docIds));
  const docTitle = new Map(docs.map((d) => [d.id, d.title]));

  return {
    contractItems: contractItems.map((item) => ({
      ...item,
      documentTitle: item.documentId ? (docTitle.get(item.documentId) ?? null) : null,
      sources: contractSources
        .filter((s) => s.analysisItemId === item.id)
        .map((s) => ({
          id: s.id,
          documentId: s.documentId,
          documentTitle: docTitle.get(s.documentId) ?? null,
          page: s.page,
          supportingText: s.supportingText,
          segmentRef: s.segmentRef,
        })),
    })),
    findings: findings.map((finding) => ({
      ...finding,
      documentTitle: finding.documentId ? (docTitle.get(finding.documentId) ?? null) : null,
      sources: findingSources
        .filter((s) => s.findingId === finding.id)
        .map((s) => ({
          id: s.id,
          documentId: s.documentId,
          documentTitle: docTitle.get(s.documentId) ?? null,
          page: s.page,
          supportingText: s.supportingText,
          segmentRef: s.segmentRef,
          side: s.side,
        })),
    })),
    redlines: redlines.map((row) => ({
      ...row,
      documentTitle: docTitle.get(row.documentId) ?? null,
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
