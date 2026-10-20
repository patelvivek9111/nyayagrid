/**
 * Generic read-only Lane A live-count / job reconciliation probe.
 * Works for ANY verified Queue #2 Lane A CL court (vt, mich, wis, …).
 *
 * ZERO CourtListener HTTP. ZERO mutations.
 *
 * Usage (on staging):
 *   node tmp-queue2-lane-a-live-count-probe.cjs <clCourt>
 *   CL_COURT=vt node tmp-queue2-lane-a-live-count-probe.cjs
 */
"use strict";

const postgres = require("postgres");

/** CL court id → authority_state (Queue #2 Lane A verified map). */
const CL_COURT_TO_STATE = Object.freeze({
  ala: "AL",
  alaska: "AK",
  ariz: "AZ",
  ark: "AR",
  cal: "CA",
  colo: "CO",
  conn: "CT",
  del: "DE",
  dc: "DC",
  fla: "FL",
  ga: "GA",
  haw: "HI",
  idaho: "ID",
  ill: "IL",
  ind: "IN",
  iowa: "IA",
  kan: "KS",
  ky: "KY",
  la: "LA",
  me: "ME",
  md: "MD",
  mass: "MA",
  mich: "MI",
  mi: "MI",
  minn: "MN",
  miss: "MS",
  mo: "MO",
  mont: "MT",
  neb: "NE",
  nev: "NV",
  nh: "NH",
  nj: "NJ",
  nm: "NM",
  ny: "NY",
  nc: "NC",
  nd: "ND",
  ohio: "OH",
  okla: "OK",
  or: "OR",
  pa: "PA",
  ri: "RI",
  sc: "SC",
  sd: "SD",
  tenn: "TN",
  tex: "TX",
  utah: "UT",
  vt: "VT",
  va: "VA",
  wash: "WA",
  wva: "WV",
  wis: "WI",
  wyo: "WY",
  scotus: "US",
});

/** Canonical CL court id (mi → mich). */
function normalizeClCourt(raw) {
  const c = String(raw || "")
    .trim()
    .toLowerCase();
  if (!c) return null;
  if (c === "mi") return "mich";
  return c;
}

function resolveJurisdiction(clCourt, explicit) {
  if (explicit) return String(explicit).trim().toUpperCase();
  const mapped = CL_COURT_TO_STATE[clCourt];
  return mapped || null;
}

