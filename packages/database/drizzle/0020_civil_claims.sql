-- Civil claims / defenses / counterclaims persistence.
-- Additive only. Existing matters remain valid with zero civil rows.
-- No liability / win / lose columns.
-- Reverse with 0020_civil_claims.down.sql before data is relied upon.
-- Composite matter/org FKs mirror 0019_week3_case_isolation.

-- Supporting unique indexes for composite FKs (must exist before FK creation)
CREATE UNIQUE INDEX IF NOT EXISTS "matters_id_org_uidx" ON "matters" ("id", "organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "matter_entities_id_matter_uidx" ON "matter_entities" ("id", "matter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "matter_facts_id_matter_uidx" ON "matter_facts" ("id", "matter_id");

CREATE TABLE "civil_pleadings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "document_id" uuid,
  "label" text NOT NULL,
  "pleading_type" text DEFAULT 'complaint' NOT NULL,
  "filed_at" timestamp with time zone,
  "is_current" boolean DEFAULT true NOT NULL,
  "superseded_by_id" uuid,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "civil_pleadings_id_matter_uidx" ON "civil_pleadings" ("id", "matter_id");
CREATE UNIQUE INDEX "civil_pleadings_id_org_uidx" ON "civil_pleadings" ("id", "organization_id");
CREATE INDEX "civil_pleadings_org_matter_idx" ON "civil_pleadings" ("organization_id", "matter_id");
CREATE INDEX "civil_pleadings_matter_current_idx" ON "civil_pleadings" ("matter_id", "is_current");
ALTER TABLE "civil_pleadings" ADD CONSTRAINT "civil_pleadings_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "civil_pleadings" ADD CONSTRAINT "civil_pleadings_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "civil_pleadings" ADD CONSTRAINT "civil_pleadings_document_fk" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE set null;
ALTER TABLE "civil_pleadings" ADD CONSTRAINT "civil_pleadings_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
ALTER TABLE "civil_pleadings" ADD CONSTRAINT "civil_pleadings_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");
ALTER TABLE "civil_pleadings" ADD CONSTRAINT "civil_pleadings_superseded_by_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "civil_pleadings"("id") ON DELETE set null;

CREATE TABLE "civil_claims" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "pleading_id" uuid,
  "kind" text NOT NULL,
  "category" text DEFAULT 'OTHER' NOT NULL,
  "label" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "support_status" text DEFAULT 'UNKNOWN' NOT NULL,
  "procedural_status" text DEFAULT 'PLED' NOT NULL,
  "is_current" boolean DEFAULT true NOT NULL,
  "superseded_by_id" uuid,
  "damages_or_remedy" jsonb,
  "uncertainty" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "civil_claims_support_status_chk" CHECK ("support_status" IN ('SUPPORTED','PARTIALLY_SUPPORTED','CONFLICTED','NO_EVIDENCE_FOUND','UNKNOWN')),
  CONSTRAINT "civil_claims_no_liability_chk" CHECK ("support_status" NOT IN ('WIN','LOSE','LIABLE','NOT_LIABLE','LIKELY_WIN'))
);
CREATE UNIQUE INDEX "civil_claims_id_matter_uidx" ON "civil_claims" ("id", "matter_id");
CREATE UNIQUE INDEX "civil_claims_id_org_uidx" ON "civil_claims" ("id", "organization_id");
CREATE INDEX "civil_claims_org_matter_idx" ON "civil_claims" ("organization_id", "matter_id");
CREATE INDEX "civil_claims_matter_current_idx" ON "civil_claims" ("matter_id", "is_current");
CREATE INDEX "civil_claims_pleading_idx" ON "civil_claims" ("pleading_id");
ALTER TABLE "civil_claims" ADD CONSTRAINT "civil_claims_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "civil_claims" ADD CONSTRAINT "civil_claims_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "civil_claims" ADD CONSTRAINT "civil_claims_pleading_fk" FOREIGN KEY ("pleading_id") REFERENCES "civil_pleadings"("id") ON DELETE set null;
ALTER TABLE "civil_claims" ADD CONSTRAINT "civil_claims_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
ALTER TABLE "civil_claims" ADD CONSTRAINT "civil_claims_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");
ALTER TABLE "civil_claims" ADD CONSTRAINT "civil_claims_superseded_by_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "civil_claims"("id") ON DELETE set null;
ALTER TABLE "civil_claims" ADD CONSTRAINT "civil_claims_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;

