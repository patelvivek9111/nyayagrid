/**
 * Civil claim/defense graph materialization.
 *
 * Uses certified graph_node_type values `claim` and `defense` (migration 0021).
 * Reuses canonical matter_entity / matter_fact / document nodes when present.
 * Element, pleading (without document), legal issue, and authority nodes use
 * `other` + typed canonicalEntityType — no additional shared schema required.
 *
 * Does not invent liability conclusions.
 */

import {
  and,
  eq,
  civilAuthorityRelations,
  civilClaimElements,
  civilClaimParties,
  civilClaims,
  civilDefenseClaimRelations,
  civilDefenseParties,
  civilDefenses,
  civilEvidenceItems,
  civilEvidenceRelations,
  civilFactRelations,
  civilLegalIssueRelations,
  civilPleadings,
  legalAuthorities,
  legalIssues,
  matterEntities,
  matterFacts,
  type Database,
  type GraphNodeType,
} from "@nyayagrid/database";
import { upsertGraphEdge, upsertGraphNode } from "../graph/materialize";
import { CivilError } from "./domain";

export const CIVIL_GRAPH_EDGE = {
  INVOLVES_PARTY: "involves_party",
  HAS_ELEMENT: "has_element",
  SUPPORTED_BY: "supported_by",
  UNDERMINED_BY: "undermined_by",
  MISSING_EXPECTED_EVIDENCE: "missing_expected_evidence",
  RELATED_FACT: "related_fact",
  RELATED_LEGAL_ISSUE: "related_legal_issue",
  CITES_AUTHORITY: "cites_authority",
  PLED_IN: "pled_in",
  RESPONDS_TO: "responds_to",
  ASSERTED_BY: "asserted_by",
} as const;

export type CivilGraphEdgeType = (typeof CIVIL_GRAPH_EDGE)[keyof typeof CIVIL_GRAPH_EDGE];

export type CivilGraphNodePlan = {
  canonicalEntityType: string;
  canonicalEntityId: string;
  nodeType: GraphNodeType;
  displayName: string;
  metadata: Record<string, unknown>;
};

export type CivilGraphEdgePlan = {
  fromKey: string;
  toKey: string;
  relationshipType: CivilGraphEdgeType;
  label: string;
  metadata?: Record<string, unknown>;
};

export type CivilGraphMaterializationPlan = {
  nodes: CivilGraphNodePlan[];
  edges: CivilGraphEdgePlan[];
};

function nodeKey(canonicalEntityType: string, canonicalEntityId: string): string {
  return `${canonicalEntityType}:${canonicalEntityId}`;
}

function claimCurrentness(params: { isCurrent: boolean; proceduralStatus: string }): string {
  if (params.proceduralStatus === "WITHDRAWN") return "withdrawn";
  if (!params.isCurrent || params.proceduralStatus === "SUPERSEDED") return "superseded";
  if (params.proceduralStatus === "AMENDED") return "amended_current";
  return "current";
}

