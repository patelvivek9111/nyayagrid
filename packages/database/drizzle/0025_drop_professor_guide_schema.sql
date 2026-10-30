-- Drop retired Nyaya Professor / Nyaya Guide schema (forward-only).
-- Historical migrations 0007/0009 remain immutable.
-- workspace_type student/public retained for historical usage decode.
-- Drop order respects FKs (student_notes -> student_case_briefs; children before parents).

DROP TABLE IF EXISTS "student_messages";--> statement-breakpoint
DROP TABLE IF EXISTS "student_notes";--> statement-breakpoint
DROP TABLE IF EXISTS "student_case_chunks";--> statement-breakpoint
DROP TABLE IF EXISTS "student_case_briefs";--> statement-breakpoint
DROP TABLE IF EXISTS "student_case_comparisons";--> statement-breakpoint
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
