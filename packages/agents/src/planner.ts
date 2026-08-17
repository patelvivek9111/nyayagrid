import type { AgentIntent } from "@nyayagrid/ai";
import { AGENT_PLAN_PROMPT_VERSION, wantsContractCompare } from "@nyayagrid/ai";
import {
  UnknownAgentTypeError,
  resolveBudgets,
  type AgentBudgets,
  type AgentPlanResult,
  type PlanStep,
} from "./types";
import { stripInstructionLikeDirectives } from "./prompt-injection";

export { AGENT_PLAN_PROMPT_VERSION };

/** Agent types the orchestrator can schedule. A plan naming anything else is rejected. */
export const KNOWN_AGENT_TYPES = [
  "research_agent",
  "draft_agent",
  "contract_agent",
  "evidence_agent",
  "discovery_agent",
  "deposition_agent",
  "timeline_agent",
  "graph_agent",
  "memory_agent",
] as const;

export type KnownAgentType = (typeof KNOWN_AGENT_TYPES)[number];

const KNOWN_AGENT_SET = new Set<string>(KNOWN_AGENT_TYPES);

export function isKnownAgentType(agentType: string): agentType is KnownAgentType {
  return KNOWN_AGENT_SET.has(agentType);
}

type Template = (goal: string) => PlanStep[];

