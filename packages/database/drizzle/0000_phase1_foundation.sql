CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "public"."organization_type" AS ENUM('firm', 'solo');
CREATE TYPE "public"."membership_status" AS ENUM('active', 'invited', 'disabled');
CREATE TYPE "public"."workspace_type" AS ENUM('professional', 'student', 'public');
CREATE TYPE "public"."document_processing_state" AS ENUM(
  'uploaded',
  'quarantined',
  'awaiting_malware_scan',
  'malware_scan_failed',
  'unscanned_development',
  'scan_clean',
  'scan_blocked',
  'extracting_text',
  'requires_ocr',
  'extraction_failed',
  'chunking',
  'embedding',
  'indexed',
  'ready',
  'failed'
);
CREATE TYPE "public"."malware_scan_status" AS ENUM(
  'not_scanned',
  'pending',
  'clean',
  'blocked',
  'failed',
  'development_unscanned'
);

CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "auth_subject" text NOT NULL,
  "email" text NOT NULL,
  "name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "organizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "type" "organization_type" DEFAULT 'firm' NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "roles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "is_system" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "permissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "role_id" uuid NOT NULL,
  "capability" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "memberships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role_id" uuid NOT NULL,
  "status" "membership_status" DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid,
  "created_by_user_id" uuid,
  "title" text NOT NULL,
  "processing_state" "document_processing_state" DEFAULT 'uploaded' NOT NULL,
  "malware_scan_status" "malware_scan_status" DEFAULT 'not_scanned' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "document_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "storage_key" text NOT NULL,
  "content_type" text NOT NULL,
  "byte_size" integer NOT NULL,
  "sha256" text NOT NULL,
  "original_filename" text NOT NULL,
  "uploaded_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid,
  "actor_user_id" uuid,
  "matter_id" uuid,
  "action" text NOT NULL,
  "target_type" text,
  "target_id" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "ai_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid,
  "job_type" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "payload" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_created_by_user_id_users_id_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id")
  ON DELETE no action ON UPDATE no action;

ALTER TABLE "roles"
  ADD CONSTRAINT "roles_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "permissions"
  ADD CONSTRAINT "permissions_role_id_roles_id_fk"
  FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "memberships"
  ADD CONSTRAINT "memberships_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "memberships"
  ADD CONSTRAINT "memberships_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "memberships"
  ADD CONSTRAINT "memberships_role_id_roles_id_fk"
  FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id")
  ON DELETE restrict ON UPDATE no action;

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_created_by_user_id_users_id_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id")
  ON DELETE no action ON UPDATE no action;

ALTER TABLE "document_versions"
  ADD CONSTRAINT "document_versions_document_id_documents_id_fk"
  FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "document_versions"
  ADD CONSTRAINT "document_versions_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "document_versions"
  ADD CONSTRAINT "document_versions_uploaded_by_user_id_users_id_fk"
  FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id")
  ON DELETE no action ON UPDATE no action;

ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
  ON DELETE set null ON UPDATE no action;

ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk"
  FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id")
  ON DELETE set null ON UPDATE no action;

ALTER TABLE "ai_jobs"
  ADD CONSTRAINT "ai_jobs_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
  ON DELETE cascade ON UPDATE no action;

CREATE UNIQUE INDEX "users_auth_subject_uidx" ON "users" USING btree ("auth_subject");
CREATE UNIQUE INDEX "users_email_uidx" ON "users" USING btree ("email");
CREATE UNIQUE INDEX "organizations_slug_uidx" ON "organizations" USING btree ("slug");
CREATE UNIQUE INDEX "roles_org_key_uidx" ON "roles" USING btree ("organization_id","key");
CREATE INDEX "roles_organization_idx" ON "roles" USING btree ("organization_id");
CREATE UNIQUE INDEX "permissions_role_capability_uidx" ON "permissions" USING btree ("role_id","capability");
CREATE INDEX "permissions_role_idx" ON "permissions" USING btree ("role_id");
CREATE UNIQUE INDEX "memberships_org_user_uidx" ON "memberships" USING btree ("organization_id","user_id");
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");
CREATE INDEX "memberships_organization_idx" ON "memberships" USING btree ("organization_id");
CREATE INDEX "documents_organization_idx" ON "documents" USING btree ("organization_id");
CREATE INDEX "documents_matter_idx" ON "documents" USING btree ("matter_id");
CREATE UNIQUE INDEX "document_versions_doc_version_uidx" ON "document_versions" USING btree ("document_id","version_number");
CREATE INDEX "document_versions_organization_idx" ON "document_versions" USING btree ("organization_id");
CREATE UNIQUE INDEX "document_versions_storage_key_uidx" ON "document_versions" USING btree ("storage_key");
CREATE INDEX "audit_events_organization_idx" ON "audit_events" USING btree ("organization_id");
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_user_id");
CREATE INDEX "audit_events_action_idx" ON "audit_events" USING btree ("action");
CREATE UNIQUE INDEX "ai_jobs_idempotency_uidx" ON "ai_jobs" USING btree ("idempotency_key");
CREATE INDEX "ai_jobs_organization_idx" ON "ai_jobs" USING btree ("organization_id");
