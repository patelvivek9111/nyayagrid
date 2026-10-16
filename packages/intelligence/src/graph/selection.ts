/**
 * Deterministic relevance-ranked selection for graph relationship extraction.
 * Caps remain bounded; ranking replaces incidental storage/query order.
 */

export const GRAPH_EXTRACT_NODE_CAP = 40;
export const GRAPH_EXTRACT_CHUNK_CAP = 24;
export const GRAPH_EXTRACT_MAX_CHUNKS_PER_DOC = 3;
/** Soft ceiling when scanning whole-matter chunk candidates (batched, not unbounded). */
export const GRAPH_EXTRACT_CHUNK_CANDIDATE_SOFT_CAP = 480;

export type GraphSelectionMode = "WHOLE_MATTER" | "FOCUSED";

export type GraphExtractionCoverage = {
  candidateNodes: number;
  selectedNodes: number;
  candidateChunks: number;
  selectedChunks: number;
  selectionMode: GraphSelectionMode;
  coverageLimited: boolean;
  truncated: boolean;
  omittedNodeCount: number;
  omittedChunkCount: number;
  domainsRepresented: string[];
  selectionBasis: "relevance_ranked_bounded";
  /** Deterministic ordered IDs of nodes sent to the model. */
  selectedNodeIds: string[];
  /** Deterministic ordered IDs of chunks sent to the model. */
  selectedChunkIds: string[];
};

export type SelectableGraphNode = {
  id: string;
  nodeType: string;
  displayName: string;
  canonicalEntityType: string;
  canonicalEntityId: string;
};

export type SelectableChunk = {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
};

export class GraphFocusRejectedError extends Error {
  readonly code = "GRAPH_FOCUS_REJECTED" as const;
  constructor(message = "Focus node is not in this matter") {
    super(message);
    this.name = "GraphFocusRejectedError";
  }
}

const NODE_TYPE_BASE: Record<string, number> = {
  claim: 9_000,
  defense: 8_800,
  motion: 8_600,
  document: 7_000,
  fact: 6_800,
  event: 6_500,
  communication: 5_200,
  person: 5_000,
  organization: 4_900,
  client: 4_800,
  discovery_deficiency: 4_600,
  discovery_request_set: 4_400,
  discovery_request_item: 4_300,
  discovery_response: 4_200,
  discovery_production: 4_100,
  privilege_assertion: 4_000,
  deadline: 3_500,
  task: 3_400,
  matter: 2_000,
  other: 1_000,
};

const EVIDENCE_NAME_RE = /\b(evidence|exhibit|attachment|proof)\b/i;
const HEARING_DEPO_INVESTIGATE_RE =
  /\b(hearing|deposition|deponent|investigate|investigation|exam(?:ination)?)\b/i;

export function isEvidenceLinkedNode(node: Pick<SelectableGraphNode, "nodeType" | "displayName" | "canonicalEntityType">): boolean {
  if (node.canonicalEntityType.toLowerCase().includes("evidence")) return true;
  if (node.nodeType === "document" && EVIDENCE_NAME_RE.test(node.displayName)) return true;
  if (node.nodeType === "fact" && EVIDENCE_NAME_RE.test(node.displayName)) return true;
  return false;
}

export function isHearingDepoInvestigateNode(
  node: Pick<SelectableGraphNode, "nodeType" | "displayName">,
): boolean {
  if (node.nodeType !== "event" && node.nodeType !== "task" && node.nodeType !== "communication") {
    return false;
  }
  return HEARING_DEPO_INVESTIGATE_RE.test(node.displayName);
}

export function scoreGraphNodeForExtraction(params: {
  node: SelectableGraphNode;
  focusNodeId?: string | null;
  neighborhoodIds?: ReadonlySet<string>;
  degreeByNodeId?: ReadonlyMap<string, number>;
  sourceSupportByNodeId?: ReadonlyMap<string, number>;
}): number {
  const { node } = params;
  let score = NODE_TYPE_BASE[node.nodeType] ?? 500;

  if (params.focusNodeId && node.id === params.focusNodeId) {
    score += 1_000_000;
  } else if (params.neighborhoodIds?.has(node.id)) {
    score += 400_000;
  }

  if (node.nodeType === "claim") score += 50_000;
  if (node.nodeType === "defense") score += 48_000;
  if (node.nodeType === "motion") score += 46_000;
  if (isEvidenceLinkedNode(node)) score += 44_000;
  if (isHearingDepoInvestigateNode(node)) score += 30_000;

  const degree = params.degreeByNodeId?.get(node.id) ?? 0;
  score += Math.min(degree, 40) * 120;

  const support = params.sourceSupportByNodeId?.get(node.id) ?? 0;
  score += Math.min(support, 30) * 80;

  return score;
}