const TEMPLATES: Record<AgentIntent, Template> = {
  simple_qa: () => [
    {
      stepId: "qa-1",
      agentType: "evidence_agent",
      objective: "Retrieve matter sources responsive to the question and summarize what they say.",
      dependencies: [],
      requiredTools: ["searchMatterDocuments", "getVerifiedTimeline"],
      approvalRequirement: "low",
    },
  ],
  research: () => [
    {
      stepId: "research-1",
      agentType: "research_agent",
      objective: "Retrieve authorities from the legal corpus relevant to the question.",
      dependencies: [],
      requiredTools: ["searchLegalAuthorities"],
      approvalRequirement: "low",
    },
    {
      stepId: "research-2",
      agentType: "research_agent",
      objective: "Produce a grounded research synthesis and persist it as a research artifact.",
      dependencies: ["research-1"],
      requiredTools: ["saveResearchArtifact"],
      approvalRequirement: "medium",
    },
  ],
  drafting: () => [
    {
      stepId: "draft-1",
      agentType: "evidence_agent",
      objective: "Gather the matter sources and verified context the draft must rely on.",
      dependencies: [],
      requiredTools: ["retrieveMatterChunks", "getVerifiedTimeline", "retrieveMatterMemory"],
      approvalRequirement: "low",
    },
    {
      stepId: "draft-2",
      agentType: "draft_agent",
      objective: "Generate the requested draft grounded in the gathered sources.",
      dependencies: ["draft-1"],
      requiredTools: ["createDraft"],
      approvalRequirement: "medium",
    },
  ],
  contract_review: (goal) => {
    if (wantsContractCompare(goal)) {
      return [
        {
          stepId: "contract-compare-1",
          agentType: "contract_agent",
          objective:
            "Compare the relevant contract versions and surface material differences needing attorney review.",
          dependencies: [],
          requiredTools: ["compareDocuments", "retrieveMatterChunks"],
          approvalRequirement: "low",
        },
        {
          stepId: "contract-compare-2",
          agentType: "memory_agent",
          objective: "Propose matter memory entries capturing material changes from the comparison.",
          dependencies: ["contract-compare-1"],
          requiredTools: ["proposeMemory"],
          approvalRequirement: "medium",
        },
      ];
    }
    return [
      {
        stepId: "contract-1",
        agentType: "contract_agent",
        objective: "Analyze the contract clauses and flag items needing attorney attention.",
        dependencies: [],
        requiredTools: ["analyzeContract", "retrieveMatterChunks"],
        approvalRequirement: "low",
      },
      {
        stepId: "contract-2",
        agentType: "memory_agent",
        objective: "Propose matter memory entries capturing the review's key constraints.",
        dependencies: ["contract-1"],
        requiredTools: ["proposeMemory"],
        approvalRequirement: "medium",
      },
    ];
  },
  deposition_prep: () => [
    {
      stepId: "depo-1",
      agentType: "timeline_agent",
      objective: "Load the verified chronology the examination will be built around.",
      dependencies: [],
      requiredTools: ["getVerifiedTimeline"],
      approvalRequirement: "low",
    },
    {
      stepId: "depo-2",
      agentType: "deposition_agent",
      objective: "Analyze the transcript for preparation findings tied to transcript sources.",
      dependencies: ["depo-1"],
      requiredTools: ["analyzeDeposition", "retrieveMatterChunks"],
      approvalRequirement: "low",
    },
    {
      stepId: "depo-3",
      agentType: "evidence_agent",
      objective: "Surface contradictions between the transcript and other matter evidence.",
      dependencies: ["depo-2"],
      requiredTools: ["detectContradictions"],
      approvalRequirement: "low",
    },
  ],
  evidence_analysis: () => [
    {
      stepId: "evidence-1",
      agentType: "evidence_agent",
      objective: "Load the evidence matrix and identify contradiction candidates for review.",
      dependencies: [],
      requiredTools: ["getEvidenceMatrix", "detectContradictions"],
      approvalRequirement: "low",
    },
  ],
  discovery_review: () => [
    {
      stepId: "discovery-1",
      agentType: "discovery_agent",
      objective: "List the discovery queue and identify documents lacking a classification.",
      dependencies: [],
      requiredTools: ["getDiscoveryReview"],
      approvalRequirement: "low",
    },
    {
      stepId: "discovery-2",
      agentType: "discovery_agent",
      objective:
        "Propose relevance and responsiveness classifications for review; privilege stays with the attorney.",
      dependencies: ["discovery-1"],
      requiredTools: ["proposeDiscoveryClassification"],
      approvalRequirement: "medium",
    },
  ],
  timeline_analysis: () => [
    {
      stepId: "timeline-1",
      agentType: "timeline_agent",
      objective: "Load the verified chronology, facts and deadlines for the matter.",
      dependencies: [],
      requiredTools: ["getVerifiedTimeline"],
      approvalRequirement: "low",
    },
    {
      stepId: "timeline-2",
      agentType: "graph_agent",
      objective: "Load approved relationships that explain how the chronology's actors connect.",
      dependencies: ["timeline-1"],
      requiredTools: ["getMatterGraphNeighborhood"],
      approvalRequirement: "low",
    },
  ],
  multi_step_task: () => [
    {
      stepId: "task-1",
      agentType: "evidence_agent",
      objective: "Gather the matter sources and verified context the request depends on.",
      dependencies: [],
      requiredTools: ["retrieveMatterChunks", "getVerifiedTimeline", "getEvidenceMatrix"],
      approvalRequirement: "low",
    },
    {
      stepId: "task-2",
      agentType: "research_agent",
      objective: "Research the legal standards the request turns on and record the synthesis.",
      dependencies: ["task-1"],
      requiredTools: ["searchLegalAuthorities", "saveResearchArtifact"],
      approvalRequirement: "medium",
    },
    {
      stepId: "task-3",
      agentType: "draft_agent",
      objective: "Prepare the requested work product grounded in the gathered material.",
      dependencies: ["task-2"],
      requiredTools: ["createDraft"],
      approvalRequirement: "medium",
    },
    {
      stepId: "task-4",
      agentType: "memory_agent",
      objective: "Propose follow-up work and memory entries for attorney approval.",
      dependencies: ["task-3"],
      requiredTools: ["createTaskProposal", "proposeMemory"],
      approvalRequirement: "high",
    },
  ],
};

export type PlanAgentRunParams = {
  goal: string;
  intent: AgentIntent;
  budgets?: Partial<AgentBudgets> | null;
  /** Extra limitations to record on the run, e.g. refused actions from intent classification. */
  limitations?: string[];
  /** Restricts the plan to matter-scoped work when no matter is in context. */
  hasMatter?: boolean;
  allowedAgentTypes?: readonly string[];
};

export class PlanRejectedError extends Error {
  readonly code = "PLAN_REJECTED";
  constructor(message: string) {
    super(message);
    this.name = "PlanRejectedError";
  }
}

