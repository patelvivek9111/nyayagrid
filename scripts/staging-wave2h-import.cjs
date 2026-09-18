/**
 * Staging Wave 2H: import statutes + rules + regs bundles (append-only, hash skip).
 * FEATURE_AGENTS=0. No CourtListener.
 */
"use strict";

const { createHash, randomUUID } = require("node:crypto");
const postgres = require("postgres");

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function importBundle(sql, authorities, label) {
  let imported = 0;
  let skipped = 0;
  let newVersion = 0;
  for (const a of authorities) {
    const content = a.content || "";
    const hash = sha256(content);
    const provider = a.sourceProvider || "us-primary-corpus";
    const existing = await sql`
      select id from legal_authorities
      where source_provider = ${provider} and source_external_id = ${a.sourceExternalId}
      limit 1
    `;
    if (existing.length === 0) {
      const id = randomUUID();
      await sql`
        insert into legal_authorities (
          id, authority_type, jurisdiction, court, court_id, authority_state,
          title, citation, normalized_citation, source_provider, source_external_id,
          canonical_source_url, ingestion_status, currentness_status, last_checked_at,
          metadata, created_at, updated_at
        ) values (
          ${id}, ${a.authorityType || "statute"}, ${a.jurisdiction || null}, ${a.court || null},
          ${a.courtId || null}, ${a.authorityState || null}, ${a.title}, ${a.citation || null},
          ${a.normalizedCitation || a.citation || null}, ${provider}, ${a.sourceExternalId},
          ${a.canonicalSourceUrl || null}, 'ready',
          ${a.currentnessStatus || "current_as_of_source_date"}, now(),
          ${sql.json({ ...(a.sourceMetadata || {}), wave: "2H", bundlePracticeAreas: a.bundlePracticeAreas || [] })},
          now(), now()
        )
      `;
      await sql`
        insert into legal_authority_versions (
          authority_id, version_number, content, sha256, valid_from, valid_to, source_provider, source_metadata
        ) values (
          ${id}, 1, ${content}, ${hash}, now(), null, ${provider},
          ${sql.json({ wave: "2H", bundle: label })}
        )
      `;
      imported += 1;
      continue;
    }
    const authId = existing[0].id;
    const latest = await sql`
      select sha256, version_number from legal_authority_versions
      where authority_id = ${authId} order by version_number desc limit 1
    `;
    if (latest[0]?.sha256 === hash) {
      skipped += 1;
      await sql`update legal_authorities set last_checked_at = now() where id = ${authId}`;
      continue;
    }
    await sql`update legal_authority_versions set valid_to = now() where authority_id = ${authId} and valid_to is null`;
    await sql`
      insert into legal_authority_versions (
        authority_id, version_number, content, sha256, valid_from, valid_to, source_provider, source_metadata
      ) values (
        ${authId}, ${(latest[0]?.version_number || 0) + 1}, ${content}, ${hash}, now(), null, ${provider},
        ${sql.json({ wave: "2H", priorSha: latest[0]?.sha256 || null })}
      )
    `;
    newVersion += 1;
  }
  return { imported, skipped, newVersion };
}

