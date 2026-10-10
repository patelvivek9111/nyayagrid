import { describe, expect, it } from "vitest";
import { runComplexDiscoveryLedgerFixture } from "./fixtures";
import { buildDiscoveryGraphMaterializationPlan, DISCOVERY_GRAPH_EDGE } from "./graph-materialize";

describe("discovery graph materialization plan", () => {
  it("plans request, response, production, deficiency, and privilege nodes without legal conclusions", () => {
    const { review } = runComplexDiscoveryLedgerFixture();
    const plan = buildDiscoveryGraphMaterializationPlan(review);

    expect(plan.nodes.some((node) => node.nodeType === "discovery_request_set")).toBe(true);
    expect(plan.nodes.some((node) => node.nodeType === "discovery_request_item")).toBe(true);
    expect(plan.nodes.some((node) => node.nodeType === "discovery_response")).toBe(true);
    expect(plan.nodes.some((node) => node.nodeType === "discovery_production")).toBe(true);
    expect(plan.nodes.some((node) => node.nodeType === "discovery_deficiency")).toBe(true);
    expect(plan.nodes.some((node) => node.nodeType === "privilege_assertion")).toBe(true);
    expect(plan.nodes.some((node) => node.nodeType === "document")).toBe(true);

    expect(plan.edges.some((edge) => edge.relationshipType === DISCOVERY_GRAPH_EDGE.HAS_RESPONSE)).toBe(true);
    expect(plan.edges.some((edge) => edge.relationshipType === DISCOVERY_GRAPH_EDGE.LINKED_PRODUCTION)).toBe(true);
    expect(plan.edges.some((edge) => edge.relationshipType === DISCOVERY_GRAPH_EDGE.RELATED_MOTION_DOC)).toBe(true);

    const serialized = JSON.stringify(plan);
    expect(serialized).not.toMatch(/\bimpose sanctions\b|\bthe document is privileged\b/i);
  });

  it("uses first-class motion/communication nodes for Pass 6 UUID FK identities", () => {
    const { review } = runComplexDiscoveryLedgerFixture();
    const communicationId = "00000000-0000-4000-8000-0000000000c1";
    const motionId = "00000000-0000-4000-8000-0000000000a2";
    const motionDocId = "00000000-0000-4000-8000-0000000000d1";
    const patched = {
      ...review,
      deficiencies: review.deficiencies.map((row, index) =>
        index === 0
          ? { ...row, communicationId, motionId }
          : row,
      ),
      motionLinks: [
        {
          id: "motion-link-pass6",
          motionId,
          motionLabel: "Motion to Compel — RFP-12",
          motionType: "MOTION_TO_COMPEL" as const,
          deficiencyIds: [review.deficiencies[0]!.id],
          documentId: motionDocId,
        },
      ],
    };
    const plan = buildDiscoveryGraphMaterializationPlan(patched);
    expect(
      plan.nodes.some(
        (n) => n.nodeType === "communication" && n.canonicalEntityId === communicationId,
      ),
    ).toBe(true);
    expect(
      plan.nodes.some(
        (n) => n.nodeType === "document" && n.canonicalEntityId === communicationId,
      ),
    ).toBe(false);
    expect(
      plan.nodes.some((n) => n.nodeType === "motion" && n.canonicalEntityId === motionId),
    ).toBe(true);
    expect(
      plan.nodes.some(
        (n) =>
          n.nodeType === "document" &&
          n.canonicalEntityId === motionId &&
          n.metadata.role !== "motion_document",
      ),
    ).toBe(false);
    const nodeKeys = plan.nodes.map((n) => `${n.canonicalEntityType}:${n.canonicalEntityId}`);
    expect(new Set(nodeKeys).size).toBe(nodeKeys.length);
  });
});
