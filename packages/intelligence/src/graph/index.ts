import { and, asc, eq, inArray, or, sql } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import {
  graphNodes,
  graphEdges,
  graphEdgeSources,
  documentChunks,
  documents,
} from "@nyayagrid/database";
import {
  createAIProviderFromEnv,
  buildGraphRelationshipSystemPrompt,
  buildGraphRelationshipUserPrompt,
  parseGraphRelationshipExtraction,
  GRAPH_RELATIONSHIP_PROMPT_VERSION,
  type AIProvider,
} from "@nyayagrid/ai";
import { writeAuditEvent } from "@nyayagrid/permissions";
import { checkpointCreatedLegalWork, trackLiveChange } from "../recovery";
import { loadAuthorizedChunks, resolveValidatedSources } from "../provenance";
import { upsertGraphEdge } from "./materialize";
import { attorneyBadgeKind } from "../review-status";
import {
  GRAPH_EXTRACT_CHUNK_CANDIDATE_SOFT_CAP,
  GRAPH_EXTRACT_CHUNK_CAP,
  GRAPH_EXTRACT_NODE_CAP,
  GraphFocusRejectedError,
  buildGraphExtractionCoverage,
  degreeMapFromEdges,
  neighborhoodIdsFromFocus,
  preferredDocumentIdsFromNodes,
  selectChunksForGraphExtraction,
  selectNodesForGraphExtraction,
  type GraphExtractionCoverage,
  type GraphSelectionMode,
  type SelectableChunk,
  type SelectableGraphNode,
} from "./selection";

export {
  GRAPH_EXTRACT_CHUNK_CANDIDATE_SOFT_CAP,
  GRAPH_EXTRACT_CHUNK_CAP,
  GRAPH_EXTRACT_MAX_CHUNKS_PER_DOC,
  GRAPH_EXTRACT_NODE_CAP,
  GraphFocusRejectedError,
  buildGraphExtractionCoverage,
  selectChunksForGraphExtraction,
  selectNodesForGraphExtraction,
  scoreGraphNodeForExtraction,
  type GraphExtractionCoverage,
  type GraphSelectionMode,
} from "./selection";

