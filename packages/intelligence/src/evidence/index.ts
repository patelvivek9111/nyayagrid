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
  matterEntities,
  matterFactSources,
  matterFacts,
  timelineEventSources,
  timelineEvents,
} from "@nyayagrid/database";
import { writeAuditEvent } from "@nyayagrid/permissions";
import { ensureReviewState } from "../discovery/index";

const APPROVED = ["approved", "edited_and_approved"] as const;

export type EvidenceTrustClass =
  | "source_evidence"
  | "reviewed_intelligence"
  | "user_assertion"
  | "disputed";

export type EvidenceMatrixCitation = {
  kind: string;
  id: string;
  rationale: string;
  documentId: string | null;
  documentVersionId: string | null;
  chunkId: string | null;
  status: string | null;
  trustClass: EvidenceTrustClass;
  origin: string | null;
};

export type EvidenceMatrixEntry = {
  issueKey: string;
  label: string;
  supporting: EvidenceMatrixCitation[];
  contrary: EvidenceMatrixCitation[];
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

  const approvedEntities = await params.db
    .select({ id: matterEntities.id })
    .from(matterEntities)
    .where(
      and(
        eq(matterEntities.organizationId, params.organizationId),
        eq(matterEntities.matterId, params.matterId),
        inArray(matterEntities.status, [...APPROVED]),
      ),
    );
  const approvedEntityIds = new Set(approvedEntities.map((row) => row.id));
  const reviewedEntitySrc = entitySrc.filter((s) => approvedEntityIds.has(s.entityId));

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
              eq(analysisFindings.status, "reviewed"),
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
    const linkedEntities = reviewedEntitySrc
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
    facts: verifiedFacts.map((f) => ({
      id: f.id,
      factKey: f.factKey,
      label: f.label,
      value: f.value,
      origin: f.origin,
      status: f.status,
      uncertaintyNotes: f.uncertaintyNotes,
    })),
    factSources,
    events: verifiedEvents.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      origin: e.origin,
      status: e.status,
      datePrecision: e.datePrecision,
      uncertaintyNotes: e.uncertaintyNotes,
    })),
    eventSources,
    contradictionFindings: contradictionFindings.map((f) => ({
      id: f.id,
      title: f.title,
      explanation: f.explanation,
      findingType: f.findingType,
      status: f.status,
    })),
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

function sourceTrust(origin: string | null | undefined): EvidenceTrustClass {
  return origin === "user" ? "user_assertion" : "source_evidence";
}

function findingTrust(findingType: string): EvidenceTrustClass {
  const type = findingType.toLowerCase();
  if (type.includes("tension") || type.includes("disput")) return "disputed";
  return "reviewed_intelligence";
}

function citationFromSource(params: {
  kind: string;
  id: string;
  rationale: string;
  documentId?: string | null;
  documentVersionId?: string | null;
  chunkId?: string | null;
  status?: string | null;
  trustClass: EvidenceTrustClass;
  origin?: string | null;
}): EvidenceMatrixCitation {
  return {
    kind: params.kind,
    id: params.id,
    rationale: params.rationale,
    documentId: params.documentId ?? null,
    documentVersionId: params.documentVersionId ?? null,
    chunkId: params.chunkId ?? null,
    status: params.status ?? null,
    trustClass: params.trustClass,
    origin: params.origin ?? null,
  };
}

