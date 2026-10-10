-- Rollback for 0023_matter_motions_communications.
-- Drops additive motion/communication tables and discovery FKs.
--
-- Graph enum rollback limitation:
-- PostgreSQL cannot safely DROP enum values 'motion' / 'communication' without
-- recreating the type. Those values are intentionally retained after table rollback.

ALTER TABLE "discovery_meet_and_confer_issues"
  DROP CONSTRAINT IF EXISTS "discovery_meet_and_confer_issues_communication_matter_fk";
ALTER TABLE "discovery_deficiencies"
  DROP CONSTRAINT IF EXISTS "discovery_deficiencies_communication_matter_fk";
ALTER TABLE "discovery_deficiencies"
  DROP CONSTRAINT IF EXISTS "discovery_deficiencies_motion_matter_fk";

DROP TABLE IF EXISTS "matter_communication_links";
DROP TABLE IF EXISTS "matter_communications";
DROP TABLE IF EXISTS "matter_motion_links";
DROP TABLE IF EXISTS "matter_motion_documents";
DROP TABLE IF EXISTS "matter_motions";