CREATE TABLE "civil_claim_parties" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "claim_id" uuid NOT NULL,
  "party_entity_id" uuid NOT NULL,
  "role" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "civil_claim_parties_role_chk" CHECK ("role" IN ('PLAINTIFF','DEFENDANT','COUNTERCLAIMANT','COUNTERCLAIM_DEFENDANT','THIRD_PARTY_PLAINTIFF','THIRD_PARTY_DEFENDANT','OTHER'))
);
CREATE UNIQUE INDEX "civil_claim_parties_edge_uidx" ON "civil_claim_parties" ("claim_id", "party_entity_id", "role");
CREATE INDEX "civil_claim_parties_claim_idx" ON "civil_claim_parties" ("claim_id");
CREATE INDEX "civil_claim_parties_party_idx" ON "civil_claim_parties" ("party_entity_id");
CREATE INDEX "civil_claim_parties_org_matter_idx" ON "civil_claim_parties" ("organization_id", "matter_id");
ALTER TABLE "civil_claim_parties" ADD CONSTRAINT "civil_claim_parties_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "civil_claim_parties" ADD CONSTRAINT "civil_claim_parties_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "civil_claim_parties" ADD CONSTRAINT "civil_claim_parties_claim_fk" FOREIGN KEY ("claim_id") REFERENCES "civil_claims"("id") ON DELETE cascade;
ALTER TABLE "civil_claim_parties" ADD CONSTRAINT "civil_claim_parties_entity_fk" FOREIGN KEY ("party_entity_id") REFERENCES "matter_entities"("id") ON DELETE cascade;
ALTER TABLE "civil_claim_parties" ADD CONSTRAINT "civil_claim_parties_claim_matter_fk" FOREIGN KEY ("claim_id", "matter_id") REFERENCES "civil_claims"("id", "matter_id") ON DELETE cascade;
ALTER TABLE "civil_claim_parties" ADD CONSTRAINT "civil_claim_parties_entity_matter_fk" FOREIGN KEY ("party_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE cascade;

CREATE TABLE "civil_defenses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "pleading_id" uuid,
  "kind" text NOT NULL,
  "label" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "support_status" text DEFAULT 'UNKNOWN' NOT NULL,
  "procedural_status" text DEFAULT 'PLED' NOT NULL,
  "is_current" boolean DEFAULT true NOT NULL,
  "superseded_by_id" uuid,
  "uncertainty" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "civil_defenses_support_status_chk" CHECK ("support_status" IN ('SUPPORTED','PARTIALLY_SUPPORTED','CONFLICTED','NO_EVIDENCE_FOUND','UNKNOWN'))
);
CREATE UNIQUE INDEX "civil_defenses_id_matter_uidx" ON "civil_defenses" ("id", "matter_id");
CREATE UNIQUE INDEX "civil_defenses_id_org_uidx" ON "civil_defenses" ("id", "organization_id");
CREATE INDEX "civil_defenses_org_matter_idx" ON "civil_defenses" ("organization_id", "matter_id");
CREATE INDEX "civil_defenses_matter_current_idx" ON "civil_defenses" ("matter_id", "is_current");
CREATE INDEX "civil_defenses_pleading_idx" ON "civil_defenses" ("pleading_id");
ALTER TABLE "civil_defenses" ADD CONSTRAINT "civil_defenses_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "civil_defenses" ADD CONSTRAINT "civil_defenses_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "civil_defenses" ADD CONSTRAINT "civil_defenses_pleading_fk" FOREIGN KEY ("pleading_id") REFERENCES "civil_pleadings"("id") ON DELETE set null;
ALTER TABLE "civil_defenses" ADD CONSTRAINT "civil_defenses_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
ALTER TABLE "civil_defenses" ADD CONSTRAINT "civil_defenses_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");
ALTER TABLE "civil_defenses" ADD CONSTRAINT "civil_defenses_superseded_by_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "civil_defenses"("id") ON DELETE set null;
ALTER TABLE "civil_defenses" ADD CONSTRAINT "civil_defenses_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;

