import { and, desc, eq, inArray } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import {
  analysisFindingSources,
  analysisFindings,
  analysisRuns,
  documentReviewStates,
  documents,
  entitySources,
  graphEdgeSources,
  graphEdges,
  graphNodes,
  matterFactSources,
  matterFacts,
  timelineEventSources,
  timelineEvents,
} from "@nyayagrid/database";
import { writeAuditEvent } from "@nyayagrid/permissions";
import { ensureReviewState } from "../discovery/index";

const APPROVED = ["approved", "edited_and_approved"] as const;

export type EvidenceMatrixEntry = {
  issueKey: string;
  label: string;
  supporting: Array<{ kind: string; id: string; rationale: string }>;
  contrary: Array<{ kind: string; id: string; rationale: string }>;
  gaps: Array<{ rationale: string }>;
};

export async function getEvidenceIntelligence(params: {
  db: Database;
  organizationId: string;
  matterId: string;
}) {
  const docs = await params.db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, params.organizationId),
        eq(documents.matterId, params.matterId),
      ),
    )
    .orderBy(desc(documents.updatedAt));

  const reviewStates = await params.db
    .select()
    .from(documentReviewStates)
    .where(
      and(
        eq(documentReviewStates.organizationId, params.organizationId),
        eq(documentReviewStates.matterId, params.matterId),
      ),
    );

  const reviewByDoc = new Map(reviewStates.map((r) => [r.documentId, r]));

  const verifiedEvents = await params.db
    .select()
    .from(timelineEvents)
    .where(
      and(
        eq(timelineEvents.organizationId, params.organizationId),
        eq(timelineEvents.matterId, params.matterId),
        inArray(timelineEvents.status, [...APPROVED]),
      ),
    );
  const eventIds = verifiedEvents.map((e) => e.id);
  const eventSources =
    eventIds.length === 0
      ? []
      : await params.db
          .select()
          .from(timelineEventSources)
          .where(inArray(timelineEventSources.timelineEventId, eventIds));

  const verifiedFacts = await params.db
    .select()
    .from(matterFacts)
    .where(
      and(
        eq(matterFacts.organizationId, params.organizationId),
        eq(matterFacts.matterId, params.matterId),
        inArray(matterFacts.status, [...APPROVED]),
      ),
    );
  const factIds = verifiedFacts.map((f) => f.id);
  const factSources =
    factIds.length === 0
      ? []
      : await params.db
          .select()
          .from(matterFactSources)
          .where(inArray(matterFactSources.matterFactId, factIds));

  const entitySrc = await params.db
    .select()
    .from(entitySources)
    .where(
      and(
        eq(entitySources.organizationId, params.organizationId),
        eq(entitySources.matterId, params.matterId),
      ),
    );

  const approvedEdges = await params.db
    .select()
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.organizationId, params.organizationId),
        eq(graphEdges.matterId, params.matterId),
        inArray(graphEdges.status, [...APPROVED]),
      ),
    );
  const edgeIds = approvedEdges.map((e) => e.id);
  const graphSources =
    edgeIds.length === 0
      ? []
      : await params.db
          .select()
          .from(graphEdgeSources)
          .where(inArray(graphEdgeSources.graphEdgeId, edgeIds));

  const nodes =
    approvedEdges.length === 0
      ? []
      : await params.db
          .select()
          .from(graphNodes)
          .where(
            and(
              eq(graphNodes.organizationId, params.organizationId),
              eq(graphNodes.matterId, params.matterId),
              inArray(graphNodes.status, [...APPROVED]),
            ),
          );

  const contradictionRuns = await params.db
    .select()
    .from(analysisRuns)
    .where(
      and(
        eq(analysisRuns.organizationId, params.organizationId),
        eq(analysisRuns.matterId, params.matterId),
        eq(analysisRuns.runType, "contradiction"),
      ),
    );
  const contradictionRunIds = contradictionRuns.map((r) => r.id);
  const contradictionFindings =
    contradictionRunIds.length === 0
      ? []
      : await params.db
          .select()
          .from(analysisFindings)
          .where(
            and(
              eq(analysisFindings.organizationId, params.organizationId),
              eq(analysisFindings.matterId, params.matterId),
              inArray(analysisFindings.analysisRunId, contradictionRunIds),
              inArray(analysisFindings.status, ["proposed", "reviewed"]),
            ),
          );
  const contradictionFindingIds = contradictionFindings.map((f) => f.id);
  const contradictionSources =
    contradictionFindingIds.length === 0
      ? []
      : await params.db
          .select()
          .from(analysisFindingSources)
          .where(inArray(analysisFindingSources.findingId, contradictionFindingIds));

  const documentsWithLinks = docs.map((doc) => {
    const reviewState = reviewByDoc.get(doc.id) ?? null;
    const linkedEvents = verifiedEvents
      .filter((e) =>
        eventSources.some((s) => s.documentId === doc.id && s.timelineEventId === e.id),
      )
      .map((e) => ({
        event: e,
        sources: eventSources.filter((s) => s.documentId === doc.id && s.timelineEventId === e.id),
      }));
    const linkedFacts = verifiedFacts
      .filter((f) => factSources.some((s) => s.documentId === doc.id && s.matterFactId === f.id))
      .map((f) => ({
        fact: f,
        sources: factSources.filter((s) => s.documentId === doc.id && s.matterFactId === f.id),
      }));
    const linkedEntities = entitySrc
      .filter((s) => s.documentId === doc.id)
      .map((s) => ({ entityId: s.entityId, source: s }));
    const linkedGraphEdges = approvedEdges
      .filter((e) => graphSources.some((s) => s.documentId === doc.id && s.graphEdgeId === e.id))
      .map((e) => ({
        edge: e,
        sources: graphSources.filter((s) => s.documentId === doc.id && s.graphEdgeId === e.id),
        fromNode: nodes.find((n) => n.id === e.fromNodeId) ?? null,
        toNode: nodes.find((n) => n.id === e.toNodeId) ?? null,
      }));

    return {
      document: doc,
      reviewState,
      important: reviewState?.important ?? false,
      linkedEvents,
      linkedFacts,
      linkedEntities,
      linkedGraphEdges,
    };
  });

  const evidenceMatrix = buildEvidenceMatrix({
    facts: verifiedFacts,
    factSources,
    events: verifiedEvents,
    eventSources,
    contradictionFindings,
    contradictionSources,
    importantDocumentIds: new Set(
      documentsWithLinks.filter((d) => d.important).map((d) => d.document.id),
    ),
  });

  return {
    documents: documentsWithLinks,
    evidenceMatrix,
  };
}

