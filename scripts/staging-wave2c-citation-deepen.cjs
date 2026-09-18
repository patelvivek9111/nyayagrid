/**
 * Wave 2C citation graph deepen: extract USC/CFR/Fed.R cites from case text
 * and link exact unique matches. No CourtListener fetches.
 */
const postgres = require("postgres");

const PATTERNS = [
  { type: "statute", re: /\b(\d{1,2})\s+U\.?\s?S\.?\s?C\.?\s*§+\s*(\d[\w.\-]*)/gi, norm: (m) => `${m[1]} U.S.C. § ${m[2]}` },
  { type: "regulation", re: /\b(\d{1,2})\s+C\.?\s?F\.?\s?R\.?\s*§*\s*(\d+(?:\.[0-9A-Za-z\-]+)*)/gi, norm: (m) => `${m[1]} C.F.R. § ${m[2]}` },
  {
    type: "rule",
    re: /\bFed\.?\s*R\.?\s*(Civ\.?\s*P\.?|Evid\.?|App\.?\s*P\.?)\s*(\d+[A-Za-z]?)\b/gi,
    norm: (m) => {
      const k = m[1].replace(/\s+/g, " ").trim().toLowerCase();
      let r = "Fed. R. Civ. P.";
      if (/^evid/i.test(k)) r = "Fed. R. Evid.";
      else if (/^app/i.test(k)) r = "Fed. R. App. P.";
      return `${r} ${m[2]}`;
    },
  },
];

function extract(text) {
  const out = [];
  const seen = new Set();
  for (const p of PATTERNS) {
    const re = new RegExp(p.re.source, "gi");
    let m;
    while ((m = re.exec(text))) {
      const normalized = p.norm(m);
      const raw = m[0];
      const key = `${normalized}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ raw, normalized, type: p.type });
    }
  }
  return out;
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require" });

  const before = await sql`
    select
      count(*)::int as extracted,
      count(*) filter (where to_authority_id is not null)::int as resolved,
      count(*) filter (where to_authority_id is null)::int as unresolved
    from legal_authority_citations
  `;

  // Authority lookup map
  const auths = await sql`
    select id, citation, normalized_citation
    from legal_authorities
    where authority_type in ('statute','regulation','rule')
      and (normalized_citation is not null or citation is not null)
  `;
  const byNorm = new Map();
  const add = (key, id) => {
    if (!key) return;
    const k = String(key).trim();
    if (!k) return;
    if (!byNorm.has(k)) byNorm.set(k, new Set());
    byNorm.get(k).add(id);
  };
  for (const a of auths) {
    add(a.normalized_citation, a.id);
    add(a.citation, a.id);
    if (a.citation) {
      add(String(a.citation).replace(" CFR ", " C.F.R. "), a.id);
      add(String(a.citation).replace(" C.F.R. ", " CFR "), a.id);
    }
    if (a.normalized_citation) {
      add(String(a.normalized_citation).replace(" CFR ", " C.F.R. "), a.id);
      add(String(a.normalized_citation).replace(" C.F.R. ", " CFR "), a.id);
    }
  }

  function resolve(norm) {
    const ids = byNorm.get(norm);
    if (!ids || ids.size !== 1) return null;
    return [...ids][0];
  }

  // Pull case version text (bounded)
  const cases = await sql`
    select a.id as authority_id, v.content
    from legal_authorities a
    join legal_authority_versions v on v.authority_id = a.id and v.valid_to is null
    where a.authority_type = 'case'
    order by a.created_at desc
    limit 400
  `;

  let inserted = 0;
  let resolvedNew = 0;
  let ambiguous = 0;
  for (const row of cases) {
    const cites = extract(row.content || "");
    for (const c of cites) {
      const toId = resolve(c.normalized);
      if (toId === null) {
        // still insert unresolved edge if not present
        const existing = await sql`
          select id, to_authority_id from legal_authority_citations
          where from_authority_id = ${row.authority_id}
            and normalized_citation = ${c.normalized}
          limit 1
        `;
        if (existing.length === 0) {
          await sql`
            insert into legal_authority_citations (
              id, from_authority_id, to_authority_id, raw_citation, normalized_citation
            ) values (
              gen_random_uuid(), ${row.authority_id}, null, ${c.raw}, ${c.normalized}
            )
          `;
          inserted += 1;
        }
        // check ambiguity
        const ids = byNorm.get(c.normalized);
        if (ids && ids.size > 1) ambiguous += 1;
        continue;
      }

      const existing = await sql`
        select id, to_authority_id from legal_authority_citations
        where from_authority_id = ${row.authority_id}
          and normalized_citation = ${c.normalized}
        limit 1
      `;
      if (existing.length === 0) {
        await sql`
          insert into legal_authority_citations (
            id, from_authority_id, to_authority_id, raw_citation, normalized_citation
          ) values (
            gen_random_uuid(), ${row.authority_id}, ${toId}, ${c.raw}, ${c.normalized}
          )
        `;
        inserted += 1;
        resolvedNew += 1;
      } else if (!existing[0].to_authority_id) {
        await sql`
          update legal_authority_citations
          set to_authority_id = ${toId}
          where id = ${existing[0].id}
        `;
        resolvedNew += 1;
      }
    }
  }

  // Also re-resolve any remaining null edges with exact unique match
  const backfill = await sql`
    with candidates as (
      select e.id as edge_id, a.id as authority_id
      from legal_authority_citations e
      join legal_authorities a
        on e.to_authority_id is null
       and e.normalized_citation is not null
       and (
         a.normalized_citation = e.normalized_citation
         or a.citation = e.normalized_citation
         or a.normalized_citation = replace(e.normalized_citation, ' CFR ', ' C.F.R. ')
         or a.citation = replace(e.normalized_citation, ' C.F.R. ', ' CFR ')
       )
    ),
    unique_matches as (
      select edge_id, min(authority_id::text)::uuid as authority_id
      from candidates
      group by edge_id
      having count(distinct authority_id) = 1
    )
    update legal_authority_citations e
    set to_authority_id = u.authority_id
    from unique_matches u
    where e.id = u.edge_id
    returning e.id
  `;

  const after = await sql`
    select
      count(*)::int as extracted,
      count(*) filter (where to_authority_id is not null)::int as resolved,
      count(*) filter (where to_authority_id is null)::int as unresolved
    from legal_authority_citations
  `;

  console.log(
    JSON.stringify(
      {
        ok: true,
        before: before[0],
        after: after[0],
        inserted,
        resolvedNew,
        backfillResolved: backfill.length,
        ambiguous,
        casesScanned: cases.length,
      },
      null,
      2,
    ),
  );
  await sql.end({ timeout: 5 });
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e?.message || e).slice(0, 500) }));
  process.exit(1);
});
