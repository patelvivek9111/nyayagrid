/**
 * Read-only: check whether A2 citation targets are already present.
 * ZERO CourtListener HTTP.
 */
"use strict";
const postgres = require("postgres");

function leanNormalizeUs(cite) {
  const m = String(cite || "")
    .replace(/\s+/g, " ")
    .trim()
    .match(/^(\d{1,3})\s+U\.?\s*S\.?\s+(\d{1,4})$/i);
  return m ? `${m[1]} U.S. ${m[2]}` : null;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "no_db" }));
    process.exit(2);
  }
  const cites = String(process.argv[2] || process.env.A2_CITATIONS || "")
    .split("|")
    .map((s) => leanNormalizeUs(s.trim()))
    .filter(Boolean);
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const out = [];
    for (const citation of cites) {
      const rows = await sql`
        select id, citation, normalized_citation, source_provider, source_external_id
        from legal_authorities
        where normalized_citation = ${citation}
           or citation = ${citation}
           or normalized_citation ilike ${citation}
           or citation ilike ${citation}
        limit 3
      `;
      const edges = await sql`
        select count(*)::int as n,
               count(distinct from_authority_id)::int as citing
        from legal_authority_citations
        where to_authority_id is null
          and (
            normalized_citation = ${citation}
            or raw_citation = ${citation}
            or normalized_citation ilike ${citation}
          )
      `;
      out.push({
        citation,
        present: rows.length > 0,
        authorityId: rows[0]?.id || null,
        sourceExternalId: rows[0]?.source_external_id || null,
        expectedEdges: edges[0]?.n || 0,
        uniqueCitingAuthorities: edges[0]?.citing || 0,
      });
    }
    console.log(JSON.stringify({ ok: true, courtListenerHttpCalls: 0, mutations: 0, targets: out }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 300) }));
  process.exit(1);
});
