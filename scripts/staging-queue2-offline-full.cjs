/**
 * Queue #2 offline full audit — DATABASE ONLY. ZERO CourtListener HTTP.
 */
"use strict";

const postgres = require("postgres");

const STATES_52 = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME",
  "MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI",
  "SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","US",
];

const NATIONAL_HIGH_COURTS = {
  NE: { cl: "neb", courtId: "st-ne-high" },
  NH: { cl: "nh", courtId: "st-nh-high" },
  NM: { cl: "nm", courtId: "st-nm-high" },
  MT: { cl: "mont", courtId: "st-mt-high" },
  ND: { cl: "nd", courtId: "st-nd-high" },
  MS: { cl: "miss", courtId: "st-ms-high" },
  LA: { cl: "la", courtId: "st-la-high" },
  DC: { cl: "dc", courtId: "st-dc-high" },
  ID: { cl: "idaho", courtId: "st-id-high" },
  MO: { cl: "mo", courtId: "st-mo-high" },
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const totals = await sql`
      select
        count(*)::int as authorities,
        count(*) filter (where authority_type = 'case')::int as cases,
        count(*) filter (where source_provider = 'courtlistener')::int as cl_cases,
        count(*) filter (where authority_type = 'statute')::int as statutes,
        count(*) filter (where authority_type = 'regulation')::int as regulations,
        count(*) filter (where authority_type = 'rule')::int as rules,
        count(*) filter (
          where citation is not null and btrim(citation) <> ''
            and normalized_citation is not null and btrim(normalized_citation) <> ''
        )::int as with_normalized_citation,
        count(*) filter (
          where court_id is not null or authority_state is not null or court_level is not null
        )::int as metadata_normalized,
        count(*) filter (where canonical_source_url is not null and btrim(canonical_source_url) <> '')::int as with_canonical_url
      from legal_authorities
    `;

    const perJur = await sql`
      select
        coalesce(nullif(btrim(authority_state), ''), 'US') as j,
        count(*)::int as authorities,
        count(*) filter (where authority_type = 'case')::int as cases,
        count(*) filter (where authority_type = 'case' and court_level in ('state_high','scotus'))::int as high_court_cases,
        count(*) filter (where authority_type = 'case' and court_level in ('state_appellate','circuit'))::int as intermediate_appellate_cases,
        count(*) filter (where authority_type = 'statute')::int as statutes,
        count(*) filter (where authority_type = 'regulation')::int as regulations,
        count(*) filter (where authority_type = 'rule')::int as rules,
        round(100.0 * count(*) filter (
          where canonical_source_url is not null and btrim(canonical_source_url) <> ''
        ) / greatest(count(*), 1), 1)::float as canonical_pct,
        round(100.0 * count(*) filter (
          where court_id is not null or authority_state is not null or court_level is not null
        ) / greatest(count(*), 1), 1)::float as normalized_pct,
        round(100.0 * count(*) filter (
          where currentness_status is not null
        ) / greatest(count(*), 1), 1)::float as currentness_pct
      from legal_authorities
      group by 1
      order by 1
    `;

    const clChunks = await sql`
      select
        count(distinct a.id)::int as cl_authorities,
        count(c.id)::int as chunks,
        count(c.id) filter (where c.embedding is not null)::int as with_embedding,
        count(distinct a.id) filter (where c.id is null)::int as authorities_without_chunks
      from legal_authorities a
      left join legal_authority_chunks c on c.authority_id = a.id
      where a.source_provider = 'courtlistener'
    `;

    const orphanChunks = await sql`
      select count(*)::int as orphan_chunks
      from legal_authority_chunks c
      left join legal_authorities a on a.id = c.authority_id
      where a.id is null
    `;

    const chunksNoEmb = await sql`
      select count(*)::int as n
      from legal_authority_chunks c
      join legal_authorities a on a.id = c.authority_id
      where a.source_provider = 'courtlistener' and c.embedding is null
    `;

    const duplicateCl = await sql`
      select source_external_id, count(*)::int as n
      from legal_authorities
      where source_provider = 'courtlistener' and source_external_id is not null
      group by source_external_id
      having count(*) > 1
      order by n desc
      limit 30
    `;

    const duplicateUrl = await sql`
      select canonical_source_url, count(*)::int as n
      from legal_authorities
      where canonical_source_url is not null and btrim(canonical_source_url) <> ''
      group by canonical_source_url
      having count(*) > 1
      order by n desc
      limit 20
    `;

    const duplicateCitation = await sql`
      select normalized_citation, count(*)::int as n
      from legal_authorities
      where normalized_citation is not null and btrim(normalized_citation) <> ''
      group by normalized_citation
      having count(*) > 1
      order by n desc
      limit 20
    `;

    const normNulls = await sql`
      select
        count(*) filter (where court_id is null)::int as missing_court_id,
        count(*) filter (where authority_state is null or btrim(authority_state) = '')::int as missing_state,
        count(*) filter (where court_level is null)::int as missing_court_level,
        count(*) filter (where authority_type is null)::int as missing_authority_type,
        count(*) filter (where decision_date is null)::int as missing_decision_date,
        count(*) filter (
          where citation is not null and btrim(citation) <> ''
            and (normalized_citation is null or btrim(normalized_citation) = '')
        )::int as missing_normalized_citation,
        count(*) filter (where canonical_source_url is null or btrim(canonical_source_url) = '')::int as missing_canonical_url,
        count(*) filter (where source_provider is null)::int as missing_provenance,
        count(*)::int as total
      from legal_authorities
    `;

    const currentness = await sql`
      select
        count(*) filter (where currentness_status::text = 'historical')::int as historical,
        count(*) filter (where currentness_status::text = 'current_as_of_source_date')::int as current_as_of_source_date,
        count(*) filter (
          where currentness_status is null or currentness_status::text = 'unknown'
        )::int as unknown,
        count(*) filter (where last_checked_at is not null)::int as last_checked
      from legal_authorities
    `;

    const jobs = await sql`
      select cl_court, court_id, status, cursor, items_imported, target_max, updated_at
      from corpus_ingest_jobs
      where source = 'courtlistener'
      order by updated_at desc nulls last
    `;

    const wave1Counts = await sql`
      select court_id, count(*)::int as n
      from legal_authorities
      where source_provider = 'courtlistener' and court_id like 'st-%'
      group by 1 order by n desc
    `;

    const stateRetrieval = {};
    for (const [state, meta] of Object.entries(NATIONAL_HIGH_COURTS)) {
      const highCount = await sql`
        select count(*)::int as n from legal_authorities
        where court_id = ${meta.courtId} and authority_type = 'case'
      `;
      const sample = await sql`
        select id, left(title, 80) as title, court_level, authority_state, source_external_id
        from legal_authorities
        where court_id = ${meta.courtId} and authority_type = 'case'
        order by decision_date desc nulls last
        limit 3
      `;
      const nameProbe = sample[0]?.title
        ? await sql`
            select count(*)::int as n from legal_authorities
            where authority_type = 'case' and authority_state = ${state}
              and title ilike ${"%" + String(sample[0].title).split(" v.")[0].slice(0, 20).trim() + "%"}
          `
        : [{ n: 0 }];
      const isolation = await sql`
        select count(*)::int as n from legal_authorities
        where authority_type = 'case' and authority_state = ${state}
          and court_id is not null and court_id <> ${meta.courtId}
          and court_level = 'state_high'
      `;
      stateRetrieval[state] = {
        courtId: meta.courtId,
        clCourt: meta.cl,
        highCaseCount: highCount[0]?.n ?? 0,
        sampleTitles: sample.map((r) => r.title),
        caseNameHits: nameProbe[0]?.n ?? 0,
        otherHighCourtsSameState: isolation[0]?.n ?? 0,
        pass:
          (highCount[0]?.n ?? 0) >= 20 &&
          (nameProbe[0]?.n ?? 0) >= 1 &&
          (isolation[0]?.n ?? 0) === 0,
      };
    }

    const safeMiss = await sql`
      select count(*)::int as n from legal_authorities
      where citation ilike '%99999.01%' or title ilike '%SYNTHETIC_MISS_PROBE%'
    `;

    console.log(
      JSON.stringify(
        {
          ok: true,
          wave: "queue2-offline-full",
          courtListenerHttpCalls: 0,
          featureAgents: process.env.FEATURE_AGENTS ?? "0",
          generatedAt: new Date().toISOString(),
          totals: totals[0],
          perJur,
          clChunks: { ...clChunks[0], chunks_without_embedding: chunksNoEmb[0]?.n ?? 0 },
          orphanChunks: orphanChunks[0]?.orphan_chunks ?? 0,
          duplicates: {
            clSourceExternalId: duplicateCl,
            canonicalUrl: duplicateUrl,
            normalizedCitation: duplicateCitation,
          },
          normalization: normNulls[0],
          currentness: currentness[0],
          corpusIngestJobs: jobs,
          wave1CourtCounts: wave1Counts,
          stateRetrieval,
          safeMiss: { probeHits: safeMiss[0]?.n ?? 0, pass: (safeMiss[0]?.n ?? 0) === 0 },
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
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 400), courtListenerHttpCalls: 0 }));
  process.exit(1);
});
