CREATE TYPE "public"."client_type" AS ENUM('individual', 'organization');
CREATE TYPE "public"."client_status" AS ENUM('active', 'archived');
CREATE TYPE "public"."matter_status" AS ENUM('intake', 'open', 'active', 'on_hold', 'closed', 'archived');
CREATE TYPE "public"."matter_access" AS ENUM('read', 'comment', 'edit', 'manage');
CREATE TYPE "public"."task_status" AS ENUM('open', 'in_progress', 'completed', 'cancelled');
CREATE TYPE "public"."task_priority" AS ENUM('low', 'medium', 'high', 'urgent');
CREATE TYPE "public"."note_origin" AS ENUM('user', 'nyaya');

ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "processing_error" text;

CREATE TABLE "clients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "client_type" "client_type" NOT NULL,
  "display_name" text NOT NULL,
  "first_name" text,
  "last_name" text,
  "organization_name" text,
  "email" text,
  "phone" text,
  "status" "client_status" DEFAULT 'active' NOT NULL,
  "notes" text,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "matters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "matter_number" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "practice_area" text,
  "jurisdiction" text,
  "court" text,
  "status" "matter_status" DEFAULT 'open' NOT NULL,
  "opened_at" timestamp with time zone DEFAULT now() NOT NULL,
  "closed_at" timestamp with time zone,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "matter_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "access" "matter_access" DEFAULT 'read' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "clients" ADD CONSTRAINT "clients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "clients" ADD CONSTRAINT "clients_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "matters" ADD CONSTRAINT "matters_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "matters" ADD CONSTRAINT "matters_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "matters" ADD CONSTRAINT "matters_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "matter_members" ADD CONSTRAINT "matter_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "matter_members" ADD CONSTRAINT "matter_members_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "matter_members" ADD CONSTRAINT "matter_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

DO $$ BEGIN
  ALTER TABLE "documents"
    ADD CONSTRAINT "documents_matter_id_matters_id_fk"
    FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE "document_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "document_version_id" uuid NOT NULL,
  "chunk_index" integer NOT NULL,
  "content" text NOT NULL,
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

CREATE TABLE "conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "created_by_user_id" uuid,
  "title" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "role" text NOT NULL,
  "content" text NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "ai_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "conversation_id" uuid,
  "message_id" uuid,
  "artifact_type" text DEFAULT 'matter_qa' NOT NULL,
  "question" text NOT NULL,
  "answer" text NOT NULL,
  "evidence_state" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "prompt_version" text NOT NULL,
  "retrieved_chunk_ids" jsonb DEFAULT '[]'::jsonb,
  "citations" jsonb DEFAULT '[]'::jsonb,
  "validation" jsonb DEFAULT '{}'::jsonb,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "origin" "note_origin" DEFAULT 'user' NOT NULL,
  "ai_artifact_id" uuid,
  "citations" jsonb DEFAULT '[]'::jsonb,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "status" "task_status" DEFAULT 'open' NOT NULL,
  "priority" "task_priority" DEFAULT 'medium' NOT NULL,
  "assigned_to_user_id" uuid,
  "created_by_user_id" uuid,
  "due_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "source_note_id" uuid,
  "source_artifact_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "messages" ADD CONSTRAINT "messages_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ai_artifacts" ADD CONSTRAINT "ai_artifacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ai_artifacts" ADD CONSTRAINT "ai_artifacts_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "notes" ADD CONSTRAINT "notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "notes" ADD CONSTRAINT "notes_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "notes" ADD CONSTRAINT "notes_ai_artifact_id_ai_artifacts_id_fk" FOREIGN KEY ("ai_artifact_id") REFERENCES "public"."ai_artifacts"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX "clients_organization_idx" ON "clients" USING btree ("organization_id");
CREATE INDEX "clients_status_idx" ON "clients" USING btree ("status");
CREATE UNIQUE INDEX "matters_org_number_uidx" ON "matters" USING btree ("organization_id","matter_number");
CREATE INDEX "matters_organization_idx" ON "matters" USING btree ("organization_id");
CREATE INDEX "matters_client_idx" ON "matters" USING btree ("client_id");
CREATE INDEX "matters_status_idx" ON "matters" USING btree ("status");
CREATE UNIQUE INDEX "matter_members_matter_user_uidx" ON "matter_members" USING btree ("matter_id","user_id");
CREATE INDEX "matter_members_user_idx" ON "matter_members" USING btree ("user_id");
CREATE INDEX "matter_members_organization_idx" ON "matter_members" USING btree ("organization_id");
CREATE UNIQUE INDEX "document_chunks_version_index_uidx" ON "document_chunks" USING btree ("document_version_id","chunk_index");
CREATE INDEX "document_chunks_organization_idx" ON "document_chunks" USING btree ("organization_id");
CREATE INDEX "document_chunks_matter_idx" ON "document_chunks" USING btree ("matter_id");
CREATE INDEX "document_chunks_document_idx" ON "document_chunks" USING btree ("document_id");
CREATE INDEX "conversations_matter_idx" ON "conversations" USING btree ("matter_id");
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id");
CREATE INDEX "ai_artifacts_matter_idx" ON "ai_artifacts" USING btree ("matter_id");
CREATE INDEX "notes_matter_idx" ON "notes" USING btree ("matter_id");
CREATE INDEX "tasks_matter_idx" ON "tasks" USING btree ("matter_id");
CREATE INDEX "document_chunks_fts_idx" ON "document_chunks" USING gin (to_tsvector('english', "content"));
