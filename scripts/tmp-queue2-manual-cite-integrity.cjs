/**
 * Deterministic citation re-resolution + Queue #2 integrity counts.
 * No CourtListener HTTP. No AI.
 */
"use strict";
const postgres = require("postgres");

async function citationCounts(sql) {
  const [row] = await sql`
    select
      count(*)::int as extracted,
      count(*) filter (where to_authority_id is not null)::int as resolved,
      count(*) filter (where to_authority_id is null)::int as target_absent,
      count(*) filter (where to_authority_id is null and (normalized_citation is null or btrim(normalized_citation)=''))::int as parser_gap
    from legal_authority_citations
  `;
  return row;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const before = await citationCounts(sql);
    const resolvedRows = await sql`
      with candidates as (
        select e.id as edge_id, a.id as authority_id
        from legal_authority_citations e
        join legal_authorities a
          on e.to_authority_id is null
         and e.normalized_citation is not null
         and length(e.normalized_citation) > 4
         and (
           a.normalized_citation = e.normalized_citation
           or a.citation = e.normalized_citation
           or a.citation = e.raw_citation
         )
      ),
      unique_matches as (
        select edge_id, min(authority_id::text)::uuid as authority_id
        from candidates
        group by edge_id
        having count(distinct authority_id) = 1
      )
      update legal_authority_citations e
      set to_authority_id = u.authority_id
      from unique_matches u
      where e.id = u.edge_id
      returning e.id
    `;
    const after = await citationCounts(sql);
    const [chunks] = await sql`
      select
        count(*)::int as chunks,
        count(*) filter (where embedding is not null)::int as embeddings,
        count(*) filter (where embedding is null)::int as missing_embeddings
      from legal_authority_chunks
    `;
    const [orphans] = await sql`
      select count(*)::int as n from legal_authority_chunks c
      left join legal_authorities a on a.id = c.authority_id where a.id is null
    `;
    const [dups] = await sql`
      select count(*)::int as n from (
        select source_provider, source_external_id from legal_authorities
        where source_external_id is not null
        group by 1, 2 having count(*) > 1
      ) d
    `;
    const [corpus] = await sql`
      select count(*)::int as authorities,
             count(*) filter (where authority_type='case')::int as cases,
             count(*) filter (where authority_type='case' and source_provider='courtlistener')::int as cl_cases,
             count(*) filter (where authority_type='statute')::int as statutes,
             count(*) filter (where authority_type='regulation')::int as regulations,
             count(*) filter (where authority_type='rule')::int as rules
      from legal_authorities
    `;
    const jur = await sql`
      select authority_state as j, count(*) filter (where authority_type='case')::int as cases
      from legal_authorities
      where authority_state in ('AR','WI')
      group by 1
    `;
    console.log(JSON.stringify({
      ok: true,
      courtListenerHttpCalls: 0,
      aiCalls: 0,
      featureAgents: process.env.FEATURE_AGENTS || "0",
      resolvedBefore: before.resolved,
      extracted: after.extracted,
      resolvedAfter: after.resolved,
      newResolved: resolvedRows.length,
      targetAbsent: after.target_absent,
      parserGap: after.parser_gap,
      targetAbsentBefore: before.target_absent,
      parserGapBefore: before.parser_gap,
      chunks,
      orphans: orphans.n,
      duplicateSourceIds: dups.n,
      corpus,
      jurisdictions: jur,
    }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 400), courtListenerHttpCalls: 0 }));
  process.exit(1);
});
