import { describe, expect, it } from "vitest";
import { GRAPH_NODE_TYPES, isGraphNodeType, type GraphNodeType } from "./schema/index";

const LEGACY_NODE_TYPES = [
  "person",
  "organization",
  "client",
  "document",
  "event",
  "fact",
  "deadline",
  "task",
  "matter",
  "other",
] as const;

describe("graph_node_type shared contract", () => {
  it("accepts claim and defense", () => {
    expect(isGraphNodeType("claim")).toBe(true);
    expect(isGraphNodeType("defense")).toBe(true);
    expect(GRAPH_NODE_TYPES).toContain("claim");
    expect(GRAPH_NODE_TYPES).toContain("defense");
  });

  it("accepts minimal discovery ledger node types", () => {
    for (const nodeType of [
      "discovery_request_set",
      "discovery_request_item",
      "discovery_response",
      "discovery_production",
      "discovery_deficiency",
      "privilege_assertion",
    ] as const) {
      expect(isGraphNodeType(nodeType)).toBe(true);
      expect(GRAPH_NODE_TYPES).toContain(nodeType);
    }
  });

  it("preserves every legacy node type", () => {
    for (const nodeType of LEGACY_NODE_TYPES) {
      expect(isGraphNodeType(nodeType)).toBe(true);
      expect(GRAPH_NODE_TYPES).toContain(nodeType);
    }
  });

  it("rejects invalid node types", () => {
    expect(isGraphNodeType("liability")).toBe(false);
    expect(isGraphNodeType("Claim")).toBe(false);
    expect(isGraphNodeType("")).toBe(false);
    expect(isGraphNodeType("counterclaim")).toBe(false);
    expect(isGraphNodeType("discovery_objection")).toBe(false);
    expect(isGraphNodeType("bates_range")).toBe(false);
  });

  it("exposes a stable serialization round-trip for the accepted set", () => {
    const serialized = JSON.stringify(GRAPH_NODE_TYPES);
    const parsed = JSON.parse(serialized) as string[];
    expect(parsed).toEqual([...GRAPH_NODE_TYPES]);
    for (const value of parsed) {
      expect(isGraphNodeType(value)).toBe(true);
    }
    const claim: GraphNodeType = "claim";
    const defense: GraphNodeType = "defense";
    const discoveryRequestSet: GraphNodeType = "discovery_request_set";
    expect(JSON.parse(JSON.stringify({ claim, defense, discoveryRequestSet }))).toEqual({
      claim: "claim",
      defense: "defense",
      discoveryRequestSet: "discovery_request_set",
    });
  });
});
