-- Reverse additive Stage 4 disclosure deepening. Drops new production table and columns.
-- Does not restore values that lived only in the dropped columns.

DROP TABLE IF EXISTS "prosecution_disclosure_productions";

ALTER TABLE "prosecution_disclosure_candidates"
  DROP CONSTRAINT IF EXISTS "prosecution_disclosure_candidates_flagged_by_fk";

DROP INDEX IF EXISTS "prosecution_disclosure_case_status_idx";

ALTER TABLE "prosecution_disclosure_candidates"
  DROP COLUMN IF EXISTS "reason",
  DROP COLUMN IF EXISTS "origin",
  DROP COLUMN IF EXISTS "related_evidence_ids",
  DROP COLUMN IF EXISTS "related_witness_ids",
  DROP COLUMN IF EXISTS "related_defendant_ids",
  DROP COLUMN IF EXISTS "related_charge_ids",
  DROP COLUMN IF EXISTS "related_element_ids",
  DROP COLUMN IF EXISTS "related_discovery_ids",
  DROP COLUMN IF EXISTS "related_issue_ids",
  DROP COLUMN IF EXISTS "confidence",
  DROP COLUMN IF EXISTS "priority",
  DROP COLUMN IF EXISTS "review_history",
  DROP COLUMN IF EXISTS "production_status",
  DROP COLUMN IF EXISTS "flagged_by_user_id";

ALTER TABLE "prosecution_discovery_items"
  DROP CONSTRAINT IF EXISTS "prosecution_discovery_items_created_by_fk";

ALTER TABLE "prosecution_discovery_items"
  DROP CONSTRAINT IF EXISTS "prosecution_discovery_items_reviewed_by_fk";

DROP INDEX IF EXISTS "prosecution_discovery_case_status_idx";
DROP INDEX IF EXISTS "prosecution_discovery_case_production_idx";

ALTER TABLE "prosecution_discovery_items"
  DROP COLUMN IF EXISTS "title",
  DROP COLUMN IF EXISTS "source_agency",
  DROP COLUMN IF EXISTS "related_witness_ids",
  DROP COLUMN IF EXISTS "related_defendant_ids",
  DROP COLUMN IF EXISTS "related_charge_ids",
  DROP COLUMN IF EXISTS "related_element_ids",
  DROP COLUMN IF EXISTS "privilege_review_status",
  DROP COLUMN IF EXISTS "confidentiality_review_status",
  DROP COLUMN IF EXISTS "priority",
  DROP COLUMN IF EXISTS "created_by_user_id",
  DROP COLUMN IF EXISTS "reviewed_by_user_id";
