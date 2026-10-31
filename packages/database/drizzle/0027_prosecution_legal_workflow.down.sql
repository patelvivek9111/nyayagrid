-- Reverse additive Stage 5 legal workflow deepening.

DROP TABLE IF EXISTS "prosecution_case_drafts";
DROP TABLE IF EXISTS "prosecution_case_authorities";

ALTER TABLE "prosecution_plea_offers"
  DROP CONSTRAINT IF EXISTS "prosecution_plea_offers_parent_fk";

ALTER TABLE "prosecution_plea_offers"
  DROP COLUMN IF EXISTS "related_charge_ids",
  DROP COLUMN IF EXISTS "conditions",
  DROP COLUMN IF EXISTS "defense_response",
  DROP COLUMN IF EXISTS "prosecutor_notes",
  DROP COLUMN IF EXISTS "supervisor_review_status",
  DROP COLUMN IF EXISTS "document_ids",
  DROP COLUMN IF EXISTS "version_label",
  DROP COLUMN IF EXISTS "parent_offer_id",
  DROP COLUMN IF EXISTS "sentencing_recommendation_reference";

DROP INDEX IF EXISTS "prosecution_subpoenas_case_status_idx";

ALTER TABLE "prosecution_subpoenas"
  DROP COLUMN IF EXISTS "recipient_type",
  DROP COLUMN IF EXISTS "prepared_date",
  DROP COLUMN IF EXISTS "issuing_authority",
  DROP COLUMN IF EXISTS "related_defendant_ids",
  DROP COLUMN IF EXISTS "related_witness_ids",
  DROP COLUMN IF EXISTS "related_evidence_ids",
  DROP COLUMN IF EXISTS "related_discovery_ids",
  DROP COLUMN IF EXISTS "return_status",
  DROP COLUMN IF EXISTS "return_notes",
  DROP COLUMN IF EXISTS "return_received_date",
  DROP COLUMN IF EXISTS "return_document_ids",
  DROP COLUMN IF EXISTS "notes";

ALTER TABLE "prosecution_hearings"
  DROP COLUMN IF EXISTS "related_motion_ids",
  DROP COLUMN IF EXISTS "related_defendant_ids",
  DROP COLUMN IF EXISTS "related_draft_ids",
  DROP COLUMN IF EXISTS "courtroom",
  DROP COLUMN IF EXISTS "notes";

ALTER TABLE "prosecution_motions"
  DROP CONSTRAINT IF EXISTS "prosecution_motions_assigned_attorney_fk";

DROP INDEX IF EXISTS "prosecution_motions_case_status_idx";

ALTER TABLE "prosecution_motions"
  DROP COLUMN IF EXISTS "response_due_date",
  DROP COLUMN IF EXISTS "hearing_date",
  DROP COLUMN IF EXISTS "ruling_date",
  DROP COLUMN IF EXISTS "related_evidence_ids",
  DROP COLUMN IF EXISTS "related_defendant_ids",
  DROP COLUMN IF EXISTS "related_document_ids",
  DROP COLUMN IF EXISTS "related_draft_ids",
  DROP COLUMN IF EXISTS "assigned_attorney_user_id",
  DROP COLUMN IF EXISTS "notes";

DROP INDEX IF EXISTS "prosecution_warrants_case_status_idx";

ALTER TABLE "prosecution_warrants"
  DROP COLUMN IF EXISTS "target_location",
  DROP COLUMN IF EXISTS "target_person",
  DROP COLUMN IF EXISTS "target_device",
  DROP COLUMN IF EXISTS "target_property",
  DROP COLUMN IF EXISTS "related_defendant_ids",
  DROP COLUMN IF EXISTS "related_officer_ids",
  DROP COLUMN IF EXISTS "related_document_ids",
  DROP COLUMN IF EXISTS "status",
  DROP COLUMN IF EXISTS "notes";

DROP INDEX IF EXISTS "prosecution_procedure_issues_case_status_idx";

ALTER TABLE "prosecution_procedure_issues"
  DROP COLUMN IF EXISTS "description",
  DROP COLUMN IF EXISTS "related_warrant_ids",
  DROP COLUMN IF EXISTS "related_defendant_ids",
  DROP COLUMN IF EXISTS "related_officer_ids",
  DROP COLUMN IF EXISTS "related_witness_ids",
  DROP COLUMN IF EXISTS "related_timeline_event_ids",
  DROP COLUMN IF EXISTS "supporting_facts",
  DROP COLUMN IF EXISTS "contrary_facts",
  DROP COLUMN IF EXISTS "human_review_status",
  DROP COLUMN IF EXISTS "human_conclusion",
  DROP COLUMN IF EXISTS "notes";