CREATE TABLE "civil_defense_claim_relations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "defense_id" uuid NOT NULL,
  "claim_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "civil_defense_claim_relations_uidx" ON "civil_defense_claim_relations" ("defense_id", "claim_id");
CREATE INDEX "civil_defense_claim_relations_defense_idx" ON "civil_defense_claim_relations" ("defense_id");
CREATE INDEX "civil_defense_claim_relations_claim_idx" ON "civil_defense_claim_relations" ("claim_id");
CREATE INDEX "civil_defense_claim_relations_org_matter_idx" ON "civil_defense_claim_relations" ("organization_id", "matter_id");
ALTER TABLE "civil_defense_claim_relations" ADD CONSTRAINT "civil_defense_claim_relations_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "civil_defense_claim_relations" ADD CONSTRAINT "civil_defense_claim_relations_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "civil_defense_claim_relations" ADD CONSTRAINT "civil_defense_claim_relations_defense_fk" FOREIGN KEY ("defense_id") REFERENCES "civil_defenses"("id") ON DELETE cascade;
ALTER TABLE "civil_defense_claim_relations" ADD CONSTRAINT "civil_defense_claim_relations_claim_fk" FOREIGN KEY ("claim_id") REFERENCES "civil_claims"("id") ON DELETE cascade;
ALTER TABLE "civil_defense_claim_relations" ADD CONSTRAINT "civil_defense_claim_relations_defense_matter_fk" FOREIGN KEY ("defense_id", "matter_id") REFERENCES "civil_defenses"("id", "matter_id") ON DELETE cascade;
ALTER TABLE "civil_defense_claim_relations" ADD CONSTRAINT "civil_defense_claim_relations_claim_matter_fk" FOREIGN KEY ("claim_id", "matter_id") REFERENCES "civil_claims"("id", "matter_id") ON DELETE cascade;

CREATE TABLE "civil_defense_parties" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "defense_id" uuid NOT NULL,
  "party_entity_id" uuid NOT NULL,
  "role" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "civil_defense_parties_role_chk" CHECK ("role" IN ('ASSERTING','TARGET'))
);
CREATE UNIQUE INDEX "civil_defense_parties_edge_uidx" ON "civil_defense_parties" ("defense_id", "party_entity_id", "role");
CREATE INDEX "civil_defense_parties_defense_idx" ON "civil_defense_parties" ("defense_id");
CREATE INDEX "civil_defense_parties_party_idx" ON "civil_defense_parties" ("party_entity_id");
ALTER TABLE "civil_defense_parties" ADD CONSTRAINT "civil_defense_parties_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "civil_defense_parties" ADD CONSTRAINT "civil_defense_parties_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "civil_defense_parties" ADD CONSTRAINT "civil_defense_parties_defense_fk" FOREIGN KEY ("defense_id") REFERENCES "civil_defenses"("id") ON DELETE cascade;
ALTER TABLE "civil_defense_parties" ADD CONSTRAINT "civil_defense_parties_entity_fk" FOREIGN KEY ("party_entity_id") REFERENCES "matter_entities"("id") ON DELETE cascade;
ALTER TABLE "civil_defense_parties" ADD CONSTRAINT "civil_defense_parties_defense_matter_fk" FOREIGN KEY ("defense_id", "matter_id") REFERENCES "civil_defenses"("id", "matter_id") ON DELETE cascade;
ALTER TABLE "civil_defense_parties" ADD CONSTRAINT "civil_defense_parties_entity_matter_fk" FOREIGN KEY ("party_entity_id", "matter_id") REFERENCES "matter_entities"("id", "matter_id") ON DELETE cascade;

