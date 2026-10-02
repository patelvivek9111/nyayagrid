/**
 * Local integrity probe for citation hardening (zero network).
 */
"use strict";
const postgres = require("postgres");

async function main() {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 20, connect_timeout: 20 });
  try {
    const [dupCite] = await sql`
      select count(*)::int as n from (
        select from_authority_id, normalized_citation
        from legal_authority_citations group by 1,2 having count(*)>1
      ) d
    `;
    const [orphanCite] = await sql`
      select count(*)::int as n
      from legal_authority_citations c
      left join legal_authorities a on a.id = c.from_authority_id
      where a.id is null
    `;
    const [dupAuth] = await sql`
      select count(*)::int as n from (
        select source_provider, source_external_id
        from legal_authorities
        where source_external_id is not null
        group by 1,2 having count(*)>1
      ) d
    `;
    const [orphanChunk] = await sql`
      select count(*)::int as n
      from legal_authority_chunks c
      left join legal_authorities a on a.id = c.authority_id
      where a.id is null
    `;
    const [missingEmb] = await sql`
      select count(*)::int as n
      from legal_authority_chunks
      where embedding is null
    `;
    const [cases] = await sql`
      select
        (select count(*)::int from legal_authorities where authority_type='case') as cases,
        (select count(*)::int from legal_authority_citations) as extracted,
        (select count(*)::int from legal_authority_citations where to_authority_id is not null) as resolved,
        (select count(*)::int from legal_authority_citations where to_authority_id is null) as unresolved
    `;
    console.log(JSON.stringify({
      ok: true,
      courtListenerHttpCalls: 0,
      cases,
      duplicateCitationEdges: dupCite.n,
      orphanCitationEdges: orphanCite.n,
      duplicateAuthorities: dupAuth.n,
      orphanChunks: orphanChunk.n,
      missingEmbeddings: missingEmb.n,
    }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: String(e.message || e) }));
  process.exit(1);
});
