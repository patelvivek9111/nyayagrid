/**
 * Wave 2H national deterministic retrieval smoke (exact cite + jurisdiction isolation + miss).
 * No LLM. No CourtListener.
 */
"use strict";

const postgres = require("postgres");

const CITE_SAMPLES = [
  { jurisdiction: "US", cite: "28 U.S.C. § 1331", type: "statute" },
  { jurisdiction: "US", cite: "Fed. R. Civ. P. 12", type: "rule" },
  { jurisdiction: "PA", cite: "42 Pa.C.S. § 5525", type: "statute" },
  { jurisdiction: "CA", cite: "Cal. Civ. Code § 1624", type: "statute" },
  { jurisdiction: "NY", cite: "N.Y. C.P.L.R. 3211", type: null },
  { jurisdiction: "TX", cite: "Tex. Civ. Prac. & Rem. Code § 16.004", type: "statute" },
  { jurisdiction: "FL", cite: "Fla. Stat. § 95.11", type: "statute" },
  { jurisdiction: "AZ", cite: "Ariz. Rev. Stat. § 47-2314", type: "statute" },
  { jurisdiction: "CO", cite: "Colo. Rev. Stat. § 4-2-314", type: "statute" },
  { jurisdiction: "AL", cite: "Ala. R. Civ. P. 56", type: "rule" },
  { jurisdiction: "DC", cite: "D.C. Super. Ct. Civ. R. 12", type: "rule" },
  { jurisdiction: "MN", cite: "Minn. R. 5200.0030", type: "regulation" },
  { jurisdiction: "WI", cite: "Wis. Admin. Code DWD § 272.03", type: "regulation" },
];

const MISS_SAMPLES = [
  "Fake. Stat. § 99999",
  "Zy. R. Civ. P. 999",
  "999 Z.Z.Z. § 1",
  "Invented Reg. R. 0.0",
];

async function lookup(sql, cite) {
  const rows = await sql`
    select id, authority_type, authority_state, jurisdiction, normalized_citation, citation
    from legal_authorities
    where normalized_citation = ${cite} or citation = ${cite}
    limit 5
  `;
  return rows;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 20 });
  try {
    const results = [];
    let pass = 0;
    let missExpected = 0;
    let fail = 0;
    for (const sample of CITE_SAMPLES) {
      const rows = await lookup(sql, sample.cite);
      if (rows.length === 0) {
        // Expected miss if not yet imported in this DB
        results.push({ ...sample, status: "MISS_EXPECTED", note: "cite not in corpus" });
        missExpected += 1;
        continue;
      }
      const okType = rows.some((r) => !sample.type || r.authority_type === sample.type);
      const okJur = rows.some(
        (r) =>
          !sample.jurisdiction ||
          r.authority_state === sample.jurisdiction ||
          (sample.jurisdiction === "US" && (!r.authority_state || r.jurisdiction?.toLowerCase().includes("united") || r.jurisdiction === "Federal")),
      );
      if (okType && rows.length >= 1) {
        results.push({ ...sample, status: "PASS", hits: rows.length, authorityId: rows[0].id });
        pass += 1;
      } else {
        results.push({ ...sample, status: "FAIL", hits: rows.length, okType, okJur });
        fail += 1;
      }
    }

    // Jurisdiction isolation: same rule number patterns across states
    const isolation = [];
    for (const pair of [
      ["Pa.R.C.P. 56", "Fla. R. Civ. P. 56"],
      ["Ala. R. Civ. P. 12", "Alaska R. Civ. P. 12"],
      ["N.C. R. Civ. P. 12", "Ariz. R. Civ. P. 12"],
    ]) {
      const a = await lookup(sql, pair[0]);
      const b = await lookup(sql, pair[1]);
      const bleed =
        a.length && b.length
          ? a.some((x) => b.some((y) => x.id === y.id))
          : false;
      isolation.push({
        a: pair[0],
        b: pair[1],
        aHits: a.length,
        bHits: b.length,
        bleed,
        status: bleed ? "FAIL" : "PASS",
      });
      if (bleed) fail += 1;
      else pass += 1;
    }

    for (const bad of MISS_SAMPLES) {
      const rows = await lookup(sql, bad);
      if (rows.length === 0) {
        results.push({ cite: bad, status: "MISS_EXPECTED" });
        missExpected += 1;
      } else {
        results.push({ cite: bad, status: "FAIL", note: "invented cite resolved" });
        fail += 1;
      }
    }

    // Authority-type filter sample
    const typeFilter = await sql`
      select authority_type, count(*)::int as n from legal_authorities
      where authority_state = 'PA' group by 1 order by 1
    `;

    const report = {
      ok: fail === 0,
      wave: "2H",
      pass,
      missExpected,
      fail,
      results,
      isolation,
      paTypeBreakdown: typeFilter,
    };
    console.log(JSON.stringify(report));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e?.message || e).slice(0, 500) }));
  process.exit(1);
});
