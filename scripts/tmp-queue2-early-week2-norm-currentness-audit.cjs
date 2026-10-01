#!/usr/bin/env node
/**
 * Early Week 2 normalization + currentness audit (optional safe backfill).
 * ZERO CourtListener. ZERO external AI.
 * Usage: node script.cjs [--apply]
 */
"use strict";
const fs = require("fs");
const path = require("path");
const postgres = require("postgres");

const APPLY = process.argv.includes("--apply");
const reports = path.join(__dirname, "..", "packages/research/corpus/reports");

async function main() {
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    const [corpus] = await sql`
      select
        count(*) filter (where authority_type='case')::int as cases,
        count(*)::int as authorities,
        count(*) filter (where authority_type='statute')::int as statutes,
        count(*) filter (where authority_type='regulation')::int as regulations,
        count(*) filter (where authority_type='rule')::int as rules,
        count(*) filter (where source_provider is null or btrim(source_provider)='')::int as missing_provider,
        count(*) filter (where source_provider is not null and (source_external_id is null or btrim(source_external_id)=''))::int as missing_external_id,
        count(*) filter (where authority_type='case' and (normalized_citation is null or btrim(normalized_citation)=''))::int as cases_missing_norm_cite,
        count(*) filter (where authority_type='case' and court_id is not null)::int as cases_with_court_id,
        count(*) filter (where authority_type='case' and jurisdiction is not null)::int as cases_with_jurisdiction,
        count(*) filter (where authority_type='case' and court is not null)::int as cases_with_court
      from legal_authorities
    `;

    const currentness = await sql`
      select authority_type, currentness_status, count(*)::int as n
      from legal_authorities
      group by 1, 2
      order by 1, 2
    `;

    const silentCurrent = await sql`
      select authority_type, currentness_status, count(*)::int as n
      from legal_authorities
      where currentness_status in ('current_as_of_source_date','current_verified_from_source')
        and last_checked_at is null
        and effective_date is null
      group by 1, 2
    `;

    const [dupProvider] = await sql`
      select count(*)::int as n from (
        select source_provider, source_external_id
        from legal_authorities
        where source_provider is not null and source_external_id is not null
        group by 1, 2 having count(*) > 1
      ) t
    `;

    const [dupNormCiteCases] = await sql`
      select count(*)::int as n from (
        select lower(btrim(normalized_citation)) as c
        from legal_authorities
        where authority_type='case' and normalized_citation is not null and btrim(normalized_citation)<>''
        group by 1 having count(*) > 1
      ) t
    `;

    const [integrity] = await sql`
      select
        (select count(*)::int from (
          select source_provider, source_external_id from legal_authorities
          where source_provider is not null and source_external_id is not null
          group by 1,2 having count(*)>1
        ) d) as duplicates,
        (select count(*)::int from legal_authority_chunks c
          left join legal_authorities a on a.id=c.authority_id where a.id is null) as orphan_chunks,
        (select count(*)::int from legal_authority_chunks c
          where c.embedding is null) as missing_embeddings,
        (select count(*)::int from (
          select from_authority_id, coalesce(normalized_citation, raw_citation), coalesce(to_authority_id::text,'')
          from legal_authority_citations
          group by 1,2,3 having count(*)>1
        ) e) as duplicate_citation_edges
    `;

    const spacingSamples = await sql`
      select normalized_citation, count(*)::int as n
      from legal_authority_citations
      where to_authority_id is null
        and normalized_citation ~* '^[0-9]+\\s+[A-Z]\\.\\s+[0-9a-z]+\\s+[0-9]+'
      group by 1
      order by n desc
      limit 20
    `;

    const [eligible] = await sql`
      select count(*)::int as n
      from legal_authorities
      where authority_type='case'
        and currentness_status='unknown'
        and decision_date is not null
    `;

    let backfill = { applied: false, wouldUpdate: eligible.n, updated: 0 };
    if (APPLY && eligible.n > 0) {
      const updated = await sql`
        update legal_authorities
        set currentness_status='historical', updated_at=now()
        where authority_type='case'
          and currentness_status='unknown'
          and decision_date is not null
      `;
      backfill.applied = true;
      backfill.updated = updated.count;
    }

    const currentnessTotals = await sql`
      select currentness_status, count(*)::int as n
      from legal_authorities
      group by 1 order by 1
    `;

    const out = {
      ok: true,
      classification: "EARLY_WEEK2_NORMALIZATION_CURRENTNESS_AUDIT",
      generatedAt: new Date().toISOString(),
      courtListenerHttpCalls: 0,
      aiCalls: 0,
      mutations: backfill.applied ? backfill.updated : 0,
      apply: APPLY,
      corpus,
      currentnessByType: currentness,
      currentnessTotals,
      silentCurrentSuspects: silentCurrent,
      duplicateProviderSourceIdPairs: dupProvider.n,
      duplicateNormalizedCaseCitations: dupNormCiteCases.n,
      integrity: {
        duplicates: integrity.duplicates,
        orphans: integrity.orphan_chunks,
        missingEmbeddings: integrity.missing_embeddings,
        duplicateCitationEdges: integrity.duplicate_citation_edges,
      },
      spacingVariantUnresolvedSamples: spacingSamples,
      caseHistoricalBackfill: backfill,
    };

    // When bundled on Fly, reports path may not exist — still print JSON.
    try {
      fs.mkdirSync(reports, { recursive: true });
      fs.writeFileSync(
        path.join(reports, "queue2-early-week2-normalization-currentness-audit.json"),
        JSON.stringify(out, null, 2),
      );
    } catch (_) {
      /* ignore write on remote */
    }
    console.log(JSON.stringify(out));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, err: String(err && err.message ? err.message : err) }));
  process.exit(1);
});
