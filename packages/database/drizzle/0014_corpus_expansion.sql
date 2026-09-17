-- Corpus expansion: conservative currentness + last-checked provenance.
-- Does not claim Shepard's/KeyCite-level treatment.

DO $$ BEGIN
  CREATE TYPE "public"."authority_currentness_status" AS ENUM(
    'unknown',
    'current_as_of_source_date',
    'current_verified_from_source',
    'historical',
    'superseded'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "legal_authorities"
  ADD COLUMN IF NOT EXISTS "currentness_status" "authority_currentness_status" DEFAULT 'unknown' NOT NULL;

ALTER TABLE "legal_authorities"
  ADD COLUMN IF NOT EXISTS "last_checked_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "legal_authorities_currentness_idx"
  ON "legal_authorities" ("currentness_status");
