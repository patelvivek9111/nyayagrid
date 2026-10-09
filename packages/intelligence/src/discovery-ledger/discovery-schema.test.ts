import { describe, expect, it } from "vitest";
import { GRAPH_NODE_TYPES, isGraphNodeType } from "@nyayagrid/database";
import {
  DISCOVERY_DEFICIENCY_KINDS,
  DISCOVERY_DEFICIENCY_STATUSES,
  DISCOVERY_ITEM_STATUSES,
  DISCOVERY_REQUEST_TYPES,
  PRIVILEGE_REVIEW_STATUSES,
  assertDiscoveryDeficiencyKind,
  assertDiscoveryItemStatus,
  assertDiscoveryRequestType,
  assertPrivilegeReviewStatus,
} from "./index";

describe("discovery ledger schema contract", () => {
  it("exposes prototype discovery request types", () => {
    expect(DISCOVERY_REQUEST_TYPES).toEqual([
      "INTERROGATORY",
      "REQUEST_FOR_PRODUCTION",
      "REQUEST_FOR_ADMISSION",
      "SUBPOENA",
      "DEPOSITION_DISCOVERY",
      "THIRD_PARTY_REQUEST",
      "OTHER",
    ]);
    expect(() => assertDiscoveryRequestType("REQUEST_FOR_PRODUCTION")).not.toThrow();
    expect(() => assertDiscoveryRequestType("SANCTIONS")).toThrow();
  });

  it("exposes non-adjudicative item and deficiency statuses", () => {
    expect(DISCOVERY_ITEM_STATUSES).toContain("SUPPLEMENT_REQUIRED");
    expect(DISCOVERY_ITEM_STATUSES).not.toContain("COMPELLED");
    expect(DISCOVERY_DEFICIENCY_STATUSES).toEqual([
      "OPEN",
      "MEET_AND_CONFER",
      "MOTION_PENDING",
      "RESOLVED",
      "WITHDRAWN",
      "UNKNOWN",
    ]);
    expect(DISCOVERY_DEFICIENCY_KINDS).toContain("BATES_GAP");
    expect(DISCOVERY_DEFICIENCY_KINDS).not.toContain("SANCTIONS");
    expect(() => assertDiscoveryItemStatus("OPEN")).not.toThrow();
    expect(() => assertDiscoveryDeficiencyKind("NO_RESPONSE")).not.toThrow();
    expect(() => assertDiscoveryDeficiencyKind("SANCTIONS")).toThrow();
  });

  it("exposes privilege REVIEW statuses only", () => {
    expect(PRIVILEGE_REVIEW_STATUSES).toEqual([
      "ASSERTED",
      "UNDER_REVIEW",
      "CHALLENGED",
      "WITHDRAWN",
      "RESOLVED",
      "UNKNOWN",
    ]);
    expect(() => assertPrivilegeReviewStatus("ASSERTED")).not.toThrow();
    expect(() => assertPrivilegeReviewStatus("PRIVILEGED")).toThrow();
    expect(() => assertPrivilegeReviewStatus("NOT_PRIVILEGED")).toThrow();
  });

  it("accepts minimal discovery graph node types and preserves claim/defense", () => {
    expect(isGraphNodeType("claim")).toBe(true);
    expect(isGraphNodeType("defense")).toBe(true);
    for (const nodeType of [
      "discovery_request_set",
      "discovery_request_item",
      "discovery_response",
      "discovery_production",
      "discovery_deficiency",
      "privilege_assertion",
    ]) {
      expect(isGraphNodeType(nodeType)).toBe(true);
      expect(GRAPH_NODE_TYPES).toContain(nodeType);
    }
    expect(isGraphNodeType("discovery_objection")).toBe(false);
    expect(isGraphNodeType("bates_range")).toBe(false);
  });
});
