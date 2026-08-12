import { and, asc, desc, eq } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import {
  agentApprovals,
  agentArtifacts,
  agentRunSteps,
  agentRuns,
  agentToolCalls,
  type AgentApproval,
  type AgentArtifact,
  type AgentRun,
  type AgentRunStep,
  type AgentToolCall,
} from "@nyayagrid/database";
import { AuthorizationError, writeAuditEvent } from "@nyayagrid/permissions";
import type { AIProvider, AgentIntent, EmbeddingProvider } from "@nyayagrid/ai";
import type { AgentRegistry, NyayaAgent } from "./agent";
import { createActionProposal } from "./approvals";
import {
  RISK_RANK,
  ToolNotAllowedError,
  resolveBudgets,
  type AgentBudgets,
  type AgentExecutionContext,
  type AgentMode,
  type PlanStep,
  type ToolInvocationResult,
  type ToolInvoker,
} from "./types";
import type { ToolRegistry } from "./tools/registry";
import { assertToolNotProhibited } from "./tools/registry";

export type CreateAgentRunParams = {
  db: Database;
  organizationId: string;
  userId: string;
  matterId?: string | null;
  goal: string;
  mode?: AgentMode;
  intent: AgentIntent;
  steps: PlanStep[];
  userFacingPlan: string;
  limitations?: string[];
  budgets?: Partial<AgentBudgets> | null;
};

export type AgentRunDetail = {
  run: AgentRun;
  steps: AgentRunStep[];
  toolCalls: AgentToolCall[];
  artifacts: AgentArtifact[];
  approvals: AgentApproval[];
};

const TERMINAL_RUN_STATUSES = new Set<AgentRun["status"]>([
  "completed",
  "partially_completed",
  "failed",
  "cancelled",
]);

/** Persists a plan as a `planned` run. Nothing executes until startAgentRun is called. */
export async function createAgentRun(params: CreateAgentRunParams): Promise<AgentRunDetail> {
  const budgets = resolveBudgets(params.budgets ?? null);
  if (params.steps.length > budgets.maxSteps) {
    throw new Error(
      `Plan has ${params.steps.length} steps, exceeding the maxSteps budget of ${budgets.maxSteps}`,
    );
  }

  const [run] = await params.db
    .insert(agentRuns)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId ?? null,
      userId: params.userId,
      goal: params.goal,
      agentMode: params.mode ?? "task",
      intent: params.intent,
      status: "planned",
      planVersion: 1,
      plan: { steps: params.steps },
      userFacingPlan: params.userFacingPlan,
      limitations: params.limitations ?? [],
      budgets,
    })
    .returning();

  const stepRows =
    params.steps.length === 0
      ? []
      : await params.db
          .insert(agentRunSteps)
          .values(
            params.steps.map((step, index) => ({
              organizationId: params.organizationId,
              matterId: params.matterId ?? null,
              runId: run!.id,
              stepId: step.stepId,
              stepOrder: index,
              agentType: step.agentType,
              objective: step.objective,
              status: "pending" as const,
              dependencies: step.dependencies,
              requiredTools: step.requiredTools,
              approvalRequirement: step.approvalRequirement,
              inputMetadata: {
                intent: params.intent,
                hasMatter: Boolean(params.matterId),
              },
            })),
          )
          .returning();

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId ?? null,
    action: "agent.run.created",
    targetType: "agent_run",
    targetId: run!.id,
    metadata: {
      intent: params.intent,
      stepCount: stepRows.length,
      mode: params.mode ?? "task",
    },
  });

  return { run: run!, steps: stepRows, toolCalls: [], artifacts: [], approvals: [] };
}

