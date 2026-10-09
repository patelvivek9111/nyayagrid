-- Discovery / Production ledger + minimal discovery graph_node_type values.
-- Additive only. Existing matters remain valid with zero discovery rows.
-- No sanctions / privilege legal-conclusion columns.
-- Reverse with 0022_discovery_production_ledger.down.sql before data is relied upon.
-- Composite matter/org FKs mirror 0020_civil_claims.
-- Graph enum values cannot be safely removed (see down file).

-- Supporting unique indexes for composite FKs
CREATE UNIQUE INDEX IF NOT EXISTS "matters_id_org_uidx" ON "matters" ("id", "organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "matter_entities_id_matter_uidx" ON "matter_entities" ("id", "matter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "civil_evidence_items_id_matter_uidx" ON "civil_evidence_items" ("id", "matter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "tasks_id_matter_uidx" ON "tasks" ("id", "matter_id");

-- Additive graph_node_type values for discovery ledger enablement.
ALTER TYPE "public"."graph_node_type" ADD VALUE IF NOT EXISTS 'discovery_request_set';
ALTER TYPE "public"."graph_node_type" ADD VALUE IF NOT EXISTS 'discovery_request_item';
ALTER TYPE "public"."graph_node_type" ADD VALUE IF NOT EXISTS 'discovery_response';
ALTER TYPE "public"."graph_node_type" ADD VALUE IF NOT EXISTS 'discovery_production';
ALTER TYPE "public"."graph_node_type" ADD VALUE IF NOT EXISTS 'discovery_deficiency';
ALTER TYPE "public"."graph_node_type" ADD VALUE IF NOT EXISTS 'privilege_assertion';

CREATE TABLE "discovery_request_sets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "label" text NOT NULL,
  "discovery_type" text NOT NULL,
  "requesting_party_entity_id" uuid NOT NULL,
  "responding_party_entity_id" uuid NOT NULL,
  "served_at" timestamp with time zone,
  "response_due_at" timestamp with time zone,
  "source_document_id" uuid,
  "is_current" boolean DEFAULT true NOT NULL,
  "superseded_by_id" uuid,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "discovery_request_sets_type_chk" CHECK ("discovery_type" IN (
    'INTERROGATORY','REQUEST_FOR_PRODUCTION','REQUEST_FOR_ADMISSION','SUBPOENA',
    'DEPOSITION_DISCOVERY','THIRD_PARTY_REQUEST','OTHER'
  ))
);
CREATE UNIQUE INDEX "discovery_request_sets_id_matter_uidx" ON "discovery_request_sets" ("id", "matter_id");
CREATE UNIQUE INDEX "discovery_request_sets_id_org_uidx" ON "discovery_request_sets" ("id", "organization_id");
CREATE INDEX "discovery_request_sets_org_matter_idx" ON "discovery_request_sets" ("organization_id", "matter_id");
CREATE INDEX "discovery_request_sets_matter_current_idx" ON "discovery_request_sets" ("matter_id", "is_current");
CREATE INDEX "discovery_request_sets_type_idx" ON "discovery_request_sets" ("matter_id", "discovery_type");
ALTER TABLE "discovery_request_sets" ADD CONSTRAINT "discovery_request_sets_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "discovery_request_sets" ADD CONSTRAINT "discovery_request_sets_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "discovery_request_sets" ADD CONSTRAINT "discovery_request_sets_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
ALTER TABLE "discovery_request_sets" ADD CONSTRAINT "discovery_request_sets_requesting_party_fk" FOREIGN KEY ("requesting_party_entity_id") REFERENCES "matter_entities"("id") ON DELETE restrict;
ALTER TABLE "discovery_request_sets" ADD CONSTRAINT "discovery_request_sets_responding_party_fk" FOREIGN KEY ("responding_party_entity_id") REFERENCES "matter_entities"("id") ON DELETE restrict;
ALTER TABLE "discovery_request_sets" ADD CONSTRAINT "discovery_request_sets_requesting_party_matter_fk" FOREIGN KEY ("requesting_party_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE restrict;
ALTER TABLE "discovery_request_sets" ADD CONSTRAINT "discovery_request_sets_responding_party_matter_fk" FOREIGN KEY ("responding_party_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE restrict;
ALTER TABLE "discovery_request_sets" ADD CONSTRAINT "discovery_request_sets_source_document_fk" FOREIGN KEY ("source_document_id") REFERENCES "documents"("id") ON DELETE set null;
ALTER TABLE "discovery_request_sets" ADD CONSTRAINT "discovery_request_sets_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
ALTER TABLE "discovery_request_sets" ADD CONSTRAINT "discovery_request_sets_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");
ALTER TABLE "discovery_request_sets" ADD CONSTRAINT "discovery_request_sets_superseded_by_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "discovery_request_sets"("id") ON DELETE set null;

CREATE TABLE "discovery_request_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "set_id" uuid NOT NULL,
  "request_number" text NOT NULL,
  "title" text NOT NULL,
  "request_text" text DEFAULT '' NOT NULL,
  "status" text DEFAULT 'OPEN' NOT NULL,
  "requesting_party_entity_id" uuid NOT NULL,
  "responding_party_entity_id" uuid NOT NULL,
  "served_at" timestamp with time zone,
  "response_due_at" timestamp with time zone,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "discovery_request_items_status_chk" CHECK ("status" IN (
    'NOT_DUE','OPEN','RESPONDED','PARTIALLY_RESPONDED','OBJECTED','PRODUCED',
    'SUPPLEMENT_REQUIRED','DEFICIENT','RESOLVED','UNKNOWN'
  ))
);
CREATE UNIQUE INDEX "discovery_request_items_id_matter_uidx" ON "discovery_request_items" ("id", "matter_id");
CREATE UNIQUE INDEX "discovery_request_items_id_org_uidx" ON "discovery_request_items" ("id", "organization_id");
CREATE UNIQUE INDEX "discovery_request_items_set_number_uidx" ON "discovery_request_items" ("set_id", "request_number");
CREATE INDEX "discovery_request_items_set_idx" ON "discovery_request_items" ("set_id");
CREATE INDEX "discovery_request_items_org_matter_idx" ON "discovery_request_items" ("organization_id", "matter_id");
CREATE INDEX "discovery_request_items_status_idx" ON "discovery_request_items" ("matter_id", "status");
ALTER TABLE "discovery_request_items" ADD CONSTRAINT "discovery_request_items_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "discovery_request_items" ADD CONSTRAINT "discovery_request_items_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "discovery_request_items" ADD CONSTRAINT "discovery_request_items_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
ALTER TABLE "discovery_request_items" ADD CONSTRAINT "discovery_request_items_set_fk" FOREIGN KEY ("set_id") REFERENCES "discovery_request_sets"("id") ON DELETE cascade;
ALTER TABLE "discovery_request_items" ADD CONSTRAINT "discovery_request_items_set_matter_fk" FOREIGN KEY ("set_id", "matter_id") REFERENCES "discovery_request_sets"("id", "matter_id") ON DELETE cascade;
ALTER TABLE "discovery_request_items" ADD CONSTRAINT "discovery_request_items_requesting_party_fk" FOREIGN KEY ("requesting_party_entity_id") REFERENCES "matter_entities"("id") ON DELETE restrict;
ALTER TABLE "discovery_request_items" ADD CONSTRAINT "discovery_request_items_responding_party_fk" FOREIGN KEY ("responding_party_entity_id") REFERENCES "matter_entities"("id") ON DELETE restrict;
ALTER TABLE "discovery_request_items" ADD CONSTRAINT "discovery_request_items_requesting_party_matter_fk" FOREIGN KEY ("requesting_party_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE restrict;
ALTER TABLE "discovery_request_items" ADD CONSTRAINT "discovery_request_items_responding_party_matter_fk" FOREIGN KEY ("responding_party_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE restrict;
ALTER TABLE "discovery_request_items" ADD CONSTRAINT "discovery_request_items_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
ALTER TABLE "discovery_request_items" ADD CONSTRAINT "discovery_request_items_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");

CREATE TABLE "discovery_responses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "label" text NOT NULL,
  "responded_at" timestamp with time zone,
  "is_supplemental" boolean DEFAULT false NOT NULL,
  "supplements_response_id" uuid,
  "substantive_text" text,
  "source_document_id" uuid,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "discovery_responses_id_matter_uidx" ON "discovery_responses" ("id", "matter_id");
CREATE UNIQUE INDEX "discovery_responses_id_org_uidx" ON "discovery_responses" ("id", "organization_id");
CREATE INDEX "discovery_responses_item_idx" ON "discovery_responses" ("item_id");
CREATE INDEX "discovery_responses_item_date_idx" ON "discovery_responses" ("item_id", "responded_at");
CREATE INDEX "discovery_responses_org_matter_idx" ON "discovery_responses" ("organization_id", "matter_id");
ALTER TABLE "discovery_responses" ADD CONSTRAINT "discovery_responses_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "discovery_responses" ADD CONSTRAINT "discovery_responses_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "discovery_responses" ADD CONSTRAINT "discovery_responses_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
ALTER TABLE "discovery_responses" ADD CONSTRAINT "discovery_responses_item_fk" FOREIGN KEY ("item_id") REFERENCES "discovery_request_items"("id") ON DELETE cascade;
ALTER TABLE "discovery_responses" ADD CONSTRAINT "discovery_responses_item_matter_fk" FOREIGN KEY ("item_id", "matter_id") REFERENCES "discovery_request_items"("id", "matter_id") ON DELETE cascade;
ALTER TABLE "discovery_responses" ADD CONSTRAINT "discovery_responses_supplements_fk" FOREIGN KEY ("supplements_response_id") REFERENCES "discovery_responses"("id") ON DELETE set null;
ALTER TABLE "discovery_responses" ADD CONSTRAINT "discovery_responses_source_document_fk" FOREIGN KEY ("source_document_id") REFERENCES "documents"("id") ON DELETE set null;
ALTER TABLE "discovery_responses" ADD CONSTRAINT "discovery_responses_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
ALTER TABLE "discovery_responses" ADD CONSTRAINT "discovery_responses_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");

CREATE TABLE "discovery_objections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "response_id" uuid NOT NULL,
  "basis" text NOT NULL,
  "text" text DEFAULT '' NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "discovery_objections_id_matter_uidx" ON "discovery_objections" ("id", "matter_id");
CREATE INDEX "discovery_objections_response_idx" ON "discovery_objections" ("response_id");
CREATE INDEX "discovery_objections_item_idx" ON "discovery_objections" ("item_id");
CREATE INDEX "discovery_objections_org_matter_idx" ON "discovery_objections" ("organization_id", "matter_id");
ALTER TABLE "discovery_objections" ADD CONSTRAINT "discovery_objections_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "discovery_objections" ADD CONSTRAINT "discovery_objections_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "discovery_objections" ADD CONSTRAINT "discovery_objections_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
ALTER TABLE "discovery_objections" ADD CONSTRAINT "discovery_objections_item_fk" FOREIGN KEY ("item_id") REFERENCES "discovery_request_items"("id") ON DELETE cascade;
ALTER TABLE "discovery_objections" ADD CONSTRAINT "discovery_objections_item_matter_fk" FOREIGN KEY ("item_id", "matter_id") REFERENCES "discovery_request_items"("id", "matter_id") ON DELETE cascade;
ALTER TABLE "discovery_objections" ADD CONSTRAINT "discovery_objections_response_fk" FOREIGN KEY ("response_id") REFERENCES "discovery_responses"("id") ON DELETE cascade;
ALTER TABLE "discovery_objections" ADD CONSTRAINT "discovery_objections_response_matter_fk" FOREIGN KEY ("response_id", "matter_id") REFERENCES "discovery_responses"("id", "matter_id") ON DELETE cascade;
ALTER TABLE "discovery_objections" ADD CONSTRAINT "discovery_objections_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");