/** Pure planner used by unit tests and DB materializer. */
export function buildCivilGraphMaterializationPlan(input: {
  claims: Array<{
    id: string;
    kind: string;
    label: string;
    isCurrent: boolean;
    proceduralStatus: string;
    supportStatus: string;
    pleadingId: string | null;
    supersededById: string | null;
  }>;
  defenses: Array<{
    id: string;
    kind: string;
    label: string;
    isCurrent: boolean;
    proceduralStatus: string;
    supportStatus: string;
    pleadingId: string | null;
  }>;
  claimParties: Array<{ claimId: string; partyEntityId: string; role: string }>;
  defenseParties: Array<{ defenseId: string; partyEntityId: string; role: string }>;
  defenseClaimRelations: Array<{ defenseId: string; claimId: string }>;
  elements: Array<{ id: string; claimId: string | null; defenseId: string | null; label: string; status: string }>;
  pleadings: Array<{
    id: string;
    label: string;
    isCurrent: boolean;
    documentId: string | null;
    supersededById: string | null;
  }>;
  parties: Array<{ id: string; displayName: string; entityType: string }>;
  facts: Array<{ id: string; label: string; value: string }>;
  evidenceItems: Array<{ id: string; label: string; documentId: string | null }>;
  evidenceRelations: Array<{
    claimId: string | null;
    elementId: string | null;
    defenseId: string | null;
    evidenceId: string | null;
    role: string;
    note: string | null;
  }>;
  factRelations: Array<{
    claimId: string | null;
    elementId: string | null;
    defenseId: string | null;
    factId: string;
    role: string;
  }>;
  legalIssueRelations: Array<{
    claimId: string | null;
    elementId: string | null;
    defenseId: string | null;
    legalIssueId: string;
  }>;
  legalIssues: Array<{ id: string; description: string }>;
  authorityRelations: Array<{
    claimId: string | null;
    elementId: string | null;
    defenseId: string | null;
    authorityId: string;
    relation: string;
    citation?: string | null;
  }>;
  authorities: Array<{ id: string; title: string; citation: string | null }>;
}): CivilGraphMaterializationPlan {
  const nodes = new Map<string, CivilGraphNodePlan>();
  const edges: CivilGraphEdgePlan[] = [];
  const edgeKeys = new Set<string>();

  const addNode = (node: CivilGraphNodePlan) => {
    nodes.set(nodeKey(node.canonicalEntityType, node.canonicalEntityId), node);
  };
  const addEdge = (edge: CivilGraphEdgePlan) => {
    const key = `${edge.fromKey}|${edge.relationshipType}|${edge.toKey}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push(edge);
  };

  const partyById = new Map(input.parties.map((party) => [party.id, party]));
  const factById = new Map(input.facts.map((fact) => [fact.id, fact]));
  const evidenceById = new Map(input.evidenceItems.map((item) => [item.id, item]));
  const pleadingById = new Map(input.pleadings.map((pleading) => [pleading.id, pleading]));
  const issueById = new Map(input.legalIssues.map((issue) => [issue.id, issue]));
  const authorityById = new Map(input.authorities.map((authority) => [authority.id, authority]));
  const claimIds = new Set(input.claims.map((claim) => claim.id));
  const defenseIds = new Set(input.defenses.map((defense) => defense.id));
  const elementIds = new Set(input.elements.map((element) => element.id));

  for (const party of input.parties) {
    addNode({
      canonicalEntityType: "matter_entity",
      canonicalEntityId: party.id,
      nodeType: party.entityType === "organization" ? "organization" : "person",
      displayName: party.displayName,
      metadata: { source: "civil_graph" },
    });
  }

  for (const fact of input.facts) {
    addNode({
      canonicalEntityType: "matter_fact",
      canonicalEntityId: fact.id,
      nodeType: "fact",
      displayName: `${fact.label}: ${fact.value}`.slice(0, 200),
      metadata: { source: "civil_graph" },
    });
  }

  for (const pleading of input.pleadings) {
    if (pleading.documentId) {
      addNode({
        canonicalEntityType: "document",
        canonicalEntityId: pleading.documentId,
        nodeType: "document",
        displayName: pleading.label,
        metadata: {
          source: "civil_graph",
          civilPleadingId: pleading.id,
          isCurrent: pleading.isCurrent,
          supersededById: pleading.supersededById,
        },
      });
    } else {
      addNode({
        canonicalEntityType: "civil_pleading",
        canonicalEntityId: pleading.id,
        nodeType: "other",
        displayName: pleading.label,
        metadata: {
          source: "civil_graph",
          kind: "pleading",
          isCurrent: pleading.isCurrent,
          supersededById: pleading.supersededById,
        },
      });
    }
  }

  for (const evidence of input.evidenceItems) {
    if (evidence.documentId) {
      addNode({
        canonicalEntityType: "document",
        canonicalEntityId: evidence.documentId,
        nodeType: "document",
        displayName: evidence.label,
        metadata: { source: "civil_graph", civilEvidenceItemId: evidence.id },
      });
    } else {
      addNode({
        canonicalEntityType: "civil_evidence_item",
        canonicalEntityId: evidence.id,
        nodeType: "other",
        displayName: evidence.label,
        metadata: { source: "civil_graph", kind: "evidence" },
      });
    }
  }

  for (const issue of input.legalIssues) {
    addNode({
      canonicalEntityType: "legal_issue",
      canonicalEntityId: issue.id,
      nodeType: "other",
      displayName: issue.description.slice(0, 200),
      metadata: { source: "civil_graph", kind: "legal_issue" },
    });
  }

  for (const authority of input.authorities) {
    addNode({
      canonicalEntityType: "legal_authority",
      canonicalEntityId: authority.id,
      nodeType: "other",
      displayName: authority.citation?.trim() || authority.title,
      metadata: { source: "civil_graph", kind: "authority", citation: authority.citation },
    });
  }

  for (const element of input.elements) {
    addNode({
      canonicalEntityType: "civil_claim_element",
      canonicalEntityId: element.id,
      nodeType: "other",
      displayName: element.label,
      metadata: {
        source: "civil_graph",
        kind: "claim_element",
        status: element.status,
        claimId: element.claimId,
        defenseId: element.defenseId,
      },
    });
  }

  for (const claim of input.claims) {
    const currentness = claimCurrentness(claim);
    addNode({
      canonicalEntityType: "civil_claim",
      canonicalEntityId: claim.id,
      nodeType: "claim",
      displayName: claim.label,
      metadata: {
        source: "civil_graph",
        kind: claim.kind,
        isCurrent: claim.isCurrent,
        proceduralStatus: claim.proceduralStatus,
        supportStatus: claim.supportStatus,
        currentness,
        supersededById: claim.supersededById,
        pleadingId: claim.pleadingId,
      },
    });

    const claimKey = nodeKey("civil_claim", claim.id);
    if (claim.pleadingId) {
      const pleading = pleadingById.get(claim.pleadingId);
      if (pleading) {
        const pleadingKey = pleading.documentId
          ? nodeKey("document", pleading.documentId)
          : nodeKey("civil_pleading", pleading.id);
        addEdge({
          fromKey: claimKey,
          toKey: pleadingKey,
          relationshipType: CIVIL_GRAPH_EDGE.PLED_IN,
          label: `Pled in ${pleading.label}`,
          metadata: { pleadingIsCurrent: pleading.isCurrent },
        });
      }
    }
  }

  for (const defense of input.defenses) {
    const currentness = claimCurrentness(defense);
    addNode({
      canonicalEntityType: "civil_defense",
      canonicalEntityId: defense.id,
      nodeType: "defense",
      displayName: defense.label,
      metadata: {
        source: "civil_graph",
        kind: defense.kind,
        isCurrent: defense.isCurrent,
        proceduralStatus: defense.proceduralStatus,
        supportStatus: defense.supportStatus,
        currentness,
        pleadingId: defense.pleadingId,
      },
    });
  }

  for (const row of input.claimParties) {
    if (!claimIds.has(row.claimId) || !partyById.has(row.partyEntityId)) continue;
    addEdge({
      fromKey: nodeKey("civil_claim", row.claimId),
      toKey: nodeKey("matter_entity", row.partyEntityId),
      relationshipType: CIVIL_GRAPH_EDGE.INVOLVES_PARTY,
      label: row.role,
      metadata: { role: row.role },
    });
  }

  for (const row of input.defenseParties) {
    if (!defenseIds.has(row.defenseId) || !partyById.has(row.partyEntityId)) continue;
    addEdge({
      fromKey: nodeKey("civil_defense", row.defenseId),
      toKey: nodeKey("matter_entity", row.partyEntityId),
      relationshipType: CIVIL_GRAPH_EDGE.ASSERTED_BY,
      label: row.role,
      metadata: { role: row.role },
    });
  }

  for (const row of input.defenseClaimRelations) {
    if (!defenseIds.has(row.defenseId) || !claimIds.has(row.claimId)) continue;
    addEdge({
      fromKey: nodeKey("civil_defense", row.defenseId),
      toKey: nodeKey("civil_claim", row.claimId),
      relationshipType: CIVIL_GRAPH_EDGE.RESPONDS_TO,
      label: "Responds to claim",
    });
  }

  for (const element of input.elements) {
    const elementKey = nodeKey("civil_claim_element", element.id);
    if (element.claimId && claimIds.has(element.claimId)) {
      addEdge({
        fromKey: nodeKey("civil_claim", element.claimId),
        toKey: elementKey,
        relationshipType: CIVIL_GRAPH_EDGE.HAS_ELEMENT,
        label: element.label,
        metadata: { status: element.status },
      });
    }
    if (element.defenseId && defenseIds.has(element.defenseId)) {
      addEdge({
        fromKey: nodeKey("civil_defense", element.defenseId),
        toKey: elementKey,
        relationshipType: CIVIL_GRAPH_EDGE.HAS_ELEMENT,
        label: element.label,
        metadata: { status: element.status },
      });
    }
  }

  const parentKeyFor = (row: {
    claimId: string | null;
    elementId: string | null;
    defenseId: string | null;
  }): string | null => {
    if (row.elementId && elementIds.has(row.elementId)) return nodeKey("civil_claim_element", row.elementId);
    if (row.claimId && claimIds.has(row.claimId)) return nodeKey("civil_claim", row.claimId);
    if (row.defenseId && defenseIds.has(row.defenseId)) return nodeKey("civil_defense", row.defenseId);
    return null;
  };

  const evidenceTargetKey = (evidenceId: string | null): string | null => {
    if (!evidenceId) return null;
    const evidence = evidenceById.get(evidenceId);
    if (!evidence) return null;
    return evidence.documentId
      ? nodeKey("document", evidence.documentId)
      : nodeKey("civil_evidence_item", evidence.id);
  };

  for (const row of input.evidenceRelations) {
    const fromKey = parentKeyFor(row);
    if (!fromKey) continue;
    if (row.role === "MISSING_EXPECTED") {
      // Free-text missing evidence has no canonical UUID target; preserve note on parent claim/element metadata only.
      const parentNode = nodes.get(fromKey);
      if (parentNode) {
        const existing = Array.isArray(parentNode.metadata.missingExpectedEvidence)
          ? (parentNode.metadata.missingExpectedEvidence as string[])
          : [];
        parentNode.metadata.missingExpectedEvidence = [...existing, row.note ?? "Missing expected evidence"];
      }
      if (row.evidenceId) {
        const toKey = evidenceTargetKey(row.evidenceId);
        if (toKey) {
          addEdge({
            fromKey,
            toKey,
            relationshipType: CIVIL_GRAPH_EDGE.MISSING_EXPECTED_EVIDENCE,
            label: row.note ?? "Missing expected evidence",
          });
        }
      }
      continue;
    }
    const toKey = evidenceTargetKey(row.evidenceId);
    if (!toKey) continue;
    const relationshipType =
      row.role === "UNDERMINES" || row.role === "CONTRADICTS"
        ? CIVIL_GRAPH_EDGE.UNDERMINED_BY
        : CIVIL_GRAPH_EDGE.SUPPORTED_BY;
    addEdge({
      fromKey,
      toKey,
      relationshipType,
      label: row.role,
      metadata: { evidenceRole: row.role },
    });
  }

  for (const row of input.factRelations) {
    const fromKey = parentKeyFor(row);
    if (!fromKey || !factById.has(row.factId)) continue;
    addEdge({
      fromKey,
      toKey: nodeKey("matter_fact", row.factId),
      relationshipType: CIVIL_GRAPH_EDGE.RELATED_FACT,
      label: row.role,
      metadata: { factRole: row.role },
    });
  }

  for (const row of input.legalIssueRelations) {
    const fromKey = parentKeyFor(row);
    if (!fromKey || !issueById.has(row.legalIssueId)) continue;
    addEdge({
      fromKey,
      toKey: nodeKey("legal_issue", row.legalIssueId),
      relationshipType: CIVIL_GRAPH_EDGE.RELATED_LEGAL_ISSUE,
      label: "Legal issue",
    });
  }

  for (const row of input.authorityRelations) {
    const fromKey = parentKeyFor(row);
    if (!fromKey || !authorityById.has(row.authorityId)) continue;
    addEdge({
      fromKey,
      toKey: nodeKey("legal_authority", row.authorityId),
      relationshipType: CIVIL_GRAPH_EDGE.CITES_AUTHORITY,
      label: row.relation,
      metadata: { authorityRelation: row.relation, citation: row.citation ?? null },
    });
  }

  return { nodes: [...nodes.values()], edges };
}

export async function materializeCivilGraph(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  userId?: string | null;
}): Promise<{ nodesUpserted: number; edgesCreated: number; edgesMerged: number; plan: CivilGraphMaterializationPlan }> {
  const scope = and(
    eq(civilClaims.organizationId, params.organizationId),
    eq(civilClaims.matterId, params.matterId),
  );

  const [
    claims,
    defenses,
    claimParties,
    defenseParties,
    defenseClaimRelations,
    elements,
    pleadings,
    parties,
    facts,
    evidenceItems,
    evidenceRelations,
    factRelations,
    legalIssueRelations,
    authorityRelations,
  ] = await Promise.all([
    params.db
      .select()
      .from(civilClaims)
      .where(scope),
    params.db
      .select()
      .from(civilDefenses)
      .where(
        and(
          eq(civilDefenses.organizationId, params.organizationId),
          eq(civilDefenses.matterId, params.matterId),
        ),
      ),
    params.db
      .select()
      .from(civilClaimParties)
      .where(
        and(
          eq(civilClaimParties.organizationId, params.organizationId),
          eq(civilClaimParties.matterId, params.matterId),
        ),
      ),
    params.db
      .select()
      .from(civilDefenseParties)
      .where(
        and(
          eq(civilDefenseParties.organizationId, params.organizationId),
          eq(civilDefenseParties.matterId, params.matterId),
        ),
      ),
    params.db
      .select()
      .from(civilDefenseClaimRelations)
      .where(
        and(
          eq(civilDefenseClaimRelations.organizationId, params.organizationId),
          eq(civilDefenseClaimRelations.matterId, params.matterId),
        ),
      ),
    params.db
      .select()
      .from(civilClaimElements)
      .where(
        and(
          eq(civilClaimElements.organizationId, params.organizationId),
          eq(civilClaimElements.matterId, params.matterId),
        ),
      ),
    params.db
      .select()
      .from(civilPleadings)
      .where(
        and(
          eq(civilPleadings.organizationId, params.organizationId),
          eq(civilPleadings.matterId, params.matterId),
        ),
      ),
    params.db
      .select()
      .from(matterEntities)
      .where(
        and(
          eq(matterEntities.organizationId, params.organizationId),
          eq(matterEntities.matterId, params.matterId),
        ),
      ),
    params.db
      .select()
      .from(matterFacts)
      .where(
        and(
          eq(matterFacts.organizationId, params.organizationId),
          eq(matterFacts.matterId, params.matterId),
        ),
      ),
    params.db
      .select()
      .from(civilEvidenceItems)
      .where(
        and(
          eq(civilEvidenceItems.organizationId, params.organizationId),
          eq(civilEvidenceItems.matterId, params.matterId),
        ),
      ),
    params.db
      .select()
      .from(civilEvidenceRelations)
      .where(
        and(
          eq(civilEvidenceRelations.organizationId, params.organizationId),
          eq(civilEvidenceRelations.matterId, params.matterId),
        ),
      ),
    params.db
      .select()
      .from(civilFactRelations)
      .where(
        and(
          eq(civilFactRelations.organizationId, params.organizationId),
          eq(civilFactRelations.matterId, params.matterId),
        ),
      ),
    params.db
      .select()
      .from(civilLegalIssueRelations)
      .where(
        and(
          eq(civilLegalIssueRelations.organizationId, params.organizationId),
          eq(civilLegalIssueRelations.matterId, params.matterId),
        ),
      ),
    params.db
      .select()
      .from(civilAuthorityRelations)
      .where(
        and(
          eq(civilAuthorityRelations.organizationId, params.organizationId),
          eq(civilAuthorityRelations.matterId, params.matterId),
        ),
      ),
  ]);

  if (claims.length === 0 && defenses.length === 0) {
    return {
      nodesUpserted: 0,
      edgesCreated: 0,
      edgesMerged: 0,
      plan: { nodes: [], edges: [] },
    };
  }

  const issueIds = [...new Set(legalIssueRelations.map((row) => row.legalIssueId))];
  const authorityIds = [...new Set(authorityRelations.map((row) => row.authorityId))];

  const legalIssueRows =
    issueIds.length === 0
      ? []
      : await params.db
          .select()
          .from(legalIssues)
          .where(
            and(
              eq(legalIssues.organizationId, params.organizationId),
              eq(legalIssues.matterId, params.matterId),
            ),
          );
  const authorityRows =
    authorityIds.length === 0
      ? []
      : await params.db.select().from(legalAuthorities);

  const scopedIssues = legalIssueRows.filter((issue) => issueIds.includes(issue.id));
  const scopedAuthorities = authorityRows.filter((authority) => authorityIds.includes(authority.id));

  // Reject cross-matter leakage: only keep relations whose parents exist in this matter's claim/defense/element sets.
  const claimIdSet = new Set(claims.map((claim) => claim.id));
  const defenseIdSet = new Set(defenses.map((defense) => defense.id));
  const elementIdSet = new Set(elements.map((element) => element.id));
  const partyIdSet = new Set(parties.map((party) => party.id));
  const factIdSet = new Set(facts.map((fact) => fact.id));
  const evidenceIdSet = new Set(evidenceItems.map((item) => item.id));

  for (const row of claimParties) {
    if (!claimIdSet.has(row.claimId) || !partyIdSet.has(row.partyEntityId)) {
      throw new CivilError("CROSS_MATTER", "Civil claim party relation escaped matter scope.", 403);
    }
  }
  for (const row of defenseClaimRelations) {
    if (!defenseIdSet.has(row.defenseId) || !claimIdSet.has(row.claimId)) {
      throw new CivilError("CROSS_MATTER", "Civil defense-claim relation escaped matter scope.", 403);
    }
  }
  for (const row of evidenceRelations) {
    if (row.evidenceId && !evidenceIdSet.has(row.evidenceId) && row.role !== "MISSING_EXPECTED") {
      throw new CivilError("CROSS_MATTER", "Civil evidence relation escaped matter scope.", 403);
    }
    if (row.claimId && !claimIdSet.has(row.claimId)) {
      throw new CivilError("CROSS_MATTER", "Civil evidence relation claim escaped matter scope.", 403);
    }
    if (row.defenseId && !defenseIdSet.has(row.defenseId)) {
      throw new CivilError("CROSS_MATTER", "Civil evidence relation defense escaped matter scope.", 403);
    }
    if (row.elementId && !elementIdSet.has(row.elementId)) {
      throw new CivilError("CROSS_MATTER", "Civil evidence relation element escaped matter scope.", 403);
    }
  }
  for (const row of factRelations) {
    if (!factIdSet.has(row.factId)) {
      throw new CivilError("CROSS_MATTER", "Civil fact relation escaped matter scope.", 403);
    }
  }

  const plan = buildCivilGraphMaterializationPlan({
    claims: claims.map((claim) => ({
      id: claim.id,
      kind: claim.kind,
      label: claim.label,
      isCurrent: claim.isCurrent,
      proceduralStatus: claim.proceduralStatus,
      supportStatus: claim.supportStatus,
      pleadingId: claim.pleadingId,
      supersededById: claim.supersededById,
    })),
    defenses: defenses.map((defense) => ({
      id: defense.id,
      kind: defense.kind,
      label: defense.label,
      isCurrent: defense.isCurrent,
      proceduralStatus: defense.proceduralStatus,
      supportStatus: defense.supportStatus,
      pleadingId: defense.pleadingId,
    })),
    claimParties: claimParties.map((row) => ({
      claimId: row.claimId,
      partyEntityId: row.partyEntityId,
      role: row.role,
    })),
    defenseParties: defenseParties.map((row) => ({
      defenseId: row.defenseId,
      partyEntityId: row.partyEntityId,
      role: row.role,
    })),
    defenseClaimRelations: defenseClaimRelations.map((row) => ({
      defenseId: row.defenseId,
      claimId: row.claimId,
    })),
    elements: elements.map((element) => ({
      id: element.id,
      claimId: element.claimId,
      defenseId: element.defenseId,
      label: element.label,
      status: element.status,
    })),
    pleadings: pleadings.map((pleading) => ({
      id: pleading.id,
      label: pleading.label,
      isCurrent: pleading.isCurrent,
      documentId: pleading.documentId,
      supersededById: pleading.supersededById,
    })),
    parties: parties.map((party) => ({
      id: party.id,
      displayName: party.displayName,
      entityType: party.entityType,
    })),
    facts: facts.map((fact) => ({
      id: fact.id,
      label: fact.label,
      value: fact.value,
    })),
    evidenceItems: evidenceItems.map((item) => ({
      id: item.id,
      label: item.label,
      documentId: item.documentId,
    })),
    evidenceRelations: evidenceRelations.map((row) => ({
      claimId: row.claimId,
      elementId: row.elementId,
      defenseId: row.defenseId,
      evidenceId: row.evidenceId,
      role: row.role,
      note: row.note,
    })),
    factRelations: factRelations.map((row) => ({
      claimId: row.claimId,
      elementId: row.elementId,
      defenseId: row.defenseId,
      factId: row.factId,
      role: row.role,
    })),
    legalIssueRelations: legalIssueRelations.map((row) => ({
      claimId: row.claimId,
      elementId: row.elementId,
      defenseId: row.defenseId,
      legalIssueId: row.legalIssueId,
    })),
    legalIssues: scopedIssues.map((issue) => ({
      id: issue.id,
      description: issue.description,
    })),
    authorityRelations: authorityRelations.map((row) => ({
      claimId: row.claimId,
      elementId: row.elementId,
      defenseId: row.defenseId,
      authorityId: row.authorityId,
      relation: row.relation,
    })),
    authorities: scopedAuthorities.map((authority) => ({
      id: authority.id,
      title: authority.title,
      citation: authority.citation,
    })),
  });

  const persistableNodes = plan.nodes.filter((node) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      node.canonicalEntityId,
    ),
  );

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
      origin: "manual",
      status: "approved",
      confidence: "high",
      userId: params.userId,
      metadata: {
        source: "civil_graph",
        ...(edge.metadata ?? {}),
      },
    });
    if (result.merged) edgesMerged += 1;
    else edgesCreated += 1;
  }

  return { nodesUpserted, edgesCreated, edgesMerged, plan };
}

/** Traversal helpers for production-useful civil graph questions (non-deciding). */
export function summarizeCivilGraphTraversal(params: {
  nodes: Array<{
    id: string;
    nodeType: string;
    displayName: string;
    canonicalEntityType: string;
    canonicalEntityId: string;
    metadata?: Record<string, unknown> | null;
  }>;
  edges: Array<{
    fromNodeId: string;
    toNodeId: string;
    relationshipType: string;
    label?: string | null;
  }>;
}): {
  evidenceByClaim: Array<{ claimId: string; claimLabel: string; supporting: string[]; contrary: string[] }>;
  authoritiesByDefense: Array<{ defenseId: string; defenseLabel: string; authorities: string[] }>;
  sharedEvidence: Array<{ evidenceLabel: string; claimLabels: string[] }>;
  counterclaimParties: Array<{ claimLabel: string; parties: string[] }>;
  supersededClaims: Array<{ claimLabel: string; currentness: string }>;
} {
  const byId = new Map(params.nodes.map((node) => [node.id, node]));
  const claims = params.nodes.filter((node) => node.nodeType === "claim");
  const defenses = params.nodes.filter((node) => node.nodeType === "defense");

  const evidenceByClaim = claims.map((claim) => {
    const supporting: string[] = [];
    const contrary: string[] = [];
    for (const edge of params.edges) {
      if (edge.fromNodeId !== claim.id && !isElementOf(params, claim.id, edge.fromNodeId)) continue;
      const target = byId.get(edge.toNodeId);
      if (!target) continue;
      if (edge.relationshipType === CIVIL_GRAPH_EDGE.SUPPORTED_BY) supporting.push(target.displayName);
      if (edge.relationshipType === CIVIL_GRAPH_EDGE.UNDERMINED_BY) contrary.push(target.displayName);
    }
    return {
      claimId: claim.canonicalEntityId,
      claimLabel: claim.displayName,
      supporting: [...new Set(supporting)],
      contrary: [...new Set(contrary)],
    };
  });

  const authoritiesByDefense = defenses.map((defense) => {
    const authorities: string[] = [];
    for (const edge of params.edges) {
      if (edge.fromNodeId !== defense.id && !isElementOf(params, defense.id, edge.fromNodeId)) continue;
      if (edge.relationshipType !== CIVIL_GRAPH_EDGE.CITES_AUTHORITY) continue;
      const target = byId.get(edge.toNodeId);
      if (target) authorities.push(target.displayName);
    }
    return {
      defenseId: defense.canonicalEntityId,
      defenseLabel: defense.displayName,
      authorities: [...new Set(authorities)],
    };
  });

  const evidenceToClaims = new Map<string, Set<string>>();
  for (const claim of claims) {
    for (const edge of params.edges) {
      if (edge.fromNodeId !== claim.id && !isElementOf(params, claim.id, edge.fromNodeId)) continue;
      if (
        edge.relationshipType !== CIVIL_GRAPH_EDGE.SUPPORTED_BY &&
        edge.relationshipType !== CIVIL_GRAPH_EDGE.UNDERMINED_BY
      ) {
        continue;
      }
      const evidence = byId.get(edge.toNodeId);
      if (!evidence) continue;
      const set = evidenceToClaims.get(evidence.displayName) ?? new Set<string>();
      set.add(claim.displayName);
      evidenceToClaims.set(evidence.displayName, set);
    }
  }
  const sharedEvidence = [...evidenceToClaims.entries()]
    .filter(([, claimLabels]) => claimLabels.size > 1)
    .map(([evidenceLabel, claimLabels]) => ({
      evidenceLabel,
      claimLabels: [...claimLabels],
    }));

  const counterclaimParties = claims
    .filter((claim) => (claim.metadata?.kind as string | undefined) === "COUNTERCLAIM")
    .map((claim) => {
      const parties: string[] = [];
      for (const edge of params.edges) {
        if (edge.fromNodeId !== claim.id) continue;
        if (edge.relationshipType !== CIVIL_GRAPH_EDGE.INVOLVES_PARTY) continue;
        const party = byId.get(edge.toNodeId);
        if (party) parties.push(`${edge.label ?? "PARTY"}:${party.displayName}`);
      }
      return { claimLabel: claim.displayName, parties };
    });

  const supersededClaims = claims
    .filter((claim) => {
      const currentness = String(claim.metadata?.currentness ?? "");
      return currentness === "superseded" || currentness === "withdrawn" || claim.metadata?.isCurrent === false;
    })
    .map((claim) => ({
      claimLabel: claim.displayName,
      currentness: String(claim.metadata?.currentness ?? "superseded"),
    }));

  return {
    evidenceByClaim,
    authoritiesByDefense,
    sharedEvidence,
    counterclaimParties,
    supersededClaims,
  };
}

function isElementOf(
  params: {
    nodes: Array<{ id: string; metadata?: Record<string, unknown> | null }>;
    edges: Array<{ fromNodeId: string; toNodeId: string; relationshipType: string }>;
  },
  parentNodeId: string,
  maybeElementNodeId: string,
): boolean {
  return params.edges.some(
    (edge) =>
      edge.fromNodeId === parentNodeId &&
      edge.toNodeId === maybeElementNodeId &&
      edge.relationshipType === CIVIL_GRAPH_EDGE.HAS_ELEMENT,
  );
}
