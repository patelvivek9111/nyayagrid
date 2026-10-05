/**
 * Read-only: items_imported / target_max for surgical hist lanes. 0 CL.
 */
"use strict";
const postgres = require("postgres");

async function main() {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 5, connect_timeout: 20 });
  const courts = ["wash", "kyctapp", "indctapp", "nmctapp", "arizctapp", "utahctapp", "wisctapp", "la"];
  try {
    const rows = await sql`
      select cl_court, status, items_imported, items_skipped, target_max, api_calls,
             cursor, next_page_url is not null as has_next,
             last_error, updated_at
      from corpus_ingest_jobs
      where source = 'courtlistener'
        and cl_court = any(${courts})
      order by cl_court
    `;
    console.log(
      JSON.stringify(
        {
          ok: true,
          classification: "WEEK2_SURGICAL_JOB_PROBE",
          generatedAt: new Date().toISOString(),
          jobs: rows,
          courtListenerHttpCalls: 0,
        },
        null,
        2,
      ),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e?.message || e) }));
  process.exit(1);
});
