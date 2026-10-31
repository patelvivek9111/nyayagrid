-- Prosecution Stage 5: legal workflow deepening (additive).
-- Extends warrants, procedure issues, motions, hearings, subpoenas, pleas;
-- adds case-scoped research authority links and draft pointers.
-- No automated suppression/plea/filing conclusions.
-- Reverse with 0027_prosecution_legal_workflow.down.sql before relying on data.

ALTER TABLE "prosecution_procedure_issues"
  ADD COLUMN IF NOT EXISTS "description" text,
  ADD COLUMN IF NOT EXISTS "related_warrant_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_defendant_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_officer_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_witness_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_timeline_event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "supporting_facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "contrary_facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "human_review_status" text DEFAULT 'UNREVIEWED' NOT NULL,
  ADD COLUMN IF NOT EXISTS "human_conclusion" text,
  ADD COLUMN IF NOT EXISTS "notes" text;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "prosecution_procedure_issues_case_status_idx"
  ON "prosecution_procedure_issues" ("criminal_case_id", "status");
--> statement-breakpoint

ALTER TABLE "prosecution_warrants"
  ADD COLUMN IF NOT EXISTS "target_location" text,
  ADD COLUMN IF NOT EXISTS "target_person" text,
  ADD COLUMN IF NOT EXISTS "target_device" text,
  ADD COLUMN IF NOT EXISTS "target_property" text,
  ADD COLUMN IF NOT EXISTS "related_defendant_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_officer_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'RECORDED' NOT NULL,
  ADD COLUMN IF NOT EXISTS "notes" text;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "prosecution_warrants_case_status_idx"
  ON "prosecution_warrants" ("criminal_case_id", "status");
--> statement-breakpoint

ALTER TABLE "prosecution_motions"
  ADD COLUMN IF NOT EXISTS "response_due_date" date,
  ADD COLUMN IF NOT EXISTS "hearing_date" date,
  ADD COLUMN IF NOT EXISTS "ruling_date" date,
  ADD COLUMN IF NOT EXISTS "related_evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_defendant_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_draft_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "assigned_attorney_user_id" uuid,
  ADD COLUMN IF NOT EXISTS "notes" text;
--> statement-breakpoint

ALTER TABLE "prosecution_motions"
  ADD CONSTRAINT "prosecution_motions_assigned_attorney_fk"
  FOREIGN KEY ("assigned_attorney_user_id") REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "prosecution_motions_case_status_idx"
  ON "prosecution_motions" ("criminal_case_id", "status");
--> statement-breakpoint

ALTER TABLE "prosecution_hearings"
  ADD COLUMN IF NOT EXISTS "related_motion_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_defendant_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_draft_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "courtroom" text,
  ADD COLUMN IF NOT EXISTS "notes" text;
--> statement-breakpoint

ALTER TABLE "prosecution_subpoenas"
  ADD COLUMN IF NOT EXISTS "recipient_type" text DEFAULT 'OTHER' NOT NULL,
  ADD COLUMN IF NOT EXISTS "prepared_date" date,
  ADD COLUMN IF NOT EXISTS "issuing_authority" text,
  ADD COLUMN IF NOT EXISTS "related_defendant_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_witness_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_discovery_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "return_status" text DEFAULT 'PENDING' NOT NULL,
  ADD COLUMN IF NOT EXISTS "return_notes" text,
  ADD COLUMN IF NOT EXISTS "return_received_date" date,
  ADD COLUMN IF NOT EXISTS "return_document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "notes" text;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "prosecution_subpoenas_case_status_idx"
  ON "prosecution_subpoenas" ("criminal_case_id", "status");
--> statement-breakpoint

ALTER TABLE "prosecution_plea_offers"
  ADD COLUMN IF NOT EXISTS "related_charge_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "defense_response" text,
  ADD COLUMN IF NOT EXISTS "prosecutor_notes" text,
  ADD COLUMN IF NOT EXISTS "supervisor_review_status" text DEFAULT 'UNREVIEWED' NOT NULL,
  ADD COLUMN IF NOT EXISTS "document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "version_label" text,
  ADD COLUMN IF NOT EXISTS "parent_offer_id" uuid,
  ADD COLUMN IF NOT EXISTS "sentencing_recommendation_reference" text;
--> statement-breakpoint

ALTER TABLE "prosecution_plea_offers"
  ADD CONSTRAINT "prosecution_plea_offers_parent_fk"
  FOREIGN KEY ("parent_offer_id") REFERENCES "prosecution_plea_offers"("id") ON DELETE set null;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "prosecution_case_authorities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "authority_id" uuid,
  "citation" text NOT NULL,
  "proposition" text NOT NULL,
  "jurisdiction" text,
  "court" text,
  "hierarchy_status" text DEFAULT 'UNKNOWN' NOT NULL,
  "treatment_status" text DEFAULT 'UNKNOWN' NOT NULL,
  "relation" text DEFAULT 'RELEVANT' NOT NULL,
  "source_span" text,
  "source_page" integer,
  "related_issue_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "related_motion_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "related_warrant_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "human_review_status" text DEFAULT 'UNREVIEWED' NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "prosecution_case_authorities"
  ADD CONSTRAINT "prosecution_case_authorities_org_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
--> statement-breakpoint

ALTER TABLE "prosecution_case_authorities"
  ADD CONSTRAINT "prosecution_case_authorities_case_fk"
  FOREIGN KEY ("criminal_case_id") REFERENCES "criminal_cases"("id") ON DELETE cascade;
--> statement-breakpoint

ALTER TABLE "prosecution_case_authorities"
  ADD CONSTRAINT "prosecution_case_authorities_created_by_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "prosecution_case_authorities_case_idx"
  ON "prosecution_case_authorities" ("criminal_case_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "prosecution_case_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "draft_id" uuid,
  "draft_type" text NOT NULL,
  "title" text NOT NULL,
  "content" text DEFAULT '' NOT NULL,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "related_motion_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "related_hearing_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "related_issue_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "related_evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "related_authority_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "citation_markers" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "ai_generated" boolean DEFAULT false NOT NULL,
  "approved_at" timestamp with time zone,
  "approved_by_user_id" uuid,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "prosecution_case_drafts"
  ADD CONSTRAINT "prosecution_case_drafts_org_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
--> statement-breakpoint

ALTER TABLE "prosecution_case_drafts"
  ADD CONSTRAINT "prosecution_case_drafts_case_fk"
  FOREIGN KEY ("criminal_case_id") REFERENCES "criminal_cases"("id") ON DELETE cascade;
--> statement-breakpoint

ALTER TABLE "prosecution_case_drafts"
  ADD CONSTRAINT "prosecution_case_drafts_draft_fk"
  FOREIGN KEY ("draft_id") REFERENCES "drafts"("id") ON DELETE set null;
--> statement-breakpoint

ALTER TABLE "prosecution_case_drafts"
  ADD CONSTRAINT "prosecution_case_drafts_approved_by_fk"
  FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint

ALTER TABLE "prosecution_case_drafts"
  ADD CONSTRAINT "prosecution_case_drafts_created_by_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "prosecution_case_drafts_case_idx"
  ON "prosecution_case_drafts" ("criminal_case_id");
