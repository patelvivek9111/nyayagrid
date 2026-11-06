import { and, desc, eq, inArray } from "drizzle-orm";
import {
  criminalCases,
  prosecutionCharges,
  prosecutionChargeElements,
  prosecutionDefendants,
  prosecutionEvidenceItems,
  prosecutionGraphEdges,
  prosecutionGraphNodes,
  prosecutionWitnesses,
  type Database,
  type ProsecutionGraphNodeKind,
  type ProsecutionGraphReviewStatus,
  type RecordProvenance,
  PROSECUTION_GRAPH_NODE_KINDS,
} from "@nyayagrid/database";
import { requireAnyCapability, requireCapability, writeAuditEvent } from "@nyayagrid/permissions";
import { assertProvenance } from "../legal/standards";
import { ProsecutionError, assertTenant } from "./domain";

export type PublicProsecutionGraphNode = {
  id: string;
  nodeKind: string;
  canonicalEntityType: string;
  canonicalEntityId: string;
  displayName: string;
  provenance: RecordProvenance;
  origin: string;
  status: string;
  /** Proposed AI/projection nodes are never treated as verified entities. */
  isVerified: boolean;
};

export type PublicProsecutionGraphEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relationshipType: string;
  provenance: RecordProvenance;
  origin: string;
  status: string;
  confidence: string | null;
  isVerified: boolean;
};

async function authorize(
  db: Database,
  params: { userId: string; organizationId: string; action: "view" | "edit" },
) {
  if (params.action === "view") {
    await requireAnyCapability(db, {
      userId: params.userId,
      organizationId: params.organizationId,
      capabilities: ["prosecution.view", "prosecution.edit", "prosecution.review"],
    });
    return;
  }
  await requireCapability(db, {
    userId: params.userId,
    organizationId: params.organizationId,
    capability: "prosecution.edit",
  });
}

