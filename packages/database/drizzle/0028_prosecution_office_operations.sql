-- Prosecution Stage 6: office operations + supervision (additive).
-- Deepens tasks, assignment notes, supervisor case reviews, and caseload indexes.
-- No outcome/conviction KPIs. Reverse with 0028_prosecution_office_operations.down.sql.

ALTER TABLE "criminal_cases"
  ADD COLUMN IF NOT EXISTS "assignment_note" text,
  ADD COLUMN IF NOT EXISTS "last_supervisor_review_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "last_supervisor_review_by_user_id" uuid,
  ADD COLUMN IF NOT EXISTS "closure_reason" text;
--> statement-breakpoint

ALTER TABLE "criminal_cases"
  ADD CONSTRAINT "criminal_cases_last_supervisor_review_by_fk"
  FOREIGN KEY ("last_supervisor_review_by_user_id") REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "criminal_cases_org_status_idx"
  ON "criminal_cases" ("organization_id", "case_status");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "criminal_cases_org_prosecutor_idx"
  ON "criminal_cases" ("organization_id", "assigned_prosecutor_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "criminal_cases_org_priority_idx"
  ON "criminal_cases" ("organization_id", "priority");
--> statement-breakpoint

ALTER TABLE "prosecution_tasks"
  ADD COLUMN IF NOT EXISTS "description" text,
  ADD COLUMN IF NOT EXISTS "owner_user_id" uuid,
  ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid,
  ADD COLUMN IF NOT EXISTS "priority" text DEFAULT 'normal' NOT NULL,
  ADD COLUMN IF NOT EXISTS "due_date_origin" text DEFAULT 'USER_ENTERED',
  ADD COLUMN IF NOT EXISTS "related_evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_witness_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_discovery_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_disclosure_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_motion_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_hearing_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_warrant_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_issue_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "completed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "notes" text;
--> statement-breakpoint

ALTER TABLE "prosecution_tasks"
  ADD CONSTRAINT "prosecution_tasks_owner_fk"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint

ALTER TABLE "prosecution_tasks"
  ADD CONSTRAINT "prosecution_tasks_created_by_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "prosecution_tasks_org_owner_idx"
  ON "prosecution_tasks" ("organization_id", "owner_user_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "prosecution_tasks_org_status_idx"
  ON "prosecution_tasks" ("organization_id", "status");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "prosecution_tasks_due_at_idx"
  ON "prosecution_tasks" ("due_at");
--> statement-breakpoint

ALTER TABLE "prosecution_agencies"
  ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "prosecution_supervisor_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "reviewer_user_id" uuid NOT NULL,
  "status" text DEFAULT 'COMPLETED' NOT NULL,
  "note" text,
  "follow_up_requested" boolean DEFAULT false NOT NULL,
  "follow_up_task_id" uuid,
  "snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "prosecution_supervisor_reviews"
  ADD CONSTRAINT "prosecution_supervisor_reviews_org_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
--> statement-breakpoint

ALTER TABLE "prosecution_supervisor_reviews"
  ADD CONSTRAINT "prosecution_supervisor_reviews_case_fk"
  FOREIGN KEY ("criminal_case_id") REFERENCES "criminal_cases"("id") ON DELETE cascade;
--> statement-breakpoint

ALTER TABLE "prosecution_supervisor_reviews"
  ADD CONSTRAINT "prosecution_supervisor_reviews_reviewer_fk"
  FOREIGN KEY ("reviewer_user_id") REFERENCES "users"("id") ON DELETE cascade;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "prosecution_supervisor_reviews_case_idx"
  ON "prosecution_supervisor_reviews" ("criminal_case_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "prosecution_supervisor_reviews_org_idx"
  ON "prosecution_supervisor_reviews" ("organization_id");
