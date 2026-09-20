/**
 * Wave 2O cooldown prep — DB-only audits. ZERO CourtListener HTTP.
 * Run on Fly: node scripts/run-wave2f-fly-tool.cjs scripts/staging-wave2o-cooldown-prep-bundled.cjs
 */
"use strict";

const postgres = require("postgres");

const WAVE1_HIGH = [
  { j: "NY", cl: "ny", courtId: "st-ny-high", name: "New York Court of Appeals" },
  { j: "CA", cl: "cal", courtId: "st-ca-high", name: "Supreme Court of California" },
  { j: "PA", cl: "pa", courtId: "st-pa-high", name: "Supreme Court of Pennsylvania" },
  { j: "NJ", cl: "nj", courtId: "st-nj-high", name: "Supreme Court of New Jersey" },
  { j: "FL", cl: "fla", courtId: "st-fl-high", name: "Supreme Court of Florida" },
  { j: "TX", cl: "tex", courtId: "st-tx-high", name: "Supreme Court of Texas" },
  { j: "TX", cl: "texcrimapp", courtId: "st-tx-crim-high", name: "Texas Court of Criminal Appeals" },
  { j: "IL", cl: "ill", courtId: "st-il-high", name: "Supreme Court of Illinois" },
  { j: "MA", cl: "mass", courtId: "st-ma-high", name: "Supreme Judicial Court of Massachusetts" },
  { j: "VA", cl: "va", courtId: "st-va-high", name: "Supreme Court of Virginia" },
  { j: "DE", cl: "del", courtId: "st-de-high", name: "Supreme Court of Delaware" },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const totals = await sql`
      select
        count(*)::int as authorities,
        count(*) filter (where authority_type = 'case')::int as cases,
        count(*) filter (where source_provider = 'courtlistener')::int as cl_cases,
        count(*) filter (where authority_type = 'statute')::int as statutes,
        count(*) filter (where authority_type = 'regulation')::int as regulations,
        count(*) filter (where authority_type = 'rule')::int as rules,
        count(*) filter (
          where citation is not null and btrim(citation) <> ''
            and normalized_citation is not null and btrim(normalized_citation) <> ''
        )::int as with_normalized_citation,
        count(*) filter (
          where citation is not null and btrim(citation) <> ''
            and (normalized_citation is null or btrim(normalized_citation) = '')
        )::int as missing_normalized_citation,
        count(*) filter (
          where court_id is not null or authority_state is not null or court_level is not null
        )::int as metadata_normalized,
        count(*) filter (where canonical_source_url is not null and btrim(canonical_source_url) <> '')::int as with_canonical_url
      from legal_authorities
    `;

    const normGapByProvider = await sql`
      select
        coalesce(source_provider, 'null') as source_provider,
        count(*)::int as n,
        count(*) filter (
          where citation is not null and btrim(citation) <> ''
            and (normalized_citation is null or btrim(normalized_citation) = '')
        )::int as missing_norm_cite,
        count(*) filter (
          where (citation is null or btrim(citation) = '')
            and authority_type = 'case'
        )::int as cases_without_reporter_cite
      from legal_authorities
      group by 1
      order by n desc
    `;

    const clChunks = await sql`
      select
        count(distinct a.id)::int as cl_authorities,
        count(c.id)::int as chunks,
        count(c.id) filter (where c.embedding is not null)::int as with_embedding,
        count(distinct a.id) filter (where c.id is null)::int as authorities_without_chunks
      from legal_authorities a
      left join legal_authority_chunks c on c.authority_id = a.id
      where a.source_provider = 'courtlistener'
    `;

    const orphanChunks = await sql`
      select count(*)::int as orphan_chunks
      from legal_authority_chunks c
      left join legal_authorities a on a.id = c.authority_id
      where a.id is null
    `;

    const embDim = await sql`
      select
        count(*)::int as sampled,
        avg(array_length(string_to_array(trim(both '[]' from c.embedding::text), ','), 1))::int as avg_dims
      from legal_authority_chunks c
      join legal_authorities a on a.id = c.authority_id
      where a.source_provider = 'courtlistener'
        and c.embedding is not null
      limit 1
    `;
    // postgres vector casting may not work as string_to_array — fallback sample
    let embeddingDims = null;
    try {
      const sample = await sql`
        select embedding::text as emb
        from legal_authority_chunks c
        join legal_authorities a on a.id = c.authority_id
        where a.source_provider = 'courtlistener' and c.embedding is not null
        limit 1
      `;
      if (sample[0]?.emb) {
        const raw = String(sample[0].emb).replace(/^\[|\]$/g, "");
        embeddingDims = raw.split(",").filter((x) => x.trim()).length;
      }
    } catch {
      embeddingDims = null;
    }

    const duplicateCl = await sql`
      select source_external_id, count(*)::int as n
      from legal_authorities
      where source_provider = 'courtlistener' and source_external_id is not null
      group by source_external_id
      having count(*) > 1
      limit 20
    `;

    const wave1Counts = await sql`
      select court_id, court_level, authority_state, count(*)::int as n
      from legal_authorities
      where source_provider = 'courtlistener'
        and court_id like 'st-%'
      group by 1, 2, 3
      order by n desc
    `;

    const jobs = await sql`
      select cl_court, court_id, status, cursor, next_page_url,
             items_imported, items_skipped, target_max, updated_at
      from corpus_ingest_jobs
      where source = 'courtlistener'
      order by updated_at desc nulls last
    `;

    const perJur = await sql`
      select
        coalesce(nullif(btrim(authority_state), ''), 'US') as j,
        count(*)::int as authorities,
        count(*) filter (where authority_type = 'case')::int as cases,
        count(*) filter (where authority_type = 'case' and court_level in ('state_high','scotus'))::int as high_court_cases,
        count(*) filter (where authority_type = 'case' and court_level in ('state_appellate','circuit'))::int as intermediate_appellate_cases,
        count(*) filter (where authority_type = 'statute')::int as statutes,
        count(*) filter (where authority_type = 'regulation')::int as regulations,
        count(*) filter (where authority_type = 'rule')::int as rules,
        round(100.0 * count(*) filter (
          where canonical_source_url is not null and btrim(canonical_source_url) <> ''
        ) / greatest(count(*), 1), 1)::float as canonical_pct,
        round(100.0 * count(*) filter (
          where court_id is not null or authority_state is not null or court_level is not null
        ) / greatest(count(*), 1), 1)::float as normalized_pct,
        round(100.0 * count(*) filter (
          where currentness_status is not null
        ) / greatest(count(*), 1), 1)::float as currentness_pct
      from legal_authorities
      group by 1
      order by 1
    `;

    const cites = await sql`
      select
        count(*)::int as extracted,
        count(*) filter (where to_authority_id is not null)::int as resolved,
        count(*) filter (where to_authority_id is null)::int as unresolved
      from legal_authority_citations
    `;

    const currentness = await sql`
      select
        count(*) filter (where currentness_status::text = 'historical')::int as historical,
        count(*) filter (where currentness_status::text = 'current_as_of_source_date')::int as current_as_of_source_date,
        count(*) filter (
          where currentness_status is null or currentness_status::text = 'unknown'
        )::int as unknown,
        count(*) filter (where last_checked_at is not null)::int as last_checked
      from legal_authorities
    `;

    console.log(
      JSON.stringify(
        {
          ok: true,
          wave: "2O-cooldown-prep",
          courtListenerHttpCalls: 0,
          featureAgents: process.env.FEATURE_AGENTS ?? null,
          totals: totals[0],
          normGapByProvider,
          clChunks: { ...clChunks[0], embeddingDims, embDimProbe: embDim[0] },
          orphanChunks: orphanChunks[0]?.orphan_chunks ?? 0,
          duplicateClExternalIds: duplicateCl,
          wave1Counts,
          wave1HighExpected: WAVE1_HIGH,
          jobs,
          perJur,
          citations: cites[0],
          currentness: currentness[0],
        },
        null,
        2,
      ),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e), courtListenerHttpCalls: 0 }));
  process.exit(1);
});
