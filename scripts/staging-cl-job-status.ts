/**
 * Read corpus_ingest_jobs status for a CL court (or all).
 * Env: CL_COURT optional
 */
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "no_database_url" }));
    process.exit(2);
  }
  const clCourt = process.env.CL_COURT?.trim().toLowerCase() || null;
  const sql = postgres(url, { ssl: "require", max: 1, onnotice: () => undefined });
  try {
    const jobs = clCourt
      ? await sql`
          select source, cl_court, court_id, status, cursor, next_page_url,
                 last_successful_external_id,
                 items_discovered, items_fetched, items_imported, items_skipped,
                 items_failed, items_quarantined, rate_limit_count, api_calls,
                 target_max, batch_size, last_retry_after_sec, last_error,
                 started_at, updated_at, completed_at
          from corpus_ingest_jobs
          where source = 'courtlistener' and cl_court = ${clCourt}
        `
      : await sql`
          select source, cl_court, court_id, status, cursor,
                 items_imported, items_skipped, items_failed, rate_limit_count,
                 api_calls, target_max, updated_at, completed_at
          from corpus_ingest_jobs
          where source = 'courtlistener'
          order by updated_at desc
          limit 50
        `;
    const clCounts = await sql`
      select court_id, count(*)::int as n
      from legal_authorities
      where source_provider = 'courtlistener'
      group by 1 order by n desc
    `;
    console.log(JSON.stringify({ ok: true, jobs, clCounts, featureAgents: process.env.FEATURE_AGENTS ?? null }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e?.message ?? e).slice(0, 400) }));
  process.exit(1);
});
