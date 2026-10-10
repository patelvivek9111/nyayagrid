import type { Database, GraphNodeType } from "@nyayagrid/database";
import { upsertGraphEdge, upsertGraphNode } from "../graph/materialize";
import type { MatterMotionsCommunicationsReview } from "./postgres";
import { loadMatterMotionsCommunicationsReview } from "./postgres";

export const MOTIONS_COMMS_GRAPH_EDGE = {
  RELATES_TO_CLAIM: "relates_to_claim",
  RELATES_TO_DEFENSE: "relates_to_defense",
  RELATES_TO_DISCOVERY_REQUEST: "relates_to_discovery_request",
  RELATES_TO_DEFICIENCY: "relates_to_deficiency",
  SUPPORTED_BY_EVIDENCE: "supported_by_evidence",
  HAS_DOCUMENT: "has_document",
  COMMUNICATION_RELATES_TO_DEFICIENCY: "communication_relates_to_deficiency",
  PRECEDES_MOTION: "precedes_motion",
  RELATES_TO_MOTION: "relates_to_motion",
  ORDER_RESOLVES_MOTION: "order_resolves_motion",
} as const;

export type MotionsCommsGraphNodePlan = {
  canonicalEntityType: string;
  canonicalEntityId: string;
  nodeType: GraphNodeType;
  displayName: string;
  metadata: Record<string, unknown>;
};

export type MotionsCommsGraphEdgePlan = {
  fromKey: string;
  toKey: string;
  relationshipType: string;
  label: string;
};

function nodeKey(type: string, id: string) {
  return `${type}:${id}`;
}