CREATE TABLE "civil_claim_elements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "claim_id" uuid,
  "defense_id" uuid,
  "label" text NOT NULL,
  "requirement_text" text,
  "status" text DEFAULT 'UNKNOWN' NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "uncertainty" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "civil_claim_elements_parent_xor_chk" CHECK (
    ("claim_id" IS NOT NULL AND "defense_id" IS NULL) OR ("claim_id" IS NULL AND "defense_id" IS NOT NULL)
  ),
  CONSTRAINT "civil_claim_elements_status_chk" CHECK ("status" IN ('SUPPORTED','PARTIALLY_SUPPORTED','CONFLICTED','NO_EVIDENCE_FOUND','UNKNOWN'))
);
CREATE UNIQUE INDEX "civil_claim_elements_id_matter_uidx" ON "civil_claim_elements" ("id", "matter_id");
CREATE UNIQUE INDEX "civil_claim_elements_id_org_uidx" ON "civil_claim_elements" ("id", "organization_id");
CREATE INDEX "civil_claim_elements_claim_idx" ON "civil_claim_elements" ("claim_id");
CREATE INDEX "civil_claim_elements_defense_idx" ON "civil_claim_elements" ("defense_id");
CREATE INDEX "civil_claim_elements_org_matter_idx" ON "civil_claim_elements" ("organization_id", "matter_id");
ALTER TABLE "civil_claim_elements" ADD CONSTRAINT "civil_claim_elements_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "civil_claim_elements" ADD CONSTRAINT "civil_claim_elements_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "civil_claim_elements" ADD CONSTRAINT "civil_claim_elements_claim_fk" FOREIGN KEY ("claim_id") REFERENCES "civil_claims"("id") ON DELETE cascade;
ALTER TABLE "civil_claim_elements" ADD CONSTRAINT "civil_claim_elements_defense_fk" FOREIGN KEY ("defense_id") REFERENCES "civil_defenses"("id") ON DELETE cascade;
ALTER TABLE "civil_claim_elements" ADD CONSTRAINT "civil_claim_elements_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
ALTER TABLE "civil_claim_elements" ADD CONSTRAINT "civil_claim_elements_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");
ALTER TABLE "civil_claim_elements" ADD CONSTRAINT "civil_claim_elements_claim_matter_fk" FOREIGN KEY ("claim_id", "matter_id") REFERENCES "civil_claims"("id", "matter_id") ON DELETE cascade;
ALTER TABLE "civil_claim_elements" ADD CONSTRAINT "civil_claim_elements_defense_matter_fk" FOREIGN KEY ("defense_id", "matter_id") REFERENCES "civil_defenses"("id", "matter_id") ON DELETE cascade;

CREATE TABLE "civil_evidence_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "document_id" uuid,
  "label" text NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "civil_evidence_items_id_matter_uidx" ON "civil_evidence_items" ("id", "matter_id");
CREATE UNIQUE INDEX "civil_evidence_items_id_org_uidx" ON "civil_evidence_items" ("id", "organization_id");
CREATE INDEX "civil_evidence_items_org_matter_idx" ON "civil_evidence_items" ("organization_id", "matter_id");
CREATE INDEX "civil_evidence_items_document_idx" ON "civil_evidence_items" ("document_id");
ALTER TABLE "civil_evidence_items" ADD CONSTRAINT "civil_evidence_items_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "civil_evidence_items" ADD CONSTRAINT "civil_evidence_items_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "civil_evidence_items" ADD CONSTRAINT "civil_evidence_items_document_fk" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE set null;
ALTER TABLE "civil_evidence_items" ADD CONSTRAINT "civil_evidence_items_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
ALTER TABLE "civil_evidence_items" ADD CONSTRAINT "civil_evidence_items_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id");
ALTER TABLE "civil_evidence_items" ADD CONSTRAINT "civil_evidence_items_matter_org_fk" FOREIGN KEY ("matter_id", "organization_id") REFERENCES "matters"("id", "organization_id") ON DELETE cascade;

