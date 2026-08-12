CREATE TYPE "public"."intelligence_status" AS ENUM('proposed', 'approved', 'edited_and_approved', 'rejected');
CREATE TYPE "public"."date_precision" AS ENUM('exact', 'approximate', 'month', 'year', 'range', 'unknown');
CREATE TYPE "public"."intelligence_origin" AS ENUM('ai', 'manual');
CREATE TYPE "public"."matter_entity_type" AS ENUM('person', 'organization');
CREATE TYPE "public"."deadline_date_kind" AS ENUM('explicit', 'inferred');
CREATE TYPE "public"."confidence_level" AS ENUM('low', 'medium', 'high');
CREATE TYPE "public"."intelligence_run_status" AS ENUM('queued', 'running', 'completed', 'failed', 'skipped');

CREATE TABLE "document_intelligence_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "document_version_id" uuid NOT NULL,
  "run_kind" text NOT NULL,
  "status" "intelligence_run_status" DEFAULT 'queued' NOT NULL,
  "idempotency_key" text NOT NULL,
  "provider" text,
  "model" text,
  "prompt_version" text,
  "stats" jsonb DEFAULT '{}'::jsonb,
  "last_error" text,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);

CREATE UNIQUE INDEX "document_intelligence_runs_idempotency_uidx" ON "document_intelligence_runs" ("idempotency_key");
CREATE INDEX "document_intelligence_runs_matter_idx" ON "document_intelligence_runs" ("matter_id");
CREATE INDEX "document_intelligence_runs_document_version_idx" ON "document_intelligence_runs" ("document_version_id");

ALTER TABLE "document_intelligence_runs" ADD CONSTRAINT "document_intelligence_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_intelligence_runs" ADD CONSTRAINT "document_intelligence_runs_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_intelligence_runs" ADD CONSTRAINT "document_intelligence_runs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_intelligence_runs" ADD CONSTRAINT "document_intelligence_runs_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_intelligence_runs" ADD CONSTRAINT "document_intelligence_runs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

CREATE TABLE "timeline_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "event_type" text NOT NULL,
  "event_date" timestamp with time zone,
  "event_date_end" timestamp with time zone,
  "date_precision" "date_precision" DEFAULT 'unknown' NOT NULL,
  "status" "intelligence_status" DEFAULT 'proposed' NOT NULL,
  "confidence" "confidence_level" DEFAULT 'medium' NOT NULL,
  "origin" "intelligence_origin" DEFAULT 'ai' NOT NULL,
  "actors" jsonb DEFAULT '[]'::jsonb,
  "uncertainty_notes" text,
  "dedupe_key" text,
  "extraction_run_id" uuid,
  "created_by_user_id" uuid,
  "approved_by_user_id" uuid,
  "approved_at" timestamp with time zone,
  "rejected_by_user_id" uuid,
  "rejected_at" timestamp with time zone,
  "rejection_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "timeline_events_matter_idx" ON "timeline_events" ("matter_id");
