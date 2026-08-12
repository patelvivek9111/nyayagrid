import {
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
  index,
  jsonb,
  integer,
  pgEnum,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { matters, organizations, users } from "./index";

export const agentRunStatusEnum = pgEnum("agent_run_status", [
  "planned",
  "awaiting_approval",
  "running",
  "completed",
  "partially_completed",
  "failed",
  "cancelled",
]);

export const agentStepStatusEnum = pgEnum("agent_step_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
  "awaiting_approval",
  "cancelled",
]);

export const agentRiskLevelEnum = pgEnum("agent_risk_level", ["low", "medium", "high"]);

/**
 * Actions an agent may *propose*. Every entry here is reviewable: nothing in this list is
 * executed by the orchestrator without an approval row transitioning to approved.
 */
export const agentActionTypeEnum = pgEnum("agent_action_type", [
  "CREATE_TASK",
  "SAVE_MEMORY",
  "SAVE_AUTHORITY",
  "CREATE_DRAFT",
  "PROPOSE_TIMELINE_EVENT",
  "ADD_GRAPH_RELATIONSHIP",
  "OTHER",
]);

export const agentApprovalStatusEnum = pgEnum("agent_approval_status", [
  "pending",
  "approved",
  "edited_and_approved",
  "rejected",
]);

/**
 * What kind of support an agent assertion rests on. MATTER_EVIDENCE points at confidential
 * matter document chunks; LEGAL_AUTHORITY points at the shared corpus. The classes are never
 * interchangeable — a matter document is not legal authority, and a memory is not evidence.
 */
export const agentProvenanceClassEnum = pgEnum("agent_provenance_class", [
  "MATTER_EVIDENCE",
  "VERIFIED_MATTER_INTELLIGENCE",
  "GRAPH_RELATIONSHIP",
  "MATTER_MEMORY",
  "LEGAL_AUTHORITY",
  "USER_INSTRUCTION",
]);

export type AgentProvenanceClass = (typeof agentProvenanceClassEnum.enumValues)[number];
export type AgentRiskLevel = (typeof agentRiskLevelEnum.enumValues)[number];
export type AgentActionType = (typeof agentActionTypeEnum.enumValues)[number];

/** Single provenance entry attached to an artifact or approval proposal. */
export type AgentProvenanceEntry = {
  class: AgentProvenanceClass;
  refs: string[];
  note?: string;
};

export type AgentSourceRef = {
  documentId?: string;
  documentVersionId?: string;
  chunkId?: string;
  authorityId?: string;
  authorityChunkId?: string;
  page?: number | null;
  quote?: string;
};

export type AgentPlanStepRecord = {
  stepId: string;
  agentType: string;
  objective: string;
  dependencies: string[];
  requiredTools: string[];
  approvalRequirement: AgentRiskLevel;
};

export type AgentRunPlan = {
  steps: AgentPlanStepRecord[];
};

export type AgentRunBudgets = {
  maxSteps: number;
  maxToolCalls: number;
  maxRetries: number;
  maxRetrievedContext: number;
  timeoutMs: number;
};

export type AgentActionProposal = {
  actionType: AgentActionType;
  proposedData: Record<string, unknown>;
  rationale?: string;
  riskLevel: AgentRiskLevel;
  provenance?: AgentProvenanceEntry[];
};

/**
 * Canonical pointers to the records a domain package already owns (drafts, research_artifacts,
 * document analyses). Agent artifacts reference those rows instead of duplicating their bodies.
 */
export type AgentContentRef = {
  kind?: string;
  draftId?: string;
  draftVersionId?: string;
  researchArtifactId?: string;
  researchSessionId?: string;
  documentAnalysisId?: string;
  analysisRunId?: string;
  documentComparisonId?: string;
  matterMemoryIds?: string[];
  timelineEventIds?: string[];
  graphNodeIds?: string[];
  [key: string]: unknown;
};

/** One orchestrated agent run. Holds the plan; never the prompts or retrieved document bodies. */
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id").references(() => matters.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    goal: text("goal").notNull(),
    agentMode: text("agent_mode").$type<"ask" | "task">().notNull().default("task"),
    intent: text("intent"),
    status: agentRunStatusEnum("status").notNull().default("planned"),
    planVersion: integer("plan_version").notNull().default(1),
    plan: jsonb("plan").$type<AgentRunPlan>().default({ steps: [] }),
    userFacingPlan: text("user_facing_plan"),
    limitations: jsonb("limitations").$type<string[]>().default([]),
    /** Defaults to an empty object; readers fall back to DEFAULT_BUDGETS for missing fields. */
    budgets: jsonb("budgets")
      .$type<Partial<AgentRunBudgets>>()
      .default(sql`'{}'::jsonb`),
    errorSummary: text("error_summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("agent_runs_organization_idx").on(table.organizationId),
    index("agent_runs_matter_idx").on(table.matterId),
    index("agent_runs_user_idx").on(table.userId),
    index("agent_runs_status_idx").on(table.status),
  ],
);

