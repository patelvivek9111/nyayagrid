/**
 * Staging corpus import runner — designed to execute ON the Fly machine so
 * DATABASE_URL / OPENAI_API_KEY never leave the machine environment.
 *
 * Built offline with esbuild; uploaded via fly ssh sftp.
 * Expects bundles at /tmp/nyaya-corpus/bundles (manifest.json + json files).
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

async function main() {
  // Dynamic imports after env is confirmed present (keys never logged).
  const hasDb = Boolean(process.env.DATABASE_URL?.trim());
  const hasEmbed = Boolean(process.env.OPENAI_API_KEY?.trim());
  if (!hasDb) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing" }));
    process.exit(2);
  }
  if (!hasEmbed) {
    console.log(JSON.stringify({ ok: false, reason: "OPENAI_API_KEY missing" }));
    process.exit(2);
  }

  const { createDb, sql } = await import("@nyayagrid/database");
  const { createEmbeddingProviderFromEnv } = await import("@nyayagrid/ai");
  const {
    batchImportCorpusAuthorities,
    loadInitialBatchAuthorities,
    redactDatabaseUrl,
  } = await import("@nyayagrid/research");

  // Optionally override corpus root via CORPUS_BUNDLES_DIR (not implemented in loaders yet).
  const db = createDb(process.env.DATABASE_URL!);
  const embeddings = createEmbeddingProviderFromEnv();

  const before = await db.execute(sql`
    select
      count(*) filter (where source_provider = 'us-primary-corpus')::int as real,
      count(*)::int as total
    from legal_authorities
  `);

  const { authorities, manifest } = await loadInitialBatchAuthorities();
  const importedAt = new Date().toISOString();
  const first = await batchImportCorpusAuthorities({
    db,
    embeddings,
    authorities,
    importedAt,
  });
  const second = await batchImportCorpusAuthorities({
    db,
    embeddings,
    authorities,
    importedAt: new Date().toISOString(),
  });

  const after = await db.execute(sql`
    select
      count(*) filter (where source_provider = 'us-primary-corpus')::int as real,
      count(*)::int as total,
      count(*) filter (where authority_type = 'case' and source_provider = 'us-primary-corpus')::int as cases,
      count(*) filter (where authority_type = 'statute' and source_provider = 'us-primary-corpus')::int as statutes,
      count(*) filter (where authority_type = 'regulation' and source_provider = 'us-primary-corpus')::int as regulations,
      count(*) filter (where authority_type = 'rule' and source_provider = 'us-primary-corpus')::int as rules
    from legal_authorities
  `);

  const cols = await db.execute(sql`
    select column_name from information_schema.columns
    where table_name = 'legal_authorities'
      and column_name in ('currentness_status','last_checked_at')
    order by column_name
  `);

  console.log(
    JSON.stringify(
      {
        ok: true,
        database: redactDatabaseUrl(process.env.DATABASE_URL!),
        phase: manifest.phase,
        authorityCount: authorities.length,
        before,
        first: {
          total: first.total,
          imported: first.imported,
          newVersions: first.newVersions,
          skipped: first.skipped,
          errors: first.errors,
        },
        second: {
          total: second.total,
          imported: second.imported,
          newVersions: second.newVersions,
          skipped: second.skipped,
          errors: second.errors,
        },
        after,
        migrationColumns: cols,
        featureAgents: process.env.FEATURE_AGENTS ?? null,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(String(err?.stack || err).slice(0, 2000));
  process.exit(1);
});
