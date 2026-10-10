/**
 * Discovery / Production Ledger graph materialization.
 *
 * Uses certified graph_node_type values from migration 0022.
 * Reuses canonical document / evidence / matter_entity nodes when present.
 * Does not invent sanctions, privilege legal conclusions, or legal deficiency findings.
 */

import type { Database, GraphNodeType } from "@nyayagrid/database";
import { upsertGraphEdge, upsertGraphNode } from "../graph/materialize";
import { loadDiscoveryLedgerReview } from "./adapter";
import type { DiscoveryLedgerReview } from "./types";

export const DISCOVERY_GRAPH_EDGE = {
  REQUESTING_PARTY: "requesting_party",
  RESPONDING_PARTY: "responding_party",
  HAS_ITEM: "has_item",
  HAS_RESPONSE: "has_response",
  HAS_OBJECTION: "has_objection",
  LINKED_PRODUCTION: "linked_production",
  PRODUCED_DOCUMENT: "produced_document",
  PRODUCED_EVIDENCE: "produced_evidence",
  HAS_CUSTODIAN: "has_custodian",
  DEFICIENCY_ON: "deficiency_on",
  RELATED_COMMUNICATION: "related_communication",
  RELATED_MOTION_DOC: "related_motion_document",
  PRIVILEGE_ON_DOCUMENT: "privilege_on_document",
  PRIVILEGE_ON_EVIDENCE: "privilege_on_evidence",
  SOURCE_DOCUMENT: "source_document",
} as const;

export type DiscoveryGraphEdgeType = (typeof DISCOVERY_GRAPH_EDGE)[keyof typeof DISCOVERY_GRAPH_EDGE];

export type DiscoveryGraphNodePlan = {
  canonicalEntityType: string;
  canonicalEntityId: string;
  nodeType: GraphNodeType;
  displayName: string;
  metadata: Record<string, unknown>;
};

export type DiscoveryGraphEdgePlan = {
  fromKey: string;
  toKey: string;
  relationshipType: DiscoveryGraphEdgeType;
  label: string;
  metadata?: Record<string, unknown>;
};

export type DiscoveryGraphMaterializationPlan = {
  nodes: DiscoveryGraphNodePlan[];
  edges: DiscoveryGraphEdgePlan[];
};

