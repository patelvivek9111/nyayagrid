-- WP-05: convert product→corpus hard FKs to soft references.
-- Required before physical product/corpus database separation.
-- Columns are retained; referential integrity to licensed corpus is application-enforced
-- across DATABASE_URL / CORPUS_DATABASE_URL boundaries.
-- Do NOT apply to the shared corpus-bearing database without an explicit isolation cutover plan.

ALTER TABLE "matter_authorities" DROP CONSTRAINT IF EXISTS "matter_authorities_authority_fk";
--> statement-breakpoint
ALTER TABLE "research_notes" DROP CONSTRAINT IF EXISTS "research_notes_authority_fk";
--> statement-breakpoint
ALTER TABLE "research_notes" DROP CONSTRAINT IF EXISTS "research_notes_authority_chunk_fk";
--> statement-breakpoint
ALTER TABLE "research_results" DROP CONSTRAINT IF EXISTS "research_results_authority_fk";
--> statement-breakpoint
ALTER TABLE "research_results" DROP CONSTRAINT IF EXISTS "research_results_chunk_fk";
--> statement-breakpoint
ALTER TABLE "research_results" DROP CONSTRAINT IF EXISTS "research_results_authority_version_fk";