CREATE TABLE "discovery_productions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "label" text NOT NULL,
  "producing_party_entity_id" uuid NOT NULL,
  "receiving_party_entity_id" uuid NOT NULL,
  "produced_at" timestamp with time zone,
  "is_supplemental" boolean DEFAULT false NOT NULL,
  "supplements_production_id" uuid,
  "transmittal_document_id" uuid,
  "notes" text,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "discovery_productions_id_matter_uidx" ON "discovery_productions" ("id", "matter_id");
CREATE UNIQUE INDEX "discovery_productions_id_org_uidx" ON "discovery_productions" ("id", "organization_id");
CREATE INDEX "discovery_productions_org_matter_idx" ON "discovery_productions" ("organization_id", "matter_id");
CREATE INDEX "discovery_productions_matter_date_idx" ON "discovery_productions" ("matter_id", "produced_at");
CREATE INDEX "discovery_productions_party_idx" ON "discovery_productions" ("matter_id", "producing_party_entity_id");
ALTER TABLE "discovery_productions" ADD CONSTRAINT "discovery_productions_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "discovery_productions" ADD CONSTRAINT "discovery_productions_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "discovery_productions" ADD CONSTRAINT "discovery_productions_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
ALTER TABLE "discovery_productions" ADD CONSTRAINT "discovery_productions_producing_party_fk" FOREIGN KEY ("producing_party_entity_id") REFERENCES "matter_entities"("id") ON DELETE restrict;
ALTER TABLE "discovery_productions" ADD CONSTRAINT "discovery_productions_receiving_party_fk" FOREIGN KEY ("receiving_party_entity_id") REFERENCES "matter_entities"("id") ON DELETE restrict;
ALTER TABLE "discovery_productions" ADD CONSTRAINT "discovery_productions_producing_party_matter_fk" FOREIGN KEY ("producing_party_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE restrict;
ALTER TABLE "discovery_productions" ADD CONSTRAINT "discovery_productions_receiving_party_matter_fk" FOREIGN KEY ("receiving_party_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE restrict;
ALTER TABLE "discovery_productions" ADD CONSTRAINT "discovery_productions_supplements_fk" FOREIGN KEY ("supplements_production_id") REFERENCES "discovery_productions"("id") ON DELETE set null;
ALTER TABLE "discovery_productions" ADD CONSTRAINT "discovery_productions_transmittal_document_fk" FOREIGN KEY ("transmittal_document_id") REFERENCES "documents"("id") ON DELETE set null;
ALTER TABLE "discovery_productions" ADD CONSTRAINT "discovery_productions_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
ALTER TABLE "discovery_productions" ADD CONSTRAINT "discovery_productions_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");

CREATE TABLE "discovery_production_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "production_id" uuid NOT NULL,
  "document_id" uuid,
  "evidence_id" uuid,
  "request_item_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "discovery_production_items_target_chk" CHECK (
    "document_id" IS NOT NULL OR "evidence_id" IS NOT NULL OR "request_item_id" IS NOT NULL
  )
);
CREATE INDEX "discovery_production_items_production_idx" ON "discovery_production_items" ("production_id");
CREATE INDEX "discovery_production_items_document_idx" ON "discovery_production_items" ("document_id");
CREATE INDEX "discovery_production_items_evidence_idx" ON "discovery_production_items" ("evidence_id");
CREATE INDEX "discovery_production_items_org_matter_idx" ON "discovery_production_items" ("organization_id", "matter_id");
ALTER TABLE "discovery_production_items" ADD CONSTRAINT "discovery_production_items_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "discovery_production_items" ADD CONSTRAINT "discovery_production_items_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "discovery_production_items" ADD CONSTRAINT "discovery_production_items_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
ALTER TABLE "discovery_production_items" ADD CONSTRAINT "discovery_production_items_production_fk" FOREIGN KEY ("production_id") REFERENCES "discovery_productions"("id") ON DELETE cascade;
ALTER TABLE "discovery_production_items" ADD CONSTRAINT "discovery_production_items_production_matter_fk" FOREIGN KEY ("production_id", "matter_id") REFERENCES "discovery_productions"("id", "matter_id") ON DELETE cascade;
ALTER TABLE "discovery_production_items" ADD CONSTRAINT "discovery_production_items_document_fk" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE cascade;
ALTER TABLE "discovery_production_items" ADD CONSTRAINT "discovery_production_items_evidence_fk" FOREIGN KEY ("evidence_id") REFERENCES "civil_evidence_items"("id") ON DELETE cascade;
ALTER TABLE "discovery_production_items" ADD CONSTRAINT "discovery_production_items_evidence_matter_fk" FOREIGN KEY ("evidence_id", "matter_id") REFERENCES "civil_evidence_items"("id", "matter_id") ON DELETE cascade;
ALTER TABLE "discovery_production_items" ADD CONSTRAINT "discovery_production_items_request_item_fk" FOREIGN KEY ("request_item_id") REFERENCES "discovery_request_items"("id") ON DELETE set null;
ALTER TABLE "discovery_production_items" ADD CONSTRAINT "discovery_production_items_request_item_matter_fk" FOREIGN KEY ("request_item_id", "matter_id") REFERENCES "discovery_request_items"("id", "matter_id") ON DELETE set null;

