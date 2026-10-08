#!/usr/bin/env node
"use strict";
const postgres = require("postgres");

function normalizeLoose(cite) {
  return String(cite || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\bF\.?\s*Supp\.?\s*3d\b/gi, "F.Supp.3d")
    .replace(/\bF\.?\s*Supp\.?\s*2d\b/gi, "F.Supp.2d")
    .replace(/\bF\.?\s*Supp\.?\b(?!\s*\d)/gi, "F.Supp.")
    .trim();
}

const RE = [
  { re: /^(\d{1,4})\s+F\.?\s*Supp\.?\s*3d\s+(\d{1,4})$/i, name: "3d" },
  { re: /^(\d{1,4})\s+F\.?\s*Supp\.?\s*2d\s+(\d{1,4})$/i, name: "2d" },
  { re: /^(\d{1,4})\s+F\.?\s*Supp\.?\s+(\d{1,4})$/i, name: "1st" },
];

function parse(cite) {
  const raw = normalizeLoose(cite);
  for (const spec of RE) {
    const m = raw.match(spec.re);
    if (m) return { ok: true, raw, series: spec.name, vol: m[1], page: m[2] };
  }
  return { ok: false, raw };
}

async function main() {
  const samples = [
    "75 F.Supp.2d 411",
    "75 F. Supp. 2d 411",
    "75 F. Supp.2d 411",
    "248 F.Supp.2d 393",
    "390 F.Supp.2d 471",
  ];
  console.log(JSON.stringify({ parseTests: samples.map((s) => ({ s, ...parse(s) })) }, null, 2));

  const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require", idle_timeout: 10, connect_timeout: 40 });
  try {
    await sql.unsafe("BEGIN READ ONLY");
    const rows = await sql`
      select coalesce(nullif(btrim(normalized_citation),''), nullif(btrim(raw_citation),'')) as cite,
             count(*)::int as n
      from legal_authority_citations
      where to_authority_id is null
        and coalesce(normalized_citation, raw_citation) ~* 'F\\.?\\s*Supp'
      group by 1
      order by n desc
      limit 40
    `;
    const present = await sql`
      select citation, normalized_citation, court_id
      from legal_authorities
      where citation in ('75 F.Supp.2d 411','248 F.Supp.2d 393','390 F.Supp.2d 471')
         or normalized_citation in ('75 F.Supp.2d 411','248 F.Supp.2d 393','390 F.Supp.2d 471')
         or citation ~* '75\\s+F\\.?\\s*Supp'
    `;
    await sql.unsafe("COMMIT");
    console.log(JSON.stringify({ unresolvedFsuppTop: rows, practicePresent: present }, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main();