function compareNodesStable(
  a: SelectableGraphNode,
  b: SelectableGraphNode,
  scoreOf: (n: SelectableGraphNode) => number,
): number {
  const scoreDiff = scoreOf(b) - scoreOf(a);
  if (scoreDiff !== 0) return scoreDiff;
  const typeCmp = a.nodeType.localeCompare(b.nodeType);
  if (typeCmp !== 0) return typeCmp;
  const nameCmp = a.displayName.localeCompare(b.displayName);
  if (nameCmp !== 0) return nameCmp;
  return a.id.localeCompare(b.id);
}

/**
 * Rank and bound nodes. Whole-matter mode seeds one representative per domain
 * before filling by score so caps do not collapse to a single node type.
 */
export function selectNodesForGraphExtraction(params: {
  candidates: SelectableGraphNode[];
  cap?: number;
  selectionMode: GraphSelectionMode;
  focusNodeId?: string | null;
  neighborhoodIds?: ReadonlySet<string>;
  degreeByNodeId?: ReadonlyMap<string, number>;
  sourceSupportByNodeId?: ReadonlyMap<string, number>;
}): SelectableGraphNode[] {
  const cap = params.cap ?? GRAPH_EXTRACT_NODE_CAP;
  if (params.candidates.length === 0 || cap <= 0) return [];

  const scoreOf = (node: SelectableGraphNode) =>
    scoreGraphNodeForExtraction({
      node,
      focusNodeId: params.focusNodeId,
      neighborhoodIds: params.neighborhoodIds,
      degreeByNodeId: params.degreeByNodeId,
      sourceSupportByNodeId: params.sourceSupportByNodeId,
    });

  const ranked = [...params.candidates].sort((a, b) => compareNodesStable(a, b, scoreOf));

  if (params.selectionMode === "FOCUSED" || ranked.length <= cap) {
    return ranked.slice(0, Math.min(cap, ranked.length));
  }

  const selected: SelectableGraphNode[] = [];
  const selectedIds = new Set<string>();
  const seenTypes = new Set<string>();

  // Phase 1: one highest-ranked node per domain (nodeType).
  for (const node of ranked) {
    if (selected.length >= cap) break;
    if (seenTypes.has(node.nodeType)) continue;
    selected.push(node);
    selectedIds.add(node.id);
    seenTypes.add(node.nodeType);
  }

  // Phase 2: fill by score.
  for (const node of ranked) {
    if (selected.length >= cap) break;
    if (selectedIds.has(node.id)) continue;
    selected.push(node);
    selectedIds.add(node.id);
  }

  return selected.sort((a, b) => compareNodesStable(a, b, scoreOf));
}

export function scoreChunkForGraphExtraction(params: {
  chunk: SelectableChunk;
  preferredDocumentIds: ReadonlySet<string>;
}): number {
  return params.preferredDocumentIds.has(params.chunk.documentId) ? 1_000 : 0;
}

function compareChunksStable(
  a: SelectableChunk,
  b: SelectableChunk,
  preferredDocumentIds: ReadonlySet<string>,
): number {
  const scoreDiff =
    scoreChunkForGraphExtraction({ chunk: b, preferredDocumentIds }) -
    scoreChunkForGraphExtraction({ chunk: a, preferredDocumentIds });
  if (scoreDiff !== 0) return scoreDiff;
  const docCmp = a.documentId.localeCompare(b.documentId);
  if (docCmp !== 0) return docCmp;
  if (a.chunkIndex !== b.chunkIndex) return a.chunkIndex - b.chunkIndex;
  return a.id.localeCompare(b.id);
}

/**
 * Rank chunks by association to preferred documents, then diversify by documentId
 * so one document cannot monopolize the bounded set.
 */