CREATE TABLE "discovery_bates_ranges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "production_id" uuid NOT NULL,
  "prefix" text DEFAULT '' NOT NULL,
  "start_number" integer,
  "end_number" integer,
  "raw_text" text DEFAULT '' NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "discovery_bates_ranges_order_chk" CHECK (
    "start_number" IS NULL OR "end_number" IS NULL OR "end_number" >= "start_number"
  )
);
CREATE UNIQUE INDEX "discovery_bates_ranges_id_matter_uidx" ON "discovery_bates_ranges" ("id", "matter_id");
CREATE INDEX "discovery_bates_ranges_production_idx" ON "discovery_bates_ranges" ("production_id");
CREATE INDEX "discovery_bates_ranges_prefix_idx" ON "discovery_bates_ranges" ("matter_id", "prefix");
CREATE INDEX "discovery_bates_ranges_org_matter_idx" ON "discovery_bates_ranges" ("organization_id", "matter_id");
ALTER TABLE "discovery_bates_ranges" ADD CONSTRAINT "discovery_bates_ranges_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "discovery_bates_ranges" ADD CONSTRAINT "discovery_bates_ranges_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "discovery_bates_ranges" ADD CONSTRAINT "discovery_bates_ranges_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
ALTER TABLE "discovery_bates_ranges" ADD CONSTRAINT "discovery_bates_ranges_production_fk" FOREIGN KEY ("production_id") REFERENCES "discovery_productions"("id") ON DELETE cascade;
ALTER TABLE "discovery_bates_ranges" ADD CONSTRAINT "discovery_bates_ranges_production_matter_fk" FOREIGN KEY ("production_id", "matter_id") REFERENCES "discovery_productions"("id", "matter_id") ON DELETE cascade;
ALTER TABLE "discovery_bates_ranges" ADD CONSTRAINT "discovery_bates_ranges_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");

