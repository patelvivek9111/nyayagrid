CREATE TYPE "public"."draft_status" AS ENUM('draft', 'in_review', 'final', 'archived');
CREATE TYPE "public"."draft_origin" AS ENUM('manual', 'ai', 'ai_edited');
CREATE TYPE "public"."analysis_attention" AS ENUM('informational', 'review', 'high_attention');
CREATE TYPE "public"."analysis_item_status" AS ENUM('proposed', 'reviewed', 'dismissed');
CREATE TYPE "public"."redline_status" AS ENUM('proposed', 'accepted', 'rejected');
CREATE TYPE "public"."comparison_change_type" AS ENUM('added', 'removed', 'changed', 'moved', 'formatting');
CREATE TYPE "public"."analysis_run_type" AS ENUM('contract', 'deposition', 'evidence', 'contradiction', 'document_review', 'discovery', 'comparison');
CREATE TYPE "public"."relevance_status" AS ENUM('unknown', 'relevant', 'not_relevant');
CREATE TYPE "public"."privilege_status" AS ENUM('unknown', 'potentially_privileged', 'privileged', 'not_privileged');
CREATE TYPE "public"."responsiveness_status" AS ENUM('unknown', 'responsive', 'not_responsive');
CREATE TYPE "public"."confidentiality_status" AS ENUM('unknown', 'confidential', 'not_confidential');

CREATE TABLE "drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "title" text NOT NULL,
  "draft_type" text NOT NULL,
  "status" "draft_status" DEFAULT 'draft' NOT NULL,
  "current_version_number" integer DEFAULT 1 NOT NULL,
  "ai_generated" boolean DEFAULT false NOT NULL,
  "source_context" jsonb DEFAULT '{}'::jsonb,
  "prompt_version" text,
  "provider" text,
  "model" text,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "drafts_matter_idx" ON "drafts" ("matter_id");
CREATE INDEX "drafts_organization_idx" ON "drafts" ("organization_id");
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

CREATE TABLE "draft_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "draft_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "content" text NOT NULL,
  "change_summary" text,
  "origin" "draft_origin" DEFAULT 'manual' NOT NULL,
  "source_assertions" jsonb DEFAULT '[]'::jsonb,
  "provider" text,
  "model" text,
  "prompt_version" text,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "draft_versions_draft_version_uidx" ON "draft_versions" ("draft_id", "version_number");
CREATE INDEX "draft_versions_matter_idx" ON "draft_versions" ("matter_id");
ALTER TABLE "draft_versions" ADD CONSTRAINT "draft_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "draft_versions" ADD CONSTRAINT "draft_versions_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "draft_versions" ADD CONSTRAINT "draft_versions_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "draft_versions" ADD CONSTRAINT "draft_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

CREATE TABLE "document_analyses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "document_version_id" uuid NOT NULL,
  "analysis_type" text DEFAULT 'contract' NOT NULL,
  "summary" text,
  "status" "analysis_item_status" DEFAULT 'proposed' NOT NULL,
  "provider" text,
  "model" text,
  "prompt_version" text,
  "idempotency_key" text NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "document_analyses_idempotency_uidx" ON "document_analyses" ("idempotency_key");
CREATE INDEX "document_analyses_matter_idx" ON "document_analyses" ("matter_id");
CREATE INDEX "document_analyses_document_idx" ON "document_analyses" ("document_id");
ALTER TABLE "document_analyses" ADD CONSTRAINT "document_analyses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_analyses" ADD CONSTRAINT "document_analyses_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_analyses" ADD CONSTRAINT "document_analyses_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_analyses" ADD CONSTRAINT "document_analyses_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_analyses" ADD CONSTRAINT "document_analyses_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

CREATE TABLE "document_analysis_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "analysis_id" uuid NOT NULL,
  "category" text NOT NULL,
  "title" text NOT NULL,
  "summary" text,
  "original_text" text,
  "explanation" text,
  "attention" "analysis_attention" DEFAULT 'informational' NOT NULL,
  "status" "analysis_item_status" DEFAULT 'proposed' NOT NULL,
  "confidence" "confidence_level" DEFAULT 'medium' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reviewed_by_user_id" uuid,
  "reviewed_at" timestamp with time zone
);
CREATE INDEX "document_analysis_items_analysis_idx" ON "document_analysis_items" ("analysis_id");
ALTER TABLE "document_analysis_items" ADD CONSTRAINT "document_analysis_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_analysis_items" ADD CONSTRAINT "document_analysis_items_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_analysis_items" ADD CONSTRAINT "document_analysis_items_analysis_id_document_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."document_analyses"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_analysis_items" ADD CONSTRAINT "document_analysis_items_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

CREATE TABLE "document_analysis_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "analysis_item_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "document_version_id" uuid NOT NULL,
  "chunk_id" uuid NOT NULL,
  "page" integer,
  "segment_ref" text,
  "supporting_text" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "document_analysis_sources_item_chunk_uidx" ON "document_analysis_sources" ("analysis_item_id", "chunk_id");
