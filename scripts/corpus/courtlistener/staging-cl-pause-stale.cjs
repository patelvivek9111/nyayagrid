/**
 * Pause stale corpus_ingest_jobs left in running after a crashed poller.
 * No CourtListener HTTP.
 */
"use strict";
const postgres = require("postgres");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const forceAll = process.env.CL_PAUSE_FORCE === "1";
    const rows = forceAll
      ? await sql`
          update corpus_ingest_jobs
          set status = 'paused',
              updated_at = now(),
              last_error = coalesce(last_error, 'force_pause_wave2m')
          where source = 'courtlistener'
            and status = 'running'
          returning cl_court, cursor, items_imported, items_skipped, target_max
        `
      : await sql`
          update corpus_ingest_jobs
          set status = 'paused',
              updated_at = now(),
              last_error = coalesce(last_error, 'stale_running_reset_wave2m')
          where source = 'courtlistener'
            and status = 'running'
            and updated_at < now() - interval '3 minutes'
          returning cl_court, cursor, items_imported, items_skipped, target_max
        `;
    process.stdout.write(JSON.stringify({ ok: true, forceAll, reset: rows, courtListenerHttpCalls: 0 }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch((e) => {
  process.stdout.write(JSON.stringify({ ok: false, err: String(e.message || e) }));
  process.exit(1);
});
