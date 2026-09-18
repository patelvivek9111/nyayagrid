/**
 * Wave 2K staging: import regulation deepen + safe currentness apply + alias.
 * No CourtListener. FEATURE_AGENTS=0.
 */
"use strict";

const { createHash, randomUUID } = require("node:crypto");
const postgres = require("postgres");

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function classifyUnknown(row) {
  const meta = row.metadata || {};
  const provider = String(row.source_provider || "").toLowerCase();
  if (provider.includes("courtlistener") || meta.courtListener || meta.clOpinionId || meta.clClusterId) {
    return "C_CL_related";
  }
  if (row.authority_type === "case") return "B_historical_case";
  if (!row.source_provider || !row.source_external_id) return "F_missing_metadata_bug";
  const retrievedAt = meta.retrievedAt || meta.sourceRetrievedAt || meta.bundleRetrievedAt;
  const editionDate = meta.sourceDate || meta.editionDate || meta.revisionDate || meta.officialPublishedAt;
  if (retrievedAt || editionDate || meta.sourceAssertsCurrent) return "A_source_supports_recheck";
  if (meta.retrievalMethod === "manual" || meta.manualSource || provider === "manual") return "E_manual_source";
  return "D_source_no_revision_metadata";
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
          ${id}, ${a.authorityType || "regulation"}, ${a.jurisdiction || null}, ${a.court || null},
          ${a.courtId || null}, ${a.authorityState || null}, ${a.title}, ${a.citation || null},
          ${a.normalizedCitation || a.citation || null}, ${provider}, ${a.sourceExternalId},
          ${a.canonicalSourceUrl || null}, 'ready',
          ${a.currentnessStatus || "current_as_of_source_date"}, now(),
          ${sql.json({ ...(a.sourceMetadata || {}), wave: "2K", bundlePracticeAreas: a.bundlePracticeAreas || [] })},
          now(), now()
        )
      `;
      await sql`
        insert into legal_authority_versions (
          authority_id, version_number, content, sha256, valid_from, valid_to, source_provider, source_metadata
        ) values (
          ${id}, 1, ${content}, ${hash}, now(), null, ${provider},
          ${sql.json({ wave: "2K", bundle: label })}
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
        ${sql.json({ wave: "2K", priorSha: latest[0]?.sha256 || null })}
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

async function applyCurrentness(sql) {
  const unknowns = await sql`
    select id, authority_type, source_provider, source_external_id, metadata, decision_date, effective_date
    from legal_authorities
    where currentness_status = 'unknown' or currentness_status is null
  `;
  let a = 0;
  let b = 0;
  let d = 0;
  let f = 0;
  const left = { C_CL_related: 0, D_source_no_revision_metadata: 0, E_manual_source: 0 };

  for (const row of unknowns) {
    const bucket = classifyUnknown(row);
    const meta = row.metadata || {};
    if (bucket === "B_historical_case") {
      await sql`
        update legal_authorities
        set currentness_status = 'historical',
            last_checked_at = coalesce(last_checked_at, now()),
            metadata = coalesce(metadata, '{}'::jsonb) || ${sql.json({
              currentnessPolicy: "wave2k-historical-case",
              currentnessNote: "Cases are historical authorities; currentness_status is not treatment status.",
            })},
            updated_at = now()
        where id = ${row.id}
      `;
      b += 1;
      continue;
    }
    if (bucket === "A_source_supports_recheck") {
      const retrievedAt = meta.retrievedAt || meta.sourceRetrievedAt || meta.bundleRetrievedAt;
      const editionDate = meta.sourceDate || meta.editionDate || meta.revisionDate || meta.officialPublishedAt;
      // Only stamp current_as_of_source_date when explicit source-date evidence exists.
      if (retrievedAt || editionDate) {
        await sql`
          update legal_authorities
          set currentness_status = 'current_as_of_source_date',
              last_checked_at = now(),
              metadata = coalesce(metadata, '{}'::jsonb) || ${sql.json({
                currentnessPolicy: "wave2k-recheck-A",
                currentnessEvidence: retrievedAt ? "retrievedAt" : "editionDate",
                currentnessEvidenceAt: retrievedAt || editionDate,
              })},
              updated_at = now()
          where id = ${row.id}
        `;
        a += 1;
      }
      continue;
    }
    if (bucket === "F_missing_metadata_bug") {
      // Cannot invent provenance; leave unknown but tag.
      await sql`
        update legal_authorities
        set metadata = coalesce(metadata, '{}'::jsonb) || ${sql.json({
          currentnessPolicy: "wave2k-F-flag",
          currentnessNote: "missing source_provider or source_external_id",
        })},
        updated_at = now()
        where id = ${row.id}
      `;
      f += 1;
      continue;
    }
    if (bucket === "D_source_no_revision_metadata") {
      // Category D: if curated official snapshot with wave retrievedAt nested incorrectly, already handled in A.
      // Leave unknown — do not fabricate.
      left.D_source_no_revision_metadata += 1;
      d += 1;
      continue;
    }
    if (bucket === "C_CL_related") left.C_CL_related += 1;
    if (bucket === "E_manual_source") left.E_manual_source += 1;
  }

  // Touch last_checked for non-unknown curated regs/statutes that already have source dates but null last_checked
  const touched = await sql`
    update legal_authorities
    set last_checked_at = now(), updated_at = now()
    where last_checked_at is null
      and currentness_status in ('current_as_of_source_date', 'current_verified_from_source', 'historical')
      and (
        (metadata ? 'retrievedAt')
        or (metadata ? 'sourceDate')
        or authority_type = 'case'
        or source_provider = 'us-primary-corpus'
      )
    returning id
  `;

  return {
    appliedA: a,
    appliedBHistorical: b,
    flaggedF: f,
    leftD: d,
    leftBuckets: left,
    lastCheckedBackfill: touched.length,
  };
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
          aliasReason: "exact normalized_citation + type duplicate (wave2k)",
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
  const regs = require("../packages/research/corpus/bundles/expansion-wave2k-state-regs.json");
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const before = await sql`
      select count(*)::int as total,
        count(*) filter (where authority_type='case')::int as cases,
        count(*) filter (where authority_type='statute')::int as statutes,
        count(*) filter (where authority_type='regulation')::int as regulations,
        count(*) filter (where authority_type='rule')::int as rules,
        count(*) filter (where currentness_status='unknown' or currentness_status is null)::int as unknown,
        count(*) filter (where last_checked_at is not null)::int as last_checked
      from legal_authorities
    `;
    const imp = await importBundle(sql, regs, "expansion-wave2k-state-regs");
    const currentness = await applyCurrentness(sql);
    const aliased = await aliasExactDupes(sql);
    const after = await sql`
      select count(*)::int as total,
        count(*) filter (where authority_type='case')::int as cases,
        count(*) filter (where authority_type='statute')::int as statutes,
        count(*) filter (where authority_type='regulation')::int as regulations,
        count(*) filter (where authority_type='rule')::int as rules,
        count(*) filter (where currentness_status='unknown' or currentness_status is null)::int as unknown,
        count(*) filter (where currentness_status='historical')::int as historical,
        count(*) filter (where currentness_status='current_as_of_source_date')::int as current_src,
        count(*) filter (where last_checked_at is not null)::int as last_checked,
        count(*) filter (where normalized_citation is not null and btrim(normalized_citation)<>'')::int as normalized,
        count(*) filter (where canonical_source_url is not null and btrim(canonical_source_url)<>'')::int as with_url,
        count(*) filter (where source_provider is not null and source_external_id is not null)::int as provenance,
        count(distinct authority_state) filter (where authority_type='regulation' and authority_state is not null)::int as reg_jurs
      from legal_authorities
    `;
    const statusDist = await sql`
      select currentness_status as s, count(*)::int as n
      from legal_authorities group by 1 order by n desc
    `;
    process.stdout.write(
      JSON.stringify({
        ok: true,
        wave: "2K",
        before: before[0],
        after: after[0],
        import: { regulations: imp },
        currentness,
        aliased,
        statusDist,
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