ALTER TABLE "document_analysis_sources" ADD CONSTRAINT "document_analysis_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_analysis_sources" ADD CONSTRAINT "document_analysis_sources_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_analysis_sources" ADD CONSTRAINT "document_analysis_sources_analysis_item_id_document_analysis_items_id_fk" FOREIGN KEY ("analysis_item_id") REFERENCES "public"."document_analysis_items"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_analysis_sources" ADD CONSTRAINT "document_analysis_sources_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_analysis_sources" ADD CONSTRAINT "document_analysis_sources_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_analysis_sources" ADD CONSTRAINT "document_analysis_sources_chunk_id_document_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."document_chunks"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "redline_suggestions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "analysis_id" uuid,
  "document_id" uuid NOT NULL,
  "document_version_id" uuid NOT NULL,
  "current_clause" text NOT NULL,
  "proposed_clause" text NOT NULL,
  "reason" text NOT NULL,
  "issue" text,
  "status" "redline_status" DEFAULT 'proposed' NOT NULL,
  "chunk_id" uuid,
  "created_by_user_id" uuid,
  "reviewed_by_user_id" uuid,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "redline_suggestions_matter_idx" ON "redline_suggestions" ("matter_id");
ALTER TABLE "redline_suggestions" ADD CONSTRAINT "redline_suggestions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "redline_suggestions" ADD CONSTRAINT "redline_suggestions_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "redline_suggestions" ADD CONSTRAINT "redline_suggestions_analysis_id_document_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."document_analyses"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "redline_suggestions" ADD CONSTRAINT "redline_suggestions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "redline_suggestions" ADD CONSTRAINT "redline_suggestions_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "redline_suggestions" ADD CONSTRAINT "redline_suggestions_chunk_id_document_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."document_chunks"("id") ON DELETE set null ON UPDATE no action;

CREATE TABLE "document_comparisons" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "document_a_id" uuid NOT NULL,
  "document_a_version_id" uuid NOT NULL,
  "document_b_id" uuid NOT NULL,
  "document_b_version_id" uuid NOT NULL,
  "summary" text,
  "idempotency_key" text NOT NULL,
  "provider" text,
  "model" text,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "document_comparisons_idempotency_uidx" ON "document_comparisons" ("idempotency_key");
