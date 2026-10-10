-- Matter motions + communications (Deepening Pass 6).
-- Additive only. No automatic jurisdictional deadline inference.
-- Nulls orphan opaque discovery motion/communication UUIDs before FK hardening.
-- Reverse with 0023_matter_motions_communications.down.sql before data is relied upon.
-- Graph enum values cannot be safely removed (see down file).

CREATE UNIQUE INDEX IF NOT EXISTS "matters_id_org_uidx" ON "matters" ("id", "organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "matter_entities_id_matter_uidx" ON "matter_entities" ("id", "matter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "tasks_id_matter_uidx" ON "tasks" ("id", "matter_id");

ALTER TYPE "public"."graph_node_type" ADD VALUE IF NOT EXISTS 'motion';
ALTER TYPE "public"."graph_node_type" ADD VALUE IF NOT EXISTS 'communication';

CREATE TABLE "matter_motions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "motion_type" text NOT NULL,
  "title" text NOT NULL,
  "summary" text,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "moving_party_entity_id" uuid,
  "opposing_party_entity_id" uuid,
  "filed_at" timestamp with time zone,
  "served_at" timestamp with time zone,
  "opposition_due_at" timestamp with time zone,
  "opposition_filed_at" timestamp with time zone,
  "reply_due_at" timestamp with time zone,
  "reply_filed_at" timestamp with time zone,
  "hearing_at" timestamp with time zone,
  "ruling_at" timestamp with time zone,
  "disposition" text,
  "ruling_summary" text,
  "court_name" text,
  "judge_name" text,
  "primary_document_id" uuid,
  "order_document_id" uuid,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "matter_motions_type_chk" CHECK ("motion_type" IN (
    'MOTION_TO_COMPEL','PROTECTIVE_ORDER','SANCTIONS','MOTION_TO_DISMISS','SUMMARY_JUDGMENT',
    'MOTION_IN_LIMINE','MOTION_TO_EXCLUDE','MOTION_TO_STRIKE','RECONSIDERATION','DISCOVERY',
    'PROCEDURAL','OTHER'
  )),
  CONSTRAINT "matter_motions_status_chk" CHECK ("status" IN (
    'DRAFT','PLANNED','FILED','SERVED','OPPOSITION_DUE','OPPOSITION_FILED','REPLY_DUE','REPLY_FILED',
    'HEARING_SCHEDULED','SUBMITTED','GRANTED','DENIED','GRANTED_IN_PART','WITHDRAWN','MOOT','OTHER','UNKNOWN'
  )),
  CONSTRAINT "matter_motions_disposition_chk" CHECK (
    "disposition" IS NULL OR "disposition" IN (
      'GRANTED','DENIED','GRANTED_IN_PART','DENIED_IN_PART','WITHDRAWN','MOOT','OTHER','UNKNOWN'
    )
  )
);
CREATE UNIQUE INDEX "matter_motions_id_matter_uidx" ON "matter_motions" ("id", "matter_id");
CREATE UNIQUE INDEX "matter_motions_id_org_uidx" ON "matter_motions" ("id", "organization_id");
CREATE INDEX "matter_motions_org_matter_idx" ON "matter_motions" ("organization_id", "matter_id");
CREATE INDEX "matter_motions_matter_status_idx" ON "matter_motions" ("matter_id", "status");
CREATE INDEX "matter_motions_matter_type_idx" ON "matter_motions" ("matter_id", "motion_type");
CREATE INDEX "matter_motions_matter_hearing_idx" ON "matter_motions" ("matter_id", "hearing_at");
ALTER TABLE "matter_motions" ADD CONSTRAINT "matter_motions_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "matter_motions" ADD CONSTRAINT "matter_motions_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "matter_motions" ADD CONSTRAINT "matter_motions_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
ALTER TABLE "matter_motions" ADD CONSTRAINT "matter_motions_moving_party_fk" FOREIGN KEY ("moving_party_entity_id") REFERENCES "matter_entities"("id") ON DELETE set null;
ALTER TABLE "matter_motions" ADD CONSTRAINT "matter_motions_opposing_party_fk" FOREIGN KEY ("opposing_party_entity_id") REFERENCES "matter_entities"("id") ON DELETE set null;
ALTER TABLE "matter_motions" ADD CONSTRAINT "matter_motions_moving_party_matter_fk" FOREIGN KEY ("moving_party_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE set null;
ALTER TABLE "matter_motions" ADD CONSTRAINT "matter_motions_opposing_party_matter_fk" FOREIGN KEY ("opposing_party_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE set null;
ALTER TABLE "matter_motions" ADD CONSTRAINT "matter_motions_primary_document_fk" FOREIGN KEY ("primary_document_id") REFERENCES "documents"("id") ON DELETE set null;
ALTER TABLE "matter_motions" ADD CONSTRAINT "matter_motions_order_document_fk" FOREIGN KEY ("order_document_id") REFERENCES "documents"("id") ON DELETE set null;
ALTER TABLE "matter_motions" ADD CONSTRAINT "matter_motions_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
ALTER TABLE "matter_motions" ADD CONSTRAINT "matter_motions_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");

CREATE TABLE "matter_motion_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "motion_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "role" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "matter_motion_documents_role_chk" CHECK ("role" IN (
    'MOTION','BRIEF','OPPOSITION','REPLY','DECLARATION','EXHIBIT','ORDER','TRANSCRIPT','OTHER'
  ))
);
CREATE UNIQUE INDEX "matter_motion_documents_edge_uidx" ON "matter_motion_documents" ("motion_id", "document_id", "role");
CREATE INDEX "matter_motion_documents_org_matter_idx" ON "matter_motion_documents" ("organization_id", "matter_id");
CREATE INDEX "matter_motion_documents_motion_idx" ON "matter_motion_documents" ("motion_id");
CREATE INDEX "matter_motion_documents_document_idx" ON "matter_motion_documents" ("document_id");
ALTER TABLE "matter_motion_documents" ADD CONSTRAINT "matter_motion_documents_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "matter_motion_documents" ADD CONSTRAINT "matter_motion_documents_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "matter_motion_documents" ADD CONSTRAINT "matter_motion_documents_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
ALTER TABLE "matter_motion_documents" ADD CONSTRAINT "matter_motion_documents_motion_fk" FOREIGN KEY ("motion_id") REFERENCES "matter_motions"("id") ON DELETE cascade;
ALTER TABLE "matter_motion_documents" ADD CONSTRAINT "matter_motion_documents_motion_matter_fk" FOREIGN KEY ("motion_id", "matter_id") REFERENCES "matter_motions"("id", "matter_id") ON DELETE cascade;
ALTER TABLE "matter_motion_documents" ADD CONSTRAINT "matter_motion_documents_document_fk" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE cascade;