CREATE TABLE "civil_evidence_relations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "claim_id" uuid,
  "element_id" uuid,
  "defense_id" uuid,
  "evidence_id" uuid,
  "role" text NOT NULL,
  "party_entity_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "note" text,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "civil_evidence_relations_target_xor_chk" CHECK (
    ("claim_id" IS NOT NULL AND "element_id" IS NULL AND "defense_id" IS NULL) OR
    ("claim_id" IS NULL AND "element_id" IS NOT NULL AND "defense_id" IS NULL) OR
    ("claim_id" IS NULL AND "element_id" IS NULL AND "defense_id" IS NOT NULL)
  ),
  CONSTRAINT "civil_evidence_relations_role_chk" CHECK ("role" IN ('SUPPORTS','UNDERMINES','CONTRADICTS','CORROBORATES','RELATED_TO','MISSING_EXPECTED')),
  CONSTRAINT "civil_evidence_relations_missing_chk" CHECK (
    ("role" = 'MISSING_EXPECTED' AND "note" IS NOT NULL) OR
    ("role" <> 'MISSING_EXPECTED' AND "evidence_id" IS NOT NULL)
  )
);
CREATE INDEX "civil_evidence_relations_claim_idx" ON "civil_evidence_relations" ("claim_id");
CREATE INDEX "civil_evidence_relations_element_idx" ON "civil_evidence_relations" ("element_id");
CREATE INDEX "civil_evidence_relations_defense_idx" ON "civil_evidence_relations" ("defense_id");
CREATE INDEX "civil_evidence_relations_evidence_idx" ON "civil_evidence_relations" ("evidence_id");
CREATE INDEX "civil_evidence_relations_org_matter_idx" ON "civil_evidence_relations" ("organization_id", "matter_id");
ALTER TABLE "civil_evidence_relations" ADD CONSTRAINT "civil_evidence_relations_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "civil_evidence_relations" ADD CONSTRAINT "civil_evidence_relations_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "civil_evidence_relations" ADD CONSTRAINT "civil_evidence_relations_claim_fk" FOREIGN KEY ("claim_id") REFERENCES "civil_claims"("id") ON DELETE cascade;
ALTER TABLE "civil_evidence_relations" ADD CONSTRAINT "civil_evidence_relations_element_fk" FOREIGN KEY ("element_id") REFERENCES "civil_claim_elements"("id") ON DELETE cascade;
ALTER TABLE "civil_evidence_relations" ADD CONSTRAINT "civil_evidence_relations_defense_fk" FOREIGN KEY ("defense_id") REFERENCES "civil_defenses"("id") ON DELETE cascade;
ALTER TABLE "civil_evidence_relations" ADD CONSTRAINT "civil_evidence_relations_evidence_fk" FOREIGN KEY ("evidence_id") REFERENCES "civil_evidence_items"("id") ON DELETE cascade;
ALTER TABLE "civil_evidence_relations" ADD CONSTRAINT "civil_evidence_relations_claim_matter_fk" FOREIGN KEY ("claim_id", "matter_id") REFERENCES "civil_claims"("id", "matter_id") ON DELETE cascade;
ALTER TABLE "civil_evidence_relations" ADD CONSTRAINT "civil_evidence_relations_element_matter_fk" FOREIGN KEY ("element_id", "matter_id") REFERENCES "civil_claim_elements"("id", "matter_id") ON DELETE cascade;
ALTER TABLE "civil_evidence_relations" ADD CONSTRAINT "civil_evidence_relations_defense_matter_fk" FOREIGN KEY ("defense_id", "matter_id") REFERENCES "civil_defenses"("id", "matter_id") ON DELETE cascade;
ALTER TABLE "civil_evidence_relations" ADD CONSTRAINT "civil_evidence_relations_evidence_matter_fk" FOREIGN KEY ("evidence_id", "matter_id") REFERENCES "civil_evidence_items"("id", "matter_id") ON DELETE cascade;

