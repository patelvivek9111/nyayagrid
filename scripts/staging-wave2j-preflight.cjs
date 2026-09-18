/**
 * Wave 2J preflight: list statute subject/count floors from staging DB.
 */
"use strict";
const postgres = require("postgres");

const FAMILIES = [
  "limitations","contracts_commercial","corporations_business","employment","consumer_protection",
  "property_landlord_tenant","civil_procedure_jurisdiction","evidence","privacy_data","licensing_admin_procedure",
];

function fam(topic, areas, citation, title) {
  const blob = `${topic || ""} ${(areas || []).join(" ")} ${citation || ""} ${title || ""}`.toLowerCase();
  if (/limit|5525|95\.11/.test(blob)) return "limitations";
  if (/ucc|warranty|contract|merchant|commercial/.test(blob)) return "contracts_commercial";
  if (/corp|director|llc|shareholder|dgcl|entity/.test(blob)) return "corporations_business";
  if (/wage|employ|overtime|labor|unemploy|minimum.?wage/.test(blob)) return "employment";
  if (/consumer|deceptive|unfair.?trade|udtpa|1345|fraud.?act/.test(blob)) return "consumer_protection";
  if (/landlord|tenant|lease|evict|property|habitab/.test(blob)) return "property_landlord_tenant";
  if (/admin|licensing|apa\b|administrative/.test(blob)) return "licensing_admin_procedure";
  if (/jurisdict|venue|long.?arm|plead|dismiss|negligen|fault/.test(blob)) return "civil_procedure_jurisdiction";
  if (/\bprocedure\b/.test(blob) && !/admin/.test(blob)) return "civil_procedure_jurisdiction";
  if (/eviden|hearsay|witness|competenc|relevance/.test(blob)) return "evidence";
  if (/privacy|breach|personal.?info|data.?secur|shield/.test(blob)) return "privacy_data";
  return null;
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 20 });
  try {
    const rows = await sql`
      select authority_state as state, citation, title,
             coalesce(metadata->>'statuteTopic','') as topic,
             coalesce(metadata->'bundlePracticeAreas','[]'::jsonb) as areas
      from legal_authorities where authority_type='statute' and authority_state is not null
    `;
    const by = {};
    for (const r of rows) {
      if (!by[r.state]) by[r.state] = { n: 0, fams: new Set() };
      by[r.state].n += 1;
      let areas = r.areas;
      if (typeof areas === "string") { try { areas = JSON.parse(areas); } catch { areas = []; } }
      const f = fam(r.topic, areas, r.citation, r.title);
      if (f) by[r.state].fams.add(f);
    }
    const STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];
    const report = {};
    let below6 = [], below15 = [], ge6 = 0, ge8 = 0, ge15 = 0;
    for (const st of STATES) {
      const x = by[st] || { n: 0, fams: new Set() };
      const subjects = [...x.fams].sort();
      const missing = FAMILIES.filter((f) => !x.fams.has(f));
      report[st] = { statutes: x.n, subjects: subjects.length, subjectList: subjects, missing };
      if (subjects.length >= 6) ge6 += 1; else below6.push(st);
      if (subjects.length >= 8) ge8 += 1;
      if (x.n >= 15) ge15 += 1; else below15.push(st);
    }
    const currentness = await sql`select currentness_status as s, count(*)::int as n from legal_authorities group by 1`;
    const totals = await sql`select count(*)::int as total, count(*) filter (where last_checked_at is not null)::int as checked, count(*) filter (where authority_type='regulation')::int as regs, count(distinct authority_state) filter (where authority_type='regulation' and authority_state is not null)::int as reg_jurs from legal_authorities`;
    console.log(JSON.stringify({ ok: true, wave: "2J-pre", ge6, ge8, ge15, below6, below15, currentness, totals: totals[0], byState: report }, null, 2));
  } finally { await sql.end({ timeout: 5 }); }
}
main().catch((e) => { console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 500) })); process.exit(1); });
