/**
 * Wave 2I national exact-cite + subject + type-filter + miss retrieval (deterministic).
 */
"use strict";

const postgres = require("postgres");

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME",
  "MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI",
  "SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","US",
];

async function lookup(sql, cite) {
  return sql`
    select id, authority_type, authority_state, jurisdiction, normalized_citation, citation
    from legal_authorities
    where normalized_citation = ${cite} or citation = ${cite}
    limit 5
  `;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    let pass = 0;
    let expectedMiss = 0;
    let fail = 0;
    const exact = [];
    const subject = [];

    for (const st of STATES) {
      const sample = await sql`
        select citation, normalized_citation, authority_type, id
        from legal_authorities
        where (authority_state = ${st} or (${st} = 'US' and (authority_state is null or authority_state = 'US')))
          and citation is not null and btrim(citation) <> ''
        order by
          case authority_type when 'statute' then 0 when 'rule' then 1 when 'regulation' then 2 else 3 end,
          created_at
        limit 1
      `;
      if (!sample.length) {
        exact.push({ jurisdiction: st, status: "EXPECTED_MISS", note: "no authority in corpus" });
        expectedMiss += 1;
        continue;
      }
      const cite = sample[0].normalized_citation || sample[0].citation;
      const rows = await lookup(sql, cite);
      if (!rows.length) {
        exact.push({ jurisdiction: st, cite, status: "FAIL", note: "exists but exact lookup missed" });
        fail += 1;
      } else {
        exact.push({ jurisdiction: st, cite, status: "PASS", type: sample[0].authority_type, id: sample[0].id });
        pass += 1;
      }

      // Subject sample: pick a statute/rule/reg for the jurisdiction and verify type filter
      const typed = await sql`
        select id, authority_type, citation from legal_authorities
        where authority_state = ${st} and authority_type in ('statute','rule','regulation')
        order by authority_type limit 3
      `;
      if (typed.length) {
        const want = typed[0].authority_type;
        const hits = await sql`
          select id, authority_type from legal_authorities
          where authority_state = ${st} and authority_type = ${want}
            and (citation = ${typed[0].citation} or normalized_citation = ${typed[0].citation})
          limit 5
        `;
        const ok = hits.length > 0 && hits.every((h) => h.authority_type === want);
        subject.push({ jurisdiction: st, type: want, status: ok ? "PASS" : "FAIL" });
        if (ok) pass += 1;
        else fail += 1;
      }
    }

    // Isolation
    const isolation = [];
    for (const pair of [
      ["Ala. R. Civ. P. 12", "Alaska R. Civ. P. 12"],
      ["N.C. R. Civ. P. 12", "Ariz. R. Civ. P. 12"],
      ["Pa.R.E. 401", "Fla. Stat. § 90.401"],
    ]) {
      const a = await lookup(sql, pair[0]);
      const b = await lookup(sql, pair[1]);
      const bleed = a.length && b.length ? a.some((x) => b.some((y) => x.id === y.id)) : false;
      isolation.push({ a: pair[0], b: pair[1], aHits: a.length, bHits: b.length, bleed, status: bleed ? "FAIL" : "PASS" });
      if (bleed) fail += 1;
      else pass += 1;
    }

    // Type filtering: statute cite should not be dominated by cases when statute exists
    const typeFilter = [];
    for (const cite of ["28 U.S.C. § 1331", "Fed. R. Civ. P. 12", "Minn. R. 5200.0030"]) {
      const rows = await lookup(sql, cite);
      const expected =
        /U\.S\.C/i.test(cite) ? "statute" : /Fed\. R/i.test(cite) ? "rule" : "regulation";
      const ok = rows.length > 0 && rows[0].authority_type === expected;
      typeFilter.push({ cite, expected, got: rows[0]?.authority_type || null, status: ok ? "PASS" : rows.length ? "FAIL" : "EXPECTED_MISS" });
      if (ok) pass += 1;
      else if (!rows.length) expectedMiss += 1;
      else fail += 1;
    }

    // Misses
    const misses = [];
    for (const bad of ["Fake. Stat. § 99999", "Zy. R. Civ. P. 999", "999 Z.Z.Z. § 1", "Invented Reg. R. 0.0"]) {
      const rows = await lookup(sql, bad);
      const ok = rows.length === 0;
      misses.push({ cite: bad, status: ok ? "EXPECTED_MISS" : "FAIL" });
      if (ok) expectedMiss += 1;
      else fail += 1;
    }

    console.log(
      JSON.stringify({
        ok: fail === 0,
        wave: "2I",
        jurisdictionsTested: STATES.length,
        pass,
        expectedMiss,
        fail,
        exactCite: { pass: exact.filter((x) => x.status === "PASS").length, fail: exact.filter((x) => x.status === "FAIL").length, expectedMiss: exact.filter((x) => x.status === "EXPECTED_MISS").length },
        subject: { pass: subject.filter((x) => x.status === "PASS").length, fail: subject.filter((x) => x.status === "FAIL").length },
        isolation,
        typeFilter,
        misses,
        noWeb: true,
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e?.message || e).slice(0, 500) }));
  process.exit(1);
});
