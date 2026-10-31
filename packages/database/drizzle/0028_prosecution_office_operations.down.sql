-- Reverse additive Stage 6 office operations.

DROP TABLE IF EXISTS "prosecution_supervisor_reviews";

DROP INDEX IF EXISTS "prosecution_tasks_due_at_idx";
DROP INDEX IF EXISTS "prosecution_tasks_org_status_idx";
DROP INDEX IF EXISTS "prosecution_tasks_org_owner_idx";

ALTER TABLE "prosecution_tasks"
  DROP CONSTRAINT IF EXISTS "prosecution_tasks_created_by_fk";
ALTER TABLE "prosecution_tasks"
  DROP CONSTRAINT IF EXISTS "prosecution_tasks_owner_fk";

ALTER TABLE "prosecution_tasks"
  DROP COLUMN IF EXISTS "description",
  DROP COLUMN IF EXISTS "owner_user_id",
  DROP COLUMN IF EXISTS "created_by_user_id",
  DROP COLUMN IF EXISTS "priority",
  DROP COLUMN IF EXISTS "due_date_origin",
  DROP COLUMN IF EXISTS "related_evidence_ids",
  DROP COLUMN IF EXISTS "related_witness_ids",
  DROP COLUMN IF EXISTS "related_discovery_ids",
  DROP COLUMN IF EXISTS "related_disclosure_ids",
  DROP COLUMN IF EXISTS "related_motion_ids",
  DROP COLUMN IF EXISTS "related_hearing_ids",
  DROP COLUMN IF EXISTS "related_warrant_ids",
  DROP COLUMN IF EXISTS "related_issue_ids",
  DROP COLUMN IF EXISTS "completed_at",
  DROP COLUMN IF EXISTS "notes";

ALTER TABLE "prosecution_agencies"
  DROP COLUMN IF EXISTS "active";

DROP INDEX IF EXISTS "criminal_cases_org_priority_idx";
DROP INDEX IF EXISTS "criminal_cases_org_prosecutor_idx";
DROP INDEX IF EXISTS "criminal_cases_org_status_idx";

ALTER TABLE "criminal_cases"
  DROP CONSTRAINT IF EXISTS "criminal_cases_last_supervisor_review_by_fk";

ALTER TABLE "criminal_cases"
  DROP COLUMN IF EXISTS "assignment_note",
  DROP COLUMN IF EXISTS "last_supervisor_review_at",
  DROP COLUMN IF EXISTS "last_supervisor_review_by_user_id",
  DROP COLUMN IF EXISTS "closure_reason";
