import type { Database } from "@nyayagrid/database";
import type {
  AgentActionType,
  AgentContentRef,
  AgentProvenanceClass,
  AgentProvenanceEntry,
  AgentRiskLevel,
  AgentSourceRef,
} from "@nyayagrid/database";
import type { AIProvider, EmbeddingProvider } from "@nyayagrid/ai";
import type { AgentIntent } from "@nyayagrid/ai";

export type {
  AgentActionType,
  AgentContentRef,
  AgentProvenanceClass,
  AgentProvenanceEntry,
  AgentRiskLevel,
  AgentSourceRef,
  AgentIntent,
};

export const PROVENANCE_CLASSES = [
  "MATTER_EVIDENCE",
  "VERIFIED_MATTER_INTELLIGENCE",
  "GRAPH_RELATIONSHIP",
  "MATTER_MEMORY",
  "LEGAL_AUTHORITY",
  "USER_INSTRUCTION",
] as const satisfies readonly AgentProvenanceClass[];

export const RISK_LEVELS = ["low", "medium", "high"] as const satisfies readonly AgentRiskLevel[];

export const RISK_RANK: Record<AgentRiskLevel, number> = { low: 1, medium: 2, high: 3 };

export type AgentMode = "ask" | "task";

/**
 * Execution ceilings for a single run. The engine enforces these hard: exceeding a budget stops
 * the run and records a limitation rather than silently continuing to spend on a user's matter.
 */
export type AgentBudgets = {
  maxSteps: number;
  maxToolCalls: number;
  maxRetries: number;
  maxRetrievedContext: number;
  timeoutMs: number;
};

export const DEFAULT_BUDGETS: AgentBudgets = {
  maxSteps: 12,
  maxToolCalls: 40,
  maxRetries: 1,
  maxRetrievedContext: 20,
  timeoutMs: 120000,
};

export function resolveBudgets(overrides?: Partial<AgentBudgets> | null): AgentBudgets {
  return { ...DEFAULT_BUDGETS, ...(overrides ?? {}) };
}

/**
 * Capability names an agent declares it needs. These map onto NyayaGrid capabilities checked
 * against the caller's membership before any domain call runs.
 */
export type AgentCapabilityRequirement = string;

export type PlanStep = {
  stepId: string;
  agentType: string;
  objective: string;
  dependencies: string[];
  requiredTools: string[];
  approvalRequirement: AgentRiskLevel;
};

export type AgentPlanResult = {
  steps: PlanStep[];
  userFacingPlan: string;
  limitations: string[];
};

export type AgentActionProposalInput = {
  actionType: AgentActionType;
  proposedData: Record<string, unknown>;
  rationale?: string;
  riskLevel: AgentRiskLevel;
  provenance?: AgentProvenanceEntry[];
};

/** What a specialized agent hands back to the engine. */
export type AgentExecutionResult = {
  summary: string;
  content?: string | null;
  provenance: AgentProvenanceEntry[];
  sources: AgentSourceRef[];
  actionProposals?: AgentActionProposalInput[];
  canonicalRef?: AgentContentRef | null;
  limitations?: string[];
  provider?: string | null;
  model?: string | null;
  promptVersion?: string | null;
};

export type ToolInvocationResult<TData = unknown> = {
  ok: boolean;
  summary: string;
  data: TData;
  resourceIds: string[];
  provenanceClass?: AgentProvenanceClass;
  errorClassification?: string;
};

export type ToolInvoker = {
  invoke<TData = unknown>(toolName: string, input: unknown): Promise<ToolInvocationResult<TData>>;
  /** Tools this invoker will accept, already intersected with the step's allow-list. */
  allowedTools(): string[];
};

/** Shared runtime handles every tool and agent receives. */
export type AgentRuntime = {
  db: Database;
  userId: string;
  organizationId: string;
  matterId?: string | null;
  ai?: AIProvider;
  embeddings?: EmbeddingProvider;
};

export type AgentExecutionContext = AgentRuntime & {
  runId: string;
  stepId: string;
  stepRecordId: string;
  goal: string;
  objective: string;
  intent: AgentIntent;
  budgets: AgentBudgets;
  tools: ToolInvoker;
};

export class AgentBudgetExceededError extends Error {
  readonly code = "AGENT_BUDGET_EXCEEDED";
  constructor(readonly budget: keyof AgentBudgets) {
    super(`Agent budget exceeded: ${budget}`);
    this.name = "AgentBudgetExceededError";
  }
}

export class ToolNotAllowedError extends Error {
  readonly code = "TOOL_NOT_ALLOWED";
  constructor(toolName: string) {
    super(`Tool ${toolName} is not allowed in this context`);
    this.name = "ToolNotAllowedError";
  }
}

export class ProhibitedToolError extends Error {
  readonly code = "TOOL_PROHIBITED";
  constructor(toolName: string) {
    super(
      `Tool ${toolName} is permanently prohibited in NyayaGrid and can never be registered or invoked`,
    );
    this.name = "ProhibitedToolError";
  }
}

export class UnknownAgentTypeError extends Error {
  readonly code = "UNKNOWN_AGENT_TYPE";
  constructor(agentType: string) {
    super(`Unknown agent type: ${agentType}`);
    this.name = "UnknownAgentTypeError";
  }
}
