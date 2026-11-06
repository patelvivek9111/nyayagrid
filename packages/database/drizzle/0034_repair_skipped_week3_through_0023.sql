-- WP-06C: repair staging journal hole (0018–0023 skipped; 0024 journaled).
-- Staging product DB recorded when=1788200000000 (0024) immediately after 0017,
-- so Drizzle will never re-apply 0018–0023. This additive migration uses when
-- 1788250000000 (between 0024 and 0025) to install the skipped schema before
-- prosecution memory/graph/contacts/billing migrations.
--
-- Also restores the product-schema authority *catalog shell* (`legal_authorities`)
-- when absent. Phase 6 placed this table on the product database as shared reference
-- metadata (no organization_id). Staging journal includes 0005/0012/0014 hashes but
-- the table was verified missing while research_* tables remain — schema drift.
-- This CREATE is empty-shell only: it does NOT insert corpus rows and does NOT
-- substitute for CORPUS_DATABASE_URL / Neon legal corpus.
--
-- Idempotent CREATE IF NOT EXISTS / guarded constraints. Do not rewrite historical when.
-- Reverse: 0034_repair_skipped_week3_through_0023.down.sql (intentionally no-op).
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.criminal_cases') IS NOT NULL THEN
    RAISE NOTICE '0034: criminal_cases already present; continuing idempotent apply';
  ELSE
    RAISE NOTICE '0034: installing skipped week3→0023 schema for staging journal hole';
  END IF;
END $$;
--> statement-breakpoint
-- Product authority catalog shell (empty). Enums already present on staging.
CREATE TABLE IF NOT EXISTS "legal_authorities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "authority_type" "authority_type" NOT NULL,
  "jurisdiction" text,
  "court" text,
  "title" text NOT NULL,
  "short_title" text,
  "citation" text,
  "normalized_citation" text,
  "docket_number" text,
  "decision_date" date,
  "effective_date" date,
  "publication_status" text,
  "source_provider" text,
  "source_external_id" text,
  "canonical_source_url" text,
  "ingestion_status" "authority_ingestion_status" DEFAULT 'pending' NOT NULL,
  "treatment_status" "authority_treatment_status" DEFAULT 'unknown' NOT NULL,
  "hierarchy_path" jsonb DEFAULT '[]'::jsonb,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Columns from journaled 0012 / 0014 that may be absent on a recreated shell.