CREATE TABLE "matter_motion_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "motion_id" uuid NOT NULL,
  "link_type" text NOT NULL,
  "target_id" uuid NOT NULL,
  "note" text,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "matter_motion_links_type_chk" CHECK ("link_type" IN (
    'CLAIM','DEFENSE','CLAIM_ELEMENT','DEFENSE_ELEMENT','LEGAL_ISSUE','DISCOVERY_REQUEST_ITEM',
    'DISCOVERY_DEFICIENCY','PRIVILEGE_ASSERTION','EVIDENCE','COMMUNICATION','TASK','DEADLINE_CANDIDATE'
  ))
);
CREATE UNIQUE INDEX "matter_motion_links_edge_uidx" ON "matter_motion_links" ("motion_id", "link_type", "target_id");
CREATE INDEX "matter_motion_links_org_matter_idx" ON "matter_motion_links" ("organization_id", "matter_id");
CREATE INDEX "matter_motion_links_matter_type_idx" ON "matter_motion_links" ("matter_id", "link_type");
CREATE INDEX "matter_motion_links_target_type_idx" ON "matter_motion_links" ("target_id", "link_type");
ALTER TABLE "matter_motion_links" ADD CONSTRAINT "matter_motion_links_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "matter_motion_links" ADD CONSTRAINT "matter_motion_links_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "matter_motion_links" ADD CONSTRAINT "matter_motion_links_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
ALTER TABLE "matter_motion_links" ADD CONSTRAINT "matter_motion_links_motion_fk" FOREIGN KEY ("motion_id") REFERENCES "matter_motions"("id") ON DELETE cascade;
ALTER TABLE "matter_motion_links" ADD CONSTRAINT "matter_motion_links_motion_matter_fk" FOREIGN KEY ("motion_id", "matter_id") REFERENCES "matter_motions"("id", "matter_id") ON DELETE cascade;

