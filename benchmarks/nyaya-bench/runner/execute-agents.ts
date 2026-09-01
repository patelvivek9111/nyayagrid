import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AIProvider } from "@nyayagrid/ai";
import { createEmbeddingProviderFromEnv } from "@nyayagrid/ai";
import {
  NyayaOrchestrator,
  PROHIBITED_TOOL_NAMES,
  cancelAgentRun,
  type AgentRunDetail,
} from "@nyayagrid/agents";
import { and, eq, tasks } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import { createMatterMemory } from "@nyayagrid/intelligence";
import {
  importAuthority,
  syntheticAuthorityFixtures,
  type ImportAuthorityInput,
} from "@nyayagrid/research";
import { reviewApproval } from "@nyayagrid/agents";
import type { AgentBenchAction, BenchScenario, BenchTask } from "./catalog";
import type { IngestedMatter } from "./ingest";
import { datasetRoot } from "./paths";

let corpusReady = false;

async function ensureResearchCorpus(params: {
  db: Database;
  organizationId: string;
  userId: string;
}) {
  if (corpusReady) return;
  const embeddings = createEmbeddingProviderFromEnv();
  for (const input of syntheticAuthorityFixtures) {
    await importAuthority({
      db: params.db,
      embeddings,
      input,
      actor: { organizationId: params.organizationId, userId: params.userId },
    });
  }
  const overlayPath = join(datasetRoot("v2"), "research", "corpus.json");
  if (existsSync(overlayPath)) {
    const overlay = JSON.parse(readFileSync(overlayPath, "utf8")) as {
      authorities: ImportAuthorityInput[];
    };
    for (const input of overlay.authorities) {
      await importAuthority({
        db: params.db,
        embeddings,
        input,
        actor: { organizationId: params.organizationId, userId: params.userId },
      });
    }
  }
  corpusReady = true;
}

function failingAi(): AIProvider {
  return {
    name: "bench-failing-ai",
    async generate() {
      throw new Error("OpenAI failure (injected for AG016)");
    },
  };
}

function serializeRun(detail: AgentRunDetail) {
  return {
    runId: detail.run.id,
    status: detail.run.status,
    intent: detail.run.intent,
    matterId: detail.run.matterId,
    organizationId: detail.run.organizationId,
    limitations: detail.run.limitations ?? [],
    budgets: detail.run.budgets,
    steps: detail.steps.map((step) => ({
      stepId: step.stepId,
      agentType: step.agentType,
      status: step.status,
      requiredTools: step.requiredTools,
      approvalRequirement: step.approvalRequirement,
      outputSummary: step.outputSummary,
      errorCode: step.errorCode,
      errorMessage: step.errorMessage,
    })),
    toolCalls: detail.toolCalls.map((call) => ({
      toolName: call.toolName,
      status: call.status,
      matterId: call.matterId,
      organizationId: call.organizationId,
      authorizationScope: call.authorizationScope,
      resultSummary: call.resultSummary,
      errorClassification: call.errorClassification,
    })),
    approvals: detail.approvals.map((row) => ({
      id: row.id,
      actionType: row.actionType,
      status: row.status,
      riskLevel: row.riskLevel,
    })),
    artifacts: detail.artifacts.map((artifact) => ({
      id: artifact.id,
      artifactType: artifact.artifactType,
      generatedBy: artifact.generatedBy,
      provenance: artifact.provenance,
      sources: artifact.sources,
      contentRef: artifact.contentRef,
      contentPreview: artifact.content ? artifact.content.slice(0, 2000) : null,
    })),
  };
}

function answerFromRun(detail: AgentRunDetail): string {
  const summaries = detail.steps
    .map((step) => step.outputSummary)
    .filter((value): value is string => Boolean(value));
  const limitations = detail.run.limitations ?? [];
  const artifactText = detail.artifacts
    .map((artifact) => artifact.content)
    .filter((value): value is string => Boolean(value));
  return [...summaries, ...limitations, ...artifactText].join("\n");
}