function assertPlanIsWellFormed(steps: PlanStep[], allowed: Set<string>) {
  const seen = new Set<string>();
  for (const step of steps) {
    if (!allowed.has(step.agentType)) {
      throw new UnknownAgentTypeError(step.agentType);
    }
    if (seen.has(step.stepId)) {
      throw new PlanRejectedError(`Duplicate stepId in plan: ${step.stepId}`);
    }
    seen.add(step.stepId);
  }
  for (const step of steps) {
    for (const dependency of step.dependencies) {
      if (!seen.has(dependency)) {
        throw new PlanRejectedError(`Step ${step.stepId} depends on unknown step ${dependency}`);
      }
      if (dependency === step.stepId) {
        throw new PlanRejectedError(`Step ${step.stepId} cannot depend on itself`);
      }
    }
  }
}

/**
 * Renders the plan for display.
 *
 * These are operational bullets — what will be done and what needs approval. They are not the
 * model's reasoning: a user-facing plan that leaked chain-of-thought would expose intermediate
 * conclusions an attorney has not reviewed.
 */
function renderUserFacingPlan(steps: PlanStep[]): string {
  return steps
    .map((step, index) => {
      const approval =
        step.approvalRequirement === "high"
          ? " — requires your approval before anything is written"
          : step.approvalRequirement === "medium"
            ? " — produces a reviewable proposal"
            : "";
      return `${index + 1}. ${stripInstructionLikeDirectives(step.objective)}${approval}`;
    })
    .join("\n");
}

/** Builds a plan from a template for the classified intent. */
export function planAgentRun(params: PlanAgentRunParams): AgentPlanResult {
  const budgets = resolveBudgets(params.budgets ?? null);
  const allowed = new Set<string>(params.allowedAgentTypes ?? KNOWN_AGENT_TYPES);

  const template = TEMPLATES[params.intent];
  if (!template) {
    throw new PlanRejectedError(`No plan template for intent ${params.intent}`);
  }

  let steps = template(params.goal);
  const limitations = [...(params.limitations ?? [])];

  if (params.hasMatter === false) {
    const matterFree = steps.filter((step) => step.agentType === "research_agent");
    if (matterFree.length === 0) {
      throw new PlanRejectedError(
        `Intent ${params.intent} requires a matter, but no matter is in context`,
      );
    }
    if (matterFree.length < steps.length) {
      limitations.push(
        "No matter was selected, so matter-scoped steps were dropped and only corpus research was planned.",
      );
    }
    steps = matterFree.map((step) => ({ ...step, dependencies: [] }));
  }

  if (steps.length > budgets.maxSteps) {
    limitations.push(
      `Plan truncated to the ${budgets.maxSteps}-step budget; ${steps.length - budgets.maxSteps} planned step(s) were dropped.`,
    );
    const kept = steps.slice(0, budgets.maxSteps);
    const keptIds = new Set(kept.map((step) => step.stepId));
    steps = kept.map((step) => ({
      ...step,
      dependencies: step.dependencies.filter((dependency) => keptIds.has(dependency)),
    }));
  }

  assertPlanIsWellFormed(steps, allowed);

  return {
    steps,
    userFacingPlan: renderUserFacingPlan(steps),
    limitations,
  };
}

/** Validates a plan produced elsewhere (e.g. by a model) before it is persisted or executed. */
export function validatePlanSteps(
  steps: PlanStep[],
  options: { budgets?: Partial<AgentBudgets> | null; allowedAgentTypes?: readonly string[] } = {},
): PlanStep[] {
  const budgets = resolveBudgets(options.budgets ?? null);
  if (steps.length === 0) {
    throw new PlanRejectedError("Plan must contain at least one step");
  }
  if (steps.length > budgets.maxSteps) {
    throw new PlanRejectedError(
      `Plan has ${steps.length} steps, exceeding the maxSteps budget of ${budgets.maxSteps}`,
    );
  }
  assertPlanIsWellFormed(steps, new Set(options.allowedAgentTypes ?? KNOWN_AGENT_TYPES));
  return steps;
}
