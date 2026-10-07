#!/usr/bin/env node
"use strict";
const postgres = require("postgres");
async function main() {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require", idle_timeout: 10, connect_timeout: 40 });
  try {
    await sql.unsafe("BEGIN READ ONLY");
    const [def] = await sql`
      select count(*)::int as n
      from legal_authority_citations c
      where c.to_authority_id is null
        and exists (
          select 1 from legal_authorities a
          where a.authority_type = 'case'
            and (
              a.normalized_citation = c.normalized_citation
              or a.citation = c.normalized_citation
              or a.citation = c.raw_citation
            )
        )
    `;
    const courts = await sql`
      select court, court_id, court_level, count(*)::int as n
      from legal_authorities
      where created_at > now() - interval '2 hours'
        and authority_type = 'case'
      group by 1,2,3
      order by n desc
      limit 20
    `;
    await sql.unsafe("COMMIT");
    console.log(JSON.stringify({ ok: true, presentTargetDefects: def.n, recentCourts: courts, courtListenerHttpCalls: 0 }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main();
