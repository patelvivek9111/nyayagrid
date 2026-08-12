CREATE TYPE "public"."authority_type" AS ENUM('case', 'statute', 'regulation', 'constitution', 'rule', 'administrative_decision', 'other');
CREATE TYPE "public"."authority_ingestion_status" AS ENUM('pending', 'processing', 'ready', 'failed');
CREATE TYPE "public"."authority_treatment_status" AS ENUM('unknown', 'source_reported');
CREATE TYPE "public"."authority_relationship_type" AS ENUM('cites', 'interprets', 'supersedes', 'amends', 'related');
CREATE TYPE "public"."research_session_status" AS ENUM('active', 'archived');
CREATE TYPE "public"."matter_authority_status" AS ENUM('saved', 'key_authority', 'rejected', 'not_relevant');
CREATE TYPE "public"."authority_weight_label" AS ENUM('potentially_binding', 'persuasive', 'unknown');

CREATE TABLE "legal_authorities" (
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
CREATE UNIQUE INDEX "legal_authorities_source_uidx" ON "legal_authorities" ("source_provider", "source_external_id") WHERE "source_provider" IS NOT NULL AND "source_external_id" IS NOT NULL;
CREATE INDEX "legal_authorities_citation_idx" ON "legal_authorities" ("citation");
CREATE INDEX "legal_authorities_normalized_citation_idx" ON "legal_authorities" ("normalized_citation");
CREATE INDEX "legal_authorities_jurisdiction_idx" ON "legal_authorities" ("jurisdiction");
CREATE INDEX "legal_authorities_type_idx" ON "legal_authorities" ("authority_type");

CREATE TABLE "legal_authority_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "authority_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "content" text NOT NULL,
  "effective_from" date,
  "effective_to" date,
  "valid_from" timestamp with time zone DEFAULT now() NOT NULL,
  "valid_to" timestamp with time zone,
  "source_provider" text,
  "source_metadata" jsonb DEFAULT '{}'::jsonb,
  "sha256" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "legal_authority_versions_authority_version_uidx" ON "legal_authority_versions" ("authority_id", "version_number");
CREATE INDEX "legal_authority_versions_authority_idx" ON "legal_authority_versions" ("authority_id");
ALTER TABLE "legal_authority_versions" ADD CONSTRAINT "legal_authority_versions_authority_fk" FOREIGN KEY ("authority_id") REFERENCES "public"."legal_authorities"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "legal_authority_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "authority_id" uuid NOT NULL,
  "authority_version_id" uuid NOT NULL,
  "chunk_index" integer NOT NULL,
  "content" text NOT NULL,
  "opinion_part" text,
  "section_ref" text,
  "subsection_ref" text,
  "page_start" integer,
  "page_end" integer,
  "segment_ref" text,
  "char_start" integer,
  "char_end" integer,
  "token_count" integer,
  "search_vector" text,
  "embedding" vector(384),
  "embedding_model" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "legal_authority_chunks_version_index_uidx" ON "legal_authority_chunks" ("authority_version_id", "chunk_index");
CREATE INDEX "legal_authority_chunks_authority_idx" ON "legal_authority_chunks" ("authority_id");
CREATE INDEX "legal_authority_chunks_fts_idx" ON "legal_authority_chunks" USING gin (to_tsvector('english', "content"));
ALTER TABLE "legal_authority_chunks" ADD CONSTRAINT "legal_authority_chunks_authority_fk" FOREIGN KEY ("authority_id") REFERENCES "public"."legal_authorities"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "legal_authority_chunks" ADD CONSTRAINT "legal_authority_chunks_version_fk" FOREIGN KEY ("authority_version_id") REFERENCES "public"."legal_authority_versions"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "legal_authority_citations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "from_authority_id" uuid NOT NULL,
  "to_authority_id" uuid,
  "raw_citation" text NOT NULL,
  "normalized_citation" text,
  "pinpoint" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "legal_authority_citations_from_idx" ON "legal_authority_citations" ("from_authority_id");
CREATE INDEX "legal_authority_citations_to_idx" ON "legal_authority_citations" ("to_authority_id");
CREATE INDEX "legal_authority_citations_normalized_idx" ON "legal_authority_citations" ("normalized_citation");
ALTER TABLE "legal_authority_citations" ADD CONSTRAINT "legal_authority_citations_from_fk" FOREIGN KEY ("from_authority_id") REFERENCES "public"."legal_authorities"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "legal_authority_citations" ADD CONSTRAINT "legal_authority_citations_to_fk" FOREIGN KEY ("to_authority_id") REFERENCES "public"."legal_authorities"("id") ON DELETE set null ON UPDATE no action;

CREATE TABLE "legal_authority_relationships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "from_authority_id" uuid NOT NULL,
  "to_authority_id" uuid NOT NULL,
  "relationship_type" "authority_relationship_type" NOT NULL,
  "label" text,
  "origin" text NOT NULL,
  "treatment_status" "authority_treatment_status" DEFAULT 'unknown' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "legal_authority_relationships_edge_uidx" ON "legal_authority_relationships" ("from_authority_id", "to_authority_id", "relationship_type");
CREATE INDEX "legal_authority_relationships_from_idx" ON "legal_authority_relationships" ("from_authority_id");
ALTER TABLE "legal_authority_relationships" ADD CONSTRAINT "legal_authority_relationships_from_fk" FOREIGN KEY ("from_authority_id") REFERENCES "public"."legal_authorities"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "legal_authority_relationships" ADD CONSTRAINT "legal_authority_relationships_to_fk" FOREIGN KEY ("to_authority_id") REFERENCES "public"."legal_authorities"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "research_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid,
  "created_by_user_id" uuid,
  "title" text NOT NULL,
  "status" "research_session_status" DEFAULT 'active' NOT NULL,
  "jurisdiction_filters" jsonb DEFAULT '[]'::jsonb,
  "authority_type_filters" jsonb DEFAULT '[]'::jsonb,
  "date_from" date,
  "date_to" date,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "research_sessions_organization_idx" ON "research_sessions" ("organization_id");
CREATE INDEX "research_sessions_matter_idx" ON "research_sessions" ("matter_id");
ALTER TABLE "research_sessions" ADD CONSTRAINT "research_sessions_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "research_sessions" ADD CONSTRAINT "research_sessions_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "research_sessions" ADD CONSTRAINT "research_sessions_created_by_user_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

CREATE TABLE "research_queries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "query_text" text NOT NULL,
  "normalized_query" text,
  "filters" jsonb DEFAULT '{}'::jsonb,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "research_queries_session_idx" ON "research_queries" ("session_id");
CREATE INDEX "research_queries_organization_idx" ON "research_queries" ("organization_id");
ALTER TABLE "research_queries" ADD CONSTRAINT "research_queries_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "research_queries" ADD CONSTRAINT "research_queries_session_fk" FOREIGN KEY ("session_id") REFERENCES "public"."research_sessions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "research_queries" ADD CONSTRAINT "research_queries_created_by_user_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

CREATE TABLE "research_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "query_id" uuid NOT NULL,
  "authority_id" uuid NOT NULL,
  "authority_version_id" uuid NOT NULL,
  "chunk_id" uuid,
  "score" real,
  "snippet" text,
  "relevance_explanation" text,
  "rank" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "research_results_query_idx" ON "research_results" ("query_id");
CREATE INDEX "research_results_session_idx" ON "research_results" ("session_id");
CREATE INDEX "research_results_authority_idx" ON "research_results" ("authority_id");
ALTER TABLE "research_results" ADD CONSTRAINT "research_results_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "research_results" ADD CONSTRAINT "research_results_session_fk" FOREIGN KEY ("session_id") REFERENCES "public"."research_sessions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "research_results" ADD CONSTRAINT "research_results_query_fk" FOREIGN KEY ("query_id") REFERENCES "public"."research_queries"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "research_results" ADD CONSTRAINT "research_results_authority_fk" FOREIGN KEY ("authority_id") REFERENCES "public"."legal_authorities"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "research_results" ADD CONSTRAINT "research_results_authority_version_fk" FOREIGN KEY ("authority_version_id") REFERENCES "public"."legal_authority_versions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "research_results" ADD CONSTRAINT "research_results_chunk_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."legal_authority_chunks"("id") ON DELETE set null ON UPDATE no action;

CREATE TABLE "research_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "session_id" uuid,
  "matter_id" uuid,
  "authority_id" uuid,
  "authority_chunk_id" uuid,
  "content" text NOT NULL,
  "origin" text DEFAULT 'manual' NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "research_notes_session_idx" ON "research_notes" ("session_id");
CREATE INDEX "research_notes_matter_idx" ON "research_notes" ("matter_id");
CREATE INDEX "research_notes_organization_idx" ON "research_notes" ("organization_id");
ALTER TABLE "research_notes" ADD CONSTRAINT "research_notes_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "research_notes" ADD CONSTRAINT "research_notes_session_fk" FOREIGN KEY ("session_id") REFERENCES "public"."research_sessions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "research_notes" ADD CONSTRAINT "research_notes_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "research_notes" ADD CONSTRAINT "research_notes_authority_fk" FOREIGN KEY ("authority_id") REFERENCES "public"."legal_authorities"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "research_notes" ADD CONSTRAINT "research_notes_authority_chunk_fk" FOREIGN KEY ("authority_chunk_id") REFERENCES "public"."legal_authority_chunks"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "research_notes" ADD CONSTRAINT "research_notes_created_by_user_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

CREATE TABLE "research_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "session_id" uuid,
  "matter_id" uuid,
  "artifact_type" text NOT NULL,
  "issue" text,
  "answer" text,
  "propositions" jsonb DEFAULT '[]'::jsonb,
  "supporting_authorities" jsonb DEFAULT '[]'::jsonb,
  "contrary_authorities" jsonb DEFAULT '[]'::jsonb,
  "jurisdiction_assumptions" jsonb DEFAULT '[]'::jsonb,
  "coverage_warnings" jsonb DEFAULT '[]'::jsonb,
  "provider" text,
  "model" text,
  "prompt_version" text,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "research_artifacts_session_idx" ON "research_artifacts" ("session_id");
CREATE INDEX "research_artifacts_matter_idx" ON "research_artifacts" ("matter_id");
CREATE INDEX "research_artifacts_organization_idx" ON "research_artifacts" ("organization_id");
ALTER TABLE "research_artifacts" ADD CONSTRAINT "research_artifacts_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "research_artifacts" ADD CONSTRAINT "research_artifacts_session_fk" FOREIGN KEY ("session_id") REFERENCES "public"."research_sessions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "research_artifacts" ADD CONSTRAINT "research_artifacts_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "research_artifacts" ADD CONSTRAINT "research_artifacts_created_by_user_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

CREATE TABLE "matter_authorities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "authority_id" uuid NOT NULL,
  "status" "matter_authority_status" DEFAULT 'saved' NOT NULL,
  "relevance_note" text,
  "added_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "matter_authorities_matter_authority_uidx" ON "matter_authorities" ("matter_id", "authority_id");
CREATE INDEX "matter_authorities_organization_idx" ON "matter_authorities" ("organization_id");
CREATE INDEX "matter_authorities_authority_idx" ON "matter_authorities" ("authority_id");
ALTER TABLE "matter_authorities" ADD CONSTRAINT "matter_authorities_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "matter_authorities" ADD CONSTRAINT "matter_authorities_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "matter_authorities" ADD CONSTRAINT "matter_authorities_authority_fk" FOREIGN KEY ("authority_id") REFERENCES "public"."legal_authorities"("id") ON DELETE cascade ON UPDATE no action;
