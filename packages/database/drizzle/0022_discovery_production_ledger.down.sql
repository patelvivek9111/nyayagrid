-- Rollback for 0022_discovery_production_ledger.
-- Drops additive discovery tables in dependency order.
--
-- Graph enum rollback limitation:
-- PostgreSQL cannot safely DROP enum values once added without recreating the type
-- and rewriting dependent columns. Discovery graph_node_type values
-- (discovery_request_set, discovery_request_item, discovery_response,
-- discovery_production, discovery_deficiency, privilege_assertion) are intentionally
-- retained after table rollback.
--
-- If enum rollback is required before any graph_nodes rows use those values:
-- 1. confirm zero graph_nodes rows use the discovery node types
-- 2. perform a coordinated enum recreate outside this additive migration path
--
-- Do not drop/recreate graph_nodes or other dependent objects as part of this schema pass.

DROP TABLE IF EXISTS "discovery_privilege_assertions";
DROP TABLE IF EXISTS "discovery_meet_and_confer_deficiency_links";
DROP TABLE IF EXISTS "discovery_deficiencies";
DROP TABLE IF EXISTS "discovery_meet_and_confer_issues";
DROP TABLE IF EXISTS "discovery_response_productions";
DROP TABLE IF EXISTS "discovery_production_custodians";
DROP TABLE IF EXISTS "discovery_bates_ranges";
DROP TABLE IF EXISTS "discovery_production_items";
DROP TABLE IF EXISTS "discovery_productions";
DROP TABLE IF EXISTS "discovery_objections";
DROP TABLE IF EXISTS "discovery_responses";
DROP TABLE IF EXISTS "discovery_request_items";
DROP TABLE IF EXISTS "discovery_request_sets";

-- Supporting indexes created only for this migration may remain if shared with civil.
-- tasks_id_matter_uidx was added here; safe to drop if unused by other FKs after rollback.
DROP INDEX IF EXISTS "tasks_id_matter_uidx";
