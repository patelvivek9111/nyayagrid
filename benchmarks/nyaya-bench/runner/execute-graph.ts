import type { AIProvider } from "@nyayagrid/ai";
import { and, eq, inArray } from "@nyayagrid/database";
import {
  documents,
  graphEdgeSources,
  type Database,
} from "@nyayagrid/database";
import {
  createManualGraphEdge,
  extractGraphRelationshipCandidates,
  extractMatterIntelligenceForReadyDocuments,
  getGraphNeighborhood,
  listGraph,
  listProposedIntelligence,
  listTimelineEvents,
  loadVerifiedGraphContext,
  materializeVerifiedGraph,
  reviewGraphEdge,
  reviewMatterFact,
  reviewTimelineEvent,
} from "@nyayagrid/intelligence";
import type { BenchScenario, BenchTask, GraphBenchAction } from "./catalog";
import type { IngestedMatter } from "./ingest";

type SnapshotEdge = {
  id: string;
  fromName: string;
  toName: string;
  fromType: string | null;
  toType: string | null;
  relationshipType: string;
  label: string | null;
  status: string;
  origin: string;
  sourceDocumentTitles: string[];
  sourceChunkIds: string[];
};

function edgeBlob(edges: SnapshotEdge[]): string {
  return edges
    .map(
      (edge) =>
        `${edge.fromName} ${edge.relationshipType} ${edge.toName} ${edge.label ?? ""} ${edge.status} ${edge.origin} ${edge.sourceDocumentTitles.join(" ")}`,
    )
    .join("\n");
}

function isPhysicalEntryOverclaim(edges: SnapshotEdge[]): boolean {
  return edges.some((edge) => {
    if (edge.status === "rejected") return false;
    const type = edge.relationshipType.toLowerCase();
    const label = `${edge.label ?? ""} ${edge.fromName} ${edge.toName}`.toLowerCase();
    if (type === "entered" || type.includes("physically_enter")) return true;
    if (/\bphysically entered\b/.test(label) && !/\bdid not\b|\bnever entered\b|\bdenies\b/.test(label)) {
      return true;
    }
    const place = /room|premises|facility|building/.test(label);
    const personAct = type === "attended" || type === "participated_in";
    return personAct && place && !/\bdid not\b|\bnever\b|\bdenies\b/.test(label);
  });
}

