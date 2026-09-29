#!/usr/bin/env node
/**
 * Read-only F.3d / F.2d / F.4th TARGET_ABSENT inventory.
 * ZERO CourtListener HTTP. ZERO mutations.
 */
"use strict";
const postgres = require("postgres");

function parseFed(cite) {
  const t = String(cite || "").replace(/\s+/g, " ").trim();
  let m = t.match(/^(\d{1,4})\s+F\.\s*(3d)\s+(\d{1,4})$/i);
  if (m) return { citation: `${m[1]} F.3d ${m[3]}`, volume: Number(m[1]), page: Number(m[3]), series: "3d", reporter: "F.3d", family: "f3d" };
  m = t.match(/^(\d{1,4})\s+F\.\s*(2d)\s+(\d{1,4})$/i);
  if (m) return { citation: `${m[1]} F.2d ${m[3]}`, volume: Number(m[1]), page: Number(m[3]), series: "2d", reporter: "F.2d", family: "f2d" };
  m = t.match(/^(\d{1,4})\s+F\.\s*(4th)\s+(\d{1,4})$/i);
  if (m) return { citation: `${m[1]} F.4th ${m[3]}`, volume: Number(m[1]), page: Number(m[3]), series: "4th", reporter: "F.4th", family: "f4th" };
  return null;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "no_db" }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const rows = await sql`
      select coalesce(normalized_citation, raw_citation) as cite, count(*)::int as edges,
             count(distinct from_authority_id)::int as citing
      from legal_authority_citations
      where to_authority_id is null
        and coalesce(normalized_citation, raw_citation) is not null
        and coalesce(normalized_citation, raw_citation) ~* '\\mF\\.\\s*(2d|3d|4th)\\M'
      group by 1
      order by edges desc
      limit 400
    `;
    const present = await sql`
      select citation, normalized_citation from legal_authorities
      where authority_type = 'case'
        and (
          normalized_citation ~* '\\mF\\.\\s*(2d|3d|4th)\\M'
          or citation ~* '\\mF\\.\\s*(2d|3d|4th)\\M'
        )
    `;
    const presentSet = new Set(
      present.flatMap((r) => [r.normalized_citation, r.citation].filter(Boolean).map((c) => String(c).replace(/\s+/g, " ").trim().toLowerCase())),
    );

    const buckets = { f3d: [], f2d: [], f4th: [] };
    for (const row of rows) {
      const parsed = parseFed(row.cite);
      if (!parsed) continue;
      if (presentSet.has(parsed.citation.toLowerCase())) continue;
      const expectedCl = 2;
      buckets[parsed.family].push({
        ...parsed,
        edges: row.edges,
        citing: row.citing,
        expectedCl,
        expectedYield: Number((row.edges / expectedCl).toFixed(3)),
        present: false,
      });
    }
    for (const k of Object.keys(buckets)) {
      buckets[k].sort((a, b) => b.edges - a.edges || a.volume - b.volume || a.page - b.page);
    }

    const [cite] = await sql`
      select count(*)::int as extracted,
             count(*) filter (where to_authority_id is not null)::int as resolved,
             count(*) filter (where to_authority_id is null)::int as unresolved
      from legal_authority_citations
    `;
    const [corpus] = await sql`
      select count(*)::int as authorities,
             count(*) filter (where authority_type='case')::int as cases,
             count(*) filter (where authority_type='case' and source_provider='courtlistener')::int as cl_cases
      from legal_authorities
    `;

    console.log(
      JSON.stringify({
        ok: true,
        courtListenerHttpCalls: 0,
        mutations: 0,
        citations: {
          ...cite,
          targetAbsent: cite.unresolved,
          resolutionRatePct: cite.extracted ? Number(((100 * cite.resolved) / cite.extracted).toFixed(2)) : 0,
        },
        corpus,
        inventory: {
          f3dCount: buckets.f3d.length,
          f2dCount: buckets.f2d.length,
          f4thCount: buckets.f4th.length,
          f3dTop20: buckets.f3d.slice(0, 20),
          f2dTop10: buckets.f2d.slice(0, 10),
          f4thTop10: buckets.f4th.slice(0, 10),
        },
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 400) }));
  process.exit(1);
});
