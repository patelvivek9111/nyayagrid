import { and, desc, eq, inArray, tasks } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import {
  agentApprovals,
  type AgentActionType,
  type AgentApproval,
  type AgentProvenanceEntry,
  type AgentRiskLevel,
} from "@nyayagrid/database";
import { AuthorizationError, requireMatterAccess, writeAuditEvent } from "@nyayagrid/permissions";
import { reviewMatterMemory } from "@nyayagrid/intelligence";
import { saveAuthorityToMatter } from "@nyayagrid/research";
import type { EmbeddingProvider } from "@nyayagrid/ai";

export type CreateActionProposalParams = {
  db: Database;
  organizationId: string;
  matterId?: string | null;
  runId: string;
  stepRecordId?: string | null;
  artifactId?: string | null;
  actionType: AgentActionType;
  proposedData: Record<string, unknown>;
  rationale?: string | null;
  provenance?: AgentProvenanceEntry[];
  riskLevel: AgentRiskLevel;
  actorUserId: string;
};

/**
 * Records a proposed action as pending.
 *
 * Proposals are always written pending, including low-risk ones: the point of the table is that a
 * human decided, and an auto-approved row would make the audit trail claim a review that never
 * happened.
 */
export async function createActionProposal(
  params: CreateActionProposalParams,
): Promise<AgentApproval> {
  const [row] = await params.db
    .insert(agentApprovals)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId ?? null,
      runId: params.runId,
      stepId: params.stepRecordId ?? null,
      artifactId: params.artifactId ?? null,
      actionType: params.actionType,
      proposedData: params.proposedData,
      rationale: params.rationale ?? null,
      provenance: params.provenance ?? [],
      riskLevel: params.riskLevel,
      status: "pending",
    })
    .returning();

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    matterId: params.matterId ?? null,
    action: "agent.approval.created",
    targetType: "agent_approval",
    targetId: row!.id,
    metadata: {
      runId: params.runId,
      actionType: params.actionType,
      riskLevel: params.riskLevel,
    },
  });

  return row!;
}

export async function listPendingApprovals(params: {
  db: Database;
  organizationId: string;
  runId?: string;
  matterId?: string | null;
  limit?: number;
}): Promise<AgentApproval[]> {
  const conditions = [
    eq(agentApprovals.organizationId, params.organizationId),
    eq(agentApprovals.status, "pending"),
  ];
  if (params.runId) conditions.push(eq(agentApprovals.runId, params.runId));
  if (params.matterId) conditions.push(eq(agentApprovals.matterId, params.matterId));

  return params.db
    .select()
    .from(agentApprovals)
    .where(and(...conditions))
    .orderBy(desc(agentApprovals.createdAt))
    .limit(params.limit ?? 100);
}

