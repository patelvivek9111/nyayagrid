/**
 * Wave 2K regulation retrieval: exact-cite per reg jurisdiction + isolation + misses.
 */
"use strict";

const postgres = require("postgres");

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
    const states = await sql`
      select distinct authority_state as st
      from legal_authorities
      where authority_type = 'regulation' and authority_state is not null
      order by 1
    `;
    let pass = 0;
    let fail = 0;
    let expectedMiss = 0;
    const exact = [];
    const subject = [];

    for (const { st } of states) {
      const sample = await sql`
        select citation, normalized_citation, authority_type, id
        from legal_authorities
        where authority_state = ${st} and authority_type = 'regulation'
          and citation is not null and btrim(citation) <> ''
        order by created_at
        limit 1
      `;
      if (!sample.length) {
        exact.push({ jurisdiction: st, status: "EXPECTED_MISS" });
        expectedMiss += 1;
        continue;
      }
      const cite = sample[0].normalized_citation || sample[0].citation;
      const rows = await lookup(sql, cite);
      const ok =
        rows.length > 0 &&
        rows.every((r) => r.authority_type === "regulation" && r.authority_state === st);
      exact.push({ jurisdiction: st, cite, status: ok ? "PASS" : "FAIL", hits: rows.length });
      if (ok) pass += 1;
      else fail += 1;

      const typed = await sql`
        select id, citation from legal_authorities
        where authority_state = ${st} and authority_type = 'regulation'
        order by created_at desc limit 1
      `;
      if (typed.length) {
        const hits = await sql`
          select id, authority_type, authority_state from legal_authorities
          where authority_type = 'regulation'
            and (citation = ${typed[0].citation} or normalized_citation = ${typed[0].citation})
          limit 10
        `;
        const subOk = hits.length > 0 && hits.every((h) => h.authority_state === st);
        subject.push({ jurisdiction: st, status: subOk ? "PASS" : "FAIL" });
        if (subOk) pass += 1;
        else fail += 1;
      }
    }

    const isolationPairs = [
      ["NY", "CT"],
      ["TX", "PA"],
      ["MA", "RI"],
      ["AZ", "WV"],
    ];
    const isolation = [];
    for (const [a, b] of isolationPairs) {
      const aRow = await sql`
        select normalized_citation, citation from legal_authorities
        where authority_state = ${a} and authority_type = 'regulation' limit 1
      `;
      const bRow = await sql`
        select normalized_citation, citation from legal_authorities
        where authority_state = ${b} and authority_type = 'regulation' limit 1
      `;
      if (!aRow.length || !bRow.length) {
        isolation.push({ a, b, status: "SKIP" });
        continue;
      }
      const aCite = aRow[0].normalized_citation || aRow[0].citation;
      const bCite = bRow[0].normalized_citation || bRow[0].citation;
      const aHits = await sql`
        select authority_state from legal_authorities
        where (normalized_citation = ${aCite} or citation = ${aCite}) and authority_type = 'regulation'
      `;
      const bHits = await sql`
        select authority_state from legal_authorities
        where (normalized_citation = ${bCite} or citation = ${bCite}) and authority_type = 'regulation'
      `;
      const bleed =
        aHits.some((h) => h.authority_state === b) || bHits.some((h) => h.authority_state === a);
      isolation.push({
        a,
        b,
        aCite,
        bCite,
        bleed,
        status: bleed ? "FAIL" : "PASS",
      });
      if (bleed) fail += 1;
      else pass += 1;
    }

    const misses = [
      "Fake Reg. R. 0.0",
      "999 Z.Z.Z. § 1",
      "12 NYCRR § 99999.99",
      "Conn. Agencies Regs. § 99-9999-999",
    ];
    const missResults = [];
    for (const cite of misses) {
      const rows = await lookup(sql, cite);
      const ok = rows.length === 0;
      missResults.push({ cite, status: ok ? "EXPECTED_MISS" : "FAIL" });
      if (ok) expectedMiss += 1;
      else fail += 1;
    }

    process.stdout.write(
      JSON.stringify({
        ok: fail === 0,
        wave: "2K",
        jurisdictionsTested: states.length,
        pass,
        fail,
        expectedMiss,
        exactCite: {
          pass: exact.filter((x) => x.status === "PASS").length,
          fail: exact.filter((x) => x.status === "FAIL").length,
        },
        subject: {
          pass: subject.filter((x) => x.status === "PASS").length,
          fail: subject.filter((x) => x.status === "FAIL").length,
        },
        isolation,
        misses: missResults,
        noWeb: true,
        courtListenerHttpCalls: 0,
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ ok: false, err: String(e && e.message ? e.message : e) }));
  process.exit(1);
});
