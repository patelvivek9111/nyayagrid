-- Rollback limitation:
-- PostgreSQL cannot safely DROP an enum value once it exists without recreating the type
-- and rewriting dependent columns. This down file is intentionally a no-op with documentation.
--
-- If rollback is required before any claim/defense rows exist:
-- 1. confirm zero graph_nodes rows use node_type IN ('claim','defense')
-- 2. perform a coordinated enum recreate outside this additive migration path
--
-- Do not drop/recreate graph_nodes or other dependent objects as part of this schema pass.

SELECT 1;