function nodeKey(canonicalEntityType: string, canonicalEntityId: string): string {
  return `${canonicalEntityType}:${canonicalEntityId}`;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Pure planner used by unit tests and DB materializer. */
export function buildDiscoveryGraphMaterializationPlan(
  review: DiscoveryLedgerReview,
): DiscoveryGraphMaterializationPlan {
  const nodes = new Map<string, DiscoveryGraphNodePlan>();
  const edges: DiscoveryGraphEdgePlan[] = [];

  const addNode = (node: DiscoveryGraphNodePlan) => {
    nodes.set(nodeKey(node.canonicalEntityType, node.canonicalEntityId), node);
  };

  for (const party of review.parties) {
    addNode({
      canonicalEntityType: "matter_entity",
      canonicalEntityId: party.partyId,
      nodeType: "other",
      displayName: party.displayName,
      metadata: { role: "discovery_party" },
    });
  }

  for (const set of review.requestSets) {
    addNode({
      canonicalEntityType: "discovery_request_set",
      canonicalEntityId: set.id,
      nodeType: "discovery_request_set",
      displayName: set.label,
      metadata: {
        discoveryType: set.discoveryType,
        isCurrent: set.isCurrent,
        servedAt: set.servedAt,
        responseDueAt: set.responseDueAt,
      },
    });
    edges.push({
      fromKey: nodeKey("discovery_request_set", set.id),
      toKey: nodeKey("matter_entity", set.requestingPartyId),
      relationshipType: DISCOVERY_GRAPH_EDGE.REQUESTING_PARTY,
      label: "requesting party",
    });
    edges.push({
      fromKey: nodeKey("discovery_request_set", set.id),
      toKey: nodeKey("matter_entity", set.respondingPartyId),
      relationshipType: DISCOVERY_GRAPH_EDGE.RESPONDING_PARTY,
      label: "responding party",
    });
    if (set.sourceDocumentId) {
      addNode({
        canonicalEntityType: "document",
        canonicalEntityId: set.sourceDocumentId,
        nodeType: "document",
        displayName: `Source document ${set.sourceDocumentId}`,
        metadata: {},
      });
      edges.push({
        fromKey: nodeKey("discovery_request_set", set.id),
        toKey: nodeKey("document", set.sourceDocumentId),
        relationshipType: DISCOVERY_GRAPH_EDGE.SOURCE_DOCUMENT,
        label: "source document",
      });
    }
  }

  for (const item of review.items) {
    addNode({
      canonicalEntityType: "discovery_request_item",
      canonicalEntityId: item.id,
      nodeType: "discovery_request_item",
      displayName: `${item.requestNumber}: ${item.title}`,
      metadata: { status: item.status, requestNumber: item.requestNumber },
    });
    edges.push({
      fromKey: nodeKey("discovery_request_set", item.setId),
      toKey: nodeKey("discovery_request_item", item.id),
      relationshipType: DISCOVERY_GRAPH_EDGE.HAS_ITEM,
      label: item.requestNumber,
    });
  }

  for (const response of review.responses) {
    addNode({
      canonicalEntityType: "discovery_response",
      canonicalEntityId: response.id,
      nodeType: "discovery_response",
      displayName: response.label,
      metadata: {
        isSupplemental: response.isSupplemental,
        respondedAt: response.respondedAt,
      },
    });
    edges.push({
      fromKey: nodeKey("discovery_request_item", response.itemId),
      toKey: nodeKey("discovery_response", response.id),
      relationshipType: DISCOVERY_GRAPH_EDGE.HAS_RESPONSE,
      label: response.isSupplemental ? "supplemental response" : "response",
    });
    if (response.sourceDocumentId) {
      addNode({
        canonicalEntityType: "document",
        canonicalEntityId: response.sourceDocumentId,
        nodeType: "document",
        displayName: `Response document ${response.sourceDocumentId}`,
        metadata: {},
      });
      edges.push({
        fromKey: nodeKey("discovery_response", response.id),
        toKey: nodeKey("document", response.sourceDocumentId),
        relationshipType: DISCOVERY_GRAPH_EDGE.SOURCE_DOCUMENT,
        label: "response source",
      });
    }
    for (const productionId of response.productionIds) {
      edges.push({
        fromKey: nodeKey("discovery_response", response.id),
        toKey: nodeKey("discovery_production", productionId),
        relationshipType: DISCOVERY_GRAPH_EDGE.LINKED_PRODUCTION,
        label: "linked production",
      });
    }
  }

  for (const objection of review.objections) {
    edges.push({
      fromKey: nodeKey("discovery_response", objection.responseId),
      toKey: nodeKey("discovery_request_item", objection.itemId),
      relationshipType: DISCOVERY_GRAPH_EDGE.HAS_OBJECTION,
      label: objection.basis,
      metadata: { objectionId: objection.id },
    });
  }

  for (const production of review.productions) {
    addNode({
      canonicalEntityType: "discovery_production",
      canonicalEntityId: production.id,
      nodeType: "discovery_production",
      displayName: production.label,
      metadata: {
        producedAt: production.producedAt,
        isSupplemental: production.isSupplemental,
        batesRangeCount: production.batesRanges.length,
      },
    });
    for (const documentId of production.documentIds) {
      addNode({
        canonicalEntityType: "document",
        canonicalEntityId: documentId,
        nodeType: "document",
        displayName: `Produced document ${documentId}`,
        metadata: {},
      });
      edges.push({
        fromKey: nodeKey("discovery_production", production.id),
        toKey: nodeKey("document", documentId),
        relationshipType: DISCOVERY_GRAPH_EDGE.PRODUCED_DOCUMENT,
        label: "produced document",
      });
    }
    for (const evidenceId of production.evidenceIds) {
      addNode({
        canonicalEntityType: "civil_evidence_item",
        canonicalEntityId: evidenceId,
        nodeType: "other",
        displayName: `Evidence ${evidenceId}`,
        metadata: { role: "produced_evidence" },
      });
      edges.push({
        fromKey: nodeKey("discovery_production", production.id),
        toKey: nodeKey("civil_evidence_item", evidenceId),
        relationshipType: DISCOVERY_GRAPH_EDGE.PRODUCED_EVIDENCE,
        label: "produced evidence",
      });
    }
    for (const custodianId of production.custodianIds) {
      addNode({
        canonicalEntityType: "matter_entity",
        canonicalEntityId: custodianId,
        nodeType: "other",
        displayName: `Custodian ${custodianId}`,
        metadata: { role: "custodian" },
      });
      edges.push({
        fromKey: nodeKey("discovery_production", production.id),
        toKey: nodeKey("matter_entity", custodianId),
        relationshipType: DISCOVERY_GRAPH_EDGE.HAS_CUSTODIAN,
        label: "custodian",
      });
    }
  }

  for (const deficiency of review.deficiencies) {
    addNode({
      canonicalEntityType: "discovery_deficiency",
      canonicalEntityId: deficiency.id,
      nodeType: "discovery_deficiency",
      displayName: `${deficiency.kind}: ${deficiency.description.slice(0, 80)}`,
      metadata: {
        kind: deficiency.kind,
        status: deficiency.status,
        isReviewSignal: deficiency.isReviewSignal,
      },
    });
    if (deficiency.itemId) {
      edges.push({
        fromKey: nodeKey("discovery_deficiency", deficiency.id),
        toKey: nodeKey("discovery_request_item", deficiency.itemId),
        relationshipType: DISCOVERY_GRAPH_EDGE.DEFICIENCY_ON,
        label: deficiency.kind,
      });
    }
    if (deficiency.communicationId && isUuid(deficiency.communicationId)) {
      // Pass 6: communicationId is an FK to matter_communications — use first-class node type.
      addNode({
        canonicalEntityType: "communication",
        canonicalEntityId: deficiency.communicationId,
        nodeType: "communication",
        displayName: `Communication ${deficiency.communicationId}`,
        metadata: { role: "discovery_communication_ref" },
      });
      edges.push({
        fromKey: nodeKey("discovery_deficiency", deficiency.id),
        toKey: nodeKey("communication", deficiency.communicationId),
        relationshipType: DISCOVERY_GRAPH_EDGE.RELATED_COMMUNICATION,
        label: "related communication",
      });
    }
  }

  for (const motion of review.motionLinks) {
    const motionIsFirstClass = isUuid(motion.motionId);
    if (motionIsFirstClass) {
      addNode({
        canonicalEntityType: "motion",
        canonicalEntityId: motion.motionId,
        nodeType: "motion",
        displayName: motion.motionLabel,
        metadata: { motionType: motion.motionType },
      });
      for (const deficiencyId of motion.deficiencyIds) {
        edges.push({
          fromKey: nodeKey("discovery_deficiency", deficiencyId),
          toKey: nodeKey("motion", motion.motionId),
          relationshipType: DISCOVERY_GRAPH_EDGE.RELATED_MOTION_DOC,
          label: motion.motionType,
        });
      }
      // Convenience: keep motion paper document identity separate from the motion entity.
      if (motion.documentId && isUuid(motion.documentId)) {
        addNode({
          canonicalEntityType: "document",
          canonicalEntityId: motion.documentId,
          nodeType: "document",
          displayName: `${motion.motionLabel} paper`,
          metadata: { motionType: motion.motionType, motionId: motion.motionId, role: "motion_document" },
        });
        edges.push({
          fromKey: nodeKey("motion", motion.motionId),
          toKey: nodeKey("document", motion.documentId),
          relationshipType: DISCOVERY_GRAPH_EDGE.SOURCE_DOCUMENT,
          label: "motion document",
        });
      }
      continue;
    }

    // Legacy fixture / non-UUID motion ids: document-only fallback when no first-class motion row.
    if (!motion.documentId) continue;
    addNode({
      canonicalEntityType: "document",
      canonicalEntityId: motion.documentId,
      nodeType: "document",
      displayName: motion.motionLabel,
      metadata: { motionType: motion.motionType, motionId: motion.motionId },
    });
    for (const deficiencyId of motion.deficiencyIds) {
      edges.push({
        fromKey: nodeKey("discovery_deficiency", deficiencyId),
        toKey: nodeKey("document", motion.documentId),
        relationshipType: DISCOVERY_GRAPH_EDGE.RELATED_MOTION_DOC,
        label: motion.motionType,
      });
    }
  }

  for (const privilege of review.privilegeAssertions) {
    addNode({
      canonicalEntityType: "privilege_assertion",
      canonicalEntityId: privilege.id,
      nodeType: "privilege_assertion",
      displayName: `Privilege assertion (${privilege.status})`,
      metadata: {
        status: privilege.status,
        assertedBasis: privilege.assertedBasis,
        courtRulingReferenced: privilege.courtRulingReferenced,
      },
    });
    if (privilege.documentId) {
      addNode({
        canonicalEntityType: "document",
        canonicalEntityId: privilege.documentId,
        nodeType: "document",
        displayName: `Document ${privilege.documentId}`,
        metadata: {},
      });
      edges.push({
        fromKey: nodeKey("privilege_assertion", privilege.id),
        toKey: nodeKey("document", privilege.documentId),
        relationshipType: DISCOVERY_GRAPH_EDGE.PRIVILEGE_ON_DOCUMENT,
        label: "asserted on document",
      });
    }
    if (privilege.evidenceId) {
      addNode({
        canonicalEntityType: "civil_evidence_item",
        canonicalEntityId: privilege.evidenceId,
        nodeType: "other",
        displayName: `Evidence ${privilege.evidenceId}`,
        metadata: {},
      });
      edges.push({
        fromKey: nodeKey("privilege_assertion", privilege.id),
        toKey: nodeKey("civil_evidence_item", privilege.evidenceId),
        relationshipType: DISCOVERY_GRAPH_EDGE.PRIVILEGE_ON_EVIDENCE,
        label: "asserted on evidence",
      });
    }
  }

  return { nodes: [...nodes.values()], edges };
}

export async function materializeDiscoveryGraph(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  userId: string;
}): Promise<{
  nodesUpserted: number;
  edgesCreated: number;
  edgesMerged: number;
  plan: DiscoveryGraphMaterializationPlan;
}> {
  const review = await loadDiscoveryLedgerReview(params.db, {
    userId: params.userId,
    organizationId: params.organizationId,
    matterId: params.matterId,
  });
  const plan = buildDiscoveryGraphMaterializationPlan(review);

  const persistableNodes = plan.nodes.filter((node) => isUuid(node.canonicalEntityId));
  const graphNodeIds = new Map<string, string>();
  let nodesUpserted = 0;
  for (const node of persistableNodes) {
    const upserted = await upsertGraphNode(params.db, {
      organizationId: params.organizationId,
      matterId: params.matterId,
      userId: params.userId,
      canonicalEntityType: node.canonicalEntityType,
      canonicalEntityId: node.canonicalEntityId,
      nodeType: node.nodeType,
      displayName: node.displayName,
      origin: "manual",
      metadata: node.metadata,
    });
    graphNodeIds.set(nodeKey(node.canonicalEntityType, node.canonicalEntityId), upserted.id);
    nodesUpserted += 1;
  }

  let edgesCreated = 0;
  let edgesMerged = 0;
  for (const edge of plan.edges) {
    const fromNodeId = graphNodeIds.get(edge.fromKey);
    const toNodeId = graphNodeIds.get(edge.toKey);
    if (!fromNodeId || !toNodeId) continue;
    const result = await upsertGraphEdge({
      db: params.db,
      organizationId: params.organizationId,
      matterId: params.matterId,
      fromNodeId,
      toNodeId,
      relationshipType: edge.relationshipType,
      label: edge.label,
      direction: "directed",
      origin: "manual",
      status: "approved",
      userId: params.userId,
      metadata: edge.metadata,
    });
    if (result.merged) edgesMerged += 1;
    else edgesCreated += 1;
  }

  return { nodesUpserted, edgesCreated, edgesMerged, plan };
}
