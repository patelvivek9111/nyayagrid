export type CitationEdge = {
  id: string;
  fromAuthorityId: string;
  toAuthorityId: string | null;
  rawCitation: string;
};

export type PrecedentAuthority = {
  authorityId: string;
  court: string | null;
  decisionDate: string | null;
  jurisdiction: string | null;
  citation: string | null;
};

export type PrecedentPath = {
  nodes: PrecedentAuthority[];
  edges: Array<{
    fromAuthorityId: string;
    toAuthorityId: string;
    relationship: "cites";
    court: string | null;
    date: string | null;
    jurisdiction: string | null;
    citation: string | null;
  }>;
  truncated: boolean;
  cycleBlocked: boolean;
};

const DEFAULT_DEPTH = 4;

function nodeOf(authorities: Map<string, PrecedentAuthority>, id: string): PrecedentAuthority {
  return (
    authorities.get(id) ?? {
      authorityId: id,
      court: null,
      decisionDate: null,
      jurisdiction: null,
      citation: null,
    }
  );
}

function resolvedEdges(edges: CitationEdge[]): Array<CitationEdge & { toAuthorityId: string }> {
  return edges.filter((edge): edge is CitationEdge & { toAuthorityId: string } => Boolean(edge.toAuthorityId));
}

export function citedAuthorities(edges: CitationEdge[], authorityId: string): string[] {
  return [...new Set(resolvedEdges(edges).filter((edge) => edge.fromAuthorityId === authorityId).map((edge) => edge.toAuthorityId))];
}

export function citingAuthorities(edges: CitationEdge[], authorityId: string): string[] {
  return [...new Set(resolvedEdges(edges).filter((edge) => edge.toAuthorityId === authorityId).map((edge) => edge.fromAuthorityId))];
}

export function authorityDepth(edges: CitationEdge[], authorityId: string): number {
  return traversePrecedent({ edges, startId: authorityId, direction: "ancestors", maxDepth: 12 }).nodes.length - 1;
}

export function highDemandAuthorities(edges: CitationEdge[], minimumInbound = 2): Array<{ authorityId: string; inbound: number }> {
  const counts = new Map<string, number>();
  for (const edge of resolvedEdges(edges)) {
    counts.set(edge.toAuthorityId, (counts.get(edge.toAuthorityId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, inbound]) => inbound >= minimumInbound)
    .map(([authorityId, inbound]) => ({ authorityId, inbound }))
    .sort((a, b) => b.inbound - a.inbound);
}

export function traversePrecedent(params: {
  edges: CitationEdge[];
  authorities?: PrecedentAuthority[];
  startId: string;
  direction: "ancestors" | "descendants";
  maxDepth?: number;
}): PrecedentPath {
  const maxDepth = params.maxDepth ?? DEFAULT_DEPTH;
  const authorities = new Map((params.authorities ?? []).map((authority) => [authority.authorityId, authority]));
  const outgoing = new Map<string, string[]>();
  for (const edge of resolvedEdges(params.edges)) {
    const from = params.direction === "ancestors" ? edge.fromAuthorityId : edge.toAuthorityId;
    const to = params.direction === "ancestors" ? edge.toAuthorityId : edge.fromAuthorityId;
    const list = outgoing.get(from) ?? [];
    list.push(to);
    outgoing.set(from, list);
  }

  const nodes: PrecedentAuthority[] = [nodeOf(authorities, params.startId)];
  const pathEdges: PrecedentPath["edges"] = [];
  const seen = new Set<string>([params.startId]);
  let truncated = false;
  let cycleBlocked = false;
  const queue: Array<{ id: string; depth: number }> = [{ id: params.startId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (current.depth >= maxDepth) {
      if ((outgoing.get(current.id) ?? []).length > 0) truncated = true;
      continue;
    }
    for (const next of outgoing.get(current.id) ?? []) {
      if (seen.has(next)) {
        cycleBlocked = true;
        continue;
      }
      seen.add(next);
      const nextNode = nodeOf(authorities, next);
      nodes.push(nextNode);
      const fromId = params.direction === "ancestors" ? current.id : next;
      const toId = params.direction === "ancestors" ? next : current.id;
      pathEdges.push({
        fromAuthorityId: fromId,
        toAuthorityId: toId,
        relationship: "cites",
        court: nextNode.court,
        date: nextNode.decisionDate,
        jurisdiction: nextNode.jurisdiction,
        citation: nextNode.citation,
      });
      queue.push({ id: next, depth: current.depth + 1 });
    }
  }

  return { nodes, edges: pathEdges, truncated, cycleBlocked };
}
