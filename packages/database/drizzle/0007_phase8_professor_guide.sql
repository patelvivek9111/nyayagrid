CREATE TYPE "public"."explanation_level" AS ENUM('simple', 'standard', 'advanced');
CREATE TYPE "public"."student_case_processing_state" AS ENUM('uploaded', 'extracting', 'chunking', 'embedding', 'ready', 'failed');
CREATE TYPE "public"."guide_document_processing_state" AS ENUM('uploaded', 'extracting', 'chunking', 'embedding', 'ready', 'failed');
CREATE TYPE "public"."guide_provenance_note" AS ENUM('user_provided', 'document_extracted', 'legal_authority', 'guide_explanation');

-- Student (Nyaya Professor) workspace. Every table below is scoped by user_id only: there is
-- deliberately no organization_id or matter_id column, because student study material must never
-- be joinable against confidential professional matter data.

CREATE TABLE "student_conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "title" text NOT NULL,
  "explanation_level" "explanation_level" DEFAULT 'standard' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "student_conversations_user_idx" ON "student_conversations" ("user_id");
ALTER TABLE "student_conversations" ADD CONSTRAINT "student_conversations_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "student_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conversation_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" text NOT NULL,
  "content" text NOT NULL,
  "explanation_level" "explanation_level",
  "sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "socratic_follow_up" text,
  "provider" text,
  "model" text,
  "prompt_version" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "student_messages_conversation_idx" ON "student_messages" ("conversation_id");
CREATE INDEX "student_messages_user_idx" ON "student_messages" ("user_id");
ALTER TABLE "student_messages" ADD CONSTRAINT "student_messages_conversation_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."student_conversations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "student_messages" ADD CONSTRAINT "student_messages_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "student_cases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "title" text NOT NULL,
  "citation" text,
  "court" text,
  "decision_date" date,
  "source_type" text DEFAULT 'pasted_text' NOT NULL,
  "processing_state" "student_case_processing_state" DEFAULT 'uploaded' NOT NULL,
  "processing_error" text,
  "storage_key" text,
  "mime_type" text,
  "sha256" text,
  "byte_size" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "student_cases_user_idx" ON "student_cases" ("user_id");
CREATE INDEX "student_cases_state_idx" ON "student_cases" ("processing_state");
CREATE UNIQUE INDEX "student_cases_user_sha_uidx" ON "student_cases" ("user_id", "sha256") WHERE "sha256" IS NOT NULL;
ALTER TABLE "student_cases" ADD CONSTRAINT "student_cases_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "student_case_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "content" text NOT NULL,
  "sha256" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "student_case_versions_case_version_uidx" ON "student_case_versions" ("case_id", "version_number");
CREATE INDEX "student_case_versions_case_idx" ON "student_case_versions" ("case_id");
CREATE INDEX "student_case_versions_user_idx" ON "student_case_versions" ("user_id");
ALTER TABLE "student_case_versions" ADD CONSTRAINT "student_case_versions_case_fk" FOREIGN KEY ("case_id") REFERENCES "public"."student_cases"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "student_case_versions" ADD CONSTRAINT "student_case_versions_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "student_case_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL,
  "case_version_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "chunk_index" integer NOT NULL,
  "content" text NOT NULL,
  "page_start" integer,
  "page_end" integer,
  "segment_ref" text,
  "char_start" integer,
  "char_end" integer,
  "opinion_part" text,
  "embedding" vector(384),
  "embedding_model" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "student_case_chunks_version_index_uidx" ON "student_case_chunks" ("case_version_id", "chunk_index");
CREATE INDEX "student_case_chunks_case_idx" ON "student_case_chunks" ("case_id");
CREATE INDEX "student_case_chunks_user_idx" ON "student_case_chunks" ("user_id");
CREATE INDEX "student_case_chunks_fts_idx" ON "student_case_chunks" USING gin (to_tsvector('english', "content"));
ALTER TABLE "student_case_chunks" ADD CONSTRAINT "student_case_chunks_case_fk" FOREIGN KEY ("case_id") REFERENCES "public"."student_cases"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "student_case_chunks" ADD CONSTRAINT "student_case_chunks_version_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."student_case_versions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "student_case_chunks" ADD CONSTRAINT "student_case_chunks_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "student_case_briefs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "case_version_id" uuid NOT NULL,
  "brief" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "section_sources" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "provider" text,
  "model" text,
  "prompt_version" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "student_case_briefs_user_idx" ON "student_case_briefs" ("user_id");