CREATE TABLE "discovery_production_custodians" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "production_id" uuid NOT NULL,
  "custodian_entity_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "discovery_production_custodians_uidx" ON "discovery_production_custodians" ("production_id", "custodian_entity_id");
CREATE INDEX "discovery_production_custodians_org_matter_idx" ON "discovery_production_custodians" ("organization_id", "matter_id");
ALTER TABLE "discovery_production_custodians" ADD CONSTRAINT "discovery_production_custodians_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "discovery_production_custodians" ADD CONSTRAINT "discovery_production_custodians_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "discovery_production_custodians" ADD CONSTRAINT "discovery_production_custodians_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
ALTER TABLE "discovery_production_custodians" ADD CONSTRAINT "discovery_production_custodians_production_fk" FOREIGN KEY ("production_id") REFERENCES "discovery_productions"("id") ON DELETE cascade;
ALTER TABLE "discovery_production_custodians" ADD CONSTRAINT "discovery_production_custodians_production_matter_fk" FOREIGN KEY ("production_id", "matter_id") REFERENCES "discovery_productions"("id", "matter_id") ON DELETE cascade;
ALTER TABLE "discovery_production_custodians" ADD CONSTRAINT "discovery_production_custodians_entity_fk" FOREIGN KEY ("custodian_entity_id") REFERENCES "matter_entities"("id") ON DELETE cascade;
ALTER TABLE "discovery_production_custodians" ADD CONSTRAINT "discovery_production_custodians_entity_matter_fk" FOREIGN KEY ("custodian_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE cascade;

CREATE TABLE "discovery_response_productions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "response_id" uuid NOT NULL,
  "production_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "discovery_response_productions_uidx" ON "discovery_response_productions" ("response_id", "production_id");
CREATE INDEX "discovery_response_productions_org_matter_idx" ON "discovery_response_productions" ("organization_id", "matter_id");
ALTER TABLE "discovery_response_productions" ADD CONSTRAINT "discovery_response_productions_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "discovery_response_productions" ADD CONSTRAINT "discovery_response_productions_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "discovery_response_productions" ADD CONSTRAINT "discovery_response_productions_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
ALTER TABLE "discovery_response_productions" ADD CONSTRAINT "discovery_response_productions_response_fk" FOREIGN KEY ("response_id") REFERENCES "discovery_responses"("id") ON DELETE cascade;
ALTER TABLE "discovery_response_productions" ADD CONSTRAINT "discovery_response_productions_response_matter_fk" FOREIGN KEY ("response_id", "matter_id") REFERENCES "discovery_responses"("id", "matter_id") ON DELETE cascade;
ALTER TABLE "discovery_response_productions" ADD CONSTRAINT "discovery_response_productions_production_fk" FOREIGN KEY ("production_id") REFERENCES "discovery_productions"("id") ON DELETE cascade;
ALTER TABLE "discovery_response_productions" ADD CONSTRAINT "discovery_response_productions_production_matter_fk" FOREIGN KEY ("production_id", "matter_id") REFERENCES "discovery_productions"("id", "matter_id") ON DELETE cascade;

CREATE TABLE "discovery_meet_and_confer_issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "label" text NOT NULL,
  "occurred_at" timestamp with time zone,
  "communication_id" uuid,
  "task_id" uuid,
  "outcome_notes" text,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "discovery_meet_and_confer_issues_id_matter_uidx" ON "discovery_meet_and_confer_issues" ("id", "matter_id");
CREATE UNIQUE INDEX "discovery_meet_and_confer_issues_id_org_uidx" ON "discovery_meet_and_confer_issues" ("id", "organization_id");
CREATE INDEX "discovery_meet_and_confer_issues_org_matter_idx" ON "discovery_meet_and_confer_issues" ("organization_id", "matter_id");
ALTER TABLE "discovery_meet_and_confer_issues" ADD CONSTRAINT "discovery_meet_and_confer_issues_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "discovery_meet_and_confer_issues" ADD CONSTRAINT "discovery_meet_and_confer_issues_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "discovery_meet_and_confer_issues" ADD CONSTRAINT "discovery_meet_and_confer_issues_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
ALTER TABLE "discovery_meet_and_confer_issues" ADD CONSTRAINT "discovery_meet_and_confer_issues_task_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE set null;
ALTER TABLE "discovery_meet_and_confer_issues" ADD CONSTRAINT "discovery_meet_and_confer_issues_task_matter_fk" FOREIGN KEY ("task_id", "matter_id") REFERENCES "tasks"("id", "matter_id") ON DELETE set null;
ALTER TABLE "discovery_meet_and_confer_issues" ADD CONSTRAINT "discovery_meet_and_confer_issues_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
ALTER TABLE "discovery_meet_and_confer_issues" ADD CONSTRAINT "discovery_meet_and_confer_issues_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");

