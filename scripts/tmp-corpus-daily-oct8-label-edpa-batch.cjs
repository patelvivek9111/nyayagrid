#!/usr/bin/env node
"use strict";
const postgres = require("postgres");
async function main() {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require", idle_timeout: 10, connect_timeout: 40 });
  try {
    const cites = [
      "75 F.Supp.2d 411",
      "248 F.Supp.2d 393",
      "390 F.Supp.2d 471",
      "15 F.Supp.3d 466",
      "134 F.Supp. 487",
      "277 F.Supp. 864",
      "176 F.Supp.2d 1301",
      "126 F.Supp.2d 1083",
    ];
    const r = await sql`
      update legal_authorities
      set court='United States District Court for the Eastern District of Pennsylvania',
          court_id='us-d-paed', court_level='district', authority_state='US',
          federal_circuit='3', jurisdiction='United States', updated_at=now()
      where citation = any(${cites})
      returning citation, court_id
    `;
    console.log(JSON.stringify({ ok: true, updated: r, courtListenerHttpCalls: 0 }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main();
