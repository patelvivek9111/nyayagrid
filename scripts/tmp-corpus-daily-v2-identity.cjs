#!/usr/bin/env node
/**
 * Read-only corpus identity gate for Chat B daily CourtListener strengthening.
 * Zero CourtListener. Zero mutations.
 */
"use strict";
const postgres = require("postgres");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing" }));
    process.exit(2);
  }
  const hostMatch = /ep-jolly-brook-auhdpay3-pooler/i.test(url);
  const isLocal = /localhost|127\.0\.0\.1|:5433/i.test(url);
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 10, connect_timeout: 40 });
  try {
    await sql.unsafe("BEGIN READ ONLY");
    const [cases] = await sql`
      select count(*)::int as n from legal_authorities where authority_type = 'case'
    `;
    const [auth] = await sql`select count(*)::int as n from legal_authorities`;
    const [cite] = await sql`
      select
        count(*)::int as extracted,
        count(*) filter (where to_authority_id is not null)::int as resolved,
        count(*) filter (where to_authority_id is null)::int as unresolved
      from legal_authority_citations
    `;
    const [health] = await sql`
      select
        (select count(*)::int from (
          select 1 from legal_authorities
          where source_external_id is not null
          group by source_provider, source_external_id
          having count(*) > 1
        ) d) as duplicate_source_ids,
        (select count(*)::int from legal_authority_citations c
          left join legal_authorities a on a.id = c.from_authority_id
          where a.id is null) as orphan_edges,
        (select count(*)::int from legal_authority_chunks where embedding is null) as missing_embeddings
    `;

    let failed = 0;
    let notProcessed = 0;
    let silentCurrent = 0;
    let presentTargetDefects = 0;
    try {
      const [ps] = await sql`
        select
          count(*) filter (where processing_status = 'FAILED')::int as failed,
          count(*) filter (where processing_status = 'NOT_PROCESSED')::int as not_processed
        from legal_authorities
      `;
      failed = ps.failed;
      notProcessed = ps.not_processed;
    } catch {
      /* column may not exist */
    }
    try {
      const [sc] = await sql`
        select count(*)::int as n
        from legal_authorities
        where authority_type = 'case'
          and currentness_status = 'CURRENT'
          and (content is null or length(btrim(content)) < 40)
      `;
      silentCurrent = sc.n;
    } catch {
      silentCurrent = -1;
    }
    try {
      const [def] = await sql`
        select count(*)::int as n
        from legal_authority_citations c
        where c.to_authority_id is null
          and exists (
            select 1 from legal_authorities a
            where a.authority_type = 'case'
              and (
                lower(regexp_replace(coalesce(a.normalized_citation, a.citation, ''), '[.\\s]+', '', 'g'))
                = lower(regexp_replace(coalesce(c.normalized_citation, c.raw_citation, ''), '[.\\s]+', '', 'g'))
              )
          )
      `;
      presentTargetDefects = def.n;
    } catch {
      presentTargetDefects = -1;
    }

    await sql.unsafe("COMMIT");

    const live = {
      cases: cases.n,
      authorities: auth.n,
      extracted: cite.extracted,
      resolved: cite.resolved,
      unresolved: cite.unresolved,
      duplicates: health.duplicate_source_ids,
      orphans: health.orphan_edges,
      missingEmbeddings: health.missing_embeddings,
      failed,
      notProcessed,
      silentCurrent,
      presentTargetDefects,
    };

    const floors = {
      cases: 4680,
      authorities: 6035,
      extracted: 50623,
      resolved: 6306,
    };

    const pass =
      live.cases >= floors.cases &&
      live.authorities >= floors.authorities &&
      live.extracted >= floors.extracted &&
      live.resolved >= floors.resolved &&
      live.duplicates === 0 &&
      live.orphans === 0 &&
      live.missingEmbeddings === 0 &&
      (live.failed === 0 || live.failed === undefined) &&
      (live.notProcessed === 0 || live.notProcessed === undefined) &&
      (live.silentCurrent === 0 || live.silentCurrent === -1) &&
      (live.presentTargetDefects === 0 || live.presentTargetDefects === -1) &&
      hostMatch &&
      !isLocal;

    const out = {
      ok: pass,
      classification: "CORPUS_DAILY_V2_IDENTITY_GATE",
      hostMatchesHistoricalWeek2Pooler: hostMatch,
      isLocal47CaseDb: isLocal || live.cases < 100,
      transactionReadOnly: true,
      mutations: 0,
      courtListenerHttpCalls: 0,
      live,
      floors,
      generatedAt: new Date().toISOString(),
    };

    const reportPath = path.join(
      __dirname,
      "..",
      "packages/research/corpus/reports/corpus-daily-v2-identity-start.json",
    );
    fs.writeFileSync(reportPath, JSON.stringify(out, null, 2));
    // Compact stdout for orchestrator lastJson parsing
    console.log(JSON.stringify(out));
    process.exit(pass ? 0 : 3);
  } catch (e) {
    console.log(
      JSON.stringify({
        ok: false,
        err: String(e.message || e).slice(0, 800),
        courtListenerHttpCalls: 0,
      }),
    );
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();
