import { describe, expect, it } from "vitest";
import { GRAPH_NODE_TYPES, isGraphNodeType } from "./schema/index";
import {
  MATTER_COMMUNICATION_DIRECTIONS,
  MATTER_COMMUNICATION_LINK_TYPES,
  MATTER_COMMUNICATION_STATUSES,
  MATTER_COMMUNICATION_TYPES,
  MATTER_MOTION_DISPOSITIONS,
  MATTER_MOTION_DOCUMENT_ROLES,
  MATTER_MOTION_LINK_TYPES,
  MATTER_MOTION_STATUSES,
  MATTER_MOTION_TYPES,
  matterCommunicationLinks,
  matterCommunications,
  matterMotionDocuments,
  matterMotionLinks,
  matterMotions,
} from "./schema/phase17";
import {
  discoveryDeficiencies,
  discoveryMeetAndConferIssues,
} from "./schema/phase16";

describe("Pass 6 matter motions/communications schema contract", () => {
  it("exports first-class motion and communication tables", () => {
    expect(matterMotions).toBeTruthy();
    expect(matterMotionDocuments).toBeTruthy();
    expect(matterMotionLinks).toBeTruthy();
    expect(matterCommunications).toBeTruthy();
    expect(matterCommunicationLinks).toBeTruthy();
    expect(matterMotions.motionType).toBeTruthy();
    expect(matterMotions.oppositionDueAt).toBeTruthy();
    expect(matterMotions.disposition).toBeTruthy();
    expect(matterCommunications.followUpDueAt).toBeTruthy();
    expect(matterCommunications.inboundEmailId).toBeTruthy();
  });

  it("exposes extensible motion/communication value sets without forced lifecycle", () => {
    expect(MATTER_MOTION_TYPES).toContain("MOTION_TO_COMPEL");
    expect(MATTER_MOTION_TYPES).toContain("SUMMARY_JUDGMENT");
    expect(MATTER_MOTION_STATUSES[0]).toBe("DRAFT");
    expect(MATTER_MOTION_STATUSES).toContain("HEARING_SCHEDULED");
    expect(MATTER_MOTION_DISPOSITIONS).toContain("DENIED_IN_PART");
    expect(MATTER_MOTION_DOCUMENT_ROLES).toContain("ORDER");
    expect(MATTER_MOTION_LINK_TYPES).toContain("DISCOVERY_DEFICIENCY");
    expect(MATTER_MOTION_LINK_TYPES).toContain("DEADLINE_CANDIDATE");
    expect(MATTER_COMMUNICATION_TYPES).toContain("MEET_AND_CONFER");
    expect(MATTER_COMMUNICATION_DIRECTIONS).toEqual(
      expect.arrayContaining(["OUTBOUND", "INBOUND", "INTERNAL", "UNKNOWN"]),
    );
    expect(MATTER_COMMUNICATION_STATUSES).toContain("AWAITING_RESPONSE");
    expect(MATTER_COMMUNICATION_LINK_TYPES).toContain("MOTION");
  });

  it("registers motion and communication graph node types while preserving claim/defense/discovery", () => {
    expect(isGraphNodeType("motion")).toBe(true);
    expect(isGraphNodeType("communication")).toBe(true);
    expect(GRAPH_NODE_TYPES).toContain("claim");
    expect(GRAPH_NODE_TYPES).toContain("defense");
    expect(GRAPH_NODE_TYPES).toContain("discovery_deficiency");
    expect(isGraphNodeType("judicial_prediction")).toBe(false);
  });

  it("keeps discovery motion/communication columns for FK hardening", () => {
    expect(discoveryDeficiencies.motionId).toBeTruthy();
    expect(discoveryDeficiencies.communicationId).toBeTruthy();
    expect(discoveryDeficiencies.motionDocumentId).toBeTruthy();
    expect(discoveryMeetAndConferIssues.communicationId).toBeTruthy();
  });
});
