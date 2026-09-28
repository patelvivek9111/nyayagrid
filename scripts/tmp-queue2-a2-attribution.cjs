/**
 * Per-authority attribution after A2 pilot (zero CL).
 * Args: authorityId|citation pairs via argv JSON or default from pilot.
 */
"use strict";
const postgres = require("postgres");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "no_db" }));
    process.exit(2);
  }
  const targets = JSON.parse(
    process.argv[2] ||
      JSON.stringify([
        { citation: "466 U.S. 668", authorityId: "6321aee3-313a-4c1c-936a-e9674c1f3ad2", clRequests: 2 },
        { citation: "373 U.S. 83", authorityId: "d9fad4bd-381b-4d3b-a071-619a87181d0b", clRequests: 2 },
        { citation: "567 U.S. 460", authorityId: "9004b5b8-0f3c-4106-93b2-c6f4c10b44eb", clRequests: 2 },
        { citation: "543 U.S. 551", authorityId: "bb5d2f89-b134-4c07-81b1-3997e4b601f8", clRequests: 2 },
        { citation: "386 U.S. 738", authorityId: "27089ca0-ec11-4657-9d4d-8a5f219e2c57", clRequests: 2 },
        { citation: "392 U.S. 1", authorityId: "79420ce6-667b-4e2d-9fa6-a43d8675b454", clRequests: 2 },
        { citation: "443 U.S. 307", authorityId: "95f739b3-e39a-480d-9ac5-f58e19bf806c", clRequests: 2 },
      ]),
  );
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const attribution = [];
    for (const t of targets) {
      const auth = await sql`
        select id, citation, normalized_citation, source_external_id, source_provider, court, metadata
        from legal_authorities where id = ${t.authorityId}::uuid limit 1
      `;
      const resolved = await sql`
        select count(*)::int as edges,
               count(distinct from_authority_id)::int as citing
        from legal_authority_citations
        where to_authority_id = ${t.authorityId}::uuid
      `;
      const stillAbsent = await sql`
        select count(*)::int as n
        from legal_authority_citations
        where to_authority_id is null
          and (normalized_citation = ${t.citation} or raw_citation = ${t.citation})
      `;
      attribution.push({
        normalizedCitation: t.citation,
        authorityId: t.authorityId,
        reporter: "U.S.",
        clRequestsSpent: t.clRequests,
        title: auth[0]?.citation ? auth[0] : null,
        authority: auth[0]
          ? {
              citation: auth[0].citation,
              normalized: auth[0].normalized_citation,
              sourceExternalId: auth[0].source_external_id,
              sourceProvider: auth[0].source_provider,
              court: auth[0].court,
            }
          : null,
        edgesNewlyResolved: resolved[0]?.edges || 0,
        uniqueCitingAuthoritiesUnlocked: resolved[0]?.citing || 0,
        stillUnresolvedSameCitation: stillAbsent[0]?.n || 0,
      });
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
    const [chunks] = await sql`
      select count(*)::int as chunks,
             count(*) filter (where embedding is not null)::int as embeddings,
             count(*) filter (where embedding is null)::int as missing_embeddings
      from legal_authority_chunks
    `;
    const orphans = await sql`
      select count(*)::int as n from legal_authority_chunks c
      left join legal_authorities a on a.id = c.authority_id
      where a.id is null
    `;
    const dupes = await sql`
      select count(*)::int as n from (
        select source_provider, source_external_id from legal_authorities
        where source_external_id is not null
        group by 1,2 having count(*) > 1
      ) d
    `;

    console.log(
      JSON.stringify({
        ok: true,
        courtListenerHttpCalls: 0,
        mutations: 0,
        attribution,
        citations: {
          ...cite,
          target_absent: cite.unresolved,
          resolutionRate: cite.extracted ? Number(((100 * cite.resolved) / cite.extracted).toFixed(2)) : 0,
        },
        corpus,
        chunks,
        orphanCount: orphans[0]?.n || 0,
        duplicateSourceIds: dupes[0]?.n || 0,
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
