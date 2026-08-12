import { describe, expect, it } from "vitest";
import {
  agentPlanSchema,
  agentPlanStepSchema,
  buildAgentPlanSystemPrompt,
  buildAgentPlanUserPrompt,
  buildIntentClassificationSystemPrompt,
  buildIntentClassificationUserPrompt,
  intentClassificationSchema,
  mockAgentPlan,
  mockIntentClassification,
} from "./agents";
import { MockAIProvider } from "./index";

describe("agent schemas", () => {
  it("accepts a valid intent classification", () => {
    const parsed = intentClassificationSchema.parse({
      intent: "simple_qa",
      confidence: "high",
      rationale: "Single factual question about a matter document.",
      requiresAgentRun: false,
      blockedActions: ["send_email", "court_filing"],
      suggestedAgents: ["matter_qa"],
    });
    expect(parsed.intent).toBe("simple_qa");
    expect(parsed.requiresAgentRun).toBe(false);
  });

  it("rejects an invalid intent value", () => {
    expect(() =>
      intentClassificationSchema.parse({
        intent: "unknown_intent",
        confidence: "high",
        rationale: "Test",
        requiresAgentRun: false,
        blockedActions: [],
        suggestedAgents: [],
      }),
    ).toThrow();
  });

  it("rejects agent plan steps with missing objectives", () => {
    expect(() =>
      agentPlanStepSchema.parse({
        stepId: "step-1",
        agentType: "matter_qa",
        objective: "",
        dependencies: [],
        requiredTools: ["retrieval"],
        approvalRequirement: "low",
      }),
    ).toThrow();
  });

  it("rejects agent plans with no steps", () => {
    expect(() =>
      agentPlanSchema.parse({
        userFacingPlan: "1. Do something",
        steps: [],
        limitations: [],
      }),
    ).toThrow();
  });

  it("accepts a valid multi-step agent plan", () => {
    const parsed = agentPlanSchema.parse({
      userFacingPlan: "1. Research\n2. Draft",
      steps: [
        {
          stepId: "research-1",
          agentType: "legal_research",
          objective: "Research the issue.",
          dependencies: [],
          requiredTools: ["query_decomposition"],
          approvalRequirement: "medium",
        },
        {
          stepId: "draft-1",
          agentType: "draft_generation",
          objective: "Draft a memo.",
          dependencies: ["research-1"],
          requiredTools: ["draft_generation"],
          approvalRequirement: "high",
        },
      ],
      limitations: ["Attorney review required."],
      budgetsHint: "Multiple synthesis calls expected.",
    });
    expect(parsed.steps).toHaveLength(2);
    expect(parsed.steps[1]?.dependencies).toEqual(["research-1"]);
  });
});

describe("agent prompt builders", () => {
  it("includes safety rules in system prompts", () => {
    expect(buildIntentClassificationSystemPrompt()).toMatch(/Never authorize send_email/i);
    expect(buildIntentClassificationSystemPrompt()).toMatch(/untrusted data/i);
    expect(buildAgentPlanSystemPrompt()).toMatch(/Never plan steps that send email/i);
    expect(buildAgentPlanSystemPrompt()).toMatch(/simple_qa/i);
  });

  it("builds user prompts with matter and message context", () => {
    const intentPrompt = buildIntentClassificationUserPrompt({
      matterTitle: "Acme v. Beta",
      userMessage: "What date was the contract signed?",
      conversationSummary: "Prior discussion about contract terms.",
      availableCapabilities: ["matter_qa", "legal_research"],
    });
    expect(intentPrompt).toContain("Matter: Acme v. Beta");
    expect(intentPrompt).toContain("User message: What date was the contract signed?");
    expect(intentPrompt).toContain("matter_qa");

    const planPrompt = buildAgentPlanUserPrompt({
      matterTitle: "Acme v. Beta",
      userMessage: "Research termination standards and draft a memo.",
      classifiedIntent: "multi_step_task",
      intentRationale: "Spans research and drafting.",
      availableCapabilities: ["legal_research", "draft_generation"],
    });
    expect(planPrompt).toContain("Classified intent: multi_step_task");
    expect(planPrompt).toContain("draft_generation");
  });
});

describe("agent mock helpers", () => {
  it("classifies simple factual questions as simple_qa", () => {
    const parsed = intentClassificationSchema.parse(
      mockIntentClassification("User message: What date was the agreement signed?"),
    );
    expect(parsed.intent).toBe("simple_qa");
    expect(parsed.requiresAgentRun).toBe(false);
    expect(parsed.blockedActions).toContain("send_email");
  });

  it("classifies research requests with agent run", () => {
    const parsed = intentClassificationSchema.parse(
      mockIntentClassification(
        "User message: Research precedent on material breach in this jurisdiction.",
      ),
    );
    expect(parsed.intent).toBe("research");
    expect(parsed.requiresAgentRun).toBe(true);
    expect(parsed.suggestedAgents).toContain("legal_research");
  });

  it("classifies multi-capability requests as multi_step_task", () => {
    const parsed = intentClassificationSchema.parse(
      mockIntentClassification(
        "User message: Research termination standards and then draft a client memo.",
      ),
    );
    expect(parsed.intent).toBe("multi_step_task");
    expect(parsed.requiresAgentRun).toBe(true);
  });

  it("builds a plan aligned with classified intent", () => {
    const planPrompt = buildAgentPlanUserPrompt({
      matterTitle: "Acme v. Beta",
      userMessage: "Analyze the contract termination clause.",
      classifiedIntent: "contract_review",
    });
    const parsed = agentPlanSchema.parse(mockAgentPlan(planPrompt));
    expect(parsed.steps[0]?.agentType).toBe("contract_analysis");
    expect(parsed.userFacingPlan).toMatch(/^1\./);
    expect(parsed.limitations.length).toBeGreaterThan(0);
  });
});

describe("MockAIProvider agent routing", () => {
  it("routes intent classification prompts", async () => {
    const provider = new MockAIProvider();
    const result = await provider.generate({
      messages: [
        { role: "system", content: buildIntentClassificationSystemPrompt() },
        {
          role: "user",
          content: buildIntentClassificationUserPrompt({
            matterTitle: "Acme v. Beta",
            userMessage: "What is the termination notice period?",
          }),
        },
      ],
    });
    const parsed = intentClassificationSchema.parse(JSON.parse(result.text));
    expect(parsed.intent).toBe("simple_qa");
  });

  it("routes agent plan prompts", async () => {
    const provider = new MockAIProvider();
    const result = await provider.generate({
      messages: [
        { role: "system", content: buildAgentPlanSystemPrompt() },
        {
          role: "user",
          content: buildAgentPlanUserPrompt({
            matterTitle: "Acme v. Beta",
            userMessage: "Research damages standards and draft a section.",
            classifiedIntent: "multi_step_task",
          }),
        },
      ],
    });
    const parsed = agentPlanSchema.parse(JSON.parse(result.text));
    expect(parsed.steps.length).toBeGreaterThan(1);
    expect(parsed.steps.some((s) => s.agentType === "orchestrator")).toBe(true);
  });
});
