-- Phase 6S: structured Case jurisdiction metadata and authority court identity.
-- Legacy matters.jurisdiction and matters.court remain as free-text display.

ALTER TABLE "matters" ADD COLUMN "jurisdiction_mode" text;
ALTER TABLE "matters" ADD COLUMN "primary_state" text;
ALTER TABLE "matters" ADD COLUMN "forum_type" text;
ALTER TABLE "matters" ADD COLUMN "court_id" text;
ALTER TABLE "matters" ADD COLUMN "court_name" text;
ALTER TABLE "matters" ADD COLUMN "federal_district" text;
ALTER TABLE "matters" ADD COLUMN "federal_circuit" text;
ALTER TABLE "matters" ADD COLUMN "governing_law_state" text;
ALTER TABLE "matters" ADD COLUMN "choice_of_law_status" text;
ALTER TABLE "matters" ADD COLUMN "as_of_date" date;
ALTER TABLE "matters" ADD COLUMN "related_jurisdictions" jsonb DEFAULT '[]'::jsonb;
ALTER TABLE "matters" ADD COLUMN "jurisdiction_source" text;
CREATE INDEX "matters_primary_state_idx" ON "matters" ("primary_state");
CREATE INDEX "matters_court_id_idx" ON "matters" ("court_id");

ALTER TABLE "legal_authorities" ADD COLUMN "court_id" text;
ALTER TABLE "legal_authorities" ADD COLUMN "authority_state" text;
ALTER TABLE "legal_authorities" ADD COLUMN "federal_circuit" text;
ALTER TABLE "legal_authorities" ADD COLUMN "court_level" text;
CREATE INDEX "legal_authorities_court_id_idx" ON "legal_authorities" ("court_id");
CREATE INDEX "legal_authorities_authority_state_idx" ON "legal_authorities" ("authority_state");

CREATE TABLE "jurisdiction_coverage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "state_code" text,
  "forum_type" text DEFAULT 'state' NOT NULL,
  "practice_area" text,
  "status" text DEFAULT 'unvalidated' NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "jurisdiction_coverage_scope_uidx" ON "jurisdiction_coverage" ("state_code", "forum_type", "practice_area");
CREATE INDEX "jurisdiction_coverage_state_idx" ON "jurisdiction_coverage" ("state_code");