CREATE TABLE "discovery_deficiencies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "status" text DEFAULT 'OPEN' NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "item_id" uuid,
  "production_id" uuid,
  "opened_at" timestamp with time zone,
  "responsible_party_entity_id" uuid,
  "communication_id" uuid,
  "meet_and_confer_id" uuid,
  "motion_id" uuid,
  "motion_document_id" uuid,
  "is_review_signal" boolean DEFAULT true NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "discovery_deficiencies_kind_chk" CHECK ("kind" IN (
    'NO_RESPONSE','PARTIAL_RESPONSE','OBJECTION_ONLY','MISSING_PRODUCTION','INCOMPLETE_PRODUCTION',
    'UNREADABLE_DOCUMENT','MISSING_ATTACHMENT','BATES_GAP','UNIDENTIFIED_CUSTODIAN',
    'PRIVILEGE_LOG_MISSING','SUPPLEMENT_EXPECTED','OTHER'
  )),
  CONSTRAINT "discovery_deficiencies_status_chk" CHECK ("status" IN (
    'OPEN','MEET_AND_CONFER','MOTION_PENDING','RESOLVED','WITHDRAWN','UNKNOWN'
  )),
  CONSTRAINT "discovery_deficiencies_no_sanctions_chk" CHECK ("kind" NOT IN ('SANCTIONS','VIOLATION_ESTABLISHED'))
);
CREATE UNIQUE INDEX "discovery_deficiencies_id_matter_uidx" ON "discovery_deficiencies" ("id", "matter_id");
CREATE UNIQUE INDEX "discovery_deficiencies_id_org_uidx" ON "discovery_deficiencies" ("id", "organization_id");
CREATE INDEX "discovery_deficiencies_org_matter_idx" ON "discovery_deficiencies" ("organization_id", "matter_id");
CREATE INDEX "discovery_deficiencies_status_idx" ON "discovery_deficiencies" ("matter_id", "status");
CREATE INDEX "discovery_deficiencies_item_idx" ON "discovery_deficiencies" ("item_id");
ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_item_fk" FOREIGN KEY ("item_id") REFERENCES "discovery_request_items"("id") ON DELETE set null;
ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_item_matter_fk" FOREIGN KEY ("item_id", "matter_id") REFERENCES "discovery_request_items"("id", "matter_id") ON DELETE set null;
ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_production_fk" FOREIGN KEY ("production_id") REFERENCES "discovery_productions"("id") ON DELETE set null;
ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_production_matter_fk" FOREIGN KEY ("production_id", "matter_id") REFERENCES "discovery_productions"("id", "matter_id") ON DELETE set null;
ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_party_fk" FOREIGN KEY ("responsible_party_entity_id") REFERENCES "matter_entities"("id") ON DELETE set null;
ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_party_matter_fk" FOREIGN KEY ("responsible_party_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE set null;
ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_mac_fk" FOREIGN KEY ("meet_and_confer_id") REFERENCES "discovery_meet_and_confer_issues"("id") ON DELETE set null;
ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_mac_matter_fk" FOREIGN KEY ("meet_and_confer_id", "matter_id") REFERENCES "discovery_meet_and_confer_issues"("id", "matter_id") ON DELETE set null;
ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_motion_document_fk" FOREIGN KEY ("motion_document_id") REFERENCES "documents"("id") ON DELETE set null;
ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
ALTER TABLE "discovery_deficiencies" ADD CONSTRAINT "discovery_deficiencies_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");

