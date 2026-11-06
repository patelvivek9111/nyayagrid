-- POST_PR08 repair: some environments recorded 0025/0027/0028 journal hashes without applying SQL.
-- This migration is fully idempotent (IF NOT EXISTS) and is a no-op on healthy DBs that already
-- applied those migrations. Reverse is intentionally empty beyond documentation — dropping would
-- destroy live contacts/folders/billing/memory data.
-- Prosecution case memory (PROS-MEM-01).
-- Case-scoped, reviewable entries. Proposed AI entries are never verified facts.
-- No guilt verdict, charging recommendation, or autonomy fields.
-- Reverse with 0025_prosecution_case_memories.down.sql.

CREATE TABLE IF NOT EXISTS "prosecution_case_memories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "evidence_item_id" uuid,
  "memory_type" text DEFAULT 'other' NOT NULL,
  "content" text NOT NULL,
  "status" text DEFAULT 'proposed' NOT NULL,
  "origin" text DEFAULT 'manual' NOT NULL,
  "confidence" text,
  "provenance" jsonb NOT NULL,
  "superseded_by" uuid,
  "created_by_user_id" uuid,
  "reviewed_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "prosecution_case_memories_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade,
  CONSTRAINT "prosecution_case_memories_criminal_case_id_fkey"
    FOREIGN KEY ("criminal_case_id") REFERENCES "criminal_cases"("id") ON DELETE cascade,
  CONSTRAINT "prosecution_case_memories_evidence_item_id_fkey"
    FOREIGN KEY ("evidence_item_id") REFERENCES "prosecution_evidence_items"("id") ON DELETE set null,
  CONSTRAINT "prosecution_case_memories_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id"),
  CONSTRAINT "prosecution_case_memories_reviewed_by_user_id_fkey"
    FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id"),
  CONSTRAINT "prosecution_case_memories_type_chk" CHECK ("memory_type" IN (
    'confirmed_fact','disputed_fact','allegation','admission','legal_issue',
    'open_question','procedural_context','evidence_note','strategy_note','other'
  )),
  CONSTRAINT "prosecution_case_memories_status_chk" CHECK ("status" IN (
    'proposed','approved','rejected','superseded'
  )),
  CONSTRAINT "prosecution_case_memories_origin_chk" CHECK ("origin" IN ('ai','manual')),
  CONSTRAINT "prosecution_case_memories_confidence_chk" CHECK (
    "confidence" IS NULL OR "confidence" IN ('low','medium','high')
  )
);

CREATE INDEX IF NOT EXISTS "prosecution_case_memories_case_idx"
  ON "prosecution_case_memories" ("criminal_case_id");
CREATE INDEX IF NOT EXISTS "prosecution_case_memories_org_idx"
  ON "prosecution_case_memories" ("organization_id");
CREATE INDEX IF NOT EXISTS "prosecution_case_memories_status_idx"
  ON "prosecution_case_memories" ("organization_id", "status");
CREATE INDEX IF NOT EXISTS "prosecution_case_memories_case_status_idx"
  ON "prosecution_case_memories" ("criminal_case_id", "status");
CREATE INDEX IF NOT EXISTS "prosecution_case_memories_evidence_idx"
  ON "prosecution_case_memories" ("evidence_item_id");

--> statement-breakpoint

-- Professional contacts + document folders (PROF-CONTACT-01 / PROF-FOLDER-01).
-- Contacts are organization-scoped and distinct from clients.
-- Folders are matter-scoped trees; documents.folder_id is nullable.
-- Reverse with 0027_professional_contacts_folders.down.sql.
-- NOTE: 0026 is reserved for prosecution_case_graph — do not reuse.

CREATE TABLE IF NOT EXISTS "contacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "display_name" text NOT NULL,
  "email" text,
  "phone" text,
  "title" text,
  "notes" text,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "contacts_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade,
  CONSTRAINT "contacts_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
);

CREATE INDEX IF NOT EXISTS "contacts_organization_idx"
  ON "contacts" ("organization_id");
CREATE INDEX IF NOT EXISTS "contacts_org_display_name_idx"
  ON "contacts" ("organization_id", "display_name");
CREATE INDEX IF NOT EXISTS "contacts_org_email_idx"
  ON "contacts" ("organization_id", "email");

