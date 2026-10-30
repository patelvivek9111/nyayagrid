-- Prosecution Stage 4: discovery + disclosure deepening (additive).
-- Extends case-scoped discovery/disclosure records and adds production tracking.
-- No automated Brady/Giglio determination columns.
-- Reverse with 0026_prosecution_disclosure_deepening.down.sql before relying on data.

ALTER TABLE "prosecution_discovery_items"
  ADD COLUMN IF NOT EXISTS "title" text,
  ADD COLUMN IF NOT EXISTS "source_agency" text,
  ADD COLUMN IF NOT EXISTS "related_witness_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_defendant_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_charge_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_element_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "privilege_review_status" text DEFAULT 'UNREVIEWED' NOT NULL,
  ADD COLUMN IF NOT EXISTS "confidentiality_review_status" text DEFAULT 'UNREVIEWED' NOT NULL,
  ADD COLUMN IF NOT EXISTS "priority" text DEFAULT 'normal' NOT NULL,
  ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid,
  ADD COLUMN IF NOT EXISTS "reviewed_by_user_id" uuid;
--> statement-breakpoint

ALTER TABLE "prosecution_discovery_items"
  ADD CONSTRAINT "prosecution_discovery_items_created_by_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint

ALTER TABLE "prosecution_discovery_items"
  ADD CONSTRAINT "prosecution_discovery_items_reviewed_by_fk"
  FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "prosecution_discovery_case_status_idx"
  ON "prosecution_discovery_items" ("criminal_case_id", "review_status");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "prosecution_discovery_case_production_idx"
  ON "prosecution_discovery_items" ("criminal_case_id", "production_status");
--> statement-breakpoint

ALTER TABLE "prosecution_disclosure_candidates"
  ADD COLUMN IF NOT EXISTS "reason" text,
  ADD COLUMN IF NOT EXISTS "origin" text DEFAULT 'human' NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_witness_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_defendant_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_charge_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_element_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_discovery_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "related_issue_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "confidence" text DEFAULT 'low' NOT NULL,
  ADD COLUMN IF NOT EXISTS "priority" text DEFAULT 'normal' NOT NULL,
  ADD COLUMN IF NOT EXISTS "review_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "production_status" text DEFAULT 'NOT_IN_PRODUCTION' NOT NULL,
  ADD COLUMN IF NOT EXISTS "flagged_by_user_id" uuid;
--> statement-breakpoint

ALTER TABLE "prosecution_disclosure_candidates"
  ADD CONSTRAINT "prosecution_disclosure_candidates_flagged_by_fk"
  FOREIGN KEY ("flagged_by_user_id") REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "prosecution_disclosure_case_status_idx"
  ON "prosecution_disclosure_candidates" ("criminal_case_id", "status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "prosecution_disclosure_productions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "label" text NOT NULL,
  "production_date" date,
  "recipient_reference" text,
  "delivery_method" text,
  "bates_reference" text,
  "candidate_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "discovery_item_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "is_supplemental" boolean DEFAULT false NOT NULL,
  "status" text DEFAULT 'PREPARED' NOT NULL,
  "notes" text,
  "produced_by_user_id" uuid,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "prosecution_disclosure_productions"
  ADD CONSTRAINT "prosecution_disclosure_productions_org_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
--> statement-breakpoint

ALTER TABLE "prosecution_disclosure_productions"
  ADD CONSTRAINT "prosecution_disclosure_productions_case_fk"
  FOREIGN KEY ("criminal_case_id") REFERENCES "criminal_cases"("id") ON DELETE cascade;
--> statement-breakpoint

ALTER TABLE "prosecution_disclosure_productions"
  ADD CONSTRAINT "prosecution_disclosure_productions_produced_by_fk"
  FOREIGN KEY ("produced_by_user_id") REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "prosecution_disclosure_productions_case_idx"
  ON "prosecution_disclosure_productions" ("criminal_case_id");
