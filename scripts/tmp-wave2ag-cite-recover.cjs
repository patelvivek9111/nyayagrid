/**
 * Wave 2AG — Non-CL citation TARGET_ABSENT recovery.
 * 1) Soft-normalize reporter/USC/CFR variants and resolve unique corpus matches
 * 2) Deepen extract USC/CFR/Fed.R from recent case chunks and link exact matches
 * ZERO CourtListener HTTP. Never fabricate authority metadata.
 */
"use strict";
const postgres = require("postgres");

function softNorm(s) {
  if (!s) return null;
  return String(s)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\bU\.\s*S\.\b/gi, "U.S.")
    .replace(/\bF\.\s*(\d)d\b/gi, "F.$1d")
    .replace(/\bF\.\s*Supp\.\s*(\d)?\b/gi, (_, n) => (n ? `F. Supp. ${n}` : "F. Supp."))
    .replace(/\bC\.\s*F\.\s*R\.\b/gi, "C.F.R.")
    .replace(/\bU\.\s*S\.\s*C\.\b/gi, "U.S.C.")
    .replace(/\s*§+\s*/g, " § ")
    .trim();
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const [before] = await sql`
      select
        count(*)::int as extracted,
        count(*) filter (where to_authority_id is not null)::int as resolved,
        count(*) filter (where to_authority_id is null)::int as target_absent
      from legal_authority_citations
    `;

    // Soft-normalize unresolved edges in-place when normalized_citation empty or spaced variants
    await sql`
      update legal_authority_citations
      set normalized_citation = regexp_replace(
            regexp_replace(
              regexp_replace(coalesce(normalized_citation, raw_citation), '\\s+', ' ', 'g'),
              'U\\.\\s*S\\.', 'U.S.', 'gi'
            ),
            'F\\.\\s*([0-9])d', 'F.\\1d', 'gi'
          )
      where to_authority_id is null
        and coalesce(normalized_citation, raw_citation) is not null
    `;

    const resolvedSoft = await sql`
      with candidates as (
        select e.id as edge_id, a.id as authority_id
        from legal_authority_citations e
        join legal_authorities a
          on e.to_authority_id is null
         and e.normalized_citation is not null
         and length(e.normalized_citation) > 4
         and (
           a.normalized_citation = e.normalized_citation
           or a.citation = e.normalized_citation
           or replace(coalesce(a.normalized_citation,''), 'U. S.', 'U.S.') = e.normalized_citation
           or replace(coalesce(a.citation,''), 'U. S.', 'U.S.') = e.normalized_citation
           or replace(coalesce(a.normalized_citation,''), ' CFR ', ' C.F.R. ') = e.normalized_citation
           or replace(coalesce(a.normalized_citation,''), ' C.F.R. ', ' CFR ') = e.normalized_citation
           or replace(coalesce(a.citation,''), ' CFR ', ' C.F.R. ') = e.normalized_citation
           or replace(coalesce(a.citation,''), ' C.F.R. ', ' CFR ') = e.normalized_citation
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

    // Deepen: extract USC/CFR/Fed.R from case version text for still-unresolved families
    const cases = await sql`
      select a.id as authority_id, left(v.content, 12000) as content
      from legal_authorities a
      join legal_authority_versions v on v.authority_id = a.id and v.valid_to is null
      where a.authority_type = 'case'
        and v.content is not null
        and length(v.content) > 200
      order by a.created_at desc nulls last
      limit 400
    `;

    const statuteAuths = await sql`
      select id, citation, normalized_citation
      from legal_authorities
      where authority_type in ('statute','regulation','rule')
        and (normalized_citation is not null or citation is not null)
    `;
    const byNorm = new Map();
    const add = (key, id) => {
      const k = softNorm(key);
      if (!k) return;
      if (!byNorm.has(k)) byNorm.set(k, new Set());
      byNorm.get(k).add(id);
    };
    for (const a of statuteAuths) {
      add(a.normalized_citation, a.id);
      add(a.citation, a.id);
    }
    const resolveOne = (norm) => {
      const k = softNorm(norm);
      const set = byNorm.get(k);
      if (!set || set.size !== 1) return null;
      return [...set][0];
    };

    const PATTERNS = [
      { re: /\b(\d{1,2})\s+U\.?\s?S\.?\s?C\.?\s*§+\s*(\d[\w.\-]*)/gi, norm: (m) => `${m[1]} U.S.C. § ${m[2]}` },
      { re: /\b(\d{1,2})\s+C\.?\s?F\.?\s?R\.?\s*§*\s*(\d+(?:\.\d+)*)/gi, norm: (m) => `${m[1]} C.F.R. § ${m[2]}` },
      {
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

    let edgesInserted = 0;
    let edgesResolvedNew = 0;
    for (const ch of cases) {
      const found = [];
      const seen = new Set();
      for (const p of PATTERNS) {
        const re = new RegExp(p.re.source, "gi");
        let m;
        while ((m = re.exec(ch.content))) {
          const normalized = p.norm(m);
          if (seen.has(normalized)) continue;
          seen.add(normalized);
          found.push({ raw: m[0], normalized });
        }
      }
      for (const f of found) {
        const target = resolveOne(f.normalized);
        const existing = await sql`
          select id, to_authority_id from legal_authority_citations
          where from_authority_id = ${ch.authority_id}
            and (normalized_citation = ${f.normalized} or raw_citation = ${f.raw})
          limit 1
        `;
        if (existing.length === 0) {
          await sql`
            insert into legal_authority_citations (
              id, from_authority_id, to_authority_id, raw_citation, normalized_citation, created_at
            ) values (
              gen_random_uuid(), ${ch.authority_id}, ${target}, ${f.raw}, ${f.normalized}, now()
            )
          `;
          edgesInserted += 1;
          if (target) edgesResolvedNew += 1;
        } else if (!existing[0].to_authority_id && target) {
          await sql`
            update legal_authority_citations
            set to_authority_id = ${target}
            where id = ${existing[0].id}
          `;
          edgesResolvedNew += 1;
        }
      }
    }

    const [after] = await sql`
      select
        count(*)::int as extracted,
        count(*) filter (where to_authority_id is not null)::int as resolved,
        count(*) filter (where to_authority_id is null)::int as target_absent
      from legal_authority_citations
    `;

    const topAbsent = await sql`
      select coalesce(normalized_citation, raw_citation) as cite, count(*)::int as n
      from legal_authority_citations
      where to_authority_id is null
      group by 1
      order by n desc
      limit 15
    `;

    console.log(
      JSON.stringify({
        ok: true,
        wave: "2AG",
        courtListenerHttpCalls: 0,
        before,
        after,
        newlyResolved: Number(after.resolved) - Number(before.resolved),
        softResolved: resolvedSoft.length,
        edgesInserted,
        edgesResolvedNew,
        topAbsent,
        featureAgents: "0",
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e), courtListenerHttpCalls: 0 }));
  process.exit(1);
});