CREATE TABLE "civil_fact_relations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "claim_id" uuid,
  "element_id" uuid,
  "defense_id" uuid,
  "fact_id" uuid NOT NULL,
  "role" text NOT NULL,
  "party_entity_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "note" text,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "civil_fact_relations_target_xor_chk" CHECK (
    ("claim_id" IS NOT NULL AND "element_id" IS NULL AND "defense_id" IS NULL) OR
    ("claim_id" IS NULL AND "element_id" IS NOT NULL AND "defense_id" IS NULL) OR
    ("claim_id" IS NULL AND "element_id" IS NULL AND "defense_id" IS NOT NULL)
  ),
  CONSTRAINT "civil_fact_relations_role_chk" CHECK ("role" IN ('SUPPORTS','UNDERMINES','CONTRADICTS','CORROBORATES','RELATED_TO','MISSING_EXPECTED'))
);
CREATE INDEX "civil_fact_relations_claim_idx" ON "civil_fact_relations" ("claim_id");
CREATE INDEX "civil_fact_relations_element_idx" ON "civil_fact_relations" ("element_id");
CREATE INDEX "civil_fact_relations_defense_idx" ON "civil_fact_relations" ("defense_id");
CREATE INDEX "civil_fact_relations_fact_idx" ON "civil_fact_relations" ("fact_id");
CREATE INDEX "civil_fact_relations_org_matter_idx" ON "civil_fact_relations" ("organization_id", "matter_id");
ALTER TABLE "civil_fact_relations" ADD CONSTRAINT "civil_fact_relations_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "civil_fact_relations" ADD CONSTRAINT "civil_fact_relations_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "civil_fact_relations" ADD CONSTRAINT "civil_fact_relations_claim_fk" FOREIGN KEY ("claim_id") REFERENCES "civil_claims"("id") ON DELETE cascade;
ALTER TABLE "civil_fact_relations" ADD CONSTRAINT "civil_fact_relations_element_fk" FOREIGN KEY ("element_id") REFERENCES "civil_claim_elements"("id") ON DELETE cascade;
ALTER TABLE "civil_fact_relations" ADD CONSTRAINT "civil_fact_relations_defense_fk" FOREIGN KEY ("defense_id") REFERENCES "civil_defenses"("id") ON DELETE cascade;
ALTER TABLE "civil_fact_relations" ADD CONSTRAINT "civil_fact_relations_fact_fk" FOREIGN KEY ("fact_id") REFERENCES "matter_facts"("id") ON DELETE cascade;
ALTER TABLE "civil_fact_relations" ADD CONSTRAINT "civil_fact_relations_claim_matter_fk" FOREIGN KEY ("claim_id", "matter_id") REFERENCES "civil_claims"("id", "matter_id") ON DELETE cascade;
ALTER TABLE "civil_fact_relations" ADD CONSTRAINT "civil_fact_relations_element_matter_fk" FOREIGN KEY ("element_id", "matter_id") REFERENCES "civil_claim_elements"("id", "matter_id") ON DELETE cascade;
ALTER TABLE "civil_fact_relations" ADD CONSTRAINT "civil_fact_relations_defense_matter_fk" FOREIGN KEY ("defense_id", "matter_id") REFERENCES "civil_defenses"("id", "matter_id") ON DELETE cascade;
ALTER TABLE "civil_fact_relations" ADD CONSTRAINT "civil_fact_relations_fact_matter_fk" FOREIGN KEY ("fact_id", "matter_id") REFERENCES "matter_facts"("id", "matter_id") ON DELETE cascade;

CREATE TABLE "civil_legal_issue_relations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "claim_id" uuid,
  "element_id" uuid,
  "defense_id" uuid,
  "legal_issue_id" uuid NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "civil_legal_issue_relations_target_xor_chk" CHECK (
    ("claim_id" IS NOT NULL AND "element_id" IS NULL AND "defense_id" IS NULL) OR
    ("claim_id" IS NULL AND "element_id" IS NOT NULL AND "defense_id" IS NULL) OR
    ("claim_id" IS NULL AND "element_id" IS NULL AND "defense_id" IS NOT NULL)
  )
);
CREATE INDEX "civil_legal_issue_relations_claim_idx" ON "civil_legal_issue_relations" ("claim_id");
CREATE INDEX "civil_legal_issue_relations_element_idx" ON "civil_legal_issue_relations" ("element_id");
CREATE INDEX "civil_legal_issue_relations_defense_idx" ON "civil_legal_issue_relations" ("defense_id");
CREATE INDEX "civil_legal_issue_relations_issue_idx" ON "civil_legal_issue_relations" ("legal_issue_id");
CREATE INDEX "civil_legal_issue_relations_org_matter_idx" ON "civil_legal_issue_relations" ("organization_id", "matter_id");
ALTER TABLE "civil_legal_issue_relations" ADD CONSTRAINT "civil_legal_issue_relations_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "civil_legal_issue_relations" ADD CONSTRAINT "civil_legal_issue_relations_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "civil_legal_issue_relations" ADD CONSTRAINT "civil_legal_issue_relations_claim_fk" FOREIGN KEY ("claim_id") REFERENCES "civil_claims"("id") ON DELETE cascade;
ALTER TABLE "civil_legal_issue_relations" ADD CONSTRAINT "civil_legal_issue_relations_element_fk" FOREIGN KEY ("element_id") REFERENCES "civil_claim_elements"("id") ON DELETE cascade;
ALTER TABLE "civil_legal_issue_relations" ADD CONSTRAINT "civil_legal_issue_relations_defense_fk" FOREIGN KEY ("defense_id") REFERENCES "civil_defenses"("id") ON DELETE cascade;
ALTER TABLE "civil_legal_issue_relations" ADD CONSTRAINT "civil_legal_issue_relations_issue_fk" FOREIGN KEY ("legal_issue_id") REFERENCES "legal_issues"("id") ON DELETE cascade;
ALTER TABLE "civil_legal_issue_relations" ADD CONSTRAINT "civil_legal_issue_relations_claim_matter_fk" FOREIGN KEY ("claim_id", "matter_id") REFERENCES "civil_claims"("id", "matter_id") ON DELETE cascade;
ALTER TABLE "civil_legal_issue_relations" ADD CONSTRAINT "civil_legal_issue_relations_element_matter_fk" FOREIGN KEY ("element_id", "matter_id") REFERENCES "civil_claim_elements"("id", "matter_id") ON DELETE cascade;
ALTER TABLE "civil_legal_issue_relations" ADD CONSTRAINT "civil_legal_issue_relations_defense_matter_fk" FOREIGN KEY ("defense_id", "matter_id") REFERENCES "civil_defenses"("id", "matter_id") ON DELETE cascade;