CREATE INDEX "student_case_briefs_case_idx" ON "student_case_briefs" ("case_id");
CREATE UNIQUE INDEX "student_case_briefs_version_uidx" ON "student_case_briefs" ("case_version_id");
ALTER TABLE "student_case_briefs" ADD CONSTRAINT "student_case_briefs_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "student_case_briefs" ADD CONSTRAINT "student_case_briefs_case_fk" FOREIGN KEY ("case_id") REFERENCES "public"."student_cases"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "student_case_briefs" ADD CONSTRAINT "student_case_briefs_version_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."student_case_versions"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "student_case_comparisons" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "case_a_id" uuid NOT NULL,
  "case_b_id" uuid NOT NULL,
  "comparison" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "provider" text,
  "model" text,
  "prompt_version" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "student_case_comparisons_user_idx" ON "student_case_comparisons" ("user_id");
CREATE INDEX "student_case_comparisons_case_a_idx" ON "student_case_comparisons" ("case_a_id");
CREATE INDEX "student_case_comparisons_case_b_idx" ON "student_case_comparisons" ("case_b_id");
ALTER TABLE "student_case_comparisons" ADD CONSTRAINT "student_case_comparisons_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "student_case_comparisons" ADD CONSTRAINT "student_case_comparisons_case_a_fk" FOREIGN KEY ("case_a_id") REFERENCES "public"."student_cases"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "student_case_comparisons" ADD CONSTRAINT "student_case_comparisons_case_b_fk" FOREIGN KEY ("case_b_id") REFERENCES "public"."student_cases"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "student_saved_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "item_type" text NOT NULL,
  "title" text NOT NULL,
  "content" text,
  "ref" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "student_saved_items_user_idx" ON "student_saved_items" ("user_id");
CREATE INDEX "student_saved_items_type_idx" ON "student_saved_items" ("item_type");
ALTER TABLE "student_saved_items" ADD CONSTRAINT "student_saved_items_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

-- Public (Nyaya Guide) workspace. Same isolation rule as the student tables: user_id scoping only,
-- never an organization_id or matter_id.

CREATE TABLE "guide_conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "title" text NOT NULL,
  "jurisdiction" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "guide_conversations_user_idx" ON "guide_conversations" ("user_id");
ALTER TABLE "guide_conversations" ADD CONSTRAINT "guide_conversations_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "guide_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conversation_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" text NOT NULL,
  "content" text NOT NULL,
  "sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "caution_level" text DEFAULT 'standard' NOT NULL,
  "provider" text,
  "model" text,
  "prompt_version" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "guide_messages_conversation_idx" ON "guide_messages" ("conversation_id");
CREATE INDEX "guide_messages_user_idx" ON "guide_messages" ("user_id");
ALTER TABLE "guide_messages" ADD CONSTRAINT "guide_messages_conversation_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."guide_conversations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "guide_messages" ADD CONSTRAINT "guide_messages_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "guide_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "title" text NOT NULL,
  "document_kind" text,
  "processing_state" "guide_document_processing_state" DEFAULT 'uploaded' NOT NULL,
  "processing_error" text,
  "storage_key" text,
  "mime_type" text,
  "sha256" text,
  "byte_size" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "guide_documents_user_idx" ON "guide_documents" ("user_id");
CREATE INDEX "guide_documents_state_idx" ON "guide_documents" ("processing_state");
CREATE UNIQUE INDEX "guide_documents_user_sha_uidx" ON "guide_documents" ("user_id", "sha256") WHERE "sha256" IS NOT NULL;
ALTER TABLE "guide_documents" ADD CONSTRAINT "guide_documents_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "guide_document_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "content" text NOT NULL,
  "sha256" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "guide_document_versions_document_version_uidx" ON "guide_document_versions" ("document_id", "version_number");
CREATE INDEX "guide_document_versions_document_idx" ON "guide_document_versions" ("document_id");
CREATE INDEX "guide_document_versions_user_idx" ON "guide_document_versions" ("user_id");
ALTER TABLE "guide_document_versions" ADD CONSTRAINT "guide_document_versions_document_fk" FOREIGN KEY ("document_id") REFERENCES "public"."guide_documents"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "guide_document_versions" ADD CONSTRAINT "guide_document_versions_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "guide_document_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL,
  "document_version_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "chunk_index" integer NOT NULL,
  "content" text NOT NULL,
  "page_start" integer,
  "page_end" integer,
  "segment_ref" text,
  "char_start" integer,
  "char_end" integer,
  "embedding" vector(384),
  "embedding_model" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "guide_document_chunks_version_index_uidx" ON "guide_document_chunks" ("document_version_id", "chunk_index");