CREATE UNIQUE INDEX IF NOT EXISTS "contacts_id_org_uidx"
  ON "contacts" ("id", "organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "clients_id_org_uidx"
  ON "clients" ("id", "organization_id");

CREATE TABLE IF NOT EXISTS "client_contacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "contact_id" uuid NOT NULL,
  "relationship_role" text DEFAULT 'other' NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "client_contacts_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade,
  CONSTRAINT "client_contacts_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE cascade,
  CONSTRAINT "client_contacts_contact_id_fkey"
    FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE cascade,
  CONSTRAINT "client_contacts_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id"),
  CONSTRAINT "client_contacts_client_org_fk"
    FOREIGN KEY ("client_id", "organization_id")
      REFERENCES "clients"("id", "organization_id") ON DELETE cascade,
  CONSTRAINT "client_contacts_contact_org_fk"
    FOREIGN KEY ("contact_id", "organization_id")
      REFERENCES "contacts"("id", "organization_id") ON DELETE cascade
);

CREATE UNIQUE INDEX IF NOT EXISTS "client_contacts_client_contact_uidx"
  ON "client_contacts" ("client_id", "contact_id");
CREATE INDEX IF NOT EXISTS "client_contacts_organization_idx"
  ON "client_contacts" ("organization_id");
CREATE INDEX IF NOT EXISTS "client_contacts_contact_idx"
  ON "client_contacts" ("contact_id");
CREATE INDEX IF NOT EXISTS "client_contacts_client_idx"
  ON "client_contacts" ("client_id");

CREATE TABLE IF NOT EXISTS "document_folders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "parent_folder_id" uuid,
  "name" text NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "document_folders_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade,
  CONSTRAINT "document_folders_matter_id_fkey"
    FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade,
  CONSTRAINT "document_folders_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id"),
  CONSTRAINT "document_folders_matter_org_fk"
    FOREIGN KEY ("matter_id", "organization_id")
      REFERENCES "matters"("id", "organization_id") ON DELETE cascade,
  CONSTRAINT "document_folders_parent_fk"
    FOREIGN KEY ("parent_folder_id") REFERENCES "document_folders"("id") ON DELETE restrict,
  CONSTRAINT "document_folders_name_chk" CHECK (char_length(btrim("name")) > 0)
);

CREATE INDEX IF NOT EXISTS "document_folders_matter_idx"
  ON "document_folders" ("matter_id");
CREATE INDEX IF NOT EXISTS "document_folders_organization_idx"
  ON "document_folders" ("organization_id");
CREATE INDEX IF NOT EXISTS "document_folders_parent_idx"
  ON "document_folders" ("parent_folder_id");
CREATE UNIQUE INDEX IF NOT EXISTS "document_folders_id_matter_uidx"
  ON "document_folders" ("id", "matter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "document_folders_id_org_uidx"
  ON "document_folders" ("id", "organization_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'document_folders_parent_matter_fk'
  ) THEN
    ALTER TABLE "document_folders"
      ADD CONSTRAINT "document_folders_parent_matter_fk"
      FOREIGN KEY ("parent_folder_id", "matter_id")
      REFERENCES "document_folders"("id", "matter_id") ON DELETE restrict;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "document_folders_sibling_name_uidx"
  ON "document_folders" (
    "matter_id",
    COALESCE("parent_folder_id", '00000000-0000-0000-0000-000000000000'::uuid),
    "name"
  );

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "folder_id" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'documents_folder_id_fkey'
  ) THEN
    ALTER TABLE "documents"
      ADD CONSTRAINT "documents_folder_id_fkey"
      FOREIGN KEY ("folder_id") REFERENCES "document_folders"("id") ON DELETE set null;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "documents_folder_idx"
  ON "documents" ("folder_id");

--> statement-breakpoint

-- PROF-BILL-01 — optional fee assistance on time entries / draft invoices.
-- Minutes remain authoritative. amount_cents / total_cents are assistance only.
-- Not payment processing or trust accounting.

ALTER TABLE "time_entries"
  ADD COLUMN IF NOT EXISTS "billable" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "time_entries"
  ADD COLUMN IF NOT EXISTS "hourly_rate_cents" integer;
--> statement-breakpoint
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "total_minutes" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "total_cents" integer;
--> statement-breakpoint
ALTER TABLE "invoice_line_items"
  ADD COLUMN IF NOT EXISTS "billable" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_line_items"
  ADD COLUMN IF NOT EXISTS "hourly_rate_cents" integer;
--> statement-breakpoint
ALTER TABLE "invoice_line_items"
  ADD COLUMN IF NOT EXISTS "amount_cents" integer;
--> statement-breakpoint
ALTER TABLE "invoice_line_items"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
UPDATE "invoices" i
SET "total_minutes" = COALESCE((
  SELECT SUM(li."minutes")::integer
  FROM "invoice_line_items" li
  WHERE li."invoice_id" = i."id"
), 0)
WHERE COALESCE(i."total_minutes", 0) = 0;
