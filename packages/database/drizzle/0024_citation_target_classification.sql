-- Citation target classification on legal_authority_citations (Integration-owned).
-- Distinguishes true unresolved case-identity edges from non-case/malformed artifacts.
-- Classification is independent of authority-resolution state (to_authority_id).
-- Default UNKNOWN: do not invent CASE_CITATION for historical rows.
-- Chat B corpus backfill populates deterministic classifications after consuming promoted SHA.
-- Reverse with 0024_citation_target_classification.down.sql.
-- No CourtListener. No Neon corpus mutation from Integration.

ALTER TABLE "legal_authority_citations"
  ADD COLUMN IF NOT EXISTS "citation_target_classification" text NOT NULL DEFAULT 'UNKNOWN';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'legal_authority_citations_classification_chk'
      AND conrelid = 'public.legal_authority_citations'::regclass
  ) THEN
    ALTER TABLE "legal_authority_citations"
      ADD CONSTRAINT "legal_authority_citations_classification_chk"
      CHECK ("citation_target_classification" IN (
        'CASE_CITATION',
        'STATUTE',
        'RULE',
        'REGULATION',
        'BARE_PAGE',
        'PIN_CITE_ONLY',
        'YYYY_PAGE_N',
        'RECORD_REFERENCE',
        'EXHIBIT_REFERENCE',
        'DOCKET_REFERENCE',
        'SECTION_REFERENCE',
        'OCR_MALFORMED',
        'PARSER_MALFORMED',
        'NON_CASE_REPORTER',
        'OTHER_NON_CASE',
        'CASE_LIKE_BUT_MALFORMED',
        'UNKNOWN_ARTIFACT',
        'UNKNOWN'
      ));
  END IF;
END $$;
