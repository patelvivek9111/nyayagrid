/**
 * Staging Wave 2C: resolve unresolved citation edges against corpus (no CL fetches).
 * Also emit coverage + currentness snapshot.
 */
const postgres = require("postgres");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 20, ssl: "require" });

  const before = await sql`
    select
      count(*)::int as extracted,
      count(*) filter (where to_authority_id is not null)::int as resolved,
      count(*) filter (where to_authority_id is null)::int as unresolved
    from legal_authority_citations
  `;

  const updated = await sql`
    with candidates as (
      select e.id as edge_id, a.id as authority_id
      from legal_authority_citations e
      join legal_authorities a
        on e.to_authority_id is null
       and e.normalized_citation is not null
       and (
         a.normalized_citation = e.normalized_citation
         or a.citation = e.normalized_citation
         or a.normalized_citation = replace(e.normalized_citation, ' CFR ', ' C.F.R. ')
         or a.normalized_citation = replace(e.normalized_citation, ' C.F.R. ', ' CFR ')
         or a.citation = replace(e.normalized_citation, ' C.F.R. ', ' CFR ')
         or a.citation = replace(e.normalized_citation, ' CFR ', ' C.F.R. ')
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

  const after = await sql`
    select
      count(*)::int as extracted,
      count(*) filter (where to_authority_id is not null)::int as resolved,
      count(*) filter (where to_authority_id is null)::int as unresolved
    from legal_authority_citations
  `;

  const ambiguous = await sql`
    with candidates as (
      select e.id as edge_id, count(distinct a.id)::int as n
      from legal_authority_citations e
      join legal_authorities a
        on e.to_authority_id is null
       and e.normalized_citation is not null
       and (
         a.normalized_citation = e.normalized_citation
         or a.citation = e.normalized_citation
       )
      group by e.id
    )
    select count(*)::int as ambiguous from candidates where n > 1
  `;

  const counts = await sql`
    select
      count(*)::int as total,
      count(*) filter (where source_provider = 'us-primary-corpus')::int as curated,
      count(*) filter (where source_provider = 'courtlistener')::int as cl,
      count(*) filter (where authority_type = 'statute')::int as statutes,
      count(*) filter (where authority_type = 'regulation')::int as regulations,
      count(*) filter (where authority_type = 'rule')::int as rules,
      count(*) filter (where authority_type = 'case')::int as cases,
      count(*) filter (where currentness_status = 'current_as_of_source_date')::int as current_as_of,
      count(*) filter (where currentness_status = 'unknown')::int as unknown_currentness,
      count(*) filter (where last_checked_at is not null)::int as last_checked,
      count(*) filter (where normalized_citation is not null and normalized_citation <> '')::int as normalized
    from legal_authorities
  `;

  const versions = await sql`
    select count(*)::int as versions from legal_authority_versions
  `;

  const byState = await sql`
    select authority_state as code,
      count(*) filter (where authority_type = 'statute')::int as statutes,
      count(*)::int as authorities
    from legal_authorities
    where source_provider = 'us-primary-corpus'
    group by authority_state
    order by statutes desc, code
  `;

  console.log(
    JSON.stringify(
      {
        ok: true,
        citationGraph: {
          before: before[0],
          after: after[0],
          newlyResolved: updated.length,
          ambiguous: ambiguous[0]?.ambiguous ?? 0,
        },
        authorities: counts[0],
        versions: versions[0]?.versions ?? 0,
        byState,
      },
      null,
      2,
    ),
  );
  await sql.end({ timeout: 5 });
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e?.message || e) }));
  process.exit(1);
});