export function buildEvidenceMatrix(input: {
  facts: Array<{
    id: string;
    factKey: string;
    label: string;
    value: string;
    origin?: string | null;
    status?: string | null;
    uncertaintyNotes?: string | null;
  }>;
  factSources: Array<{
    matterFactId: string;
    documentId: string;
    documentVersionId?: string | null;
    chunkId?: string | null;
    supportingText: string;
  }>;
  events: Array<{
    id: string;
    title: string;
    description: string | null;
    origin?: string | null;
    status?: string | null;
    datePrecision?: string | null;
    uncertaintyNotes?: string | null;
  }>;
  eventSources: Array<{
    timelineEventId: string;
    documentId: string;
    documentVersionId?: string | null;
    chunkId?: string | null;
    supportingText: string;
  }>;
  contradictionFindings: Array<{
    id: string;
    title: string;
    explanation: string | null;
    findingType: string;
    status?: string | null;
  }>;
  contradictionSources: Array<{
    findingId: string;
    documentId: string;
    documentVersionId?: string | null;
    chunkId: string;
    supportingText: string;
    side: string | null;
  }>;
  importantDocumentIds: Set<string>;
}): { issues: EvidenceMatrixEntry[] } {
  const issues: EvidenceMatrixEntry[] = [];
  const attachedFindingIds = new Set<string>();

  function contraryForChunks(chunkIds: Set<string>): EvidenceMatrixCitation[] {
    const contrary: EvidenceMatrixCitation[] = [];
    for (const finding of input.contradictionFindings) {
      const findingSources = input.contradictionSources.filter((s) => s.findingId === finding.id);
      const overlapping = findingSources.filter((s) => chunkIds.has(s.chunkId));
      if (overlapping.length === 0) continue;
      attachedFindingIds.add(finding.id);
      const trust = findingTrust(finding.findingType);
      for (const s of overlapping) {
        const side = s.side ? ` [${s.side}]` : "";
        contrary.push(
          citationFromSource({
            kind: "analysis_finding",
            id: finding.id,
            rationale: `${finding.findingType}${side}: ${s.supportingText}`,
            documentId: s.documentId,
            documentVersionId: s.documentVersionId,
            chunkId: s.chunkId,
            status: finding.status ?? "reviewed",
            trustClass: trust,
            origin: "ai",
          }),
        );
      }
    }
    return contrary;
  }

  for (const fact of input.facts) {
    const sources = input.factSources.filter((s) => s.matterFactId === fact.id);
    const sourceDocIds = new Set(sources.map((s) => s.documentId));
    const chunkIds = new Set(sources.map((s) => s.chunkId).filter(Boolean) as string[]);
    const origin = fact.origin ?? "ai";
    const trust = sourceTrust(origin);
    const uncertainty = fact.uncertaintyNotes ? ` (uncertainty: ${fact.uncertaintyNotes})` : "";
    const userMark = origin === "user" ? "User assertion — " : "";

    const supporting = sources.map((s) =>
      citationFromSource({
        kind: "fact_source",
        id: fact.id,
        rationale: s.supportingText,
        documentId: s.documentId,
        documentVersionId: s.documentVersionId,
        chunkId: s.chunkId,
        status: fact.status ?? "approved",
        trustClass: trust,
        origin,
      }),
    );

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
      label: `${userMark}${fact.label}: ${fact.value}${uncertainty}`,
      supporting,
      contrary: contraryForChunks(chunkIds),
      gaps,
    });
  }

  for (const event of input.events) {
    const sources = input.eventSources.filter((s) => s.timelineEventId === event.id);
    if (sources.length === 0) continue;
    const chunkIds = new Set(sources.map((s) => s.chunkId).filter(Boolean) as string[]);
    const origin = event.origin ?? "ai";
    const precision =
      event.datePrecision && event.datePrecision !== "exact"
        ? ` (date ${event.datePrecision})`
        : "";
    const uncertainty = event.uncertaintyNotes ? ` (uncertainty: ${event.uncertaintyNotes})` : "";
    const userMark = origin === "user" ? "User assertion — " : "";

    issues.push({
      issueKey: `event:${event.id}`,
      label: `${userMark}${event.title}${precision}${uncertainty}`,
      supporting: sources.map((s) =>
        citationFromSource({
          kind: "timeline_event_source",
          id: event.id,
          rationale: s.supportingText,
          documentId: s.documentId,
          documentVersionId: s.documentVersionId,
          chunkId: s.chunkId,
          status: event.status ?? "approved",
          trustClass: sourceTrust(origin),
          origin,
        }),
      ),
      contrary: contraryForChunks(chunkIds),
      gaps: event.description
        ? []
        : [{ rationale: `Timeline event "${event.title}" has no description on record.` }],
    });
  }

  for (const finding of input.contradictionFindings) {
    if (attachedFindingIds.has(finding.id)) continue;
    const findingSources = input.contradictionSources.filter((s) => s.findingId === finding.id);
    if (findingSources.length === 0) continue;
    const trust = findingTrust(finding.findingType);
    const sideA = findingSources.filter((s) => (s.side ?? "A").toUpperCase().startsWith("A"));
    const sideB = findingSources.filter((s) => (s.side ?? "").toUpperCase().startsWith("B"));
    const unsided = findingSources.filter(
      (s) => !sideA.includes(s) && !sideB.includes(s),
    );
    issues.push({
      issueKey: `finding:${finding.id}`,
      label: `${finding.findingType}: ${finding.title}`,
      supporting: [...sideA, ...unsided].map((s) =>
        citationFromSource({
          kind: "analysis_finding",
          id: finding.id,
          rationale: s.supportingText,
          documentId: s.documentId,
          documentVersionId: s.documentVersionId,
          chunkId: s.chunkId,
          status: finding.status ?? "reviewed",
          trustClass: trust,
          origin: "ai",
        }),
      ),
      contrary: sideB.map((s) =>
        citationFromSource({
          kind: "analysis_finding",
          id: finding.id,
          rationale: s.supportingText,
          documentId: s.documentId,
          documentVersionId: s.documentVersionId,
          chunkId: s.chunkId,
          status: finding.status ?? "reviewed",
          trustClass: trust,
          origin: "ai",
        }),
      ),
      gaps: [],
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
