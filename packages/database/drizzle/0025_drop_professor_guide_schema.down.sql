-- Rollback marker for 0025_drop_professor_guide_schema.
-- Destructive drop cannot safely restore row data. Full schema restoration requires
-- replaying historical migrations 0007_phase8_professor_guide.sql and
-- 0009_professor_hardening.sql against a backup or a database that never applied 0025.
-- This file intentionally does not recreate tables (avoids a false sense of data recovery).

SELECT 1;