export function selectChunksForGraphExtraction(params: {
  candidates: SelectableChunk[];
  preferredDocumentIds: ReadonlySet<string>;
  cap?: number;
  maxPerDocument?: number;
}): SelectableChunk[] {
  const cap = params.cap ?? GRAPH_EXTRACT_CHUNK_CAP;
  const maxPerDocument = params.maxPerDocument ?? GRAPH_EXTRACT_MAX_CHUNKS_PER_DOC;
  if (params.candidates.length === 0 || cap <= 0) return [];

  const ranked = [...params.candidates].sort((a, b) =>
    compareChunksStable(a, b, params.preferredDocumentIds),
  );

  const selected: SelectableChunk[] = [];
  const perDoc = new Map<string, number>();

  const tryTake = (chunk: SelectableChunk, limit: number) => {
    if (selected.length >= cap) return;
    const count = perDoc.get(chunk.documentId) ?? 0;
    if (count >= limit) return;
    if (selected.some((s) => s.id === chunk.id)) return;
    selected.push(chunk);
    perDoc.set(chunk.documentId, count + 1);
  };

  // Prefer preferred docs first under per-doc cap.
  for (const chunk of ranked) {
    if (!params.preferredDocumentIds.has(chunk.documentId)) continue;
    tryTake(chunk, maxPerDocument);
  }
  // Then remaining candidates under the same per-doc cap.
  for (const chunk of ranked) {
    tryTake(chunk, maxPerDocument);
  }
  // If still under cap (few documents), allow a second pass with a higher per-doc ceiling.
  if (selected.length < cap) {
    const relaxed = Math.max(maxPerDocument * 2, maxPerDocument + 2);
    for (const chunk of ranked) {
      tryTake(chunk, relaxed);
    }
  }

  return selected.sort((a, b) => compareChunksStable(a, b, params.preferredDocumentIds));
}

export function buildGraphExtractionCoverage(params: {
  candidateNodes: number;
  selectedNodes: number;
  candidateChunks: number;
  selectedChunks: number;
  selectionMode: GraphSelectionMode;
  domainsRepresented: string[];
  selectedNodeIds: string[];
  selectedChunkIds: string[];
}): GraphExtractionCoverage {
  const omittedNodeCount = Math.max(0, params.candidateNodes - params.selectedNodes);
  const omittedChunkCount = Math.max(0, params.candidateChunks - params.selectedChunks);
  const truncated = omittedNodeCount > 0 || omittedChunkCount > 0;
  return {
    candidateNodes: params.candidateNodes,
    selectedNodes: params.selectedNodes,
    candidateChunks: params.candidateChunks,
    selectedChunks: params.selectedChunks,
    selectionMode: params.selectionMode,
    coverageLimited: truncated,
    truncated,
    omittedNodeCount,
    omittedChunkCount,
    domainsRepresented: [...params.domainsRepresented].sort((a, b) => a.localeCompare(b)),
    selectionBasis: "relevance_ranked_bounded",
    selectedNodeIds: [...params.selectedNodeIds],
    selectedChunkIds: [...params.selectedChunkIds],
  };
}

export function preferredDocumentIdsFromNodes(nodes: SelectableGraphNode[]): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (node.nodeType === "document" || node.canonicalEntityType === "document") {
      ids.add(node.canonicalEntityId);
    }
  }
  return ids;
}

export function degreeMapFromEdges(
  edges: Array<{ fromNodeId: string; toNodeId: string }>,
): Map<string, number> {
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.fromNodeId, (degree.get(edge.fromNodeId) ?? 0) + 1);
    degree.set(edge.toNodeId, (degree.get(edge.toNodeId) ?? 0) + 1);
  }
  return degree;
}

export function neighborhoodIdsFromFocus(
  focusNodeId: string,
  edges: Array<{ fromNodeId: string; toNodeId: string }>,
): Set<string> {
  const ids = new Set<string>([focusNodeId]);
  for (const edge of edges) {
    if (edge.fromNodeId === focusNodeId) ids.add(edge.toNodeId);
    if (edge.toNodeId === focusNodeId) ids.add(edge.fromNodeId);
  }
  return ids;
}