async function main() {
  const clCourt = normalizeClCourt(process.env.CL_COURT || process.argv[2] || "");
  const jurisdiction = resolveJurisdiction(clCourt, process.env.AUTHORITY_STATE || process.env.JURISDICTION);
  const url = process.env.DATABASE_URL;
  const nowIso = new Date().toISOString();

  if (!url) {
    console.log(
      JSON.stringify({
        ok: false,
        reason: "DATABASE_URL missing",
        mutations: 0,
        courtListenerHttpCalls: 0,
        generatedAt: nowIso,
      }),
    );
    process.exit(2);
  }
  if (!clCourt) {
    console.log(
      JSON.stringify({
        ok: false,
        reason: "CL_COURT_REQUIRED",
        mutations: 0,
        courtListenerHttpCalls: 0,
        generatedAt: nowIso,
      }),
    );
    process.exit(2);
  }
  if (!jurisdiction) {
    console.log(
      JSON.stringify({
        ok: false,
        reason: "UNKNOWN_CL_COURT",
        court: clCourt,
        mutations: 0,
        courtListenerHttpCalls: 0,
        generatedAt: nowIso,
      }),
    );
    process.exit(2);
  }

  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const jobs = await sql`
      select id, source, cl_court, court_id, status, cursor, next_page_url,
             last_successful_external_id,
             items_discovered, items_fetched, items_imported, items_skipped,
             items_failed, items_quarantined, rate_limit_count, api_calls,
             target_max, batch_size, last_retry_after_sec, last_error,
             started_at, updated_at, completed_at, metadata
      from corpus_ingest_jobs
      where source = 'courtlistener' and cl_court = ${clCourt}
      order by updated_at desc nulls last
      limit 5
    `;

    const [counts] = await sql`
      select count(*)::int as authorities,
             count(*) filter (where authority_type = 'case')::int as cases,
             count(*) filter (
               where authority_type = 'case' and source_provider = 'courtlistener'
             )::int as cl_cases,
             count(*) filter (
               where authority_type = 'case'
                 and court_level in ('state_high', 'state_appellate', 'scotus', 'circuit')
             )::int as qualifying_high_appellate,
             count(*) filter (
               where authority_type = 'case'
                 and source_provider = 'courtlistener'
                 and court_level in ('state_high', 'scotus')
             )::int as high_court_cl_cases,
             count(*) filter (
               where authority_type = 'case'
                 and court_level in ('state_high', 'scotus')
             )::int as high_court_cases,
             count(*) filter (
               where authority_type = 'case'
                 and court_level in ('state_appellate', 'circuit')
             )::int as intermediate_cases,
             max(updated_at) as last_updated
      from legal_authorities
      where authority_state = ${jurisdiction}
    `;

    const [integrity] = await sql`
      select
        (select count(*)::int from (
          select source_provider, source_external_id from legal_authorities
          where authority_state = ${jurisdiction} and source_external_id is not null
          group by 1, 2 having count(*) > 1
        ) d) as duplicate_source_ids,
        (select count(*)::int from legal_authority_chunks c
          left join legal_authorities a on a.id = c.authority_id
          where a.id is null) as orphan_count,
        (select count(*)::int from legal_authority_chunks c
          inner join legal_authorities a on a.id = c.authority_id
          where a.authority_state = ${jurisdiction}) as chunk_count,
        (select count(*)::int from legal_authority_chunks c
          inner join legal_authorities a on a.id = c.authority_id
          where a.authority_state = ${jurisdiction} and c.embedding is not null) as embedding_count,
        (select count(*)::int from legal_authority_chunks c
          inner join legal_authorities a on a.id = c.authority_id
          where a.authority_state = ${jurisdiction} and c.embedding is null) as missing_embeddings
    `;

    const qualifyingCaseCount = Number(counts.qualifying_high_appellate) || 0;
    const highCourtClCases = Number(counts.high_court_cl_cases) || 0;
    const clCaseCount = Number(counts.cl_cases) || 0;
    const totalCaseCount = Number(counts.cases) || 0;
    const authorityCount = Number(counts.authorities) || 0;
    const missingEmbeddings = Number(integrity.missing_embeddings) || 0;
    const chunkCount = Number(integrity.chunk_count) || 0;
    const chunkHealthy = chunkCount === 0 || missingEmbeddings === 0;

    const jobRows = (jobs || []).map((j) => ({
      id: j.id,
      status: j.status,
      cursor: j.cursor,
      next_page_url: j.next_page_url,
      last_successful_external_id: j.last_successful_external_id,
      items_imported: j.items_imported,
      api_calls: j.api_calls,
      target_max: j.target_max,
      batch_size: j.batch_size,
      last_error: j.last_error,
      started_at: j.started_at,
      updated_at: j.updated_at,
      items_quarantined: j.items_quarantined,
      cl_court: j.cl_court,
      court_id: j.court_id,
    }));

    console.log(
      JSON.stringify({
        ok: true,
        court: clCourt,
        jurisdiction,
        qualifyingCaseCount,
        qualifyingCases: qualifyingCaseCount,
        qualifying_high_appellate: qualifyingCaseCount,
        highCourtClCases,
        high_court_cl_cases: highCourtClCases,
        highCourtCases: Number(counts.high_court_cases) || 0,
        intermediateCases: Number(counts.intermediate_cases) || 0,
        clCaseCount,
        clCases: clCaseCount,
        totalCaseCount,
        cases: totalCaseCount,
        authorityCount,
        authorities: authorityCount,
        integrity: {
          duplicateSourceIds: Number(integrity.duplicate_source_ids) || 0,
          orphanCount: Number(integrity.orphan_count) || 0,
          chunkCount,
          embeddingCount: Number(integrity.embedding_count) || 0,
          missingEmbeddings,
          chunkHealthy,
        },
        jobs: jobRows,
        job: jobRows[0] || null,
        generatedAt: nowIso,
        observedAt: nowIso,
        dbEvidenceObservedAt: nowIso,
        mutations: 0,
        courtListenerHttpCalls: 0,
        featureAgents: process.env.FEATURE_AGENTS || "0",
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.log(
      JSON.stringify({
        ok: false,
        err: String(e.message || e).slice(0, 400),
        mutations: 0,
        courtListenerHttpCalls: 0,
        generatedAt: new Date().toISOString(),
      }),
    );
    process.exit(1);
  });
}

module.exports = {
  CL_COURT_TO_STATE,
  normalizeClCourt,
  resolveJurisdiction,
};
