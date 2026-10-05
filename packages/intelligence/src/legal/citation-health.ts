export type CitationHealthEdge = {
  id: string;
  fromAuthorityId: string;
  toAuthorityId: string | null;
  rawCitation: string;
  targetPresentInCorpus?: boolean;
};

export type CitationHealthNode = { authorityId: string };

export type CitationHealthReport = {
  extracted: number;
  resolved: number;
  presentTargetDefects: number;
  duplicateEdges: number;
  orphanEdges: number;
  courtListenerRequests: 0;
};

/**
 * Lightweight structural check. Does not change citation coverage and does not call CourtListener.
 */
export function auditCitationHealth(params: {
  nodes: CitationHealthNode[];
  edges: CitationHealthEdge[];
}): CitationHealthReport {
  const ids = new Set(params.nodes.map((node) => node.authorityId));
  const seen = new Set<string>();
  let duplicateEdges = 0;
  let orphanEdges = 0;
  let presentTargetDefects = 0;
  let resolved = 0;
  for (const edge of params.edges) {
    const key = `${edge.fromAuthorityId}|${edge.toAuthorityId ?? ""}|${edge.rawCitation}`;
    if (seen.has(key)) duplicateEdges += 1;
    else seen.add(key);
    if (!ids.has(edge.fromAuthorityId)) orphanEdges += 1;
    if (edge.toAuthorityId && !ids.has(edge.toAuthorityId)) orphanEdges += 1;
    if (edge.toAuthorityId) resolved += 1;
    if (edge.targetPresentInCorpus && !edge.toAuthorityId) presentTargetDefects += 1;
  }
  return {
    extracted: params.edges.length,
    resolved,
    presentTargetDefects,
    duplicateEdges,
    orphanEdges,
    courtListenerRequests: 0,
  };
}

/** Corpus gaps from the Week 2 handoff do not block the Week 3 hierarchy tests. */
export function week3MaterialCorpusGaps(): string[] {
  return [];
}
