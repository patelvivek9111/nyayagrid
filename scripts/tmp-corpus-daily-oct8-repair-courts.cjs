#!/usr/bin/env node
/**
 * Zero-CL court repair for Oct 8 Unknown Court acquisitions.
 * F.Supp → EDPA when reason/source suggests EDPA, else district unspecified.
 * F.2d/3d/4th → circuit unspecified (level=circuit).
 */
"use strict";
const postgres = require("postgres");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require", idle_timeout: 10, connect_timeout: 40 });
  try {
    const rows = await sql`
      select id, citation, court, court_id, metadata
      from legal_authorities
      where authority_type='case'
        and (court='Unknown Court' or court_id in ('st-unknown','us-unknown'))
        and created_at > now() - interval '6 hours'
    `;
    const repaired = [];
    for (const row of rows) {
      const c = String(row.citation || "");
      const meta = typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata || {};
      let mapped;
      if (/\bF\.Supp/i.test(c)) {
        const edpaHint =
          /paed|edpa/i.test(JSON.stringify(meta)) ||
          ["75 F.Supp.2d 411", "248 F.Supp.2d 393", "390 F.Supp.2d 471", "15 F.Supp.3d 466", "134 F.Supp. 487", "277 F.Supp. 864"].includes(c);
        mapped = edpaHint
          ? {
              court: "United States District Court for the Eastern District of Pennsylvania",
              courtId: "us-d-paed",
              courtLevel: "district",
              authorityState: "US",
              federalCircuit: "3",
              jurisdiction: "United States",
              method: "oct8_fsupp_edpa_hint",
            }
          : {
              court: "United States District Court (district pending cluster repair)",
              courtId: "us-district-unspecified",
              courtLevel: "district",
              authorityState: "US",
              federalCircuit: null,
              jurisdiction: "United States",
              method: "oct8_fsupp_district_family",
            };
      } else if (/\bF\.(2d|3d|4th)\b/i.test(c)) {
        mapped = {
          court: "United States Court of Appeals (circuit pending cluster repair)",
          courtId: "us-circuit-unspecified",
          courtLevel: "circuit",
          authorityState: "US",
          federalCircuit: null,
          jurisdiction: "United States",
          method: "oct8_federal_reporter_family",
        };
      } else if (/\bA\.(2d|3d)\b/i.test(c)) {
        mapped = {
          court: "State high/appellate court (A. reporter; jurisdiction pending)",
          courtId: "st-regional-a",
          courtLevel: "state_high",
          authorityState: null,
          federalCircuit: null,
          jurisdiction: "Unknown",
          method: "oct8_a_reporter_family",
        };
      } else continue;

      const nextMeta = {
        ...meta,
        courtRepair: { at: new Date().toISOString(), method: mapped.method, previousCourt: row.court, previousCourtId: row.court_id },
      };
      await sql`
        update legal_authorities
        set court=${mapped.court}, court_id=${mapped.courtId}, court_level=${mapped.courtLevel},
            authority_state=${mapped.authorityState}, federal_circuit=${mapped.federalCircuit},
            jurisdiction=${mapped.jurisdiction}, metadata=${sql.json(nextMeta)}, updated_at=now()
        where id=${row.id}
      `;
      repaired.push({ citation: row.citation, courtId: mapped.courtId, method: mapped.method });
    }
    const [left] = await sql`
      select count(*)::int as n from legal_authorities
      where authority_type='case' and (court='Unknown Court' or court_id in ('st-unknown','us-unknown'))
        and created_at > now() - interval '6 hours'
    `;
    const out = { ok: left.n === 0, candidates: rows.length, repaired: repaired.length, remainingUnknown: left.n, courtListenerHttpCalls: 0, sample: repaired.slice(0, 15) };
    fs.writeFileSync(path.join(__dirname, "..", "packages/research/corpus/reports/corpus-daily-oct8-court-repair.json"), JSON.stringify({ ...out, repaired }, null, 2));
    console.log(JSON.stringify(out));
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main();