function buildEvidenceMatrix(input: {
  facts: Array<{ id: string; factKey: string; label: string; value: string }>;
  factSources: Array<{
    matterFactId: string;
    documentId: string;
    supportingText: string;
  }>;
  events: Array<{ id: string; title: string; description: string | null }>;
  eventSources: Array<{
    timelineEventId: string;
    documentId: string;
    supportingText: string;
  }>;
  contradictionFindings: Array<{
    id: string;
    title: string;
    explanation: string | null;
    findingType: string;
  }>;
  contradictionSources: Array<{
    findingId: string;
    documentId: string;
    chunkId: string;
    supportingText: string;
    side: string | null;
  }>;
  importantDocumentIds: Set<string>;
}): { issues: EvidenceMatrixEntry[] } {
  const issues: EvidenceMatrixEntry[] = [];

  for (const fact of input.facts) {
    const sources = input.factSources.filter((s) => s.matterFactId === fact.id);
    const sourceDocIds = new Set(sources.map((s) => s.documentId));

    const supporting: EvidenceMatrixEntry["supporting"] = sources.map((s) => ({
      kind: "fact_source",
      id: fact.id,
      rationale: s.supportingText,
    }));

    for (const event of input.events) {
      const related = input.eventSources.filter(
        (s) =>
          s.timelineEventId === event.id &&
          [...sourceDocIds].some((docId) => docId === s.documentId),
      );
      for (const s of related) {
        supporting.push({
          kind: "timeline_event",
          id: event.id,
          rationale: `${event.title}: ${s.supportingText}`,
        });
      }
    }

    const contrary: EvidenceMatrixEntry["contrary"] = [];
    for (const finding of input.contradictionFindings) {
      const findingSources = input.contradictionSources.filter((s) => s.findingId === finding.id);
      const overlapsFactDocs = findingSources.some((s) => sourceDocIds.has(s.documentId));
      if (!overlapsFactDocs) continue;
      contrary.push({
        kind: "analysis_finding",
        id: finding.id,
        rationale: finding.explanation ?? finding.title,
      });
    }

    const gaps: EvidenceMatrixEntry["gaps"] = [];
    if (sources.length === 0) {
      gaps.push({ rationale: `Verified fact "${fact.label}" has no document source citations.` });
    }
    const importantWithoutLink = [...input.importantDocumentIds].filter(
      (docId) => !sourceDocIds.has(docId),
    );
    if (importantWithoutLink.length > 0 && sources.length > 0) {
      gaps.push({
        rationale: `${importantWithoutLink.length} important document(s) are not cited for fact "${fact.label}".`,
      });
    }

    issues.push({
      issueKey: fact.factKey,
      label: `${fact.label}: ${fact.value}`,
      supporting,
      contrary,
      gaps,
    });
  }

  for (const event of input.events) {
    const sources = input.eventSources.filter((s) => s.timelineEventId === event.id);
    if (sources.length === 0) continue;
    const alreadyCovered = issues.some((i) =>
      i.supporting.some((s) => s.kind === "timeline_event" && s.id === event.id),
    );
    if (alreadyCovered) continue;

    issues.push({
      issueKey: `event:${event.id}`,
      label: event.title,
      supporting: sources.map((s) => ({
        kind: "timeline_event_source",
        id: event.id,
        rationale: s.supportingText,
      })),
      contrary: input.contradictionFindings
        .filter((f) =>
          input.contradictionSources.some(
            (s) => s.findingId === f.id && sources.some((es) => es.documentId === s.documentId),
          ),
        )
        .map((f) => ({
          kind: "analysis_finding",
          id: f.id,
          rationale: f.explanation ?? f.title,
        })),
      gaps: event.description
        ? []
        : [{ rationale: `Timeline event "${event.title}" has no description on record.` }],
    });
  }

  return { issues };
}

export async function markDocumentImportant(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  documentId: string;
  important: boolean;
  userId: string;
}) {
  const [doc] = await params.db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.id, params.documentId),
        eq(documents.organizationId, params.organizationId),
        eq(documents.matterId, params.matterId),
      ),
    )
    .limit(1);
  if (!doc) throw new Error("Document not found in matter scope");

  const state = await ensureReviewState({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    documentId: params.documentId,
  });

  const now = new Date();
  const [updated] = await params.db
    .update(documentReviewStates)
    .set({
      important: params.important,
      reviewedByUserId: params.userId,
      reviewedAt: now,
      updatedAt: now,
    })
    .where(eq(documentReviewStates.id, state.id))
    .returning();

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: params.important
      ? "evidence.document_marked_important"
      : "evidence.document_unmarked_important",
    targetType: "document",
    targetId: params.documentId,
    metadata: { important: params.important },
  });

  return updated!;
}