export async function extractGraphRelationshipCandidates(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  userId?: string | null;
  ai?: AIProvider;
  /** Optional focus node for FOCUSED extraction. Foreign IDs are rejected. */
  focusNodeId?: string | null;
}) {
  const eligibleNodes = await params.db
    .select()
    .from(graphNodes)
    .where(
      and(
        eq(graphNodes.organizationId, params.organizationId),
        eq(graphNodes.matterId, params.matterId),
        inArray(graphNodes.status, ["approved", "edited_and_approved"]),
      ),
    );

  let selectionMode: GraphSelectionMode = "WHOLE_MATTER";
  let focusNodeId: string | null = null;
  let neighborhoodIds: Set<string> | undefined;

  if (params.focusNodeId) {
    const [focusRow] = await params.db
      .select({
        id: graphNodes.id,
        organizationId: graphNodes.organizationId,
        matterId: graphNodes.matterId,
        status: graphNodes.status,
      })
      .from(graphNodes)
      .where(eq(graphNodes.id, params.focusNodeId))
      .limit(1);

    if (!focusRow) {
      // Missing/deleted focus: safe fallback to whole-matter.
      selectionMode = "WHOLE_MATTER";
      focusNodeId = null;
    } else if (
      focusRow.organizationId !== params.organizationId ||
      focusRow.matterId !== params.matterId
    ) {
      throw new GraphFocusRejectedError("Focus node is not in this matter");
    } else if (
      focusRow.status === "approved" ||
      focusRow.status === "edited_and_approved"
    ) {
      selectionMode = "FOCUSED";
      focusNodeId = focusRow.id;
    } else {
      // Focus exists in matter but is not eligible for extraction — safe fallback.
      selectionMode = "WHOLE_MATTER";
      focusNodeId = null;
    }
  }

  const edgeRows = await params.db
    .select({
      fromNodeId: graphEdges.fromNodeId,
      toNodeId: graphEdges.toNodeId,
    })
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.organizationId, params.organizationId),
        eq(graphEdges.matterId, params.matterId),
        inArray(graphEdges.status, ["approved", "edited_and_approved", "proposed"]),
      ),
    );

  const degreeByNodeId = degreeMapFromEdges(edgeRows);
  if (focusNodeId) {
    neighborhoodIds = neighborhoodIdsFromFocus(focusNodeId, edgeRows);
  }

  // Batched source-support counts for connectivity (one query, not per-node).
  const sourceSupportByNodeId = new Map<string, number>();
  if (edgeRows.length > 0) {
    const supportRows = await params.db
      .select({
        fromNodeId: graphEdges.fromNodeId,
        toNodeId: graphEdges.toNodeId,
        sourceCount: sql<number>`count(${graphEdgeSources.id})::int`,
      })
      .from(graphEdges)
      .leftJoin(graphEdgeSources, eq(graphEdgeSources.graphEdgeId, graphEdges.id))
      .where(
        and(
          eq(graphEdges.organizationId, params.organizationId),
          eq(graphEdges.matterId, params.matterId),
        ),
      )
      .groupBy(graphEdges.fromNodeId, graphEdges.toNodeId);

    for (const row of supportRows) {
      const n = Number(row.sourceCount) || 0;
      if (n <= 0) continue;
      sourceSupportByNodeId.set(
        row.fromNodeId,
        (sourceSupportByNodeId.get(row.fromNodeId) ?? 0) + n,
      );
      sourceSupportByNodeId.set(
        row.toNodeId,
        (sourceSupportByNodeId.get(row.toNodeId) ?? 0) + n,
      );
    }
  }

  const selectableCandidates: SelectableGraphNode[] = eligibleNodes.map((n) => ({
    id: n.id,
    nodeType: n.nodeType,
    displayName: n.displayName,
    canonicalEntityType: n.canonicalEntityType,
    canonicalEntityId: n.canonicalEntityId,
  }));

  const selectedNodeRefs = selectNodesForGraphExtraction({
    candidates: selectableCandidates,
    cap: GRAPH_EXTRACT_NODE_CAP,
    selectionMode,
    focusNodeId,
    neighborhoodIds,
    degreeByNodeId,
    sourceSupportByNodeId,
  });
  const selectedNodeIdSet = new Set(selectedNodeRefs.map((n) => n.id));
  const nodes = eligibleNodes.filter((n) => selectedNodeIdSet.has(n.id));

  const preferredDocIds = preferredDocumentIdsFromNodes(selectedNodeRefs);

  // Batched: documents that already source edges touching selected nodes.
  if (selectedNodeRefs.length > 0) {
    const linkedSourceDocs = await params.db
      .selectDistinct({ documentId: graphEdgeSources.documentId })
      .from(graphEdgeSources)
      .innerJoin(graphEdges, eq(graphEdges.id, graphEdgeSources.graphEdgeId))
      .where(
        and(
          eq(graphEdgeSources.organizationId, params.organizationId),
          eq(graphEdgeSources.matterId, params.matterId),
          or(
            inArray(graphEdges.fromNodeId, [...selectedNodeIdSet]),
            inArray(graphEdges.toNodeId, [...selectedNodeIdSet]),
          ),
        ),
      );
    for (const row of linkedSourceDocs) {
      preferredDocIds.add(row.documentId);
    }
  }

  const [chunkCountRow] = await params.db
    .select({ count: sql<number>`count(*)::int` })
    .from(documentChunks)
    .where(
      and(
        eq(documentChunks.organizationId, params.organizationId),
        eq(documentChunks.matterId, params.matterId),
      ),
    );
  const candidateChunkCount = Number(chunkCountRow?.count) || 0;

  // Bounded candidate pull: prefer preferred docs, else soft-capped whole-matter scan.
  let chunkCandidatesRaw: Array<{
    id: string;
    documentId: string;
    chunkIndex: number;
    content: string;
  }> = [];

  const preferredList = [...preferredDocIds];
  if (preferredList.length > 0) {
    chunkCandidatesRaw = await params.db
      .select({
        id: documentChunks.id,
        documentId: documentChunks.documentId,
        chunkIndex: documentChunks.chunkIndex,
        content: documentChunks.content,
      })
      .from(documentChunks)
      .where(
        and(
          eq(documentChunks.organizationId, params.organizationId),
          eq(documentChunks.matterId, params.matterId),
          inArray(documentChunks.documentId, preferredList),
        ),
      )
      .orderBy(asc(documentChunks.documentId), asc(documentChunks.chunkIndex))
      .limit(GRAPH_EXTRACT_CHUNK_CANDIDATE_SOFT_CAP);
  }

  if (chunkCandidatesRaw.length < GRAPH_EXTRACT_CHUNK_CAP) {
    const extra = await params.db
      .select({
        id: documentChunks.id,
        documentId: documentChunks.documentId,
        chunkIndex: documentChunks.chunkIndex,
        content: documentChunks.content,
      })
      .from(documentChunks)
      .where(
        and(
          eq(documentChunks.organizationId, params.organizationId),
          eq(documentChunks.matterId, params.matterId),
        ),
      )
      .orderBy(asc(documentChunks.documentId), asc(documentChunks.chunkIndex))
      .limit(GRAPH_EXTRACT_CHUNK_CANDIDATE_SOFT_CAP);
    const seen = new Set(chunkCandidatesRaw.map((c) => c.id));
    for (const row of extra) {
      if (seen.has(row.id)) continue;
      chunkCandidatesRaw.push(row);
      seen.add(row.id);
      if (chunkCandidatesRaw.length >= GRAPH_EXTRACT_CHUNK_CANDIDATE_SOFT_CAP) break;
    }
  }

  const selectableChunks: SelectableChunk[] = chunkCandidatesRaw;
  const selectedChunks = selectChunksForGraphExtraction({
    candidates: selectableChunks,
    preferredDocumentIds: preferredDocIds,
    cap: GRAPH_EXTRACT_CHUNK_CAP,
  });
  const chunks = selectedChunks;

  const coverage = buildGraphExtractionCoverage({
    candidateNodes: eligibleNodes.length,
    selectedNodes: nodes.length,
    candidateChunks: candidateChunkCount,
    selectedChunks: chunks.length,
    selectionMode,
    domainsRepresented: [...new Set(nodes.map((n) => n.nodeType))],
  });

  const nodeRefs = nodes.map((n) => ({
    canonicalEntityType: n.canonicalEntityType,
    canonicalEntityId: n.canonicalEntityId,
    nodeType: n.nodeType,
    displayName: n.displayName,
  }));

  if (nodes.length === 0) {
    await writeAuditEvent(params.db, {
      organizationId: params.organizationId,
      actorUserId: params.userId ?? null,
      matterId: params.matterId,
      action: "graph.relationships_extracted",
      targetType: "matter",
      targetId: params.matterId,
      metadata: {
        proposed: 0,
        merged: 0,
        rejected: 0,
        skipped: "no_verified_nodes",
        coverage,
      },
    });
    return {
      proposed: 0,
      merged: 0,
      rejected: 0,
      provider: "none",
      model: "none",
      skipped: "no_verified_nodes" as const,
      coverage,
    };
  }

  const ai = params.ai ?? createAIProviderFromEnv();
  const generation = await ai.generate({
    temperature: 0,
    schemaName: "graph_relationship_extraction",
    routing: {
      subsystem: "graph",
      strategy: "standard",
      organizationId: params.organizationId,
      matterId: params.matterId,
    },
    messages: [
      { role: "system", content: buildGraphRelationshipSystemPrompt() },
      {
        role: "user",
        content: buildGraphRelationshipUserPrompt({
          nodes: nodeRefs,
          chunks: chunks.map((c) => ({ chunkId: c.id, content: c.content })),
        }),
      },
    ],
  });

  let raw: unknown;
  try {
    raw = JSON.parse(generation.text);
  } catch {
    raw = { relationships: [] };
  }
  const parsed = parseGraphRelationshipExtraction(raw, nodeRefs);
  const authorized = await loadAuthorizedChunks(params.db, {
    organizationId: params.organizationId,
    matterId: params.matterId,
    chunkIds: parsed.relationships.flatMap((r) => r.sourceChunkIds),
  });

  const nodeByCanonical = new Map(
    nodes.map((n) => [`${n.canonicalEntityType}:${n.canonicalEntityId}`, n]),
  );

  let proposed = 0;
  let merged = 0;
  let rejected = 0;
  const proposedEdgeIds: string[] = [];

  for (const rel of parsed.relationships) {
    const from = nodeByCanonical.get(`${rel.fromCanonicalType}:${rel.fromCanonicalId}`);
    const to = nodeByCanonical.get(`${rel.toCanonicalType}:${rel.toCanonicalId}`);
    if (!from || !to || from.id === to.id) {
      rejected += 1;
      continue;
    }
    const sources = resolveValidatedSources({
      organizationId: params.organizationId,
      matterId: params.matterId,
      sourceChunkIds: rel.sourceChunkIds,
      sourceQuotes: rel.sourceQuotes,
      authorized,
    });
    if (sources.length === 0) {
      rejected += 1;
      continue;
    }
    const result = await upsertGraphEdge({
      db: params.db,
      organizationId: params.organizationId,
      matterId: params.matterId,
      fromNodeId: from.id,
      toNodeId: to.id,
      relationshipType: rel.relationshipType,
      label: rel.label ?? null,
      origin: "ai",
      status: "proposed",
      confidence: rel.confidence,
      userId: params.userId,
      metadata: {
        promptVersion: GRAPH_RELATIONSHIP_PROMPT_VERSION,
        uncertaintyNotes: rel.uncertaintyNotes ?? null,
      },
      sources,
    });
    if (result.merged) merged += 1;
    else {
      proposed += 1;
      if (result.edge?.id) proposedEdgeIds.push(result.edge.id);
    }
  }

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId ?? null,
    matterId: params.matterId,
    action: "graph.relationships_extracted",
    targetType: "matter",
    targetId: params.matterId,
    metadata: {
      proposed,
      merged,
      rejected,
      provider: generation.provider,
      coverage,
      focusNodeId,
    },
  });

  if (params.userId && proposedEdgeIds.length > 0) {
    await checkpointCreatedLegalWork({
      db: params.db,
      organizationId: params.organizationId,
      matterId: params.matterId,
      actorUserId: params.userId,
      reason: "AI graph relationship extraction",
      source: "ai",
      objects: proposedEdgeIds.map((objectId) => ({
        objectType: "graph_edge" as const,
        objectId,
      })),
    });
  }

  return {
    proposed,
    merged,
    rejected,
    provider: generation.provider,
    model: generation.model,
    coverage,
  };
}