ALTER TABLE "legal_authorities" ADD COLUMN IF NOT EXISTS "court_id" text;
ALTER TABLE "legal_authorities" ADD COLUMN IF NOT EXISTS "authority_state" text;
ALTER TABLE "legal_authorities" ADD COLUMN IF NOT EXISTS "federal_circuit" text;
ALTER TABLE "legal_authorities" ADD COLUMN IF NOT EXISTS "court_level" text;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."authority_currentness_status" AS ENUM(
    'unknown',
    'current_as_of_source_date',
    'current_verified_from_source',
    'historical',
    'superseded'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "legal_authorities"
  ADD COLUMN IF NOT EXISTS "currentness_status" "authority_currentness_status" DEFAULT 'unknown' NOT NULL;
ALTER TABLE "legal_authorities"
  ADD COLUMN IF NOT EXISTS "last_checked_at" timestamp with time zone;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "legal_authorities_source_uidx"
  ON "legal_authorities" ("source_provider", "source_external_id")
  WHERE "source_provider" IS NOT NULL AND "source_external_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "legal_authorities_citation_idx" ON "legal_authorities" ("citation");
CREATE INDEX IF NOT EXISTS "legal_authorities_normalized_citation_idx" ON "legal_authorities" ("normalized_citation");
CREATE INDEX IF NOT EXISTS "legal_authorities_jurisdiction_idx" ON "legal_authorities" ("jurisdiction");
CREATE INDEX IF NOT EXISTS "legal_authorities_type_idx" ON "legal_authorities" ("authority_type");
CREATE INDEX IF NOT EXISTS "legal_authorities_currentness_idx" ON "legal_authorities" ("currentness_status");
CREATE INDEX IF NOT EXISTS "legal_authorities_court_id_idx" ON "legal_authorities" ("court_id");
CREATE INDEX IF NOT EXISTS "legal_authorities_authority_state_idx" ON "legal_authorities" ("authority_state");
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.legal_authorities') IS NULL THEN
    RAISE EXCEPTION '0034: legal_authorities catalog shell missing — refuse week3 FK attach';
  END IF;
  -- Fail closed if someone pre-loaded synthetic corpus rows into this repair path.
  -- Empty shell is required; corpus data belongs on CORPUS_DATABASE_URL when enabled.
  IF (SELECT count(*)::int FROM public.legal_authorities) > 0 THEN
    RAISE NOTICE '0034: legal_authorities already has rows (pre-existing); not truncating';
  END IF;
END $$;


-- >>> begin replay of 0018_week3_legal_intelligence (idempotent)

-- Week 3 legal-intelligence and prosecution foundation.
-- Adds tables only. Does not rewrite corpus rows or existing matter data.
-- Reverse with 0018_week3_legal_intelligence.down.sql before data is relied upon.

CREATE TABLE IF NOT EXISTS "legal_standards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "authority_id" uuid,
  "issue_id" uuid,
  "rule_text" text NOT NULL,
  "standard_type" text NOT NULL,
  "elements" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "factors" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "exceptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "burdens" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "standard_of_review" text,
  "procedural_posture" text,
  "remedies" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "effective_context" text,
  "source_span" text,
  "source_page" integer,
  "source_citation" text,
  "confidence" text DEFAULT 'low' NOT NULL,
  "status" text DEFAULT 'needs_review' NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "legal_standards_grounding_chk" CHECK (status <> 'canonical' OR (authority_id IS NOT NULL AND source_span IS NOT NULL AND source_citation IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS "legal_standards_org_idx" ON "legal_standards" ("organization_id");
CREATE INDEX IF NOT EXISTS "legal_standards_authority_idx" ON "legal_standards" ("authority_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_standards_organization_fk') THEN
    ALTER TABLE "legal_standards" ADD CONSTRAINT "legal_standards_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_standards_authority_fk') THEN
    ALTER TABLE "legal_standards" ADD CONSTRAINT "legal_standards_authority_fk" FOREIGN KEY ("authority_id") REFERENCES "public"."legal_authorities"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_standards_created_by_fk') THEN
    ALTER TABLE "legal_standards" ADD CONSTRAINT "legal_standards_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "criminal_cases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid,
  "case_number" text NOT NULL,
  "jurisdiction" text NOT NULL,
  "court" text NOT NULL,
  "courthouse" text,
  "case_status" text DEFAULT 'open' NOT NULL,
  "assigned_prosecutor_id" uuid,
  "supervising_prosecutor_id" uuid,
  "investigating_agency_id" uuid,
  "priority" text DEFAULT 'normal' NOT NULL,
  "filing_date" date,
  "arrest_date" date,
  "offense_date_start" date,
  "offense_date_end" date,
  "trial_date" date,
  "sentencing_date" date,
  "closed_date" date,
  "summary" text,
  "notes" text,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "criminal_cases_org_number_uidx" ON "criminal_cases" ("organization_id", "case_number");
CREATE INDEX IF NOT EXISTS "criminal_cases_org_idx" ON "criminal_cases" ("organization_id");
CREATE INDEX IF NOT EXISTS "criminal_cases_matter_idx" ON "criminal_cases" ("matter_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'criminal_cases_organization_fk') THEN
    ALTER TABLE "criminal_cases" ADD CONSTRAINT "criminal_cases_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'criminal_cases_matter_fk') THEN
    ALTER TABLE "criminal_cases" ADD CONSTRAINT "criminal_cases_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'criminal_cases_assigned_fk') THEN
    ALTER TABLE "criminal_cases" ADD CONSTRAINT "criminal_cases_assigned_fk" FOREIGN KEY ("assigned_prosecutor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'criminal_cases_supervising_fk') THEN
    ALTER TABLE "criminal_cases" ADD CONSTRAINT "criminal_cases_supervising_fk" FOREIGN KEY ("supervising_prosecutor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'criminal_cases_created_by_fk') THEN
    ALTER TABLE "criminal_cases" ADD CONSTRAINT "criminal_cases_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'criminal_cases_updated_by_fk') THEN
    ALTER TABLE "criminal_cases" ADD CONSTRAINT "criminal_cases_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "legal_issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid,
  "criminal_case_id" uuid,
  "issue_type" text NOT NULL,
  "jurisdiction" text,
  "description" text NOT NULL,
  "related_fact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "related_evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "confidence" text DEFAULT 'low' NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "legal_issues_org_idx" ON "legal_issues" ("organization_id");
CREATE INDEX IF NOT EXISTS "legal_issues_matter_idx" ON "legal_issues" ("matter_id");
CREATE INDEX IF NOT EXISTS "legal_issues_case_idx" ON "legal_issues" ("criminal_case_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_issues_organization_fk') THEN
    ALTER TABLE "legal_issues" ADD CONSTRAINT "legal_issues_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_issues_matter_fk') THEN
    ALTER TABLE "legal_issues" ADD CONSTRAINT "legal_issues_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_issues_case_fk') THEN
    ALTER TABLE "legal_issues" ADD CONSTRAINT "legal_issues_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "legal_issue_authorities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "issue_id" uuid NOT NULL,
  "authority_id" uuid NOT NULL,
  "relation" text NOT NULL,
  "authority_status" text,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "legal_issue_authorities_edge_uidx" ON "legal_issue_authorities" ("issue_id", "authority_id", "relation");
CREATE INDEX IF NOT EXISTS "legal_issue_authorities_org_idx" ON "legal_issue_authorities" ("organization_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_issue_authorities_organization_fk') THEN
    ALTER TABLE "legal_issue_authorities" ADD CONSTRAINT "legal_issue_authorities_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_issue_authorities_issue_fk') THEN
    ALTER TABLE "legal_issue_authorities" ADD CONSTRAINT "legal_issue_authorities_issue_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."legal_issues"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_issue_authorities_authority_fk') THEN
    ALTER TABLE "legal_issue_authorities" ADD CONSTRAINT "legal_issue_authorities_authority_fk" FOREIGN KEY ("authority_id") REFERENCES "public"."legal_authorities"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "authority_treatments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "source_authority_id" uuid NOT NULL,
  "target_authority_id" uuid NOT NULL,
  "treatment" text NOT NULL,
  "evidence_span" text,
  "source_page" integer,
  "confidence" text DEFAULT 'low' NOT NULL,
  "verification_status" text DEFAULT 'unknown' NOT NULL,
  "authoritative_metadata" boolean DEFAULT false NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "authority_treatments_verified_chk" CHECK (verification_status <> 'verified' OR evidence_span IS NOT NULL OR authoritative_metadata = true)
);
CREATE INDEX IF NOT EXISTS "authority_treatments_source_idx" ON "authority_treatments" ("source_authority_id");
CREATE INDEX IF NOT EXISTS "authority_treatments_target_idx" ON "authority_treatments" ("target_authority_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'authority_treatments_organization_fk') THEN
    ALTER TABLE "authority_treatments" ADD CONSTRAINT "authority_treatments_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'authority_treatments_source_fk') THEN
    ALTER TABLE "authority_treatments" ADD CONSTRAINT "authority_treatments_source_fk" FOREIGN KEY ("source_authority_id") REFERENCES "public"."legal_authorities"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'authority_treatments_target_fk') THEN
    ALTER TABLE "authority_treatments" ADD CONSTRAINT "authority_treatments_target_fk" FOREIGN KEY ("target_authority_id") REFERENCES "public"."legal_authorities"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "authority_conflicts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "authority_a" uuid NOT NULL,
  "authority_b" uuid NOT NULL,
  "issue_id" uuid,
  "conflict_type" text NOT NULL,
  "explanation" text NOT NULL,
  "supporting_source_spans" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "confidence" text DEFAULT 'low' NOT NULL,
  "status" text DEFAULT 'needs_review' NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "authority_conflicts_org_idx" ON "authority_conflicts" ("organization_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'authority_conflicts_organization_fk') THEN
    ALTER TABLE "authority_conflicts" ADD CONSTRAINT "authority_conflicts_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'authority_conflicts_a_fk') THEN
    ALTER TABLE "authority_conflicts" ADD CONSTRAINT "authority_conflicts_a_fk" FOREIGN KEY ("authority_a") REFERENCES "public"."legal_authorities"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'authority_conflicts_b_fk') THEN
    ALTER TABLE "authority_conflicts" ADD CONSTRAINT "authority_conflicts_b_fk" FOREIGN KEY ("authority_b") REFERENCES "public"."legal_authorities"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'authority_conflicts_issue_fk') THEN
    ALTER TABLE "authority_conflicts" ADD CONSTRAINT "authority_conflicts_issue_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."legal_issues"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prosecution_agencies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" text NOT NULL,
  "agency_type" text NOT NULL,
  "jurisdiction" text,
  "contact" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "prosecution_agencies_org_idx" ON "prosecution_agencies" ("organization_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_agencies_organization_fk') THEN
    ALTER TABLE "prosecution_agencies" ADD CONSTRAINT "prosecution_agencies_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'criminal_cases_agency_fk') THEN
    ALTER TABLE "criminal_cases" ADD CONSTRAINT "criminal_cases_agency_fk" FOREIGN KEY ("investigating_agency_id") REFERENCES "public"."prosecution_agencies"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prosecution_defendants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "display_name" text NOT NULL,
  "aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "date_of_birth" date,
  "custody_status" text,
  "defense_counsel" text,
  "notes" text,
  "status" text DEFAULT 'active' NOT NULL,
  "provenance" jsonb NOT NULL,
  "privacy" jsonb DEFAULT '{"dobRestricted":true}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "prosecution_defendants_case_idx" ON "prosecution_defendants" ("criminal_case_id");
CREATE INDEX IF NOT EXISTS "prosecution_defendants_org_idx" ON "prosecution_defendants" ("organization_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_defendants_organization_fk') THEN
    ALTER TABLE "prosecution_defendants" ADD CONSTRAINT "prosecution_defendants_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_defendants_case_fk') THEN
    ALTER TABLE "prosecution_defendants" ADD CONSTRAINT "prosecution_defendants_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prosecution_officers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "agency_id" uuid NOT NULL,
  "name" text NOT NULL,
  "role" text NOT NULL,
  "badge_identifier" text,
  "report_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "interview_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "warrant_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "evidence_collected_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "testimony_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "prosecution_officers_case_idx" ON "prosecution_officers" ("criminal_case_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_officers_organization_fk') THEN
    ALTER TABLE "prosecution_officers" ADD CONSTRAINT "prosecution_officers_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_officers_case_fk') THEN
    ALTER TABLE "prosecution_officers" ADD CONSTRAINT "prosecution_officers_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_officers_agency_fk') THEN
    ALTER TABLE "prosecution_officers" ADD CONSTRAINT "prosecution_officers_agency_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."prosecution_agencies"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prosecution_charges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "defendant_id" uuid NOT NULL,
  "count_number" text NOT NULL,
  "statute_authority_id" uuid,
  "statute_citation" text,
  "offense_name" text NOT NULL,
  "offense_classification" text,
  "jurisdiction" text NOT NULL,
  "filing_date" date,
  "status" text DEFAULT 'pending' NOT NULL,
  "amendment_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "disposition_id" uuid,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "prosecution_charges_case_idx" ON "prosecution_charges" ("criminal_case_id");
CREATE UNIQUE INDEX IF NOT EXISTS "prosecution_charges_count_uidx" ON "prosecution_charges" ("criminal_case_id", "defendant_id", "count_number");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_charges_organization_fk') THEN
    ALTER TABLE "prosecution_charges" ADD CONSTRAINT "prosecution_charges_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_charges_case_fk') THEN
    ALTER TABLE "prosecution_charges" ADD CONSTRAINT "prosecution_charges_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_charges_defendant_fk') THEN
    ALTER TABLE "prosecution_charges" ADD CONSTRAINT "prosecution_charges_defendant_fk" FOREIGN KEY ("defendant_id") REFERENCES "public"."prosecution_defendants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_charges_statute_fk') THEN
    ALTER TABLE "prosecution_charges" ADD CONSTRAINT "prosecution_charges_statute_fk" FOREIGN KEY ("statute_authority_id") REFERENCES "public"."legal_authorities"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prosecution_charge_elements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "charge_id" uuid NOT NULL,
  "element_order" integer NOT NULL,
  "element_text" text NOT NULL,
  "element_type" text NOT NULL,
  "legal_standard_id" uuid,
  "supporting_evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "contrary_evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "uncertain_evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "missing_evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "related_authority_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text NOT NULL,
  "confidence" text DEFAULT 'low' NOT NULL,
  "human_review_status" text DEFAULT 'unreviewed' NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "prosecution_charge_elements_status_chk" CHECK (status in ('SUPPORTED','PARTIALLY_SUPPORTED','CONFLICTED','NO_EVIDENCE_FOUND','UNKNOWN'))
);
CREATE INDEX IF NOT EXISTS "prosecution_charge_elements_charge_idx" ON "prosecution_charge_elements" ("charge_id");
CREATE INDEX IF NOT EXISTS "prosecution_charge_elements_case_idx" ON "prosecution_charge_elements" ("criminal_case_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_charge_elements_organization_fk') THEN
    ALTER TABLE "prosecution_charge_elements" ADD CONSTRAINT "prosecution_charge_elements_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_charge_elements_case_fk') THEN
    ALTER TABLE "prosecution_charge_elements" ADD CONSTRAINT "prosecution_charge_elements_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_charge_elements_charge_fk') THEN
    ALTER TABLE "prosecution_charge_elements" ADD CONSTRAINT "prosecution_charge_elements_charge_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."prosecution_charges"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_charge_elements_standard_fk') THEN
    ALTER TABLE "prosecution_charge_elements" ADD CONSTRAINT "prosecution_charge_elements_standard_fk" FOREIGN KEY ("legal_standard_id") REFERENCES "public"."legal_standards"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prosecution_evidence_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "document_id" uuid,
  "evidence_type" text NOT NULL,
  "source_agency" text,
  "collector" text,
  "collection_date" date,
  "storage_reference" text,
  "chain_of_custody" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "related_defendant_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "related_charge_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "related_element_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "related_witness_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "sensitivity" text DEFAULT 'standard' NOT NULL,
  "review_status" text DEFAULT 'received' NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "prosecution_evidence_case_idx" ON "prosecution_evidence_items" ("criminal_case_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_evidence_items_organization_fk') THEN
    ALTER TABLE "prosecution_evidence_items" ADD CONSTRAINT "prosecution_evidence_items_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_evidence_items_case_fk') THEN
    ALTER TABLE "prosecution_evidence_items" ADD CONSTRAINT "prosecution_evidence_items_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prosecution_evidence_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "evidence_id" uuid NOT NULL,
  "relationship" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "prosecution_evidence_links_case_idx" ON "prosecution_evidence_links" ("criminal_case_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_evidence_links_organization_fk') THEN
    ALTER TABLE "prosecution_evidence_links" ADD CONSTRAINT "prosecution_evidence_links_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_evidence_links_case_fk') THEN
    ALTER TABLE "prosecution_evidence_links" ADD CONSTRAINT "prosecution_evidence_links_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_evidence_links_evidence_fk') THEN
    ALTER TABLE "prosecution_evidence_links" ADD CONSTRAINT "prosecution_evidence_links_evidence_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."prosecution_evidence_items"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prosecution_witnesses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "entity_id" uuid,
  "display_name" text NOT NULL,
  "witness_type" text NOT NULL,
  "relationship" text,
  "testimony_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "related_evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "notes" text,
  "sensitivity" text DEFAULT 'standard' NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "prosecution_witnesses_case_idx" ON "prosecution_witnesses" ("criminal_case_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_witnesses_organization_fk') THEN
    ALTER TABLE "prosecution_witnesses" ADD CONSTRAINT "prosecution_witnesses_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_witnesses_case_fk') THEN
    ALTER TABLE "prosecution_witnesses" ADD CONSTRAINT "prosecution_witnesses_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prosecution_witness_statements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "witness_id" uuid NOT NULL,
  "statement_date" date,
  "statement_type" text NOT NULL,
  "source_document_id" uuid,
  "source_span" text,
  "interviewer" text,
  "event_context" text,
  "claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "confidence" text DEFAULT 'low' NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "prosecution_witness_statements_witness_idx" ON "prosecution_witness_statements" ("witness_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_witness_statements_organization_fk') THEN
    ALTER TABLE "prosecution_witness_statements" ADD CONSTRAINT "prosecution_witness_statements_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_witness_statements_case_fk') THEN
    ALTER TABLE "prosecution_witness_statements" ADD CONSTRAINT "prosecution_witness_statements_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_witness_statements_witness_fk') THEN
    ALTER TABLE "prosecution_witness_statements" ADD CONSTRAINT "prosecution_witness_statements_witness_fk" FOREIGN KEY ("witness_id") REFERENCES "public"."prosecution_witnesses"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prosecution_discovery_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "source" text NOT NULL,
  "category" text NOT NULL,
  "received_date" date,
  "review_status" text DEFAULT 'RECEIVED' NOT NULL,
  "production_status" text DEFAULT 'RECEIVED' NOT NULL,
  "produced_date" date,
  "related_document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "related_evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "disclosure_review_status" text DEFAULT 'UNREVIEWED' NOT NULL,
  "notes" text,
  "audit_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "prosecution_discovery_case_idx" ON "prosecution_discovery_items" ("criminal_case_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_discovery_items_organization_fk') THEN
    ALTER TABLE "prosecution_discovery_items" ADD CONSTRAINT "prosecution_discovery_items_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_discovery_items_case_fk') THEN
    ALTER TABLE "prosecution_discovery_items" ADD CONSTRAINT "prosecution_discovery_items_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prosecution_disclosure_candidates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "category" text NOT NULL,
  "status" text DEFAULT 'UNREVIEWED' NOT NULL,
  "notes" text,
  "human_actor_id" uuid,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "prosecution_disclosure_case_idx" ON "prosecution_disclosure_candidates" ("criminal_case_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_disclosure_candidates_organization_fk') THEN
    ALTER TABLE "prosecution_disclosure_candidates" ADD CONSTRAINT "prosecution_disclosure_candidates_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_disclosure_candidates_case_fk') THEN
    ALTER TABLE "prosecution_disclosure_candidates" ADD CONSTRAINT "prosecution_disclosure_candidates_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_disclosure_candidates_actor_fk') THEN
    ALTER TABLE "prosecution_disclosure_candidates" ADD CONSTRAINT "prosecution_disclosure_candidates_actor_fk" FOREIGN KEY ("human_actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prosecution_procedure_issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "issue_type" text NOT NULL,
  "related_fact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "related_evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "related_authority_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "missing_facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "confidence" text DEFAULT 'low' NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "prosecution_procedure_issues_case_idx" ON "prosecution_procedure_issues" ("criminal_case_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_procedure_issues_organization_fk') THEN
    ALTER TABLE "prosecution_procedure_issues" ADD CONSTRAINT "prosecution_procedure_issues_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_procedure_issues_case_fk') THEN
    ALTER TABLE "prosecution_procedure_issues" ADD CONSTRAINT "prosecution_procedure_issues_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prosecution_warrants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "warrant_type" text NOT NULL,
  "issuing_court" text,
  "issuing_judge" text,
  "application_date" date,
  "issue_date" date,
  "execution_date" date,
  "scope" text,
  "probable_cause_facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "source_fact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "seized_evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "return_notes" text,
  "related_suppression_issue_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "prosecution_warrants_case_idx" ON "prosecution_warrants" ("criminal_case_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_warrants_organization_fk') THEN
    ALTER TABLE "prosecution_warrants" ADD CONSTRAINT "prosecution_warrants_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_warrants_case_fk') THEN
    ALTER TABLE "prosecution_warrants" ADD CONSTRAINT "prosecution_warrants_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prosecution_warrant_affidavits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "warrant_id" uuid NOT NULL,
  "affiant" text,
  "statement" text NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_warrant_affidavits_organization_fk') THEN
    ALTER TABLE "prosecution_warrant_affidavits" ADD CONSTRAINT "prosecution_warrant_affidavits_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_warrant_affidavits_warrant_fk') THEN
    ALTER TABLE "prosecution_warrant_affidavits" ADD CONSTRAINT "prosecution_warrant_affidavits_warrant_fk" FOREIGN KEY ("warrant_id") REFERENCES "public"."prosecution_warrants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prosecution_warrant_executions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "warrant_id" uuid NOT NULL,
  "executed_at" timestamp with time zone,
  "executed_by" text,
  "notes" text,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_warrant_executions_organization_fk') THEN
    ALTER TABLE "prosecution_warrant_executions" ADD CONSTRAINT "prosecution_warrant_executions_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_warrant_executions_warrant_fk') THEN
    ALTER TABLE "prosecution_warrant_executions" ADD CONSTRAINT "prosecution_warrant_executions_warrant_fk" FOREIGN KEY ("warrant_id") REFERENCES "public"."prosecution_warrants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prosecution_warrant_returns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "warrant_id" uuid NOT NULL,
  "returned_at" timestamp with time zone,
  "inventory" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_warrant_returns_organization_fk') THEN
    ALTER TABLE "prosecution_warrant_returns" ADD CONSTRAINT "prosecution_warrant_returns_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_warrant_returns_warrant_fk') THEN
    ALTER TABLE "prosecution_warrant_returns" ADD CONSTRAINT "prosecution_warrant_returns_warrant_fk" FOREIGN KEY ("warrant_id") REFERENCES "public"."prosecution_warrants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prosecution_motions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "motion_type" text NOT NULL,
  "filing_party" text NOT NULL,
  "filed_date" date,
  "issue_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "related_authority_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "response" text,
  "status" text DEFAULT 'filed' NOT NULL,
  "ruling" text,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "prosecution_motions_case_idx" ON "prosecution_motions" ("criminal_case_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_motions_organization_fk') THEN
    ALTER TABLE "prosecution_motions" ADD CONSTRAINT "prosecution_motions_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_motions_case_fk') THEN
    ALTER TABLE "prosecution_motions" ADD CONSTRAINT "prosecution_motions_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prosecution_hearings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "hearing_type" text NOT NULL,
  "date_time" timestamp with time zone,
  "court" text,
  "judge" text,
  "participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "issue_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "outcome" text,
  "generated_deadline_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "prosecution_hearings_case_idx" ON "prosecution_hearings" ("criminal_case_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_hearings_organization_fk') THEN
    ALTER TABLE "prosecution_hearings" ADD CONSTRAINT "prosecution_hearings_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_hearings_case_fk') THEN
    ALTER TABLE "prosecution_hearings" ADD CONSTRAINT "prosecution_hearings_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prosecution_subpoenas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "recipient" text NOT NULL,
  "request_scope" text NOT NULL,
  "issue_date" date,
  "service_date" date,
  "return_date" date,
  "status" text DEFAULT 'issued' NOT NULL,
  "documents_received" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "prosecution_subpoenas_case_idx" ON "prosecution_subpoenas" ("criminal_case_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_subpoenas_organization_fk') THEN
    ALTER TABLE "prosecution_subpoenas" ADD CONSTRAINT "prosecution_subpoenas_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_subpoenas_case_fk') THEN
    ALTER TABLE "prosecution_subpoenas" ADD CONSTRAINT "prosecution_subpoenas_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prosecution_plea_offers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "terms" text NOT NULL,
  "offer_date" date,
  "expiration" date,
  "status" text DEFAULT 'draft' NOT NULL,
  "history" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "human_owner_id" uuid NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "prosecution_plea_offers_case_idx" ON "prosecution_plea_offers" ("criminal_case_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_plea_offers_organization_fk') THEN
    ALTER TABLE "prosecution_plea_offers" ADD CONSTRAINT "prosecution_plea_offers_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_plea_offers_case_fk') THEN
    ALTER TABLE "prosecution_plea_offers" ADD CONSTRAINT "prosecution_plea_offers_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_plea_offers_owner_fk') THEN
    ALTER TABLE "prosecution_plea_offers" ADD CONSTRAINT "prosecution_plea_offers_owner_fk" FOREIGN KEY ("human_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prosecution_dispositions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "charge_id" uuid NOT NULL,
  "result" text NOT NULL,
  "date" date,
  "notes" text,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "prosecution_dispositions_case_idx" ON "prosecution_dispositions" ("criminal_case_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_dispositions_organization_fk') THEN
    ALTER TABLE "prosecution_dispositions" ADD CONSTRAINT "prosecution_dispositions_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_dispositions_case_fk') THEN
    ALTER TABLE "prosecution_dispositions" ADD CONSTRAINT "prosecution_dispositions_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_dispositions_charge_fk') THEN
    ALTER TABLE "prosecution_dispositions" ADD CONSTRAINT "prosecution_dispositions_charge_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."prosecution_charges"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prosecution_sentences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "charge_id" uuid NOT NULL,
  "conviction" text NOT NULL,
  "sentence_date" date,
  "sentence_terms" text NOT NULL,
  "custodial" boolean,
  "conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "notes" text,
  "source_document_id" uuid,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "prosecution_sentences_case_idx" ON "prosecution_sentences" ("criminal_case_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_sentences_organization_fk') THEN
    ALTER TABLE "prosecution_sentences" ADD CONSTRAINT "prosecution_sentences_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_sentences_case_fk') THEN
    ALTER TABLE "prosecution_sentences" ADD CONSTRAINT "prosecution_sentences_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_sentences_charge_fk') THEN
    ALTER TABLE "prosecution_sentences" ADD CONSTRAINT "prosecution_sentences_charge_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."prosecution_charges"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prosecution_timeline_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "matter_id" uuid,
  "event_type" text NOT NULL,
  "title" text NOT NULL,
  "event_date" timestamp with time zone,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "prosecution_timeline_case_idx" ON "prosecution_timeline_events" ("criminal_case_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_timeline_events_organization_fk') THEN
    ALTER TABLE "prosecution_timeline_events" ADD CONSTRAINT "prosecution_timeline_events_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_timeline_events_case_fk') THEN
    ALTER TABLE "prosecution_timeline_events" ADD CONSTRAINT "prosecution_timeline_events_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_timeline_events_matter_fk') THEN
    ALTER TABLE "prosecution_timeline_events" ADD CONSTRAINT "prosecution_timeline_events_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prosecution_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "title" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "due_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "prosecution_tasks_case_idx" ON "prosecution_tasks" ("criminal_case_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_tasks_organization_fk') THEN
    ALTER TABLE "prosecution_tasks" ADD CONSTRAINT "prosecution_tasks_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_tasks_case_fk') THEN
    ALTER TABLE "prosecution_tasks" ADD CONSTRAINT "prosecution_tasks_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prosecution_graph_nodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "node_type" text NOT NULL,
  "ref_id" text NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "prosecution_graph_nodes_ref_uidx" ON "prosecution_graph_nodes" ("criminal_case_id", "node_type", "ref_id");
CREATE INDEX IF NOT EXISTS "prosecution_graph_nodes_case_idx" ON "prosecution_graph_nodes" ("criminal_case_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_graph_nodes_organization_fk') THEN
    ALTER TABLE "prosecution_graph_nodes" ADD CONSTRAINT "prosecution_graph_nodes_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_graph_nodes_case_fk') THEN
    ALTER TABLE "prosecution_graph_nodes" ADD CONSTRAINT "prosecution_graph_nodes_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prosecution_graph_edges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "from_ref" text NOT NULL,
  "to_ref" text NOT NULL,
  "relationship" text NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "prosecution_graph_edges_case_idx" ON "prosecution_graph_edges" ("criminal_case_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_graph_edges_organization_fk') THEN
    ALTER TABLE "prosecution_graph_edges" ADD CONSTRAINT "prosecution_graph_edges_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_graph_edges_case_fk') THEN
    ALTER TABLE "prosecution_graph_edges" ADD CONSTRAINT "prosecution_graph_edges_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

-- <<< end replay of 0018_week3_legal_intelligence

--> statement-breakpoint


-- >>> begin replay of 0019_week3_case_isolation (idempotent)

-- Week 3 tenant and case relationship constraints.
-- Additive. Does not rewrite corpus rows.
-- Rejects a child row whose organization or case does not match its parent.

CREATE UNIQUE INDEX IF NOT EXISTS "criminal_cases_id_org_uidx" ON "criminal_cases" ("id", "organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "prosecution_defendants_id_case_uidx" ON "prosecution_defendants" ("id", "criminal_case_id");
CREATE UNIQUE INDEX IF NOT EXISTS "prosecution_charges_id_case_uidx" ON "prosecution_charges" ("id", "criminal_case_id");
CREATE UNIQUE INDEX IF NOT EXISTS "prosecution_evidence_items_id_case_uidx" ON "prosecution_evidence_items" ("id", "criminal_case_id");
CREATE UNIQUE INDEX IF NOT EXISTS "prosecution_witnesses_id_case_uidx" ON "prosecution_witnesses" ("id", "criminal_case_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_defendants_case_org_fk') THEN
    ALTER TABLE "prosecution_defendants" ADD CONSTRAINT "prosecution_defendants_case_org_fk" FOREIGN KEY ("criminal_case_id", "organization_id") REFERENCES "criminal_cases" ("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_charges_case_org_fk') THEN
    ALTER TABLE "prosecution_charges" ADD CONSTRAINT "prosecution_charges_case_org_fk" FOREIGN KEY ("criminal_case_id", "organization_id") REFERENCES "criminal_cases" ("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_charges_defendant_case_fk') THEN
    ALTER TABLE "prosecution_charges" ADD CONSTRAINT "prosecution_charges_defendant_case_fk" FOREIGN KEY ("defendant_id", "criminal_case_id") REFERENCES "prosecution_defendants" ("id", "criminal_case_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_charge_elements_case_org_fk') THEN
    ALTER TABLE "prosecution_charge_elements" ADD CONSTRAINT "prosecution_charge_elements_case_org_fk" FOREIGN KEY ("criminal_case_id", "organization_id") REFERENCES "criminal_cases" ("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_charge_elements_charge_case_fk') THEN
    ALTER TABLE "prosecution_charge_elements" ADD CONSTRAINT "prosecution_charge_elements_charge_case_fk" FOREIGN KEY ("charge_id", "criminal_case_id") REFERENCES "prosecution_charges" ("id", "criminal_case_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_evidence_items_case_org_fk') THEN
    ALTER TABLE "prosecution_evidence_items" ADD CONSTRAINT "prosecution_evidence_items_case_org_fk" FOREIGN KEY ("criminal_case_id", "organization_id") REFERENCES "criminal_cases" ("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_evidence_links_case_org_fk') THEN
    ALTER TABLE "prosecution_evidence_links" ADD CONSTRAINT "prosecution_evidence_links_case_org_fk" FOREIGN KEY ("criminal_case_id", "organization_id") REFERENCES "criminal_cases" ("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_evidence_links_evidence_case_fk') THEN
    ALTER TABLE "prosecution_evidence_links" ADD CONSTRAINT "prosecution_evidence_links_evidence_case_fk" FOREIGN KEY ("evidence_id", "criminal_case_id") REFERENCES "prosecution_evidence_items" ("id", "criminal_case_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_witnesses_case_org_fk') THEN
    ALTER TABLE "prosecution_witnesses" ADD CONSTRAINT "prosecution_witnesses_case_org_fk" FOREIGN KEY ("criminal_case_id", "organization_id") REFERENCES "criminal_cases" ("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_witness_statements_case_org_fk') THEN
    ALTER TABLE "prosecution_witness_statements" ADD CONSTRAINT "prosecution_witness_statements_case_org_fk" FOREIGN KEY ("criminal_case_id", "organization_id") REFERENCES "criminal_cases" ("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_witness_statements_witness_case_fk') THEN
    ALTER TABLE "prosecution_witness_statements" ADD CONSTRAINT "prosecution_witness_statements_witness_case_fk" FOREIGN KEY ("witness_id", "criminal_case_id") REFERENCES "prosecution_witnesses" ("id", "criminal_case_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_discovery_items_case_org_fk') THEN
    ALTER TABLE "prosecution_discovery_items" ADD CONSTRAINT "prosecution_discovery_items_case_org_fk" FOREIGN KEY ("criminal_case_id", "organization_id") REFERENCES "criminal_cases" ("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_disclosure_candidates_case_org_fk') THEN
    ALTER TABLE "prosecution_disclosure_candidates" ADD CONSTRAINT "prosecution_disclosure_candidates_case_org_fk" FOREIGN KEY ("criminal_case_id", "organization_id") REFERENCES "criminal_cases" ("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_procedure_issues_case_org_fk') THEN
    ALTER TABLE "prosecution_procedure_issues" ADD CONSTRAINT "prosecution_procedure_issues_case_org_fk" FOREIGN KEY ("criminal_case_id", "organization_id") REFERENCES "criminal_cases" ("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_warrants_case_org_fk') THEN
    ALTER TABLE "prosecution_warrants" ADD CONSTRAINT "prosecution_warrants_case_org_fk" FOREIGN KEY ("criminal_case_id", "organization_id") REFERENCES "criminal_cases" ("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_motions_case_org_fk') THEN
    ALTER TABLE "prosecution_motions" ADD CONSTRAINT "prosecution_motions_case_org_fk" FOREIGN KEY ("criminal_case_id", "organization_id") REFERENCES "criminal_cases" ("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_hearings_case_org_fk') THEN
    ALTER TABLE "prosecution_hearings" ADD CONSTRAINT "prosecution_hearings_case_org_fk" FOREIGN KEY ("criminal_case_id", "organization_id") REFERENCES "criminal_cases" ("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_officers_case_org_fk') THEN
    ALTER TABLE "prosecution_officers" ADD CONSTRAINT "prosecution_officers_case_org_fk" FOREIGN KEY ("criminal_case_id", "organization_id") REFERENCES "criminal_cases" ("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;

-- <<< end replay of 0019_week3_case_isolation

--> statement-breakpoint


-- >>> begin replay of 0020_civil_claims (idempotent)

-- Civil claims / defenses / counterclaims persistence.
-- Additive only. Existing matters remain valid with zero civil rows.
-- No liability / win / lose columns.
-- Reverse with 0020_civil_claims.down.sql before data is relied upon.
-- Composite matter/org FKs mirror 0019_week3_case_isolation.

-- Supporting unique indexes for composite FKs (must exist before FK creation)
CREATE UNIQUE INDEX IF NOT EXISTS "matters_id_org_uidx" ON "matters" ("id", "organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "matter_entities_id_matter_uidx" ON "matter_entities" ("id", "matter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "matter_facts_id_matter_uidx" ON "matter_facts" ("id", "matter_id");

CREATE TABLE IF NOT EXISTS "civil_pleadings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "document_id" uuid,
  "label" text NOT NULL,
  "pleading_type" text DEFAULT 'complaint' NOT NULL,
  "filed_at" timestamp with time zone,
  "is_current" boolean DEFAULT true NOT NULL,
  "superseded_by_id" uuid,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "civil_pleadings_id_matter_uidx" ON "civil_pleadings" ("id", "matter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "civil_pleadings_id_org_uidx" ON "civil_pleadings" ("id", "organization_id");
CREATE INDEX IF NOT EXISTS "civil_pleadings_org_matter_idx" ON "civil_pleadings" ("organization_id", "matter_id");
CREATE INDEX IF NOT EXISTS "civil_pleadings_matter_current_idx" ON "civil_pleadings" ("matter_id", "is_current");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_pleadings_organization_fk') THEN
    ALTER TABLE "civil_pleadings" ADD CONSTRAINT "civil_pleadings_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_pleadings_matter_fk') THEN
    ALTER TABLE "civil_pleadings" ADD CONSTRAINT "civil_pleadings_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_pleadings_document_fk') THEN
    ALTER TABLE "civil_pleadings" ADD CONSTRAINT "civil_pleadings_document_fk" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_pleadings_created_by_fk') THEN
    ALTER TABLE "civil_pleadings" ADD CONSTRAINT "civil_pleadings_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_pleadings_updated_by_fk') THEN
    ALTER TABLE "civil_pleadings" ADD CONSTRAINT "civil_pleadings_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_pleadings_superseded_by_fk') THEN
    ALTER TABLE "civil_pleadings" ADD CONSTRAINT "civil_pleadings_superseded_by_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "civil_pleadings"("id") ON DELETE set null;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "civil_claims" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "pleading_id" uuid,
  "kind" text NOT NULL,
  "category" text DEFAULT 'OTHER' NOT NULL,
  "label" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "support_status" text DEFAULT 'UNKNOWN' NOT NULL,
  "procedural_status" text DEFAULT 'PLED' NOT NULL,
  "is_current" boolean DEFAULT true NOT NULL,
  "superseded_by_id" uuid,
  "damages_or_remedy" jsonb,
  "uncertainty" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "civil_claims_support_status_chk" CHECK ("support_status" IN ('SUPPORTED','PARTIALLY_SUPPORTED','CONFLICTED','NO_EVIDENCE_FOUND','UNKNOWN')),
  CONSTRAINT "civil_claims_no_liability_chk" CHECK ("support_status" NOT IN ('WIN','LOSE','LIABLE','NOT_LIABLE','LIKELY_WIN'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "civil_claims_id_matter_uidx" ON "civil_claims" ("id", "matter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "civil_claims_id_org_uidx" ON "civil_claims" ("id", "organization_id");
CREATE INDEX IF NOT EXISTS "civil_claims_org_matter_idx" ON "civil_claims" ("organization_id", "matter_id");
CREATE INDEX IF NOT EXISTS "civil_claims_matter_current_idx" ON "civil_claims" ("matter_id", "is_current");
CREATE INDEX IF NOT EXISTS "civil_claims_pleading_idx" ON "civil_claims" ("pleading_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_claims_organization_fk') THEN
    ALTER TABLE "civil_claims" ADD CONSTRAINT "civil_claims_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_claims_matter_fk') THEN
    ALTER TABLE "civil_claims" ADD CONSTRAINT "civil_claims_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_claims_pleading_fk') THEN
    ALTER TABLE "civil_claims" ADD CONSTRAINT "civil_claims_pleading_fk" FOREIGN KEY ("pleading_id") REFERENCES "civil_pleadings"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_claims_created_by_fk') THEN
    ALTER TABLE "civil_claims" ADD CONSTRAINT "civil_claims_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_claims_updated_by_fk') THEN
    ALTER TABLE "civil_claims" ADD CONSTRAINT "civil_claims_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_claims_superseded_by_fk') THEN
    ALTER TABLE "civil_claims" ADD CONSTRAINT "civil_claims_superseded_by_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "civil_claims"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_claims_matter_org_fk') THEN
    ALTER TABLE "civil_claims" ADD CONSTRAINT "civil_claims_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "civil_claim_parties" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "claim_id" uuid NOT NULL,
  "party_entity_id" uuid NOT NULL,
  "role" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "civil_claim_parties_role_chk" CHECK ("role" IN ('PLAINTIFF','DEFENDANT','COUNTERCLAIMANT','COUNTERCLAIM_DEFENDANT','THIRD_PARTY_PLAINTIFF','THIRD_PARTY_DEFENDANT','OTHER'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "civil_claim_parties_edge_uidx" ON "civil_claim_parties" ("claim_id", "party_entity_id", "role");
CREATE INDEX IF NOT EXISTS "civil_claim_parties_claim_idx" ON "civil_claim_parties" ("claim_id");
CREATE INDEX IF NOT EXISTS "civil_claim_parties_party_idx" ON "civil_claim_parties" ("party_entity_id");
CREATE INDEX IF NOT EXISTS "civil_claim_parties_org_matter_idx" ON "civil_claim_parties" ("organization_id", "matter_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_claim_parties_organization_fk') THEN
    ALTER TABLE "civil_claim_parties" ADD CONSTRAINT "civil_claim_parties_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_claim_parties_matter_fk') THEN
    ALTER TABLE "civil_claim_parties" ADD CONSTRAINT "civil_claim_parties_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_claim_parties_claim_fk') THEN
    ALTER TABLE "civil_claim_parties" ADD CONSTRAINT "civil_claim_parties_claim_fk" FOREIGN KEY ("claim_id") REFERENCES "civil_claims"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_claim_parties_entity_fk') THEN
    ALTER TABLE "civil_claim_parties" ADD CONSTRAINT "civil_claim_parties_entity_fk" FOREIGN KEY ("party_entity_id") REFERENCES "matter_entities"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_claim_parties_claim_matter_fk') THEN
    ALTER TABLE "civil_claim_parties" ADD CONSTRAINT "civil_claim_parties_claim_matter_fk" FOREIGN KEY ("claim_id", "matter_id") REFERENCES "civil_claims"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_claim_parties_entity_matter_fk') THEN
    ALTER TABLE "civil_claim_parties" ADD CONSTRAINT "civil_claim_parties_entity_matter_fk" FOREIGN KEY ("party_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "civil_defenses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "pleading_id" uuid,
  "kind" text NOT NULL,
  "label" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "support_status" text DEFAULT 'UNKNOWN' NOT NULL,
  "procedural_status" text DEFAULT 'PLED' NOT NULL,
  "is_current" boolean DEFAULT true NOT NULL,
  "superseded_by_id" uuid,
  "uncertainty" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "civil_defenses_support_status_chk" CHECK ("support_status" IN ('SUPPORTED','PARTIALLY_SUPPORTED','CONFLICTED','NO_EVIDENCE_FOUND','UNKNOWN'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "civil_defenses_id_matter_uidx" ON "civil_defenses" ("id", "matter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "civil_defenses_id_org_uidx" ON "civil_defenses" ("id", "organization_id");
CREATE INDEX IF NOT EXISTS "civil_defenses_org_matter_idx" ON "civil_defenses" ("organization_id", "matter_id");
CREATE INDEX IF NOT EXISTS "civil_defenses_matter_current_idx" ON "civil_defenses" ("matter_id", "is_current");
CREATE INDEX IF NOT EXISTS "civil_defenses_pleading_idx" ON "civil_defenses" ("pleading_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_defenses_organization_fk') THEN
    ALTER TABLE "civil_defenses" ADD CONSTRAINT "civil_defenses_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_defenses_matter_fk') THEN
    ALTER TABLE "civil_defenses" ADD CONSTRAINT "civil_defenses_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_defenses_pleading_fk') THEN
    ALTER TABLE "civil_defenses" ADD CONSTRAINT "civil_defenses_pleading_fk" FOREIGN KEY ("pleading_id") REFERENCES "civil_pleadings"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_defenses_created_by_fk') THEN
    ALTER TABLE "civil_defenses" ADD CONSTRAINT "civil_defenses_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_defenses_updated_by_fk') THEN
    ALTER TABLE "civil_defenses" ADD CONSTRAINT "civil_defenses_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_defenses_superseded_by_fk') THEN
    ALTER TABLE "civil_defenses" ADD CONSTRAINT "civil_defenses_superseded_by_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "civil_defenses"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_defenses_matter_org_fk') THEN
    ALTER TABLE "civil_defenses" ADD CONSTRAINT "civil_defenses_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "civil_defense_claim_relations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "defense_id" uuid NOT NULL,
  "claim_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "civil_defense_claim_relations_uidx" ON "civil_defense_claim_relations" ("defense_id", "claim_id");
CREATE INDEX IF NOT EXISTS "civil_defense_claim_relations_defense_idx" ON "civil_defense_claim_relations" ("defense_id");
CREATE INDEX IF NOT EXISTS "civil_defense_claim_relations_claim_idx" ON "civil_defense_claim_relations" ("claim_id");
CREATE INDEX IF NOT EXISTS "civil_defense_claim_relations_org_matter_idx" ON "civil_defense_claim_relations" ("organization_id", "matter_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_defense_claim_relations_organization_fk') THEN
    ALTER TABLE "civil_defense_claim_relations" ADD CONSTRAINT "civil_defense_claim_relations_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_defense_claim_relations_matter_fk') THEN
    ALTER TABLE "civil_defense_claim_relations" ADD CONSTRAINT "civil_defense_claim_relations_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_defense_claim_relations_defense_fk') THEN
    ALTER TABLE "civil_defense_claim_relations" ADD CONSTRAINT "civil_defense_claim_relations_defense_fk" FOREIGN KEY ("defense_id") REFERENCES "civil_defenses"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_defense_claim_relations_claim_fk') THEN
    ALTER TABLE "civil_defense_claim_relations" ADD CONSTRAINT "civil_defense_claim_relations_claim_fk" FOREIGN KEY ("claim_id") REFERENCES "civil_claims"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_defense_claim_relations_defense_matter_fk') THEN
    ALTER TABLE "civil_defense_claim_relations" ADD CONSTRAINT "civil_defense_claim_relations_defense_matter_fk" FOREIGN KEY ("defense_id", "matter_id") REFERENCES "civil_defenses"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_defense_claim_relations_claim_matter_fk') THEN
    ALTER TABLE "civil_defense_claim_relations" ADD CONSTRAINT "civil_defense_claim_relations_claim_matter_fk" FOREIGN KEY ("claim_id", "matter_id") REFERENCES "civil_claims"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "civil_defense_parties" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "defense_id" uuid NOT NULL,
  "party_entity_id" uuid NOT NULL,
  "role" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "civil_defense_parties_role_chk" CHECK ("role" IN ('ASSERTING','TARGET'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "civil_defense_parties_edge_uidx" ON "civil_defense_parties" ("defense_id", "party_entity_id", "role");
CREATE INDEX IF NOT EXISTS "civil_defense_parties_defense_idx" ON "civil_defense_parties" ("defense_id");
CREATE INDEX IF NOT EXISTS "civil_defense_parties_party_idx" ON "civil_defense_parties" ("party_entity_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_defense_parties_organization_fk') THEN
    ALTER TABLE "civil_defense_parties" ADD CONSTRAINT "civil_defense_parties_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_defense_parties_matter_fk') THEN
    ALTER TABLE "civil_defense_parties" ADD CONSTRAINT "civil_defense_parties_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_defense_parties_defense_fk') THEN
    ALTER TABLE "civil_defense_parties" ADD CONSTRAINT "civil_defense_parties_defense_fk" FOREIGN KEY ("defense_id") REFERENCES "civil_defenses"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_defense_parties_entity_fk') THEN
    ALTER TABLE "civil_defense_parties" ADD CONSTRAINT "civil_defense_parties_entity_fk" FOREIGN KEY ("party_entity_id") REFERENCES "matter_entities"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_defense_parties_defense_matter_fk') THEN
    ALTER TABLE "civil_defense_parties" ADD CONSTRAINT "civil_defense_parties_defense_matter_fk" FOREIGN KEY ("defense_id", "matter_id") REFERENCES "civil_defenses"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_defense_parties_entity_matter_fk') THEN
    ALTER TABLE "civil_defense_parties" ADD CONSTRAINT "civil_defense_parties_entity_matter_fk" FOREIGN KEY ("party_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "civil_claim_elements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "claim_id" uuid,
  "defense_id" uuid,
  "label" text NOT NULL,
  "requirement_text" text,
  "status" text DEFAULT 'UNKNOWN' NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "uncertainty" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "civil_claim_elements_parent_xor_chk" CHECK (
    ("claim_id" IS NOT NULL AND "defense_id" IS NULL) OR ("claim_id" IS NULL AND "defense_id" IS NOT NULL)
  ),
  CONSTRAINT "civil_claim_elements_status_chk" CHECK ("status" IN ('SUPPORTED','PARTIALLY_SUPPORTED','CONFLICTED','NO_EVIDENCE_FOUND','UNKNOWN'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "civil_claim_elements_id_matter_uidx" ON "civil_claim_elements" ("id", "matter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "civil_claim_elements_id_org_uidx" ON "civil_claim_elements" ("id", "organization_id");
CREATE INDEX IF NOT EXISTS "civil_claim_elements_claim_idx" ON "civil_claim_elements" ("claim_id");
CREATE INDEX IF NOT EXISTS "civil_claim_elements_defense_idx" ON "civil_claim_elements" ("defense_id");
CREATE INDEX IF NOT EXISTS "civil_claim_elements_org_matter_idx" ON "civil_claim_elements" ("organization_id", "matter_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_claim_elements_organization_fk') THEN
    ALTER TABLE "civil_claim_elements" ADD CONSTRAINT "civil_claim_elements_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_claim_elements_matter_fk') THEN
    ALTER TABLE "civil_claim_elements" ADD CONSTRAINT "civil_claim_elements_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_claim_elements_claim_fk') THEN
    ALTER TABLE "civil_claim_elements" ADD CONSTRAINT "civil_claim_elements_claim_fk" FOREIGN KEY ("claim_id") REFERENCES "civil_claims"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_claim_elements_defense_fk') THEN
    ALTER TABLE "civil_claim_elements" ADD CONSTRAINT "civil_claim_elements_defense_fk" FOREIGN KEY ("defense_id") REFERENCES "civil_defenses"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_claim_elements_created_by_fk') THEN
    ALTER TABLE "civil_claim_elements" ADD CONSTRAINT "civil_claim_elements_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_claim_elements_updated_by_fk') THEN
    ALTER TABLE "civil_claim_elements" ADD CONSTRAINT "civil_claim_elements_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_claim_elements_claim_matter_fk') THEN
    ALTER TABLE "civil_claim_elements" ADD CONSTRAINT "civil_claim_elements_claim_matter_fk" FOREIGN KEY ("claim_id", "matter_id") REFERENCES "civil_claims"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_claim_elements_defense_matter_fk') THEN
    ALTER TABLE "civil_claim_elements" ADD CONSTRAINT "civil_claim_elements_defense_matter_fk" FOREIGN KEY ("defense_id", "matter_id") REFERENCES "civil_defenses"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "civil_evidence_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "document_id" uuid,
  "label" text NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "civil_evidence_items_id_matter_uidx" ON "civil_evidence_items" ("id", "matter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "civil_evidence_items_id_org_uidx" ON "civil_evidence_items" ("id", "organization_id");
CREATE INDEX IF NOT EXISTS "civil_evidence_items_org_matter_idx" ON "civil_evidence_items" ("organization_id", "matter_id");
CREATE INDEX IF NOT EXISTS "civil_evidence_items_document_idx" ON "civil_evidence_items" ("document_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_evidence_items_organization_fk') THEN
    ALTER TABLE "civil_evidence_items" ADD CONSTRAINT "civil_evidence_items_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_evidence_items_matter_fk') THEN
    ALTER TABLE "civil_evidence_items" ADD CONSTRAINT "civil_evidence_items_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_evidence_items_document_fk') THEN
    ALTER TABLE "civil_evidence_items" ADD CONSTRAINT "civil_evidence_items_document_fk" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_evidence_items_created_by_fk') THEN
    ALTER TABLE "civil_evidence_items" ADD CONSTRAINT "civil_evidence_items_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_evidence_items_updated_by_fk') THEN
    ALTER TABLE "civil_evidence_items" ADD CONSTRAINT "civil_evidence_items_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_evidence_items_matter_org_fk') THEN
    ALTER TABLE "civil_evidence_items" ADD CONSTRAINT "civil_evidence_items_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "civil_evidence_relations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "claim_id" uuid,
  "element_id" uuid,
  "defense_id" uuid,
  "evidence_id" uuid,
  "role" text NOT NULL,
  "party_entity_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "note" text,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "civil_evidence_relations_target_xor_chk" CHECK (
    ("claim_id" IS NOT NULL AND "element_id" IS NULL AND "defense_id" IS NULL) OR
    ("claim_id" IS NULL AND "element_id" IS NOT NULL AND "defense_id" IS NULL) OR
    ("claim_id" IS NULL AND "element_id" IS NULL AND "defense_id" IS NOT NULL)
  ),
  CONSTRAINT "civil_evidence_relations_role_chk" CHECK ("role" IN ('SUPPORTS','UNDERMINES','CONTRADICTS','CORROBORATES','RELATED_TO','MISSING_EXPECTED')),
  CONSTRAINT "civil_evidence_relations_missing_chk" CHECK (
    ("role" = 'MISSING_EXPECTED' AND "note" IS NOT NULL) OR
    ("role" <> 'MISSING_EXPECTED' AND "evidence_id" IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS "civil_evidence_relations_claim_idx" ON "civil_evidence_relations" ("claim_id");
CREATE INDEX IF NOT EXISTS "civil_evidence_relations_element_idx" ON "civil_evidence_relations" ("element_id");
CREATE INDEX IF NOT EXISTS "civil_evidence_relations_defense_idx" ON "civil_evidence_relations" ("defense_id");
CREATE INDEX IF NOT EXISTS "civil_evidence_relations_evidence_idx" ON "civil_evidence_relations" ("evidence_id");
CREATE INDEX IF NOT EXISTS "civil_evidence_relations_org_matter_idx" ON "civil_evidence_relations" ("organization_id", "matter_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_evidence_relations_organization_fk') THEN
    ALTER TABLE "civil_evidence_relations" ADD CONSTRAINT "civil_evidence_relations_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_evidence_relations_matter_fk') THEN
    ALTER TABLE "civil_evidence_relations" ADD CONSTRAINT "civil_evidence_relations_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_evidence_relations_claim_fk') THEN
    ALTER TABLE "civil_evidence_relations" ADD CONSTRAINT "civil_evidence_relations_claim_fk" FOREIGN KEY ("claim_id") REFERENCES "civil_claims"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_evidence_relations_element_fk') THEN
    ALTER TABLE "civil_evidence_relations" ADD CONSTRAINT "civil_evidence_relations_element_fk" FOREIGN KEY ("element_id") REFERENCES "civil_claim_elements"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_evidence_relations_defense_fk') THEN
    ALTER TABLE "civil_evidence_relations" ADD CONSTRAINT "civil_evidence_relations_defense_fk" FOREIGN KEY ("defense_id") REFERENCES "civil_defenses"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_evidence_relations_evidence_fk') THEN
    ALTER TABLE "civil_evidence_relations" ADD CONSTRAINT "civil_evidence_relations_evidence_fk" FOREIGN KEY ("evidence_id") REFERENCES "civil_evidence_items"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_evidence_relations_claim_matter_fk') THEN
    ALTER TABLE "civil_evidence_relations" ADD CONSTRAINT "civil_evidence_relations_claim_matter_fk" FOREIGN KEY ("claim_id", "matter_id") REFERENCES "civil_claims"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_evidence_relations_element_matter_fk') THEN
    ALTER TABLE "civil_evidence_relations" ADD CONSTRAINT "civil_evidence_relations_element_matter_fk" FOREIGN KEY ("element_id", "matter_id") REFERENCES "civil_claim_elements"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_evidence_relations_defense_matter_fk') THEN
    ALTER TABLE "civil_evidence_relations" ADD CONSTRAINT "civil_evidence_relations_defense_matter_fk" FOREIGN KEY ("defense_id", "matter_id") REFERENCES "civil_defenses"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_evidence_relations_evidence_matter_fk') THEN
    ALTER TABLE "civil_evidence_relations" ADD CONSTRAINT "civil_evidence_relations_evidence_matter_fk" FOREIGN KEY ("evidence_id", "matter_id") REFERENCES "civil_evidence_items"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "civil_fact_relations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "claim_id" uuid,
  "element_id" uuid,
  "defense_id" uuid,
  "fact_id" uuid NOT NULL,
  "role" text NOT NULL,
  "party_entity_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "note" text,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "civil_fact_relations_target_xor_chk" CHECK (
    ("claim_id" IS NOT NULL AND "element_id" IS NULL AND "defense_id" IS NULL) OR
    ("claim_id" IS NULL AND "element_id" IS NOT NULL AND "defense_id" IS NULL) OR
    ("claim_id" IS NULL AND "element_id" IS NULL AND "defense_id" IS NOT NULL)
  ),
  CONSTRAINT "civil_fact_relations_role_chk" CHECK ("role" IN ('SUPPORTS','UNDERMINES','CONTRADICTS','CORROBORATES','RELATED_TO','MISSING_EXPECTED'))
);
CREATE INDEX IF NOT EXISTS "civil_fact_relations_claim_idx" ON "civil_fact_relations" ("claim_id");
CREATE INDEX IF NOT EXISTS "civil_fact_relations_element_idx" ON "civil_fact_relations" ("element_id");
CREATE INDEX IF NOT EXISTS "civil_fact_relations_defense_idx" ON "civil_fact_relations" ("defense_id");
CREATE INDEX IF NOT EXISTS "civil_fact_relations_fact_idx" ON "civil_fact_relations" ("fact_id");
CREATE INDEX IF NOT EXISTS "civil_fact_relations_org_matter_idx" ON "civil_fact_relations" ("organization_id", "matter_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_fact_relations_organization_fk') THEN
    ALTER TABLE "civil_fact_relations" ADD CONSTRAINT "civil_fact_relations_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_fact_relations_matter_fk') THEN
    ALTER TABLE "civil_fact_relations" ADD CONSTRAINT "civil_fact_relations_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_fact_relations_claim_fk') THEN
    ALTER TABLE "civil_fact_relations" ADD CONSTRAINT "civil_fact_relations_claim_fk" FOREIGN KEY ("claim_id") REFERENCES "civil_claims"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_fact_relations_element_fk') THEN
    ALTER TABLE "civil_fact_relations" ADD CONSTRAINT "civil_fact_relations_element_fk" FOREIGN KEY ("element_id") REFERENCES "civil_claim_elements"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_fact_relations_defense_fk') THEN
    ALTER TABLE "civil_fact_relations" ADD CONSTRAINT "civil_fact_relations_defense_fk" FOREIGN KEY ("defense_id") REFERENCES "civil_defenses"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_fact_relations_fact_fk') THEN
    ALTER TABLE "civil_fact_relations" ADD CONSTRAINT "civil_fact_relations_fact_fk" FOREIGN KEY ("fact_id") REFERENCES "matter_facts"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_fact_relations_claim_matter_fk') THEN
    ALTER TABLE "civil_fact_relations" ADD CONSTRAINT "civil_fact_relations_claim_matter_fk" FOREIGN KEY ("claim_id", "matter_id") REFERENCES "civil_claims"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_fact_relations_element_matter_fk') THEN
    ALTER TABLE "civil_fact_relations" ADD CONSTRAINT "civil_fact_relations_element_matter_fk" FOREIGN KEY ("element_id", "matter_id") REFERENCES "civil_claim_elements"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_fact_relations_defense_matter_fk') THEN
    ALTER TABLE "civil_fact_relations" ADD CONSTRAINT "civil_fact_relations_defense_matter_fk" FOREIGN KEY ("defense_id", "matter_id") REFERENCES "civil_defenses"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_fact_relations_fact_matter_fk') THEN
    ALTER TABLE "civil_fact_relations" ADD CONSTRAINT "civil_fact_relations_fact_matter_fk" FOREIGN KEY ("fact_id", "matter_id") REFERENCES "matter_facts"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "civil_legal_issue_relations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "claim_id" uuid,
  "element_id" uuid,
  "defense_id" uuid,
  "legal_issue_id" uuid NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "civil_legal_issue_relations_target_xor_chk" CHECK (
    ("claim_id" IS NOT NULL AND "element_id" IS NULL AND "defense_id" IS NULL) OR
    ("claim_id" IS NULL AND "element_id" IS NOT NULL AND "defense_id" IS NULL) OR
    ("claim_id" IS NULL AND "element_id" IS NULL AND "defense_id" IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS "civil_legal_issue_relations_claim_idx" ON "civil_legal_issue_relations" ("claim_id");
CREATE INDEX IF NOT EXISTS "civil_legal_issue_relations_element_idx" ON "civil_legal_issue_relations" ("element_id");
CREATE INDEX IF NOT EXISTS "civil_legal_issue_relations_defense_idx" ON "civil_legal_issue_relations" ("defense_id");
CREATE INDEX IF NOT EXISTS "civil_legal_issue_relations_issue_idx" ON "civil_legal_issue_relations" ("legal_issue_id");
CREATE INDEX IF NOT EXISTS "civil_legal_issue_relations_org_matter_idx" ON "civil_legal_issue_relations" ("organization_id", "matter_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_legal_issue_relations_organization_fk') THEN
    ALTER TABLE "civil_legal_issue_relations" ADD CONSTRAINT "civil_legal_issue_relations_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_legal_issue_relations_matter_fk') THEN
    ALTER TABLE "civil_legal_issue_relations" ADD CONSTRAINT "civil_legal_issue_relations_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_legal_issue_relations_claim_fk') THEN
    ALTER TABLE "civil_legal_issue_relations" ADD CONSTRAINT "civil_legal_issue_relations_claim_fk" FOREIGN KEY ("claim_id") REFERENCES "civil_claims"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_legal_issue_relations_element_fk') THEN
    ALTER TABLE "civil_legal_issue_relations" ADD CONSTRAINT "civil_legal_issue_relations_element_fk" FOREIGN KEY ("element_id") REFERENCES "civil_claim_elements"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_legal_issue_relations_defense_fk') THEN
    ALTER TABLE "civil_legal_issue_relations" ADD CONSTRAINT "civil_legal_issue_relations_defense_fk" FOREIGN KEY ("defense_id") REFERENCES "civil_defenses"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_legal_issue_relations_issue_fk') THEN
    ALTER TABLE "civil_legal_issue_relations" ADD CONSTRAINT "civil_legal_issue_relations_issue_fk" FOREIGN KEY ("legal_issue_id") REFERENCES "legal_issues"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_legal_issue_relations_claim_matter_fk') THEN
    ALTER TABLE "civil_legal_issue_relations" ADD CONSTRAINT "civil_legal_issue_relations_claim_matter_fk" FOREIGN KEY ("claim_id", "matter_id") REFERENCES "civil_claims"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_legal_issue_relations_element_matter_fk') THEN
    ALTER TABLE "civil_legal_issue_relations" ADD CONSTRAINT "civil_legal_issue_relations_element_matter_fk" FOREIGN KEY ("element_id", "matter_id") REFERENCES "civil_claim_elements"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_legal_issue_relations_defense_matter_fk') THEN
    ALTER TABLE "civil_legal_issue_relations" ADD CONSTRAINT "civil_legal_issue_relations_defense_matter_fk" FOREIGN KEY ("defense_id", "matter_id") REFERENCES "civil_defenses"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "civil_authority_relations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "claim_id" uuid,
  "element_id" uuid,
  "defense_id" uuid,
  "legal_issue_id" uuid,
  "authority_id" uuid NOT NULL,
  "relation" text NOT NULL,
  "proposition" text,
  "source_span" text,
  "source_supported" boolean DEFAULT false NOT NULL,
  "treatment" text DEFAULT 'UNVERIFIED' NOT NULL,
  "currentness" text DEFAULT 'unknown' NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "civil_authority_relations_target_xor_chk" CHECK (
    ("claim_id" IS NOT NULL AND "element_id" IS NULL AND "defense_id" IS NULL AND "legal_issue_id" IS NULL) OR
    ("claim_id" IS NULL AND "element_id" IS NOT NULL AND "defense_id" IS NULL AND "legal_issue_id" IS NULL) OR
    ("claim_id" IS NULL AND "element_id" IS NULL AND "defense_id" IS NOT NULL AND "legal_issue_id" IS NULL) OR
    ("claim_id" IS NULL AND "element_id" IS NULL AND "defense_id" IS NULL AND "legal_issue_id" IS NOT NULL)
  ),
  CONSTRAINT "civil_authority_relations_relation_chk" CHECK ("relation" IN ('BINDING','PERSUASIVE','CONTRARY','DISTINGUISHABLE'))
);
CREATE INDEX IF NOT EXISTS "civil_authority_relations_claim_idx" ON "civil_authority_relations" ("claim_id");
CREATE INDEX IF NOT EXISTS "civil_authority_relations_element_idx" ON "civil_authority_relations" ("element_id");
CREATE INDEX IF NOT EXISTS "civil_authority_relations_defense_idx" ON "civil_authority_relations" ("defense_id");
CREATE INDEX IF NOT EXISTS "civil_authority_relations_issue_idx" ON "civil_authority_relations" ("legal_issue_id");
CREATE INDEX IF NOT EXISTS "civil_authority_relations_authority_idx" ON "civil_authority_relations" ("authority_id");
CREATE INDEX IF NOT EXISTS "civil_authority_relations_org_matter_idx" ON "civil_authority_relations" ("organization_id", "matter_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_authority_relations_organization_fk') THEN
    ALTER TABLE "civil_authority_relations" ADD CONSTRAINT "civil_authority_relations_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_authority_relations_matter_fk') THEN
    ALTER TABLE "civil_authority_relations" ADD CONSTRAINT "civil_authority_relations_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_authority_relations_claim_fk') THEN
    ALTER TABLE "civil_authority_relations" ADD CONSTRAINT "civil_authority_relations_claim_fk" FOREIGN KEY ("claim_id") REFERENCES "civil_claims"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_authority_relations_element_fk') THEN
    ALTER TABLE "civil_authority_relations" ADD CONSTRAINT "civil_authority_relations_element_fk" FOREIGN KEY ("element_id") REFERENCES "civil_claim_elements"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_authority_relations_defense_fk') THEN
    ALTER TABLE "civil_authority_relations" ADD CONSTRAINT "civil_authority_relations_defense_fk" FOREIGN KEY ("defense_id") REFERENCES "civil_defenses"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_authority_relations_issue_fk') THEN
    ALTER TABLE "civil_authority_relations" ADD CONSTRAINT "civil_authority_relations_issue_fk" FOREIGN KEY ("legal_issue_id") REFERENCES "legal_issues"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_authority_relations_authority_fk') THEN
    ALTER TABLE "civil_authority_relations" ADD CONSTRAINT "civil_authority_relations_authority_fk" FOREIGN KEY ("authority_id") REFERENCES "legal_authorities"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_authority_relations_claim_matter_fk') THEN
    ALTER TABLE "civil_authority_relations" ADD CONSTRAINT "civil_authority_relations_claim_matter_fk" FOREIGN KEY ("claim_id", "matter_id") REFERENCES "civil_claims"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_authority_relations_element_matter_fk') THEN
    ALTER TABLE "civil_authority_relations" ADD CONSTRAINT "civil_authority_relations_element_matter_fk" FOREIGN KEY ("element_id", "matter_id") REFERENCES "civil_claim_elements"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_authority_relations_defense_matter_fk') THEN
    ALTER TABLE "civil_authority_relations" ADD CONSTRAINT "civil_authority_relations_defense_matter_fk" FOREIGN KEY ("defense_id", "matter_id") REFERENCES "civil_defenses"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "civil_standard_relations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "claim_id" uuid,
  "element_id" uuid,
  "defense_id" uuid,
  "standard_id" uuid NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "civil_standard_relations_target_xor_chk" CHECK (
    ("claim_id" IS NOT NULL AND "element_id" IS NULL AND "defense_id" IS NULL) OR
    ("claim_id" IS NULL AND "element_id" IS NOT NULL AND "defense_id" IS NULL) OR
    ("claim_id" IS NULL AND "element_id" IS NULL AND "defense_id" IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS "civil_standard_relations_claim_idx" ON "civil_standard_relations" ("claim_id");
CREATE INDEX IF NOT EXISTS "civil_standard_relations_element_idx" ON "civil_standard_relations" ("element_id");
CREATE INDEX IF NOT EXISTS "civil_standard_relations_defense_idx" ON "civil_standard_relations" ("defense_id");
CREATE INDEX IF NOT EXISTS "civil_standard_relations_standard_idx" ON "civil_standard_relations" ("standard_id");
CREATE INDEX IF NOT EXISTS "civil_standard_relations_org_matter_idx" ON "civil_standard_relations" ("organization_id", "matter_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_standard_relations_organization_fk') THEN
    ALTER TABLE "civil_standard_relations" ADD CONSTRAINT "civil_standard_relations_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_standard_relations_matter_fk') THEN
    ALTER TABLE "civil_standard_relations" ADD CONSTRAINT "civil_standard_relations_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_standard_relations_claim_fk') THEN
    ALTER TABLE "civil_standard_relations" ADD CONSTRAINT "civil_standard_relations_claim_fk" FOREIGN KEY ("claim_id") REFERENCES "civil_claims"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_standard_relations_element_fk') THEN
    ALTER TABLE "civil_standard_relations" ADD CONSTRAINT "civil_standard_relations_element_fk" FOREIGN KEY ("element_id") REFERENCES "civil_claim_elements"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_standard_relations_defense_fk') THEN
    ALTER TABLE "civil_standard_relations" ADD CONSTRAINT "civil_standard_relations_defense_fk" FOREIGN KEY ("defense_id") REFERENCES "civil_defenses"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_standard_relations_standard_fk') THEN
    ALTER TABLE "civil_standard_relations" ADD CONSTRAINT "civil_standard_relations_standard_fk" FOREIGN KEY ("standard_id") REFERENCES "legal_standards"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_standard_relations_claim_matter_fk') THEN
    ALTER TABLE "civil_standard_relations" ADD CONSTRAINT "civil_standard_relations_claim_matter_fk" FOREIGN KEY ("claim_id", "matter_id") REFERENCES "civil_claims"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_standard_relations_element_matter_fk') THEN
    ALTER TABLE "civil_standard_relations" ADD CONSTRAINT "civil_standard_relations_element_matter_fk" FOREIGN KEY ("element_id", "matter_id") REFERENCES "civil_claim_elements"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_standard_relations_defense_matter_fk') THEN
    ALTER TABLE "civil_standard_relations" ADD CONSTRAINT "civil_standard_relations_defense_matter_fk" FOREIGN KEY ("defense_id", "matter_id") REFERENCES "civil_defenses"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;

-- <<< end replay of 0020_civil_claims

--> statement-breakpoint


-- >>> begin replay of 0021_graph_claim_defense_node_types (idempotent)

-- Additive graph_node_type values for Deepening Pass 3 civil graph enablement.
-- Enables 'claim' and 'defense' on shared matter graph_nodes only.
-- Does not rewrite existing graph rows or recreate the enum/table.
-- Does not apply to production Neon in this workstream.

ALTER TYPE "public"."graph_node_type" ADD VALUE IF NOT EXISTS 'claim';
ALTER TYPE "public"."graph_node_type" ADD VALUE IF NOT EXISTS 'defense';

-- <<< end replay of 0021_graph_claim_defense_node_types

--> statement-breakpoint


-- >>> begin replay of 0022_discovery_production_ledger (idempotent)

-- Discovery / Production ledger + minimal discovery graph_node_type values.
-- Additive only. Existing matters remain valid with zero discovery rows.
-- No sanctions / privilege legal-conclusion columns.
-- Reverse with 0022_discovery_production_ledger.down.sql before data is relied upon.
-- Composite matter/org FKs mirror 0020_civil_claims.
-- Graph enum values cannot be safely removed (see down file).

-- Supporting unique indexes for composite FKs
CREATE UNIQUE INDEX IF NOT EXISTS "matters_id_org_uidx" ON "matters" ("id", "organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "matter_entities_id_matter_uidx" ON "matter_entities" ("id", "matter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "civil_evidence_items_id_matter_uidx" ON "civil_evidence_items" ("id", "matter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "tasks_id_matter_uidx" ON "tasks" ("id", "matter_id");

-- Additive graph_node_type values for discovery ledger enablement.
ALTER TYPE "public"."graph_node_type" ADD VALUE IF NOT EXISTS 'discovery_request_set';
ALTER TYPE "public"."graph_node_type" ADD VALUE IF NOT EXISTS 'discovery_request_item';
ALTER TYPE "public"."graph_node_type" ADD VALUE IF NOT EXISTS 'discovery_response';
ALTER TYPE "public"."graph_node_type" ADD VALUE IF NOT EXISTS 'discovery_production';
ALTER TYPE "public"."graph_node_type" ADD VALUE IF NOT EXISTS 'discovery_deficiency';
ALTER TYPE "public"."graph_node_type" ADD VALUE IF NOT EXISTS 'privilege_assertion';

CREATE TABLE IF NOT EXISTS "discovery_request_sets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "label" text NOT NULL,
  "discovery_type" text NOT NULL,
  "requesting_party_entity_id" uuid NOT NULL,
  "responding_party_entity_id" uuid NOT NULL,
  "served_at" timestamp with time zone,
  "response_due_at" timestamp with time zone,
  "source_document_id" uuid,
  "is_current" boolean DEFAULT true NOT NULL,
  "superseded_by_id" uuid,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "discovery_request_sets_type_chk" CHECK ("discovery_type" IN (
    'INTERROGATORY','REQUEST_FOR_PRODUCTION','REQUEST_FOR_ADMISSION','SUBPOENA',
    'DEPOSITION_DISCOVERY','THIRD_PARTY_REQUEST','OTHER'
  ))
);
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_request_sets_id_matter_uidx" ON "discovery_request_sets" ("id", "matter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_request_sets_id_org_uidx" ON "discovery_request_sets" ("id", "organization_id");
CREATE INDEX IF NOT EXISTS "discovery_request_sets_org_matter_idx" ON "discovery_request_sets" ("organization_id", "matter_id");
CREATE INDEX IF NOT EXISTS "discovery_request_sets_matter_current_idx" ON "discovery_request_sets" ("matter_id", "is_current");
CREATE INDEX IF NOT EXISTS "discovery_request_sets_type_idx" ON "discovery_request_sets" ("matter_id", "discovery_type");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_request_sets_organization_fk') THEN
    ALTER TABLE "discovery_request_sets" ADD CONSTRAINT "discovery_request_sets_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_request_sets_matter_fk') THEN
    ALTER TABLE "discovery_request_sets" ADD CONSTRAINT "discovery_request_sets_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_request_sets_matter_org_fk') THEN
    ALTER TABLE "discovery_request_sets" ADD CONSTRAINT "discovery_request_sets_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_request_sets_requesting_party_fk') THEN
    ALTER TABLE "discovery_request_sets" ADD CONSTRAINT "discovery_request_sets_requesting_party_fk" FOREIGN KEY ("requesting_party_entity_id") REFERENCES "matter_entities"("id") ON DELETE restrict;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_request_sets_responding_party_fk') THEN
    ALTER TABLE "discovery_request_sets" ADD CONSTRAINT "discovery_request_sets_responding_party_fk" FOREIGN KEY ("responding_party_entity_id") REFERENCES "matter_entities"("id") ON DELETE restrict;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_request_sets_requesting_party_matter_fk') THEN
    ALTER TABLE "discovery_request_sets" ADD CONSTRAINT "discovery_request_sets_requesting_party_matter_fk" FOREIGN KEY ("requesting_party_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE restrict;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_request_sets_responding_party_matter_fk') THEN
    ALTER TABLE "discovery_request_sets" ADD CONSTRAINT "discovery_request_sets_responding_party_matter_fk" FOREIGN KEY ("responding_party_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE restrict;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_request_sets_source_document_fk') THEN
    ALTER TABLE "discovery_request_sets" ADD CONSTRAINT "discovery_request_sets_source_document_fk" FOREIGN KEY ("source_document_id") REFERENCES "documents"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_request_sets_created_by_fk') THEN
    ALTER TABLE "discovery_request_sets" ADD CONSTRAINT "discovery_request_sets_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_request_sets_updated_by_fk') THEN
    ALTER TABLE "discovery_request_sets" ADD CONSTRAINT "discovery_request_sets_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_request_sets_superseded_by_fk') THEN
    ALTER TABLE "discovery_request_sets" ADD CONSTRAINT "discovery_request_sets_superseded_by_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "discovery_request_sets"("id") ON DELETE set null;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "discovery_request_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "set_id" uuid NOT NULL,
  "request_number" text NOT NULL,
  "title" text NOT NULL,
  "request_text" text DEFAULT '' NOT NULL,
  "status" text DEFAULT 'OPEN' NOT NULL,
  "requesting_party_entity_id" uuid NOT NULL,
  "responding_party_entity_id" uuid NOT NULL,
  "served_at" timestamp with time zone,
  "response_due_at" timestamp with time zone,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "discovery_request_items_status_chk" CHECK ("status" IN (
    'NOT_DUE','OPEN','RESPONDED','PARTIALLY_RESPONDED','OBJECTED','PRODUCED',
    'SUPPLEMENT_REQUIRED','DEFICIENT','RESOLVED','UNKNOWN'
  ))
);
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_request_items_id_matter_uidx" ON "discovery_request_items" ("id", "matter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_request_items_id_org_uidx" ON "discovery_request_items" ("id", "organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_request_items_set_number_uidx" ON "discovery_request_items" ("set_id", "request_number");
CREATE INDEX IF NOT EXISTS "discovery_request_items_set_idx" ON "discovery_request_items" ("set_id");
CREATE INDEX IF NOT EXISTS "discovery_request_items_org_matter_idx" ON "discovery_request_items" ("organization_id", "matter_id");
CREATE INDEX IF NOT EXISTS "discovery_request_items_status_idx" ON "discovery_request_items" ("matter_id", "status");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_request_items_organization_fk') THEN
    ALTER TABLE "discovery_request_items" ADD CONSTRAINT "discovery_request_items_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_request_items_matter_fk') THEN
    ALTER TABLE "discovery_request_items" ADD CONSTRAINT "discovery_request_items_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_request_items_matter_org_fk') THEN
    ALTER TABLE "discovery_request_items" ADD CONSTRAINT "discovery_request_items_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_request_items_set_fk') THEN
    ALTER TABLE "discovery_request_items" ADD CONSTRAINT "discovery_request_items_set_fk" FOREIGN KEY ("set_id") REFERENCES "discovery_request_sets"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_request_items_set_matter_fk') THEN
    ALTER TABLE "discovery_request_items" ADD CONSTRAINT "discovery_request_items_set_matter_fk" FOREIGN KEY ("set_id", "matter_id") REFERENCES "discovery_request_sets"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_request_items_requesting_party_fk') THEN
    ALTER TABLE "discovery_request_items" ADD CONSTRAINT "discovery_request_items_requesting_party_fk" FOREIGN KEY ("requesting_party_entity_id") REFERENCES "matter_entities"("id") ON DELETE restrict;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_request_items_responding_party_fk') THEN
    ALTER TABLE "discovery_request_items" ADD CONSTRAINT "discovery_request_items_responding_party_fk" FOREIGN KEY ("responding_party_entity_id") REFERENCES "matter_entities"("id") ON DELETE restrict;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_request_items_requesting_party_matter_fk') THEN
    ALTER TABLE "discovery_request_items" ADD CONSTRAINT "discovery_request_items_requesting_party_matter_fk" FOREIGN KEY ("requesting_party_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE restrict;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_request_items_responding_party_matter_fk') THEN
    ALTER TABLE "discovery_request_items" ADD CONSTRAINT "discovery_request_items_responding_party_matter_fk" FOREIGN KEY ("responding_party_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE restrict;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_request_items_created_by_fk') THEN
    ALTER TABLE "discovery_request_items" ADD CONSTRAINT "discovery_request_items_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_request_items_updated_by_fk') THEN
    ALTER TABLE "discovery_request_items" ADD CONSTRAINT "discovery_request_items_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "discovery_responses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "label" text NOT NULL,
  "responded_at" timestamp with time zone,
  "is_supplemental" boolean DEFAULT false NOT NULL,
  "supplements_response_id" uuid,
  "substantive_text" text,
  "source_document_id" uuid,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_responses_id_matter_uidx" ON "discovery_responses" ("id", "matter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_responses_id_org_uidx" ON "discovery_responses" ("id", "organization_id");
CREATE INDEX IF NOT EXISTS "discovery_responses_item_idx" ON "discovery_responses" ("item_id");
CREATE INDEX IF NOT EXISTS "discovery_responses_item_date_idx" ON "discovery_responses" ("item_id", "responded_at");
CREATE INDEX IF NOT EXISTS "discovery_responses_org_matter_idx" ON "discovery_responses" ("organization_id", "matter_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_responses_organization_fk') THEN
    ALTER TABLE "discovery_responses" ADD CONSTRAINT "discovery_responses_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_responses_matter_fk') THEN
    ALTER TABLE "discovery_responses" ADD CONSTRAINT "discovery_responses_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_responses_matter_org_fk') THEN
    ALTER TABLE "discovery_responses" ADD CONSTRAINT "discovery_responses_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_responses_item_fk') THEN
    ALTER TABLE "discovery_responses" ADD CONSTRAINT "discovery_responses_item_fk" FOREIGN KEY ("item_id") REFERENCES "discovery_request_items"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_responses_item_matter_fk') THEN
    ALTER TABLE "discovery_responses" ADD CONSTRAINT "discovery_responses_item_matter_fk" FOREIGN KEY ("item_id", "matter_id") REFERENCES "discovery_request_items"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_responses_supplements_fk') THEN
    ALTER TABLE "discovery_responses" ADD CONSTRAINT "discovery_responses_supplements_fk" FOREIGN KEY ("supplements_response_id") REFERENCES "discovery_responses"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_responses_source_document_fk') THEN
    ALTER TABLE "discovery_responses" ADD CONSTRAINT "discovery_responses_source_document_fk" FOREIGN KEY ("source_document_id") REFERENCES "documents"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_responses_created_by_fk') THEN
    ALTER TABLE "discovery_responses" ADD CONSTRAINT "discovery_responses_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_responses_updated_by_fk') THEN
    ALTER TABLE "discovery_responses" ADD CONSTRAINT "discovery_responses_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "discovery_objections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "response_id" uuid NOT NULL,
  "basis" text NOT NULL,
  "text" text DEFAULT '' NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_objections_id_matter_uidx" ON "discovery_objections" ("id", "matter_id");
CREATE INDEX IF NOT EXISTS "discovery_objections_response_idx" ON "discovery_objections" ("response_id");
CREATE INDEX IF NOT EXISTS "discovery_objections_item_idx" ON "discovery_objections" ("item_id");
CREATE INDEX IF NOT EXISTS "discovery_objections_org_matter_idx" ON "discovery_objections" ("organization_id", "matter_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_objections_organization_fk') THEN
    ALTER TABLE "discovery_objections" ADD CONSTRAINT "discovery_objections_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_objections_matter_fk') THEN
    ALTER TABLE "discovery_objections" ADD CONSTRAINT "discovery_objections_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_objections_matter_org_fk') THEN
    ALTER TABLE "discovery_objections" ADD CONSTRAINT "discovery_objections_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_objections_item_fk') THEN
    ALTER TABLE "discovery_objections" ADD CONSTRAINT "discovery_objections_item_fk" FOREIGN KEY ("item_id") REFERENCES "discovery_request_items"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_objections_item_matter_fk') THEN
    ALTER TABLE "discovery_objections" ADD CONSTRAINT "discovery_objections_item_matter_fk" FOREIGN KEY ("item_id", "matter_id") REFERENCES "discovery_request_items"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_objections_response_fk') THEN
    ALTER TABLE "discovery_objections" ADD CONSTRAINT "discovery_objections_response_fk" FOREIGN KEY ("response_id") REFERENCES "discovery_responses"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_objections_response_matter_fk') THEN
    ALTER TABLE "discovery_objections" ADD CONSTRAINT "discovery_objections_response_matter_fk" FOREIGN KEY ("response_id", "matter_id") REFERENCES "discovery_responses"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_objections_created_by_fk') THEN
    ALTER TABLE "discovery_objections" ADD CONSTRAINT "discovery_objections_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "discovery_productions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "label" text NOT NULL,
  "producing_party_entity_id" uuid NOT NULL,
  "receiving_party_entity_id" uuid NOT NULL,
  "produced_at" timestamp with time zone,
  "is_supplemental" boolean DEFAULT false NOT NULL,
  "supplements_production_id" uuid,
  "transmittal_document_id" uuid,
  "notes" text,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_productions_id_matter_uidx" ON "discovery_productions" ("id", "matter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_productions_id_org_uidx" ON "discovery_productions" ("id", "organization_id");
CREATE INDEX IF NOT EXISTS "discovery_productions_org_matter_idx" ON "discovery_productions" ("organization_id", "matter_id");
CREATE INDEX IF NOT EXISTS "discovery_productions_matter_date_idx" ON "discovery_productions" ("matter_id", "produced_at");
CREATE INDEX IF NOT EXISTS "discovery_productions_party_idx" ON "discovery_productions" ("matter_id", "producing_party_entity_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_productions_organization_fk') THEN
    ALTER TABLE "discovery_productions" ADD CONSTRAINT "discovery_productions_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_productions_matter_fk') THEN
    ALTER TABLE "discovery_productions" ADD CONSTRAINT "discovery_productions_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_productions_matter_org_fk') THEN
    ALTER TABLE "discovery_productions" ADD CONSTRAINT "discovery_productions_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_productions_producing_party_fk') THEN
    ALTER TABLE "discovery_productions" ADD CONSTRAINT "discovery_productions_producing_party_fk" FOREIGN KEY ("producing_party_entity_id") REFERENCES "matter_entities"("id") ON DELETE restrict;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_productions_receiving_party_fk') THEN
    ALTER TABLE "discovery_productions" ADD CONSTRAINT "discovery_productions_receiving_party_fk" FOREIGN KEY ("receiving_party_entity_id") REFERENCES "matter_entities"("id") ON DELETE restrict;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_productions_producing_party_matter_fk') THEN
    ALTER TABLE "discovery_productions" ADD CONSTRAINT "discovery_productions_producing_party_matter_fk" FOREIGN KEY ("producing_party_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE restrict;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_productions_receiving_party_matter_fk') THEN
    ALTER TABLE "discovery_productions" ADD CONSTRAINT "discovery_productions_receiving_party_matter_fk" FOREIGN KEY ("receiving_party_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE restrict;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_productions_supplements_fk') THEN
    ALTER TABLE "discovery_productions" ADD CONSTRAINT "discovery_productions_supplements_fk" FOREIGN KEY ("supplements_production_id") REFERENCES "discovery_productions"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_productions_transmittal_document_fk') THEN
    ALTER TABLE "discovery_productions" ADD CONSTRAINT "discovery_productions_transmittal_document_fk" FOREIGN KEY ("transmittal_document_id") REFERENCES "documents"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_productions_created_by_fk') THEN
    ALTER TABLE "discovery_productions" ADD CONSTRAINT "discovery_productions_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_productions_updated_by_fk') THEN
    ALTER TABLE "discovery_productions" ADD CONSTRAINT "discovery_productions_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "discovery_production_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "production_id" uuid NOT NULL,
  "document_id" uuid,
  "evidence_id" uuid,
  "request_item_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "discovery_production_items_target_chk" CHECK (
    "document_id" IS NOT NULL OR "evidence_id" IS NOT NULL OR "request_item_id" IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS "discovery_production_items_production_idx" ON "discovery_production_items" ("production_id");
CREATE INDEX IF NOT EXISTS "discovery_production_items_document_idx" ON "discovery_production_items" ("document_id");
CREATE INDEX IF NOT EXISTS "discovery_production_items_evidence_idx" ON "discovery_production_items" ("evidence_id");
CREATE INDEX IF NOT EXISTS "discovery_production_items_org_matter_idx" ON "discovery_production_items" ("organization_id", "matter_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_production_items_organization_fk') THEN
    ALTER TABLE "discovery_production_items" ADD CONSTRAINT "discovery_production_items_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_production_items_matter_fk') THEN
    ALTER TABLE "discovery_production_items" ADD CONSTRAINT "discovery_production_items_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_production_items_matter_org_fk') THEN
    ALTER TABLE "discovery_production_items" ADD CONSTRAINT "discovery_production_items_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_production_items_production_fk') THEN
    ALTER TABLE "discovery_production_items" ADD CONSTRAINT "discovery_production_items_production_fk" FOREIGN KEY ("production_id") REFERENCES "discovery_productions"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_production_items_production_matter_fk') THEN
    ALTER TABLE "discovery_production_items" ADD CONSTRAINT "discovery_production_items_production_matter_fk" FOREIGN KEY ("production_id", "matter_id") REFERENCES "discovery_productions"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_production_items_document_fk') THEN
    ALTER TABLE "discovery_production_items" ADD CONSTRAINT "discovery_production_items_document_fk" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_production_items_evidence_fk') THEN
    ALTER TABLE "discovery_production_items" ADD CONSTRAINT "discovery_production_items_evidence_fk" FOREIGN KEY ("evidence_id") REFERENCES "civil_evidence_items"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_production_items_evidence_matter_fk') THEN
    ALTER TABLE "discovery_production_items" ADD CONSTRAINT "discovery_production_items_evidence_matter_fk" FOREIGN KEY ("evidence_id", "matter_id") REFERENCES "civil_evidence_items"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_production_items_request_item_fk') THEN
    ALTER TABLE "discovery_production_items" ADD CONSTRAINT "discovery_production_items_request_item_fk" FOREIGN KEY ("request_item_id") REFERENCES "discovery_request_items"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_production_items_request_item_matter_fk') THEN
    ALTER TABLE "discovery_production_items" ADD CONSTRAINT "discovery_production_items_request_item_matter_fk" FOREIGN KEY ("request_item_id", "matter_id") REFERENCES "discovery_request_items"("id", "matter_id") ON DELETE set null;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "discovery_bates_ranges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "production_id" uuid NOT NULL,
  "prefix" text DEFAULT '' NOT NULL,
  "start_number" integer,
  "end_number" integer,
  "raw_text" text DEFAULT '' NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "discovery_bates_ranges_order_chk" CHECK (
    "start_number" IS NULL OR "end_number" IS NULL OR "end_number" >= "start_number"
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_bates_ranges_id_matter_uidx" ON "discovery_bates_ranges" ("id", "matter_id");
CREATE INDEX IF NOT EXISTS "discovery_bates_ranges_production_idx" ON "discovery_bates_ranges" ("production_id");
CREATE INDEX IF NOT EXISTS "discovery_bates_ranges_prefix_idx" ON "discovery_bates_ranges" ("matter_id", "prefix");
CREATE INDEX IF NOT EXISTS "discovery_bates_ranges_org_matter_idx" ON "discovery_bates_ranges" ("organization_id", "matter_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_bates_ranges_organization_fk') THEN
    ALTER TABLE "discovery_bates_ranges" ADD CONSTRAINT "discovery_bates_ranges_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_bates_ranges_matter_fk') THEN
    ALTER TABLE "discovery_bates_ranges" ADD CONSTRAINT "discovery_bates_ranges_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_bates_ranges_matter_org_fk') THEN
    ALTER TABLE "discovery_bates_ranges" ADD CONSTRAINT "discovery_bates_ranges_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_bates_ranges_production_fk') THEN
    ALTER TABLE "discovery_bates_ranges" ADD CONSTRAINT "discovery_bates_ranges_production_fk" FOREIGN KEY ("production_id") REFERENCES "discovery_productions"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_bates_ranges_production_matter_fk') THEN
    ALTER TABLE "discovery_bates_ranges" ADD CONSTRAINT "discovery_bates_ranges_production_matter_fk" FOREIGN KEY ("production_id", "matter_id") REFERENCES "discovery_productions"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_bates_ranges_created_by_fk') THEN
    ALTER TABLE "discovery_bates_ranges" ADD CONSTRAINT "discovery_bates_ranges_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "discovery_production_custodians" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "production_id" uuid NOT NULL,
  "custodian_entity_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_production_custodians_uidx" ON "discovery_production_custodians" ("production_id", "custodian_entity_id");
CREATE INDEX IF NOT EXISTS "discovery_production_custodians_org_matter_idx" ON "discovery_production_custodians" ("organization_id", "matter_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_production_custodians_organization_fk') THEN
    ALTER TABLE "discovery_production_custodians" ADD CONSTRAINT "discovery_production_custodians_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_production_custodians_matter_fk') THEN
    ALTER TABLE "discovery_production_custodians" ADD CONSTRAINT "discovery_production_custodians_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_production_custodians_matter_org_fk') THEN
    ALTER TABLE "discovery_production_custodians" ADD CONSTRAINT "discovery_production_custodians_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_production_custodians_production_fk') THEN
    ALTER TABLE "discovery_production_custodians" ADD CONSTRAINT "discovery_production_custodians_production_fk" FOREIGN KEY ("production_id") REFERENCES "discovery_productions"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_production_custodians_production_matter_fk') THEN
    ALTER TABLE "discovery_production_custodians" ADD CONSTRAINT "discovery_production_custodians_production_matter_fk" FOREIGN KEY ("production_id", "matter_id") REFERENCES "discovery_productions"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_production_custodians_entity_fk') THEN
    ALTER TABLE "discovery_production_custodians" ADD CONSTRAINT "discovery_production_custodians_entity_fk" FOREIGN KEY ("custodian_entity_id") REFERENCES "matter_entities"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_production_custodians_entity_matter_fk') THEN
    ALTER TABLE "discovery_production_custodians" ADD CONSTRAINT "discovery_production_custodians_entity_matter_fk" FOREIGN KEY ("custodian_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "discovery_response_productions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "response_id" uuid NOT NULL,
  "production_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_response_productions_uidx" ON "discovery_response_productions" ("response_id", "production_id");
CREATE INDEX IF NOT EXISTS "discovery_response_productions_org_matter_idx" ON "discovery_response_productions" ("organization_id", "matter_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_response_productions_organization_fk') THEN
    ALTER TABLE "discovery_response_productions" ADD CONSTRAINT "discovery_response_productions_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_response_productions_matter_fk') THEN
    ALTER TABLE "discovery_response_productions" ADD CONSTRAINT "discovery_response_productions_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_response_productions_matter_org_fk') THEN
    ALTER TABLE "discovery_response_productions" ADD CONSTRAINT "discovery_response_productions_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_response_productions_response_fk') THEN
    ALTER TABLE "discovery_response_productions" ADD CONSTRAINT "discovery_response_productions_response_fk" FOREIGN KEY ("response_id") REFERENCES "discovery_responses"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_response_productions_response_matter_fk') THEN
    ALTER TABLE "discovery_response_productions" ADD CONSTRAINT "discovery_response_productions_response_matter_fk" FOREIGN KEY ("response_id", "matter_id") REFERENCES "discovery_responses"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_response_productions_production_fk') THEN
    ALTER TABLE "discovery_response_productions" ADD CONSTRAINT "discovery_response_productions_production_fk" FOREIGN KEY ("production_id") REFERENCES "discovery_productions"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_response_productions_production_matter_fk') THEN
    ALTER TABLE "discovery_response_productions" ADD CONSTRAINT "discovery_response_productions_production_matter_fk" FOREIGN KEY ("production_id", "matter_id") REFERENCES "discovery_productions"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "discovery_meet_and_confer_issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "label" text NOT NULL,
  "occurred_at" timestamp with time zone,
  "communication_id" uuid,
  "task_id" uuid,
  "outcome_notes" text,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_meet_and_confer_issues_id_matter_uidx" ON "discovery_meet_and_confer_issues" ("id", "matter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_meet_and_confer_issues_id_org_uidx" ON "discovery_meet_and_confer_issues" ("id", "organization_id");
CREATE INDEX IF NOT EXISTS "discovery_meet_and_confer_issues_org_matter_idx" ON "discovery_meet_and_confer_issues" ("organization_id", "matter_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_meet_and_confer_issues_organization_fk') THEN
    ALTER TABLE "discovery_meet_and_confer_issues" ADD CONSTRAINT "discovery_meet_and_confer_issues_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_meet_and_confer_issues_matter_fk') THEN
    ALTER TABLE "discovery_meet_and_confer_issues" ADD CONSTRAINT "discovery_meet_and_confer_issues_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_meet_and_confer_issues_matter_org_fk') THEN
    ALTER TABLE "discovery_meet_and_confer_issues" ADD CONSTRAINT "discovery_meet_and_confer_issues_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_meet_and_confer_issues_task_fk') THEN
    ALTER TABLE "discovery_meet_and_confer_issues" ADD CONSTRAINT "discovery_meet_and_confer_issues_task_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_meet_and_confer_issues_task_matter_fk') THEN
    ALTER TABLE "discovery_meet_and_confer_issues" ADD CONSTRAINT "discovery_meet_and_confer_issues_task_matter_fk" FOREIGN KEY ("task_id", "matter_id") REFERENCES "tasks"("id", "matter_id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_meet_and_confer_issues_created_by_fk') THEN
    ALTER TABLE "discovery_meet_and_confer_issues" ADD CONSTRAINT "discovery_meet_and_confer_issues_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_meet_and_confer_issues_updated_by_fk') THEN
    ALTER TABLE "discovery_meet_and_confer_issues" ADD CONSTRAINT "discovery_meet_and_confer_issues_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "discovery_deficiencies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "status" text DEFAULT 'OPEN' NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "item_id" uuid,
  "production_id" uuid,
  "opened_at" timestamp with time zone,
  "responsible_party_entity_id" uuid,
  "communication_id" uuid,
  "meet_and_confer_id" uuid,
  "motion_id" uuid,
  "motion_document_id" uuid,
  "is_review_signal" boolean DEFAULT true NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "discovery_deficiencies_kind_chk" CHECK ("kind" IN (
    'NO_RESPONSE','PARTIAL_RESPONSE','OBJECTION_ONLY','MISSING_PRODUCTION','INCOMPLETE_PRODUCTION',
    'UNREADABLE_DOCUMENT','MISSING_ATTACHMENT','BATES_GAP','UNIDENTIFIED_CUSTODIAN',
    'PRIVILEGE_LOG_MISSING','SUPPLEMENT_EXPECTED','OTHER'
  )),
  CONSTRAINT "discovery_deficiencies_status_chk" CHECK ("status" IN (
    'OPEN','MEET_AND_CONFER','MOTION_PENDING','RESOLVED','WITHDRAWN','UNKNOWN'
  )),
  CONSTRAINT "discovery_deficiencies_no_sanctions_chk" CHECK ("kind" NOT IN ('SANCTIONS','VIOLATION_ESTABLISHED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_deficiencies_id_matter_uidx" ON "discovery_deficiencies" ("id", "matter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_deficiencies_id_org_uidx" ON "discovery_deficiencies" ("id", "organization_id");
CREATE INDEX IF NOT EXISTS "discovery_deficiencies_org_matter_idx" ON "discovery_deficiencies" ("organization_id", "matter_id");
CREATE INDEX IF NOT EXISTS "discovery_deficiencies_status_idx" ON "discovery_deficiencies" ("matter_id", "status");
CREATE INDEX IF NOT EXISTS "discovery_deficiencies_item_idx" ON "discovery_deficiencies" ("item_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_deficiencies_organization_fk') THEN
    ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_deficiencies_matter_fk') THEN
    ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_deficiencies_matter_org_fk') THEN
    ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_deficiencies_item_fk') THEN
    ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_item_fk" FOREIGN KEY ("item_id") REFERENCES "discovery_request_items"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_deficiencies_item_matter_fk') THEN
    ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_item_matter_fk" FOREIGN KEY ("item_id", "matter_id") REFERENCES "discovery_request_items"("id", "matter_id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_deficiencies_production_fk') THEN
    ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_production_fk" FOREIGN KEY ("production_id") REFERENCES "discovery_productions"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_deficiencies_production_matter_fk') THEN
    ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_production_matter_fk" FOREIGN KEY ("production_id", "matter_id") REFERENCES "discovery_productions"("id", "matter_id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_deficiencies_party_fk') THEN
    ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_party_fk" FOREIGN KEY ("responsible_party_entity_id") REFERENCES "matter_entities"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_deficiencies_party_matter_fk') THEN
    ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_party_matter_fk" FOREIGN KEY ("responsible_party_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_deficiencies_mac_fk') THEN
    ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_mac_fk" FOREIGN KEY ("meet_and_confer_id") REFERENCES "discovery_meet_and_confer_issues"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_deficiencies_mac_matter_fk') THEN
    ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_mac_matter_fk" FOREIGN KEY ("meet_and_confer_id", "matter_id") REFERENCES "discovery_meet_and_confer_issues"("id", "matter_id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_deficiencies_motion_document_fk') THEN
    ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_motion_document_fk" FOREIGN KEY ("motion_document_id") REFERENCES "documents"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_deficiencies_created_by_fk') THEN
    ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_deficiencies_updated_by_fk') THEN
    ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "discovery_meet_and_confer_deficiency_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "meet_and_confer_id" uuid NOT NULL,
  "deficiency_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_mac_deficiency_links_uidx" ON "discovery_meet_and_confer_deficiency_links" ("meet_and_confer_id", "deficiency_id");
CREATE INDEX IF NOT EXISTS "discovery_mac_deficiency_links_org_matter_idx" ON "discovery_meet_and_confer_deficiency_links" ("organization_id", "matter_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_mac_deficiency_links_organization_fk') THEN
    ALTER TABLE "discovery_meet_and_confer_deficiency_links" ADD CONSTRAINT "discovery_mac_deficiency_links_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_mac_deficiency_links_matter_fk') THEN
    ALTER TABLE "discovery_meet_and_confer_deficiency_links" ADD CONSTRAINT "discovery_mac_deficiency_links_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_mac_deficiency_links_matter_org_fk') THEN
    ALTER TABLE "discovery_meet_and_confer_deficiency_links" ADD CONSTRAINT "discovery_mac_deficiency_links_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_mac_deficiency_links_mac_fk') THEN
    ALTER TABLE "discovery_meet_and_confer_deficiency_links" ADD CONSTRAINT "discovery_mac_deficiency_links_mac_fk" FOREIGN KEY ("meet_and_confer_id") REFERENCES "discovery_meet_and_confer_issues"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_mac_deficiency_links_mac_matter_fk') THEN
    ALTER TABLE "discovery_meet_and_confer_deficiency_links" ADD CONSTRAINT "discovery_mac_deficiency_links_mac_matter_fk" FOREIGN KEY ("meet_and_confer_id", "matter_id") REFERENCES "discovery_meet_and_confer_issues"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_mac_deficiency_links_def_fk') THEN
    ALTER TABLE "discovery_meet_and_confer_deficiency_links" ADD CONSTRAINT "discovery_mac_deficiency_links_def_fk" FOREIGN KEY ("deficiency_id") REFERENCES "discovery_deficiencies"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_mac_deficiency_links_def_matter_fk') THEN
    ALTER TABLE "discovery_meet_and_confer_deficiency_links" ADD CONSTRAINT "discovery_mac_deficiency_links_def_matter_fk" FOREIGN KEY ("deficiency_id", "matter_id") REFERENCES "discovery_deficiencies"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "discovery_privilege_assertions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "status" text DEFAULT 'ASSERTED' NOT NULL,
  "asserted_basis" text NOT NULL,
  "asserting_party_entity_id" uuid NOT NULL,
  "asserted_at" timestamp with time zone,
  "document_id" uuid,
  "evidence_id" uuid,
  "production_id" uuid,
  "privilege_log_document_id" uuid,
  "review_notes" text,
  "court_ruling_referenced" boolean DEFAULT false NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "discovery_privilege_assertions_status_chk" CHECK ("status" IN (
    'ASSERTED','UNDER_REVIEW','CHALLENGED','WITHDRAWN','RESOLVED','UNKNOWN'
  )),
  CONSTRAINT "discovery_privilege_assertions_no_legal_conclusion_chk" CHECK (
    "status" NOT IN ('PRIVILEGED','NOT_PRIVILEGED','PRIVILEGE_ESTABLISHED')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_privilege_assertions_id_matter_uidx" ON "discovery_privilege_assertions" ("id", "matter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_privilege_assertions_id_org_uidx" ON "discovery_privilege_assertions" ("id", "organization_id");
CREATE INDEX IF NOT EXISTS "discovery_privilege_assertions_org_matter_idx" ON "discovery_privilege_assertions" ("organization_id", "matter_id");
CREATE INDEX IF NOT EXISTS "discovery_privilege_assertions_status_idx" ON "discovery_privilege_assertions" ("matter_id", "status");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_privilege_assertions_organization_fk') THEN
    ALTER TABLE "discovery_privilege_assertions" ADD CONSTRAINT "discovery_privilege_assertions_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_privilege_assertions_matter_fk') THEN
    ALTER TABLE "discovery_privilege_assertions" ADD CONSTRAINT "discovery_privilege_assertions_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_privilege_assertions_matter_org_fk') THEN
    ALTER TABLE "discovery_privilege_assertions" ADD CONSTRAINT "discovery_privilege_assertions_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_privilege_assertions_party_fk') THEN
    ALTER TABLE "discovery_privilege_assertions" ADD CONSTRAINT "discovery_privilege_assertions_party_fk" FOREIGN KEY ("asserting_party_entity_id") REFERENCES "matter_entities"("id") ON DELETE restrict;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_privilege_assertions_party_matter_fk') THEN
    ALTER TABLE "discovery_privilege_assertions" ADD CONSTRAINT "discovery_privilege_assertions_party_matter_fk" FOREIGN KEY ("asserting_party_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE restrict;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_privilege_assertions_document_fk') THEN
    ALTER TABLE "discovery_privilege_assertions" ADD CONSTRAINT "discovery_privilege_assertions_document_fk" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_privilege_assertions_evidence_fk') THEN
    ALTER TABLE "discovery_privilege_assertions" ADD CONSTRAINT "discovery_privilege_assertions_evidence_fk" FOREIGN KEY ("evidence_id") REFERENCES "civil_evidence_items"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_privilege_assertions_evidence_matter_fk') THEN
    ALTER TABLE "discovery_privilege_assertions" ADD CONSTRAINT "discovery_privilege_assertions_evidence_matter_fk" FOREIGN KEY ("evidence_id", "matter_id") REFERENCES "civil_evidence_items"("id", "matter_id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_privilege_assertions_production_fk') THEN
    ALTER TABLE "discovery_privilege_assertions" ADD CONSTRAINT "discovery_privilege_assertions_production_fk" FOREIGN KEY ("production_id") REFERENCES "discovery_productions"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_privilege_assertions_production_matter_fk') THEN
    ALTER TABLE "discovery_privilege_assertions" ADD CONSTRAINT "discovery_privilege_assertions_production_matter_fk" FOREIGN KEY ("production_id", "matter_id") REFERENCES "discovery_productions"("id", "matter_id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_privilege_assertions_log_document_fk') THEN
    ALTER TABLE "discovery_privilege_assertions" ADD CONSTRAINT "discovery_privilege_assertions_log_document_fk" FOREIGN KEY ("privilege_log_document_id") REFERENCES "documents"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_privilege_assertions_created_by_fk') THEN
    ALTER TABLE "discovery_privilege_assertions" ADD CONSTRAINT "discovery_privilege_assertions_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_privilege_assertions_updated_by_fk') THEN
    ALTER TABLE "discovery_privilege_assertions" ADD CONSTRAINT "discovery_privilege_assertions_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;

-- <<< end replay of 0022_discovery_production_ledger

--> statement-breakpoint


-- >>> begin replay of 0023_matter_motions_communications (idempotent)

-- Matter motions + communications (Deepening Pass 6).
-- Additive only. No automatic jurisdictional deadline inference.
-- Nulls orphan opaque discovery motion/communication UUIDs before FK hardening.
-- Reverse with 0023_matter_motions_communications.down.sql before data is relied upon.
-- Graph enum values cannot be safely removed (see down file).

CREATE UNIQUE INDEX IF NOT EXISTS "matters_id_org_uidx" ON "matters" ("id", "organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "matter_entities_id_matter_uidx" ON "matter_entities" ("id", "matter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "tasks_id_matter_uidx" ON "tasks" ("id", "matter_id");

ALTER TYPE "public"."graph_node_type" ADD VALUE IF NOT EXISTS 'motion';
ALTER TYPE "public"."graph_node_type" ADD VALUE IF NOT EXISTS 'communication';

CREATE TABLE IF NOT EXISTS "matter_motions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "motion_type" text NOT NULL,
  "title" text NOT NULL,
  "summary" text,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "moving_party_entity_id" uuid,
  "opposing_party_entity_id" uuid,
  "filed_at" timestamp with time zone,
  "served_at" timestamp with time zone,
  "opposition_due_at" timestamp with time zone,
  "opposition_filed_at" timestamp with time zone,
  "reply_due_at" timestamp with time zone,
  "reply_filed_at" timestamp with time zone,
  "hearing_at" timestamp with time zone,
  "ruling_at" timestamp with time zone,
  "disposition" text,
  "ruling_summary" text,
  "court_name" text,
  "judge_name" text,
  "primary_document_id" uuid,
  "order_document_id" uuid,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "matter_motions_type_chk" CHECK ("motion_type" IN (
    'MOTION_TO_COMPEL','PROTECTIVE_ORDER','SANCTIONS','MOTION_TO_DISMISS','SUMMARY_JUDGMENT',
    'MOTION_IN_LIMINE','MOTION_TO_EXCLUDE','MOTION_TO_STRIKE','RECONSIDERATION','DISCOVERY',
    'PROCEDURAL','OTHER'
  )),
  CONSTRAINT "matter_motions_status_chk" CHECK ("status" IN (
    'DRAFT','PLANNED','FILED','SERVED','OPPOSITION_DUE','OPPOSITION_FILED','REPLY_DUE','REPLY_FILED',
    'HEARING_SCHEDULED','SUBMITTED','GRANTED','DENIED','GRANTED_IN_PART','WITHDRAWN','MOOT','OTHER','UNKNOWN'
  )),
  CONSTRAINT "matter_motions_disposition_chk" CHECK (
    "disposition" IS NULL OR "disposition" IN (
      'GRANTED','DENIED','GRANTED_IN_PART','DENIED_IN_PART','WITHDRAWN','MOOT','OTHER','UNKNOWN'
    )
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "matter_motions_id_matter_uidx" ON "matter_motions" ("id", "matter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "matter_motions_id_org_uidx" ON "matter_motions" ("id", "organization_id");
CREATE INDEX IF NOT EXISTS "matter_motions_org_matter_idx" ON "matter_motions" ("organization_id", "matter_id");
CREATE INDEX IF NOT EXISTS "matter_motions_matter_status_idx" ON "matter_motions" ("matter_id", "status");
CREATE INDEX IF NOT EXISTS "matter_motions_matter_type_idx" ON "matter_motions" ("matter_id", "motion_type");
CREATE INDEX IF NOT EXISTS "matter_motions_matter_hearing_idx" ON "matter_motions" ("matter_id", "hearing_at");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_motions_organization_fk') THEN
    ALTER TABLE "matter_motions" ADD CONSTRAINT "matter_motions_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_motions_matter_fk') THEN
    ALTER TABLE "matter_motions" ADD CONSTRAINT "matter_motions_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_motions_matter_org_fk') THEN
    ALTER TABLE "matter_motions" ADD CONSTRAINT "matter_motions_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_motions_moving_party_fk') THEN
    ALTER TABLE "matter_motions" ADD CONSTRAINT "matter_motions_moving_party_fk" FOREIGN KEY ("moving_party_entity_id") REFERENCES "matter_entities"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_motions_opposing_party_fk') THEN
    ALTER TABLE "matter_motions" ADD CONSTRAINT "matter_motions_opposing_party_fk" FOREIGN KEY ("opposing_party_entity_id") REFERENCES "matter_entities"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_motions_moving_party_matter_fk') THEN
    ALTER TABLE "matter_motions" ADD CONSTRAINT "matter_motions_moving_party_matter_fk" FOREIGN KEY ("moving_party_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_motions_opposing_party_matter_fk') THEN
    ALTER TABLE "matter_motions" ADD CONSTRAINT "matter_motions_opposing_party_matter_fk" FOREIGN KEY ("opposing_party_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_motions_primary_document_fk') THEN
    ALTER TABLE "matter_motions" ADD CONSTRAINT "matter_motions_primary_document_fk" FOREIGN KEY ("primary_document_id") REFERENCES "documents"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_motions_order_document_fk') THEN
    ALTER TABLE "matter_motions" ADD CONSTRAINT "matter_motions_order_document_fk" FOREIGN KEY ("order_document_id") REFERENCES "documents"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_motions_created_by_fk') THEN
    ALTER TABLE "matter_motions" ADD CONSTRAINT "matter_motions_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_motions_updated_by_fk') THEN
    ALTER TABLE "matter_motions" ADD CONSTRAINT "matter_motions_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "matter_motion_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "motion_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "role" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "matter_motion_documents_role_chk" CHECK ("role" IN (
    'MOTION','BRIEF','OPPOSITION','REPLY','DECLARATION','EXHIBIT','ORDER','TRANSCRIPT','OTHER'
  ))
);
CREATE UNIQUE INDEX IF NOT EXISTS "matter_motion_documents_edge_uidx" ON "matter_motion_documents" ("motion_id", "document_id", "role");
CREATE INDEX IF NOT EXISTS "matter_motion_documents_org_matter_idx" ON "matter_motion_documents" ("organization_id", "matter_id");
CREATE INDEX IF NOT EXISTS "matter_motion_documents_motion_idx" ON "matter_motion_documents" ("motion_id");
CREATE INDEX IF NOT EXISTS "matter_motion_documents_document_idx" ON "matter_motion_documents" ("document_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_motion_documents_organization_fk') THEN
    ALTER TABLE "matter_motion_documents" ADD CONSTRAINT "matter_motion_documents_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_motion_documents_matter_fk') THEN
    ALTER TABLE "matter_motion_documents" ADD CONSTRAINT "matter_motion_documents_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_motion_documents_matter_org_fk') THEN
    ALTER TABLE "matter_motion_documents" ADD CONSTRAINT "matter_motion_documents_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_motion_documents_motion_fk') THEN
    ALTER TABLE "matter_motion_documents" ADD CONSTRAINT "matter_motion_documents_motion_fk" FOREIGN KEY ("motion_id") REFERENCES "matter_motions"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_motion_documents_motion_matter_fk') THEN
    ALTER TABLE "matter_motion_documents" ADD CONSTRAINT "matter_motion_documents_motion_matter_fk" FOREIGN KEY ("motion_id", "matter_id") REFERENCES "matter_motions"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_motion_documents_document_fk') THEN
    ALTER TABLE "matter_motion_documents" ADD CONSTRAINT "matter_motion_documents_document_fk" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE cascade;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "matter_motion_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "motion_id" uuid NOT NULL,
  "link_type" text NOT NULL,
  "target_id" uuid NOT NULL,
  "note" text,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "matter_motion_links_type_chk" CHECK ("link_type" IN (
    'CLAIM','DEFENSE','CLAIM_ELEMENT','DEFENSE_ELEMENT','LEGAL_ISSUE','DISCOVERY_REQUEST_ITEM',
    'DISCOVERY_DEFICIENCY','PRIVILEGE_ASSERTION','EVIDENCE','COMMUNICATION','TASK','DEADLINE_CANDIDATE'
  ))
);
CREATE UNIQUE INDEX IF NOT EXISTS "matter_motion_links_edge_uidx" ON "matter_motion_links" ("motion_id", "link_type", "target_id");
CREATE INDEX IF NOT EXISTS "matter_motion_links_org_matter_idx" ON "matter_motion_links" ("organization_id", "matter_id");
CREATE INDEX IF NOT EXISTS "matter_motion_links_matter_type_idx" ON "matter_motion_links" ("matter_id", "link_type");
CREATE INDEX IF NOT EXISTS "matter_motion_links_target_type_idx" ON "matter_motion_links" ("target_id", "link_type");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_motion_links_organization_fk') THEN
    ALTER TABLE "matter_motion_links" ADD CONSTRAINT "matter_motion_links_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_motion_links_matter_fk') THEN
    ALTER TABLE "matter_motion_links" ADD CONSTRAINT "matter_motion_links_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_motion_links_matter_org_fk') THEN
    ALTER TABLE "matter_motion_links" ADD CONSTRAINT "matter_motion_links_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_motion_links_motion_fk') THEN
    ALTER TABLE "matter_motion_links" ADD CONSTRAINT "matter_motion_links_motion_fk" FOREIGN KEY ("motion_id") REFERENCES "matter_motions"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_motion_links_motion_matter_fk') THEN
    ALTER TABLE "matter_motion_links" ADD CONSTRAINT "matter_motion_links_motion_matter_fk" FOREIGN KEY ("motion_id", "matter_id") REFERENCES "matter_motions"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "matter_communications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "communication_type" text NOT NULL,
  "direction" text DEFAULT 'UNKNOWN' NOT NULL,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "occurred_at" timestamp with time zone,
  "subject" text NOT NULL,
  "summary" text,
  "sender_entity_id" uuid,
  "recipient_entity_id" uuid,
  "primary_document_id" uuid,
  "inbound_email_id" uuid,
  "follow_up_needed" boolean DEFAULT false NOT NULL,
  "follow_up_due_at" timestamp with time zone,
  "follow_up_task_id" uuid,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "matter_communications_type_chk" CHECK ("communication_type" IN (
    'MEET_AND_CONFER','DEMAND','RESPONSE','FOLLOW_UP','DEFICIENCY_NOTICE','EXTENSION_REQUEST',
    'STIPULATION_DISCUSSION','PRIVILEGE','OTHER_CORRESPONDENCE'
  )),
  CONSTRAINT "matter_communications_direction_chk" CHECK ("direction" IN (
    'OUTBOUND','INBOUND','INTERNAL','UNKNOWN'
  )),
  CONSTRAINT "matter_communications_status_chk" CHECK ("status" IN (
    'DRAFT','SENT','RECEIVED','AWAITING_RESPONSE','CLOSED','UNKNOWN'
  ))
);
CREATE UNIQUE INDEX IF NOT EXISTS "matter_communications_id_matter_uidx" ON "matter_communications" ("id", "matter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "matter_communications_id_org_uidx" ON "matter_communications" ("id", "organization_id");
CREATE INDEX IF NOT EXISTS "matter_communications_org_matter_idx" ON "matter_communications" ("organization_id", "matter_id");
CREATE INDEX IF NOT EXISTS "matter_communications_matter_occurred_idx" ON "matter_communications" ("matter_id", "occurred_at" DESC);
CREATE INDEX IF NOT EXISTS "matter_communications_matter_type_idx" ON "matter_communications" ("matter_id", "communication_type");
CREATE INDEX IF NOT EXISTS "matter_communications_matter_follow_up_idx" ON "matter_communications" ("matter_id", "follow_up_needed");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_communications_organization_fk') THEN
    ALTER TABLE "matter_communications" ADD CONSTRAINT "matter_communications_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_communications_matter_fk') THEN
    ALTER TABLE "matter_communications" ADD CONSTRAINT "matter_communications_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_communications_matter_org_fk') THEN
    ALTER TABLE "matter_communications" ADD CONSTRAINT "matter_communications_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_communications_sender_fk') THEN
    ALTER TABLE "matter_communications" ADD CONSTRAINT "matter_communications_sender_fk" FOREIGN KEY ("sender_entity_id") REFERENCES "matter_entities"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_communications_recipient_fk') THEN
    ALTER TABLE "matter_communications" ADD CONSTRAINT "matter_communications_recipient_fk" FOREIGN KEY ("recipient_entity_id") REFERENCES "matter_entities"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_communications_sender_matter_fk') THEN
    ALTER TABLE "matter_communications" ADD CONSTRAINT "matter_communications_sender_matter_fk" FOREIGN KEY ("sender_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_communications_recipient_matter_fk') THEN
    ALTER TABLE "matter_communications" ADD CONSTRAINT "matter_communications_recipient_matter_fk" FOREIGN KEY ("recipient_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_communications_primary_document_fk') THEN
    ALTER TABLE "matter_communications" ADD CONSTRAINT "matter_communications_primary_document_fk" FOREIGN KEY ("primary_document_id") REFERENCES "documents"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_communications_inbound_email_fk') THEN
    ALTER TABLE "matter_communications" ADD CONSTRAINT "matter_communications_inbound_email_fk" FOREIGN KEY ("inbound_email_id") REFERENCES "inbound_emails"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_communications_follow_up_task_fk') THEN
    ALTER TABLE "matter_communications" ADD CONSTRAINT "matter_communications_follow_up_task_fk" FOREIGN KEY ("follow_up_task_id") REFERENCES "tasks"("id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_communications_follow_up_task_matter_fk') THEN
    ALTER TABLE "matter_communications" ADD CONSTRAINT "matter_communications_follow_up_task_matter_fk" FOREIGN KEY ("follow_up_task_id", "matter_id") REFERENCES "tasks"("id", "matter_id") ON DELETE set null;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_communications_created_by_fk') THEN
    ALTER TABLE "matter_communications" ADD CONSTRAINT "matter_communications_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_communications_updated_by_fk') THEN
    ALTER TABLE "matter_communications" ADD CONSTRAINT "matter_communications_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "matter_communication_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "communication_id" uuid NOT NULL,
  "link_type" text NOT NULL,
  "target_id" uuid NOT NULL,
  "note" text,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "matter_communication_links_type_chk" CHECK ("link_type" IN (
    'DISCOVERY_REQUEST_ITEM','DISCOVERY_RESPONSE','DISCOVERY_DEFICIENCY','MEET_AND_CONFER','MOTION',
    'PRIVILEGE_ASSERTION','CLAIM','DEFENSE','EVIDENCE','DOCUMENT','TASK'
  ))
);
CREATE UNIQUE INDEX IF NOT EXISTS "matter_communication_links_edge_uidx" ON "matter_communication_links" ("communication_id", "link_type", "target_id");
CREATE INDEX IF NOT EXISTS "matter_communication_links_org_matter_idx" ON "matter_communication_links" ("organization_id", "matter_id");
CREATE INDEX IF NOT EXISTS "matter_communication_links_matter_type_idx" ON "matter_communication_links" ("matter_id", "link_type");
CREATE INDEX IF NOT EXISTS "matter_communication_links_target_type_idx" ON "matter_communication_links" ("target_id", "link_type");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_communication_links_organization_fk') THEN
    ALTER TABLE "matter_communication_links" ADD CONSTRAINT "matter_communication_links_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_communication_links_matter_fk') THEN
    ALTER TABLE "matter_communication_links" ADD CONSTRAINT "matter_communication_links_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_communication_links_matter_org_fk') THEN
    ALTER TABLE "matter_communication_links" ADD CONSTRAINT "matter_communication_links_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_communication_links_communication_fk') THEN
    ALTER TABLE "matter_communication_links" ADD CONSTRAINT "matter_communication_links_communication_fk" FOREIGN KEY ("communication_id") REFERENCES "matter_communications"("id") ON DELETE cascade;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matter_communication_links_communication_matter_fk') THEN
    ALTER TABLE "matter_communication_links" ADD CONSTRAINT "matter_communication_links_communication_matter_fk" FOREIGN KEY ("communication_id", "matter_id") REFERENCES "matter_communications"("id", "matter_id") ON DELETE cascade;
  END IF;
END $$;

-- Discovery FK hardening: clear orphan opaque UUIDs (no parent rows yet; do not fabricate entities).
UPDATE "discovery_deficiencies"
SET "motion_id" = NULL
WHERE "motion_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "matter_motions" m
    WHERE m."id" = "discovery_deficiencies"."motion_id"
      AND m."matter_id" = "discovery_deficiencies"."matter_id"
  );

UPDATE "discovery_deficiencies"
SET "communication_id" = NULL
WHERE "communication_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "matter_communications" c
    WHERE c."id" = "discovery_deficiencies"."communication_id"
      AND c."matter_id" = "discovery_deficiencies"."matter_id"
  );

UPDATE "discovery_meet_and_confer_issues"
SET "communication_id" = NULL
WHERE "communication_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "matter_communications" c
    WHERE c."id" = "discovery_meet_and_confer_issues"."communication_id"
      AND c."matter_id" = "discovery_meet_and_confer_issues"."matter_id"
  );

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_deficiencies_motion_matter_fk') THEN
    ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_motion_matter_fk"
  FOREIGN KEY ("motion_id", "matter_id") REFERENCES "matter_motions"("id", "matter_id") ON DELETE set null;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_deficiencies_communication_matter_fk') THEN
    ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_communication_matter_fk"
  FOREIGN KEY ("communication_id", "matter_id") REFERENCES "matter_communications"("id", "matter_id") ON DELETE set null;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_meet_and_confer_issues_communication_matter_fk') THEN
    ALTER TABLE "discovery_meet_and_confer_issues" ADD CONSTRAINT "discovery_meet_and_confer_issues_communication_matter_fk"
  FOREIGN KEY ("communication_id", "matter_id") REFERENCES "matter_communications"("id", "matter_id") ON DELETE set null;
  END IF;
END $$;

-- <<< end replay of 0023_matter_motions_communications

--> statement-breakpoint


DO $$
BEGIN
  IF to_regclass('public.criminal_cases') IS NULL THEN
    RAISE EXCEPTION '0034: criminal_cases still missing after repair';
  END IF;
  IF to_regclass('public.prosecution_graph_nodes') IS NULL THEN
    RAISE EXCEPTION '0034: prosecution_graph_nodes still missing after repair';
  END IF;
END $$;
