import { describe, expect, it } from "vitest";
import { runComplexCivilClaimsFixture } from "./claims-fixtures";
import {
  buildCivilGraphMaterializationPlan,
  CIVIL_GRAPH_EDGE,
  summarizeCivilGraphTraversal,
} from "./graph-materialize";

function planFromFixture() {
  const { review } = runComplexCivilClaimsFixture();
  return buildCivilGraphMaterializationPlan({
    claims: review.claims.map((claim) => ({
      id: claim.id,
      kind: claim.kind,
      label: claim.label,
      isCurrent: claim.isCurrent,
      proceduralStatus: claim.proceduralStatus,
      supportStatus: claim.supportStatus,
      pleadingId: claim.pleadingId,
      supersededById: claim.supersededByClaimId,
    })),
    defenses: review.defenses.map((defense) => ({
      id: defense.id,
      kind: defense.kind,
      label: defense.label,
      isCurrent: defense.isCurrent,
      proceduralStatus: defense.proceduralStatus,
      supportStatus: defense.supportStatus,
      pleadingId: defense.pleadingId,
    })),
    claimParties: review.claims.flatMap((claim) =>
      claim.parties.map((party) => ({
        claimId: claim.id,
        partyEntityId: party.partyId,
        role: party.role,
      })),
    ),
    defenseParties: review.defenses.flatMap((defense) => [
      ...defense.assertingPartyIds.map((partyEntityId) => ({
        defenseId: defense.id,
        partyEntityId,
        role: "ASSERTING",
      })),
      ...defense.targetPartyIds.map((partyEntityId) => ({
        defenseId: defense.id,
        partyEntityId,
        role: "TARGET",
      })),
    ]),
    defenseClaimRelations: review.defenses.flatMap((defense) =>
      defense.againstClaimIds.map((claimId) => ({
        defenseId: defense.id,
        claimId,
      })),
    ),
    elements: [
      ...review.claims.flatMap((claim) =>
        claim.elements.map((element) => ({
          id: element.id,
          claimId: claim.id,
          defenseId: null,
          label: element.label,
          status: element.status,
        })),
      ),
      ...review.defenses.flatMap((defense) =>
        defense.elements.map((element) => ({
          id: element.id,
          claimId: null,
          defenseId: defense.id,
          label: element.label,
          status: element.status,
        })),
      ),
    ],
    pleadings: review.pleadings.map((pleading) => ({
      id: pleading.id,
      label: pleading.label,
      isCurrent: pleading.isCurrent,
      documentId: pleading.provenance.documentId,
      supersededById: pleading.supersededByPleadingId,
    })),
    parties: review.parties.map((party) => ({
      id: party.id,
      displayName: party.displayName,
      entityType: party.entityType,
    })),
    facts: review.facts.map((fact) => ({
      id: fact.id,
      label: fact.id,
      value: fact.text,
    })),
    evidenceItems: review.evidence.map((item) => ({
      id: item.id,
      label: item.label,
      documentId: item.documentId,
    })),
    evidenceRelations: [
      ...review.claims.flatMap((claim) =>
        claim.elements.flatMap((element) => [
          ...element.supportingEvidence.map((rel) => ({
            claimId: null,
            elementId: element.id,
            defenseId: null,
            evidenceId: rel.evidenceId,
            role: rel.role,
            note: rel.note,
          })),
          ...element.contraryEvidence.map((rel) => ({
            claimId: null,
            elementId: element.id,
            defenseId: null,
            evidenceId: rel.evidenceId,
            role: rel.role,
            note: rel.note,
          })),
          ...element.missingEvidence.map((missing) => ({
            claimId: null,
            elementId: element.id,
            defenseId: null,
            evidenceId: null,
            role: "MISSING_EXPECTED",
            note: missing.description,
          })),
        ]),
      ),
      ...review.defenses.flatMap((defense) =>
        defense.evidence.map((rel) => ({
          claimId: null,
          elementId: null,
          defenseId: defense.id,
          evidenceId: rel.evidenceId,
          role: rel.role,
          note: rel.note,
        })),
      ),
    ],
    factRelations: review.claims.flatMap((claim) =>
      claim.elements.flatMap((element) =>
        element.factRelations.map((rel) => ({
          claimId: null,
          elementId: element.id,
          defenseId: null,
          factId: rel.factId,
          role: rel.role,
        })),
      ),
    ),
    legalIssueRelations: review.claims.flatMap((claim) =>
      claim.legalIssueIds.map((legalIssueId) => ({
        claimId: claim.id,
        elementId: null,
        defenseId: null,
        legalIssueId,
      })),
    ),
    legalIssues: review.legalIssues.map((issue) => ({
      id: issue.issueId,
      description: issue.label,
    })),
    authorityRelations: [
      ...review.claims.flatMap((claim) =>
        claim.authorities.map((authority) => ({
          claimId: claim.id,
          elementId: null,
          defenseId: null,
          authorityId: authority.authorityId,
          relation: authority.relation,
          citation: authority.citation,
        })),
      ),
      ...review.defenses.flatMap((defense) =>
        defense.authorities.map((authority) => ({
          claimId: null,
          elementId: null,
          defenseId: defense.id,
          authorityId: authority.authorityId,
          relation: authority.relation,
          citation: authority.citation,
        })),
      ),
    ],
    authorities: [
      ...review.claims.flatMap((claim) => claim.authorities),
      ...review.defenses.flatMap((defense) => defense.authorities),
      ...review.claims.flatMap((claim) => claim.elements.flatMap((element) => element.authorities)),
      ...review.defenses.flatMap((defense) => defense.elements.flatMap((element) => element.authorities)),
    ]
      .filter((authority, index, all) => all.findIndex((row) => row.authorityId === authority.authorityId) === index)
      .map((authority) => ({
        id: authority.authorityId,
        title: authority.title ?? authority.authorityId,
        citation: authority.citation,
      })),
  });
}