export async function reviewGraphEdge(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  edgeId: string;
  userId: string;
  action: "approve" | "edit_and_approve" | "reject";
  rejectionReason?: string | null;
  edits?: { label?: string | null; relationshipType?: string };
}) {
  if (params.action !== "reject") {
    const [edge] = await params.db
      .select()
      .from(graphEdges)
      .where(eq(graphEdges.id, params.edgeId))
      .limit(1);
    if (edge?.origin === "ai") {
      const sources = await params.db
        .select()
        .from(graphEdgeSources)
        .where(eq(graphEdgeSources.graphEdgeId, params.edgeId))
        .limit(1);
      if (sources.length === 0) {
        throw new Error("Cannot approve an AI graph edge without source provenance");
      }
    }
  }

  const now = new Date();
  const status =
    params.action === "reject"
      ? "rejected"
      : params.action === "edit_and_approve"
        ? "edited_and_approved"
        : "approved";

  const [updated] = await params.db
    .update(graphEdges)
    .set({
      status,
      ...(params.edits?.label !== undefined ? { label: params.edits.label } : {}),
      ...(params.edits?.relationshipType
        ? { relationshipType: params.edits.relationshipType }
        : {}),
      approvedByUserId: status === "rejected" ? null : params.userId,
      approvedAt: status === "rejected" ? null : now,
      rejectedByUserId: status === "rejected" ? params.userId : null,
      rejectedAt: status === "rejected" ? now : null,
      rejectionReason: status === "rejected" ? (params.rejectionReason ?? null) : null,
      updatedAt: now,
    })
    .where(
      and(
        eq(graphEdges.id, params.edgeId),
        eq(graphEdges.organizationId, params.organizationId),
        eq(graphEdges.matterId, params.matterId),
      ),
    )
    .returning();
  if (!updated) throw new Error("Graph edge not found in matter scope");

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: `graph_edge.${params.action}`,
    targetType: "graph_edge",
    targetId: params.edgeId,
  });
  await trackLiveChange(params.db, {
    organizationId: params.organizationId,
    matterId: params.matterId,
    actorUserId: params.userId,
    objectType: "graph_edge",
    objectId: params.edgeId,
    operation: params.action === "reject" ? "reject" : params.action === "approve" ? "approve" : "review",
    source: "user",
  });
  return updated;
}

