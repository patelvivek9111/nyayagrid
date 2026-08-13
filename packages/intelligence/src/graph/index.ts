import { and, eq, inArray, or } from "@nyayagrid/database";
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
  graphRelationshipExtractionSchema,
  GRAPH_RELATIONSHIP_PROMPT_VERSION,
  type AIProvider,
} from "@nyayagrid/ai";
import { writeAuditEvent } from "@nyayagrid/permissions";
import { loadAuthorizedChunks, resolveValidatedSources } from "../provenance";
import { upsertGraphEdge } from "./materialize";
import { attorneyBadgeKind } from "../review-status";

export async function extractGraphRelationshipCandidates(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  userId?: string | null;
  ai?: AIProvider;
}) {
  const ai = params.ai ?? createAIProviderFromEnv();
  const nodes = await params.db
    .select()
    .from(graphNodes)
    .where(
      and(
        eq(graphNodes.organizationId, params.organizationId),
        eq(graphNodes.matterId, params.matterId),
        inArray(graphNodes.status, ["approved", "edited_and_approved"]),
      ),
    )
    .limit(40);

  const chunks = await params.db
    .select()
    .from(documentChunks)
    .where(
      and(
        eq(documentChunks.organizationId, params.organizationId),
        eq(documentChunks.matterId, params.matterId),
      ),
    )
    .limit(24);

  const generation = await ai.generate({
    temperature: 0,
    schemaName: "graph_relationship_extraction",
    messages: [
      { role: "system", content: buildGraphRelationshipSystemPrompt() },
      {
        role: "user",
        content: buildGraphRelationshipUserPrompt({
          nodes: nodes.map((n) => ({
            canonicalEntityType: n.canonicalEntityType,
            canonicalEntityId: n.canonicalEntityId,
            nodeType: n.nodeType,
            displayName: n.displayName,
          })),
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
  const parsed = graphRelationshipExtractionSchema.parse(raw);
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
    else proposed += 1;
  }

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId ?? null,
    matterId: params.matterId,
    action: "graph.relationships_extracted",
    targetType: "matter",
    targetId: params.matterId,
    metadata: { proposed, merged, rejected, provider: generation.provider },
  });

  return { proposed, merged, rejected, provider: generation.provider, model: generation.model };
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
    status: "approved",
    confidence: "high",
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
  return result.edge;
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
    selected = selected
      .map((e) => ({
        edge: e,
        score: tokens.reduce(
          (sum, t) =>
            sum +
            (e.fromName.toLowerCase().includes(t) ? 2 : 0) +
            (e.toName.toLowerCase().includes(t) ? 2 : 0) +
            (e.relationshipType.includes(t) ? 1 : 0),
          0,
        ),
      }))
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
