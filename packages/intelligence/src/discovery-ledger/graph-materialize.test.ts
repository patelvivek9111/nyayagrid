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
});