export async function createManualGraphEdge(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  userId: string;
  fromNodeId: string;
  toNodeId: string;
  relationshipType: string;
  label?: string | null;
}) {
  const nodes = await params.db
    .select()
    .from(graphNodes)
    .where(
      and(
        eq(graphNodes.organizationId, params.organizationId),
        eq(graphNodes.matterId, params.matterId),
        inArray(graphNodes.id, [params.fromNodeId, params.toNodeId]),
      ),
    );
  if (nodes.length !== 2 && params.fromNodeId !== params.toNodeId) {
    throw new Error("Graph nodes must belong to the matter");
  }
  if (params.fromNodeId === params.toNodeId) {
    throw new Error("Cannot create a self-relationship");
  }

  const result = await upsertGraphEdge({
    db: params.db,
    organizationId: params.organizationId,
    matterId: params.matterId,
    fromNodeId: params.fromNodeId,
    toNodeId: params.toNodeId,
    relationshipType: params.relationshipType,
    label: params.label ?? null,
    origin: "manual",
    status: "proposed",
    confidence: "medium",
    userId: params.userId,
  });

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "graph_edge.manual_created",
    targetType: "graph_edge",
    targetId: result.edge.id,
  });
  await trackLiveChange(params.db, {
    organizationId: params.organizationId,
    matterId: params.matterId,
    actorUserId: params.userId,
    objectType: "graph_edge",
    objectId: result.edge.id,
    operation: "create",
    source: "user",
  });
  return result.edge;
}

