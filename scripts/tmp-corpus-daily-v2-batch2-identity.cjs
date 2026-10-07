#!/usr/bin/env node
/**
 * Batch 2 read-only identity gate. Zero CL. Zero mutations.
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
    const [cases] = await sql`select count(*)::int as n from legal_authorities where authority_type='case'`;
    const [auth] = await sql`select count(*)::int as n from legal_authorities`;
    const [cite] = await sql`
      select count(*)::int as extracted,
             count(*) filter (where to_authority_id is not null)::int as resolved,
             count(*) filter (where to_authority_id is null)::int as unresolved
      from legal_authority_citations
    `;
    const [health] = await sql`
      select
        (select count(*)::int from (
          select 1 from legal_authorities where source_external_id is not null
          group by source_provider, source_external_id having count(*) > 1
        ) d) as duplicates,
        (select count(*)::int from legal_authority_citations c
          left join legal_authorities a on a.id = c.from_authority_id
          where a.id is null) as orphans,
        (select count(*)::int from legal_authority_chunks where embedding is null) as missing_embeddings
    `;
    let failed = 0;
    let notProcessed = 0;
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
      /* optional column */
    }
    await sql.unsafe("COMMIT");

    const live = {
      cases: cases.n,
      authorities: auth.n,
      extracted: cite.extracted,
      resolved: cite.resolved,
      unresolved: cite.unresolved,
      duplicates: health.duplicates,
      orphans: health.orphans,
      missingEmbeddings: health.missing_embeddings,
      failed,
      notProcessed,
    };
    const floors = { cases: 4825, authorities: 6180, extracted: 54585, resolved: 8016 };
    const pass =
      live.cases >= floors.cases &&
      live.authorities >= floors.authorities &&
      live.extracted >= floors.extracted &&
      live.resolved >= floors.resolved &&
      live.duplicates === 0 &&
      live.orphans === 0 &&
      live.missingEmbeddings === 0 &&
      failed === 0 &&
      notProcessed === 0 &&
      hostMatch &&
      !isLocal;

    const out = {
      ok: pass,
      classification: "CORPUS_DAILY_V2_BATCH2_IDENTITY_GATE",
      hostMatchesHistoricalWeek2Pooler: hostMatch,
      isLocal47CaseDb: isLocal || live.cases < 100,
      live,
      floors,
      generatedAt: new Date().toISOString(),
      courtListenerHttpCalls: 0,
    };
    fs.writeFileSync(
      path.join(__dirname, "..", "packages/research/corpus/reports/corpus-daily-v2-batch2-identity-start.json"),
      JSON.stringify(out, null, 2),
    );
    console.log(JSON.stringify(out));
    process.exit(pass ? 0 : 3);
  } catch (e) {
    console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 800) }));
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main();
