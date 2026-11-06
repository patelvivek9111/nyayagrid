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
