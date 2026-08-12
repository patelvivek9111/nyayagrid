import type { Database } from "@nyayagrid/database";
import type { AIProvider, EmbeddingProvider } from "@nyayagrid/ai";
import { requireCapability, requireMatterAccess } from "@nyayagrid/permissions";
import type { AgentRegistry } from "./agent";
import { createDefaultAgentRegistry } from "./agents/index";
import { classifyIntent, type IntentDecision } from "./intent";
import { planAgentRun } from "./planner";
import { createAgentRun, executeAgentRun, getAgentRun, type AgentRunDetail } from "./engine";
import { createDefaultToolRegistry, type ToolRegistry } from "./tools/index";
import { resolveBudgets, type AgentBudgets, type AgentMode } from "./types";

/**
 * Maximum orchestration depth.
 *
 * Only the orchestrator creates steps, and it creates them once from a validated plan. Agents
 * cannot enqueue further agents, so a run's work is bounded by its plan rather than by whatever a
 * model decides to spawn next.
 */
export const MAX_ORCHESTRATION_DEPTH = 1;

export type RunTaskParams = {
  db: Database;
  userId: string;
  organizationId: string;
  matterId?: string | null;
  goal: string;
  mode?: AgentMode;
  /** Execute immediately after planning. When false the run stays `planned` for user confirmation. */
  execute?: boolean;
  budgets?: Partial<AgentBudgets> | null;
  ai?: AIProvider;
  embeddings?: EmbeddingProvider;
  /** Skip the model fallback in intent classification. Defaults to false. */
  rulesOnlyIntent?: boolean;
};

export type QaOutcome = {
  mode: "qa";
  intent: IntentDecision;
  /** Guidance for the caller, which answers directly via askNyayaAboutMatter. */
  reason: string;
};

export type TaskOutcome = {
  mode: "task";
  intent: IntentDecision;
  run: AgentRunDetail;
  userFacingPlan: string;
  executed: boolean;
};

export type RunTaskOutcome = QaOutcome | TaskOutcome;

export type NyayaOrchestratorOptions = {
  agents?: AgentRegistry;
  tools?: ToolRegistry;
};

/**
 * Entry point for Nyaya agent orchestration.
 *
 * Its job is routing and bookkeeping: classify what the user wants, refuse what NyayaGrid will not
 * do, build a plan, persist it, and hand execution to the engine. It owns no legal logic — every
 * substantive capability is reached through a tool that wraps its existing package.
 */
export class NyayaOrchestrator {
  private readonly agents: AgentRegistry;
  private readonly tools: ToolRegistry;

  constructor(options: NyayaOrchestratorOptions = {}) {
    this.agents = options.agents ?? createDefaultAgentRegistry();
    this.tools = options.tools ?? createDefaultToolRegistry();
  }

  async classifyIntent(params: {
    goal: string;
    matterTitle?: string | null;
    ai?: AIProvider;
    rulesOnly?: boolean;
  }): Promise<IntentDecision> {
    return classifyIntent({
      goal: params.goal,
      matterTitle: params.matterTitle ?? null,
      ...(params.ai ? { ai: params.ai } : {}),
      useAiFallback: params.rulesOnly !== true,
    });
  }

  /**
   * Routes a goal to either direct Q&A or an orchestrated run.
   *
   * Authorization is checked here before any planning happens, and again inside every tool call,
   * because a run can outlive the membership state that authorized it.
   */
  async runTask(params: RunTaskParams): Promise<RunTaskOutcome> {
    const goal = params.goal.trim();
    if (!goal) throw new Error("A goal is required");

    if (params.matterId) {
      await requireMatterAccess(params.db, {
        userId: params.userId,
        matterId: params.matterId,
        minAccess: "read",
        capability: "matters.view",
      });
    } else {
      await requireCapability(params.db, {
        userId: params.userId,
        organizationId: params.organizationId,
        capability: "research.run",
      });
    }

    const intent = await this.classifyIntent({
      goal,
      ...(params.ai ? { ai: params.ai } : {}),
      rulesOnly: params.rulesOnlyIntent === true,
    });

    const wantsTask = params.mode === "task" || intent.requiresAgentRun;
    if (!wantsTask) {
      return {
        mode: "qa",
        intent,
        reason:
          "Single-question request: answer directly with matter Q&A instead of creating an agent run.",
      };
    }

    const plan = planAgentRun({
      goal,
      intent: intent.intent,
      budgets: params.budgets ?? null,
      limitations: intent.safetyNotes,
      hasMatter: Boolean(params.matterId),
      allowedAgentTypes: this.agents.agentTypes(),
    });

    const created = await createAgentRun({
      db: params.db,
      organizationId: params.organizationId,
      userId: params.userId,
      matterId: params.matterId ?? null,
      goal,
      mode: params.mode ?? "task",
      intent: intent.intent,
      steps: plan.steps,
      userFacingPlan: plan.userFacingPlan,
      limitations: plan.limitations,
      budgets: resolveBudgets(params.budgets ?? null),
    });

    if (params.execute === false) {
      return {
        mode: "task",
        intent,
        run: created,
        userFacingPlan: plan.userFacingPlan,
        executed: false,
      };
    }

    const executed = await executeAgentRun({
      db: params.db,
      organizationId: params.organizationId,
      userId: params.userId,
      runId: created.run.id,
      agents: this.agents,
      tools: this.tools,
      ...(params.ai ? { ai: params.ai } : {}),
      ...(params.embeddings ? { embeddings: params.embeddings } : {}),
    });

    return {
      mode: "task",
      intent,
      run: executed,
      userFacingPlan: plan.userFacingPlan,
      executed: true,
    };
  }

  /** Resumes a previously planned or paused run, for example after an approval was granted. */
  async resumeRun(params: {
    db: Database;
    organizationId: string;
    userId: string;
    runId: string;
    ai?: AIProvider;
    embeddings?: EmbeddingProvider;
  }): Promise<AgentRunDetail> {
    return executeAgentRun({
      db: params.db,
      organizationId: params.organizationId,
      userId: params.userId,
      runId: params.runId,
      agents: this.agents,
      tools: this.tools,
      ...(params.ai ? { ai: params.ai } : {}),
      ...(params.embeddings ? { embeddings: params.embeddings } : {}),
    });
  }

  async getRun(params: {
    db: Database;
    organizationId: string;
    runId: string;
  }): Promise<AgentRunDetail | null> {
    return getAgentRun(params);
  }

  agentTypes(): string[] {
    return this.agents.agentTypes();
  }

  toolNames(): string[] {
    return this.tools.names();
  }
}

export function createOrchestrator(options: NyayaOrchestratorOptions = {}): NyayaOrchestrator {
  return new NyayaOrchestrator(options);
}
