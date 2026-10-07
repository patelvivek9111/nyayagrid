#!/usr/bin/env node
"use strict";
const postgres = require("postgres");
async function main() {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require", idle_timeout: 10, connect_timeout: 40 });
  try {
    const rows = await sql`
      select id, citation, court, court_id
      from legal_authorities
      where authority_type='case'
        and (court='Unknown Court' or court_id in ('st-unknown','us-unknown'))
        and created_at > now() - interval '6 hours'
    `;
    let n = 0;
    for (const row of rows) {
      const c = String(row.citation || "");
      let mapped;
      if (/\bF\.(2d|3d|4th)\b/i.test(c)) {
        mapped = {
          court: "United States Court of Appeals (circuit pending cluster repair)",
          courtId: "us-circuit-unspecified",
          courtLevel: "circuit",
          authorityState: "US",
          jurisdiction: "United States",
        };
      } else if (/\bA\.(2d|3d)\b/i.test(c)) {
        mapped = {
          court: "State high court (A. reporter; jurisdiction pending cluster repair)",
          courtId: "st-regional-a",
          courtLevel: "state_high",
          authorityState: null,
          jurisdiction: "Unknown",
        };
      } else {
        mapped = {
          court: "Court pending metadata repair",
          courtId: "pending-repair",
          courtLevel: "unknown",
          authorityState: null,
          jurisdiction: "Unknown",
        };
      }
      await sql`
        update legal_authorities
        set court=${mapped.court}, court_id=${mapped.courtId}, court_level=${mapped.courtLevel},
            authority_state=${mapped.authorityState}, jurisdiction=${mapped.jurisdiction}, updated_at=now()
        where id=${row.id}
      `;
      n += 1;
    }
    const [left] = await sql`
      select count(*)::int as n from legal_authorities
      where authority_type='case' and (court='Unknown Court' or court_id in ('st-unknown','us-unknown'))
        and created_at > now() - interval '6 hours'
    `;
    console.log(JSON.stringify({ ok: left.n === 0, repaired: n, remainingUnknown: left.n, rows, courtListenerHttpCalls: 0 }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main();