describe("civil graph materialization plan", () => {
  it("materializes claim and defense nodes without liability metadata", () => {
    const plan = planFromFixture();
    expect(plan.nodes.some((node) => node.nodeType === "claim")).toBe(true);
    expect(plan.nodes.some((node) => node.nodeType === "defense")).toBe(true);
    expect(plan.nodes.some((node) => node.metadata.kind === "COUNTERCLAIM")).toBe(true);
    expect(
      plan.nodes.every(
        (node) =>
          !("liabilityConclusion" in node.metadata) &&
          node.metadata.supportStatus !== "LIABLE" &&
          node.metadata.supportStatus !== "WIN",
      ),
    ).toBe(true);
  });

  it("wires claim->party, element, evidence, fact, pleading and defense->claim edges", () => {
    const plan = planFromFixture();
    const types = new Set(plan.edges.map((edge) => edge.relationshipType));
    expect(types.has(CIVIL_GRAPH_EDGE.INVOLVES_PARTY)).toBe(true);
    expect(types.has(CIVIL_GRAPH_EDGE.HAS_ELEMENT)).toBe(true);
    expect(types.has(CIVIL_GRAPH_EDGE.SUPPORTED_BY) || types.has(CIVIL_GRAPH_EDGE.UNDERMINED_BY)).toBe(true);
    expect(types.has(CIVIL_GRAPH_EDGE.RELATED_FACT)).toBe(true);
    expect(types.has(CIVIL_GRAPH_EDGE.PLED_IN)).toBe(true);
    expect(types.has(CIVIL_GRAPH_EDGE.RESPONDS_TO)).toBe(true);
    expect(types.has(CIVIL_GRAPH_EDGE.ASSERTED_BY)).toBe(true);
  });

  it("reuses canonical party/fact/document keys instead of duplicating civil wrappers", () => {
    const plan = planFromFixture();
    const partyNodes = plan.nodes.filter((node) => node.canonicalEntityType === "matter_entity");
    const factNodes = plan.nodes.filter((node) => node.canonicalEntityType === "matter_fact");
    expect(partyNodes.length).toBeGreaterThan(0);
    expect(factNodes.length).toBeGreaterThan(0);
    expect(plan.nodes.every((node) => node.canonicalEntityType !== "civil_party")).toBe(true);
    // Document-backed evidence/pleadings use document canonical type
    expect(plan.nodes.some((node) => node.canonicalEntityType === "document")).toBe(true);
  });

  it("preserves superseded and withdrawn claim lineage in metadata", () => {
    const plan = planFromFixture();
    const superseded = plan.nodes.filter(
      (node) => node.nodeType === "claim" && node.metadata.currentness === "superseded",
    );
    const withdrawn = plan.nodes.filter(
      (node) => node.nodeType === "claim" && (node.metadata.currentness === "withdrawn" || node.metadata.proceduralStatus === "WITHDRAWN"),
    );
    expect(superseded.length).toBeGreaterThan(0);
    expect(withdrawn.length + superseded.length).toBeGreaterThan(0);
    expect(plan.nodes.some((node) => node.nodeType === "claim" && node.metadata.isCurrent === true)).toBe(true);
  });

  it("dedupes edges and does not invent liability conclusions in traversal summary", () => {
    const plan = planFromFixture();
    const edgeKeys = plan.edges.map((edge) => `${edge.fromKey}|${edge.relationshipType}|${edge.toKey}`);
    expect(new Set(edgeKeys).size).toBe(edgeKeys.length);

    const fakeNodes = plan.nodes.map((node, index) => ({
      id: `n${index}`,
      nodeType: node.nodeType,
      displayName: node.displayName,
      canonicalEntityType: node.canonicalEntityType,
      canonicalEntityId: node.canonicalEntityId,
      metadata: node.metadata,
    }));
    const idByKey = new Map(
      plan.nodes.map((node, index) => [`${node.canonicalEntityType}:${node.canonicalEntityId}`, `n${index}`]),
    );
    const fakeEdges = plan.edges
      .map((edge) => {
        const fromNodeId = idByKey.get(edge.fromKey);
        const toNodeId = idByKey.get(edge.toKey);
        if (!fromNodeId || !toNodeId) return null;
        return {
          fromNodeId,
          toNodeId,
          relationshipType: edge.relationshipType,
          label: edge.label,
        };
      })
      .filter((edge): edge is NonNullable<typeof edge> => Boolean(edge));

    const summary = summarizeCivilGraphTraversal({ nodes: fakeNodes, edges: fakeEdges });
    expect(summary.evidenceByClaim.length).toBeGreaterThan(0);
    expect(summary.sharedEvidence.length).toBeGreaterThan(0);
    expect(summary.counterclaimParties.length).toBeGreaterThan(0);
    expect(summary.supersededClaims.length).toBeGreaterThan(0);
    expect(JSON.stringify(summary)).not.toMatch(/\bliable\b|\bwill win\b|\bwill lose\b/i);
  });

  it("keeps multi-party claim orientations separated", () => {
    const plan = planFromFixture();
    const unfair = plan.nodes.find((node) => node.canonicalEntityId === "claim-unfair-trade");
    expect(unfair).toBeTruthy();
    const unfairPartyEdges = plan.edges.filter(
      (edge) =>
        edge.fromKey === `civil_claim:claim-unfair-trade` &&
        edge.relationshipType === CIVIL_GRAPH_EDGE.INVOLVES_PARTY,
    );
    expect(unfairPartyEdges.some((edge) => edge.toKey.includes("party-beta"))).toBe(true);
    expect(unfairPartyEdges.some((edge) => edge.toKey.includes("party-acme"))).toBe(true);
  });
});