CREATE TABLE "matter_communications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "communication_type" text NOT NULL,
  "direction" text DEFAULT 'UNKNOWN' NOT NULL,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "occurred_at" timestamp with time zone,
  "subject" text NOT NULL,
  "summary" text,
  "sender_entity_id" uuid,
  "recipient_entity_id" uuid,
  "primary_document_id" uuid,
  "inbound_email_id" uuid,
  "follow_up_needed" boolean DEFAULT false NOT NULL,
  "follow_up_due_at" timestamp with time zone,
  "follow_up_task_id" uuid,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "matter_communications_type_chk" CHECK ("communication_type" IN (
    'MEET_AND_CONFER','DEMAND','RESPONSE','FOLLOW_UP','DEFICIENCY_NOTICE','EXTENSION_REQUEST',
    'STIPULATION_DISCUSSION','PRIVILEGE','OTHER_CORRESPONDENCE'
  )),
  CONSTRAINT "matter_communications_direction_chk" CHECK ("direction" IN (
    'OUTBOUND','INBOUND','INTERNAL','UNKNOWN'
  )),
  CONSTRAINT "matter_communications_status_chk" CHECK ("status" IN (
    'DRAFT','SENT','RECEIVED','AWAITING_RESPONSE','CLOSED','UNKNOWN'
  ))
);
CREATE UNIQUE INDEX "matter_communications_id_matter_uidx" ON "matter_communications" ("id", "matter_id");
CREATE UNIQUE INDEX "matter_communications_id_org_uidx" ON "matter_communications" ("id", "organization_id");
CREATE INDEX "matter_communications_org_matter_idx" ON "matter_communications" ("organization_id", "matter_id");
CREATE INDEX "matter_communications_matter_occurred_idx" ON "matter_communications" ("matter_id", "occurred_at" DESC);
CREATE INDEX "matter_communications_matter_type_idx" ON "matter_communications" ("matter_id", "communication_type");
CREATE INDEX "matter_communications_matter_follow_up_idx" ON "matter_communications" ("matter_id", "follow_up_needed");
ALTER TABLE "matter_communications" ADD CONSTRAINT "matter_communications_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "matter_communications" ADD CONSTRAINT "matter_communications_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "matter_communications" ADD CONSTRAINT "matter_communications_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
ALTER TABLE "matter_communications" ADD CONSTRAINT "matter_communications_sender_fk" FOREIGN KEY ("sender_entity_id") REFERENCES "matter_entities"("id") ON DELETE set null;
ALTER TABLE "matter_communications" ADD CONSTRAINT "matter_communications_recipient_fk" FOREIGN KEY ("recipient_entity_id") REFERENCES "matter_entities"("id") ON DELETE set null;
ALTER TABLE "matter_communications" ADD CONSTRAINT "matter_communications_sender_matter_fk" FOREIGN KEY ("sender_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE set null;
ALTER TABLE "matter_communications" ADD CONSTRAINT "matter_communications_recipient_matter_fk" FOREIGN KEY ("recipient_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE set null;
ALTER TABLE "matter_communications" ADD CONSTRAINT "matter_communications_primary_document_fk" FOREIGN KEY ("primary_document_id") REFERENCES "documents"("id") ON DELETE set null;
ALTER TABLE "matter_communications" ADD CONSTRAINT "matter_communications_inbound_email_fk" FOREIGN KEY ("inbound_email_id") REFERENCES "inbound_emails"("id") ON DELETE set null;
ALTER TABLE "matter_communications" ADD CONSTRAINT "matter_communications_follow_up_task_fk" FOREIGN KEY ("follow_up_task_id") REFERENCES "tasks"("id") ON DELETE set null;
ALTER TABLE "matter_communications" ADD CONSTRAINT "matter_communications_follow_up_task_matter_fk" FOREIGN KEY ("follow_up_task_id", "matter_id") REFERENCES "tasks"("id", "matter_id") ON DELETE set null;
ALTER TABLE "matter_communications" ADD CONSTRAINT "matter_communications_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
ALTER TABLE "matter_communications" ADD CONSTRAINT "matter_communications_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");

CREATE TABLE "matter_communication_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "communication_id" uuid NOT NULL,
  "link_type" text NOT NULL,
  "target_id" uuid NOT NULL,
  "note" text,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "matter_communication_links_type_chk" CHECK ("link_type" IN (
    'DISCOVERY_REQUEST_ITEM','DISCOVERY_RESPONSE','DISCOVERY_DEFICIENCY','MEET_AND_CONFER','MOTION',
    'PRIVILEGE_ASSERTION','CLAIM','DEFENSE','EVIDENCE','DOCUMENT','TASK'
  ))
);
CREATE UNIQUE INDEX "matter_communication_links_edge_uidx" ON "matter_communication_links" ("communication_id", "link_type", "target_id");
CREATE INDEX "matter_communication_links_org_matter_idx" ON "matter_communication_links" ("organization_id", "matter_id");
CREATE INDEX "matter_communication_links_matter_type_idx" ON "matter_communication_links" ("matter_id", "link_type");
CREATE INDEX "matter_communication_links_target_type_idx" ON "matter_communication_links" ("target_id", "link_type");
ALTER TABLE "matter_communication_links" ADD CONSTRAINT "matter_communication_links_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "matter_communication_links" ADD CONSTRAINT "matter_communication_links_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "matter_communication_links" ADD CONSTRAINT "matter_communication_links_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;
ALTER TABLE "matter_communication_links" ADD CONSTRAINT "matter_communication_links_communication_fk" FOREIGN KEY ("communication_id") REFERENCES "matter_communications"("id") ON DELETE cascade;
ALTER TABLE "matter_communication_links" ADD CONSTRAINT "matter_communication_links_communication_matter_fk" FOREIGN KEY ("communication_id", "matter_id") REFERENCES "matter_communications"("id", "matter_id") ON DELETE cascade;