CREATE TABLE "civil_authority_relations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "claim_id" uuid,
  "element_id" uuid,
  "defense_id" uuid,
  "legal_issue_id" uuid,
  "authority_id" uuid NOT NULL,
  "relation" text NOT NULL,
  "proposition" text,
  "source_span" text,
  "source_supported" boolean DEFAULT false NOT NULL,
  "treatment" text DEFAULT 'UNVERIFIED' NOT NULL,
  "currentness" text DEFAULT 'unknown' NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "civil_authority_relations_target_xor_chk" CHECK (
    ("claim_id" IS NOT NULL AND "element_id" IS NULL AND "defense_id" IS NULL AND "legal_issue_id" IS NULL) OR
    ("claim_id" IS NULL AND "element_id" IS NOT NULL AND "defense_id" IS NULL AND "legal_issue_id" IS NULL) OR
    ("claim_id" IS NULL AND "element_id" IS NULL AND "defense_id" IS NOT NULL AND "legal_issue_id" IS NULL) OR
    ("claim_id" IS NULL AND "element_id" IS NULL AND "defense_id" IS NULL AND "legal_issue_id" IS NOT NULL)
  ),
  CONSTRAINT "civil_authority_relations_relation_chk" CHECK ("relation" IN ('BINDING','PERSUASIVE','CONTRARY','DISTINGUISHABLE'))
);
CREATE INDEX "civil_authority_relations_claim_idx" ON "civil_authority_relations" ("claim_id");
CREATE INDEX "civil_authority_relations_element_idx" ON "civil_authority_relations" ("element_id");
CREATE INDEX "civil_authority_relations_defense_idx" ON "civil_authority_relations" ("defense_id");
CREATE INDEX "civil_authority_relations_issue_idx" ON "civil_authority_relations" ("legal_issue_id");
CREATE INDEX "civil_authority_relations_authority_idx" ON "civil_authority_relations" ("authority_id");
CREATE INDEX "civil_authority_relations_org_matter_idx" ON "civil_authority_relations" ("organization_id", "matter_id");
ALTER TABLE "civil_authority_relations" ADD CONSTRAINT "civil_authority_relations_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "civil_authority_relations" ADD CONSTRAINT "civil_authority_relations_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "civil_authority_relations" ADD CONSTRAINT "civil_authority_relations_claim_fk" FOREIGN KEY ("claim_id") REFERENCES "civil_claims"("id") ON DELETE cascade;
ALTER TABLE "civil_authority_relations" ADD CONSTRAINT "civil_authority_relations_element_fk" FOREIGN KEY ("element_id") REFERENCES "civil_claim_elements"("id") ON DELETE cascade;
ALTER TABLE "civil_authority_relations" ADD CONSTRAINT "civil_authority_relations_defense_fk" FOREIGN KEY ("defense_id") REFERENCES "civil_defenses"("id") ON DELETE cascade;
ALTER TABLE "civil_authority_relations" ADD CONSTRAINT "civil_authority_relations_issue_fk" FOREIGN KEY ("legal_issue_id") REFERENCES "legal_issues"("id") ON DELETE cascade;
ALTER TABLE "civil_authority_relations" ADD CONSTRAINT "civil_authority_relations_authority_fk" FOREIGN KEY ("authority_id") REFERENCES "legal_authorities"("id") ON DELETE cascade;
ALTER TABLE "civil_authority_relations" ADD CONSTRAINT "civil_authority_relations_claim_matter_fk" FOREIGN KEY ("claim_id", "matter_id") REFERENCES "civil_claims"("id", "matter_id") ON DELETE cascade;
ALTER TABLE "civil_authority_relations" ADD CONSTRAINT "civil_authority_relations_element_matter_fk" FOREIGN KEY ("element_id", "matter_id") REFERENCES "civil_claim_elements"("id", "matter_id") ON DELETE cascade;
ALTER TABLE "civil_authority_relations" ADD CONSTRAINT "civil_authority_relations_defense_matter_fk" FOREIGN KEY ("defense_id", "matter_id") REFERENCES "civil_defenses"("id", "matter_id") ON DELETE cascade;

