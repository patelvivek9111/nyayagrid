-- Drop retired Nyaya Professor (Student Workspace) and Nyaya Guide (Public Workspace) tables.
-- Historical migrations 0007/0009 remain immutable. Active product surfaces already removed.
-- Retains workspace_type enum values student/public for historical usage/audit decode only.
-- Explicit child-to-parent drop order. No FKs from Professional, Prosecution, Research, or
-- authority corpus into these tables (user-scoped phase8 only).
-- Reverse: 0025_drop_professor_guide_schema.down.sql is a no-op marker (no row restoration).

DROP TABLE IF EXISTS "student_messages";--> statement-breakpoint
DROP TABLE IF EXISTS "student_case_chunks";--> statement-breakpoint
DROP TABLE IF EXISTS "student_case_briefs";--> statement-breakpoint
DROP TABLE IF EXISTS "student_case_comparisons";--> statement-breakpoint
DROP TABLE IF EXISTS "student_notes";--> statement-breakpoint
DROP TABLE IF EXISTS "student_saved_items";--> statement-breakpoint
DROP TABLE IF EXISTS "student_conversations";--> statement-breakpoint
DROP TABLE IF EXISTS "student_case_versions";--> statement-breakpoint
DROP TABLE IF EXISTS "student_cases";--> statement-breakpoint
DROP TABLE IF EXISTS "guide_messages";--> statement-breakpoint
DROP TABLE IF EXISTS "guide_document_chunks";--> statement-breakpoint
DROP TABLE IF EXISTS "guide_document_explanations";--> statement-breakpoint
DROP TABLE IF EXISTS "guide_situation_events";--> statement-breakpoint
DROP TABLE IF EXISTS "guide_situation_documents";--> statement-breakpoint
DROP TABLE IF EXISTS "guide_consultation_packets";--> statement-breakpoint
DROP TABLE IF EXISTS "guide_conversations";--> statement-breakpoint
DROP TABLE IF EXISTS "guide_document_versions";--> statement-breakpoint
DROP TABLE IF EXISTS "guide_situations";--> statement-breakpoint
DROP TABLE IF EXISTS "guide_documents";--> statement-breakpoint
DROP TYPE IF EXISTS "student_case_processing_state";--> statement-breakpoint
DROP TYPE IF EXISTS "explanation_level";--> statement-breakpoint
DROP TYPE IF EXISTS "guide_document_processing_state";--> statement-breakpoint
DROP TYPE IF EXISTS "guide_provenance_note";