async function requireCase(db: Database, organizationId: string, caseId: string) {
  const [row] = await db
    .select()
    .from(criminalCases)
    .where(and(eq(criminalCases.id, caseId), eq(criminalCases.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new ProsecutionError("NOT_FOUND", "Criminal case not found.", 404);
  assertTenant(organizationId, row.organizationId);
  return row;
}

function provenanceOf(value: RecordProvenance): RecordProvenance {
  assertProvenance(value);
  return value;
}

function isNodeKind(value: string): value is ProsecutionGraphNodeKind {
  return (PROSECUTION_GRAPH_NODE_KINDS as readonly string[]).includes(value);
}

function presentNode(row: typeof prosecutionGraphNodes.$inferSelect): PublicProsecutionGraphNode {
  return {
    id: row.id,
    nodeKind: row.nodeKind,
    canonicalEntityType: row.canonicalEntityType,
    canonicalEntityId: row.canonicalEntityId,
    displayName: row.displayName,
    provenance: row.provenance,
    origin: row.origin,
    status: row.status,
    isVerified: row.status === "approved",
  };
}

function presentEdge(row: typeof prosecutionGraphEdges.$inferSelect): PublicProsecutionGraphEdge {
  return {
    id: row.id,
    fromNodeId: row.fromNodeId,
    toNodeId: row.toNodeId,
    relationshipType: row.relationshipType,
    provenance: row.provenance,
    origin: row.origin,
    status: row.status,
    confidence: row.confidence,
    isVerified: row.status === "approved",
  };
}

async function upsertNode(
  db: Database,
  params: {
    organizationId: string;
    criminalCaseId: string;
    nodeKind: ProsecutionGraphNodeKind;
    canonicalEntityType: string;
    canonicalEntityId: string;
    displayName: string;
    provenance: RecordProvenance;
    origin: "manual" | "projection" | "ai";
    status: ProsecutionGraphReviewStatus;
    userId: string | null;
  },
) {
  const [existing] = await db
    .select()
    .from(prosecutionGraphNodes)
    .where(
      and(
        eq(prosecutionGraphNodes.criminalCaseId, params.criminalCaseId),
        eq(prosecutionGraphNodes.canonicalEntityType, params.canonicalEntityType),
        eq(prosecutionGraphNodes.canonicalEntityId, params.canonicalEntityId),
      ),
    )
    .limit(1);
  if (existing) {
    const [updated] = await db
      .update(prosecutionGraphNodes)
      .set({
        displayName: params.displayName,
        provenance: params.provenance,
        updatedAt: new Date(),
      })
      .where(eq(prosecutionGraphNodes.id, existing.id))
      .returning();
    return updated!;
  }
  const [created] = await db
    .insert(prosecutionGraphNodes)
    .values({
      organizationId: params.organizationId,
      criminalCaseId: params.criminalCaseId,
      nodeKind: params.nodeKind,
      canonicalEntityType: params.canonicalEntityType,
      canonicalEntityId: params.canonicalEntityId,
      displayName: params.displayName,
      provenance: params.provenance,
      origin: params.origin,
      status: params.status,
      createdByUserId: params.userId,
    })
    .returning();
  return created!;
}

async function ensureEdge(
  db: Database,
  params: {
    organizationId: string;
    criminalCaseId: string;
    fromNodeId: string;
    toNodeId: string;
    relationshipType: string;
    provenance: RecordProvenance;
    origin: "manual" | "projection" | "ai";
    status: ProsecutionGraphReviewStatus;
    userId: string | null;
  },
) {
  const [existing] = await db
    .select()
    .from(prosecutionGraphEdges)
    .where(
      and(
        eq(prosecutionGraphEdges.criminalCaseId, params.criminalCaseId),
        eq(prosecutionGraphEdges.fromNodeId, params.fromNodeId),
        eq(prosecutionGraphEdges.toNodeId, params.toNodeId),
        eq(prosecutionGraphEdges.relationshipType, params.relationshipType),
      ),
    )
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(prosecutionGraphEdges)
    .values({
      organizationId: params.organizationId,
      criminalCaseId: params.criminalCaseId,
      fromNodeId: params.fromNodeId,
      toNodeId: params.toNodeId,
      relationshipType: params.relationshipType,
      provenance: params.provenance,
      origin: params.origin,
      status: params.status,
      createdByUserId: params.userId,
    })
    .returning();
  return created!;
}

export async function listProsecutionCaseGraph(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    caseId: string;
    status?: string | null;
  },
) {
  await authorize(db, {
    userId: params.userId,
    organizationId: params.organizationId,
    action: "view",
  });
  await requireCase(db, params.organizationId, params.caseId);

  const nodes = await db
    .select()
    .from(prosecutionGraphNodes)
    .where(
      and(
        eq(prosecutionGraphNodes.organizationId, params.organizationId),
        eq(prosecutionGraphNodes.criminalCaseId, params.caseId),
      ),
    )
    .orderBy(desc(prosecutionGraphNodes.updatedAt));

  const edgeConditions = [
    eq(prosecutionGraphEdges.organizationId, params.organizationId),
    eq(prosecutionGraphEdges.criminalCaseId, params.caseId),
  ];
  if (params.status?.trim()) {
    edgeConditions.push(eq(prosecutionGraphEdges.status, params.status.trim()));
  }
  const edges = await db
    .select()
    .from(prosecutionGraphEdges)
    .where(and(...edgeConditions))
    .orderBy(desc(prosecutionGraphEdges.updatedAt));

  return {
    nodes: nodes.map(presentNode),
    edges: edges.map(presentEdge),
    safety: {
      inventedVerifiedRelationships: false,
      guiltConclusion: null,
    },
  };
}

/**
 * Project case entities into persisted graph nodes/edges.
 * Source-backed rows from case tables become approved nodes; inferred edges stay proposed
 * unless relationship provenance is human-entered.
 */
export async function syncProsecutionCaseGraphProjection(
  db: Database,
  params: { userId: string; organizationId: string; caseId: string },
) {
  await authorize(db, {
    userId: params.userId,
    organizationId: params.organizationId,
    action: "edit",
  });
  const criminalCase = await requireCase(db, params.organizationId, params.caseId);
  const humanProv: RecordProvenance = {
    humanEntered: true,
    extractionOrigin: "human",
    sourceSpan: `case:${criminalCase.id}`,
  };

  const caseNode = await upsertNode(db, {
    organizationId: params.organizationId,
    criminalCaseId: params.caseId,
    nodeKind: "criminal_case",
    canonicalEntityType: "criminal_case",
    canonicalEntityId: criminalCase.id,
    displayName: criminalCase.caseNumber,
    provenance: humanProv,
    origin: "projection",
    status: "approved",
    userId: params.userId,
  });

  const defendants = await db
    .select()
    .from(prosecutionDefendants)
    .where(
      and(
        eq(prosecutionDefendants.organizationId, params.organizationId),
        eq(prosecutionDefendants.criminalCaseId, params.caseId),
      ),
    );
  const defendantNodes = new Map<string, string>();
  for (const defendant of defendants) {
    const node = await upsertNode(db, {
      organizationId: params.organizationId,
      criminalCaseId: params.caseId,
      nodeKind: "defendant",
      canonicalEntityType: "defendant",
      canonicalEntityId: defendant.id,
      displayName: defendant.displayName,
      provenance: provenanceOf(defendant.provenance),
      origin: "projection",
      status: "approved",
      userId: params.userId,
    });
    defendantNodes.set(defendant.id, node.id);
    await ensureEdge(db, {
      organizationId: params.organizationId,
      criminalCaseId: params.caseId,
      fromNodeId: caseNode.id,
      toNodeId: node.id,
      relationshipType: "HAS_DEFENDANT",
      provenance: provenanceOf(defendant.provenance),
      origin: "projection",
      status: defendant.provenance.humanEntered ? "approved" : "proposed",
      userId: params.userId,
    });
  }

  const charges = await db
    .select()
    .from(prosecutionCharges)
    .where(
      and(
        eq(prosecutionCharges.organizationId, params.organizationId),
        eq(prosecutionCharges.criminalCaseId, params.caseId),
      ),
    );
  const chargeNodes = new Map<string, string>();
  for (const charge of charges) {
    const node = await upsertNode(db, {
      organizationId: params.organizationId,
      criminalCaseId: params.caseId,
      nodeKind: "charge",
      canonicalEntityType: "charge",
      canonicalEntityId: charge.id,
      displayName: `${charge.countNumber}: ${charge.offenseName}`,
      provenance: provenanceOf(charge.provenance),
      origin: "projection",
      status: "approved",
      userId: params.userId,
    });
    chargeNodes.set(charge.id, node.id);
    await ensureEdge(db, {
      organizationId: params.organizationId,
      criminalCaseId: params.caseId,
      fromNodeId: caseNode.id,
      toNodeId: node.id,
      relationshipType: "HAS_CHARGE",
      provenance: provenanceOf(charge.provenance),
      origin: "projection",
      status: charge.provenance.humanEntered ? "approved" : "proposed",
      userId: params.userId,
    });
    const defendantNodeId = defendantNodes.get(charge.defendantId);
    if (defendantNodeId) {
      await ensureEdge(db, {
        organizationId: params.organizationId,
        criminalCaseId: params.caseId,
        fromNodeId: defendantNodeId,
        toNodeId: node.id,
        relationshipType: "CHARGED_WITH",
        provenance: provenanceOf(charge.provenance),
        origin: "projection",
        status: charge.provenance.humanEntered ? "approved" : "proposed",
        userId: params.userId,
      });
    }
  }

  const elements = await db
    .select()
    .from(prosecutionChargeElements)
    .where(
      and(
        eq(prosecutionChargeElements.organizationId, params.organizationId),
        eq(prosecutionChargeElements.criminalCaseId, params.caseId),
      ),
    );
  for (const element of elements) {
    const node = await upsertNode(db, {
      organizationId: params.organizationId,
      criminalCaseId: params.caseId,
      nodeKind: "charge_element",
      canonicalEntityType: "charge_element",
      canonicalEntityId: element.id,
      displayName: element.elementText.slice(0, 120),
      provenance: provenanceOf(element.provenance),
      origin: "projection",
      status: "approved",
      userId: params.userId,
    });
    const chargeNodeId = chargeNodes.get(element.chargeId);
    if (chargeNodeId) {
      await ensureEdge(db, {
        organizationId: params.organizationId,
        criminalCaseId: params.caseId,
        fromNodeId: chargeNodeId,
        toNodeId: node.id,
        relationshipType: "HAS_ELEMENT",
        provenance: provenanceOf(element.provenance),
        origin: "projection",
        status: element.provenance.humanEntered ? "approved" : "proposed",
        userId: params.userId,
      });
    }
  }

  const evidence = await db
    .select()
    .from(prosecutionEvidenceItems)
    .where(
      and(
        eq(prosecutionEvidenceItems.organizationId, params.organizationId),
        eq(prosecutionEvidenceItems.criminalCaseId, params.caseId),
      ),
    );
  for (const item of evidence) {
    const node = await upsertNode(db, {
      organizationId: params.organizationId,
      criminalCaseId: params.caseId,
      nodeKind: "evidence",
      canonicalEntityType: "evidence",
      canonicalEntityId: item.id,
      displayName: item.evidenceType,
      provenance: provenanceOf(item.provenance),
      origin: "projection",
      status: "approved",
      userId: params.userId,
    });
    await ensureEdge(db, {
      organizationId: params.organizationId,
      criminalCaseId: params.caseId,
      fromNodeId: caseNode.id,
      toNodeId: node.id,
      relationshipType: "HAS_EVIDENCE",
      provenance: provenanceOf(item.provenance),
      origin: "projection",
      status: item.provenance.humanEntered ? "approved" : "proposed",
      userId: params.userId,
    });
  }

  const witnesses = await db
    .select()
    .from(prosecutionWitnesses)
    .where(
      and(
        eq(prosecutionWitnesses.organizationId, params.organizationId),
        eq(prosecutionWitnesses.criminalCaseId, params.caseId),
      ),
    );
  for (const witness of witnesses) {
    const node = await upsertNode(db, {
      organizationId: params.organizationId,
      criminalCaseId: params.caseId,
      nodeKind: "witness",
      canonicalEntityType: "witness",
      canonicalEntityId: witness.id,
      displayName: witness.displayName,
      provenance: provenanceOf(witness.provenance),
      origin: "projection",
      status: "approved",
      userId: params.userId,
    });
    await ensureEdge(db, {
      organizationId: params.organizationId,
      criminalCaseId: params.caseId,
      fromNodeId: caseNode.id,
      toNodeId: node.id,
      relationshipType: "HAS_WITNESS",
      provenance: provenanceOf(witness.provenance),
      origin: "projection",
      status: witness.provenance.humanEntered ? "approved" : "proposed",
      userId: params.userId,
    });
  }

  await writeAuditEvent(db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: criminalCase.matterId,
    action: "prosecution.graph_projected",
    targetType: "criminal_case",
    targetId: params.caseId,
  });

  return listProsecutionCaseGraph(db, params);
}

export async function createProsecutionGraphEdge(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    caseId: string;
    fromNodeId: string;
    toNodeId: string;
    relationshipType: string;
    provenance: RecordProvenance;
    confidence?: string | null;
  },
) {
  await authorize(db, {
    userId: params.userId,
    organizationId: params.organizationId,
    action: "edit",
  });
  const criminalCase = await requireCase(db, params.organizationId, params.caseId);
  const relationshipType = params.relationshipType.trim().toUpperCase().slice(0, 80);
  if (!relationshipType) {
    throw new ProsecutionError("VALIDATION_ERROR", "relationshipType required.", 400);
  }
  const nodeIds = [params.fromNodeId, params.toNodeId];
  const nodes = await db
    .select()
    .from(prosecutionGraphNodes)
    .where(
      and(
        eq(prosecutionGraphNodes.organizationId, params.organizationId),
        eq(prosecutionGraphNodes.criminalCaseId, params.caseId),
        inArray(prosecutionGraphNodes.id, nodeIds),
      ),
    );
  if (nodes.length !== 2) {
    throw new ProsecutionError("NOT_FOUND", "Both graph nodes must belong to this case.", 404);
  }

  const [edge] = await db
    .insert(prosecutionGraphEdges)
    .values({
      organizationId: params.organizationId,
      criminalCaseId: params.caseId,
      fromNodeId: params.fromNodeId,
      toNodeId: params.toNodeId,
      relationshipType,
      provenance: provenanceOf(params.provenance),
      origin: "manual",
      status: "proposed",
      confidence: params.confidence ?? null,
      createdByUserId: params.userId,
    })
    .returning();
  if (!edge) throw new ProsecutionError("INSERT_FAILED", "Graph edge was not created.", 500);

  await writeAuditEvent(db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: criminalCase.matterId,
    action: "prosecution.graph_edge_created",
    targetType: "graph_edge",
    targetId: edge.id,
    metadata: { criminalCaseId: params.caseId, relationshipType },
  });

  return presentEdge(edge);
}

