const postgres = require("postgres");
async function main() {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const samples = await sql`
      select raw_citation, normalized_citation, to_authority_id is not null as resolved, count(*)::int as n
      from legal_authority_citations
      where raw_citation ilike '%523%U%S%83%'
         or normalized_citation ilike '%523%U%S%83%'
         or raw_citation ilike '%844%F%2d%461%'
         or normalized_citation ilike '%844%F%2d%461%'
         or normalized_citation ilike '%844 F.2d 461%'
         or normalized_citation ilike '523 U.S. 83'
      group by 1,2,3
      order by n desc
      limit 40
    `;
    const top = await sql`
      select normalized_citation, count(*) filter (where to_authority_id is null)::int as unresolved
      from legal_authority_citations
      where to_authority_id is null and normalized_citation is not null
      group by 1
      order by unresolved desc
      limit 15
    `;
    const cols = await sql`
      select column_name from information_schema.columns
      where table_name = 'legal_authority_citations'
      order by ordinal_position
    `;
    console.log(JSON.stringify({ ok: true, samples, top, cols: cols.map((c) => c.column_name), courtListenerHttpCalls: 0 }, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: String(e.message || e) }));
  process.exit(1);
});
