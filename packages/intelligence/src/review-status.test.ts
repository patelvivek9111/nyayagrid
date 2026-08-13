import { describe, expect, it } from "vitest";
import { attorneyBadgeKind, isVerifiedReviewStatus } from "./review-status";

describe("attorney review status guardrail", () => {
  it("never treats proposed as verified", () => {
    expect(isVerifiedReviewStatus("proposed")).toBe(false);
    expect(attorneyBadgeKind("proposed")).toBe("suggested");
  });

  it("marks approved and edited_and_approved as verified", () => {
    expect(attorneyBadgeKind("approved")).toBe("verified");
    expect(attorneyBadgeKind("edited_and_approved")).toBe("verified");
  });

  it("keeps superseded and archived in historical", () => {
    expect(attorneyBadgeKind("superseded")).toBe("historical");
    expect(attorneyBadgeKind("archived")).toBe("historical");
    expect(attorneyBadgeKind("rejected")).toBe("historical");
  });
});
