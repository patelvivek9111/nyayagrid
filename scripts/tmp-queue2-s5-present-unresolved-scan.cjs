/**
 * Session 5 — count remaining present-but-unresolved citation defects.
 * ZERO CL. Read-only unless APPLY=1 (then runs same unique exact match update).
 */
"use strict";
const postgres = require("postgres");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "no_db" }));
    process.exit(2);
  }
  const apply = process.env.APPLY === "1" || process.argv[2] === "apply";
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const defects = await sql`
      select e.id, e.normalized_citation, e.raw_citation,
             count(distinct a.id)::int as candidate_count,
             array_agg(distinct a.id::text) as candidate_ids
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
      group by e.id, e.normalized_citation, e.raw_citation
      order by candidate_count desc, e.normalized_citation
      limit 500
    `;
    const unique = defects.filter((d) => d.candidate_count === 1);
    const ambiguous = defects.filter((d) => d.candidate_count > 1);
    let newlyResolved = 0;
    if (apply && unique.length) {
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
      newlyResolved = resolvedRows.length;
    }
    const samples = defects.slice(0, 15).map((d) => ({
      id: d.id,
      citation: d.normalized_citation,
      candidates: d.candidate_count,
    }));
    console.log(
      JSON.stringify({
        ok: true,
        classification: "MANUAL_QUEUE2_S5_PRESENT_UNRESOLVED_SCAN",
        courtListenerHttpCalls: 0,
        mutations: newlyResolved,
        apply,
        presentUnresolvedTotal: defects.length,
        uniqueExactUnresolved: unique.length,
        ambiguousExactUnresolved: ambiguous.length,
        newlyResolved,
        samples,
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 400) }));
  process.exit(1);
});
