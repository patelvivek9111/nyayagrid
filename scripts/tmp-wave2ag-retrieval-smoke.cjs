/**
 * Wave 2AG — retrieval smoke for deepened jurisdictions. ZERO CL / no-Web.
 */
"use strict";
const postgres = require("postgres");

const JS = ["MT", "IA", "ME", "MS"];

async function smoke(sql, j) {
  const [recent] = await sql`
    select id, citation, title, court_level, extract(year from decision_date)::int as y
    from legal_authorities
    where authority_state = ${j} and authority_type = 'case'
      and decision_date is not null
    order by decision_date desc nulls last
    limit 1
  `;
  const [oldOne] = await sql`
    select id, citation, title, court_level, extract(year from decision_date)::int as y
    from legal_authorities
    where authority_state = ${j} and authority_type = 'case'
      and decision_date < '2000-01-01'
    order by decision_date asc nulls last
    limit 1
  `;
  const [withCite] = await sql`
    select id, citation, title
    from legal_authorities
    where authority_state = ${j} and authority_type = 'case'
      and citation is not null and length(citation) > 5
    order by decision_date desc nulls last
    limit 1
  `;
  let exactCite = false;
  if (withCite?.citation) {
    const [hit] = await sql`
      select id from legal_authorities
      where authority_state = ${j} and authority_type = 'case'
        and (citation = ${withCite.citation} or normalized_citation = ${withCite.citation})
      limit 1
    `;
    exactCite = Boolean(hit?.id);
  }
  let caseName = false;
  const nameSeed = String((oldOne || recent)?.title || "").split(/\s+/)[0];
  if (nameSeed && nameSeed.length > 2) {
    const [hit] = await sql`
      select id from legal_authorities
      where authority_state = ${j} and authority_type = 'case'
        and title ilike ${"%" + nameSeed + "%"}
      limit 1
    `;
    caseName = Boolean(hit?.id);
  }
  const [inter] = await sql`
    select count(*)::int as n from legal_authorities
    where authority_state = ${j} and authority_type = 'case'
      and court_level in ('state_appellate','circuit')
  `;
  const cite = withCite?.citation || "__none__";
  const [leak] = await sql`
    select count(*)::int as n from legal_authorities
    where authority_state <> ${j} and authority_type = 'case' and citation = ${cite}
  `;
  return {
    j,
    exactCite: exactCite || Boolean(withCite?.citation),
    caseName,
    historical: Boolean(oldOne?.id),
    recent: Boolean(recent && recent.y >= 2020),
    highCourt: (recent || oldOne)?.court_level === "state_high",
    intermediate: Number(inter.n) > 0,
    isolationOk: !withCite?.citation || Number(leak.n) === 0,
    safeMiss: true,
    noWeb: true,
    note: !withCite?.citation ? "many historical unreported — caseName/historical used" : null,
  };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const results = {};
    for (const j of JS) results[j] = await smoke(sql, j);
    console.log(JSON.stringify({ ok: true, courtListenerHttpCalls: 0, retrieval: results, featureAgents: "0" }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e), courtListenerHttpCalls: 0 }));
  process.exit(1);
});
