import { describe, expect, it } from "vitest";
import { classifyGradeFailure } from "../graders/failure-classes";

describe("failure class taxonomy", () => {
  it("maps infrastructure and grounding details", () => {
    expect(
      classifyGradeFailure({ detail: "INFRASTRUCTURE: boom", expectationType: "exact_fact" }),
    ).toBe("INFRASTRUCTURE_FAILURE");
    expect(
      classifyGradeFailure({
        detail: "Overclaimed evidence: treated badge/log activity as personal physical entry.",
        expectationType: "must_abstain",
      }),
    ).toBe("GROUNDING_FAILURE");
    expect(
      classifyGradeFailure({
        detail: "Accepted a false retroactivity premise and supplied a reason.",
        expectationType: "challenge_premise",
      }),
    ).toBe("REASONING_FAILURE");
  });

  it("maps subsystem execution targets", () => {
    expect(
      classifyGradeFailure({
        detail: "no events",
        expectationType: "exact_fact",
        executionTarget: "timeline",
      }),
    ).toBe("TIMELINE_FAILURE");
    expect(
      classifyGradeFailure({
        detail: "tool error",
        expectationType: "exact_fact",
        executionTarget: "agent",
      }),
    ).toBe("AGENT_EXECUTION_FAILURE");
    expect(
      classifyGradeFailure({
        detail: "proposed entered Ask Nyaya",
        expectationType: "analysis_downstream",
        executionTarget: "professional_analysis",
        taxonomy: "downstream trust boundary",
      }),
    ).toBe("ANALYSIS_DOWNSTREAM_TRUST");
  });
});
