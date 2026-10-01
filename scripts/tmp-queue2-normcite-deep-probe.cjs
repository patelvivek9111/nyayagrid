#!/usr/bin/env node
/**
 * Deep probe: where citation data might live for missing-norm cases.
 * ZERO CL / AI. Read-only.
 */
"use strict";
const postgres = require("postgres");

async function main() {
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    const [citeCol] = await sql`
      select
        count(*) filter (where citation is null)::int as citation_null,
        count(*) filter (where citation is not null and btrim(citation)='')::int as citation_blank,
        count(*) filter (where citation is not null and btrim(citation)<>'')::int as citation_present,
        count(*) filter (where docket_number is not null and btrim(docket_number)<>'')::int as has_docket,
        count(*) filter (where (normalized_citation is null or btrim(normalized_citation)='')
          and docket_number is not null and btrim(docket_number)<>'')::int as missing_norm_with_docket,
        count(*) filter (where (normalized_citation is null or btrim(normalized_citation)='')
          and (citation is null or btrim(citation)='')
          and (docket_number is null or btrim(docket_number)=''))::int as missing_both
      from legal_authorities where authority_type='case'
    `;

    const statusDist = await sql`
      select coalesce(metadata->>'citationStatus','(none)') as citation_status, count(*)::int as n
      from legal_authorities
      where authority_type='case'
        and (normalized_citation is null or btrim(normalized_citation)='')
      group by 1 order by n desc
    `;

    const versionMeta = await sql`
      select
        count(*)::int as versions_for_missing,
        count(*) filter (where v.source_metadata ? 'citation' or v.source_metadata ? 'citations')::int as with_citation_key,
        count(*) filter (where v.source_metadata::text ilike '%U.S.%' or v.source_metadata::text ~* '[0-9]+\\s+F\\.\\s*(2d|3d|4th)\\s+[0-9]+')::int as with_reporterish
      from legal_authority_versions v
      join legal_authorities a on a.id = v.authority_id
      where a.authority_type='case'
        and (a.normalized_citation is null or btrim(a.normalized_citation)='')
    `;

    const sampleStatus = await sql`
      select id::text, title, docket_number, source_external_id,
             metadata->>'citationStatus' as citation_status,
             metadata->>'clusterId' as cluster_id,
             metadata->>'clCourt' as cl_court,
             left(coalesce(metadata::text,''), 400) as meta_snip
      from legal_authorities
      where authority_type='case'
        and (normalized_citation is null or btrim(normalized_citation)='')
        and metadata ? 'citationStatus'
      limit 8
    `;

    const sampleVersion = await sql`
      select a.id::text, a.source_external_id, left(coalesce(v.source_metadata::text,''), 500) as ver_meta,
             jsonb_object_keys(v.source_metadata) as keys
      from legal_authorities a
      join legal_authority_versions v on v.authority_id = a.id
      where a.authority_type='case'
        and (a.normalized_citation is null or btrim(a.normalized_citation)='')
      limit 5
    `;

    // better: aggregate version metadata keys
    const verKeys = await sql`
      select key, count(*)::int as n
      from legal_authorities a
      join legal_authority_versions v on v.authority_id = a.id
      cross join lateral jsonb_object_keys(coalesce(v.source_metadata, '{}'::jsonb)) as key
      where a.authority_type='case'
        and (a.normalized_citation is null or btrim(a.normalized_citation)='')
      group by key
      order by n desc
      limit 30
    `;

    const hasNormSamples = await sql`
      select citation, normalized_citation, source_provider, left(coalesce(metadata::text,''), 200) as meta
      from legal_authorities
      where authority_type='case'
        and normalized_citation is not null and btrim(normalized_citation)<>''
      limit 5
    `;

    // titles that look like they embed citations (do NOT use for mutation; measure only)
    const titleLooksLikeCite = await sql`
      select count(*)::int as n
      from legal_authorities
      where authority_type='case'
        and (normalized_citation is null or btrim(normalized_citation)='')
        and title ~* '[0-9]+\\s+U\\.\\s*S\\.\\s+[0-9]+|[0-9]+\\s+F\\.\\s*(2d|3d|4th)\\s+[0-9]+'
    `;

    console.log(JSON.stringify({
      ok: true,
      courtListenerHttpCalls: 0,
      citeCol,
      statusDist,
      versionMeta: versionMeta[0],
      verKeys,
      sampleStatus,
      sampleVersion,
      hasNormSamples,
      titleLooksLikeCite: titleLooksLikeCite[0],
    }, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch((e) => {
  console.error(JSON.stringify({ ok: false, err: String(e.message || e) }));
  process.exit(1);
});
