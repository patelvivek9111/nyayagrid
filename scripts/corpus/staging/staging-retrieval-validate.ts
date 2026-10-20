import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "no_database_url" }));
    process.exit(2);
  }
  const sql = postgres(url, { ssl: "require", max: 1 });
  try {
    const cites = [
      "28 U.S.C. § 1331",
      "29 CFR § 541.100",
      "42 Pa.C.S. § 5525",
    ];
    const hits: Record<string, unknown> = {};
    for (const c of cites) {
      const pattern = `%${c.replace(/§/g, "%")}%`;
      hits[c] = await sql`
        select citation, authority_type::text as t, authority_state,
               left(title, 80) as title,
               (canonical_source_url is not null) as has_url
        from legal_authorities
        where source_provider = 'us-primary-corpus'
          and (citation ilike ${pattern} or title ilike ${`%${c}%`})
        limit 3
      `;
    }
    const byState = await sql`
      select authority_state as s,
             count(*) filter (where authority_type = 'case')::int as cases,
             count(*) filter (where authority_type = 'statute')::int as statutes,
             count(*)::int as n
      from legal_authorities
      where source_provider = 'us-primary-corpus'
        and authority_state in ('US','CA','DE','FL','IL','MA','NJ','NY','PA','TX','VA')
      group by 1 order by 1
    `;
    const chunks = await sql`
      select count(*)::int as n
      from legal_authority_chunks c
      join legal_authorities a on a.id = c.authority_id
      where a.source_provider = 'us-primary-corpus'
    `;
    const emb = await sql`
      select count(*)::int as n
      from legal_authority_chunks c
      join legal_authorities a on a.id = c.authority_id
      where a.source_provider = 'us-primary-corpus' and c.embedding is not null
    `;
    const miss = await sql`
      select count(*)::int as n from legal_authorities
      where source_provider = 'us-primary-corpus'
        and citation ilike '%99999.01%'
    `;
    console.log(
      JSON.stringify(
        {
          ok: true,
          hits,
          wave1: byState,
          chunks: chunks[0],
          embeddings: emb[0],
          missHits: miss[0],
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
  console.log(JSON.stringify({ ok: false, err: String(e?.message ?? e).slice(0, 300) }));
  process.exit(1);
});
