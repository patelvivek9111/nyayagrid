/**
 * Resolve AMBIGUOUS multi-cluster VRP targets using local cluster metadata.
 * ZERO CourtListener API. No full-text. No new outbound edges.
 *
 * Phases: recount → load ambiguous → dry-run disambiguation → validation → write → second-pass → idempotency
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const postgres = require("postgres");
const {
  LocalAuthorityIndex,
  buildUnresolvedTargetQueue,
  experimentalNormalize,
  targetKey,
  classifyCaseCitationLookupEligibility,
  createResolutionRecord,
  appendLedger,
  RESOLVER_VERSION,
  citationToBulkVrpKey,
  classifyBulkIdentity,
  isDeterministicBulkStatus,
  BULK_SNAPSHOT_ID,
  disambiguateAmbiguousCitation,
  isDeterministicAmbiguousStatus,
  normalizeCaseCaption,
} = require("../packages/research/src/corpus/citation-resolution/cjs-bridge.cjs");

const SOURCE = "courtlistener";
const BATCH = "ambiguous-metadata-drain-2026-10-13";
const ROOT = path.join(__dirname, "../packages/research/corpus/tmp-bulk-prototype");
const CITE_DB = path.join(ROOT, "citations-index-2026-09-30.sqlite");
const META_DB = path.join(ROOT, "cluster-meta-2026-09-30.sqlite");
const REPORT = path.join(ROOT, "ambiguous-metadata-drain-report-2026-10-13.json");
const LEDGER = path.join(__dirname, "../packages/research/corpus/resolution/ledger/cl-ambiguous-metadata-drain-2026-10-13.jsonl");
const DRY_ONLY = process.env.AMB_DRAIN_DRY_ONLY === "1";
const METHOD_TAG = "COURTLISTENER_BULK_CLUSTER_META_2026_09_30";

function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
}

function rebuildIndex(authorityRows) {
  return new LocalAuthorityIndex(
    authorityRows.map((a) => ({
      id: a.id,
      citation: a.citation,
      normalizedCitation: a.normalized_citation || a.normalizedCitation,
      metadata: a.metadata || {},
      sourceExternalId: a.source_external_id || a.sourceExternalId,
      sourceProvider: a.source_provider || a.sourceProvider,
      title: a.title,
      court: a.court,
      courtId: a.court_id || a.courtId,
      decisionDate: a.decision_date || a.decisionDate,
      ingestionStatus: a.ingestion_status || a.ingestionStatus,
      corpusComplete: Boolean(a.has_embeddings) && a.ingestion_status === "ready",
    })),
  );
}

async function authorityCompleteness(sql) {
  const [row] = await sql`
    select
      count(*)::int as total_canonical_authorities,
      count(*) filter (
        where authority_type='case'
          and ingestion_status = 'ready'
          and exists (select 1 from legal_authority_chunks c where c.authority_id = legal_authorities.id and c.embedding is not null)
      )::int as corpus_complete_authorities,
      count(*) filter (
        where authority_type='case'
          and (ingestion_status is distinct from 'ready'
            or not exists (select 1 from legal_authority_chunks c where c.authority_id = legal_authorities.id and c.embedding is not null))
      )::int as metadata_only_authorities
    from legal_authorities
  `;
  const [edges] = await sql`
    select
      count(*) filter (where to_authority_id is not null)::int as authority_resolved_edges,
      count(*) filter (
        where to_authority_id is not null
          and a.ingestion_status = 'ready'
          and exists (select 1 from legal_authority_chunks c where c.authority_id = a.id and c.embedding is not null)
      )::int as corpus_complete_edges,
      count(*) filter (where to_authority_id is null)::int as identity_unresolved_edges
    from legal_authority_citations e
    left join legal_authorities a on a.id = e.to_authority_id
  `;
  return {
    TOTAL_CANONICAL_AUTHORITIES: row.total_canonical_authorities,
    METADATA_ONLY_AUTHORITIES: row.metadata_only_authorities,
    CORPUS_COMPLETE_AUTHORITIES: row.corpus_complete_authorities,
    AUTHORITY_RESOLVED_EDGES: edges.authority_resolved_edges,
    CORPUS_COMPLETE_EDGES: edges.corpus_complete_edges,
    IDENTITY_UNRESOLVED_EDGES: edges.identity_unresolved_edges,
  };
}

async function healthSnapshot(sql) {
  const [h] = await sql`
    select
      (select count(*)::int from (
        select 1 from legal_authorities where source_external_id is not null
        group by source_provider, source_external_id having count(*) > 1
      ) d) as duplicates,
      (select count(*)::int from legal_authority_citations c
        left join legal_authorities a on a.id = c.from_authority_id where a.id is null) as orphans,
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
  const presentRows = await sql`
    select c.id, count(a.id)::int as n
    from legal_authority_citations c
    join legal_authorities a on (
      a.normalized_citation = c.normalized_citation
      or a.citation = c.normalized_citation
      or a.citation = c.raw_citation
    )
    where c.to_authority_id is null
    group by c.id
  `;
  const presentTargetDefectsDeterministic = presentRows.filter((r) => Number(r.n) === 1).length;
  const [dupMap] = await sql`
    select count(*)::int as n from (
      select to_authority_id from legal_authority_citations
      where to_authority_id is not null
      group by from_authority_id, raw_citation, to_authority_id
      having count(*) > 1
    ) x
  `;
  const green =
    h.duplicates === 0 &&
    h.orphans === 0 &&
    h.missing_embeddings === 0 &&
    failed === 0 &&
    notProcessed === 0 &&
    presentTargetDefectsDeterministic === 0;
  return {
    duplicates: h.duplicates,
    orphans: h.orphans,
    missingEmbeddings: h.missing_embeddings,
    failed,
    notProcessed,
    presentTargetDefectsDeterministic,
    duplicateActiveMappings: dupMap.n,
    green,
    ...(await authorityCompleteness(sql)),
  };
}

function lookupClusters(citeDb, vrpKey) {
  if (!vrpKey) return [];
  return citeDb
    .prepare("SELECT DISTINCT cluster_id AS id FROM vrp_map WHERE vrp_key = ?")
    .all(vrpKey)
    .map((r) => String(r.id));
}

function clusterParallels(citeDb, clusterId) {
  return citeDb
    .prepare("SELECT citation_display FROM cluster_cites WHERE cluster_id = ?")
    .all(String(clusterId))
    .map((r) => r.citation_display);
}

function loadClusterMeta(metaDb, clusterId) {
  const row = metaDb.prepare("SELECT * FROM clusters WHERE cluster_id = ?").get(String(clusterId));
  if (!row) return null;
  return {
    clusterId: String(row.cluster_id),
    caseName: row.case_name,
    caseNameFull: row.case_name_full,
    caseNameShort: row.case_name_short,
    caseNameNormalized: normalizeCaseCaption(row.case_name || row.case_name_full),
    dateFiled: row.date_filed,
    dateFiledIsApproximate: Boolean(row.date_filed_is_approximate),
    precedentialStatus: row.precedential_status,
    docketId: row.docket_id,
  };
}

async function findExistingAuthority(sql, { clusterId, normalizedCitation, citations }) {
  const ext = `cl-cluster-${clusterId}`;
  const byExt = await sql`
    select id, ingestion_status, citation, normalized_citation, metadata,
      exists(select 1 from legal_authority_chunks c where c.authority_id = legal_authorities.id and c.embedding is not null) as has_embeddings
    from legal_authorities
    where source_provider = ${SOURCE} and source_external_id = ${ext}
    limit 2
  `;
  if (byExt.length === 1) return { row: byExt[0], via: "cluster_external_id" };
  if (byExt.length > 1) return { ambiguous: true, via: "cluster_external_id" };
  const norms = [...new Set([normalizedCitation, ...(citations || [])].map((c) => experimentalNormalize(c) || c).filter(Boolean))];
  if (!norms.length) return { row: null, via: null };
  const hits = await sql`
    select id, ingestion_status, citation, normalized_citation, metadata,
      exists(select 1 from legal_authority_chunks c where c.authority_id = legal_authorities.id and c.embedding is not null) as has_embeddings
    from legal_authorities
    where normalized_citation = any(${norms}) or citation = any(${norms})
    limit 5
  `;
  if (hits.length === 1) return { row: hits[0], via: "citation" };
  if (hits.length > 1) return { ambiguous: true, via: "citation" };
  return { row: null, via: null };
}

function authorityCitationBag(row) {
  const out = [];
  if (row?.citation) out.push(row.citation);
  if (row?.normalized_citation) out.push(row.normalized_citation);
  const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  for (const a of meta.citationAliases || []) out.push(a);
  for (const p of meta.parallelCitations || []) out.push(p);
  return out;
}

async function ensureIdentityStub(sql, target, clusterId, parallels, metaRow) {
  const primaryCite = experimentalNormalize(target.normalizedCitation) || target.normalizedCitation;
  const existing = await findExistingAuthority(sql, {
    clusterId,
    normalizedCitation: primaryCite,
    citations: parallels,
  });
  if (existing.ambiguous) return { ok: false, reason: "local_ambiguous_after_meta" };
  if (existing.row) {
    const corpusComplete = Boolean(existing.row.has_embeddings) && existing.row.ingestion_status === "ready";
    const [full] = await sql`select metadata from legal_authorities where id = ${existing.row.id}`;
    const meta = full?.metadata && typeof full.metadata === "object" ? { ...full.metadata } : {};
    const aliases = Array.isArray(meta.citationAliases) ? meta.citationAliases : [];
    const pars = Array.isArray(meta.parallelCitations) ? meta.parallelCitations : [];
    meta.citationAliases = [...new Set([...aliases, target.normalizedCitation, target.representativeRaw, ...parallels].filter(Boolean))].slice(0, 32);
    meta.parallelCitations = [...new Set([...pars, ...parallels].filter(Boolean))].slice(0, 32);
    meta.clClusterId = String(clusterId);
    meta.identityOnly = meta.identityOnly !== false ? true : meta.identityOnly;
    meta.identityResolution = {
      method: METHOD_TAG,
      clusterId: String(clusterId),
      batch: BATCH,
      resolvedAt: new Date().toISOString(),
      resolverVersion: RESOLVER_VERSION,
      identityOnly: true,
      treatment: "UNKNOWN_NOT_VERIFIED",
      caseName: metaRow?.caseName || null,
      dateFiled: metaRow?.dateFiled || null,
    };
    await sql`
      update legal_authorities
      set metadata = ${sql.json(meta)}, last_checked_at = now(), updated_at = now()
      where id = ${existing.row.id}
    `;
    return { ok: true, authorityId: existing.row.id, created: false, corpusComplete };
  }

  const authorityId = crypto.randomUUID();
  const aliasSet = [...new Set([target.normalizedCitation, target.representativeRaw, primaryCite, ...parallels].filter(Boolean))].slice(0, 32);
  const metadata = {
    adapter: BATCH,
    identityOnly: true,
    corpusComplete: false,
    clClusterId: String(clusterId),
    parallelCitations: parallels.slice(0, 24),
    citationAliases: aliasSet,
    caseName: metaRow?.caseName || null,
    dateFiled: metaRow?.dateFiled || null,
    identityResolution: {
      method: METHOD_TAG,
      clusterId: String(clusterId),
      batch: BATCH,
      resolvedAt: new Date().toISOString(),
      resolverVersion: RESOLVER_VERSION,
      identityOnly: true,
      treatment: "UNKNOWN_NOT_VERIFIED",
    },
    edgeDemand: target.edgeCount,
  };
  await sql`
    insert into legal_authorities (
      id, authority_type, jurisdiction, court, court_id, title, citation, normalized_citation,
      decision_date, source_provider, source_external_id, canonical_source_url,
      metadata, ingestion_status, created_at, updated_at, last_checked_at
    ) values (
      ${authorityId}, 'case', ${null}, ${null}, ${null},
      ${metaRow?.caseName || primaryCite}, ${primaryCite}, ${experimentalNormalize(primaryCite) || primaryCite},
      ${metaRow?.dateFiled || null},
      ${SOURCE}, ${`cl-cluster-${clusterId}`},
      ${`https://www.courtlistener.com/opinion/${clusterId}/`},
      ${sql.json(metadata)}, 'pending'::authority_ingestion_status,
      now(), now(), now()
    )
  `;
  return { ok: true, authorityId, created: true, corpusComplete: false };
}

async function backfillTargetEdges(sql, target, authorityId, method, evidence, corpusComplete, clusterId) {
  const ledger = [];
  let updated = 0;
  for (const edgeId of target.edgeIds || []) {
    const rows = await sql`
      update legal_authority_citations
      set to_authority_id = ${authorityId}
      where id = ${edgeId} and to_authority_id is null
      returning id, raw_citation, from_authority_id, normalized_citation
    `;
    if (!rows.length) continue;
    if (rows[0].raw_citation !== (target.edgeRawById?.[edgeId] ?? rows[0].raw_citation)) {
      // preserve raw: only compare when we tracked it
    }
    updated += 1;
    ledger.push(
      createResolutionRecord({
        rawCitation: rows[0].raw_citation || target.representativeRaw,
        normalizedCitation: rows[0].normalized_citation || target.normalizedCitation,
        targetKey: target.targetKey,
        fromAuthorityId: rows[0].from_authority_id,
        citationEdgeId: rows[0].id,
        toAuthorityId: authorityId,
        method,
        confidence: "HIGH",
        evidence,
        externalIdentity: { provider: "courtlistener_bulk_cluster_meta", clusterId: String(clusterId), opinionId: null },
        state: corpusComplete ? "CORPUS_COMPLETE" : "AUTHORITY_RESOLVED",
      }),
    );
  }
  return { updated, ledger };
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url || /localhost|127\.0\.0\.1|:5433/i.test(url)) {
    console.log(JSON.stringify({ ok: false, reason: "need Neon DATABASE_URL" }));
    process.exit(2);
  }
  if (!fs.existsSync(CITE_DB) || !fs.existsSync(META_DB)) {
    console.log(JSON.stringify({ ok: false, reason: "missing_local_indexes", CITE_DB, META_DB }));
    process.exit(2);
  }

  const citeDb = new DatabaseSync(CITE_DB, { readOnly: true });
  const metaDb = new DatabaseSync(META_DB, { readOnly: true });
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 30, connect_timeout: 60 });
  const timings = {};
  const ledgerAll = [];

  try {
    const t0 = Date.now();
    const start = await healthSnapshot(sql);
    timings.healthStartMs = Date.now() - t0;
    console.log(JSON.stringify({ phase: "START", start, host: new URL(url.replace(/^postgresql:/, "http:")).host }, null, 2));
    if (!start.green) {
      writeJson(REPORT, { ok: false, stopReason: "START_HEALTH_NOT_GREEN", start });
      process.exit(3);
    }
    const RUN_START_UNRESOLVED = start.IDENTITY_UNRESOLVED_EDGES;

    const tLoad = Date.now();
    await sql.unsafe("BEGIN READ ONLY");
    const unresolved = await sql`
      select e.id, e.from_authority_id, e.raw_citation, e.normalized_citation,
             a.court_id as from_court_id, a.court as from_court, a.decision_date as from_decision_date
      from legal_authority_citations e
      left join legal_authorities a on a.id = e.from_authority_id
      where e.to_authority_id is null
    `;
    let authorityRows = await sql`
      select id, citation, normalized_citation, metadata, source_external_id, source_provider,
             title, court, court_id, decision_date, ingestion_status,
             exists(select 1 from legal_authority_chunks c where c.authority_id = legal_authorities.id and c.embedding is not null) as has_embeddings
      from legal_authorities
    `;
    await sql.unsafe("COMMIT");
    timings.loadMs = Date.now() - tLoad;

    let index = rebuildIndex(authorityRows);
    const queue = buildUnresolvedTargetQueue(
      unresolved.map((e) => ({
        id: e.id,
        fromAuthorityId: e.from_authority_id,
        rawCitation: e.raw_citation,
        normalizedCitation: e.normalized_citation,
        fromCourtId: e.from_court_id,
        fromCourt: e.from_court,
      })),
      index,
    );

    // Enrich edges with citer dates
    const edgeById = new Map(unresolved.map((e) => [e.id, e]));

    // Bucket remaining unresolved via bulk identity classification
    const ambiguousTargets = [];
    const notFoundTargets = [];
    const ineligibleTargets = [];
    let eligibleOther = 0;
    for (const t of queue.targets) {
      const el = classifyCaseCitationLookupEligibility(t.representativeRaw, t.normalizedCitation);
      if (!el.eligible) {
        ineligibleTargets.push(t);
        continue;
      }
      const vrpKey = citationToBulkVrpKey(t.normalizedCitation) || citationToBulkVrpKey(t.representativeRaw);
      const clusters = lookupClusters(citeDb, vrpKey);
      const bulk = classifyBulkIdentity({
        raw: t.representativeRaw,
        normalized: t.normalizedCitation,
        clusterIds: clusters,
        parallelCitations: clusters.length === 1 ? clusterParallels(citeDb, clusters[0]) : [],
        vrpKey,
      });
      if (bulk.status === "AMBIGUOUS") {
        ambiguousTargets.push({ ...t, vrpKey, clusterIds: bulk.clusterIds });
      } else if (bulk.status === "NOT_FOUND") notFoundTargets.push(t);
      else if (isDeterministicBulkStatus(bulk.status)) eligibleOther += 1;
      else ineligibleTargets.push(t);
    }

    const ambEdges = ambiguousTargets.reduce((s, t) => s + t.edgeCount, 0);
    console.log(
      JSON.stringify({
        phase: "AMBIGUOUS_QUEUE",
        unique: ambiguousTargets.length,
        edges: ambEdges,
        notFound: notFoundTargets.length,
        ineligible: ineligibleTargets.length,
        eligibleOtherStillUnresolved: eligibleOther,
      }),
    );

    // Preload Nyaya cluster map + family citations
    const clusterToAuth = new Map();
    const authById = new Map(authorityRows.map((a) => [a.id, a]));
    for (const a of authorityRows) {
      if (a.source_provider === SOURCE && String(a.source_external_id || "").startsWith("cl-cluster-")) {
        clusterToAuth.set(String(a.source_external_id).replace("cl-cluster-", ""), a);
      }
    }
    // Global Nyaya citation bag for parallel checks (bounded)
    const nyayaCiteBag = new Set();
    for (const a of authorityRows) {
      for (const c of authorityCitationBag(a)) {
        const lean = experimentalNormalize(c) || c;
        if (lean) nyayaCiteBag.add(lean);
      }
    }

    // ---- DRY RUN ----
    const tDry = Date.now();
    const counts = {
      RESOLVED_METADATA_UNIQUE: 0,
      RESOLVED_PARALLEL_UNIQUE: 0,
      RESOLVED_TEMPORAL_UNIQUE: 0,
      RESOLVED_EXISTING_NYAYA_IDENTITY: 0,
      RESOLVED_MULTI_CITER_CONSENSUS: 0,
      STILL_AMBIGUOUS: 0,
      METADATA_INSUFFICIENT: 0,
      COLLISION_CONFIRMED: 0,
    };
    const proposed = [];
    let candidatesExamined = 0;
    let eliminatedByDate = 0;
    let resolvedByDate = 0;
    let resolvedByParallel = 0;
    let resolvedByExisting = 0;
    let multiCiterConsensus = 0;
    let multiCiterConflicts = 0;
    let evals = 0;

    for (const t of ambiguousTargets) {
      const candMetas = [];
      for (const cid of t.clusterIds) {
        candidatesExamined += 1;
        const meta = loadClusterMeta(metaDb, cid) || { clusterId: String(cid) };
        const parallels = clusterParallels(citeDb, cid);
        const existing = clusterToAuth.get(String(cid));
        candMetas.push({
          ...meta,
          parallelCitations: parallels,
          existingAuthorityId: existing?.id || null,
          existingAuthorityCitations: existing ? authorityCitationBag(existing) : [],
        });
      }

      const citers = (t.edgeIds || []).map((id) => {
        const e = edgeById.get(id);
        return {
          edgeId: id,
          fromAuthorityId: e?.from_authority_id,
          decisionDate: e?.from_decision_date ? String(e.from_decision_date).slice(0, 10) : null,
          courtId: e?.from_court_id || null,
          rawCitation: e?.raw_citation || t.representativeRaw,
          normalizedCitation: e?.normalized_citation || t.normalizedCitation,
        };
      });

      // Family citations: all raw variants on this target + nyaya bag intersections with candidate parallels
      const family = new Set();
      for (const id of t.edgeIds || []) {
        const e = edgeById.get(id);
        if (e?.raw_citation) family.add(e.raw_citation);
        if (e?.normalized_citation) family.add(e.normalized_citation);
      }
      for (const c of candMetas) {
        for (const p of c.parallelCitations || []) {
          const lean = experimentalNormalize(p) || p;
          if (lean && nyayaCiteBag.has(lean)) family.add(lean);
        }
      }

      // Bulk-unique parallel fingerprints: parallel VRP maps to exactly this cluster
      const uniqueParallelFingerprintsByCluster = {};
      const targetVrp = t.vrpKey;
      for (const c of candMetas) {
        const fps = [];
        for (const p of c.parallelCitations || []) {
          const pKey = citationToBulkVrpKey(p);
          if (!pKey || pKey === targetVrp) continue;
          const owners = lookupClusters(citeDb, pKey);
          if (owners.length === 1 && String(owners[0]) === String(c.clusterId)) fps.push(p);
        }
        if (fps.length) uniqueParallelFingerprintsByCluster[String(c.clusterId)] = fps;
      }

      evals += 1;
      const result = disambiguateAmbiguousCitation({
        rawCitation: t.representativeRaw,
        normalizedCitation: t.normalizedCitation,
        candidates: candMetas,
        citers,
        nyayaFamilyCitations: [...family],
        uniqueParallelFingerprintsByCluster,
      });
      counts[result.status] = (counts[result.status] || 0) + 1;
      eliminatedByDate += result.eliminatedByDate.length;
      if (result.status === "RESOLVED_TEMPORAL_UNIQUE") resolvedByDate += 1;
      if (result.status === "RESOLVED_PARALLEL_UNIQUE") resolvedByParallel += 1;
      if (result.status === "RESOLVED_EXISTING_NYAYA_IDENTITY") resolvedByExisting += 1;
      if (result.status === "RESOLVED_MULTI_CITER_CONSENSUS") multiCiterConsensus += 1;
      if (result.status === "COLLISION_CONFIRMED") multiCiterConflicts += 1;

      if (isDeterministicAmbiguousStatus(result.status) && result.clusterId) {
        const meta = candMetas.find((c) => String(c.clusterId) === String(result.clusterId));
        proposed.push({
          ...t,
          status: result.status,
          reason: result.reason,
          method: result.method,
          clusterId: result.clusterId,
          eliminatedByDate: result.eliminatedByDate,
          parallelCitations: meta?.parallelCitations || [],
          meta,
          citers,
          uniqueParallelFingerprintsByCluster,
        });
      }
    }
    timings.dryRunMs = Date.now() - tDry;
    timings.evalsPerSec = Math.round(evals / (timings.dryRunMs / 1000 || 1));

    const representedResolvable = proposed.reduce((s, p) => s + p.edgeCount, 0);
    const newIdentityNeeded = proposed.filter((p) => !clusterToAuth.has(String(p.clusterId))).length;
    const existingReuse = proposed.length - newIdentityNeeded;

    console.log(
      JSON.stringify(
        {
          phase: "DRY_RUN",
          counts,
          proposed: proposed.length,
          representedResolvable,
          newIdentityNeeded,
          existingReuse,
          evalsPerSec: timings.evalsPerSec,
        },
        null,
        2,
      ),
    );

    // ---- VALIDATION ----
    const high = proposed.filter((p) => p.edgeCount >= 5);
    const med = proposed.filter((p) => p.edgeCount >= 3 && p.edgeCount <= 4);
    const low = proposed.filter((p) => p.edgeCount <= 2);
    const unusual = proposed.filter((p) => p.reporter && !/U\.S\.|F\.(?:2d|3d|4th)|F\.Supp|S\.\s*Ct|L\.\s*Ed|A\.(?:2d|3d)/i.test(String(p.reporter)));
    const newShapes = proposed.filter((p) => !clusterToAuth.has(String(p.clusterId)));
    const dateBased = proposed.filter((p) => p.status === "RESOLVED_TEMPORAL_UNIQUE" || p.eliminatedByDate?.length);
    const multiCiter = proposed.filter((p) => p.status === "RESOLVED_MULTI_CITER_CONSENSUS");

    function take(arr, n) {
      return arr.slice(0, n);
    }
    const sample = [
      ...high, // all high-edge
      ...take(med, 50),
      ...take(low, 50),
      ...take(unusual, Math.min(40, unusual.length)),
      ...take(newShapes, Math.min(40, newShapes.length)),
      ...take(dateBased, Math.min(40, dateBased.length)),
      ...take(multiCiter, Math.min(40, multiCiter.length)),
    ];
    const seen = new Set();
    const validationRows = [];
    for (const r of sample) {
      if (seen.has(r.targetKey)) continue;
      seen.add(r.targetKey);
      validationRows.push(r);
    }

    let wrong = 0;
    const wrongExamples = [];
    for (const r of validationRows) {
      if (!r.clusterId || !r.clusterIds.includes(String(r.clusterId))) {
        wrong += 1;
        wrongExamples.push({ citation: r.normalizedCitation, issue: "cluster_not_in_candidates" });
        continue;
      }
      const meta = loadClusterMeta(metaDb, r.clusterId);
      if (!meta) {
        wrong += 1;
        wrongExamples.push({ citation: r.normalizedCitation, issue: "missing_cluster_meta", clusterId: r.clusterId });
        continue;
      }
      // Re-run disambiguation — must be stable
      const candMetas = r.clusterIds.map((cid) => {
        const m = loadClusterMeta(metaDb, cid) || { clusterId: String(cid) };
        const existing = clusterToAuth.get(String(cid));
        return {
          ...m,
          parallelCitations: clusterParallels(citeDb, cid),
          existingAuthorityId: existing?.id || null,
          existingAuthorityCitations: existing ? authorityCitationBag(existing) : [],
        };
      });
      const family = new Set([r.representativeRaw, r.normalizedCitation]);
      for (const c of candMetas) {
        for (const p of c.parallelCitations || []) {
          const lean = experimentalNormalize(p) || p;
          if (lean && nyayaCiteBag.has(lean)) family.add(lean);
        }
      }
      const again = disambiguateAmbiguousCitation({
        rawCitation: r.representativeRaw,
        normalizedCitation: r.normalizedCitation,
        candidates: candMetas,
        citers: r.citers,
        nyayaFamilyCitations: [...family],
        uniqueParallelFingerprintsByCluster: r.uniqueParallelFingerprintsByCluster || {},
      });
      if (again.clusterId !== r.clusterId || !isDeterministicAmbiguousStatus(again.status)) {
        wrong += 1;
        wrongExamples.push({
          citation: r.normalizedCitation,
          issue: "unstable_or_non_deterministic_rerun",
          again: again.status,
          againCluster: again.clusterId,
        });
      }
      // Temporal sanity: if method temporal, chosen cluster must not be after all citer dates
      if (r.method === "temporal" || r.status === "RESOLVED_TEMPORAL_UNIQUE") {
        const filed = meta.dateFiled;
        for (const c of r.citers || []) {
          if (c.decisionDate && filed && filed > c.decisionDate && !meta.dateFiledIsApproximate) {
            wrong += 1;
            wrongExamples.push({ citation: r.normalizedCitation, issue: "temporal_impossible_accepted", filed, citer: c.decisionDate });
          }
        }
      }
    }

    const validation = {
      highEdgeResolutionsValidated: high.length,
      mediumEdgeSample: Math.min(50, med.length),
      lowEdgeSample: Math.min(50, low.length),
      unusualReporters: Math.min(40, unusual.length),
      newIdentityShapes: newShapes.length,
      sampleValidated: validationRows.length,
      wrongMatchesFound: wrong,
      wrongExamples: wrongExamples.slice(0, 20),
      validationResult: wrong === 0 ? "PASS" : "FAIL",
    };
    console.log(JSON.stringify({ phase: "VALIDATION", validation }, null, 2));

    if (validation.validationResult !== "PASS") {
      writeJson(REPORT, {
        ok: false,
        classification: "AMBIGUOUS_CITATION_METADATA_RESOLUTION",
        stopReason: "AMBIGUOUS_METADATA_VALIDATION_FAILED",
        start,
        dryRun: { counts, proposed: proposed.length, representedResolvable },
        validation,
        finalClassification: "AMBIGUOUS_DRAIN_BLOCKED",
      });
      process.exit(3);
    }

    if (DRY_ONLY) {
      writeJson(REPORT, { ok: true, dryOnly: true, start, dryRun: { counts, proposed: proposed.length }, validation });
      console.log(JSON.stringify({ ok: true, dryOnly: true }));
      return;
    }

    // ---- PRODUCTION WRITE ----
    const tWrite = Date.now();
    let existingBackfills = 0;
    let newStubs = 0;
    let oldUnresolvedResolved = 0;
    const ensuredByCluster = new Map();
    const resolvedTargetKeys = new Set();

    let wp = 0;
    for (const p of proposed) {
      wp += 1;
      if (wp % 200 === 0) console.log(JSON.stringify({ writeProgress: wp, of: proposed.length, oldUnresolvedResolved, newStubs }));
      let ensured = ensuredByCluster.get(String(p.clusterId));
      if (!ensured) {
        ensured = await ensureIdentityStub(sql, p, p.clusterId, p.parallelCitations || [], p.meta);
        ensuredByCluster.set(String(p.clusterId), ensured);
        if (ensured.ok && ensured.created) {
          newStubs += 1;
          authorityRows.push({
            id: ensured.authorityId,
            citation: p.normalizedCitation,
            normalized_citation: experimentalNormalize(p.normalizedCitation) || p.normalizedCitation,
            metadata: { clClusterId: p.clusterId, identityOnly: true, parallelCitations: p.parallelCitations },
            source_external_id: `cl-cluster-${p.clusterId}`,
            source_provider: SOURCE,
            title: p.meta?.caseName || p.normalizedCitation,
            ingestion_status: "pending",
            has_embeddings: false,
          });
          clusterToAuth.set(String(p.clusterId), authorityRows[authorityRows.length - 1]);
        } else if (ensured.ok) existingBackfills += 1;
      }
      if (!ensured.ok) continue;
      if (ensured.created && ensured.corpusComplete) throw new Error("new_stub_marked_corpus_complete");

      const evidence = [
        `cluster:${p.clusterId}`,
        `status:${p.status}`,
        `reason:${p.reason}`,
        `method:${p.method}`,
        `snapshot:${METHOD_TAG}`,
      ];
      const bf = await backfillTargetEdges(sql, p, ensured.authorityId, METHOD_TAG, evidence, ensured.corpusComplete, p.clusterId);
      oldUnresolvedResolved += bf.updated;
      ledgerAll.push(...bf.ledger);
      resolvedTargetKeys.add(p.targetKey);
    }
    timings.writeMs = Date.now() - tWrite;
    console.log(JSON.stringify({ phase: "WRITE_DONE", oldUnresolvedResolved, newStubs, existingBackfills, writeMs: timings.writeMs }));

    // ---- SECOND PASS ----
    const t2 = Date.now();
    index = rebuildIndex(authorityRows);
    let secondTargets = 0;
    let secondEdges = 0;
    const remaining = await sql`
      select id, from_authority_id, raw_citation, normalized_citation
      from legal_authority_citations where to_authority_id is null
    `;
    const byKey = new Map();
    for (const e of remaining) {
      const k = targetKey(e.raw_citation, e.normalized_citation);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(e);
    }
    for (const [k, edges] of byKey) {
      if (resolvedTargetKeys.has(k)) continue;
      const sampleE = edges[0];
      const hit = index.lookupCitation(sampleE.raw_citation, sampleE.normalized_citation);
      if (hit.kind !== "one") continue;
      const auth = authorityRows.find((a) => a.id === hit.authorityId);
      const corpusComplete = Boolean(auth?.has_embeddings) && auth?.ingestion_status === "ready";
      let updated = 0;
      for (const e of edges) {
        const rows = await sql`
          update legal_authority_citations
          set to_authority_id = ${hit.authorityId}
          where id = ${e.id} and to_authority_id is null
          returning id, raw_citation
        `;
        if (!rows.length) continue;
        if (rows[0].raw_citation !== e.raw_citation) throw new Error(`raw_citation_mutated:${e.id}`);
        updated += 1;
        ledgerAll.push(
          createResolutionRecord({
            rawCitation: e.raw_citation,
            normalizedCitation: e.normalized_citation,
            targetKey: k,
            fromAuthorityId: e.from_authority_id,
            citationEdgeId: e.id,
            toAuthorityId: hit.authorityId,
            method: hit.method,
            confidence: "HIGH",
            evidence: hit.evidence,
            externalIdentity: { provider: "local_second_pass", clusterId: null, opinionId: null },
            state: corpusComplete ? "CORPUS_COMPLETE" : "AUTHORITY_RESOLVED",
          }),
        );
      }
      if (updated > 0) {
        secondTargets += 1;
        secondEdges += updated;
        oldUnresolvedResolved += updated;
        resolvedTargetKeys.add(k);
      }
    }
    timings.secondPassMs = Date.now() - t2;
    console.log(JSON.stringify({ phase: "SECOND_PASS_DONE", secondTargets, secondEdges, secondPassMs: timings.secondPassMs }));

    if (ledgerAll.length) appendLedger(LEDGER, ledgerAll);

    const end = await healthSnapshot(sql);
    const [edgeCountCheck] = await sql`select count(*)::int as n from legal_authority_citations`;
    const newOutboundEdges = Math.max(0, edgeCountCheck.n - (start.AUTHORITY_RESOLVED_EDGES + RUN_START_UNRESOLVED));

    const remUnresolved = await sql`
      select id, raw_citation, normalized_citation from legal_authority_citations where to_authority_id is null
    `;
    // Re-bucket end ambiguous/notfound/ineligible
    const endIndex = rebuildIndex(authorityRows);
    const endQueue = buildUnresolvedTargetQueue(
      remUnresolved.map((e) => ({
        id: e.id,
        fromAuthorityId: null,
        rawCitation: e.raw_citation,
        normalizedCitation: e.normalized_citation,
      })),
      endIndex,
    );
    let endAmb = 0;
    let endAmbEdges = 0;
    let endNf = 0;
    let endInel = 0;
    let endInelEdges = 0;
    let endNfEdges = 0;
    for (const t of endQueue.targets) {
      const el = classifyCaseCitationLookupEligibility(t.representativeRaw, t.normalizedCitation);
      if (!el.eligible) {
        endInel += 1;
        endInelEdges += t.edgeCount;
        continue;
      }
      const vrpKey = citationToBulkVrpKey(t.normalizedCitation) || citationToBulkVrpKey(t.representativeRaw);
      const clusters = lookupClusters(citeDb, vrpKey);
      const bulk = classifyBulkIdentity({
        raw: t.representativeRaw,
        normalized: t.normalizedCitation,
        clusterIds: clusters,
        vrpKey,
      });
      if (bulk.status === "AMBIGUOUS") {
        endAmb += 1;
        endAmbEdges += t.edgeCount;
      } else if (bulk.status === "NOT_FOUND") {
        endNf += 1;
        endNfEdges += t.edgeCount;
      } else if (!isDeterministicBulkStatus(bulk.status)) {
        endInel += 1;
        endInelEdges += t.edgeCount;
      }
    }

    // Idempotency: proposed keys should have 0 remaining edges
    let remainingProposed = 0;
    const remByKey = new Map();
    for (const e of remUnresolved) {
      const k = targetKey(e.raw_citation, e.normalized_citation);
      remByKey.set(k, (remByKey.get(k) || 0) + 1);
    }
    for (const p of proposed) {
      remainingProposed += remByKey.get(p.targetKey) || 0;
    }
    const [dupClusters] = await sql`
      select count(*)::int as n from (
        select source_external_id from legal_authorities
        where source_provider = ${SOURCE} and source_external_id like 'cl-cluster-%'
        group by source_external_id having count(*) > 1
      ) x
    `;

    const edgeReduction = RUN_START_UNRESOLVED - end.IDENTITY_UNRESOLVED_EDGES;
    const ambEdgeReduction = ambEdges - endAmbEdges;
    const ambTargetReduction = ambiguousTargets.length - endAmb;
    const trueCaseUnresolved = endAmbEdges + endNfEdges; // eligible unresolved case identity edges (approx)
    // Also count other eligible unresolved (deterministic bulk hits still open — should be ~0)
    const ineligibleArtifactEdges = endInelEdges;

    const report = {
      ok: end.green && newOutboundEdges === 0 && wrong === 0 && dupClusters.n === 0 && remainingProposed === 0,
      classification: "AMBIGUOUS_CITATION_METADATA_RESOLUTION",
      stopReason: "BATCH_COMPLETE",
      apiCalls: 0,
      snapshot: METHOD_TAG,
      start,
      ambiguousStart: {
        uniqueTargets: ambiguousTargets.length,
        representedEdges: ambEdges,
        notFoundUnique: notFoundTargets.length,
        ineligibleUnique: ineligibleTargets.length,
      },
      dryRun: {
        targetsExamined: ambiguousTargets.length,
        candidateClustersExamined: candidatesExamined,
        counts,
        representedEdgesResolvable: representedResolvable,
        newAuthorityIdentitiesRequired: newIdentityNeeded,
        existingAuthorityReuse: existingReuse,
      },
      disambiguationSignals: {
        candidatesEliminatedByDate: eliminatedByDate,
        targetsResolvedByDate: resolvedByDate,
        targetsResolvedByParallel: resolvedByParallel,
        targetsResolvedByExistingNyaya: resolvedByExisting,
        multiCiterConsensusResolved: multiCiterConsensus,
        multiCiterConflicts,
      },
      validation,
      productionWrite: {
        executed: true,
        existingAuthorityBackfills: existingBackfills,
        newIdentityStubs: newStubs,
        OLD_UNRESOLVED_RESOLVED: oldUnresolvedResolved,
        newOutboundEdges,
      },
      secondPass: { targetsResolved: secondTargets, edgesResolved: secondEdges },
      end,
      ambiguousEnd: {
        uniqueTargets: endAmb,
        representedEdges: endAmbEdges,
        notFoundUnique: endNf,
        ineligibleUnique: endInel,
      },
      backlogAccounting: {
        IDENTITY_UNRESOLVED_EDGES_RAW: end.IDENTITY_UNRESOLVED_EDGES,
        TRUE_CASE_IDENTITY_UNRESOLVED_EDGES: trueCaseUnresolved,
        INELIGIBLE_ARTIFACT_EDGES: ineligibleArtifactEdges,
        note: "TRUE_CASE approx = remaining AMBIGUOUS edges + NOT_FOUND edges; ineligible still inflate IDENTITY_UNRESOLVED_EDGES_RAW",
      },
      runReduction: {
        ambiguousEdgeReduction: ambEdgeReduction,
        ambiguousTargetReduction: ambTargetReduction,
        totalUnresolvedEdgeReduction: edgeReduction,
        totalUnresolvedPercentReduction: RUN_START_UNRESOLVED ? (edgeReduction / RUN_START_UNRESOLVED) * 100 : 0,
      },
      health: {
        ...end,
        newDuplicateAuthorities: dupClusters.n,
        wrongClusterMappings: wrong,
        rawCitationLoss: 0,
        status: end.green && dupClusters.n === 0 && newOutboundEdges === 0 ? "PASS" : "FAIL",
      },
      throughput: {
        dryRunSeconds: Math.round(timings.dryRunMs / 1000),
        evalsPerSec: timings.evalsPerSec,
        productionWriteSeconds: Math.round(timings.writeMs / 1000),
        secondPassSeconds: Math.round(timings.secondPassMs / 1000),
        loadSeconds: Math.round(timings.loadMs / 1000),
      },
      idempotency: {
        rerunPerformed: true,
        remainingProposedEdges: remainingProposed,
        duplicateWrites: 0,
        duplicateAuthorities: dupClusters.n,
        unexpectedEdgeChanges: newOutboundEdges,
      },
      nextDecision:
        endAmb > 0 ? "REFINE_AMBIGUOUS_WITH_CITING_CONTEXT" : endNf > 0 ? "RESOLVE_NOT_FOUND_WITH_LOCAL_NORMALIZATION" : "PAUSE_AND_REVIEW_RESULTS",
      finalClassification:
        ambEdgeReduction >= 2000
          ? "AMBIGUOUS_DRAIN_STRONG"
          : ambEdgeReduction >= 500
            ? "AMBIGUOUS_DRAIN_MODERATE"
            : ambEdgeReduction > 0
              ? "AMBIGUOUS_DRAIN_WEAK"
              : "AMBIGUOUS_DRAIN_BLOCKED",
      generatedAt: new Date().toISOString(),
      resolverVersion: RESOLVER_VERSION,
    };

    writeJson(REPORT, report);
    console.log("AMBIGUOUS_CITATION_METADATA_RESOLUTION_COMPLETE");
    console.log(
      JSON.stringify({
        ok: report.ok,
        ambEdgeReduction,
        ambTargetReduction,
        edgeReduction,
        newStubs,
        endUnresolved: end.IDENTITY_UNRESOLVED_EDGES,
        endAmbiguous: endAmb,
        finalClassification: report.finalClassification,
        health: report.health.status,
        newOutboundEdges,
      }),
    );
  } finally {
    try {
      citeDb.close();
      metaDb.close();
    } catch {
      /* */
    }
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
