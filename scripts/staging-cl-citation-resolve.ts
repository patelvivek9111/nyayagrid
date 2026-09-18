/**
 * Re-resolve unresolved citation edges against growing corpus (no re-extract).
 * Never prints DATABASE_URL.
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
    const before = await sql`
      select
        count(*)::int as edges,
        count(*) filter (where to_authority_id is not null)::int as resolved,
        count(*) filter (where to_authority_id is null)::int as unresolved
      from legal_authority_citations
    `;
    const unresolved = await sql`
      select id, normalized_citation, raw_citation
      from legal_authority_citations
      where to_authority_id is null
        and normalized_citation is not null
        and normalized_citation <> ''
      limit 2000
    `;
    let newlyResolved = 0;
    let ambiguous = 0;
    for (const row of unresolved) {
      const matches = await sql`
        select id from legal_authorities
        where normalized_citation = ${row.normalized_citation}
           or citation = ${row.raw_citation}
        limit 3
      `;
      if (matches.length === 1) {
        await sql`
          update legal_authority_citations
          set to_authority_id = ${matches[0]!.id}
          where id = ${row.id} and to_authority_id is null
        `;
        newlyResolved += 1;
      } else if (matches.length > 1) {
        ambiguous += 1;
      }
    }
    const after = await sql`
      select
        count(*)::int as edges,
        count(*) filter (where to_authority_id is not null)::int as resolved,
        count(*) filter (where to_authority_id is null)::int as unresolved
      from legal_authority_citations
    `;
    console.log(
      JSON.stringify({
        ok: true,
        before: before[0],
        after: after[0],
        newlyResolved,
        ambiguous,
        scanned: unresolved.length,
        featureAgents: process.env.FEATURE_AGENTS ?? null,
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e?.message ?? e).slice(0, 400) }));
  process.exit(1);
});