CREATE TABLE "discovery_meet_and_confer_deficiency_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "meet_and_confer_id" uuid NOT NULL,
  "deficiency_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "discovery_mac_deficiency_links_uidx" ON "discovery_meet_and_confer_deficiency_links" ("meet_and_confer_id", "deficiency_id");
CREATE INDEX "discovery_mac_deficiency_links_org_matter_idx" ON "discovery_meet_and_confer_deficiency_links" ("organization_id", "matter_id");
ALTER TABLE "discovery_meet_and_confer_deficiency_links" ADD CONSTRAINT "discovery_mac_deficiency_links_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "discovery_meet_and_confer_deficiency_links" ADD CONSTRAINT "discovery_mac_deficiency_links_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "discovery_meet_and_confer_deficiency_links" ADD CONSTRAINT "discovery_mac_deficiency_links_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
ALTER TABLE "discovery_meet_and_confer_deficiency_links" ADD CONSTRAINT "discovery_mac_deficiency_links_mac_fk" FOREIGN KEY ("meet_and_confer_id") REFERENCES "discovery_meet_and_confer_issues"("id") ON DELETE cascade;
ALTER TABLE "discovery_meet_and_confer_deficiency_links" ADD CONSTRAINT "discovery_mac_deficiency_links_mac_matter_fk" FOREIGN KEY ("meet_and_confer_id", "matter_id") REFERENCES "discovery_meet_and_confer_issues"("id", "matter_id") ON DELETE cascade;
ALTER TABLE "discovery_meet_and_confer_deficiency_links" ADD CONSTRAINT "discovery_mac_deficiency_links_def_fk" FOREIGN KEY ("deficiency_id") REFERENCES "discovery_deficiencies"("id") ON DELETE cascade;
ALTER TABLE "discovery_meet_and_confer_deficiency_links" ADD CONSTRAINT "discovery_mac_deficiency_links_def_matter_fk" FOREIGN KEY ("deficiency_id", "matter_id") REFERENCES "discovery_deficiencies"("id", "matter_id") ON DELETE cascade;

