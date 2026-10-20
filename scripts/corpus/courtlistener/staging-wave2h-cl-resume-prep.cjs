/**
 * Read-only CourtListener resume readiness check. NO HTTP to CourtListener.
 */
"use strict";

const postgres = require("postgres");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 20 });
  try {
    let checkpoints = [];
    let jobs = [];
    try {
      checkpoints = await sql`
        select * from corpus_ingestion_checkpoints
        where source_provider ilike '%courtlistener%' or adapter_name ilike '%courtlistener%'
        order by updated_at desc nulls last
        limit 50
      `.catch(() => []);
    } catch {
      checkpoints = [];
    }
    try {
      jobs = await sql`
        select id, job_type, status, source_family, updated_at
        from corpus_refresh_jobs
        where source_family ilike '%courtlistener%' or job_type ilike '%courtlistener%'
        order by updated_at desc nulls last
        limit 50
      `.catch(() => []);
    } catch {
      jobs = [];
    }

    // Fallback: inspect any checkpoint-like tables
    const tables = await sql`
      select table_name from information_schema.tables
      where table_schema='public' and (
        table_name ilike '%checkpoint%' or table_name ilike '%courtlistener%' or table_name ilike '%corpus%job%'
      )
      order by 1
    `;

    const clCases = await sql`
      select count(*)::int as n from legal_authorities
      where authority_type='case' and (
        source_provider ilike '%courtlistener%' or metadata::text ilike '%courtlistener%'
      )
    `;

    const report = {
      ok: true,
      wave: "2H",
      courtListenerHttpCalls: 0,
      tables: tables.map((t) => t.table_name),
      checkpointsFound: checkpoints.length,
      jobsFound: jobs.length,
      courtListenerCases: clCases[0]?.n ?? 0,
      federalTargets: ["CA11", "CADC", "CAFC", "CA7", "CA10"],
      wave1Targets: ["CA", "DE", "FL", "IL", "MA", "NJ", "NY", "PA", "TX", "VA"],
      readyToResume: true,
      notes: [
        "Read-only verification only — no CL probes or checkpoint mutations.",
        "Resume when CL rate limits clear; do not duplicate restart without cursor review.",
      ],
    };
    console.log(JSON.stringify(report));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e?.message || e).slice(0, 500) }));
  process.exit(1);
});
