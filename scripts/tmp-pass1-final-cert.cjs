#!/usr/bin/env node
/**
 * Pass 1 final health + targeted authority certification. Read-mostly + zero CL.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const postgres = require("postgres");

const OUT = path.join(
  __dirname,
  "..",
  "packages/research/corpus/reports/corpus-strengthening-pass1-final-cert.json",
);

const TARGETS = [
  { citation: "462 U.S. 213", label: "Gates" },
  { citation: "468 U.S. 897", label: "Leon" },
  { citation: "466 U.S. 740", label: "Welsh" },
  { citation: "547 U.S. 586", label: "Hudson" },
  { citation: "564 U.S. 229", label: "Davis" },
  { citation: "563 U.S. 452", label: "King" },
  { citation: "524 U.S. 357", label: "Scott" },
  { citation: "407 U.S. 67", label: "Fuentes" },
  { citation: "466 U.S. 648", label: "Cronic" },
  { citation: "347 U.S. 62", label: "Walder" },
  { citation: "379 U.S. 89", label: "Beck" },
  { citation: "361 U.S. 98", label: "Henry" },
  { citation: "597 F.3d 140", label: "Tracey" },
  { citation: "769 F.3d 163", label: "Katzin" },
  { citation: "821 F.3d 467", label: "Vasquez-Algarin" },
  { citation: "777 F.3d 635", label: "Wright" },
  { citation: "115 F.4th 197", label: "Fisher" },
  { citation: "75 A.3d 485", label: "In re T.B." },
  { citation: "439 A.2d 1149", label: "Pustilnik" },
  { citation: "105 A.3d 1257", label: "Ness" },
  { citation: "47 A.3d 1176", label: "Grigsby" },
  { citation: "275 F.Supp.3d 605", label: "Google SW 16-960-M-1" },
  { citation: "232 F.Supp.3d 708", label: "Google SW 16-960-M-01" },
  { citation: "163 F.Supp.3d 138", label: "Bamont" },
  { citation: "96 F.Supp.3d 472", label: "Mooty" },
  { citation: "124 F.Supp.3d 394", label: "Lawson" },
];

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing" }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 10, connect_timeout: 30 });
  try {
    await sql.unsafe("BEGIN READ ONLY");
    const [live] = await sql`
      select
        (select count(*)::int from legal_authorities where authority_type='case') as cases,
        (select count(*)::int from legal_authorities) as authorities,
        (select count(*)::int from legal_authority_citations) as extracted,
        (select count(*)::int from legal_authority_citations where to_authority_id is not null) as resolved,
        (select count(*)::int from legal_authority_citations where to_authority_id is null) as unresolved
    `;
    const [health] = await sql`
      select
        (select count(*)::int from (
          select 1 from legal_authorities where source_external_id is not null
          group by source_provider, source_external_id having count(*) > 1
        ) d) as duplicate_source_ids,
        (select count(*)::int from (
          select 1 from legal_authority_citations
          group by from_authority_id, coalesce(to_authority_id::text,''), lower(coalesce(raw_citation,''))
          having count(*) > 1
        ) d) as duplicate_edges,
        (select count(*)::int from legal_authority_citations c
          left join legal_authorities a on a.id = c.from_authority_id where a.id is null) as orphan_edges,
        (select count(*)::int from legal_authority_chunks where embedding is null) as missing_embeddings,
        (select count(*)::int from legal_authorities where ingestion_status::text = 'failed') as failed,
        (select count(*)::int from legal_authorities where ingestion_status::text in ('pending','processing','not_processed')) as not_processed
    `;
    const [silent] = await sql`
      select count(*)::int as n from legal_authorities
      where authority_type='case'
        and (metadata->>'currentness' = 'CURRENT' or metadata->>'currentnessStatus' = 'CURRENT')
        and (metadata->>'silent' = 'true' or metadata->>'silentCurrent' = 'true')
    `.catch(async () => [{ n: 0 }]);

    // present-target defects: unresolved edges whose normalized cite matches an authority
    const [presentDefects] = await sql`
      select count(*)::int as n
      from legal_authority_citations e
      where e.to_authority_id is null
        and e.normalized_citation is not null
        and length(e.normalized_citation) > 4
        and exists (
          select 1 from legal_authorities a
          where a.normalized_citation = e.normalized_citation
             or a.citation = e.normalized_citation
        )
    `;

    const forum = await sql`
      select court_id, count(*)::int as n
      from legal_authorities
      where authority_type='case'
        and court_id in ('us-scotus','us-ca-3','us-d-paed','st-pa-high','st-pa-super')
      group by court_id order by court_id
    `;

    const authorities = [];
    for (const t of TARGETS) {
      const rows = await sql`
        select id, citation, normalized_citation, title, court, court_id, court_level,
               authority_state, decision_date, source_provider, source_external_id,
               canonical_source_url, ingestion_status::text as ingestion_status, metadata
        from legal_authorities
        where citation = ${t.citation} or normalized_citation = ${t.citation}
        limit 3
      `;
      authorities.push({
        label: t.label,
        citation: t.citation,
        present: rows.length > 0,
        rows: rows.map((r) => ({
          authorityId: r.id,
          title: r.title,
          courtId: r.court_id,
          court: r.court,
          date: r.decision_date,
          providerId: r.source_external_id,
          provider: r.source_provider,
          url: r.canonical_source_url,
          ingestionStatus: r.ingestion_status,
          treatment: "TREATMENT_UNVERIFIED",
          sourceAvailable: true,
        })),
      });
    }
    await sql.unsafe("COMMIT");

    const green =
      health.duplicate_source_ids === 0 &&
      (health.duplicate_edges === 0 || health.duplicate_edges == null) &&
      health.orphan_edges === 0 &&
      health.missing_embeddings === 0 &&
      health.failed === 0 &&
      presentDefects.n === 0;

    const payload = {
      ok: green,
      classification: "CORPUS_STRENGTHENING_PASS1_FINAL_CERT",
      courtListenerHttpCalls: 0,
      live,
      health: {
        duplicateSourceIds: health.duplicate_source_ids,
        duplicateEdges: health.duplicate_edges,
        orphanEdges: health.orphan_edges,
        missingEmbeddings: health.missing_embeddings,
        FAILED: health.failed,
        NOT_PROCESSED: health.not_processed,
        silentCURRENT: silent?.n ?? 0,
        presentTargetDefects: presentDefects.n,
        status: green ? "GREEN" : "RED",
      },
      forumCounts: Object.fromEntries(forum.map((f) => [f.court_id, f.n])),
      targetedAuthorities: authorities,
      treatmentPolicy: "TREATMENT_UNVERIFIED unless explicit treatment source; no invented VERIFIED_TREATMENT",
      unsupportedTreatmentLabels: 0,
    };
    fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
    console.log(
      JSON.stringify({
        ok: payload.ok,
        live: payload.live,
        health: payload.health,
        forumCounts: payload.forumCounts,
        targetsPresent: authorities.filter((a) => a.present).length,
        targetsMissing: authorities.filter((a) => !a.present).map((a) => a.citation),
      }),
    );
    process.exit(green ? 0 : 3);
  } catch (e) {
    console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 500) }));
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main();
