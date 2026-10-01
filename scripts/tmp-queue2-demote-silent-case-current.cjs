#!/usr/bin/env node
/** Probe case current_as_of_source_date rows; optionally demote silent claims. ZERO CL/AI. */
"use strict";
const postgres = require("postgres");
const APPLY = process.argv.includes("--apply");

async function main() {
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    const rows = await sql`
      select
        count(*)::int as n,
        count(*) filter (where effective_date is not null)::int as with_effective,
        count(*) filter (where last_checked_at is not null)::int as with_last_checked,
        count(*) filter (where decision_date is not null)::int as with_decision,
        count(*) filter (where effective_date is null and last_checked_at is null)::int as silent
      from legal_authorities
      where authority_type='case' and currentness_status='current_as_of_source_date'
    `;
    const samples = await sql`
      select id::text, citation, normalized_citation, decision_date::text, effective_date::text,
             last_checked_at::text, source_provider, publication_status
      from legal_authorities
      where authority_type='case' and currentness_status='current_as_of_source_date'
      limit 8
    `;
    let demoted = 0;
    if (APPLY) {
      // Cases with only decision_date (or nothing) claiming CURRENT → historical if decision_date else unknown
      const r1 = await sql`
        update legal_authorities
        set currentness_status='historical', updated_at=now()
        where authority_type='case'
          and currentness_status='current_as_of_source_date'
          and effective_date is null
          and last_checked_at is null
          and decision_date is not null
      `;
      const r2 = await sql`
        update legal_authorities
        set currentness_status='unknown', updated_at=now()
        where authority_type='case'
          and currentness_status='current_as_of_source_date'
          and effective_date is null
          and last_checked_at is null
          and decision_date is null
      `;
      demoted = (r1.count || 0) + (r2.count || 0);
    }
    const after = await sql`
      select currentness_status, count(*)::int as n
      from legal_authorities where authority_type='case'
      group by 1 order by 1
    `;
    const totals = await sql`
      select currentness_status, count(*)::int as n from legal_authorities group by 1 order by 1
    `;
    console.log(JSON.stringify({ ok: true, apply: APPLY, probe: rows[0], samples, demoted, caseAfter: after, totals }, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch((e) => {
  console.error(JSON.stringify({ ok: false, err: String(e.message || e) }));
  process.exit(1);
});
