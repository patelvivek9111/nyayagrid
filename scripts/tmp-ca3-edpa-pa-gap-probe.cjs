#!/usr/bin/env node
/** Read-only gap probe: CA3/EDPA/PA authorities + high-demand absent targets. Zero CL. */
"use strict";
const postgres = require("postgres");

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 30, connect_timeout: 60 });
  try {
    await sql.unsafe("BEGIN READ ONLY");
    const byCourt = await sql`
      select
        case
          when court_id = 'us-ca-3' or court ilike '%third circuit%' then 'CA3'
          when court_id in ('us-d-paed','paed') or court ilike '%eastern%pennsylvania%' then 'EDPA'
          when court_id = 'st-pa' or court ilike '%pennsylvania supreme%' or court ilike '%supreme court of pennsylvania%' then 'PA_SUPREME'
          when court ilike '%pennsylvania superior%' or court_id like 'st-pa-super%' then 'PA_SUPERIOR'
          when court ilike '%pennsylvania commonwealth%' or court_id like 'st-pa-comm%' then 'PA_COMMONWEALTH'
          when court_id like 'st-pa%' or court ilike '%pennsylvania%' then 'PA_OTHER'
          when court_id = 'us-scotus' or court ilike '%supreme court of the united states%' then 'SCOTUS'
          when court_id like 'us-ca-%' or court_id like 'us-d-%' then 'OTHER_FEDERAL'
          else 'OTHER'
        end as bucket,
        count(*)::int as n,
        count(*) filter (where ingestion_status='ready' and exists (
          select 1 from legal_authority_chunks c where c.authority_id=legal_authorities.id and c.embedding is not null
        ))::int as corpus_complete,
        count(*) filter (where
          ingestion_status is distinct from 'ready'
          or not exists (select 1 from legal_authority_chunks c where c.authority_id=legal_authorities.id and c.embedding is not null)
        )::int as metadata_only,
        count(*) filter (where source_external_id like 'cl-cluster-%')::int as has_cl_cluster
      from legal_authorities
      where authority_type='case'
      group by 1
      order by n desc
    `;

    const moNonScotus = await sql`
      select citation, title, court, court_id, source_external_id, ingestion_status,
        (select count(*)::int from legal_authority_citations e where e.to_authority_id=a.id) as inbound
      from legal_authorities a
      where authority_type='case'
        and source_external_id like 'cl-cluster-%'
        and (
          ingestion_status is distinct from 'ready'
          or not exists (select 1 from legal_authority_chunks c where c.authority_id=a.id and c.embedding is not null)
        )
        and not (
          court_id = 'us-scotus'
          or court ilike '%supreme court of the united states%'
          or citation ~* '^[0-9]+\\s+U\\.?\\s*S\\.?'
          or citation ~* 'S\\.?\\s*Ct'
        )
      order by inbound desc nulls last
      limit 40
    `;

    // Unresolved outbound citations that look like CA3/EDPA/PA reporters, high demand
    const absent = await sql`
      with u as (
        select
          coalesce(nullif(normalized_citation,''), raw_citation) as cite,
          count(*)::int as edges,
          count(distinct from_authority_id)::int as unique_citers
        from legal_authority_citations
        where to_authority_id is null
        group by 1
      )
      select cite, edges, unique_citers
      from u
      where edges >= 3
        and (
          cite ~* 'F\\.\\s*(2d|3d|4th)'
          or cite ~* 'F\\.\\s*Supp'
          or cite ~* 'A\\.\\s*(2d|3d)'
          or cite ~* '\\bPa\\b'
        )
        and cite !~* 'U\\.?\\s*S\\.'
        and cite !~* 'S\\.?\\s*Ct'
      order by edges desc, unique_citers desc
      limit 40
    `;

    // How many of those already have a local authority match?
    const sample = await sql`
      select a.citation, a.court, a.court_id, a.ingestion_status,
        exists(select 1 from legal_authority_chunks c where c.authority_id=a.id and c.embedding is not null) as embedded
      from legal_authorities a
      where a.authority_type='case'
        and (
          a.court_id = 'us-ca-3' or a.court ilike '%third circuit%'
          or a.court_id in ('us-d-paed','paed') or a.court ilike '%eastern%pennsylvania%'
          or a.court_id like 'st-pa%' or a.court ilike '%pennsylvania%'
        )
      order by a.updated_at desc nulls last
      limit 20
    `;

    await sql.unsafe("COMMIT");
    console.log(JSON.stringify({ byCourt, moNonScotusCount: moNonScotus.length, moNonScotus, absentHighDemand: absent, recentPaCa3Edpa: sample }, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
