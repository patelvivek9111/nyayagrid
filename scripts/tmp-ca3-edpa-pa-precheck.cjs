#!/usr/bin/env node
/**
 * Read-only precheck: corpus recount + metadata-only jurisdiction mix.
 * Zero CourtListener.
 */
"use strict";
const postgres = require("postgres");

function classifyOwnCourt(row) {
  const courtId = String(row.court_id || "").toLowerCase();
  const court = String(row.court || "").toLowerCase();
  const cite = String(row.citation || "");
  const title = String(row.title || "").toLowerCase();
  const blob = `${courtId} ${court} ${title}`;

  if (
    courtId === "us-scotus" ||
    /supreme court of the united states/.test(blob) ||
    /\bU\.?\s*S\.?\b/.test(cite) ||
    /\bS\.?\s*Ct\b/i.test(cite) ||
    /Wall\.|How\.|Cranch|Pet\./i.test(cite)
  ) {
    // SCOTUS reporters can collide with state "Pa." — prefer court_id/court when present
    if (!courtId || courtId === "us-scotus" || /supreme court of the united states/.test(blob)) {
      if (/\bU\.?\s*S\.?\b/.test(cite) || /\bS\.?\s*Ct\b/i.test(cite) || /Wall\.|How\.|Cranch|Pet\./i.test(cite) || courtId === "us-scotus") {
        return "SCOTUS";
      }
    }
  }
  if (courtId === "us-ca-3" || /third circuit/.test(blob)) return "CA3";
  if (courtId === "us-d-paed" || courtId === "paed" || /eastern.*pennsylvania|e\.d\.\s*pa/.test(blob)) return "EDPA";
  if (courtId === "st-pa" || /pennsylvania supreme|supreme court of pennsylvania/.test(blob)) return "PA_SUPREME";
  if (/pennsylvania superior|superior court of pennsylvania|st-pa-super/.test(blob)) return "PA_SUPERIOR";
  if (/pennsylvania commonwealth|commonwealth court of pennsylvania|st-pa-comm/.test(blob)) return "PA_COMMONWEALTH";
  if (/st-pa|pennsylvania/.test(blob) || (/\bA\.\s*(2d|3d)\b/i.test(cite) && /\bPa\b/i.test(cite))) return "PA_OTHER";
  if (/us-ca-|circuit/.test(blob) || /\bF\.\s*(2d|3d|4th)\b/i.test(cite)) return "OTHER_FEDERAL";
  if (/us-d-|district/.test(blob) || /\bF\.\s*Supp/i.test(cite)) return "OTHER_FEDERAL";
  if (/\bA\.\s*(2d|3d)\b/i.test(cite) || /\bP\.\s*(2d|3d)\b/i.test(cite)) return "OTHER_STATE";
  return "OTHER";
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url || /localhost|127\.0\.0\.1|:5433/i.test(url)) {
    console.log(JSON.stringify({ ok: false, reason: "need Neon DATABASE_URL" }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 30, connect_timeout: 60 });
  try {
    const [row] = await sql`
      select
        count(*)::int as total_canonical_authorities,
        count(*) filter (where authority_type='case' and ingestion_status='ready'
          and exists (select 1 from legal_authority_chunks c where c.authority_id=legal_authorities.id and c.embedding is not null))::int as corpus_complete_authorities,
        count(*) filter (where authority_type='case' and (
          ingestion_status is distinct from 'ready'
          or not exists (select 1 from legal_authority_chunks c where c.authority_id=legal_authorities.id and c.embedding is not null)
        ))::int as metadata_only_authorities,
        count(*) filter (where authority_type='case' and ingestion_status='ready')::int as full_text_ready_authorities,
        count(*) filter (where exists (select 1 from legal_authority_chunks c where c.authority_id=legal_authorities.id and c.embedding is not null))::int as embedded_authorities
      from legal_authorities
    `;
    const [edges] = await sql`
      select
        count(*) filter (where to_authority_id is not null)::int as authority_resolved_edges,
        count(*) filter (where to_authority_id is not null and a.ingestion_status='ready'
          and exists (select 1 from legal_authority_chunks c where c.authority_id=a.id and c.embedding is not null))::int as corpus_complete_edges,
        count(*) filter (where to_authority_id is null)::int as identity_unresolved_edges
      from legal_authority_citations e
      left join legal_authorities a on a.id = e.to_authority_id
    `;
    const [h] = await sql`
      select
        (select count(*)::int from (
          select 1 from legal_authorities where source_external_id is not null
          group by source_provider, source_external_id having count(*) > 1
        ) d) as duplicates,
        (select count(*)::int from legal_authority_citations c
          left join legal_authorities a on a.id=c.from_authority_id where a.id is null) as orphans,
        (select count(*)::int from legal_authority_chunks where embedding is null) as missing_embeddings
    `;
    let failed = 0;
    let notProcessed = 0;
    try {
      await sql.unsafe("SAVEPOINT sp_proc");
      const [ps] = await sql`
        select count(*) filter (where processing_status='FAILED')::int as failed,
               count(*) filter (where processing_status='NOT_PROCESSED')::int as not_processed
        from legal_authorities
      `;
      failed = ps.failed;
      notProcessed = ps.not_processed;
      await sql.unsafe("RELEASE SAVEPOINT sp_proc");
    } catch {
      await sql.unsafe("ROLLBACK TO SAVEPOINT sp_proc").catch(() => {});
    }

    await sql.unsafe("BEGIN READ ONLY");
    const moRows = await sql`
      select a.id, a.citation, a.title, a.court, a.court_id, a.source_external_id,
             (select count(*)::int from legal_authority_citations e where e.to_authority_id = a.id) as inbound,
             (select count(distinct e.from_authority_id)::int from legal_authority_citations e where e.to_authority_id = a.id) as unique_citers,
             (select count(*)::int from legal_authority_citations e
                join legal_authorities fa on fa.id = e.from_authority_id
               where e.to_authority_id = a.id
                 and (fa.court_id = 'us-ca-3' or fa.court ilike '%third circuit%')) as ca3_citers,
             (select count(*)::int from legal_authority_citations e
                join legal_authorities fa on fa.id = e.from_authority_id
               where e.to_authority_id = a.id
                 and (fa.court_id in ('us-d-paed','paed') or fa.court ilike '%eastern%pennsylvania%')) as edpa_citers,
             (select count(*)::int from legal_authority_citations e
                join legal_authorities fa on fa.id = e.from_authority_id
               where e.to_authority_id = a.id
                 and (fa.court_id like 'st-pa%' or fa.court ilike '%pennsylvania%')) as pa_citers
      from legal_authorities a
      where a.authority_type = 'case'
        and a.source_external_id like 'cl-cluster-%'
        and (
          a.ingestion_status is distinct from 'ready'
          or not exists (
            select 1 from legal_authority_chunks c
            where c.authority_id = a.id and c.embedding is not null
          )
        )
    `;
    await sql.unsafe("COMMIT");

    const byCourt = {};
    for (const r of moRows) {
      const b = classifyOwnCourt(r);
      byCourt[b] = (byCourt[b] || 0) + 1;
    }
    const demandByCourt = {};
    for (const r of moRows) {
      const b = classifyOwnCourt(r);
      if (!demandByCourt[b]) demandByCourt[b] = { n: 0, inbound: 0, unique: 0, ca3: 0, edpa: 0, pa: 0 };
      demandByCourt[b].n += 1;
      demandByCourt[b].inbound += Number(r.inbound || 0);
      demandByCourt[b].unique += Number(r.unique_citers || 0);
      demandByCourt[b].ca3 += Number(r.ca3_citers || 0);
      demandByCourt[b].edpa += Number(r.edpa_citers || 0);
      demandByCourt[b].pa += Number(r.pa_citers || 0);
    }

    const green =
      h.duplicates === 0 && h.orphans === 0 && h.missing_embeddings === 0 && failed === 0 && notProcessed === 0;

    console.log(
      JSON.stringify(
        {
          ok: true,
          host: new URL(url).hostname,
          start: {
            TOTAL_CANONICAL_AUTHORITIES: row.total_canonical_authorities,
            METADATA_ONLY_AUTHORITIES: row.metadata_only_authorities,
            CORPUS_COMPLETE_AUTHORITIES: row.corpus_complete_authorities,
            FULL_TEXT_READY_AUTHORITIES: row.full_text_ready_authorities,
            EMBEDDED_AUTHORITIES: row.embedded_authorities,
            AUTHORITY_RESOLVED_EDGES: edges.authority_resolved_edges,
            CORPUS_COMPLETE_EDGES: edges.corpus_complete_edges,
            IDENTITY_UNRESOLVED_EDGES: edges.identity_unresolved_edges,
          },
          health: {
            duplicates: h.duplicates,
            orphans: h.orphans,
            missingEmbeddings: h.missing_embeddings,
            failed,
            notProcessed,
            green,
          },
          metadataOnlyClClusters: moRows.length,
          metadataOnlyByOwnCourt: byCourt,
          demandByCourt,
          samplePriority: ["CA3", "EDPA", "PA_SUPREME", "PA_SUPERIOR", "PA_COMMONWEALTH", "PA_OTHER"]
            .flatMap((k) =>
              moRows
                .filter((r) => classifyOwnCourt(r) === k)
                .sort((a, b) => Number(b.inbound) - Number(a.inbound))
                .slice(0, 5)
                .map((r) => ({
                  court: k,
                  citation: r.citation,
                  title: r.title,
                  court_id: r.court_id,
                  courtName: r.court,
                  inbound: r.inbound,
                  unique: r.unique_citers,
                })),
            ),
        },
        null,
        2,
      ),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
