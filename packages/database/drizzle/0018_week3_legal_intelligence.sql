-- Week 3 legal-intelligence and prosecution foundation.
-- Adds tables only. Does not rewrite corpus rows or existing matter data.
-- Reverse with 0018_week3_legal_intelligence.down.sql before data is relied upon.

CREATE TABLE "legal_standards" (
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
CREATE INDEX "legal_standards_org_idx" ON "legal_standards" ("organization_id");
CREATE INDEX "legal_standards_authority_idx" ON "legal_standards" ("authority_id");
ALTER TABLE "legal_standards" ADD CONSTRAINT "legal_standards_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "legal_standards" ADD CONSTRAINT "legal_standards_authority_fk" FOREIGN KEY ("authority_id") REFERENCES "public"."legal_authorities"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "legal_standards" ADD CONSTRAINT "legal_standards_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

CREATE TABLE "criminal_cases" (
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
CREATE UNIQUE INDEX "criminal_cases_org_number_uidx" ON "criminal_cases" ("organization_id", "case_number");
CREATE INDEX "criminal_cases_org_idx" ON "criminal_cases" ("organization_id");
CREATE INDEX "criminal_cases_matter_idx" ON "criminal_cases" ("matter_id");
ALTER TABLE "criminal_cases" ADD CONSTRAINT "criminal_cases_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "criminal_cases" ADD CONSTRAINT "criminal_cases_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "criminal_cases" ADD CONSTRAINT "criminal_cases_assigned_fk" FOREIGN KEY ("assigned_prosecutor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "criminal_cases" ADD CONSTRAINT "criminal_cases_supervising_fk" FOREIGN KEY ("supervising_prosecutor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "criminal_cases" ADD CONSTRAINT "criminal_cases_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "criminal_cases" ADD CONSTRAINT "criminal_cases_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

CREATE TABLE "legal_issues" (
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
CREATE INDEX "legal_issues_org_idx" ON "legal_issues" ("organization_id");
CREATE INDEX "legal_issues_matter_idx" ON "legal_issues" ("matter_id");
CREATE INDEX "legal_issues_case_idx" ON "legal_issues" ("criminal_case_id");
ALTER TABLE "legal_issues" ADD CONSTRAINT "legal_issues_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "legal_issues" ADD CONSTRAINT "legal_issues_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "legal_issues" ADD CONSTRAINT "legal_issues_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "legal_issue_authorities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "issue_id" uuid NOT NULL,
  "authority_id" uuid NOT NULL,
  "relation" text NOT NULL,
  "authority_status" text,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "legal_issue_authorities_edge_uidx" ON "legal_issue_authorities" ("issue_id", "authority_id", "relation");
CREATE INDEX "legal_issue_authorities_org_idx" ON "legal_issue_authorities" ("organization_id");
ALTER TABLE "legal_issue_authorities" ADD CONSTRAINT "legal_issue_authorities_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "legal_issue_authorities" ADD CONSTRAINT "legal_issue_authorities_issue_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."legal_issues"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "legal_issue_authorities" ADD CONSTRAINT "legal_issue_authorities_authority_fk" FOREIGN KEY ("authority_id") REFERENCES "public"."legal_authorities"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "authority_treatments" (
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
CREATE INDEX "authority_treatments_source_idx" ON "authority_treatments" ("source_authority_id");
CREATE INDEX "authority_treatments_target_idx" ON "authority_treatments" ("target_authority_id");
ALTER TABLE "authority_treatments" ADD CONSTRAINT "authority_treatments_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "authority_treatments" ADD CONSTRAINT "authority_treatments_source_fk" FOREIGN KEY ("source_authority_id") REFERENCES "public"."legal_authorities"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "authority_treatments" ADD CONSTRAINT "authority_treatments_target_fk" FOREIGN KEY ("target_authority_id") REFERENCES "public"."legal_authorities"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "authority_conflicts" (
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
CREATE INDEX "authority_conflicts_org_idx" ON "authority_conflicts" ("organization_id");
ALTER TABLE "authority_conflicts" ADD CONSTRAINT "authority_conflicts_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "authority_conflicts" ADD CONSTRAINT "authority_conflicts_a_fk" FOREIGN KEY ("authority_a") REFERENCES "public"."legal_authorities"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "authority_conflicts" ADD CONSTRAINT "authority_conflicts_b_fk" FOREIGN KEY ("authority_b") REFERENCES "public"."legal_authorities"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "authority_conflicts" ADD CONSTRAINT "authority_conflicts_issue_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."legal_issues"("id") ON DELETE set null ON UPDATE no action;

CREATE TABLE "prosecution_agencies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" text NOT NULL,
  "agency_type" text NOT NULL,
  "jurisdiction" text,
  "contact" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "prosecution_agencies_org_idx" ON "prosecution_agencies" ("organization_id");
ALTER TABLE "prosecution_agencies" ADD CONSTRAINT "prosecution_agencies_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "criminal_cases" ADD CONSTRAINT "criminal_cases_agency_fk" FOREIGN KEY ("investigating_agency_id") REFERENCES "public"."prosecution_agencies"("id") ON DELETE set null ON UPDATE no action;

CREATE TABLE "prosecution_defendants" (
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
CREATE INDEX "prosecution_defendants_case_idx" ON "prosecution_defendants" ("criminal_case_id");
CREATE INDEX "prosecution_defendants_org_idx" ON "prosecution_defendants" ("organization_id");
ALTER TABLE "prosecution_defendants" ADD CONSTRAINT "prosecution_defendants_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_defendants" ADD CONSTRAINT "prosecution_defendants_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "prosecution_officers" (
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
CREATE INDEX "prosecution_officers_case_idx" ON "prosecution_officers" ("criminal_case_id");
ALTER TABLE "prosecution_officers" ADD CONSTRAINT "prosecution_officers_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_officers" ADD CONSTRAINT "prosecution_officers_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_officers" ADD CONSTRAINT "prosecution_officers_agency_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."prosecution_agencies"("id") ON DELETE restrict ON UPDATE no action;

CREATE TABLE "prosecution_charges" (
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
CREATE INDEX "prosecution_charges_case_idx" ON "prosecution_charges" ("criminal_case_id");
CREATE UNIQUE INDEX "prosecution_charges_count_uidx" ON "prosecution_charges" ("criminal_case_id", "defendant_id", "count_number");
ALTER TABLE "prosecution_charges" ADD CONSTRAINT "prosecution_charges_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_charges" ADD CONSTRAINT "prosecution_charges_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_charges" ADD CONSTRAINT "prosecution_charges_defendant_fk" FOREIGN KEY ("defendant_id") REFERENCES "public"."prosecution_defendants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_charges" ADD CONSTRAINT "prosecution_charges_statute_fk" FOREIGN KEY ("statute_authority_id") REFERENCES "public"."legal_authorities"("id") ON DELETE set null ON UPDATE no action;

CREATE TABLE "prosecution_charge_elements" (
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
CREATE INDEX "prosecution_charge_elements_charge_idx" ON "prosecution_charge_elements" ("charge_id");
CREATE INDEX "prosecution_charge_elements_case_idx" ON "prosecution_charge_elements" ("criminal_case_id");
ALTER TABLE "prosecution_charge_elements" ADD CONSTRAINT "prosecution_charge_elements_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_charge_elements" ADD CONSTRAINT "prosecution_charge_elements_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_charge_elements" ADD CONSTRAINT "prosecution_charge_elements_charge_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."prosecution_charges"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_charge_elements" ADD CONSTRAINT "prosecution_charge_elements_standard_fk" FOREIGN KEY ("legal_standard_id") REFERENCES "public"."legal_standards"("id") ON DELETE set null ON UPDATE no action;

CREATE TABLE "prosecution_evidence_items" (
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
CREATE INDEX "prosecution_evidence_case_idx" ON "prosecution_evidence_items" ("criminal_case_id");
ALTER TABLE "prosecution_evidence_items" ADD CONSTRAINT "prosecution_evidence_items_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_evidence_items" ADD CONSTRAINT "prosecution_evidence_items_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "prosecution_evidence_links" (
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
CREATE INDEX "prosecution_evidence_links_case_idx" ON "prosecution_evidence_links" ("criminal_case_id");
ALTER TABLE "prosecution_evidence_links" ADD CONSTRAINT "prosecution_evidence_links_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_evidence_links" ADD CONSTRAINT "prosecution_evidence_links_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_evidence_links" ADD CONSTRAINT "prosecution_evidence_links_evidence_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."prosecution_evidence_items"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "prosecution_witnesses" (
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
CREATE INDEX "prosecution_witnesses_case_idx" ON "prosecution_witnesses" ("criminal_case_id");
ALTER TABLE "prosecution_witnesses" ADD CONSTRAINT "prosecution_witnesses_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_witnesses" ADD CONSTRAINT "prosecution_witnesses_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "prosecution_witness_statements" (
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
CREATE INDEX "prosecution_witness_statements_witness_idx" ON "prosecution_witness_statements" ("witness_id");
ALTER TABLE "prosecution_witness_statements" ADD CONSTRAINT "prosecution_witness_statements_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_witness_statements" ADD CONSTRAINT "prosecution_witness_statements_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_witness_statements" ADD CONSTRAINT "prosecution_witness_statements_witness_fk" FOREIGN KEY ("witness_id") REFERENCES "public"."prosecution_witnesses"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "prosecution_discovery_items" (
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
CREATE INDEX "prosecution_discovery_case_idx" ON "prosecution_discovery_items" ("criminal_case_id");
ALTER TABLE "prosecution_discovery_items" ADD CONSTRAINT "prosecution_discovery_items_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_discovery_items" ADD CONSTRAINT "prosecution_discovery_items_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "prosecution_disclosure_candidates" (
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
CREATE INDEX "prosecution_disclosure_case_idx" ON "prosecution_disclosure_candidates" ("criminal_case_id");
ALTER TABLE "prosecution_disclosure_candidates" ADD CONSTRAINT "prosecution_disclosure_candidates_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_disclosure_candidates" ADD CONSTRAINT "prosecution_disclosure_candidates_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_disclosure_candidates" ADD CONSTRAINT "prosecution_disclosure_candidates_actor_fk" FOREIGN KEY ("human_actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

CREATE TABLE "prosecution_procedure_issues" (
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
CREATE INDEX "prosecution_procedure_issues_case_idx" ON "prosecution_procedure_issues" ("criminal_case_id");
ALTER TABLE "prosecution_procedure_issues" ADD CONSTRAINT "prosecution_procedure_issues_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_procedure_issues" ADD CONSTRAINT "prosecution_procedure_issues_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "prosecution_warrants" (
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
CREATE INDEX "prosecution_warrants_case_idx" ON "prosecution_warrants" ("criminal_case_id");
ALTER TABLE "prosecution_warrants" ADD CONSTRAINT "prosecution_warrants_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_warrants" ADD CONSTRAINT "prosecution_warrants_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "prosecution_warrant_affidavits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "warrant_id" uuid NOT NULL,
  "affiant" text,
  "statement" text NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "prosecution_warrant_affidavits" ADD CONSTRAINT "prosecution_warrant_affidavits_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_warrant_affidavits" ADD CONSTRAINT "prosecution_warrant_affidavits_warrant_fk" FOREIGN KEY ("warrant_id") REFERENCES "public"."prosecution_warrants"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "prosecution_warrant_executions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "warrant_id" uuid NOT NULL,
  "executed_at" timestamp with time zone,
  "executed_by" text,
  "notes" text,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "prosecution_warrant_executions" ADD CONSTRAINT "prosecution_warrant_executions_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_warrant_executions" ADD CONSTRAINT "prosecution_warrant_executions_warrant_fk" FOREIGN KEY ("warrant_id") REFERENCES "public"."prosecution_warrants"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "prosecution_warrant_returns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "warrant_id" uuid NOT NULL,
  "returned_at" timestamp with time zone,
  "inventory" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "prosecution_warrant_returns" ADD CONSTRAINT "prosecution_warrant_returns_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_warrant_returns" ADD CONSTRAINT "prosecution_warrant_returns_warrant_fk" FOREIGN KEY ("warrant_id") REFERENCES "public"."prosecution_warrants"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "prosecution_motions" (
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
CREATE INDEX "prosecution_motions_case_idx" ON "prosecution_motions" ("criminal_case_id");
ALTER TABLE "prosecution_motions" ADD CONSTRAINT "prosecution_motions_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_motions" ADD CONSTRAINT "prosecution_motions_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "prosecution_hearings" (
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
CREATE INDEX "prosecution_hearings_case_idx" ON "prosecution_hearings" ("criminal_case_id");
ALTER TABLE "prosecution_hearings" ADD CONSTRAINT "prosecution_hearings_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_hearings" ADD CONSTRAINT "prosecution_hearings_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "prosecution_subpoenas" (
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
CREATE INDEX "prosecution_subpoenas_case_idx" ON "prosecution_subpoenas" ("criminal_case_id");
ALTER TABLE "prosecution_subpoenas" ADD CONSTRAINT "prosecution_subpoenas_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_subpoenas" ADD CONSTRAINT "prosecution_subpoenas_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "prosecution_plea_offers" (
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
CREATE INDEX "prosecution_plea_offers_case_idx" ON "prosecution_plea_offers" ("criminal_case_id");
ALTER TABLE "prosecution_plea_offers" ADD CONSTRAINT "prosecution_plea_offers_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_plea_offers" ADD CONSTRAINT "prosecution_plea_offers_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_plea_offers" ADD CONSTRAINT "prosecution_plea_offers_owner_fk" FOREIGN KEY ("human_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

CREATE TABLE "prosecution_dispositions" (
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
CREATE INDEX "prosecution_dispositions_case_idx" ON "prosecution_dispositions" ("criminal_case_id");
ALTER TABLE "prosecution_dispositions" ADD CONSTRAINT "prosecution_dispositions_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_dispositions" ADD CONSTRAINT "prosecution_dispositions_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_dispositions" ADD CONSTRAINT "prosecution_dispositions_charge_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."prosecution_charges"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "prosecution_sentences" (
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
CREATE INDEX "prosecution_sentences_case_idx" ON "prosecution_sentences" ("criminal_case_id");
ALTER TABLE "prosecution_sentences" ADD CONSTRAINT "prosecution_sentences_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_sentences" ADD CONSTRAINT "prosecution_sentences_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_sentences" ADD CONSTRAINT "prosecution_sentences_charge_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."prosecution_charges"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "prosecution_timeline_events" (
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
CREATE INDEX "prosecution_timeline_case_idx" ON "prosecution_timeline_events" ("criminal_case_id");
ALTER TABLE "prosecution_timeline_events" ADD CONSTRAINT "prosecution_timeline_events_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_timeline_events" ADD CONSTRAINT "prosecution_timeline_events_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_timeline_events" ADD CONSTRAINT "prosecution_timeline_events_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE set null ON UPDATE no action;

CREATE TABLE "prosecution_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "title" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "due_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "prosecution_tasks_case_idx" ON "prosecution_tasks" ("criminal_case_id");
ALTER TABLE "prosecution_tasks" ADD CONSTRAINT "prosecution_tasks_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_tasks" ADD CONSTRAINT "prosecution_tasks_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "prosecution_graph_nodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "node_type" text NOT NULL,
  "ref_id" text NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "prosecution_graph_nodes_ref_uidx" ON "prosecution_graph_nodes" ("criminal_case_id", "node_type", "ref_id");
CREATE INDEX "prosecution_graph_nodes_case_idx" ON "prosecution_graph_nodes" ("criminal_case_id");
ALTER TABLE "prosecution_graph_nodes" ADD CONSTRAINT "prosecution_graph_nodes_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_graph_nodes" ADD CONSTRAINT "prosecution_graph_nodes_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "prosecution_graph_edges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "from_ref" text NOT NULL,
  "to_ref" text NOT NULL,
  "relationship" text NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "prosecution_graph_edges_case_idx" ON "prosecution_graph_edges" ("criminal_case_id");
ALTER TABLE "prosecution_graph_edges" ADD CONSTRAINT "prosecution_graph_edges_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_graph_edges" ADD CONSTRAINT "prosecution_graph_edges_case_fk" FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;