export function planMotionsCommunicationsGraph(review: MatterMotionsCommunicationsReview): {
  nodes: MotionsCommsGraphNodePlan[];
  edges: MotionsCommsGraphEdgePlan[];
} {
  const nodes = new Map<string, MotionsCommsGraphNodePlan>();
  const edges = new Map<string, MotionsCommsGraphEdgePlan>();

  function addNode(node: MotionsCommsGraphNodePlan) {
    nodes.set(nodeKey(node.canonicalEntityType, node.canonicalEntityId), node);
  }

  function addEdge(edge: MotionsCommsGraphEdgePlan) {
    edges.set(`${edge.fromKey}|${edge.relationshipType}|${edge.toKey}`, edge);
  }

  for (const motion of review.motions) {
    addNode({
      canonicalEntityType: "motion",
      canonicalEntityId: motion.id,
      nodeType: "motion",
      displayName: motion.title,
      metadata: {
        motionType: motion.motionType,
        status: motion.status,
        disposition: motion.disposition,
      },
    });
    if (motion.primaryDocumentId) {
      addNode({
        canonicalEntityType: "document",
        canonicalEntityId: motion.primaryDocumentId,
        nodeType: "document",
        displayName: `Motion document ${motion.primaryDocumentId}`,
        metadata: {},
      });
      addEdge({
        fromKey: nodeKey("motion", motion.id),
        toKey: nodeKey("document", motion.primaryDocumentId),
        relationshipType: MOTIONS_COMMS_GRAPH_EDGE.HAS_DOCUMENT,
        label: "MOTION",
      });
    }
    if (motion.orderDocumentId) {
      addNode({
        canonicalEntityType: "document",
        canonicalEntityId: motion.orderDocumentId,
        nodeType: "document",
        displayName: `Order ${motion.orderDocumentId}`,
        metadata: {},
      });
      addEdge({
        fromKey: nodeKey("document", motion.orderDocumentId),
        toKey: nodeKey("motion", motion.id),
        relationshipType: MOTIONS_COMMS_GRAPH_EDGE.ORDER_RESOLVES_MOTION,
        label: motion.disposition ?? "order",
      });
    }
  }

  for (const doc of review.motionDocuments) {
    addNode({
      canonicalEntityType: "document",
      canonicalEntityId: doc.documentId,
      nodeType: "document",
      displayName: `Motion paper ${doc.role}`,
      metadata: { role: doc.role },
    });
    addEdge({
      fromKey: nodeKey("motion", doc.motionId),
      toKey: nodeKey("document", doc.documentId),
      relationshipType: MOTIONS_COMMS_GRAPH_EDGE.HAS_DOCUMENT,
      label: doc.role,
    });
  }

  for (const link of review.motionLinks) {
    const fromKey = nodeKey("motion", link.motionId);
    if (link.linkType === "CLAIM") {
      addNode({
        canonicalEntityType: "claim",
        canonicalEntityId: link.targetId,
        nodeType: "claim",
        displayName: `Claim ${link.targetId}`,
        metadata: {},
      });
      addEdge({
        fromKey,
        toKey: nodeKey("claim", link.targetId),
        relationshipType: MOTIONS_COMMS_GRAPH_EDGE.RELATES_TO_CLAIM,
        label: link.note ?? "related claim",
      });
    } else if (link.linkType === "DEFENSE") {
      addNode({
        canonicalEntityType: "defense",
        canonicalEntityId: link.targetId,
        nodeType: "defense",
        displayName: `Defense ${link.targetId}`,
        metadata: {},
      });
      addEdge({
        fromKey,
        toKey: nodeKey("defense", link.targetId),
        relationshipType: MOTIONS_COMMS_GRAPH_EDGE.RELATES_TO_DEFENSE,
        label: link.note ?? "related defense",
      });
    } else if (link.linkType === "DISCOVERY_REQUEST_ITEM") {
      addNode({
        canonicalEntityType: "discovery_request_item",
        canonicalEntityId: link.targetId,
        nodeType: "discovery_request_item",
        displayName: `Request ${link.targetId}`,
        metadata: {},
      });
      addEdge({
        fromKey,
        toKey: nodeKey("discovery_request_item", link.targetId),
        relationshipType: MOTIONS_COMMS_GRAPH_EDGE.RELATES_TO_DISCOVERY_REQUEST,
        label: link.note ?? "related request",
      });
    } else if (link.linkType === "DISCOVERY_DEFICIENCY") {
      addNode({
        canonicalEntityType: "discovery_deficiency",
        canonicalEntityId: link.targetId,
        nodeType: "discovery_deficiency",
        displayName: `Deficiency ${link.targetId}`,
        metadata: {},
      });
      addEdge({
        fromKey,
        toKey: nodeKey("discovery_deficiency", link.targetId),
        relationshipType: MOTIONS_COMMS_GRAPH_EDGE.RELATES_TO_DEFICIENCY,
        label: link.note ?? "related deficiency",
      });
    } else if (link.linkType === "EVIDENCE") {
      addNode({
        canonicalEntityType: "other",
        canonicalEntityId: link.targetId,
        nodeType: "other",
        displayName: `Evidence ${link.targetId}`,
        metadata: { role: "evidence" },
      });
      addEdge({
        fromKey,
        toKey: nodeKey("other", link.targetId),
        relationshipType: MOTIONS_COMMS_GRAPH_EDGE.SUPPORTED_BY_EVIDENCE,
        label: link.note ?? "evidence",
      });
    } else if (link.linkType === "COMMUNICATION") {
      addNode({
        canonicalEntityType: "communication",
        canonicalEntityId: link.targetId,
        nodeType: "communication",
        displayName: `Communication ${link.targetId}`,
        metadata: {},
      });
      addEdge({
        fromKey: nodeKey("communication", link.targetId),
        toKey: fromKey,
        relationshipType: MOTIONS_COMMS_GRAPH_EDGE.PRECEDES_MOTION,
        label: link.note ?? "precedes motion",
      });
    }
  }

  for (const comm of review.communications) {
    addNode({
      canonicalEntityType: "communication",
      canonicalEntityId: comm.id,
      nodeType: "communication",
      displayName: comm.subject,
      metadata: {
        communicationType: comm.communicationType,
        direction: comm.direction,
        status: comm.status,
      },
    });
    if (comm.primaryDocumentId) {
      addNode({
        canonicalEntityType: "document",
        canonicalEntityId: comm.primaryDocumentId,
        nodeType: "document",
        displayName: `Communication document ${comm.primaryDocumentId}`,
        metadata: {},
      });
      addEdge({
        fromKey: nodeKey("communication", comm.id),
        toKey: nodeKey("document", comm.primaryDocumentId),
        relationshipType: MOTIONS_COMMS_GRAPH_EDGE.HAS_DOCUMENT,
        label: "communication document",
      });
    }
  }

  for (const link of review.communicationLinks) {
    const fromKey = nodeKey("communication", link.communicationId);
    if (link.linkType === "DISCOVERY_DEFICIENCY") {
      addNode({
        canonicalEntityType: "discovery_deficiency",
        canonicalEntityId: link.targetId,
        nodeType: "discovery_deficiency",
        displayName: `Deficiency ${link.targetId}`,
        metadata: {},
      });
      addEdge({
        fromKey,
        toKey: nodeKey("discovery_deficiency", link.targetId),
        relationshipType: MOTIONS_COMMS_GRAPH_EDGE.COMMUNICATION_RELATES_TO_DEFICIENCY,
        label: link.note ?? "related deficiency",
      });
    } else if (link.linkType === "DISCOVERY_REQUEST_ITEM") {
      addNode({
        canonicalEntityType: "discovery_request_item",
        canonicalEntityId: link.targetId,
        nodeType: "discovery_request_item",
        displayName: `Request ${link.targetId}`,
        metadata: {},
      });
      addEdge({
        fromKey,
        toKey: nodeKey("discovery_request_item", link.targetId),
        relationshipType: MOTIONS_COMMS_GRAPH_EDGE.RELATES_TO_DISCOVERY_REQUEST,
        label: link.note ?? "related request",
      });
    } else if (link.linkType === "MOTION") {
      addNode({
        canonicalEntityType: "motion",
        canonicalEntityId: link.targetId,
        nodeType: "motion",
        displayName: `Motion ${link.targetId}`,
        metadata: {},
      });
      addEdge({
        fromKey,
        toKey: nodeKey("motion", link.targetId),
        relationshipType: MOTIONS_COMMS_GRAPH_EDGE.RELATES_TO_MOTION,
        label: link.note ?? "related motion",
      });
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

export async function materializeMotionsCommunicationsGraph(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  userId: string;
}): Promise<{
  nodesUpserted: number;
  edgesCreated: number;
  edgesMerged: number;
  plan: { nodes: MotionsCommsGraphNodePlan[]; edges: MotionsCommsGraphEdgePlan[] };
}> {
  const review = await loadMatterMotionsCommunicationsReview(params.db, {
    userId: params.userId,
    organizationId: params.organizationId,
    matterId: params.matterId,
  });
  const plan = planMotionsCommunicationsGraph(review);
  const graphNodeIds = new Map<string, string>();
  let nodesUpserted = 0;
  for (const node of plan.nodes) {
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
    });
    if (result.merged) edgesMerged += 1;
    else edgesCreated += 1;
  }

  return { nodesUpserted, edgesCreated, edgesMerged, plan };
}