CREATE INDEX "document_comparisons_matter_idx" ON "document_comparisons" ("matter_id");
ALTER TABLE "document_comparisons" ADD CONSTRAINT "document_comparisons_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_comparisons" ADD CONSTRAINT "document_comparisons_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_comparisons" ADD CONSTRAINT "document_comparisons_document_a_id_documents_id_fk" FOREIGN KEY ("document_a_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_comparisons" ADD CONSTRAINT "document_comparisons_document_a_version_id_document_versions_id_fk" FOREIGN KEY ("document_a_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_comparisons" ADD CONSTRAINT "document_comparisons_document_b_id_documents_id_fk" FOREIGN KEY ("document_b_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_comparisons" ADD CONSTRAINT "document_comparisons_document_b_version_id_document_versions_id_fk" FOREIGN KEY ("document_b_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "document_comparison_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "comparison_id" uuid NOT NULL,
  "change_type" "comparison_change_type" NOT NULL,
  "location_a" text,
  "location_b" text,
  "old_text" text,
  "new_text" text,
  "explanation" text,
  "attention" "analysis_attention" DEFAULT 'informational' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "document_comparison_changes_comparison_idx" ON "document_comparison_changes" ("comparison_id");
ALTER TABLE "document_comparison_changes" ADD CONSTRAINT "document_comparison_changes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_comparison_changes" ADD CONSTRAINT "document_comparison_changes_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_comparison_changes" ADD CONSTRAINT "document_comparison_changes_comparison_id_document_comparisons_id_fk" FOREIGN KEY ("comparison_id") REFERENCES "public"."document_comparisons"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "analysis_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "run_type" "analysis_run_type" NOT NULL,
  "document_id" uuid,
  "document_version_id" uuid,
  "status" "analysis_item_status" DEFAULT 'proposed' NOT NULL,
  "summary" text,
  "idempotency_key" text NOT NULL,
  "provider" text,
  "model" text,
  "prompt_version" text,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "analysis_runs_idempotency_uidx" ON "analysis_runs" ("idempotency_key");
CREATE INDEX "analysis_runs_matter_idx" ON "analysis_runs" ("matter_id");
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "analysis_findings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "analysis_run_id" uuid NOT NULL,
  "finding_type" text NOT NULL,
  "title" text NOT NULL,
  "explanation" text,
  "confidence" "confidence_level" DEFAULT 'medium' NOT NULL,
  "status" "analysis_item_status" DEFAULT 'proposed' NOT NULL,
  "attention" "analysis_attention" DEFAULT 'review' NOT NULL,
  "reviewed_by_user_id" uuid,
  "reviewed_at" timestamp with time zone,
  "review_note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "analysis_findings_run_idx" ON "analysis_findings" ("analysis_run_id");
CREATE INDEX "analysis_findings_matter_idx" ON "analysis_findings" ("matter_id");
ALTER TABLE "analysis_findings" ADD CONSTRAINT "analysis_findings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "analysis_findings" ADD CONSTRAINT "analysis_findings_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "analysis_findings" ADD CONSTRAINT "analysis_findings_analysis_run_id_analysis_runs_id_fk" FOREIGN KEY ("analysis_run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "analysis_findings" ADD CONSTRAINT "analysis_findings_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

CREATE TABLE "analysis_finding_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "finding_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "document_version_id" uuid NOT NULL,
  "chunk_id" uuid NOT NULL,
  "page" integer,
  "segment_ref" text,
  "supporting_text" text NOT NULL,
  "side" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "analysis_finding_sources_finding_chunk_side_uidx" ON "analysis_finding_sources" ("finding_id", "chunk_id", "side");
ALTER TABLE "analysis_finding_sources" ADD CONSTRAINT "analysis_finding_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "analysis_finding_sources" ADD CONSTRAINT "analysis_finding_sources_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "analysis_finding_sources" ADD CONSTRAINT "analysis_finding_sources_finding_id_analysis_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."analysis_findings"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "analysis_finding_sources" ADD CONSTRAINT "analysis_finding_sources_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "analysis_finding_sources" ADD CONSTRAINT "analysis_finding_sources_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "analysis_finding_sources" ADD CONSTRAINT "analysis_finding_sources_chunk_id_document_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."document_chunks"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "document_review_states" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "relevance" "relevance_status" DEFAULT 'unknown' NOT NULL,
  "privilege" "privilege_status" DEFAULT 'unknown' NOT NULL,
  "responsiveness" "responsiveness_status" DEFAULT 'unknown' NOT NULL,
  "confidentiality" "confidentiality_status" DEFAULT 'unknown' NOT NULL,
  "ai_relevance" "relevance_status",
  "ai_privilege" "privilege_status",
  "ai_responsiveness" "responsiveness_status",
  "ai_proposal_note" text,
  "human_privilege_final" boolean DEFAULT false NOT NULL,
  "important" boolean DEFAULT false NOT NULL,
  "review_notes" text,
  "reviewed_by_user_id" uuid,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "document_review_states_matter_document_uidx" ON "document_review_states" ("matter_id", "document_id");
CREATE INDEX "document_review_states_matter_idx" ON "document_review_states" ("matter_id");
ALTER TABLE "document_review_states" ADD CONSTRAINT "document_review_states_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_review_states" ADD CONSTRAINT "document_review_states_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_review_states" ADD CONSTRAINT "document_review_states_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_review_states" ADD CONSTRAINT "document_review_states_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

CREATE TABLE "matter_document_tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "key" text NOT NULL,
  "label" text NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "matter_document_tags_matter_key_uidx" ON "matter_document_tags" ("matter_id", "key");
ALTER TABLE "matter_document_tags" ADD CONSTRAINT "matter_document_tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "matter_document_tags" ADD CONSTRAINT "matter_document_tags_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "document_tag_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "tag_id" uuid NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "document_tag_assignments_doc_tag_uidx" ON "document_tag_assignments" ("document_id", "tag_id");
ALTER TABLE "document_tag_assignments" ADD CONSTRAINT "document_tag_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_tag_assignments" ADD CONSTRAINT "document_tag_assignments_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_tag_assignments" ADD CONSTRAINT "document_tag_assignments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_tag_assignments" ADD CONSTRAINT "document_tag_assignments_tag_id_matter_document_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."matter_document_tags"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "document_duplicate_groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "group_type" text DEFAULT 'exact_hash' NOT NULL,
  "fingerprint" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "document_duplicate_groups_matter_fp_uidx" ON "document_duplicate_groups" ("matter_id", "group_type", "fingerprint");
ALTER TABLE "document_duplicate_groups" ADD CONSTRAINT "document_duplicate_groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_duplicate_groups" ADD CONSTRAINT "document_duplicate_groups_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "document_duplicate_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "document_version_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "document_duplicate_members_group_doc_uidx" ON "document_duplicate_members" ("group_id", "document_id");
ALTER TABLE "document_duplicate_members" ADD CONSTRAINT "document_duplicate_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_duplicate_members" ADD CONSTRAINT "document_duplicate_members_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_duplicate_members" ADD CONSTRAINT "document_duplicate_members_group_id_document_duplicate_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."document_duplicate_groups"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_duplicate_members" ADD CONSTRAINT "document_duplicate_members_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_duplicate_members" ADD CONSTRAINT "document_duplicate_members_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;