export async function updateGraphNode(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  nodeId: string;
  userId: string;
  displayName?: string;
  metadata?: Record<string, unknown>;
}) {
  const [updated] = await params.db
    .update(graphNodes)
    .set({
      ...(params.displayName !== undefined ? { displayName: params.displayName } : {}),
      metadata: {
        ...(params.metadata ?? {}),
        semanticOverride: true,
      },
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(graphNodes.id, params.nodeId),
        eq(graphNodes.organizationId, params.organizationId),
        eq(graphNodes.matterId, params.matterId),
      ),
    )
    .returning();
  if (!updated) throw new Error("Graph node not found in matter scope");
  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "graph_node.updated",
    targetType: "graph_node",
    targetId: params.nodeId,
  });
  await trackLiveChange(params.db, {
    organizationId: params.organizationId,
    matterId: params.matterId,
    actorUserId: params.userId,
    objectType: "graph_node",
    objectId: params.nodeId,
    operation: "update",
    source: "user",
  });
  return updated;
}

export async function getGraphNeighborhood(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  nodeId: string;
  relationshipTypes?: string[];
  statuses?: Array<"proposed" | "approved" | "edited_and_approved" | "rejected">;
}) {
  const [center] = await params.db
    .select()
    .from(graphNodes)
    .where(
      and(
        eq(graphNodes.id, params.nodeId),
        eq(graphNodes.organizationId, params.organizationId),
        eq(graphNodes.matterId, params.matterId),
      ),
    )
    .limit(1);
  if (!center) return null;

  const statuses = params.statuses ?? ["approved", "edited_and_approved"];
  const edgeConditions = [
    eq(graphEdges.organizationId, params.organizationId),
    eq(graphEdges.matterId, params.matterId),
    inArray(graphEdges.status, statuses),
    or(eq(graphEdges.fromNodeId, params.nodeId), eq(graphEdges.toNodeId, params.nodeId)),
  ];

  let edges = await params.db
    .select()
    .from(graphEdges)
    .where(and(...edgeConditions));

  if (params.relationshipTypes?.length) {
    edges = edges.filter((e) => params.relationshipTypes!.includes(e.relationshipType));
  }

  const neighborIds = [
    ...new Set(
      edges.flatMap((e) => [e.fromNodeId, e.toNodeId]).filter((id) => id !== params.nodeId),
    ),
  ];
  const neighbors =
    neighborIds.length === 0
      ? []
      : await params.db
          .select()
          .from(graphNodes)
          .where(
            and(
              eq(graphNodes.organizationId, params.organizationId),
              eq(graphNodes.matterId, params.matterId),
              inArray(graphNodes.id, neighborIds),
            ),
          );

  const edgeIds = edges.map((e) => e.id);
  const sources =
    edgeIds.length === 0
      ? []
      : await params.db
          .select()
          .from(graphEdgeSources)
          .where(inArray(graphEdgeSources.graphEdgeId, edgeIds));

  const documentIds = [...new Set(sources.map((s) => s.documentId))];
  const docs =
    documentIds.length === 0
      ? []
      : await params.db
          .select({ id: documents.id, title: documents.title })
          .from(documents)
          .where(inArray(documents.id, documentIds));
  const titleByDoc = new Map(docs.map((d) => [d.id, d.title]));

  return {
    center,
    neighbors,
    edges: edges.map((e) => ({
      ...e,
      badge: attorneyBadgeKind(e.status),
      sources: sources
        .filter((s) => s.graphEdgeId === e.id)
        .map((s) => ({
          ...s,
          documentTitle: titleByDoc.get(s.documentId) ?? "Case document",
        })),
    })),
  };
}