export async function reviewProsecutionGraphEdge(
  db: Database,
  params: {
    userId: string;
    organizationId: string;
    caseId: string;
    edgeId: string;
    action: "approve" | "reject";
    rejectionReason?: string | null;
  },
) {
  await requireCapability(db, {
    userId: params.userId,
    organizationId: params.organizationId,
    capability: "prosecution.review",
  });
  const criminalCase = await requireCase(db, params.organizationId, params.caseId);
  const [edge] = await db
    .select()
    .from(prosecutionGraphEdges)
    .where(
      and(
        eq(prosecutionGraphEdges.id, params.edgeId),
        eq(prosecutionGraphEdges.organizationId, params.organizationId),
        eq(prosecutionGraphEdges.criminalCaseId, params.caseId),
      ),
    )
    .limit(1);
  if (!edge) throw new ProsecutionError("NOT_FOUND", "Graph edge not found.", 404);
  if (edge.status !== "proposed") {
    throw new ProsecutionError(
      "INVALID_GRAPH_TRANSITION",
      "Only proposed edges can be reviewed.",
      400,
    );
  }

  const nextStatus: ProsecutionGraphReviewStatus =
    params.action === "approve" ? "approved" : "rejected";
  const [updated] = await db
    .update(prosecutionGraphEdges)
    .set({
      status: nextStatus,
      reviewedByUserId: params.userId,
      reviewedAt: new Date(),
      rejectionReason: params.action === "reject" ? (params.rejectionReason ?? null) : null,
      updatedAt: new Date(),
    })
    .where(eq(prosecutionGraphEdges.id, edge.id))
    .returning();
  if (!updated) throw new ProsecutionError("UPDATE_FAILED", "Graph edge review failed.", 500);

  await writeAuditEvent(db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: criminalCase.matterId,
    action: "prosecution.graph_edge_reviewed",
    targetType: "graph_edge",
    targetId: edge.id,
    metadata: { action: params.action, status: nextStatus },
  });

  return presentEdge(updated);
}

export function assertProsecutionGraphNodeKind(value: string): ProsecutionGraphNodeKind {
  if (!isNodeKind(value)) {
    throw new ProsecutionError("VALIDATION_ERROR", `Unsupported graph node kind: ${value}`, 400);
  }
  return value;
}