async function subjectAudit(sql) {
  const rows = await sql`
    select authority_state as state,
           coalesce(metadata->>'statuteTopic', '') as topic,
           coalesce(metadata->'bundlePracticeAreas', '[]'::jsonb) as areas
    from legal_authorities
    where authority_type = 'statute' and authority_state is not null
  `;
  const TOPIC_TO_FAMILY = {
    statute_of_limitations: "limitations",
    ucc_merchantability: "contracts_commercial",
    implied_warranty: "contracts_commercial",
    director_duties: "corporations_business",
    wage_payment: "employment",
    consumer_protection: "consumer_protection",
    landlord_tenant: "property_landlord_tenant",
    personal_jurisdiction: "civil_procedure_jurisdiction",
    venue: "civil_procedure_jurisdiction",
    evidence_relevance: "evidence",
    data_breach: "privacy_data",
    administrative_procedure: "licensing_admin_procedure",
    professional_licensing: "licensing_admin_procedure",
  };
  const byState = {};
  for (const r of rows) {
    const st = r.state;
    if (!byState[st]) byState[st] = new Set();
    const topic = String(r.topic || "").toLowerCase();
    let fam = TOPIC_TO_FAMILY[topic] || null;
    if (!fam) {
      if (/limit/.test(topic)) fam = "limitations";
      else if (/ucc|warranty|contract|merchant/.test(topic)) fam = "contracts_commercial";
      else if (/corp|director|llc/.test(topic)) fam = "corporations_business";
      else if (/wage|employ|labor/.test(topic)) fam = "employment";
      else if (/consumer/.test(topic)) fam = "consumer_protection";
      else if (/landlord|tenant|property/.test(topic)) fam = "property_landlord_tenant";
      else if (/jurisdict|venue|procedure/.test(topic)) fam = "civil_procedure_jurisdiction";
      else if (/eviden/.test(topic)) fam = "evidence";
      else if (/privacy|breach|data/.test(topic)) fam = "privacy_data";
      else if (/admin|licens/.test(topic)) fam = "licensing_admin_procedure";
    }
    if (fam) byState[st].add(fam);
  }
  const summary = {};
  for (const [st, set] of Object.entries(byState)) {
    summary[st] = { families: [...set].sort(), count: set.size, meets6: set.size >= 6, meets8: set.size >= 8 };
  }
  return summary;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const statutes = require("../packages/research/corpus/bundles/expansion-wave2h-statutes.json");
  const rules = require("../packages/research/corpus/bundles/expansion-wave2h-state-rules.json");
  const regs = require("../packages/research/corpus/bundles/expansion-wave2h-state-regs.json");
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 20 });
  try {
    const before = await sql`
      select
        count(*)::int as total,
        count(*) filter (where authority_type='case')::int as cases,
        count(*) filter (where authority_type='statute')::int as statutes,
        count(*) filter (where authority_type='regulation')::int as regulations,
        count(*) filter (where authority_type='rule')::int as rules,
        count(distinct authority_state) filter (where authority_type='rule' and authority_state is not null)::int as rule_jurs,
        count(distinct authority_state) filter (where authority_type='regulation' and authority_state is not null)::int as reg_jurs
      from legal_authorities
    `;
    const s = await importBundle(sql, statutes, "expansion-wave2h-statutes");
    const r = await importBundle(sql, rules, "expansion-wave2h-state-rules");
    const g = await importBundle(sql, regs, "expansion-wave2h-state-regs");
    const after = await sql`
      select
        count(*)::int as total,
        count(*) filter (where authority_type='case')::int as cases,
        count(*) filter (where authority_type='statute')::int as statutes,
        count(*) filter (where authority_type='regulation')::int as regulations,
        count(*) filter (where authority_type='rule')::int as rules,
        count(distinct authority_state) filter (where authority_type='rule' and authority_state is not null)::int as rule_jurs,
        count(distinct authority_state) filter (where authority_type='regulation' and authority_state is not null)::int as reg_jurs,
        count(*) filter (where normalized_citation is not null and btrim(normalized_citation)<>'')::int as normalized,
        count(*) filter (where last_checked_at is not null)::int as last_checked,
        count(*) filter (where canonical_source_url is not null and btrim(canonical_source_url)<>'')::int as with_url,
        count(*) filter (where currentness_status is not null)::int as with_currentness
      from legal_authorities
    `;
    const currentness = await sql`
      select currentness_status as status, count(*)::int as n
      from legal_authorities group by 1 order by 2 desc
    `;
    const dupes = await sql`
      select normalized_citation, count(*)::int as n
      from legal_authorities
      where normalized_citation is not null and btrim(normalized_citation)<>''
      group by 1 having count(*) > 1
      order by 2 desc limit 25
    `;
    const subjects = await subjectAudit(sql);
    const thin = ["AZ","CO","CT","GA","LA","MD","MI","NC","OH","WA","WI"];
    const wave1 = ["CA","DE","FL","IL","MA","NJ","NY","PA","TX","VA"];
    const report = {
      ok: true,
      wave: "2H",
      before: before[0],
      after: after[0],
      import: { statutes: s, rules: r, regulations: g },
      currentness,
      duplicateNormalizedCitations: dupes,
      thinSubjects: Object.fromEntries(thin.map((st) => [st, subjects[st] || { families: [], count: 0 }])),
      wave1Subjects: Object.fromEntries(wave1.map((st) => [st, subjects[st] || { families: [], count: 0 }])),
      meets6Count: Object.values(subjects).filter((x) => x.meets6).length,
      meets8Count: Object.values(subjects).filter((x) => x.meets8).length,
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
