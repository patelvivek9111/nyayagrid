-- Rollback for 0024_citation_target_classification.
-- Drops additive classification column only. Does not touch raw citation text,
-- to_authority_id, or other resolution state.

ALTER TABLE "legal_authority_citations"
  DROP CONSTRAINT IF EXISTS "legal_authority_citations_classification_chk";

ALTER TABLE "legal_authority_citations"
  DROP COLUMN IF EXISTS "citation_target_classification";