/**
 * A planned unit of work. `stepId` is the plan-stable identifier used for dependencies; the uuid
 * `id` is the database identity. inputMetadata carries only scoping metadata, never full prompts.
 */
export const agentRunSteps = pgTable(
  "agent_run_steps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id").references(() => matters.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    stepId: text("step_id").notNull(),
    stepOrder: integer("step_order").notNull(),
    agentType: text("agent_type").notNull(),
    objective: text("objective").notNull(),
    status: agentStepStatusEnum("status").notNull().default("pending"),
    dependencies: jsonb("dependencies").$type<string[]>().default([]),
    requiredTools: jsonb("required_tools").$type<string[]>().default([]),
    approvalRequirement: agentRiskLevelEnum("approval_requirement").notNull().default("low"),
    inputMetadata: jsonb("input_metadata").$type<Record<string, unknown>>().default({}),
    outputArtifactId: uuid("output_artifact_id"),
    outputSummary: text("output_summary"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("agent_run_steps_run_step_uidx").on(table.runId, table.stepId),
    index("agent_run_steps_run_idx").on(table.runId),
    index("agent_run_steps_organization_idx").on(table.organizationId),
    index("agent_run_steps_matter_idx").on(table.matterId),
  ],
);

/**
 * Audit trail of tool invocations. Records which resources were touched and under what
 * authorization scope; never the document bodies or model prompts those tools handled.
 */
export const agentToolCalls = pgTable(
  "agent_tool_calls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id").references(() => matters.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    stepId: uuid("step_id").references(() => agentRunSteps.id, { onDelete: "set null" }),
    toolName: text("tool_name").notNull(),
    status: text("status")
      .$type<"pending" | "running" | "completed" | "failed" | "denied">()
      .notNull()
      .default("pending"),
    authorizationScope: jsonb("authorization_scope").$type<Record<string, unknown>>().default({}),
    resourceIds: jsonb("resource_ids").$type<string[]>().default([]),
    durationMs: integer("duration_ms"),
    resultArtifactId: uuid("result_artifact_id"),
    resultSummary: text("result_summary"),
    errorClassification: text("error_classification"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("agent_tool_calls_run_idx").on(table.runId),
    index("agent_tool_calls_step_idx").on(table.stepId),
    index("agent_tool_calls_organization_idx").on(table.organizationId),
    index("agent_tool_calls_tool_idx").on(table.toolName),
  ],
);

/** Agent output. `contentRef` points at the canonical domain record when one exists. */
export const agentArtifacts = pgTable(
  "agent_artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id").references(() => matters.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    stepId: uuid("step_id").references(() => agentRunSteps.id, { onDelete: "set null" }),
    artifactType: text("artifact_type").notNull(),
    title: text("title"),
    content: text("content"),
    contentRef: jsonb("content_ref").$type<AgentContentRef>().default({}),
    provenance: jsonb("provenance").$type<AgentProvenanceEntry[]>().default([]),
    sources: jsonb("sources").$type<AgentSourceRef[]>().default([]),
    actionProposals: jsonb("action_proposals").$type<AgentActionProposal[]>().default([]),
    generatedBy: text("generated_by"),
    provider: text("provider"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("agent_artifacts_run_idx").on(table.runId),
    index("agent_artifacts_step_idx").on(table.stepId),
    index("agent_artifacts_organization_idx").on(table.organizationId),
    index("agent_artifacts_matter_idx").on(table.matterId),
  ],
);

/**
 * Human-in-the-loop gate. An agent writes a pending row; a reviewing user approves, edits and
 * approves, or rejects it. Nothing in this table is ever auto-approved by the orchestrator.
 */
export const agentApprovals = pgTable(
  "agent_approvals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id").references(() => matters.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    stepId: uuid("step_id").references(() => agentRunSteps.id, { onDelete: "set null" }),
    artifactId: uuid("artifact_id").references(() => agentArtifacts.id, { onDelete: "set null" }),
    actionType: agentActionTypeEnum("action_type").notNull(),
    proposedData: jsonb("proposed_data").$type<Record<string, unknown>>().notNull().default({}),
    rationale: text("rationale"),
    provenance: jsonb("provenance").$type<AgentProvenanceEntry[]>().default([]),
    riskLevel: agentRiskLevelEnum("risk_level").notNull().default("high"),
    status: agentApprovalStatusEnum("status").notNull().default("pending"),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("agent_approvals_run_idx").on(table.runId),
    index("agent_approvals_step_idx").on(table.stepId),
    index("agent_approvals_organization_idx").on(table.organizationId),
    index("agent_approvals_matter_idx").on(table.matterId),
    index("agent_approvals_status_idx").on(table.status),
  ],
);

export type AgentRun = typeof agentRuns.$inferSelect;
export type AgentRunStep = typeof agentRunSteps.$inferSelect;
export type AgentToolCall = typeof agentToolCalls.$inferSelect;
export type AgentArtifact = typeof agentArtifacts.$inferSelect;
export type AgentApproval = typeof agentApprovals.$inferSelect;
