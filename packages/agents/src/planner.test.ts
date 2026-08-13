import { describe, expect, it } from "vitest";
import { KNOWN_AGENT_TYPES, PlanRejectedError, planAgentRun, validatePlanSteps } from "./planner";
import { UnknownAgentTypeError, type PlanStep } from "./types";

function step(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    stepId: "s1",
    agentType: "research_agent",
    objective: "Do the thing",
    dependencies: [],
    requiredTools: ["searchLegalAuthorities"],
    approvalRequirement: "low",
    ...overrides,
  };
}

describe("planAgentRun", () => {
  it("produces a template plan whose steps all use known agent types", () => {
    const plan = planAgentRun({ goal: "Prepare for the deposition", intent: "deposition_prep" });
    expect(plan.steps.length).toBeGreaterThan(1);
    for (const planStep of plan.steps) {
      expect(KNOWN_AGENT_TYPES).toContain(planStep.agentType);
    }
  });

  it("renders operational bullets, not model reasoning", () => {
    const plan = planAgentRun({ goal: "Draft a demand letter", intent: "drafting" });
    expect(plan.userFacingPlan).toMatch(/^1\. /);
    expect(plan.userFacingPlan).not.toMatch(/because|therefore|I think|let me/i);
  });

  it("flags steps that need approval in the user-facing plan", () => {
    const plan = planAgentRun({ goal: "Do everything", intent: "multi_step_task" });
    expect(plan.userFacingPlan).toMatch(/requires your approval/);
  });

  it("truncates plans to the maxSteps budget and records the gap", () => {
    const plan = planAgentRun({
      goal: "Research, draft and follow up",
      intent: "multi_step_task",
      budgets: { maxSteps: 2 },
    });
    expect(plan.steps).toHaveLength(2);
    expect(plan.limitations.join(" ")).toMatch(/truncated to the 2-step budget/);
  });

  it("drops dangling dependencies when it truncates", () => {
    const plan = planAgentRun({
      goal: "Research, draft and follow up",
      intent: "multi_step_task",
      budgets: { maxSteps: 1 },
    });
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]!.dependencies).toEqual([]);
  });

  it("keeps only corpus research when no matter is in context", () => {
    const plan = planAgentRun({
      goal: "What is the standard for summary judgment?",
      intent: "research",
      hasMatter: false,
    });
    expect(plan.steps.every((s) => s.agentType === "research_agent")).toBe(true);
  });

  it("rejects a matter-only intent when no matter is in context", () => {
    expect(() =>
      planAgentRun({ goal: "Review discovery", intent: "discovery_review", hasMatter: false }),
    ).toThrow(PlanRejectedError);
  });

  it("rejects an agent type it does not know", () => {
    expect(() =>
      planAgentRun({
        goal: "Research something",
        intent: "research",
        allowedAgentTypes: ["draft_agent"],
      }),
    ).toThrow(UnknownAgentTypeError);
  });
  it("schedules compareDocuments when the goal asks for a contract comparison", () => {
    const plan = planAgentRun({
      goal: "Compare the agreement and the amendment for material changes",
      intent: "contract_review",
    });
    const tools = plan.steps.flatMap((s) => s.requiredTools);
    expect(tools).toContain("compareDocuments");
    expect(plan.steps[0]?.agentType).toBe("contract_agent");
  });

  it("keeps analyzeContract for ordinary clause review", () => {
    const plan = planAgentRun({
      goal: "Review the indemnification clause in the MSA",
      intent: "contract_review",
    });
    const tools = plan.steps.flatMap((s) => s.requiredTools);
    expect(tools).toContain("analyzeContract");
    expect(tools).not.toContain("compareDocuments");
  });
});

describe("validatePlanSteps", () => {
  it("rejects an empty plan", () => {
    expect(() => validatePlanSteps([])).toThrow(PlanRejectedError);
  });

  it("rejects a plan over the step budget", () => {
    const steps = Array.from({ length: 5 }, (_, i) => step({ stepId: `s${i}` }));
    expect(() => validatePlanSteps(steps, { budgets: { maxSteps: 3 } })).toThrow(
      /exceeding the maxSteps budget/,
    );
  });

  it("rejects an unknown agent type", () => {
    expect(() => validatePlanSteps([step({ agentType: "sendEmail_agent" })])).toThrow(
      UnknownAgentTypeError,
    );
  });

  it("rejects duplicate step ids and unresolvable dependencies", () => {
    expect(() => validatePlanSteps([step(), step()])).toThrow(/Duplicate stepId/);
    expect(() => validatePlanSteps([step({ stepId: "a", dependencies: ["missing"] })])).toThrow(
      /depends on unknown step/,
    );
    expect(() => validatePlanSteps([step({ stepId: "a", dependencies: ["a"] })])).toThrow(
      /cannot depend on itself/,
    );
  });

  it("accepts a well-formed plan", () => {
    const steps = [step({ stepId: "a" }), step({ stepId: "b", dependencies: ["a"] })];
    expect(validatePlanSteps(steps)).toHaveLength(2);
  });
});
