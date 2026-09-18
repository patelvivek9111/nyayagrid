/**
 * Wave 2F targeted retrieval smoke (staging SQL). Exact citation matches only.
 */
"use strict";

const postgres = require("postgres");
const { citationLookupAliases, leanNormalizeCitation } = require("./wave2f-citation-audit.cjs");

async function lookup(sql, cite) {
  const lean = leanNormalizeCitation(cite) || cite;
  const aliases = citationLookupAliases(lean);
  const rows = await sql`
    select id, citation, normalized_citation, authority_type::text as authority_type,
           authority_state, jurisdiction, canonical_source_url, currentness_status
    from legal_authorities
    where normalized_citation = any(${aliases})
       or citation = any(${aliases})
    limit 3
  `;
  return {
    query: cite,
    lean,
    hitCount: rows.length,
    ambiguous: rows.length > 1,
    hit: rows.length === 1
      ? {
          citation: rows[0].citation,
          normalized: rows[0].normalized_citation,
          type: rows[0].authority_type,
          state: rows[0].authority_state,
          hasCanonicalUrl: Boolean(rows[0].canonical_source_url),
          currentness: rows[0].currentness_status,
        }
      : null,
    miss: rows.length === 0,
  };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const sql = postgres(url, { max: 1, ssl: "require" });

  try {
    const federal = [
      await lookup(sql, "28 U.S.C. § 1331"),
      await lookup(sql, "29 C.F.R. § 541.300"),
      await lookup(sql, "Fed. R. Civ. P. 56"),
    ];
    const statutes = [
      await lookup(sql, "42 Pa.C.S. § 5525"),
      await lookup(sql, "N.Y. C.P.L.R. 3212"),
      await lookup(sql, "Cal. Civ. Code § 1624"),
      await lookup(sql, "Tex. Bus. & Com. Code § 2.201"),
      await lookup(sql, "N.J.S.A. 2A:14-1"),
    ];
    const regulations = [
      await lookup(sql, "34 Pa. Code § 231.1"),
      await lookup(sql, "Fla. Admin. Code R. 61J2-3.008"),
      await lookup(sql, "16 Tex. Admin. Code § 3.30"),
      await lookup(sql, "Ohio Adm.Code 4141-1-01"),
    ];
    const rules = [
      await lookup(sql, "Pa.R.C.P. 1007"),
      await lookup(sql, "Cal. Rules of Court, rule 3.110"),
      await lookup(sql, "Tex. R. Civ. P. 166a"),
      await lookup(sql, "Ohio Civ.R. 56"),
      await lookup(sql, "Wash. CR 12"),
    ];
    const cases = [
      await lookup(sql, "304 U.S. 64"),
      await lookup(sql, "304 U. S. 64"),
      await lookup(sql, "550 U.S. 544"),
    ];
    const miss = [
      await lookup(sql, "999 U.S. 99999"),
      await lookup(sql, "99 ZZZ Code § 1"),
    ];

    const coverage = await sql`
      select
        count(*)::int as total,
        count(*) filter (where authority_type='case')::int as cases,
        count(*) filter (where authority_type='statute')::int as statutes,
        count(*) filter (where authority_type='regulation')::int as regulations,
        count(*) filter (where authority_type='rule')::int as rules,
        count(*) filter (where normalized_citation is not null and btrim(normalized_citation)<>'')::int as normalized,
        count(distinct authority_state) filter (where authority_type='regulation' and authority_state is not null)::int as reg_jurs,
        count(distinct authority_state) filter (where authority_type='rule' and authority_state is not null)::int as rule_jurs
      from legal_authorities
    `;
    const cites = await sql`
      select
        count(*)::int as extracted,
        count(*) filter (where to_authority_id is not null)::int as resolved,
        count(*) filter (where to_authority_id is null)::int as unresolved
      from legal_authority_citations
    `;

    const pass =
      federal.every((r) => r.hitCount === 1) &&
      miss.every((r) => r.miss) &&
      cases.filter((r) => r.query.includes("304")).every((r) => r.hitCount === 1);

    console.log(
      JSON.stringify({
        ok: true,
        wave: "2F",
        featureAgents: process.env.FEATURE_AGENTS ?? null,
        pass,
        federal,
        statutes,
        regulations,
        rules,
        cases,
        miss,
        coverage: coverage[0],
        citationGraph: cites[0],
        notes: [
          "Exact normalized/alias lookup only.",
          "No Web; no CourtListener.",
          "Miss queries must remain unresolved.",
        ],
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e?.message || e).slice(0, 400) }));
  process.exit(1);
});
