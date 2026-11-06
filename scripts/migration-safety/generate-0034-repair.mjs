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
