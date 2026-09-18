/**
 * Staging Wave 2G: import statutes + rules bundles (append-only).
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
          ${sql.json({ ...(a.sourceMetadata || {}), wave: "2G", bundlePracticeAreas: a.bundlePracticeAreas || [] })},
          now(), now()
        )
      `;
      await sql`
        insert into legal_authority_versions (
          authority_id, version_number, content, sha256, valid_from, valid_to, source_provider, source_metadata
        ) values (
          ${id}, 1, ${content}, ${hash}, now(), null, ${provider},
          ${sql.json({ wave: "2G", bundle: label })}
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
        ${sql.json({ wave: "2G", priorSha: latest[0]?.sha256 || null })}
      )
    `;
    newVersion += 1;
  }
  return { imported, skipped, newVersion };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const statutes = require("../packages/research/corpus/bundles/expansion-wave2g-statutes.json");
  const rules = require("../packages/research/corpus/bundles/expansion-wave2g-state-rules.json");
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 20 });
  try {
    const s = await importBundle(sql, statutes, "expansion-wave2g-statutes");
    const r = await importBundle(sql, rules, "expansion-wave2g-state-rules");
    const counts = await sql`
      select
        count(*)::int as total,
        count(*) filter (where authority_type='case')::int as cases,
        count(*) filter (where authority_type='statute')::int as statutes,
        count(*) filter (where authority_type='regulation')::int as regulations,
        count(*) filter (where authority_type='rule')::int as rules,
        count(distinct authority_state) filter (where authority_type='rule' and authority_state is not null)::int as rule_jurs,
        count(distinct authority_state) filter (where authority_type='regulation' and authority_state is not null)::int as reg_jurs,
        count(*) filter (where normalized_citation is not null and btrim(normalized_citation)<>'')::int as normalized,
        count(*) filter (where last_checked_at is not null)::int as last_checked
      from legal_authorities
    `;
    console.log(JSON.stringify({ ok: true, wave: "2G", statutes: s, rules: r, corpus: counts[0] }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e?.message || e).slice(0, 500) }));
  process.exit(1);
});