export async function getAgentRun(params: {
  db: Database;
  organizationId: string;
  runId: string;
}): Promise<AgentRunDetail | null> {
  const [run] = await params.db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.id, params.runId), eq(agentRuns.organizationId, params.organizationId)))
    .limit(1);
  if (!run) return null;

  const [steps, toolCalls, artifacts, approvals] = await Promise.all([
    params.db
      .select()
      .from(agentRunSteps)
      .where(eq(agentRunSteps.runId, run.id))
      .orderBy(asc(agentRunSteps.stepOrder)),
    params.db
      .select()
      .from(agentToolCalls)
      .where(eq(agentToolCalls.runId, run.id))
      .orderBy(asc(agentToolCalls.createdAt)),
    params.db
      .select()
      .from(agentArtifacts)
      .where(eq(agentArtifacts.runId, run.id))
      .orderBy(asc(agentArtifacts.createdAt)),
    params.db
      .select()
      .from(agentApprovals)
      .where(eq(agentApprovals.runId, run.id))
      .orderBy(desc(agentApprovals.createdAt)),
  ]);

  return { run, steps, toolCalls, artifacts, approvals };
}

export async function cancelAgentRun(params: {
  db: Database;
  organizationId: string;
  runId: string;
  userId: string;
  reason?: string | null;
}): Promise<AgentRun> {
  const now = new Date();
  const [run] = await params.db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.id, params.runId), eq(agentRuns.organizationId, params.organizationId)))
    .limit(1);
  if (!run) throw new Error("Agent run not found");
  if (TERMINAL_RUN_STATUSES.has(run.status)) return run;

  const [updated] = await params.db
    .update(agentRuns)
    .set({
      status: "cancelled",
      cancelledAt: now,
      updatedAt: now,
      errorSummary: params.reason ?? null,
    })
    .where(eq(agentRuns.id, run.id))
    .returning();

  await params.db
    .update(agentRunSteps)
    .set({ status: "cancelled", updatedAt: now })
    .where(and(eq(agentRunSteps.runId, run.id), eq(agentRunSteps.status, "pending")));

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: run.matterId,
    action: "agent.run.cancelled",
    targetType: "agent_run",
    targetId: run.id,
    metadata: { reason: params.reason ?? null },
  });

  return updated!;
}

type BudgetCounters = {
  toolCalls: number;
  stepsExecuted: number;
};

/**
 * Builds the tool surface for one step.
 *
 * The allow-list is the intersection of what the plan asked for and what the agent declares, so
 * neither a model's output nor retrieved document text can reach a tool the plan never authorized.
 * Every call is recorded before it runs, which means a denial is auditable even though it throws.
 */
function createStepToolInvoker(params: {
  db: Database;
  registry: ToolRegistry;
  organizationId: string;
  matterId: string | null;
  userId: string;
  runId: string;
  stepRecordId: string;
  allowed: string[];
  budgets: AgentBudgets;
  counters: BudgetCounters;
  ai?: AIProvider;
  embeddings?: EmbeddingProvider;
}): ToolInvoker {
  const allowedSet = new Set(params.allowed);

  return {
    allowedTools: () => [...allowedSet],
    async invoke<TData>(toolName: string, input: unknown): Promise<ToolInvocationResult<TData>> {
      assertToolNotProhibited(toolName);
      if (!allowedSet.has(toolName)) {
        throw new ToolNotAllowedError(toolName);
      }
      if (params.counters.toolCalls >= params.budgets.maxToolCalls) {
        throw new Error(
          `Tool call budget of ${params.budgets.maxToolCalls} exhausted for this run`,
        );
      }
      params.counters.toolCalls += 1;

      const [pending] = await params.db
        .insert(agentToolCalls)
        .values({
          organizationId: params.organizationId,
          matterId: params.matterId,
          runId: params.runId,
          stepId: params.stepRecordId,
          toolName,
          status: "running",
        })
        .returning();

      try {
        const record = await params.registry.invoke<TData>(
          {
            db: params.db,
            userId: params.userId,
            organizationId: params.organizationId,
            matterId: params.matterId,
            runId: params.runId,
            stepRecordId: params.stepRecordId,
            ...(params.ai ? { ai: params.ai } : {}),
            ...(params.embeddings ? { embeddings: params.embeddings } : {}),
          },
          toolName,
          input,
        );

        await params.db
          .update(agentToolCalls)
          .set({
            status: record.ok ? "completed" : "failed",
            authorizationScope: record.authorizationScope as unknown as Record<string, unknown>,
            resourceIds: record.resourceIds.slice(0, 200),
            durationMs: record.durationMs,
            resultSummary: record.summary.slice(0, 2000),
            errorClassification: record.errorClassification ?? null,
            completedAt: new Date(),
          })
          .where(eq(agentToolCalls.id, pending!.id));

        return {
          ok: record.ok,
          summary: record.summary,
          data: record.data,
          resourceIds: record.resourceIds,
          ...(record.provenanceClass ? { provenanceClass: record.provenanceClass } : {}),
          ...(record.errorClassification
            ? { errorClassification: record.errorClassification }
            : {}),
        };
      } catch (error) {
        const denied = error instanceof AuthorizationError;
        await params.db
          .update(agentToolCalls)
          .set({
            status: denied ? "denied" : "failed",
            errorClassification: denied ? "authorization" : "domain_error",
            resultSummary: error instanceof Error ? error.message.slice(0, 2000) : null,
            completedAt: new Date(),
          })
          .where(eq(agentToolCalls.id, pending!.id));
        throw error;
      }
    },
  };
}

