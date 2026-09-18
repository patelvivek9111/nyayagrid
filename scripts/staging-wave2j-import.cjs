/**
 * Staging Wave 2J: import statute floor + NY/CT regs; alias dupes; currentness touch.
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
          ${sql.json({ ...(a.sourceMetadata || {}), wave: "2J", bundlePracticeAreas: a.bundlePracticeAreas || [] })},
          now(), now()
        )
      `;
      await sql`
        insert into legal_authority_versions (
          authority_id, version_number, content, sha256, valid_from, valid_to, source_provider, source_metadata
        ) values (
          ${id}, 1, ${content}, ${hash}, now(), null, ${provider},
          ${sql.json({ wave: "2J", bundle: label })}
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
        ${sql.json({ wave: "2J", priorSha: latest[0]?.sha256 || null })}
      )
    `;
    await sql`
      update legal_authorities
      set last_checked_at = now(), currentness_status = 'current_as_of_source_date', updated_at = now()
      where id = ${authId}
    `;
    newVersion += 1;
  }
  return { imported, skipped, newVersion };
}

async function aliasExactDupes(sql) {
  const dupes = await sql`
    select normalized_citation, authority_type, array_agg(id order by created_at) as ids
    from legal_authorities
    where normalized_citation is not null and btrim(normalized_citation) <> ''
      and not (metadata ? 'duplicateAliasOf')
    group by 1, 2 having count(*) > 1
  `;
  let n = 0;
  for (const d of dupes) {
    const keep = d.ids[0];
    for (let i = 1; i < d.ids.length; i += 1) {
      await sql`
        update legal_authorities
        set metadata = coalesce(metadata, '{}'::jsonb) || ${sql.json({
          duplicateAliasOf: keep,
          typeCollisionPolicy: "wave2i-v1",
          aliasReason: "exact normalized_citation + type duplicate (wave2j)",
        })},
        updated_at = now()
        where id = ${d.ids[i]}
      `;
      n += 1;
    }
  }
  return n;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const statutes = require("../packages/research/corpus/bundles/expansion-wave2j-statutes.json");
  const regs = require("../packages/research/corpus/bundles/expansion-wave2j-state-regs.json");
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const before = await sql`
      select count(*)::int as total,
        count(*) filter (where authority_type='case')::int as cases,
        count(*) filter (where authority_type='statute')::int as statutes,
        count(*) filter (where authority_type='regulation')::int as regulations,
        count(*) filter (where authority_type='rule')::int as rules,
        count(*) filter (where last_checked_at is not null)::int as last_checked,
        count(*) filter (where currentness_status='unknown')::int as unknown,
        count(*) filter (where currentness_status='current_as_of_source_date')::int as current_src,
        count(*) filter (where normalized_citation is not null and btrim(normalized_citation)<>'')::int as normalized
      from legal_authorities
    `;
    const s = await importBundle(sql, statutes, "expansion-wave2j-statutes");
    const g = await importBundle(sql, regs, "expansion-wave2j-state-regs");
    const aliased = await aliasExactDupes(sql);
    const backfill = await sql`
      update legal_authorities
      set currentness_status = 'current_as_of_source_date',
          last_checked_at = coalesce(last_checked_at, now()),
          updated_at = now()
      where (currentness_status is null or currentness_status = 'unknown')
        and canonical_source_url is not null and btrim(canonical_source_url) <> ''
        and ingestion_status = 'ready'
        and (
          metadata ? 'retrievedAt'
          or metadata->>'wave' in ('2C','2D','2E','2F','2G','2H','2I','2J')
        )
      returning id
    `;
    const after = await sql`
      select count(*)::int as total,
        count(*) filter (where authority_type='case')::int as cases,
        count(*) filter (where authority_type='statute')::int as statutes,
        count(*) filter (where authority_type='regulation')::int as regulations,
        count(*) filter (where authority_type='rule')::int as rules,
        count(distinct authority_state) filter (where authority_type='regulation' and authority_state is not null)::int as reg_jurs,
        count(*) filter (where last_checked_at is not null)::int as last_checked,
        count(*) filter (where currentness_status='unknown')::int as unknown,
        count(*) filter (where currentness_status='current_as_of_source_date')::int as current_src,
        count(*) filter (where normalized_citation is not null and btrim(normalized_citation)<>'')::int as normalized,
        count(*) filter (where metadata ? 'duplicateAliasOf')::int as aliased_rows
      from legal_authorities
    `;
    console.log(JSON.stringify({ ok: true, wave: "2J", before: before[0], after: after[0], import: { statutes: s, regulations: g }, aliased, currentnessBackfill: backfill.length }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e?.message || e).slice(0, 800) }));
  process.exit(1);
});
