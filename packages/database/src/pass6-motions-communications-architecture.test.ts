/**
 * Pass 6 architecture gate — documents the shared-schema gap.
 * No migration is created in Chat A. When Integration unlocks tables/enums,
 * update expectations here in the same PR as the migration.
 */
import { describe, expect, it } from "vitest";
import { GRAPH_NODE_TYPES, isGraphNodeType } from "./schema/index";
import {
  discoveryDeficiencies,
  discoveryMeetAndConferIssues,
} from "./schema/phase16";

describe("Pass 6 motions/communications architecture gate", () => {
  it("does not yet expose motion or communication graph node types", () => {
    expect(isGraphNodeType("motion")).toBe(false);
    expect(isGraphNodeType("communication")).toBe(false);
    expect(GRAPH_NODE_TYPES).not.toContain("motion");
    expect(GRAPH_NODE_TYPES).not.toContain("communication");
  });

  it("keeps discovery motion/communication refs as nullable columns without FK targets", () => {
    // Drizzle column presence documents the opaque placeholder contract from 0022.
    expect(discoveryDeficiencies.motionId).toBeTruthy();
    expect(discoveryDeficiencies.communicationId).toBeTruthy();
    expect(discoveryDeficiencies.motionDocumentId).toBeTruthy();
    expect(discoveryMeetAndConferIssues.communicationId).toBeTruthy();
  });

  it("preserves discovery ledger graph node types required for Pass 4 chain reuse", () => {
    for (const nodeType of [
      "discovery_request_item",
      "discovery_deficiency",
      "privilege_assertion",
      "claim",
      "defense",
      "document",
      "task",
      "deadline",
    ] as const) {
      expect(isGraphNodeType(nodeType)).toBe(true);
    }
  });
});
