#!/usr/bin/env node
/**
 * End-of-pass census for Pass 1 resume. Read-only. Zero CL.
 */
"use strict";
const postgres = require("postgres");

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing" }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 10, connect_timeout: 30 });
  try {
    await sql.unsafe("BEGIN READ ONLY");
    const [cases] = await sql`select count(*)::int as n from legal_authorities where authority_type='case'`;
    const [auth] = await sql`select count(*)::int as n from legal_authorities`;
    const [cite] = await sql`
      select count(*)::int as extracted,
             count(*) filter (where to_authority_id is not null)::int as resolved,
             count(*) filter (where to_authority_id is null)::int as unresolved
      from legal_authority_citations
    `;
    const [health] = await sql`
      select
        (select count(*)::int from (
          select 1 from legal_authorities where source_external_id is not null
          group by source_provider, source_external_id having count(*) > 1
        ) d) as duplicate_source_ids,
        (select count(*)::int from legal_authority_chunks c
          left join legal_authorities a on a.id = c.authority_id where a.id is null) as orphan_chunks,
        (select count(*)::int from legal_authority_chunks where embedding is null) as missing_embeddings
    `;
    const acquired = await sql`
      select id, citation, normalized_citation, court_id, court_level, authority_state, title, decision_date, source_external_id
      from legal_authorities
      where citation in (
        '407 U.S. 67','466 U.S. 648','347 U.S. 62','379 U.S. 89','361 U.S. 98',
        '597 F.3d 140','769 F.3d 163','821 F.3d 467','777 F.3d 635','115 F.4th 197',
        '75 A.3d 485','12 F.4th 366','142 F.3d 582','439 A.2d 1149'
      )
      order by citation
    `;
    const forum = await sql`
      select court_id,
             count(*)::int as total,
             count(*) filter (
               where title ~* 'warrant|probable cause|search|seizure|suppression|fourth'
                 or citation is not null
             )::int as titled
      from legal_authorities
      where authority_type='case'
        and court_id in ('us-ca-3','us-d-paed','st-pa-high','st-pa-super')
      group by court_id
      order by court_id
    `;
    const unknownCourt = await sql`
      select id, citation, title, court, court_id
      from legal_authorities
      where id in (
        '948dd929-722a-467a-916a-3ba42f564d6b',
        'd087462b-2254-41e6-9d14-addae0452c9c',
        '33068440-94da-422d-bfc8-8ff5bfece006'
      )
    `;
    await sql.unsafe("COMMIT");
    console.log(
      JSON.stringify({
        ok: true,
        classification: "PASS1_END_CENSUS",
        courtListenerHttpCalls: 0,
        live: {
          cases: cases.n,
          authorities: auth.n,
          extracted: cite.extracted,
          resolved: cite.resolved,
          unresolved: cite.unresolved,
          duplicateSourceIds: health.duplicate_source_ids,
          orphanChunks: health.orphan_chunks,
          missingEmbeddings: health.missing_embeddings,
        },
        acquiredThisResume: acquired,
        forumCounts: forum,
        pendingCourtRepair: unknownCourt,
      }),
    );
  } catch (e) {
    console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 500) }));
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main();
