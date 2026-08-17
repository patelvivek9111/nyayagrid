-- Phase 10 — SYNTH/dev firm operations (Harvey P6).
-- Time entries, draft invoices from posted minutes (not money), pasted inbound email filed to a
-- matter with human confirm, in-app notifications, and the Client Guest system role.
-- This is not Microsoft Graph, live SMTP, or a payment processor.

CREATE TYPE "public"."time_entry_source" AS ENUM('manual', 'chat', 'draft');
CREATE TYPE "public"."time_entry_status" AS ENUM('suggested', 'posted', 'rejected');
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'issued', 'void');
CREATE TYPE "public"."inbound_email_status" AS ENUM('pending', 'filed', 'discarded');
CREATE TYPE "public"."notification_kind" AS ENUM('deadline', 'invite', 'time_suggestion', 'review_queue');

CREATE TABLE "time_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "source" "time_entry_source" DEFAULT 'manual' NOT NULL,
  "status" "time_entry_status" DEFAULT 'suggested' NOT NULL,
  "description" text NOT NULL,
  "minutes" integer NOT NULL,
  "conversation_id" uuid,
  "draft_id" uuid,
  "posted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "time_entries_organization_idx" ON "time_entries" ("organization_id");
CREATE INDEX "time_entries_matter_idx" ON "time_entries" ("matter_id");
CREATE INDEX "time_entries_user_idx" ON "time_entries" ("user_id");
CREATE INDEX "time_entries_status_idx" ON "time_entries" ("status");
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_conversation_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_draft_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE set null ON UPDATE no action;

CREATE TABLE "invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "invoice_number" text NOT NULL,
  "status" "invoice_status" DEFAULT 'draft' NOT NULL,
  "notes" text,
  "created_by_user_id" uuid,
  "issued_at" timestamp with time zone,
  "voided_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "invoices_org_number_uidx" ON "invoices" ("organization_id", "invoice_number");
CREATE INDEX "invoices_matter_idx" ON "invoices" ("matter_id");
CREATE INDEX "invoices_organization_idx" ON "invoices" ("organization_id");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

CREATE TABLE "invoice_line_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "invoice_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "time_entry_id" uuid NOT NULL,
  "description" text NOT NULL,
  "minutes" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "invoice_line_items_time_entry_uidx" ON "invoice_line_items" ("time_entry_id");
CREATE INDEX "invoice_line_items_invoice_idx" ON "invoice_line_items" ("invoice_id");
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_time_entry_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE restrict ON UPDATE no action;

CREATE TABLE "inbound_emails" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "from_address" text NOT NULL,
  "subject" text NOT NULL,
  "body" text NOT NULL,
  "status" "inbound_email_status" DEFAULT 'pending' NOT NULL,
  "matter_id" uuid,
  "document_id" uuid,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "inbound_emails_organization_idx" ON "inbound_emails" ("organization_id");
CREATE INDEX "inbound_emails_status_idx" ON "inbound_emails" ("status");
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_document_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

CREATE TABLE "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "kind" "notification_kind" NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "href" text,
  "matter_id" uuid,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "notifications_user_idx" ON "notifications" ("user_id");
CREATE INDEX "notifications_organization_idx" ON "notifications" ("organization_id");
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE set null ON UPDATE no action;

-- Client Guest for existing organizations. New organizations get this role from
-- createOrganizationWithDefaults / SYSTEM_ROLE_DEFINITIONS.
INSERT INTO "roles" ("organization_id", "key", "name", "description", "is_system")
SELECT o.id, 'client_guest', 'Client Guest', 'View assigned matters and documents only', true
FROM "organizations" o
WHERE NOT EXISTS (
  SELECT 1 FROM "roles" r WHERE r.organization_id = o.id AND r.key = 'client_guest'
);

INSERT INTO "permissions" ("role_id", "capability")
SELECT r.id, cap.capability
FROM "roles" r
CROSS JOIN (VALUES ('matters.view'), ('documents.view')) AS cap(capability)
WHERE r.key = 'client_guest' AND r.is_system = true
AND NOT EXISTS (
  SELECT 1 FROM "permissions" p WHERE p.role_id = r.id AND p.capability = cap.capability
);
