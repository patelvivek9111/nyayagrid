/**
 * Pass 6 architecture gate — after 0023 unlock, motion/communication graph types exist
 * and discovery columns are FK targets for first-class matter entities.
 */
import { describe, expect, it } from "vitest";
import { GRAPH_NODE_TYPES, isGraphNodeType } from "./schema/index";
import {
  discoveryDeficiencies,
  discoveryMeetAndConferIssues,
} from "./schema/phase16";
import { matterCommunications, matterMotions } from "./schema/phase17";

describe("Pass 6 motions/communications architecture gate", () => {
  it("exposes motion and communication graph node types after 0023", () => {
    expect(isGraphNodeType("motion")).toBe(true);
    expect(isGraphNodeType("communication")).toBe(true);
    expect(GRAPH_NODE_TYPES).toContain("motion");
    expect(GRAPH_NODE_TYPES).toContain("communication");
  });

  it("binds discovery motion/communication columns to first-class matter tables", () => {
    expect(matterMotions).toBeTruthy();
    expect(matterCommunications).toBeTruthy();
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
