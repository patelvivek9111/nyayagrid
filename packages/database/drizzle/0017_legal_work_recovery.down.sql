-- Manual reverse of 0017_legal_work_recovery.sql.
-- Not applied by `db:migrate`. Use only on environments that have not yet
-- accumulated recovery history that must be preserved, or after a snapshot restore.

DROP TRIGGER IF EXISTS legal_work_checkpoint_items_immutable ON legal_work_checkpoint_items;
DROP TRIGGER IF EXISTS legal_work_checkpoints_immutable ON legal_work_checkpoints;
DROP TRIGGER IF EXISTS legal_work_restorations_immutable ON legal_work_restorations;
DROP TRIGGER IF EXISTS legal_work_actions_immutable ON legal_work_actions;
DROP TRIGGER IF EXISTS legal_work_versions_immutable ON legal_work_versions;
DROP FUNCTION IF EXISTS legal_work_reject_mutation();

DROP TABLE IF EXISTS legal_work_stale_markers;
DROP TABLE IF EXISTS legal_work_restorations;
DROP TABLE IF EXISTS legal_work_checkpoint_items;
DROP TABLE IF EXISTS legal_work_actions;
DROP TABLE IF EXISTS legal_work_heads;
DROP TABLE IF EXISTS legal_work_versions;
DROP TABLE IF EXISTS legal_work_checkpoints;
DROP TABLE IF EXISTS legal_work_sessions;

ALTER TABLE "timeline_events" DROP COLUMN IF EXISTS "retired_at";
