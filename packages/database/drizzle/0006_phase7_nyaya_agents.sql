CREATE TYPE "public"."agent_run_status" AS ENUM('planned', 'awaiting_approval', 'running', 'completed', 'partially_completed', 'failed', 'cancelled');
CREATE TYPE "public"."agent_step_status" AS ENUM('pending', 'running', 'completed', 'failed', 'skipped', 'awaiting_approval', 'cancelled');
CREATE TYPE "public"."agent_risk_level" AS ENUM('low', 'medium', 'high');
CREATE TYPE "public"."agent_action_type" AS ENUM('CREATE_TASK', 'SAVE_MEMORY', 'SAVE_AUTHORITY', 'CREATE_DRAFT', 'PROPOSE_TIMELINE_EVENT', 'ADD_GRAPH_RELATIONSHIP', 'OTHER');
CREATE TYPE "public"."agent_approval_status" AS ENUM('pending', 'approved', 'edited_and_approved', 'rejected');
CREATE TYPE "public"."agent_provenance_class" AS ENUM('MATTER_EVIDENCE', 'VERIFIED_MATTER_INTELLIGENCE', 'GRAPH_RELATIONSHIP', 'MATTER_MEMORY', 'LEGAL_AUTHORITY', 'USER_INSTRUCTION');

CREATE TABLE "agent_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid,
  "user_id" uuid NOT NULL,
  "goal" text NOT NULL,
  "agent_mode" text DEFAULT 'task' NOT NULL,
  "intent" text,
  "status" "agent_run_status" DEFAULT 'planned' NOT NULL,
  "plan_version" integer DEFAULT 1 NOT NULL,
  "plan" jsonb DEFAULT '{"steps":[]}'::jsonb,
  "user_facing_plan" text,
  "limitations" jsonb DEFAULT '[]'::jsonb,
  "budgets" jsonb DEFAULT '{}'::jsonb,
  "error_summary" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "agent_runs_organization_idx" ON "agent_runs" ("organization_id");
CREATE INDEX "agent_runs_matter_idx" ON "agent_runs" ("matter_id");
CREATE INDEX "agent_runs_user_idx" ON "agent_runs" ("user_id");
CREATE INDEX "agent_runs_status_idx" ON "agent_runs" ("status");
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

CREATE TABLE "agent_run_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid,
  "run_id" uuid NOT NULL,
  "step_id" text NOT NULL,
  "step_order" integer NOT NULL,
  "agent_type" text NOT NULL,
  "objective" text NOT NULL,
  "status" "agent_step_status" DEFAULT 'pending' NOT NULL,
  "dependencies" jsonb DEFAULT '[]'::jsonb,
  "required_tools" jsonb DEFAULT '[]'::jsonb,
  "approval_requirement" "agent_risk_level" DEFAULT 'low' NOT NULL,
  "input_metadata" jsonb DEFAULT '{}'::jsonb,
  "output_artifact_id" uuid,
  "output_summary" text,
  "error_code" text,
  "error_message" text,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "agent_run_steps_run_step_uidx" ON "agent_run_steps" ("run_id", "step_id");
CREATE INDEX "agent_run_steps_run_idx" ON "agent_run_steps" ("run_id");
CREATE INDEX "agent_run_steps_organization_idx" ON "agent_run_steps" ("organization_id");
CREATE INDEX "agent_run_steps_matter_idx" ON "agent_run_steps" ("matter_id");
ALTER TABLE "agent_run_steps" ADD CONSTRAINT "agent_run_steps_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_run_steps" ADD CONSTRAINT "agent_run_steps_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_run_steps" ADD CONSTRAINT "agent_run_steps_run_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "agent_tool_calls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid,
  "run_id" uuid NOT NULL,
  "step_id" uuid,
  "tool_name" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "authorization_scope" jsonb DEFAULT '{}'::jsonb,
  "resource_ids" jsonb DEFAULT '[]'::jsonb,
  "duration_ms" integer,
  "result_artifact_id" uuid,
  "result_summary" text,
  "error_classification" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
CREATE INDEX "agent_tool_calls_run_idx" ON "agent_tool_calls" ("run_id");
CREATE INDEX "agent_tool_calls_step_idx" ON "agent_tool_calls" ("step_id");
CREATE INDEX "agent_tool_calls_organization_idx" ON "agent_tool_calls" ("organization_id");
CREATE INDEX "agent_tool_calls_tool_idx" ON "agent_tool_calls" ("tool_name");
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_run_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_step_fk" FOREIGN KEY ("step_id") REFERENCES "public"."agent_run_steps"("id") ON DELETE set null ON UPDATE no action;

CREATE TABLE "agent_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid,
  "run_id" uuid NOT NULL,
  "step_id" uuid,
  "artifact_type" text NOT NULL,
  "title" text,
  "content" text,
  "content_ref" jsonb DEFAULT '{}'::jsonb,
  "provenance" jsonb DEFAULT '[]'::jsonb,
  "sources" jsonb DEFAULT '[]'::jsonb,
  "action_proposals" jsonb DEFAULT '[]'::jsonb,
  "generated_by" text,
  "provider" text,
  "model" text,
  "prompt_version" text,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "agent_artifacts_run_idx" ON "agent_artifacts" ("run_id");
CREATE INDEX "agent_artifacts_step_idx" ON "agent_artifacts" ("step_id");
CREATE INDEX "agent_artifacts_organization_idx" ON "agent_artifacts" ("organization_id");
CREATE INDEX "agent_artifacts_matter_idx" ON "agent_artifacts" ("matter_id");
ALTER TABLE "agent_artifacts" ADD CONSTRAINT "agent_artifacts_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_artifacts" ADD CONSTRAINT "agent_artifacts_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_artifacts" ADD CONSTRAINT "agent_artifacts_run_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_artifacts" ADD CONSTRAINT "agent_artifacts_step_fk" FOREIGN KEY ("step_id") REFERENCES "public"."agent_run_steps"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "agent_artifacts" ADD CONSTRAINT "agent_artifacts_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

CREATE TABLE "agent_approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid,
  "run_id" uuid NOT NULL,
  "step_id" uuid,
  "artifact_id" uuid,
  "action_type" "agent_action_type" NOT NULL,
  "proposed_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "rationale" text,
  "provenance" jsonb DEFAULT '[]'::jsonb,
  "risk_level" "agent_risk_level" DEFAULT 'high' NOT NULL,
  "status" "agent_approval_status" DEFAULT 'pending' NOT NULL,
  "reviewed_by_user_id" uuid,
  "reviewed_at" timestamp with time zone,
  "review_note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "agent_approvals_run_idx" ON "agent_approvals" ("run_id");
CREATE INDEX "agent_approvals_step_idx" ON "agent_approvals" ("step_id");
CREATE INDEX "agent_approvals_organization_idx" ON "agent_approvals" ("organization_id");
CREATE INDEX "agent_approvals_matter_idx" ON "agent_approvals" ("matter_id");
CREATE INDEX "agent_approvals_status_idx" ON "agent_approvals" ("status");
ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_run_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_step_fk" FOREIGN KEY ("step_id") REFERENCES "public"."agent_run_steps"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_artifact_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."agent_artifacts"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_reviewed_by_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