CREATE INDEX "timeline_events_organization_idx" ON "timeline_events" ("organization_id");
CREATE INDEX "timeline_events_status_idx" ON "timeline_events" ("status");
CREATE INDEX "timeline_events_event_date_idx" ON "timeline_events" ("event_date");
CREATE INDEX "timeline_events_dedupe_idx" ON "timeline_events" ("matter_id", "dedupe_key");

ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_extraction_run_id_document_intelligence_runs_id_fk" FOREIGN KEY ("extraction_run_id") REFERENCES "public"."document_intelligence_runs"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_rejected_by_user_id_users_id_fk" FOREIGN KEY ("rejected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

CREATE TABLE "timeline_event_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "timeline_event_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "document_version_id" uuid NOT NULL,
  "chunk_id" uuid NOT NULL,
  "page" integer,
  "segment_ref" text,
  "supporting_text" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "timeline_event_sources_event_idx" ON "timeline_event_sources" ("timeline_event_id");
CREATE INDEX "timeline_event_sources_chunk_idx" ON "timeline_event_sources" ("chunk_id");
CREATE UNIQUE INDEX "timeline_event_sources_event_chunk_uidx" ON "timeline_event_sources" ("timeline_event_id", "chunk_id");

ALTER TABLE "timeline_event_sources" ADD CONSTRAINT "timeline_event_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "timeline_event_sources" ADD CONSTRAINT "timeline_event_sources_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "timeline_event_sources" ADD CONSTRAINT "timeline_event_sources_timeline_event_id_timeline_events_id_fk" FOREIGN KEY ("timeline_event_id") REFERENCES "public"."timeline_events"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "timeline_event_sources" ADD CONSTRAINT "timeline_event_sources_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "timeline_event_sources" ADD CONSTRAINT "timeline_event_sources_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "timeline_event_sources" ADD CONSTRAINT "timeline_event_sources_chunk_id_document_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."document_chunks"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "matter_facts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "fact_key" text NOT NULL,
  "label" text NOT NULL,
  "value" text NOT NULL,
  "normalized_value" text,
  "status" "intelligence_status" DEFAULT 'proposed' NOT NULL,
  "confidence" "confidence_level" DEFAULT 'medium' NOT NULL,
  "origin" "intelligence_origin" DEFAULT 'ai' NOT NULL,
  "uncertainty_notes" text,
  "extraction_run_id" uuid,
  "created_by_user_id" uuid,
  "approved_by_user_id" uuid,
  "approved_at" timestamp with time zone,
  "rejected_by_user_id" uuid,
  "rejected_at" timestamp with time zone,
  "rejection_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "matter_facts_matter_idx" ON "matter_facts" ("matter_id");
CREATE INDEX "matter_facts_status_idx" ON "matter_facts" ("status");

ALTER TABLE "matter_facts" ADD CONSTRAINT "matter_facts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "matter_facts" ADD CONSTRAINT "matter_facts_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "matter_facts" ADD CONSTRAINT "matter_facts_extraction_run_id_document_intelligence_runs_id_fk" FOREIGN KEY ("extraction_run_id") REFERENCES "public"."document_intelligence_runs"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "matter_facts" ADD CONSTRAINT "matter_facts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "matter_facts" ADD CONSTRAINT "matter_facts_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "matter_facts" ADD CONSTRAINT "matter_facts_rejected_by_user_id_users_id_fk" FOREIGN KEY ("rejected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

CREATE TABLE "matter_fact_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "matter_fact_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "document_version_id" uuid NOT NULL,
  "chunk_id" uuid NOT NULL,
  "page" integer,
  "segment_ref" text,
  "supporting_text" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "matter_fact_sources_fact_chunk_uidx" ON "matter_fact_sources" ("matter_fact_id", "chunk_id");
CREATE INDEX "matter_fact_sources_fact_idx" ON "matter_fact_sources" ("matter_fact_id");

ALTER TABLE "matter_fact_sources" ADD CONSTRAINT "matter_fact_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "matter_fact_sources" ADD CONSTRAINT "matter_fact_sources_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "matter_fact_sources" ADD CONSTRAINT "matter_fact_sources_matter_fact_id_matter_facts_id_fk" FOREIGN KEY ("matter_fact_id") REFERENCES "public"."matter_facts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "matter_fact_sources" ADD CONSTRAINT "matter_fact_sources_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "matter_fact_sources" ADD CONSTRAINT "matter_fact_sources_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "matter_fact_sources" ADD CONSTRAINT "matter_fact_sources_chunk_id_document_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."document_chunks"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "matter_entities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "entity_type" "matter_entity_type" NOT NULL,
  "display_name" text NOT NULL,
  "normalized_name" text NOT NULL,
  "description" text,
  "status" "intelligence_status" DEFAULT 'proposed' NOT NULL,
  "confidence" "confidence_level" DEFAULT 'medium' NOT NULL,
  "origin" "intelligence_origin" DEFAULT 'ai' NOT NULL,
  "merged_into_entity_id" uuid,
  "extraction_run_id" uuid,
  "created_by_user_id" uuid,
  "approved_by_user_id" uuid,
  "approved_at" timestamp with time zone,
  "rejected_by_user_id" uuid,
  "rejected_at" timestamp with time zone,
  "rejection_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "matter_entities_matter_idx" ON "matter_entities" ("matter_id");
CREATE INDEX "matter_entities_normalized_idx" ON "matter_entities" ("matter_id", "normalized_name");
CREATE INDEX "matter_entities_status_idx" ON "matter_entities" ("status");

ALTER TABLE "matter_entities" ADD CONSTRAINT "matter_entities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "matter_entities" ADD CONSTRAINT "matter_entities_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "matter_entities" ADD CONSTRAINT "matter_entities_merged_into_entity_id_matter_entities_id_fk" FOREIGN KEY ("merged_into_entity_id") REFERENCES "public"."matter_entities"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "matter_entities" ADD CONSTRAINT "matter_entities_extraction_run_id_document_intelligence_runs_id_fk" FOREIGN KEY ("extraction_run_id") REFERENCES "public"."document_intelligence_runs"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "matter_entities" ADD CONSTRAINT "matter_entities_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "matter_entities" ADD CONSTRAINT "matter_entities_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "matter_entities" ADD CONSTRAINT "matter_entities_rejected_by_user_id_users_id_fk" FOREIGN KEY ("rejected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

CREATE TABLE "entity_aliases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "entity_id" uuid NOT NULL,
  "alias" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "entity_aliases_entity_alias_uidx" ON "entity_aliases" ("entity_id", "alias");
CREATE INDEX "entity_aliases_matter_idx" ON "entity_aliases" ("matter_id");

ALTER TABLE "entity_aliases" ADD CONSTRAINT "entity_aliases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "entity_aliases" ADD CONSTRAINT "entity_aliases_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "entity_aliases" ADD CONSTRAINT "entity_aliases_entity_id_matter_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."matter_entities"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "entity_roles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "entity_id" uuid NOT NULL,
  "role" text NOT NULL,
  "status" "intelligence_status" DEFAULT 'proposed' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "entity_roles_entity_role_uidx" ON "entity_roles" ("entity_id", "role");
CREATE INDEX "entity_roles_matter_idx" ON "entity_roles" ("matter_id");

ALTER TABLE "entity_roles" ADD CONSTRAINT "entity_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "entity_roles" ADD CONSTRAINT "entity_roles_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "entity_roles" ADD CONSTRAINT "entity_roles_entity_id_matter_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."matter_entities"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "entity_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "entity_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "document_version_id" uuid NOT NULL,
  "chunk_id" uuid NOT NULL,
  "page" integer,
  "segment_ref" text,
  "supporting_text" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "entity_sources_entity_chunk_uidx" ON "entity_sources" ("entity_id", "chunk_id");
CREATE INDEX "entity_sources_entity_idx" ON "entity_sources" ("entity_id");

ALTER TABLE "entity_sources" ADD CONSTRAINT "entity_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "entity_sources" ADD CONSTRAINT "entity_sources_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "entity_sources" ADD CONSTRAINT "entity_sources_entity_id_matter_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."matter_entities"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "entity_sources" ADD CONSTRAINT "entity_sources_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "entity_sources" ADD CONSTRAINT "entity_sources_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "entity_sources" ADD CONSTRAINT "entity_sources_chunk_id_document_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."document_chunks"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "deadline_candidates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "due_at" timestamp with time zone,
  "due_at_end" timestamp with time zone,
  "date_precision" "date_precision" DEFAULT 'unknown' NOT NULL,
  "date_kind" "deadline_date_kind" DEFAULT 'explicit' NOT NULL,
  "timezone" text,
  "status" "intelligence_status" DEFAULT 'proposed' NOT NULL,
  "confidence" "confidence_level" DEFAULT 'medium' NOT NULL,
  "origin" "intelligence_origin" DEFAULT 'ai' NOT NULL,
  "uncertainty_notes" text,
  "extraction_run_id" uuid,
  "created_by_user_id" uuid,
  "approved_by_user_id" uuid,
  "approved_at" timestamp with time zone,
  "rejected_by_user_id" uuid,
  "rejected_at" timestamp with time zone,
  "rejection_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "deadline_candidates_matter_idx" ON "deadline_candidates" ("matter_id");
CREATE INDEX "deadline_candidates_status_idx" ON "deadline_candidates" ("status");
CREATE INDEX "deadline_candidates_due_at_idx" ON "deadline_candidates" ("due_at");

ALTER TABLE "deadline_candidates" ADD CONSTRAINT "deadline_candidates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "deadline_candidates" ADD CONSTRAINT "deadline_candidates_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "deadline_candidates" ADD CONSTRAINT "deadline_candidates_extraction_run_id_document_intelligence_runs_id_fk" FOREIGN KEY ("extraction_run_id") REFERENCES "public"."document_intelligence_runs"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "deadline_candidates" ADD CONSTRAINT "deadline_candidates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "deadline_candidates" ADD CONSTRAINT "deadline_candidates_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "deadline_candidates" ADD CONSTRAINT "deadline_candidates_rejected_by_user_id_users_id_fk" FOREIGN KEY ("rejected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

CREATE TABLE "deadline_candidate_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "deadline_candidate_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "document_version_id" uuid NOT NULL,
  "chunk_id" uuid NOT NULL,
  "page" integer,
  "segment_ref" text,
  "supporting_text" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "deadline_candidate_sources_deadline_chunk_uidx" ON "deadline_candidate_sources" ("deadline_candidate_id", "chunk_id");
CREATE INDEX "deadline_candidate_sources_deadline_idx" ON "deadline_candidate_sources" ("deadline_candidate_id");

ALTER TABLE "deadline_candidate_sources" ADD CONSTRAINT "deadline_candidate_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "deadline_candidate_sources" ADD CONSTRAINT "deadline_candidate_sources_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "deadline_candidate_sources" ADD CONSTRAINT "deadline_candidate_sources_deadline_candidate_id_deadline_candidates_id_fk" FOREIGN KEY ("deadline_candidate_id") REFERENCES "public"."deadline_candidates"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "deadline_candidate_sources" ADD CONSTRAINT "deadline_candidate_sources_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "deadline_candidate_sources" ADD CONSTRAINT "deadline_candidate_sources_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "deadline_candidate_sources" ADD CONSTRAINT "deadline_candidate_sources_chunk_id_document_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."document_chunks"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "matter_summaries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "summary" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "prompt_version" text NOT NULL,
  "provenance" jsonb DEFAULT '{}'::jsonb,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "matter_summaries_matter_idx" ON "matter_summaries" ("matter_id");

ALTER TABLE "matter_summaries" ADD CONSTRAINT "matter_summaries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "matter_summaries" ADD CONSTRAINT "matter_summaries_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "matter_summaries" ADD CONSTRAINT "matter_summaries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