CREATE INDEX "guide_document_chunks_document_idx" ON "guide_document_chunks" ("document_id");
CREATE INDEX "guide_document_chunks_user_idx" ON "guide_document_chunks" ("user_id");
CREATE INDEX "guide_document_chunks_fts_idx" ON "guide_document_chunks" USING gin (to_tsvector('english', "content"));
ALTER TABLE "guide_document_chunks" ADD CONSTRAINT "guide_document_chunks_document_fk" FOREIGN KEY ("document_id") REFERENCES "public"."guide_documents"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "guide_document_chunks" ADD CONSTRAINT "guide_document_chunks_version_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."guide_document_versions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "guide_document_chunks" ADD CONSTRAINT "guide_document_chunks_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "guide_document_explanations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "document_version_id" uuid NOT NULL,
  "explanation" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "explicit_dates" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "provider" text,
  "model" text,
  "prompt_version" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "guide_document_explanations_user_idx" ON "guide_document_explanations" ("user_id");
CREATE INDEX "guide_document_explanations_document_idx" ON "guide_document_explanations" ("document_id");
ALTER TABLE "guide_document_explanations" ADD CONSTRAINT "guide_document_explanations_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "guide_document_explanations" ADD CONSTRAINT "guide_document_explanations_document_fk" FOREIGN KEY ("document_id") REFERENCES "public"."guide_documents"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "guide_document_explanations" ADD CONSTRAINT "guide_document_explanations_version_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."guide_document_versions"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "guide_situations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "title" text NOT NULL,
  "jurisdiction" text,
  "issue_category" text,
  "desired_outcome" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "guide_situations_user_idx" ON "guide_situations" ("user_id");
ALTER TABLE "guide_situations" ADD CONSTRAINT "guide_situations_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "guide_situation_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "situation_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "event_date" date,
  "event_date_end" date,
  "title" text NOT NULL,
  "description" text,
  "source_label" "guide_provenance_note" DEFAULT 'user_provided' NOT NULL,
  "guide_document_id" uuid,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "guide_situation_events_situation_idx" ON "guide_situation_events" ("situation_id");
CREATE INDEX "guide_situation_events_user_idx" ON "guide_situation_events" ("user_id");
ALTER TABLE "guide_situation_events" ADD CONSTRAINT "guide_situation_events_situation_fk" FOREIGN KEY ("situation_id") REFERENCES "public"."guide_situations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "guide_situation_events" ADD CONSTRAINT "guide_situation_events_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "guide_situation_events" ADD CONSTRAINT "guide_situation_events_document_fk" FOREIGN KEY ("guide_document_id") REFERENCES "public"."guide_documents"("id") ON DELETE set null ON UPDATE no action;

CREATE TABLE "guide_situation_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "situation_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "guide_document_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "guide_situation_documents_pair_uidx" ON "guide_situation_documents" ("situation_id", "guide_document_id");
CREATE INDEX "guide_situation_documents_user_idx" ON "guide_situation_documents" ("user_id");
CREATE INDEX "guide_situation_documents_document_idx" ON "guide_situation_documents" ("guide_document_id");
ALTER TABLE "guide_situation_documents" ADD CONSTRAINT "guide_situation_documents_situation_fk" FOREIGN KEY ("situation_id") REFERENCES "public"."guide_situations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "guide_situation_documents" ADD CONSTRAINT "guide_situation_documents_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "guide_situation_documents" ADD CONSTRAINT "guide_situation_documents_document_fk" FOREIGN KEY ("guide_document_id") REFERENCES "public"."guide_documents"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "guide_consultation_packets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "situation_id" uuid,
  "packet" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "provider" text,
  "model" text,
  "prompt_version" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "guide_consultation_packets_user_idx" ON "guide_consultation_packets" ("user_id");
CREATE INDEX "guide_consultation_packets_situation_idx" ON "guide_consultation_packets" ("situation_id");
ALTER TABLE "guide_consultation_packets" ADD CONSTRAINT "guide_consultation_packets_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "guide_consultation_packets" ADD CONSTRAINT "guide_consultation_packets_situation_fk" FOREIGN KEY ("situation_id") REFERENCES "public"."guide_situations"("id") ON DELETE cascade ON UPDATE no action;