function intersectTools(step: AgentRunStep, agent: NyayaAgent): string[] {
  const required = step.requiredTools ?? [];
  if (required.length === 0) return [...agent.allowedTools];
  return required.filter((tool) => agent.allowedTools.includes(tool));
}

export type ExecuteAgentRunParams = {
  db: Database;
  organizationId: string;
  userId: string;
  runId: string;
  agents: AgentRegistry;
  tools: ToolRegistry;
  ai?: AIProvider;
  embeddings?: EmbeddingProvider;
};

export type ExecuteAgentRunResult = AgentRunDetail & {
  limitations: string[];
};

/** Marks a planned run as running. Safe to call on a run that is already running. */
export async function startAgentRun(params: {
  db: Database;
  organizationId: string;
  runId: string;
  userId: string;
}): Promise<AgentRun> {
  const [run] = await params.db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.id, params.runId), eq(agentRuns.organizationId, params.organizationId)))
    .limit(1);
  if (!run) throw new Error("Agent run not found");
  if (run.status === "cancelled") throw new Error("Agent run was cancelled");
  if (TERMINAL_RUN_STATUSES.has(run.status)) return run;

  const now = new Date();
  const [updated] = await params.db
    .update(agentRuns)
    .set({ status: "running", startedAt: run.startedAt ?? now, updatedAt: now })
    .where(eq(agentRuns.id, run.id))
    .returning();

  if (!run.startedAt) {
    await writeAuditEvent(params.db, {
      organizationId: params.organizationId,
      actorUserId: params.userId,
      matterId: run.matterId,
      action: "agent.run.started",
      targetType: "agent_run",
      targetId: run.id,
      metadata: { intent: run.intent, stepCount: (run.plan?.steps ?? []).length },
    });
  }

  return updated!;
}

/**
 * Executes a run's steps in plan order.
 *
 * Re-entrant by design: completed steps are skipped, so a run interrupted by a pending approval
 * or a transient failure can be resumed without repeating work or double-writing records. Steps
 * whose dependencies did not complete are skipped rather than run on incomplete input, and the
 * run ends `partially_completed` so the gap is visible instead of implied.
 */
