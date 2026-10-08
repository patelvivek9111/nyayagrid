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
    expect(JSON.parse(JSON.stringify({ claim, defense }))).toEqual({ claim: "claim", defense: "defense" });
  });
});
