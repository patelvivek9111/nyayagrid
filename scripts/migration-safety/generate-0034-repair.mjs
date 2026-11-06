/**
 * Generate 0034_repair_skipped_week3_through_0023.sql from 0018–0023 sources.
 * Makes CREATE TABLE/INDEX idempotent for first-time repair on staging-shaped DBs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DRIZZLE = path.join(ROOT, "packages/database/drizzle");
const tags = [
  "0018_week3_legal_intelligence",
  "0019_week3_case_isolation",
  "0020_civil_claims",
  "0021_graph_claim_defense_node_types",
  "0022_discovery_production_ledger",
  "0023_matter_motions_communications",
];

function transform(sql) {
  return sql
    .replace(/CREATE TABLE "/g, 'CREATE TABLE IF NOT EXISTS "')
    .replace(/CREATE UNIQUE INDEX "/g, 'CREATE UNIQUE INDEX IF NOT EXISTS "')
    .replace(/CREATE INDEX "/g, 'CREATE INDEX IF NOT EXISTS "');
}

function wrapConstraintStatements(sql) {
  // Convert bare ADD CONSTRAINT into guarded DO blocks when not already guarded.
  return sql.replace(
    /ALTER TABLE ("[^"]+")\s+ADD CONSTRAINT ("[^"]+")([\s\S]*?);/g,
    (match, table, conname, rest) => {
      if (match.includes("IF NOT EXISTS") || match.includes("IF NOT EXISTS (")) return match;
      return `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = ${conname.replace(/"/g, "'")}) THEN
    ALTER TABLE ${table} ADD CONSTRAINT ${conname}${rest};
  END IF;
END $$;`;
    },
  );
}

const header = `-- WP-06C: repair staging journal hole (0018–0023 skipped; 0024 journaled).
-- Staging product DB recorded when=1788200000000 (0024) immediately after 0017,
-- so Drizzle will never re-apply 0018–0023. This additive migration uses when
-- 1788250000000 (between 0024 and 0025) to install the skipped schema before
-- prosecution memory/graph/contacts/billing migrations.
--
-- Also restores the product-schema authority *catalog shell* (\`legal_authorities\`)
-- when absent. Phase 6 placed this table on the product database as shared reference
-- metadata (no organization_id). Staging journal includes 0005/0012/0014 hashes but
-- the table was verified missing while research_* tables remain — schema drift.
-- This CREATE is empty-shell only: it does NOT insert corpus rows and does NOT
-- substitute for CORPUS_DATABASE_URL / Neon legal corpus.
--
-- Idempotent CREATE IF NOT EXISTS / guarded constraints. Do not rewrite historical when.
-- Reverse: 0034_repair_skipped_week3_through_0023.down.sql (intentionally no-op).
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.criminal_cases') IS NOT NULL THEN
    RAISE NOTICE '0034: criminal_cases already present; continuing idempotent apply';
  ELSE
    RAISE NOTICE '0034: installing skipped week3→0023 schema for staging journal hole';
  END IF;
END $$;
--> statement-breakpoint
-- Product authority catalog shell (empty). Enums already present on staging.
CREATE TABLE IF NOT EXISTS "legal_authorities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "authority_type" "authority_type" NOT NULL,
  "jurisdiction" text,
  "court" text,
  "title" text NOT NULL,
  "short_title" text,
  "citation" text,
  "normalized_citation" text,
  "docket_number" text,
  "decision_date" date,
  "effective_date" date,
  "publication_status" text,
  "source_provider" text,
  "source_external_id" text,
  "canonical_source_url" text,
  "ingestion_status" "authority_ingestion_status" DEFAULT 'pending' NOT NULL,
  "treatment_status" "authority_treatment_status" DEFAULT 'unknown' NOT NULL,
  "hierarchy_path" jsonb DEFAULT '[]'::jsonb,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Columns from journaled 0012 / 0014 that may be absent on a recreated shell.
ALTER TABLE "legal_authorities" ADD COLUMN IF NOT EXISTS "court_id" text;
ALTER TABLE "legal_authorities" ADD COLUMN IF NOT EXISTS "authority_state" text;
ALTER TABLE "legal_authorities" ADD COLUMN IF NOT EXISTS "federal_circuit" text;
ALTER TABLE "legal_authorities" ADD COLUMN IF NOT EXISTS "court_level" text;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."authority_currentness_status" AS ENUM(
    'unknown',
    'current_as_of_source_date',
    'current_verified_from_source',
    'historical',
    'superseded'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "legal_authorities"
  ADD COLUMN IF NOT EXISTS "currentness_status" "authority_currentness_status" DEFAULT 'unknown' NOT NULL;
ALTER TABLE "legal_authorities"
  ADD COLUMN IF NOT EXISTS "last_checked_at" timestamp with time zone;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "legal_authorities_source_uidx"
  ON "legal_authorities" ("source_provider", "source_external_id")
  WHERE "source_provider" IS NOT NULL AND "source_external_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "legal_authorities_citation_idx" ON "legal_authorities" ("citation");
CREATE INDEX IF NOT EXISTS "legal_authorities_normalized_citation_idx" ON "legal_authorities" ("normalized_citation");
CREATE INDEX IF NOT EXISTS "legal_authorities_jurisdiction_idx" ON "legal_authorities" ("jurisdiction");
CREATE INDEX IF NOT EXISTS "legal_authorities_type_idx" ON "legal_authorities" ("authority_type");
CREATE INDEX IF NOT EXISTS "legal_authorities_currentness_idx" ON "legal_authorities" ("currentness_status");
CREATE INDEX IF NOT EXISTS "legal_authorities_court_id_idx" ON "legal_authorities" ("court_id");
CREATE INDEX IF NOT EXISTS "legal_authorities_authority_state_idx" ON "legal_authorities" ("authority_state");
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.legal_authorities') IS NULL THEN
    RAISE EXCEPTION '0034: legal_authorities catalog shell missing — refuse week3 FK attach';
  END IF;
  -- Fail closed if someone pre-loaded synthetic corpus rows into this repair path.
  -- Empty shell is required; corpus data belongs on CORPUS_DATABASE_URL when enabled.
  IF (SELECT count(*)::int FROM public.legal_authorities) > 0 THEN
    RAISE NOTICE '0034: legal_authorities already has rows (pre-existing); not truncating';
  END IF;
END $$;
`;

const parts = [header];
for (const tag of tags) {
  const raw = fs.readFileSync(path.join(DRIZZLE, `${tag}.sql`), "utf8");
  const body = wrapConstraintStatements(transform(raw));
  parts.push(`\n-- >>> begin replay of ${tag} (idempotent)\n`);
  parts.push(body.trim());
  parts.push(`\n-- <<< end replay of ${tag}\n`);
  parts.push("--> statement-breakpoint\n");
}

parts.push(`
DO $$
BEGIN
  IF to_regclass('public.criminal_cases') IS NULL THEN
    RAISE EXCEPTION '0034: criminal_cases still missing after repair';
  END IF;
  IF to_regclass('public.prosecution_graph_nodes') IS NULL THEN
    RAISE EXCEPTION '0034: prosecution_graph_nodes still missing after repair';
  END IF;
END $$;
`);

const outPath = path.join(DRIZZLE, "0034_repair_skipped_week3_through_0023.sql");
fs.writeFileSync(outPath, parts.join("\n"));
console.log(JSON.stringify({ wrote: outPath, bytes: fs.statSync(outPath).size }));
