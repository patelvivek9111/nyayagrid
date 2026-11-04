-- Reverse soft-ref only when legal_* corpus tables exist in the same database.
ALTER TABLE "matter_authorities"
  ADD CONSTRAINT "matter_authorities_authority_fk"
  FOREIGN KEY ("authority_id") REFERENCES "public"."legal_authorities"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "research_notes"
  ADD CONSTRAINT "research_notes_authority_fk"
  FOREIGN KEY ("authority_id") REFERENCES "public"."legal_authorities"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "research_notes"
  ADD CONSTRAINT "research_notes_authority_chunk_fk"
  FOREIGN KEY ("authority_chunk_id") REFERENCES "public"."legal_authority_chunks"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "research_results"
  ADD CONSTRAINT "research_results_authority_fk"
  FOREIGN KEY ("authority_id") REFERENCES "public"."legal_authorities"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "research_results"
  ADD CONSTRAINT "research_results_chunk_fk"
  FOREIGN KEY ("chunk_id") REFERENCES "public"."legal_authority_chunks"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "research_results"
  ADD CONSTRAINT "research_results_authority_version_fk"
  FOREIGN KEY ("authority_version_id") REFERENCES "public"."legal_authority_versions"("id")
  ON DELETE cascade ON UPDATE no action;
