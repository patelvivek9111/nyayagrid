import type { SourceProvenance } from "../legal/types";

/**
 * Matter graph nodes require a matter and a closed enum (person, document, event, …).
 * Prosecution records are case-scoped and include charges, elements, warrants, and standards.
 * Writing those into graph_nodes would invent matters and collapse case isolation.
 * This projection is the shared traversal. It does not insert into graph_nodes.
 */
export const SHARED_GRAPH_DECISION = {
  decision: "PROJECTION_BRIDGE",
  rationale:
    "Prosecution and legal-intelligence records stay in their own tables. A projection exposes Charge, Element, Evidence, Issue, Authority, Standard, Witness, Warrant, and Motion traversals with the same provenance the source rows already store.",
} as const;

export type SharedGraphNode = {
  id: string;
  kind: string;
  label: string;
  provenance: SourceProvenance | null;
};

export type SharedGraphEdge = {
  fromId: string;
  toId: string;
  relationship: string;
  provenance: SourceProvenance | null;
};

export type SharedGraph = {
  decision: typeof SHARED_GRAPH_DECISION.decision;
  nodes: SharedGraphNode[];
  edges: SharedGraphEdge[];
};

type Ref = { id: string; label?: string; provenance?: SourceProvenance | null };

export function projectSharedLegalGraph(input: {
  criminalCase?: Ref | null;
  charges?: Array<Ref & { defendantId?: string | null }>;
  elements?: Array<Ref & { chargeId: string; evidenceIds?: string[]; issueIds?: string[] }>;
  evidence?: Ref[];
  witnesses?: Array<Ref & { evidenceIds?: string[] }>;
  warrants?: Array<Ref & { evidenceIds?: string[] }>;
  motions?: Array<Ref & { issueIds?: string[] }>;
  issues?: Array<Ref & { authorityIds?: string[] }>;
  authorities?: Array<Ref & { standardIds?: string[]; relatedAuthorityIds?: string[] }>;
  standards?: Ref[];
}): SharedGraph {
  const nodes: SharedGraphNode[] = [];
  const edges: SharedGraphEdge[] = [];
  const seen = new Set<string>();

  function addNode(kind: string, ref: Ref | null | undefined) {
    if (!ref) return;
    const key = `${kind}:${ref.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    nodes.push({
      id: ref.id,
      kind,
      label: ref.label ?? ref.id,
      provenance: ref.provenance ?? null,
    });
  }

  function addEdge(fromId: string, toId: string, relationship: string, provenance: SourceProvenance | null | undefined) {
    edges.push({ fromId, toId, relationship, provenance: provenance ?? null });
  }

  addNode("CriminalCase", input.criminalCase);
  for (const charge of input.charges ?? []) {
    addNode("Charge", charge);
    if (input.criminalCase) addEdge(input.criminalCase.id, charge.id, "HAS_CHARGE", charge.provenance);
  }
  for (const element of input.elements ?? []) {
    addNode("ChargeElement", element);
    addEdge(element.chargeId, element.id, "HAS_ELEMENT", element.provenance);
    for (const evidenceId of element.evidenceIds ?? []) {
      addEdge(element.id, evidenceId, "ELEMENT_EVIDENCE", element.provenance);
    }
    for (const issueId of element.issueIds ?? []) {
      addEdge(element.id, issueId, "ELEMENT_ISSUE", element.provenance);
    }
  }
  for (const item of input.evidence ?? []) addNode("Evidence", item);
  for (const witness of input.witnesses ?? []) {
    addNode("Witness", witness);
    for (const evidenceId of witness.evidenceIds ?? []) {
      addEdge(evidenceId, witness.id, "EVIDENCE_WITNESS", witness.provenance);
    }
  }
  for (const warrant of input.warrants ?? []) {
    addNode("Warrant", warrant);
    for (const evidenceId of warrant.evidenceIds ?? []) {
      addEdge(warrant.id, evidenceId, "WARRANT_EVIDENCE", warrant.provenance);
    }
  }
  for (const motion of input.motions ?? []) {
    addNode("Motion", motion);
    for (const issueId of motion.issueIds ?? []) {
      addEdge(motion.id, issueId, "MOTION_ISSUE", motion.provenance);
    }
  }
  for (const issue of input.issues ?? []) {
    addNode("LegalIssue", issue);
    for (const authorityId of issue.authorityIds ?? []) {
      addEdge(issue.id, authorityId, "ISSUE_AUTHORITY", issue.provenance);
    }
  }
  for (const authority of input.authorities ?? []) {
    addNode("Authority", authority);
    for (const standardId of authority.standardIds ?? []) {
      addEdge(authority.id, standardId, "AUTHORITY_STANDARD", authority.provenance);
    }
    for (const relatedId of authority.relatedAuthorityIds ?? []) {
      addNode("Authority", { id: relatedId, provenance: authority.provenance });
      addEdge(authority.id, relatedId, "AUTHORITY_AUTHORITY", authority.provenance);
    }
  }
  for (const standard of input.standards ?? []) addNode("LegalStandard", standard);

  return { decision: SHARED_GRAPH_DECISION.decision, nodes, edges };
}

export function traverseSharedGraph(graph: SharedGraph, startId: string, relationship: string): SharedGraphNode[] {
  const next = new Set(graph.edges.filter((edge) => edge.fromId === startId && edge.relationship === relationship).map((edge) => edge.toId));
  return graph.nodes.filter((node) => next.has(node.id));
}