CREATE TABLE "discovery_privilege_assertions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "status" text DEFAULT 'ASSERTED' NOT NULL,
  "asserted_basis" text NOT NULL,
  "asserting_party_entity_id" uuid NOT NULL,
  "asserted_at" timestamp with time zone,
  "document_id" uuid,
  "evidence_id" uuid,
  "production_id" uuid,
  "privilege_log_document_id" uuid,
  "review_notes" text,
  "court_ruling_referenced" boolean DEFAULT false NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "discovery_privilege_assertions_status_chk" CHECK ("status" IN (
    'ASSERTED','UNDER_REVIEW','CHALLENGED','WITHDRAWN','RESOLVED','UNKNOWN'
  )),
  CONSTRAINT "discovery_privilege_assertions_no_legal_conclusion_chk" CHECK (
    "status" NOT IN ('PRIVILEGED','NOT_PRIVILEGED','PRIVILEGE_ESTABLISHED')
  )
);
CREATE UNIQUE INDEX "discovery_privilege_assertions_id_matter_uidx" ON "discovery_privilege_assertions" ("id", "matter_id");
CREATE UNIQUE INDEX "discovery_privilege_assertions_id_org_uidx" ON "discovery_privilege_assertions" ("id", "organization_id");
CREATE INDEX "discovery_privilege_assertions_org_matter_idx" ON "discovery_privilege_assertions" ("organization_id", "matter_id");
CREATE INDEX "discovery_privilege_assertions_status_idx" ON "discovery_privilege_assertions" ("matter_id", "status");
ALTER TABLE "discovery_privilege_assertions" ADD CONSTRAINT "discovery_privilege_assertions_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "discovery_privilege_assertions" ADD CONSTRAINT "discovery_privilege_assertions_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "discovery_privilege_assertions" ADD CONSTRAINT "discovery_privilege_assertions_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
ALTER TABLE "discovery_privilege_assertions" ADD CONSTRAINT "discovery_privilege_assertions_party_fk" FOREIGN KEY ("asserting_party_entity_id") REFERENCES "matter_entities"("id") ON DELETE restrict;
ALTER TABLE "discovery_privilege_assertions" ADD CONSTRAINT "discovery_privilege_assertions_party_matter_fk" FOREIGN KEY ("asserting_party_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE restrict;
ALTER TABLE "discovery_privilege_assertions" ADD CONSTRAINT "discovery_privilege_assertions_document_fk" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE set null;
ALTER TABLE "discovery_privilege_assertions" ADD CONSTRAINT "discovery_privilege_assertions_evidence_fk" FOREIGN KEY ("evidence_id") REFERENCES "civil_evidence_items"("id") ON DELETE set null;
ALTER TABLE "discovery_privilege_assertions" ADD CONSTRAINT "discovery_privilege_assertions_evidence_matter_fk" FOREIGN KEY ("evidence_id", "matter_id") REFERENCES "civil_evidence_items"("id", "matter_id") ON DELETE set null;
ALTER TABLE "discovery_privilege_assertions" ADD CONSTRAINT "discovery_privilege_assertions_production_fk" FOREIGN KEY ("production_id") REFERENCES "discovery_productions"("id") ON DELETE set null;
ALTER TABLE "discovery_privilege_assertions" ADD CONSTRAINT "discovery_privilege_assertions_production_matter_fk" FOREIGN KEY ("production_id", "matter_id") REFERENCES "discovery_productions"("id", "matter_id") ON DELETE set null;
ALTER TABLE "discovery_privilege_assertions" ADD CONSTRAINT "discovery_privilege_assertions_log_document_fk" FOREIGN KEY ("privilege_log_document_id") REFERENCES "documents"("id") ON DELETE set null;
ALTER TABLE "discovery_privilege_assertions" ADD CONSTRAINT "discovery_privilege_assertions_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
ALTER TABLE "discovery_privilege_assertions" ADD CONSTRAINT "discovery_privilege_assertions_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");