export async function executeAgentTarget(params: {
  db: Database;
  scenario: BenchScenario;
  task: BenchTask;
  matter: IngestedMatter;
  ai: AIProvider;
}): Promise<{ answer: string; extras: Record<string, unknown> }> {
  const action: AgentBenchAction = params.task.agentAction ?? { kind: "execute" };
  const orchestrator = new NyayaOrchestrator();
  const org = {
    db: params.db,
    organizationId: params.matter.organizationId,
    userId: params.matter.userId,
    matterId: params.matter.matterId,
  };

  if (action.importResearchCorpus) {
    await ensureResearchCorpus({
      db: params.db,
      organizationId: params.matter.organizationId,
      userId: params.matter.userId,
    });
  }

  if (action.seedProposedMemory) {
    await createMatterMemory({
      ...org,
      memoryType: "factual_caveat",
      title: action.seedProposedMemory.title,
      content: action.seedProposedMemory.content,
      origin: "ai",
      status: "proposed",
      sourceType: "agent_proposal",
    });
  }

  const tasksBefore = await params.db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.organizationId, params.matter.organizationId),
        eq(tasks.matterId, params.matter.matterId),
      ),
    );

  if (action.kind === "outsider") {
    try {
      await orchestrator.runTask({
        ...org,
        userId: "00000000-0000-4000-8000-000000000099",
        goal: params.task.prompt,
        mode: "task",
        execute: true,
        rulesOnlyIntent: true,
        ai: params.ai,
      });
      return {
        answer: "Outsider agent run succeeded.",
        extras: {
          executionTarget: "agent",
          structuredKind: "agent",
          outsiderDenied: false,
          snapshot: { status: "unexpected_success" },
        },
      };
    } catch (error) {
      return {
        answer: error instanceof Error ? error.message : "Outsider denied.",
        extras: {
          executionTarget: "agent",
          structuredKind: "agent",
          outsiderDenied: true,
          snapshot: {
            status: "denied",
            error: error instanceof Error ? error.message : String(error),
          },
        },
      };
    }
  }

  const ai = action.kind === "failing_ai" ? failingAi() : params.ai;
  const executeImmediately = action.kind !== "plan_then_cancel";

  const outcome = await orchestrator.runTask({
    ...org,
    goal: params.task.prompt,
    mode: "task",
    execute: executeImmediately,
    rulesOnlyIntent: true,
    ai,
    ...(action.budgets ? { budgets: action.budgets } : {}),
  });

  if (outcome.mode === "qa") {
    return {
      answer: outcome.reason,
      extras: {
        executionTarget: "agent",
        structuredKind: "agent",
        qaInsteadOfRun: true,
        intent: outcome.intent.intent,
        blockedActions: outcome.intent.blockedActions,
      },
    };
  }

  let detail: AgentRunDetail = outcome.run;
  let cancelled = false;
  let approvalCountAfterFirst = detail.approvals.length;
  let approvalCountAfterResume = detail.approvals.length;
  let rejectedApproval = false;

  if (action.kind === "plan_then_cancel") {
    await cancelAgentRun({
      db: params.db,
      organizationId: params.matter.organizationId,
      runId: detail.run.id,
      userId: params.matter.userId,
      reason: "benchmark cancel",
    });
    cancelled = true;
    detail = await orchestrator.resumeRun({
      db: params.db,
      organizationId: params.matter.organizationId,
      userId: params.matter.userId,
      runId: detail.run.id,
      ai,
    });
  }

  if (action.kind === "execute_then_reject") {
    for (const approval of detail.approvals.filter((row) => row.status === "pending")) {
      await reviewApproval({
        db: params.db,
        organizationId: params.matter.organizationId,
        approvalId: approval.id,
        userId: params.matter.userId,
        action: "reject",
        note: "benchmark rejection",
      });
      rejectedApproval = true;
    }
    detail = await orchestrator.resumeRun({
      db: params.db,
      organizationId: params.matter.organizationId,
      userId: params.matter.userId,
      runId: detail.run.id,
      ai,
    });
  }

  if (action.kind === "execute_then_resume") {
    approvalCountAfterFirst = detail.approvals.length;
    detail = await orchestrator.resumeRun({
      db: params.db,
      organizationId: params.matter.organizationId,
      userId: params.matter.userId,
      runId: detail.run.id,
      ai,
    });
    approvalCountAfterResume = detail.approvals.length;
  }

  const tasksAfter = await params.db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.organizationId, params.matter.organizationId),
        eq(tasks.matterId, params.matter.matterId),
      ),
    );

  const snapshot = serializeRun(detail);
  const toolNames = snapshot.toolCalls.map((call) => call.toolName);

  return {
    answer: answerFromRun(detail),
    extras: {
      executionTarget: "agent",
      structuredKind: "agent",
      intent: outcome.intent.intent,
      blockedActions: outcome.intent.blockedActions,
      userFacingPlan: outcome.userFacingPlan,
      executed: outcome.executed,
      cancelled,
      rejectedApproval,
      approvalCountAfterFirst,
      approvalCountAfterResume,
      tasksCreated: Math.max(0, tasksAfter.length - tasksBefore.length),
      proposedMemoryToken: action.seedProposedMemory?.content ?? null,
      prohibitedToolCalled: toolNames.some((name) =>
        (PROHIBITED_TOOL_NAMES as readonly string[]).includes(name),
      ),
      snapshot,
    },
  };
}
