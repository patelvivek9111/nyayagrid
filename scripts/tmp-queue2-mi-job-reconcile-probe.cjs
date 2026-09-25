/**
 * Read-only: MI (mich) corpus_ingest_jobs + MI corpus counts + cursor presence.
 * ZERO CourtListener HTTP. ZERO mutations.
 */
"use strict";
const postgres = require("postgres");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing", mutations: 0, courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const jobs = await sql`
      select source, cl_court, court_id, status, cursor, next_page_url,
             last_successful_external_id,
             items_discovered, items_fetched, items_imported, items_skipped,
             items_failed, items_quarantined, rate_limit_count, api_calls,
             target_max, batch_size, last_retry_after_sec, last_error,
             started_at, updated_at, completed_at, metadata
      from corpus_ingest_jobs
      where source = 'courtlistener' and cl_court = 'mich'
      order by updated_at desc nulls last
    `;
    const [mi] = await sql`
      select count(*)::int as authorities,
             count(*) filter (where authority_type='case')::int as cases,
             count(*) filter (where authority_type='case' and source_provider='courtlistener')::int as cl_cases,
             count(*) filter (
               where authority_type='case'
                 and source_provider='courtlistener'
                 and court_level in ('state_high','scotus')
             )::int as high_court_cl_cases,
             max(updated_at) as last_updated
      from legal_authorities where authority_state = 'MI'
    `;
    const cursorId = "cl-opinion-11250867";
    const [cursorHit] = await sql`
      select count(*)::int as n,
             max(source_external_id) as source_external_id,
             max(title) as title,
             max(updated_at) as updated_at
      from legal_authorities
      where authority_state = 'MI'
        and source_provider = 'courtlistener'
        and (
          source_external_id = ${cursorId}
          or source_external_id = ${cursorId.replace(/^cl-opinion-/, "")}
          or source_external_id like ${"%" + cursorId.replace(/^cl-opinion-/, "")}
        )
    `;
    const latest = await sql`
      select source_external_id, title, citation, updated_at, court_id
      from legal_authorities
      where authority_state = 'MI' and source_provider = 'courtlistener'
      order by updated_at desc nulls last
      limit 10
    `;
    const [integrity] = await sql`
      select
        (select count(*)::int from (
          select source_provider, source_external_id from legal_authorities
          where authority_state = 'MI' and source_external_id is not null
          group by 1, 2 having count(*) > 1
        ) d) as duplicate_source_ids,
        (select count(*)::int from legal_authority_chunks c
          left join legal_authorities a on a.id = c.authority_id
          where a.id is null) as orphan_count
    `;
    console.log(
      JSON.stringify({
        ok: true,
        mutations: 0,
        courtListenerHttpCalls: 0,
        featureAgents: process.env.FEATURE_AGENTS || "0",
        generatedAt: new Date().toISOString(),
        jobs,
        mi,
        cursorProbe: { cursorId, ...cursorHit },
        latest,
        integrity,
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch((e) => {
  console.log(
    JSON.stringify({
      ok: false,
      err: String(e.message || e).slice(0, 400),
      mutations: 0,
      courtListenerHttpCalls: 0,
    }),
  );
  process.exit(1);
});
