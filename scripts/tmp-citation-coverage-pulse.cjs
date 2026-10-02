/**
 * Quick post-backfill citation coverage pulse. ZERO CL.
 */
"use strict";
const postgres = require("postgres");
async function main() {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 10, connect_timeout: 30 });
  try {
    const [cites] = await sql`
      select count(*)::int as extracted,
             count(*) filter (where to_authority_id is not null)::int as resolved,
             count(*) filter (where to_authority_id is null)::int as unresolved
      from legal_authority_citations
    `;
    const [cases] = await sql`
      select
        count(*)::int as cases,
        count(*) filter (where has_text and edges > 0)::int as with_edges,
        count(*) filter (where has_text and edges = 0)::int as zero_edges_with_text,
        count(*) filter (where not has_text)::int as no_text,
        count(*) filter (where hist and edges = 0)::int as hist_zero,
        count(*) filter (where hist and edges > 0)::int as hist_with_edges
      from (
        select a.id,
          (exists (select 1 from legal_authority_versions v where v.authority_id=a.id and length(v.content)>=200)) as has_text,
          (exists (select 1 from legal_authority_citations c where c.from_authority_id=a.id)) as edges_bool,
          coalesce((select count(*) from legal_authority_citations c where c.from_authority_id=a.id),0)::int as edges,
          coalesce(a.metadata->>'adapter','') = 's3-hist-ingest' as hist
        from legal_authorities a
        where a.authority_type='case'
      ) x
    `;
    // fix query - edges_bool unused; simplify
    const [integrity] = await sql`
      select
        (select count(*)::int from (
          select from_authority_id, normalized_citation from legal_authority_citations
          group by 1,2 having count(*)>1
        ) d) as duplicate_citation_edges,
        (select count(*)::int from legal_authority_chunks where embedding is null) as missing_embeddings,
        (select count(*)::int from (
          select source_provider, source_external_id from legal_authorities
          where source_external_id is not null group by 1,2 having count(*)>1
        ) d) as duplicate_authorities
    `;
    console.log(JSON.stringify({
      ok: true,
      courtListenerHttpCalls: 0,
      cites: { ...cites, resolutionPct: cites.extracted ? +(100*cites.resolved/cites.extracted).toFixed(2) : 0 },
      cases,
      integrity,
    }));
  } finally {
    await sql.end({ timeout: 3 });
  }
}
main().catch((e) => { console.log(JSON.stringify({ ok:false, error:String(e.message||e) })); process.exit(1); });
