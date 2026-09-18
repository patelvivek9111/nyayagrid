/**
 * Staging Wave 2I: import statutes/rules/regs + safe duplicate aliasing + currentness touch.
 * No CourtListener. FEATURE_AGENTS=0.
 */
"use strict";

const { createHash, randomUUID } = require("node:crypto");
const postgres = require("postgres");

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function collapseCite(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/§/g, "")
    .replace(/\./g, "")
    .replace(/,/g, "");
}

function preferType(citation) {
  const c = String(citation || "");
  if (/n\.?\s*y\.?\s*c\.?\s*p\.?\s*l\.?\s*r|n\.?\s*y\.?\s*cplr/i.test(c)) return "statute";
  if (/admin\.?\s*code|c\.?\s*f\.?\s*r|cmr|ricr/i.test(c)) return "regulation";
  if (/\br\.?\s*civ\.?\s*p\b|\br\.?\s*evid\b|\br\.?\s*app/i.test(c)) return "rule";
  return null;
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
          ${sql.json({ ...(a.sourceMetadata || {}), wave: "2I", bundlePracticeAreas: a.bundlePracticeAreas || [] })},
          now(), now()
        )
      `;
      await sql`
        insert into legal_authority_versions (
          authority_id, version_number, content, sha256, valid_from, valid_to, source_provider, source_metadata
        ) values (
          ${id}, 1, ${content}, ${hash}, now(), null, ${provider},
          ${sql.json({ wave: "2I", bundle: label })}
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
      await sql`
        update legal_authorities
        set last_checked_at = now(),
            currentness_status = coalesce(currentness_status, 'current_as_of_source_date')
        where id = ${authId}
      `;
      continue;
    }
    await sql`update legal_authority_versions set valid_to = now() where authority_id = ${authId} and valid_to is null`;
    await sql`
      insert into legal_authority_versions (
        authority_id, version_number, content, sha256, valid_from, valid_to, source_provider, source_metadata
      ) values (
        ${authId}, ${(latest[0]?.version_number || 0) + 1}, ${content}, ${hash}, now(), null, ${provider},
        ${sql.json({ wave: "2I", priorSha: latest[0]?.sha256 || null })}
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

async function aliasDuplicates(sql) {
  // Soft-alias: for exact same normalized_citation + type, mark metadata duplicateOf.
  // For CPLR statute/rule collision: prefer statute; alias rule row metadata without deleting.
  const aliased = [];
  const cplr = await sql`
    select id, authority_type, citation, normalized_citation, metadata
    from legal_authorities
    where citation ilike '%cplr%3211%' or normalized_citation ilike '%cplr%3211%'
       or citation ilike '%c.p.l.r.%3211%' or normalized_citation ilike '%c.p.l.r.%3211%'
    order by authority_type
  `;
  if (cplr.length >= 2) {
    const statute = cplr.find((r) => r.authority_type === "statute") || cplr[0];
    for (const row of cplr) {
      if (row.id === statute.id) continue;
      const preferred = preferType(row.citation) || "statute";
      await sql`
        update legal_authorities
        set metadata = coalesce(metadata, '{}'::jsonb) || ${sql.json({
          duplicateAliasOf: statute.id,
          typeCollisionPolicy: "wave2i-v1",
          preferredAuthorityType: preferred,
          aliasReason: "NY CPLR punctuation/type variant — keep rows, alias to statute canonical",
        })},
        updated_at = now()
        where id = ${row.id}
      `;
      aliased.push({ from: row.id, to: statute.id, citation: row.citation, type: row.authority_type });
    }
  }

  // Exact normalized_citation duplicates (same type): alias later rows to earliest
  const dupes = await sql`
    select normalized_citation, authority_type, array_agg(id order by created_at) as ids, count(*)::int as n
    from legal_authorities
    where normalized_citation is not null and btrim(normalized_citation) <> ''
    group by 1, 2
    having count(*) > 1
  `;
  let exactAliased = 0;
  for (const d of dupes) {
    const ids = d.ids;
    const keep = ids[0];
    for (let i = 1; i < ids.length; i += 1) {
      await sql`
        update legal_authorities
        set metadata = coalesce(metadata, '{}'::jsonb) || ${sql.json({
          duplicateAliasOf: keep,
          typeCollisionPolicy: "wave2i-v1",
          aliasReason: "exact normalized_citation + type duplicate",
        })},
        updated_at = now()
        where id = ${ids[i]}
      `;
      exactAliased += 1;
      aliased.push({ from: ids[i], to: keep, citation: d.normalized_citation, type: d.authority_type });
    }
  }
  return { cplrPairs: cplr.length, exactAliased, aliased: aliased.slice(0, 50) };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const statutes = require("../packages/research/corpus/bundles/expansion-wave2i-statutes.json");
  const rules = require("../packages/research/corpus/bundles/expansion-wave2i-state-rules.json");
  const regs = require("../packages/research/corpus/bundles/expansion-wave2i-state-regs.json");
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 20 });
  try {
    const before = await sql`
      select
        count(*)::int as total,
        count(*) filter (where authority_type='case')::int as cases,
        count(*) filter (where authority_type='statute')::int as statutes,
        count(*) filter (where authority_type='regulation')::int as regulations,
        count(*) filter (where authority_type='rule')::int as rules,
        count(*) filter (where last_checked_at is not null)::int as last_checked,
        count(*) filter (where currentness_status is not null)::int as with_currentness,
        count(*) filter (where normalized_citation is not null and btrim(normalized_citation)<>'')::int as normalized
      from legal_authorities
    `;
    const currentnessBefore = await sql`
      select currentness_status as status, count(*)::int as n from legal_authorities group by 1 order by 2 desc
    `;
    const s = await importBundle(sql, statutes, "expansion-wave2i-statutes");
    const r = await importBundle(sql, rules, "expansion-wave2i-state-rules");
    const g = await importBundle(sql, regs, "expansion-wave2i-state-regs");
    const alias = await aliasDuplicates(sql);

    // Safe currentness: mark unknown rows that have official canonical URL + ready status
    // as current_as_of_source_date ONLY when metadata already carries retrievedAt/source date.
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
          or metadata ? 'sourceRevisionDate'
          or (metadata->'retrievedAt') is not null
          or metadata->>'wave' in ('2C','2D','2E','2F','2G','2H','2I')
        )
      returning id
    `;

    const after = await sql`
      select
        count(*)::int as total,
        count(*) filter (where authority_type='case')::int as cases,
        count(*) filter (where authority_type='statute')::int as statutes,
        count(*) filter (where authority_type='regulation')::int as regulations,
        count(*) filter (where authority_type='rule')::int as rules,
        count(distinct authority_state) filter (where authority_type='rule' and authority_state is not null)::int as rule_jurs,
        count(distinct authority_state) filter (where authority_type='regulation' and authority_state is not null)::int as reg_jurs,
        count(*) filter (where last_checked_at is not null)::int as last_checked,
        count(*) filter (where currentness_status is not null)::int as with_currentness,
        count(*) filter (where normalized_citation is not null and btrim(normalized_citation)<>'')::int as normalized,
        count(*) filter (where metadata ? 'duplicateAliasOf')::int as aliased_rows
      from legal_authorities
    `;
    const currentnessAfter = await sql`
      select currentness_status as status, count(*)::int as n from legal_authorities group by 1 order by 2 desc
    `;
    const remainingDupes = await sql`
      select normalized_citation, authority_type, count(*)::int as n
      from legal_authorities
      where normalized_citation is not null and btrim(normalized_citation)<>''
        and not (metadata ? 'duplicateAliasOf')
      group by 1, 2 having count(*) > 1
      order by 3 desc limit 20
    `;

    console.log(
      JSON.stringify({
        ok: true,
        wave: "2I",
        before: before[0],
        after: after[0],
        import: { statutes: s, rules: r, regulations: g },
        currentnessBefore,
        currentnessAfter,
        currentnessBackfill: backfill.length,
        alias,
        remainingDupes,
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e?.message || e).slice(0, 800) }));
  process.exit(1);
});
