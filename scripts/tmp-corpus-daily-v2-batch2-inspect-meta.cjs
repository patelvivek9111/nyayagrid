#!/usr/bin/env node
"use strict";
const postgres = require("postgres");
async function main() {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require", idle_timeout: 10, connect_timeout: 40 });
  try {
    const rows = await sql`
      select citation, source_external_id, metadata, canonical_source_url
      from legal_authorities
      where court = 'Unknown Court'
      order by created_at desc
      limit 3
    `;
    console.log(JSON.stringify(rows, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main();