export async function listGraph(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  nodeType?: string;
  q?: string;
  edgeStatus?: string;
}) {
  let nodes = await params.db
    .select()
    .from(graphNodes)
    .where(
      and(
        eq(graphNodes.organizationId, params.organizationId),
        eq(graphNodes.matterId, params.matterId),
      ),
    );
  if (params.nodeType) nodes = nodes.filter((n) => n.nodeType === params.nodeType);
  if (params.q) {
    const q = params.q.toLowerCase();
    nodes = nodes.filter((n) => n.displayName.toLowerCase().includes(q));
  }

  const edgeStatus = params.edgeStatus ?? "approved,edited_and_approved";
  const statuses = edgeStatus.split(",") as Array<
    "proposed" | "approved" | "edited_and_approved" | "rejected"
  >;
  const edges = await params.db
    .select()
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.organizationId, params.organizationId),
        eq(graphEdges.matterId, params.matterId),
        inArray(graphEdges.status, statuses),
      ),
    );

  const proposedEdges = await params.db
    .select()
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.organizationId, params.organizationId),
        eq(graphEdges.matterId, params.matterId),
        eq(graphEdges.status, "proposed"),
      ),
    );

  const proposedIds = proposedEdges.map((e) => e.id);
  const proposedSources =
    proposedIds.length === 0
      ? []
      : await params.db
          .select()
          .from(graphEdgeSources)
          .where(inArray(graphEdgeSources.graphEdgeId, proposedIds));
  const documentIds = [...new Set(proposedSources.map((s) => s.documentId))];
  const docs =
    documentIds.length === 0
      ? []
      : await params.db
          .select({ id: documents.id, title: documents.title })
          .from(documents)
          .where(inArray(documents.id, documentIds));
  const titleByDoc = new Map(docs.map((d) => [d.id, d.title]));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  return {
    nodes,
    edges: edges.map((e) => ({
      ...e,
      badge: attorneyBadgeKind(e.status),
      fromName: nodeById.get(e.fromNodeId)?.displayName ?? e.fromNodeId,
      toName: nodeById.get(e.toNodeId)?.displayName ?? e.toNodeId,
    })),
    proposedEdges: proposedEdges.map((e) => ({
      ...e,
      badge: attorneyBadgeKind(e.status),
      fromName: nodeById.get(e.fromNodeId)?.displayName ?? e.fromNodeId,
      toName: nodeById.get(e.toNodeId)?.displayName ?? e.toNodeId,
      fromCanonicalEntityType: nodeById.get(e.fromNodeId)?.canonicalEntityType ?? null,
      toCanonicalEntityType: nodeById.get(e.toNodeId)?.canonicalEntityType ?? null,
      fromCanonicalEntityId: nodeById.get(e.fromNodeId)?.canonicalEntityId ?? null,
      toCanonicalEntityId: nodeById.get(e.toNodeId)?.canonicalEntityId ?? null,
      sources: proposedSources
        .filter((s) => s.graphEdgeId === e.id)
        .map((s) => ({
          ...s,
          documentTitle: titleByDoc.get(s.documentId) ?? "Case document",
        })),
    })),
  };
}

