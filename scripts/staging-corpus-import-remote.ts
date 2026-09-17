/**
 * Staging corpus importer — runs on Fly machine.
 * Fetches curated bundles from a pinned GitHub commit (no local filesystem corpus).
 * Never prints DATABASE_URL / API keys.
 */
import { createDb, sql } from "@nyayagrid/database";
import { createEmbeddingProviderFromEnv } from "@nyayagrid/ai";
import {
  batchImportCorpusAuthorities,
  redactDatabaseUrl,
  type CorpusBundleAuthority,
} from "@nyayagrid/research";

const PINNED =
  process.env.CORPUS_GIT_SHA?.trim() ||
  "84f3bef1de66c766ea5da34a6b6185e783231375";
const BASE = `https://raw.githubusercontent.com/patelvivek9111/nyayagrid/${PINNED}/packages/research/corpus/bundles`;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch_failed ${res.status} ${url}`);
  return (await res.json()) as T;
}

async function loadAuthoritiesFromGithub(): Promise<{
  phase: string;
  authorities: CorpusBundleAuthority[];
}> {
  const manifest = await fetchJson<{
    phase: string;
    federalBundles?: Array<{ bundleFile: string }>;
    states: Array<{ code: string; bundleFile: string }>;
  }>(`${BASE}/manifest.json`);
  const files = [
    ...(manifest.federalBundles ?? []).map((b) => b.bundleFile),
    ...manifest.states.map((s) => s.bundleFile),
  ];
  const authorities: CorpusBundleAuthority[] = [];
  for (const file of files) {
    const rows = await fetchJson<CorpusBundleAuthority[]>(`${BASE}/${file}`);
    if (!Array.isArray(rows)) throw new Error(`bundle_not_array ${file}`);
    authorities.push(...rows);
  }
  return { phase: manifest.phase, authorities };
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing" }));
    process.exit(2);
  }
  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.log(JSON.stringify({ ok: false, reason: "OPENAI_API_KEY missing" }));
    process.exit(2);
  }

  const db = createDb(process.env.DATABASE_URL);
  const embeddings = createEmbeddingProviderFromEnv();
  const { phase, authorities } = await loadAuthoritiesFromGithub();

  const before = await db.execute(sql`
    select
      count(*) filter (where source_provider = 'us-primary-corpus')::int as real,
      count(*)::int as total
    from legal_authorities
  `);

  const first = await batchImportCorpusAuthorities({
    db,
    embeddings,
    authorities,
    importedAt: new Date().toISOString(),
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
      count(*) filter (where authority_type = 'rule' and source_provider = 'us-primary-corpus')::int as rules,
      count(distinct authority_state) filter (where source_provider = 'us-primary-corpus')::int as jurisdictions
    from legal_authorities
  `);

  console.log(
    JSON.stringify(
      {
        ok: true,
        pinned: PINNED,
        phase,
        authorityCount: authorities.length,
        database: redactDatabaseUrl(process.env.DATABASE_URL),
        before,
        first: {
          imported: first.imported,
          newVersions: first.newVersions,
          skipped: first.skipped,
          errors: first.errors,
          total: first.total,
        },
        second: {
          imported: second.imported,
          newVersions: second.newVersions,
          skipped: second.skipped,
          errors: second.errors,
          total: second.total,
        },
        after,
        featureAgents: process.env.FEATURE_AGENTS ?? null,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.log(
    JSON.stringify({
      ok: false,
      err: String(e?.stack || e).slice(0, 2500),
    }),
  );
  process.exit(1);
});
