/**
 * Post–CourtListener wave coverage / citation / embedding probe (Fly staging).
 * Never prints DATABASE_URL or API keys.
 */
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "no_database_url" }));
    process.exit(2);
  }
  const sql = postgres(url, { ssl: "require", max: 2 });
  try {
    const totals = await sql`
      select
        count(*)::int as total,
        count(*) filter (where source_provider = 'us-primary-corpus')::int as seed,
        count(*) filter (where source_provider = 'courtlistener')::int as courtlistener,
        count(*) filter (where authority_type = 'case')::int as cases,
        count(*) filter (where authority_type = 'statute')::int as statutes,
        count(*) filter (where authority_type = 'regulation')::int as regulations,
        count(*) filter (where authority_type = 'rule')::int as rules
      from legal_authorities
    `;

    const byCourt = await sql`
      select
        coalesce(court_id, '(null)') as court_id,
        coalesce(court_level, '(null)') as court_level,
        coalesce(authority_state, '(null)') as authority_state,
        count(*)::int as n
      from legal_authorities
      where source_provider = 'courtlistener'
      group by 1, 2, 3
      order by n desc, court_id
    `;

    const byState = await sql`
      select
        coalesce(authority_state, '(null)') as s,
        count(*) filter (where authority_type = 'case')::int as cases,
        count(*) filter (where source_provider = 'courtlistener')::int as cl,
        count(*)::int as n
      from legal_authorities
      where authority_state in ('US','CA','DE','FL','IL','MA','NJ','NY','PA','TX','VA')
         or authority_state is null
      group by 1
      order by 1
    `;

    const citations = await sql`
      select
        count(*)::int as edges,
        count(*) filter (where to_authority_id is not null)::int as resolved,
        count(*) filter (where normalized_citation is not null and normalized_citation <> '')::int as normalized
      from legal_authority_citations
    `;

    const treatment = await sql`
      select count(*)::int as authorities_with_treatment
      from legal_authorities
      where source_provider = 'courtlistener'
        and (
          source_metadata::text ilike '%treatmentSignals%'
          and source_metadata::text not ilike '%"treatmentSignals":[]%'
        )
    `;

    const chunks = await sql`
      select
        count(*)::int as chunks,
        count(*) filter (where c.embedding is not null)::int as with_embedding
      from legal_authority_chunks c
      join legal_authorities a on a.id = c.authority_id
      where a.source_provider = 'courtlistener'
    `;

    const currentness = await sql`
      select
        count(*) filter (where currentness_status is not null)::int as with_status,
        count(*) filter (where last_checked_at is not null)::int as with_checked
      from legal_authorities
      where source_provider = 'courtlistener'
    `;

    const sampleCl = await sql`
      select left(title, 90) as title, citation, court_id, decision_date::text as d,
             left(canonical_source_url, 120) as url
      from legal_authorities
      where source_provider = 'courtlistener'
      order by created_at desc
      limit 8
    `;

    // Retrieval smoke: keyword hits for SCOTUS / circuit / Wave1 high
    const retrieval = {} as Record<string, unknown>;
    const probes = [
      { key: "scotus", q: "%Supreme Court%", court: "us-scotus" },
      { key: "ca9", q: "%Ninth Circuit%", court: "us-ca-9" },
      { key: "ca_high", q: "%California%", court: "st-ca-high" },
      { key: "pa_high", q: "%Pennsylvania%", court: "st-pa-high" },
    ];
    for (const p of probes) {
      const rows = await sql`
        select left(title, 80) as title, citation, court_id
        from legal_authorities
        where source_provider = 'courtlistener'
          and court_id = ${p.court}
        limit 3
      `;
      retrieval[p.key] = { court: p.court, hits: rows.length, sample: rows };
    }

    // Embedding nearest-neighbor smoke if any CL embeddings exist
    let vectorHit: unknown = null;
    const embCount = Number(chunks[0]?.with_embedding ?? 0);
    if (embCount > 0) {
      const any = await sql`
        select c.embedding::text as emb
        from legal_authority_chunks c
        join legal_authorities a on a.id = c.authority_id
        where a.source_provider = 'courtlistener' and c.embedding is not null
        limit 1
      `;
      if (any[0]?.emb) {
        const nn = await sql`
          select left(a.title, 80) as title, a.court_id, a.citation
          from legal_authority_chunks c
          join legal_authorities a on a.id = c.authority_id
          where a.source_provider = 'courtlistener' and c.embedding is not null
          order by c.embedding <=> ${any[0].emb}::vector
          limit 3
        `;
        vectorHit = { ok: true, neighbors: nn };
      }
    }

    const expectedCourts = [
      "us-scotus",
      "us-ca-1",
      "us-ca-2",
      "us-ca-3",
      "us-ca-4",
      "us-ca-5",
      "us-ca-6",
      "us-ca-7",
      "us-ca-8",
      "us-ca-9",
      "us-ca-10",
      "us-ca-11",
      "us-ca-dc",
      "us-ca-fed",
      "st-ca-high",
      "st-ca-app",
      "st-ny-high",
      "st-ny-app",
      "st-pa-high",
      "st-pa-super",
      "st-tx-high",
      "st-tx-app",
      "st-nj-high",
      "st-nj-app",
      "st-fl-high",
      "st-fl-app",
      "st-il-high",
      "st-il-app",
      "st-ma-high",
      "st-ma-app",
      "st-va-high",
      "st-va-app",
      "st-de-high",
    ];
    const present = new Set(byCourt.map((r) => String(r.court_id)));
    const missingCourts = expectedCourts.filter((c) => !present.has(c));

    console.log(
      JSON.stringify(
        {
          ok: true,
          totals: totals[0],
          byCourt,
          byState,
          citations: citations[0],
          treatment: treatment[0],
          chunks: chunks[0],
          currentness: currentness[0],
          sampleCl,
          retrieval,
          vectorHit,
          courtMapping: {
            expected: expectedCourts.length,
            present: present.size,
            missingCourts,
          },
          featureAgents: process.env.FEATURE_AGENTS ?? null,
        },
        null,
        2,
      ),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e?.message ?? e).slice(0, 400) }));
  process.exit(1);
});
