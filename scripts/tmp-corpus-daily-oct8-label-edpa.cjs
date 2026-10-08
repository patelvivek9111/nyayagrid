#!/usr/bin/env node
"use strict";
const postgres = require("postgres");
async function main() {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require", idle_timeout: 10, connect_timeout: 40 });
  try {
    const r = await sql`
      update legal_authorities
      set court = 'United States District Court for the Eastern District of Pennsylvania',
          court_id = 'us-d-paed',
          court_level = 'district',
          authority_state = 'US',
          federal_circuit = '3',
          jurisdiction = 'United States',
          updated_at = now()
      where citation in ('75 F.Supp.2d 411','248 F.Supp.2d 393','390 F.Supp.2d 471')
        and (court = 'Unknown Court' or court_id in ('st-unknown','us-unknown') or court_id is null)
      returning citation, court_id
    `;
    console.log(JSON.stringify({ ok: true, updated: r, courtListenerHttpCalls: 0 }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main();
