import { describe, expect, it } from "vitest";
import { GRAPH_NODE_TYPES, isGraphNodeType, type GraphNodeType } from "@nyayagrid/database";
import type { CanonicalRef } from "./materialize";

describe("graph CanonicalRef nodeType contract", () => {
  it("accepts claim and defense on CanonicalRef without changing upsert API shape", () => {
    const claimRef: CanonicalRef = {
      canonicalEntityType: "civil_claim",
      canonicalEntityId: "00000000-0000-4000-8000-000000000001",
      nodeType: "claim",
      displayName: "Breach of contract",
    };
    const defenseRef: CanonicalRef = {
      canonicalEntityType: "civil_defense",
      canonicalEntityId: "00000000-0000-4000-8000-000000000002",
      nodeType: "defense",
      displayName: "Statute of limitations",
    };
    expect(isGraphNodeType(claimRef.nodeType)).toBe(true);
    expect(isGraphNodeType(defenseRef.nodeType)).toBe(true);
  });

  it("keeps the shared enum as the single source of allowed CanonicalRef values", () => {
    for (const nodeType of GRAPH_NODE_TYPES) {
      const ref: CanonicalRef = {
        canonicalEntityType: "test",
        canonicalEntityId: "id",
        nodeType,
        displayName: nodeType,
      };
      expect(ref.nodeType).toBe(nodeType);
    }
    const typed: GraphNodeType = "matter";
    expect(isGraphNodeType(typed)).toBe(true);
  });
});
