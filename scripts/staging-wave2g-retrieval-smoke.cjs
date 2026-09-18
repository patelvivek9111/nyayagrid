/**
 * Wave 2G retrieval + coverage smoke on staging.
 */
"use strict";

const postgres = require("postgres");

async function lookup(sql, cite) {
  const rows = await sql`
    select citation, normalized_citation, authority_type::text as t, authority_state,
           canonical_source_url is not null as has_url, currentness_status
    from legal_authorities
    where citation = ${cite} or normalized_citation = ${cite}
    limit 3
  `;
  return { query: cite, hitCount: rows.length, hit: rows[0] || null, miss: rows.length === 0 };
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require" });
  try {
    const wave1 = {};
    for (const [st, cite] of [
      ["CA", "Cal. Civ. Code § 1946.1"],
      ["DE", "6 Del. C. § 2513"],
      ["FL", "Fla. Stat. § 501.204"],
      ["IL", "815 ILCS 505/2"],
      ["MA", "Mass. Gen. Laws ch. 186, § 12"],
      ["NJ", "N.J. Stat. Ann. § 56:8-2"],
      ["NY", "N.Y. Gen. Bus. Law § 349"],
      ["PA", "73 P.S. § 201-3"],
      ["TX", "Tex. Bus. & Com. Code § 17.46"],
      ["VA", "Va. Code Ann. § 59.1-200"],
    ]) {
      wave1[st] = await lookup(sql, cite);
    }

    const thin = {};
    for (const [st, cite] of [
      ["AL", "Ala. Code § 8-19-5"],
      ["AK", "Alaska Stat. § 45.50.471"],
      ["ID", "Idaho Code § 48-603"],
      ["IN", "Ind. Code § 24-5-0.5-3"],
      ["MN", "Minn. Stat. § 325F.69"],
      ["MO", "Mo. Rev. Stat. § 407.020"],
      ["NV", "Nev. Rev. Stat. § 598.0915"],
      ["OR", "Or. Rev. Stat. § 646.608"],
      ["TN", "Tenn. Code Ann. § 47-18-104"],
      ["WY", "Wyo. Stat. Ann. § 40-12-105"],
    ]) {
      thin[st] = await lookup(sql, cite);
    }

    const rules = {
      GA: await lookup(sql, "Ga. Unif. Super. Ct. R. 6.5"),
      NC: await lookup(sql, "N.C. R. Civ. P. 56"),
      AZ: await lookup(sql, "Ariz. R. Civ. P. 12"),
      CT: await lookup(sql, "Conn. Practice Book § 17-49"),
      WI: await lookup(sql, "Wis. Stat. § 802.08"),
      IN: await lookup(sql, "Ind. Trial R. 56"),
      MN: await lookup(sql, "Minn. R. Civ. P. 56"),
      OR: await lookup(sql, "Or. R. Civ. P. 47"),
    };

    const miss = [
      await lookup(sql, "99 Fake Code § 1"),
      await lookup(sql, "ZZ. R. Civ. P. 999"),
    ];

    const coverage = await sql`
      select
        count(*)::int as total,
        count(*) filter (where authority_type='statute')::int as statutes,
        count(*) filter (where authority_type='regulation')::int as regulations,
        count(*) filter (where authority_type='rule')::int as rules,
        count(*) filter (where authority_type='case')::int as cases,
        count(distinct authority_state) filter (where authority_type='rule' and authority_state is not null)::int as rule_jurs
      from legal_authorities
    `;

    const pass =
      Object.values(wave1).every((r) => r.hitCount === 1) &&
      Object.values(thin).every((r) => r.hitCount === 1) &&
      Object.values(rules).every((r) => r.hitCount === 1) &&
      miss.every((r) => r.miss);

    console.log(
      JSON.stringify({
        ok: true,
        wave: "2G",
        featureAgents: process.env.FEATURE_AGENTS ?? null,
        pass,
        wave1,
        thinSample: thin,
        rules,
        miss,
        coverage: coverage[0],
        notes: ["Exact citation lookup only", "No Web", "No CourtListener"],
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