export function formatVerifiedGraphForPrompt(input: {
  edges: Array<{
    relationshipType: string;
    label?: string | null;
    status: string;
    fromName: string;
    toName: string;
  }>;
}): string {
  if (input.edges.length === 0) return "";
  return [
    "Verified relationships:",
    ...input.edges.map(
      (e) =>
        `- ${e.fromName} -[${e.relationshipType}]-> ${e.toName}${e.label ? ` (${e.label})` : ""}`,
    ),
  ].join("\n");
}

export async function loadVerifiedGraphContext(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  question?: string;
  limit?: number;
}) {
  const { nodes, edges } = await listGraph({
    ...params,
    edgeStatus: "approved,edited_and_approved",
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let selected = edges.map((e) => ({
    ...e,
    fromName: byId.get(e.fromNodeId)?.displayName ?? e.fromNodeId,
    toName: byId.get(e.toNodeId)?.displayName ?? e.toNodeId,
  }));

  if (params.question) {
    const tokens = params.question
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2);
    const civilQuestion =
      /(claim|counterclaim|defense|element|pleading|evidence|authority|waiver|breach)/i.test(
        params.question,
      );
    selected = selected
      .map((e) => {
        const fromNode = byId.get(e.fromNodeId);
        const toNode = byId.get(e.toNodeId);
        const civilBoost =
          civilQuestion &&
          (fromNode?.nodeType === "claim" ||
            fromNode?.nodeType === "defense" ||
            toNode?.nodeType === "claim" ||
            toNode?.nodeType === "defense")
            ? 3
            : 0;
        return {
          edge: e,
          score:
            civilBoost +
            tokens.reduce(
              (sum, t) =>
                sum +
                (e.fromName.toLowerCase().includes(t) ? 2 : 0) +
                (e.toName.toLowerCase().includes(t) ? 2 : 0) +
                (e.relationshipType.includes(t) ? 1 : 0),
              0,
            ),
        };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.edge);
  }

  selected = selected.slice(0, params.limit ?? 12);
  return {
    text: formatVerifiedGraphForPrompt({ edges: selected }),
    edges: selected,
    nodes,
  };
}