export async function executeGraphTarget(params: {
  db: Database;
  scenario: BenchScenario;
  task: BenchTask;
  matter: IngestedMatter;
  ai: AIProvider;
}): Promise<{ answer: string; extras: Record<string, unknown> }> {
  const { db, matter, task, ai } = params;
  const action: GraphBenchAction = task.graphAction ?? {
    extractIntelligence: true,
    extractRelationships: true,
  };
  const org = {
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    userId: matter.userId,
  };
  let modelCalls = 0;
  let extractError: string | null = null;
  let reviewedEdgeId: string | null = null;
  let reviewedStatus: string | null = null;

  if (action.extractIntelligence) {
    await extractMatterIntelligenceForReadyDocuments({ ...org, ai });
    modelCalls += 1;
  }
  if (action.approveFacts) {
    const proposed = await listProposedIntelligence({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
    });
    for (const fact of proposed.facts) {
      try {
        await reviewMatterFact({ ...org, factId: fact.id, action: "approve" });
      } catch {
        /* unsourced facts cannot be approved */
      }
    }
  }
  if (action.approveTimeline) {
    const events = await listTimelineEvents({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
      status: "proposed",
    });
    for (const event of events) {
      try {
        await reviewTimelineEvent({ ...org, eventId: event.id, action: "approve" });
      } catch {
        /* unsourced events cannot be approved */
      }
    }
  }
  if (action.materialize) {
    await materializeVerifiedGraph(org);
  }
  if (action.extractRelationships) {
    try {
      await extractGraphRelationshipCandidates({ ...org, ai });
      modelCalls += 1;
    } catch (error) {
      extractError = error instanceof Error ? error.message : String(error);
    }
  }
  if (action.createManual) {
    const listed = await listGraph({
      ...org,
      edgeStatus: "proposed,approved,edited_and_approved,rejected",
    });
    const docs = listed.nodes.filter((node) => node.nodeType === "document");
    if (docs.length >= 2) {
      await createManualGraphEdge({
        ...org,
        fromNodeId: docs[0]!.id,
        toNodeId: docs[1]!.id,
        relationshipType: "related_to",
        label: "Bench manual relationship",
      });
    }
  }

  const listedBeforeReview = await listGraph({
    ...org,
    edgeStatus: "proposed,approved,edited_and_approved,rejected",
  });
  if (action.reviewAction) {
    const candidate = listedBeforeReview.edges.find(
      (edge) => edge.status === "proposed" && edge.origin === "ai",
    );
    if (candidate) {
      try {
        await reviewGraphEdge({
          ...org,
          edgeId: candidate.id,
          action: action.reviewAction,
          rejectionReason: action.reviewAction === "reject" ? "Bench overlay reject" : undefined,
        });
        reviewedEdgeId = candidate.id;
        reviewedStatus = action.reviewAction === "reject" ? "rejected" : "approved";
      } catch (error) {
        extractError = error instanceof Error ? error.message : String(error);
      }
    }
    if (action.reviewAction === "reject" && reviewedEdgeId) {
      try {
        await extractGraphRelationshipCandidates({ ...org, ai });
        modelCalls += 1;
      } catch {
        /* re-extract after reject tests whether the relationship returns */
      }
    }
  }

  const listed = await listGraph({
    ...org,
    edgeStatus: "proposed,approved,edited_and_approved,rejected",
  });
  const edgeIds = listed.edges.map((edge) => edge.id);
  const sourceRows =
    edgeIds.length === 0
      ? []
      : await db
          .select()
          .from(graphEdgeSources)
          .where(inArray(graphEdgeSources.graphEdgeId, edgeIds));
  const docIds = [...new Set(sourceRows.map((row) => row.documentId))];
  const docRows =
    docIds.length === 0
      ? []
      : await db
          .select({ id: documents.id, title: documents.title })
          .from(documents)
          .where(and(eq(documents.organizationId, matter.organizationId), inArray(documents.id, docIds)));
  const titleByDoc = new Map(docRows.map((row) => [row.id, row.title]));
  const nodeById = new Map(listed.nodes.map((node) => [node.id, node]));

  const snapshotEdges: SnapshotEdge[] = listed.edges.map((edge) => {
    const sources = sourceRows.filter((row) => row.graphEdgeId === edge.id);
    return {
      id: edge.id,
      fromName: edge.fromName,
      toName: edge.toName,
      fromType: nodeById.get(edge.fromNodeId)?.nodeType ?? null,
      toType: nodeById.get(edge.toNodeId)?.nodeType ?? null,
      relationshipType: edge.relationshipType,
      label: edge.label,
      status: edge.status,
      origin: edge.origin,
      sourceDocumentTitles: sources.map((row) => titleByDoc.get(row.documentId) ?? row.documentId),
      sourceChunkIds: sources.map((row) => row.chunkId),
    };
  });

  const verified = await loadVerifiedGraphContext(org);
  const verifiedIds = new Set(verified.edges.map((edge) => edge.id));
  const proposed = snapshotEdges.filter((edge) => edge.status === "proposed");
  const approved = snapshotEdges.filter(
    (edge) => edge.status === "approved" || edge.status === "edited_and_approved",
  );
  const rejected = snapshotEdges.filter((edge) => edge.status === "rejected");
  const proposedInVerified = proposed.filter((edge) => verifiedIds.has(edge.id));
  const rejectedInVerified = rejected.filter((edge) => verifiedIds.has(edge.id));
  const manualApproved = snapshotEdges.filter(
    (edge) => edge.origin === "manual" && (edge.status === "approved" || edge.status === "edited_and_approved"),
  );
  const aiMissingProvenance = snapshotEdges.filter(
    (edge) =>
      edge.origin === "ai" &&
      edge.status !== "rejected" &&
      edge.sourceChunkIds.length === 0,
  );
  const materialTypes = new Set([
    "party_to",
    "signed",
    "paid",
    "attended",
    "participated_in",
    "owns",
    "works_for",
  ]);
  const emailOnlyMaterial = snapshotEdges.filter((edge) => {
    if (edge.status === "rejected") return false;
    if (!materialTypes.has(edge.relationshipType)) return false;
    if (edge.sourceDocumentTitles.length === 0) return false;
    return edge.sourceDocumentTitles.every((title) => /email/i.test(title));
  });

  let neighborhoodProposedCount = 0;
  if (action.inspectNeighborhood) {
    const center = listed.nodes[0];
    if (center) {
      const neighborhood = await getGraphNeighborhood({
        db,
        organizationId: matter.organizationId,
        matterId: matter.matterId,
        nodeId: center.id,
      });
      neighborhoodProposedCount =
        neighborhood?.edges.filter((edge) => edge.status === "proposed").length ?? 0;
    }
  }

  const structured = {
    nodes: listed.nodes.map((node) => ({
      id: node.id,
      nodeType: node.nodeType,
      displayName: node.displayName,
      status: node.status,
      origin: node.origin,
    })),
    edges: snapshotEdges,
    verifiedText: verified.text,
    verifiedEdgeIds: [...verifiedIds],
    reviewedEdgeId,
    reviewedStatus,
    extractError,
  };

  const snapshot = {
    nodeCount: listed.nodes.length,
    documentNodeCount: listed.nodes.filter((node) => node.nodeType === "document").length,
    edgeCount: snapshotEdges.length,
    proposedCount: proposed.length,
    approvedCount: approved.length,
    rejectedCount: rejected.length,
    proposedInVerifiedCount: proposedInVerified.length,
    rejectedInVerifiedCount: rejectedInVerified.length,
    approvedInVerifiedCount: approved.filter((edge) => verifiedIds.has(edge.id)).length,
    manualApprovedCount: manualApproved.length,
    manualApprovedWithoutSources: manualApproved.filter((edge) => edge.sourceChunkIds.length === 0).length,
    aiMissingProvenanceCount: aiMissingProvenance.length,
    emailOnlyMaterialCount: emailOnlyMaterial.length,
    physicalEntryOverclaim: isPhysicalEntryOverclaim(snapshotEdges),
    neighborhoodProposedCount,
    relationshipTypes: [...new Set(snapshotEdges.map((edge) => edge.relationshipType))],
    documentNames: listed.nodes
      .filter((node) => node.nodeType === "document")
      .map((node) => node.displayName),
    edgeText: edgeBlob(snapshotEdges),
    verifiedText: verified.text,
    reviewedEdgeId,
    reviewedStatus,
  };

  return {
    answer: JSON.stringify(structured, null, 2),
    extras: {
      executionTarget: "graph",
      structuredKind: "graph",
      structuredOutput: { snapshot, edges: snapshotEdges, nodes: structured.nodes },
      modelCalls,
      graphExtractError: extractError,
      promptVersion: "graph-relationship-extract-v2",
    },
  };
}
