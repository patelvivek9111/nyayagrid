/**
 * Staging Wave 2H subject-depth + provenance audit (stdout JSON only).
 */
"use strict";

const postgres = require("postgres");

const FAMILIES = [
  "limitations",
  "contracts_commercial",
  "corporations_business",
  "employment",
  "consumer_protection",
  "property_landlord_tenant",
  "civil_procedure_jurisdiction",
  "evidence",
  "privacy_data",
  "licensing_admin_procedure",
];

function classify(topic, areas, citation, title) {
  const t = String(topic || "").toLowerCase().replace(/\s+/g, "_");
  const blob = `${t} ${(areas || []).join(" ")} ${citation || ""} ${title || ""}`.toLowerCase();
  if (/limit|5525|95\.11|16\.004/.test(blob)) return "limitations";
  if (/ucc|warranty|contract|merchant|commercial|1624/.test(blob)) return "contracts_commercial";
  if (/corp|director|llc|shareholder|dgcl|entity/.test(blob)) return "corporations_business";
  if (/wage|employ|overtime|labor|unemploy|minimum.?wage/.test(blob)) return "employment";
  if (/consumer|deceptive|unfair.?trade|udtpa|75-1\.1|1345/.test(blob)) return "consumer_protection";
  if (/landlord|tenant|lease|evict|property|real.?prop|habitab/.test(blob)) return "property_landlord_tenant";
  if (/jurisdict|venue|long.?arm|plead|dismiss|procedure|negligen|fault/.test(blob)) {
    return "civil_procedure_jurisdiction";
  }
  if (/eviden|hearsay|witness|competenc/.test(blob)) return "evidence";
  if (/privacy|breach|personal.?info|data.?secur|shield/.test(blob)) return "privacy_data";
  if (/admin.?proc|licensing|apa|11500|professional.?licens/.test(blob)) return "licensing_admin_procedure";
  return null;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 20 });
  try {
    const rows = await sql`
      select authority_state as state, citation, title,
             coalesce(metadata->>'statuteTopic','') as topic,
             coalesce(metadata->'bundlePracticeAreas','[]'::jsonb) as areas,
             canonical_source_url, source_provider, source_external_id, currentness_status, last_checked_at
      from legal_authorities
      where authority_type='statute' and authority_state is not null
    `;
    const byState = {};
    for (const r of rows) {
      if (!byState[r.state]) byState[r.state] = new Set();
      let areas = r.areas;
      if (typeof areas === "string") {
        try {
          areas = JSON.parse(areas);
        } catch {
          areas = [];
        }
      }
      const fam = classify(r.topic, areas, r.citation, r.title);
      if (fam) byState[r.state].add(fam);
    }
    const thin = ["AZ","CO","CT","GA","LA","MD","MI","NC","OH","WA","WI"];
    const wave1 = ["CA","DE","FL","IL","MA","NJ","NY","PA","TX","VA"];
    const summary = {};
    for (const [st, set] of Object.entries(byState)) {
      summary[st] = {
        families: [...set].sort(),
        count: set.size,
        meets6: set.size >= 6,
        meets8: set.size >= 8,
      };
    }
    const provenance = await sql`
      select
        count(*)::int as total,
        count(*) filter (where canonical_source_url is not null and btrim(canonical_source_url)<>'')::int as with_url,
        count(*) filter (where source_provider is not null)::int as with_provider,
        count(*) filter (where source_external_id is not null)::int as with_ext_id,
        count(*) filter (where authority_type is not null)::int as with_type,
        count(*) filter (where jurisdiction is not null or authority_state is not null)::int as with_jur
      from legal_authorities
    `;
    const missingProv = await sql`
      select count(*)::int as n from legal_authorities
      where canonical_source_url is null or btrim(canonical_source_url)=''
         or source_provider is null or source_external_id is null
    `;
    const ruleJurs = await sql`
      select authority_state as state, count(*)::int as n
      from legal_authorities where authority_type='rule' and authority_state is not null
      group by 1 order by 1
    `;
    const regJurs = await sql`
      select authority_state as state, count(*)::int as n
      from legal_authorities where authority_type='regulation' and authority_state is not null
      group by 1 order by 1
    `;
    const ny = await sql`
      select authority_type, citation, normalized_citation from legal_authorities
      where citation ilike '%3211%' or normalized_citation ilike '%3211%' limit 5
    `;
    console.log(
      JSON.stringify({
        ok: true,
        wave: "2H",
        meets6Count: Object.values(summary).filter((x) => x.meets6).length,
        meets8Count: Object.values(summary).filter((x) => x.meets8).length,
        thinSubjects: Object.fromEntries(thin.map((st) => [st, summary[st] || { families: [], count: 0 }])),
        wave1Subjects: Object.fromEntries(wave1.map((st) => [st, summary[st] || { families: [], count: 0 }])),
        thinBelow6: thin.filter((st) => !(summary[st]?.meets6)),
        provenance: provenance[0],
        missingProvenance: missingProv[0]?.n ?? 0,
        ruleJurisdictions: ruleJurs.length,
        regulationJurisdictions: regJurs.length,
        ruleStates: ruleJurs.map((r) => r.state),
        regStates: regJurs.map((r) => r.state),
        ny3211: ny,
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