CREATE TABLE "civil_standard_relations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "claim_id" uuid,
  "element_id" uuid,
  "defense_id" uuid,
  "standard_id" uuid NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "civil_standard_relations_target_xor_chk" CHECK (
    ("claim_id" IS NOT NULL AND "element_id" IS NULL AND "defense_id" IS NULL) OR
    ("claim_id" IS NULL AND "element_id" IS NOT NULL AND "defense_id" IS NULL) OR
    ("claim_id" IS NULL AND "element_id" IS NULL AND "defense_id" IS NOT NULL)
  )
);
CREATE INDEX "civil_standard_relations_claim_idx" ON "civil_standard_relations" ("claim_id");
CREATE INDEX "civil_standard_relations_element_idx" ON "civil_standard_relations" ("element_id");
CREATE INDEX "civil_standard_relations_defense_idx" ON "civil_standard_relations" ("defense_id");
CREATE INDEX "civil_standard_relations_standard_idx" ON "civil_standard_relations" ("standard_id");
CREATE INDEX "civil_standard_relations_org_matter_idx" ON "civil_standard_relations" ("organization_id", "matter_id");
ALTER TABLE "civil_standard_relations" ADD CONSTRAINT "civil_standard_relations_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
ALTER TABLE "civil_standard_relations" ADD CONSTRAINT "civil_standard_relations_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE cascade;
ALTER TABLE "civil_standard_relations" ADD CONSTRAINT "civil_standard_relations_claim_fk" FOREIGN KEY ("claim_id") REFERENCES "civil_claims"("id") ON DELETE cascade;
ALTER TABLE "civil_standard_relations" ADD CONSTRAINT "civil_standard_relations_element_fk" FOREIGN KEY ("element_id") REFERENCES "civil_claim_elements"("id") ON DELETE cascade;
ALTER TABLE "civil_standard_relations" ADD CONSTRAINT "civil_standard_relations_defense_fk" FOREIGN KEY ("defense_id") REFERENCES "civil_defenses"("id") ON DELETE cascade;
ALTER TABLE "civil_standard_relations" ADD CONSTRAINT "civil_standard_relations_standard_fk" FOREIGN KEY ("standard_id") REFERENCES "legal_standards"("id") ON DELETE cascade;
ALTER TABLE "civil_standard_relations" ADD CONSTRAINT "civil_standard_relations_claim_matter_fk" FOREIGN KEY ("claim_id", "matter_id") REFERENCES "civil_claims"("id", "matter_id") ON DELETE cascade;
ALTER TABLE "civil_standard_relations" ADD CONSTRAINT "civil_standard_relations_element_matter_fk" FOREIGN KEY ("element_id", "matter_id") REFERENCES "civil_claim_elements"("id", "matter_id") ON DELETE cascade;
ALTER TABLE "civil_standard_relations" ADD CONSTRAINT "civil_standard_relations_defense_matter_fk" FOREIGN KEY ("defense_id", "matter_id") REFERENCES "civil_defenses"("id", "matter_id") ON DELETE cascade;
