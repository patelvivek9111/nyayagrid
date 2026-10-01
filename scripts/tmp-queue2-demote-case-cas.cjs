#!/usr/bin/env node
/** Demote case current_as_of_source_date → historical when decision_date present. */
"use strict";
const postgres = require("postgres");
async function main() {
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    const r = await sql`
      update legal_authorities
      set currentness_status='historical', updated_at=now()
      where authority_type='case'
        and currentness_status='current_as_of_source_date'
        and decision_date is not null
    `;
    const after = await sql`
      select currentness_status, count(*)::int as n from legal_authorities group by 1 order by 1
    `;
    const byType = await sql`
      select authority_type, currentness_status, count(*)::int as n
      from legal_authorities group by 1, 2 order by 1, 2
    `;
    console.log(JSON.stringify({ ok: true, demoted: r.count, after, byType, courtListenerHttpCalls: 0, aiCalls: 0 }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch((e) => {
  console.error(JSON.stringify({ ok: false, err: String(e.message || e) }));
  process.exit(1);
});