-- Discovery FK hardening: clear orphan opaque UUIDs (no parent rows yet; do not fabricate entities).
UPDATE "discovery_deficiencies"
SET "motion_id" = NULL
WHERE "motion_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "matter_motions" m
    WHERE m."id" = "discovery_deficiencies"."motion_id"
      AND m."matter_id" = "discovery_deficiencies"."matter_id"
  );

UPDATE "discovery_deficiencies"
SET "communication_id" = NULL
WHERE "communication_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "matter_communications" c
    WHERE c."id" = "discovery_deficiencies"."communication_id"
      AND c."matter_id" = "discovery_deficiencies"."matter_id"
  );

UPDATE "discovery_meet_and_confer_issues"
SET "communication_id" = NULL
WHERE "communication_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "matter_communications" c
    WHERE c."id" = "discovery_meet_and_confer_issues"."communication_id"
      AND c."matter_id" = "discovery_meet_and_confer_issues"."matter_id"
  );

ALTER TABLE "discovery_deficiencies"
  ADD CONSTRAINT "discovery_deficiencies_motion_matter_fk"
  FOREIGN KEY ("motion_id", "matter_id") REFERENCES "matter_motions"("id", "matter_id") ON DELETE set null;

ALTER TABLE "discovery_deficiencies"
  ADD CONSTRAINT "discovery_deficiencies_communication_matter_fk"
  FOREIGN KEY ("communication_id", "matter_id") REFERENCES "matter_communications"("id", "matter_id") ON DELETE set null;

ALTER TABLE "discovery_meet_and_confer_issues"
  ADD CONSTRAINT "discovery_meet_and_confer_issues_communication_matter_fk"
  FOREIGN KEY ("communication_id", "matter_id") REFERENCES "matter_communications"("id", "matter_id") ON DELETE set null;
