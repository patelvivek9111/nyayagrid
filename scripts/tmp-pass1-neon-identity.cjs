#!/usr/bin/env node
/**
 * Read-only Neon Week 2 corpus identity verification for Pass 1 resume.
 * Zero CourtListener. Zero mutations.
 */
"use strict";
const postgres = require("postgres");

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing" }));
    process.exit(2);
  }
  const hostMatch = /ep-jolly-brook-auhdpay3-pooler/i.test(url);
  const isLocal = /localhost|127\.0\.0\.1|:5433/i.test(url);
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 10, connect_timeout: 30 });
  try {
    await sql.unsafe("BEGIN READ ONLY");
    const [cases] = await sql`
      select count(*)::int as n from legal_authorities where authority_type = 'case'
    `;
    const [auth] = await sql`select count(*)::int as n from legal_authorities`;
    const [federal] = await sql`
      select count(*)::int as n
      from legal_authorities
      where authority_type = 'case'
        and (
          authority_state = 'US'
          or court_id like 'us-%'
          or court_level in ('scotus', 'circuit', 'district')
        )
    `;
    const [tracker] = await sql`
      select
        count(*) filter (
          where authority_type = 'case'
            and authority_state is not null
            and authority_state <> 'US'
        )::int as state_dc,
        count(*) filter (
          where authority_type = 'case'
            and authority_state is not null
            and authority_state <> 'US'
            and court_level in ('state_appellate', 'intermediate')
        )::int as intermediate_state,
        count(*) filter (
          where authority_type = 'case'
            and authority_state is not null
            and authority_state <> 'US'
            and decision_date < '2000-01-01'
        )::int as pre2000_state,
        count(*) filter (
          where authority_type = 'case'
            and authority_state is not null
            and authority_state <> 'US'
            and decision_date < '1980-01-01'
        )::int as pre1980_state
      from legal_authorities
    `;
    const [cite] = await sql`
      select
        count(*)::int as extracted,
        count(*) filter (where to_authority_id is not null)::int as resolved,
        count(*) filter (where to_authority_id is null)::int as unresolved
      from legal_authority_citations
    `;
    const [health] = await sql`
      select
        (select count(*)::int from (
          select 1 from legal_authorities
          where source_external_id is not null
          group by source_provider, source_external_id
          having count(*) > 1
        ) d) as duplicate_source_ids,
        (select count(*)::int from legal_authority_citations c
          left join legal_authorities a on a.id = c.from_authority_id
          where a.id is null) as orphan_edges,
        (select count(*)::int from legal_authority_chunks where embedding is null) as missing_embeddings
    `;
    await sql.unsafe("COMMIT");

    const live = {
      cases: cases.n,
      authorities: auth.n,
      federalLoose: federal.n,
      stateDc: tracker.state_dc,
      intermediateState: tracker.intermediate_state,
      pre2000State: tracker.pre2000_state,
      pre1980State: tracker.pre1980_state,
      extracted: cite.extracted,
      resolved: cite.resolved,
      unresolved: cite.unresolved,
      duplicateSourceIds: health.duplicate_source_ids,
      orphanEdges: health.orphan_edges,
      missingEmbeddings: health.missing_embeddings,
    };

    // After zero-CL pass: resolved should be >= 6142; cases/extracted must still match Week 2.
    const expected = {
      cases: 4658,
      stateDc: 3453,
      intermediateState: 572,
      pre2000State: 919,
      pre1980State: 293,
      extracted: 49926,
      resolvedFloor: 6142,
    };

    const match =
      live.cases === expected.cases &&
      live.stateDc === expected.stateDc &&
      live.intermediateState === expected.intermediateState &&
      live.pre2000State === expected.pre2000State &&
      live.pre1980State === expected.pre1980State &&
      live.extracted === expected.extracted &&
      live.resolved >= expected.resolvedFloor &&
      hostMatch &&
      !isLocal;

    console.log(
      JSON.stringify({
        ok: match,
        classification: "WEEK2_NEON_IDENTITY_VERIFY",
        realWeek2Corpus: match,
        hostMatchesHistoricalWeek2Pooler: hostMatch,
        isLocal47CaseDb: isLocal || live.cases < 100,
        transactionReadOnly: true,
        mutations: 0,
        courtListenerHttpCalls: 0,
        live,
        expected,
      }),
    );
    process.exit(match ? 0 : 3);
  } catch (e) {
    console.log(
      JSON.stringify({
        ok: false,
        err: String(e.message || e).slice(0, 500),
        courtListenerHttpCalls: 0,
      }),
    );
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();