export async function getApproval(params: {
  db: Database;
  organizationId: string;
  approvalId: string;
}): Promise<AgentApproval | null> {
  const [row] = await params.db
    .select()
    .from(agentApprovals)
    .where(
      and(
        eq(agentApprovals.id, params.approvalId),
        eq(agentApprovals.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export type ReviewApprovalAction = "approve" | "edit_and_approve" | "reject";

export type ReviewApprovalParams = {
  db: Database;
  organizationId: string;
  approvalId: string;
  userId: string;
  action: ReviewApprovalAction;
  edits?: Record<string, unknown>;
  note?: string | null;
  embeddings?: EmbeddingProvider;
};

export type ReviewApprovalResult = {
  approval: AgentApproval;
  /** Identifier of the record the approval created, when execution produced one. */
  executedRecordId: string | null;
  executedRecordType: string | null;
  /** Set when the action type has no automated execution path yet. */
  executionNote: string | null;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function executeCreateTask(params: {
  db: Database;
  organizationId: string;
  matterId: string;
  userId: string;
  data: Record<string, unknown>;
}): Promise<string> {
  const title = asString(params.data.title);
  if (!title) throw new Error("Task proposal is missing a title");

  const priority = asString(params.data.priority);
  const dueAtRaw = asString(params.data.dueAt);
  const assignedTo = asString(params.data.assignedToUserId);

  const [task] = await params.db
    .insert(tasks)
    .values({
      organizationId: params.organizationId,
      matterId: params.matterId,
      title,
      description: asString(params.data.description),
      priority:
        priority === "low" || priority === "medium" || priority === "high" || priority === "urgent"
          ? priority
          : "medium",
      assignedToUserId: assignedTo ?? params.userId,
      createdByUserId: params.userId,
      dueAt: dueAtRaw ? new Date(dueAtRaw) : null,
    })
    .returning();

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: params.matterId,
    action: "task.created",
    targetType: "task",
    targetId: task!.id,
    metadata: { origin: "agent_approval" },
  });

  return task!.id;
}

/**
 * Applies a reviewer's decision and, on approval, performs the proposed write.
 *
 * Execution happens here rather than in the agent so the write is attributed to the reviewing
 * user and can only occur once a human has seen the exact proposed data.
 */
export async function reviewApproval(params: ReviewApprovalParams): Promise<ReviewApprovalResult> {
  const approval = await getApproval({
    db: params.db,
    organizationId: params.organizationId,
    approvalId: params.approvalId,
  });
  if (!approval) throw new Error("Approval not found");
  if (approval.status !== "pending") {
    throw new Error(`Approval already ${approval.status}`);
  }

  if (approval.matterId) {
    await requireMatterAccess(params.db, {
      userId: params.userId,
      matterId: approval.matterId,
      minAccess: "edit",
      capability: "matters.edit",
    });
  } else {
    throw new AuthorizationError("Approvals must be scoped to a matter before review");
  }

  const now = new Date();
  const status =
    params.action === "reject"
      ? "rejected"
      : params.action === "edit_and_approve"
        ? "edited_and_approved"
        : "approved";

  const proposedData =
    params.action === "edit_and_approve" && params.edits
      ? { ...approval.proposedData, ...params.edits }
      : approval.proposedData;

  let executedRecordId: string | null = null;
  let executedRecordType: string | null = null;
  let executionNote: string | null = null;

  if (status !== "rejected") {
    switch (approval.actionType) {
      case "CREATE_TASK": {
        executedRecordId = await executeCreateTask({
          db: params.db,
          organizationId: params.organizationId,
          matterId: approval.matterId,
          userId: params.userId,
          data: proposedData,
        });
        executedRecordType = "task";
        break;
      }
      case "SAVE_MEMORY": {
        const memoryId = asString(proposedData.memoryId);
        if (!memoryId) {
          executionNote = "Approval had no memoryId to activate; nothing was written.";
          break;
        }
        const reviewed = await reviewMatterMemory({
          db: params.db,
          organizationId: params.organizationId,
          matterId: approval.matterId,
          memoryId,
          userId: params.userId,
          action: params.action === "edit_and_approve" ? "edit_and_approve" : "approve",
          ...(params.action === "edit_and_approve" && params.edits
            ? {
                edits: {
                  ...(asString(params.edits.title) ? { title: asString(params.edits.title)! } : {}),
                  ...(asString(params.edits.content)
                    ? { content: asString(params.edits.content)! }
                    : {}),
                },
              }
            : {}),
          ...(params.embeddings ? { embeddings: params.embeddings } : {}),
        });
        executedRecordId =
          typeof reviewed === "object" && reviewed !== null && "id" in reviewed
            ? ((reviewed as { id: string }).id ?? memoryId)
            : memoryId;
        executedRecordType = "matter_memory";
        break;
      }
      case "SAVE_AUTHORITY": {
        const authorityId = asString(proposedData.authorityId);
        if (!authorityId) {
          executionNote = "Approval had no authorityId to save; nothing was written.";
          break;
        }
        const saved = await saveAuthorityToMatter({
          db: params.db,
          organizationId: params.organizationId,
          matterId: approval.matterId,
          authorityId,
          userId: params.userId,
          relevanceNote: asString(proposedData.relevanceNote),
        });
        executedRecordId = saved.id;
        executedRecordType = "matter_authority";
        break;
      }
      case "CREATE_DRAFT": {
        const draftId = asString(proposedData.draftId);
        executedRecordId = draftId;
        executedRecordType = draftId ? "draft" : null;
        executionNote = draftId
          ? "Draft already exists as reviewable work product; approval records the attorney sign-off."
          : "No draft id was attached to this approval.";
        break;
      }
      case "PROPOSE_TIMELINE_EVENT":
      case "ADD_GRAPH_RELATIONSHIP":
      case "OTHER": {
        executionNote = `Action ${approval.actionType} is recorded as approved; apply it through its own review workflow.`;
        break;
      }
    }
  }

  const [updated] = await params.db
    .update(agentApprovals)
    .set({
      status,
      proposedData,
      reviewedByUserId: params.userId,
      reviewedAt: now,
      reviewNote: params.note ?? null,
      updatedAt: now,
    })
    .where(eq(agentApprovals.id, approval.id))
    .returning();

  await writeAuditEvent(params.db, {
    organizationId: params.organizationId,
    actorUserId: params.userId,
    matterId: approval.matterId,
    action: `agent.approval.${status}`,
    targetType: "agent_approval",
    targetId: approval.id,
    metadata: {
      runId: approval.runId,
      actionType: approval.actionType,
      riskLevel: approval.riskLevel,
      executedRecordType,
      executedRecordId,
    },
  });

  return {
    approval: updated!,
    executedRecordId,
    executedRecordType,
    executionNote,
  };
}

/** Approvals blocking a run's steps, keyed by the step record id. */
export async function loadBlockingApprovals(params: {
  db: Database;
  organizationId: string;
  runId: string;
}): Promise<Map<string, AgentApproval[]>> {
  const rows = await params.db
    .select()
    .from(agentApprovals)
    .where(
      and(
        eq(agentApprovals.organizationId, params.organizationId),
        eq(agentApprovals.runId, params.runId),
        inArray(agentApprovals.status, ["pending"]),
      ),
    );

  const byStep = new Map<string, AgentApproval[]>();
  for (const row of rows) {
    if (!row.stepId) continue;
    const existing = byStep.get(row.stepId) ?? [];
    existing.push(row);
    byStep.set(row.stepId, existing);
  }
  return byStep;
}