export async function executeAgentRun(
  params: ExecuteAgentRunParams,
): Promise<ExecuteAgentRunResult> {
  const detail = await getAgentRun({
    db: params.db,
    organizationId: params.organizationId,
    runId: params.runId,
  });
  if (!detail) throw new Error("Agent run not found");
  if (detail.run.status === "cancelled") {
    return { ...detail, limitations: detail.run.limitations ?? [] };
  }
  if (TERMINAL_RUN_STATUSES.has(detail.run.status)) {
    return { ...detail, limitations: detail.run.limitations ?? [] };
  }

  await startAgentRun({
    db: params.db,
    organizationId: params.organizationId,
    runId: params.runId,
    userId: params.userId,
  });

  const budgets = resolveBudgets(detail.run.budgets ?? null);
  const counters: BudgetCounters = {
    toolCalls: detail.toolCalls.length,
    stepsExecuted: detail.steps.filter((step) => step.status === "completed").length,
  };
  const limitations = [...(detail.run.limitations ?? [])];
  const addLimitation = (note: string) => {
    if (!limitations.includes(note)) limitations.push(note);
  };

  const statusByStepId = new Map(detail.steps.map((step) => [step.stepId, step.status]));
  const deadline = Date.now() + budgets.timeoutMs;

  for (const step of detail.steps) {
    if (step.status === "completed" || step.status === "skipped" || step.status === "cancelled") {
      continue;
    }

    if (step.status === "awaiting_approval") {
      const stillPending = detail.approvals.some(
        (approval) => approval.stepId === step.id && approval.status === "pending",
      );
      if (stillPending) {
        addLimitation(
          `Step "${step.stepId}" is waiting on your approval before its proposed action can be applied.`,
        );
        continue;
      }
    }

    const unmetDependencies = (step.dependencies ?? []).filter(
      (dependency) => statusByStepId.get(dependency) !== "completed",
    );
    if (unmetDependencies.length > 0) {
      await markStep(params.db, step.id, {
        status: "skipped",
        errorCode: "dependency_unsatisfied",
        errorMessage: `Requires ${unmetDependencies.join(", ")} to complete first.`,
      });
      statusByStepId.set(step.stepId, "skipped");
      addLimitation(
        `Step "${step.stepId}" was skipped because ${unmetDependencies.join(", ")} did not complete.`,
      );
      continue;
    }

    if (counters.stepsExecuted >= budgets.maxSteps) {
      await markStep(params.db, step.id, {
        status: "skipped",
        errorCode: "budget_exhausted",
        errorMessage: `Step budget of ${budgets.maxSteps} was reached.`,
      });
      statusByStepId.set(step.stepId, "skipped");
      addLimitation(`Stopped after ${budgets.maxSteps} steps; remaining steps were not run.`);
      continue;
    }

    if (counters.toolCalls >= budgets.maxToolCalls) {
      await markStep(params.db, step.id, {
        status: "skipped",
        errorCode: "budget_exhausted",
        errorMessage: `Tool call budget of ${budgets.maxToolCalls} was reached.`,
      });
      statusByStepId.set(step.stepId, "skipped");
      addLimitation(
        `Stopped after ${budgets.maxToolCalls} tool calls; remaining steps were not run.`,
      );
      continue;
    }

    if (Date.now() > deadline) {
      await markStep(params.db, step.id, {
        status: "skipped",
        errorCode: "timeout",
        errorMessage: `Run exceeded the ${budgets.timeoutMs}ms time budget.`,
      });
      statusByStepId.set(step.stepId, "skipped");
      addLimitation(`Run exceeded its ${budgets.timeoutMs}ms time budget before finishing.`);
      continue;
    }

    const agent = params.agents.get(step.agentType);
    if (!agent) {
      await markStep(params.db, step.id, {
        status: "failed",
        errorCode: "unknown_agent_type",
        errorMessage: `No agent registered for type ${step.agentType}.`,
      });
      statusByStepId.set(step.stepId, "failed");
      addLimitation(`Step "${step.stepId}" could not run: unknown agent type ${step.agentType}.`);
      continue;
    }

    await markStep(params.db, step.id, { status: "running", startedAt: new Date() });

    const invoker = createStepToolInvoker({
      db: params.db,
      registry: params.tools,
      organizationId: params.organizationId,
      matterId: detail.run.matterId,
      userId: params.userId,
      runId: detail.run.id,
      stepRecordId: step.id,
      allowed: intersectTools(step, agent),
      budgets,
      counters,
      ...(params.ai ? { ai: params.ai } : {}),
      ...(params.embeddings ? { embeddings: params.embeddings } : {}),
    });

    const ctx: AgentExecutionContext = {
      db: params.db,
      userId: params.userId,
      organizationId: params.organizationId,
      matterId: detail.run.matterId,
      runId: detail.run.id,
      stepId: step.stepId,
      stepRecordId: step.id,
      goal: detail.run.goal,
      objective: step.objective,
      intent: (detail.run.intent ?? "multi_step_task") as AgentIntent,
      budgets,
      tools: invoker,
      ...(params.ai ? { ai: params.ai } : {}),
      ...(params.embeddings ? { embeddings: params.embeddings } : {}),
    };

    try {
      const result = await agent.execute(ctx, {
        goal: detail.run.goal,
        objective: step.objective,
      });

      const [artifact] = await params.db
        .insert(agentArtifacts)
        .values({
          organizationId: params.organizationId,
          matterId: detail.run.matterId,
          runId: detail.run.id,
          stepId: step.id,
          artifactType: `${agent.id}_output`,
          title: step.objective.slice(0, 300),
          content: result.content ?? null,
          contentRef: result.canonicalRef ?? {},
          provenance: result.provenance,
          sources: result.sources,
          actionProposals: (result.actionProposals ?? []).map((proposal) => ({
            actionType: proposal.actionType,
            proposedData: proposal.proposedData,
            riskLevel: proposal.riskLevel,
            ...(proposal.rationale ? { rationale: proposal.rationale } : {}),
            ...(proposal.provenance ? { provenance: proposal.provenance } : {}),
          })),
          generatedBy: agent.id,
          provider: result.provider ?? null,
          model: result.model ?? null,
          promptVersion: result.promptVersion ?? null,
          createdByUserId: params.userId,
        })
        .returning();

      let pendingApprovalCount = 0;
      for (const proposal of result.actionProposals ?? []) {
        await createActionProposal({
          db: params.db,
          organizationId: params.organizationId,
          matterId: detail.run.matterId,
          runId: detail.run.id,
          stepRecordId: step.id,
          artifactId: artifact!.id,
          actionType: proposal.actionType,
          proposedData: proposal.proposedData,
          rationale: proposal.rationale ?? null,
          provenance: proposal.provenance ?? [],
          riskLevel: proposal.riskLevel,
          actorUserId: params.userId,
        });
        pendingApprovalCount += 1;
      }

      for (const note of result.limitations ?? []) addLimitation(note);

      // A high-risk step's proposals are inert until reviewed, so the step is not "completed"
      // while its write is still unapplied.
      const awaitingApproval =
        pendingApprovalCount > 0 && RISK_RANK[step.approvalRequirement] >= RISK_RANK.high;

      await markStep(params.db, step.id, {
        status: awaitingApproval ? "awaiting_approval" : "completed",
        outputArtifactId: artifact!.id,
        outputSummary: result.summary.slice(0, 4000),
        completedAt: awaitingApproval ? null : new Date(),
      });
      statusByStepId.set(step.stepId, awaitingApproval ? "awaiting_approval" : "completed");
      counters.stepsExecuted += 1;

      if (awaitingApproval) {
        addLimitation(
          `Step "${step.stepId}" prepared ${pendingApprovalCount} proposed action(s) that require your approval before anything is written.`,
        );
      }

      await writeAuditEvent(params.db, {
        organizationId: params.organizationId,
        actorUserId: params.userId,
        matterId: detail.run.matterId,
        action: "agent.step.completed",
        targetType: "agent_run_step",
        targetId: step.id,
        metadata: {
          runId: detail.run.id,
          stepId: step.stepId,
          agentType: agent.id,
          status: awaitingApproval ? "awaiting_approval" : "completed",
          artifactId: artifact!.id,
          pendingApprovals: pendingApprovalCount,
        },
      });
    } catch (error) {
      const denied = error instanceof AuthorizationError;
      const notAllowed = error instanceof ToolNotAllowedError;
      const message = error instanceof Error ? error.message : "Step failed";
      await markStep(params.db, step.id, {
        status: "failed",
        errorCode: denied ? "authorization" : notAllowed ? "tool_not_allowed" : "step_error",
        errorMessage: message.slice(0, 2000),
      });
      statusByStepId.set(step.stepId, "failed");
      addLimitation(`Step "${step.stepId}" failed: ${message}`);

      await writeAuditEvent(params.db, {
        organizationId: params.organizationId,
        actorUserId: params.userId,
        matterId: detail.run.matterId,
        action: "agent.step.failed",
        targetType: "agent_run_step",
        targetId: step.id,
        metadata: {
          runId: detail.run.id,
          stepId: step.stepId,
          agentType: agent.id,
          errorCode: denied ? "authorization" : notAllowed ? "tool_not_allowed" : "step_error",
        },
      });
    }
  }

  const finalStatuses = [...statusByStepId.values()];
  const completed = finalStatuses.filter((status) => status === "completed").length;
  const awaiting = finalStatuses.filter((status) => status === "awaiting_approval").length;
  const unfinished = finalStatuses.filter(
    (status) => status === "failed" || status === "skipped",
  ).length;

  const status: AgentRun["status"] =
    awaiting > 0
      ? "awaiting_approval"
      : completed === 0 && unfinished > 0
        ? "failed"
        : unfinished > 0
          ? "partially_completed"
          : "completed";

  const now = new Date();
  await params.db
    .update(agentRuns)
    .set({
      status,
      limitations,
      updatedAt: now,
      completedAt:
        status === "completed" || status === "partially_completed" || status === "failed"
          ? now
          : null,
      errorSummary:
        status === "failed"
          ? "No step completed successfully; see step errors and limitations."
          : null,
    })
    .where(eq(agentRuns.id, detail.run.id));

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: detail.run.matterId,
    action: status === "awaiting_approval" ? "agent.run.awaiting_approval" : "agent.run.completed",
    targetType: "agent_run",
    targetId: detail.run.id,
    metadata: {
      status,
      completedSteps: completed,
      awaitingApprovalSteps: awaiting,
      unfinishedSteps: unfinished,
      toolCalls: counters.toolCalls,
    },
  });

  const refreshed = await getAgentRun({
    db: params.db,
    organizationId: params.organizationId,
    runId: detail.run.id,
  });
  return { ...(refreshed ?? detail), limitations };
}

async function markStep(
  db: Database,
  stepRecordId: string,
  patch: {
    status: AgentRunStep["status"];
    startedAt?: Date;
    completedAt?: Date | null;
    outputArtifactId?: string;
    outputSummary?: string;
    errorCode?: string;
    errorMessage?: string;
  },
): Promise<void> {
  const values: Record<string, unknown> = { status: patch.status, updatedAt: new Date() };
  if (patch.startedAt !== undefined) values.startedAt = patch.startedAt;
  if (patch.completedAt !== undefined) values.completedAt = patch.completedAt;
  if (patch.outputArtifactId !== undefined) values.outputArtifactId = patch.outputArtifactId;
  if (patch.outputSummary !== undefined) values.outputSummary = patch.outputSummary;
  if (patch.errorCode !== undefined) values.errorCode = patch.errorCode;
  if (patch.errorMessage !== undefined) values.errorMessage = patch.errorMessage;

  await db.update(agentRunSteps).set(values).where(eq(agentRunSteps.id, stepRecordId));
}
