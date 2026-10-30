-- Drop retired Nyaya Professor (Student Workspace) and Nyaya Guide (Public Workspace) tables.
-- Historical migrations 0007/0009 remain immutable. Active product surfaces already removed.
-- Retains workspace_type enum values student/public for historical usage/audit decode only.
-- Explicit child→parent drop order. No FKs from Professional, Prosecution, Research, or
-- authority corpus into these tables (user-scoped phase8 only).
-- Reverse: 0025_drop_professor_guide_schema.down.sql recreates empty shells; does not restore data.

-- Professor / student children first
DROP TABLE IF EXISTS "student_messages";
DROP TABLE IF EXISTS "student_case_chunks";
DROP TABLE IF EXISTS "student_case_briefs";
DROP TABLE IF EXISTS "student_case_comparisons";
DROP TABLE IF EXISTS "student_notes";
DROP TABLE IF EXISTS "student_saved_items";
DROP TABLE IF EXISTS "student_conversations";
DROP TABLE IF EXISTS "student_case_versions";
DROP TABLE IF EXISTS "student_cases";

-- Guide children first
DROP TABLE IF EXISTS "guide_messages";
DROP TABLE IF EXISTS "guide_document_chunks";
DROP TABLE IF EXISTS "guide_document_explanations";
DROP TABLE IF EXISTS "guide_situation_events";
DROP TABLE IF EXISTS "guide_situation_documents";
DROP TABLE IF EXISTS "guide_consultation_packets";
DROP TABLE IF EXISTS "guide_conversations";
DROP TABLE IF EXISTS "guide_document_versions";
DROP TABLE IF EXISTS "guide_situations";
DROP TABLE IF EXISTS "guide_documents";

-- Enums only used by retired tables
DROP TYPE IF EXISTS "student_case_processing_state";
DROP TYPE IF EXISTS "explanation_level";
DROP TYPE IF EXISTS "guide_document_processing_state";
DROP TYPE IF EXISTS "guide_provenance_note";
