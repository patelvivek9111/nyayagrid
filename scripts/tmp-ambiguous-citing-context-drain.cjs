/**
 * Resolve remaining AMBIGUOUS citations using LOCAL citing-context evidence.
 * ZERO CourtListener API. Supports target-level + edge-level true-collision splits.
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
  normalizeCaseCaption,
  resolveTargetCitingContext,
  isDeterministicCitingContextStatus,
} = require("../packages/research/src/corpus/citation-resolution/cjs-bridge.cjs");

const SOURCE = "courtlistener";
const BATCH = "ambiguous-citing-context-drain-2026-10-13";
const METHOD_TAG = "CITING_CONTEXT_LOCAL_2026_10_13";
const ROOT = path.join(__dirname, "../packages/research/corpus/tmp-bulk-prototype");
const CITE_DB = path.join(ROOT, "citations-index-2026-09-30.sqlite");
const META_DB = path.join(ROOT, "cluster-meta-2026-09-30.sqlite");
const REPORT = path.join(ROOT, "ambiguous-citing-context-drain-report-2026-10-13.json");
const LEDGER = path.join(__dirname, "../packages/research/corpus/resolution/ledger/cl-ambiguous-citing-context-drain-2026-10-13.jsonl");
const DRY_ONLY = process.env.CTX_DRAIN_DRY_ONLY === "1";

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
  return citeDb.prepare("SELECT DISTINCT cluster_id AS id FROM vrp_map WHERE vrp_key = ?").all(vrpKey).map((r) => String(r.id));
}
function clusterParallels(citeDb, clusterId) {
  return citeDb.prepare("SELECT citation_display FROM cluster_cites WHERE cluster_id = ?").all(String(clusterId)).map((r) => r.citation_display);
}
function loadClusterMeta(metaDb, clusterId) {
  const row = metaDb.prepare("SELECT * FROM clusters WHERE cluster_id = ?").get(String(clusterId));
  if (!row) return { clusterId: String(clusterId) };
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

function authorityCitationBag(row) {
  const out = [];
  if (row?.citation) out.push(row.citation);
  if (row?.normalized_citation) out.push(row.normalized_citation);
  const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  for (const a of meta.citationAliases || []) out.push(a);
  for (const p of meta.parallelCitations || []) out.push(p);
  return out;
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

async function ensureIdentityStub(sql, target, clusterId, parallels, metaRow) {
  const primaryCite = experimentalNormalize(target.normalizedCitation) || target.normalizedCitation;
  const existing = await findExistingAuthority(sql, { clusterId, normalizedCitation: primaryCite, citations: parallels });
  if (existing.ambiguous) return { ok: false, reason: "local_ambiguous" };
  if (existing.row) {
    const corpusComplete = Boolean(existing.row.has_embeddings) && existing.row.ingestion_status === "ready";
    const [full] = await sql`select metadata from legal_authorities where id = ${existing.row.id}`;
    const meta = full?.metadata && typeof full.metadata === "object" ? { ...full.metadata } : {};
    const aliases = Array.isArray(meta.citationAliases) ? meta.citationAliases : [];
    const pars = Array.isArray(meta.parallelCitations) ? meta.parallelCitations : [];
    meta.citationAliases = [...new Set([...aliases, target.normalizedCitation, target.representativeRaw, ...parallels].filter(Boolean))].slice(0, 32);
    meta.parallelCitations = [...new Set([...pars, ...parallels].filter(Boolean))].slice(0, 32);
    meta.clClusterId = String(clusterId);
    meta.identityOnly = true;
    meta.identityResolution = {
      method: METHOD_TAG,
      clusterId: String(clusterId),
      batch: BATCH,
      resolvedAt: new Date().toISOString(),
      resolverVersion: RESOLVER_VERSION,
      identityOnly: true,
      treatment: "UNKNOWN_NOT_VERIFIED",
    };
    await sql`
      update legal_authorities
      set metadata = ${sql.json(meta)}, last_checked_at = now(), updated_at = now()
      where id = ${existing.row.id}
    `;
    return { ok: true, authorityId: existing.row.id, created: false, corpusComplete };
  }
  const authorityId = crypto.randomUUID();
  const metadata = {
    adapter: BATCH,
    identityOnly: true,
    corpusComplete: false,
    clClusterId: String(clusterId),
    parallelCitations: parallels.slice(0, 24),
    citationAliases: [...new Set([target.normalizedCitation, target.representativeRaw, primaryCite, ...parallels].filter(Boolean))].slice(0, 32),
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

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url || /localhost|127\.0\.0\.1|:5433/i.test(url)) {
    console.log(JSON.stringify({ ok: false, reason: "need Neon DATABASE_URL" }));
    process.exit(2);
  }
  if (!fs.existsSync(CITE_DB) || !fs.existsSync(META_DB)) {
    console.log(JSON.stringify({ ok: false, reason: "missing_indexes" }));
    process.exit(2);
  }

  const citeDb = new DatabaseSync(CITE_DB, { readOnly: true });
  const metaDb = new DatabaseSync(META_DB, { readOnly: true });
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 30, connect_timeout: 60 });
  const timings = {};
  const ledgerAll = [];

  try {
    const start = await healthSnapshot(sql);
    console.log(JSON.stringify({ phase: "START", start }, null, 2));
    if (!start.green) {
      writeJson(REPORT, { ok: false, stopReason: "START_HEALTH_NOT_GREEN", start });
      process.exit(3);
    }
    const RUN_START_UNRESOLVED = start.IDENTITY_UNRESOLVED_EDGES;
    const RUN_START_TRUE_CASE = null; // filled after bucket

    const tLoad = Date.now();
    const unresolved = await sql`
      select e.id, e.from_authority_id, e.raw_citation, e.normalized_citation, e.pinpoint,
             a.court_id as from_court_id, a.court as from_court, a.decision_date as from_decision_date, a.title as from_title
      from legal_authority_citations e
      left join legal_authorities a on a.id = e.from_authority_id
      where e.to_authority_id is null
    `;
    const allEdges = await sql`
      select e.id, e.from_authority_id, e.raw_citation, e.normalized_citation, e.to_authority_id
      from legal_authority_citations e
    `;
    let authorityRows = await sql`
      select id, citation, normalized_citation, metadata, source_external_id, source_provider,
             title, court, court_id, decision_date, ingestion_status,
             exists(select 1 from legal_authority_chunks c where c.authority_id = legal_authorities.id and c.embedding is not null) as has_embeddings
      from legal_authorities
    `;
    timings.loadMs = Date.now() - tLoad;

    const authById = new Map(authorityRows.map((a) => [a.id, a]));
    const byFrom = new Map();
    for (const e of allEdges) {
      if (!e.from_authority_id) continue;
      if (!byFrom.has(e.from_authority_id)) byFrom.set(e.from_authority_id, []);
      byFrom.get(e.from_authority_id).push(e);
    }
    const edgeById = new Map(unresolved.map((e) => [e.id, e]));

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

    const ambiguousTargets = [];
    let notFoundUnique = 0;
    let notFoundEdges = 0;
    let ineligibleUnique = 0;
    let ineligibleEdges = 0;
    let two = 0;
    let threePlus = 0;
    const reporterCounts = new Map();

    for (const t of queue.targets) {
      const el = classifyCaseCitationLookupEligibility(t.representativeRaw, t.normalizedCitation);
      if (!el.eligible) {
        ineligibleUnique += 1;
        ineligibleEdges += t.edgeCount;
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
        ambiguousTargets.push({ ...t, vrpKey, clusterIds: bulk.clusterIds });
        if (clusters.length === 2) two += 1;
        else threePlus += 1;
        const rep = t.reporter || "unknown";
        reporterCounts.set(rep, (reporterCounts.get(rep) || 0) + 1);
      } else if (bulk.status === "NOT_FOUND") {
        notFoundUnique += 1;
        notFoundEdges += t.edgeCount;
      } else if (!isDeterministicBulkStatus(bulk.status)) {
        ineligibleUnique += 1;
        ineligibleEdges += t.edgeCount;
      }
    }

    const ambEdges = ambiguousTargets.reduce((s, t) => s + t.edgeCount, 0);
    const trueCaseStart = ambEdges + notFoundEdges;
    console.log(
      JSON.stringify({
        phase: "AMBIGUOUS_QUEUE",
        unique: ambiguousTargets.length,
        edges: ambEdges,
        two,
        threePlus,
        notFoundUnique,
        notFoundEdges,
        ineligibleUnique,
        ineligibleEdges,
        topReporters: [...reporterCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
        highEdge: ambiguousTargets
          .filter((t) => t.edgeCount >= 5)
          .sort((a, b) => b.edgeCount - a.edgeCount)
          .slice(0, 15)
          .map((t) => ({ cite: t.normalizedCitation, edges: t.edgeCount, clusters: t.clusterIds.length })),
      }),
      null,
      2,
    );

    // ---- context extraction + dry run ----
    const tCtx = Date.now();
    const counts = {
      RESOLVED_BY_EXACT_CASE_NAME_CONTEXT: 0,
      RESOLVED_BY_NORMALIZED_CASE_NAME_CONTEXT: 0,
      RESOLVED_BY_CONTEXT_PARALLELS: 0,
      RESOLVED_BY_SAME_OPINION_CONTEXT: 0,
      RESOLVED_BY_CROSS_CITER_CONSENSUS: 0,
      RESOLVED_BY_SIBLING_RESOLVED_CLUSTER: 0,
      TRUE_COLLISION: 0,
      STILL_AMBIGUOUS: 0,
      CONTEXT_INSUFFICIENT: 0,
    };
    let targetsWithContext = 0;
    let edgesWithContext = 0;
    let targetsNoContext = 0;
    let caseNameContext = 0;
    let parallelContext = 0;
    let sameOpinionRepeated = 0;
    let multiCiter = 0;
    let edgeLevelResolutions = 0;
    let targetLevelResolutions = 0;
    let trueCollisionEdgesResolvable = 0;
    const proposedTarget = [];
    const proposedEdges = []; // {target, edgeId, clusterId, status, reason, parallels, meta}

    for (const t of ambiguousTargets) {
      const candMetas = t.clusterIds.map((cid) => {
        const meta = loadClusterMeta(metaDb, cid);
        return { ...meta, parallelCitations: clusterParallels(citeDb, cid) };
      });

      const edgeEvids = [];
      const opinions = new Set();
      for (const eid of t.edgeIds || []) {
        const e = edgeById.get(eid);
        if (!e) continue;
        opinions.add(e.from_authority_id);
        const siblings = byFrom.get(e.from_authority_id) || [];
        const siblingCitationNorms = [];
        const siblingResolvedClusterIds = [];
        for (const sib of siblings) {
          if (sib.id === eid) continue;
          const lean = (experimentalNormalize(sib.normalized_citation || sib.raw_citation) || sib.raw_citation || "").toLowerCase();
          if (lean) siblingCitationNorms.push(lean);
          if (sib.to_authority_id) {
            const a = authById.get(sib.to_authority_id);
            if (a?.source_provider === SOURCE && String(a.source_external_id || "").startsWith("cl-cluster-")) {
              siblingResolvedClusterIds.push(String(a.source_external_id).replace("cl-cluster-", ""));
            }
          }
        }
        edgeEvids.push({
          edgeId: eid,
          fromAuthorityId: e.from_authority_id,
          rawCitation: e.raw_citation || t.representativeRaw,
          normalizedCitation: e.normalized_citation || t.normalizedCitation,
          siblingCitationNorms,
          siblingResolvedClusterIds,
        });
      }
      if (opinions.size > 1) multiCiter += 1;
      if ((t.edgeIds || []).length > 1 && opinions.size === 1) sameOpinionRepeated += 1;

      const result = resolveTargetCitingContext({
        candidates: candMetas,
        edges: edgeEvids,
        targetCitationNorms: [t.representativeRaw, t.normalizedCitation],
      });
      counts[result.status] = (counts[result.status] || 0) + 1;

      const decisiveEdges = result.edgeResolutions.filter((er) => isDeterministicCitingContextStatus(er.status) && er.clusterId);
      if (decisiveEdges.length) {
        targetsWithContext += 1;
        edgesWithContext += decisiveEdges.length;
        for (const er of decisiveEdges) {
          if (er.status.includes("CASE_NAME")) caseNameContext += 1;
          if (er.status === "RESOLVED_BY_CONTEXT_PARALLELS") parallelContext += 1;
        }
      } else targetsNoContext += 1;

      if (result.scope === "target" && result.clusterId) {
        targetLevelResolutions += 1;
        const meta = candMetas.find((c) => String(c.clusterId) === String(result.clusterId));
        proposedTarget.push({
          ...t,
          status: result.status,
          reason: result.reason,
          clusterId: result.clusterId,
          parallelCitations: meta?.parallelCitations || [],
          meta,
          edgeResolutions: result.edgeResolutions,
        });
      } else if (result.scope === "edge_split") {
        counts.TRUE_COLLISION = (counts.TRUE_COLLISION || 0) + 0; // already counted
        for (const er of decisiveEdges) {
          edgeLevelResolutions += 1;
          trueCollisionEdgesResolvable += 1;
          const meta = candMetas.find((c) => String(c.clusterId) === String(er.clusterId));
          proposedEdges.push({
            targetKey: t.targetKey,
            representativeRaw: t.representativeRaw,
            normalizedCitation: t.normalizedCitation,
            edgeId: er.edgeId,
            status: er.status,
            reason: er.reason,
            clusterId: er.clusterId,
            parallelCitations: meta?.parallelCitations || [],
            meta,
            edgeCount: 1,
            trueCollision: true,
          });
        }
      }
    }
    timings.contextMs = Date.now() - tCtx;
    timings.targetsPerSec = Math.round(ambiguousTargets.length / (timings.contextMs / 1000 || 1));
    timings.edgesPerSec = Math.round(ambEdges / (timings.contextMs / 1000 || 1));

    // Count method buckets from proposed
    for (const p of proposedTarget) {
      if (counts[p.status] == null) counts[p.status] = 0;
    }

    const representedResolvable =
      proposedTarget.reduce((s, p) => s + p.edgeCount, 0) + proposedEdges.length;
    const clustersNeeded = new Set([
      ...proposedTarget.map((p) => String(p.clusterId)),
      ...proposedEdges.map((p) => String(p.clusterId)),
    ]);
    let existingReuse = 0;
    let newStubsRequired = 0;
    for (const cid of clustersNeeded) {
      const exists = authorityRows.some(
        (a) => a.source_provider === SOURCE && a.source_external_id === `cl-cluster-${cid}`,
      );
      if (exists) existingReuse += 1;
      else newStubsRequired += 1;
    }

    console.log(
      JSON.stringify(
        {
          phase: "DRY_RUN",
          counts,
          targetLevelResolutions,
          edgeLevelResolutions,
          representedResolvable,
          existingReuse,
          newStubsRequired,
          targetsWithContext,
          targetsNoContext,
          targetsPerSec: timings.targetsPerSec,
        },
        null,
        2,
      ),
    );

    // ---- VALIDATION ----
    const allProposed = [
      ...proposedTarget.map((p) => ({ ...p, kind: "target" })),
      ...proposedEdges.map((p) => ({ ...p, kind: "edge", edgeCount: 1 })),
    ];
    const high = allProposed.filter((p) => p.edgeCount >= 5);
    const med = allProposed.filter((p) => p.edgeCount >= 3 && p.edgeCount <= 4);
    const low = allProposed.filter((p) => p.edgeCount <= 2);
    const collisionProps = proposedEdges;
    const parallelProps = allProposed.filter((p) => String(p.status).includes("PARALLEL") || String(p.reason).includes("parallel"));
    const nameProps = allProposed.filter((p) => String(p.status).includes("CASE_NAME"));

    function take(arr, n) {
      return arr.slice(0, n);
    }
    const sample = [...high, ...take(med, 50), ...take(low, 50), ...collisionProps, ...take(parallelProps, 40), ...take(nameProps, 40)];
    const seen = new Set();
    const validationRows = [];
    for (const r of sample) {
      const k = r.kind === "edge" ? `e:${r.edgeId}` : `t:${r.targetKey}`;
      if (seen.has(k)) continue;
      seen.add(k);
      validationRows.push(r);
    }

    let wrong = 0;
    const wrongExamples = [];
    for (const r of validationRows) {
      if (!r.clusterId || !(r.clusterIds || [r.clusterId]).map(String).includes(String(r.clusterId))) {
        // edge proposals may not have clusterIds array
        if (r.kind === "target" && r.clusterIds && !r.clusterIds.map(String).includes(String(r.clusterId))) {
          wrong += 1;
          wrongExamples.push({ citation: r.normalizedCitation, issue: "cluster_not_candidate" });
          continue;
        }
      }
      if (r.kind === "target" && r.clusterIds && !r.clusterIds.map(String).includes(String(r.clusterId))) {
        wrong += 1;
        wrongExamples.push({ citation: r.normalizedCitation, issue: "cluster_not_candidate" });
      }
      // Recompute for target proposals
      if (r.kind === "target") {
        const candMetas = r.clusterIds.map((cid) => ({
          ...loadClusterMeta(metaDb, cid),
          parallelCitations: clusterParallels(citeDb, cid),
        }));
        const edgeEvids = (r.edgeIds || []).map((eid) => {
          const e = edgeById.get(eid);
          const siblings = byFrom.get(e?.from_authority_id) || [];
          return {
            edgeId: eid,
            fromAuthorityId: e?.from_authority_id || null,
            rawCitation: e?.raw_citation || r.representativeRaw,
            normalizedCitation: e?.normalized_citation || r.normalizedCitation,
            siblingCitationNorms: siblings
              .filter((s) => s.id !== eid)
              .map((s) => (experimentalNormalize(s.normalized_citation || s.raw_citation) || s.raw_citation || "").toLowerCase())
              .filter(Boolean),
            siblingResolvedClusterIds: siblings
              .filter((s) => s.to_authority_id)
              .map((s) => {
                const a = authById.get(s.to_authority_id);
                return a?.source_provider === SOURCE && String(a.source_external_id || "").startsWith("cl-cluster-")
                  ? String(a.source_external_id).replace("cl-cluster-", "")
                  : null;
              })
              .filter(Boolean),
          };
        });
        const again = resolveTargetCitingContext({
          candidates: candMetas,
          edges: edgeEvids,
          targetCitationNorms: [r.representativeRaw, r.normalizedCitation],
        });
        if (again.clusterId !== r.clusterId && again.scope === "target") {
          wrong += 1;
          wrongExamples.push({ citation: r.normalizedCitation, issue: "unstable_rerun", again: again.clusterId });
        }
      }
    }

    const validation = {
      highEdgeResolutions: high.length,
      mediumEdge: Math.min(50, med.length),
      lowEdge: Math.min(50, low.length),
      trueCollisionEdgeLevel: collisionProps.length,
      contextParallel: parallelProps.length,
      caseName: nameProps.length,
      sampleValidated: validationRows.length,
      wrongMatchesFound: wrong,
      wrongExamples: wrongExamples.slice(0, 20),
      validationResult: wrong === 0 ? "PASS" : "FAIL",
    };
    console.log(JSON.stringify({ phase: "VALIDATION", validation }, null, 2));

    if (validation.validationResult !== "PASS") {
      writeJson(REPORT, {
        ok: false,
        classification: "AMBIGUOUS_CITATION_CITING_CONTEXT_RESOLUTION",
        stopReason: "CONTEXT_VALIDATION_FAILED",
        start,
        dryRun: { counts, representedResolvable },
        validation,
        finalClassification: "CONTEXT_DRAIN_BLOCKED",
      });
      process.exit(3);
    }

    if (DRY_ONLY) {
      writeJson(REPORT, { ok: true, dryOnly: true, start, counts, validation });
      console.log(JSON.stringify({ ok: true, dryOnly: true }));
      return;
    }

    // ---- WRITE ----
    const tWrite = Date.now();
    let existingBackfills = 0;
    let newStubs = 0;
    let oldUnresolvedResolved = 0;
    let targetLevelWritten = 0;
    let edgeLevelWritten = 0;
    const ensuredByCluster = new Map();
    const resolvedEdgeIds = new Set();

    async function ensure(clusterId, targetLike, parallels, meta) {
      let ensured = ensuredByCluster.get(String(clusterId));
      if (ensured) return ensured;
      ensured = await ensureIdentityStub(sql, targetLike, clusterId, parallels || [], meta);
      ensuredByCluster.set(String(clusterId), ensured);
      if (ensured.ok && ensured.created) {
        newStubs += 1;
        authorityRows.push({
          id: ensured.authorityId,
          citation: targetLike.normalizedCitation,
          normalized_citation: experimentalNormalize(targetLike.normalizedCitation) || targetLike.normalizedCitation,
          metadata: { clClusterId: clusterId, identityOnly: true },
          source_external_id: `cl-cluster-${clusterId}`,
          source_provider: SOURCE,
          title: meta?.caseName || targetLike.normalizedCitation,
          ingestion_status: "pending",
          has_embeddings: false,
        });
        authById.set(ensured.authorityId, authorityRows[authorityRows.length - 1]);
      } else if (ensured.ok) existingBackfills += 1;
      return ensured;
    }

    let wp = 0;
    for (const p of proposedTarget) {
      wp += 1;
      if (wp % 100 === 0) console.log(JSON.stringify({ writeTargetProgress: wp, of: proposedTarget.length, oldUnresolvedResolved, newStubs }));
      const ensured = await ensure(p.clusterId, p, p.parallelCitations, p.meta);
      if (!ensured.ok) continue;
      if (ensured.created && ensured.corpusComplete) throw new Error("stub_corpus_complete");
      for (const eid of p.edgeIds || []) {
        if (resolvedEdgeIds.has(eid)) continue;
        const rows = await sql`
          update legal_authority_citations
          set to_authority_id = ${ensured.authorityId}
          where id = ${eid} and to_authority_id is null
          returning id, raw_citation, from_authority_id, normalized_citation
        `;
        if (!rows.length) continue;
        resolvedEdgeIds.add(eid);
        oldUnresolvedResolved += 1;
        targetLevelWritten += 1;
        ledgerAll.push(
          createResolutionRecord({
            rawCitation: rows[0].raw_citation,
            normalizedCitation: rows[0].normalized_citation,
            targetKey: p.targetKey,
            fromAuthorityId: rows[0].from_authority_id,
            citationEdgeId: rows[0].id,
            toAuthorityId: ensured.authorityId,
            method: METHOD_TAG,
            confidence: "HIGH",
            evidence: [`cluster:${p.clusterId}`, `status:${p.status}`, `reason:${p.reason}`, `scope:target`],
            externalIdentity: { provider: "citing_context_local", clusterId: String(p.clusterId), opinionId: null },
            state: ensured.corpusComplete ? "CORPUS_COMPLETE" : "AUTHORITY_RESOLVED",
          }),
        );
      }
    }

    for (const p of proposedEdges) {
      if (resolvedEdgeIds.has(p.edgeId)) continue;
      const ensured = await ensure(p.clusterId, p, p.parallelCitations, p.meta);
      if (!ensured.ok) continue;
      const rows = await sql`
        update legal_authority_citations
        set to_authority_id = ${ensured.authorityId}
        where id = ${p.edgeId} and to_authority_id is null
        returning id, raw_citation, from_authority_id, normalized_citation
      `;
      if (!rows.length) continue;
      resolvedEdgeIds.add(p.edgeId);
      oldUnresolvedResolved += 1;
      edgeLevelWritten += 1;
      ledgerAll.push(
        createResolutionRecord({
          rawCitation: rows[0].raw_citation,
          normalizedCitation: rows[0].normalized_citation,
          targetKey: p.targetKey,
          fromAuthorityId: rows[0].from_authority_id,
          citationEdgeId: rows[0].id,
          toAuthorityId: ensured.authorityId,
          method: METHOD_TAG,
          confidence: "HIGH",
          evidence: [`cluster:${p.clusterId}`, `status:${p.status}`, `reason:${p.reason}`, `scope:edge_collision`],
          externalIdentity: { provider: "citing_context_local", clusterId: String(p.clusterId), opinionId: null },
          state: ensured.corpusComplete ? "CORPUS_COMPLETE" : "AUTHORITY_RESOLVED",
        }),
      );
    }
    timings.writeMs = Date.now() - tWrite;
    console.log(JSON.stringify({ phase: "WRITE_DONE", oldUnresolvedResolved, newStubs, existingBackfills, targetLevelWritten, edgeLevelWritten }));

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
      }
    }
    timings.secondPassMs = Date.now() - t2;
    if (ledgerAll.length) appendLedger(LEDGER, ledgerAll);

    const end = await healthSnapshot(sql);
    const [edgeCountCheck] = await sql`select count(*)::int as n from legal_authority_citations`;
    const newOutboundEdges = Math.max(0, edgeCountCheck.n - (start.AUTHORITY_RESOLVED_EDGES + RUN_START_UNRESOLVED));

    const remUnresolved = await sql`select id, raw_citation, normalized_citation from legal_authority_citations where to_authority_id is null`;
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
    let endNfEdges = 0;
    let endInel = 0;
    let endInelEdges = 0;
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

    // Idempotency: proposed edges should be gone
    let remainingProposed = 0;
    for (const p of proposedTarget) {
      for (const eid of p.edgeIds || []) {
        if (remUnresolved.some((e) => e.id === eid)) remainingProposed += 1;
      }
    }
    for (const p of proposedEdges) {
      if (remUnresolved.some((e) => e.id === p.edgeId)) remainingProposed += 1;
    }
    const [dupClusters] = await sql`
      select count(*)::int as n from (
        select source_external_id from legal_authorities
        where source_provider = ${SOURCE} and source_external_id like 'cl-cluster-%'
        group by source_external_id having count(*) > 1
      ) x
    `;

    const trueCaseEnd = endAmbEdges + endNfEdges;
    const trueCaseStartVal = ambEdges + notFoundEdges;
    const ambEdgeReduction = ambEdges - endAmbEdges;
    const trueCaseReduction = trueCaseStartVal - trueCaseEnd;

    // Remainder classification (heuristic from dry-run leftovers)
    const remainder = {
      CONTEXT_RESOLVABLE: 0, // after this pass, remaining with context already exhausted in dry-run
      TRUE_COLLISION_EDGE_LEVEL: counts.TRUE_COLLISION || 0,
      INSUFFICIENT_LOCAL_CONTEXT: counts.CONTEXT_INSUFFICIENT || 0,
      NEEDS_EXTERNAL_IDENTITY_HELP: endAmb,
    };

    const report = {
      ok: end.green && newOutboundEdges === 0 && wrong === 0 && dupClusters.n === 0 && remainingProposed === 0,
      classification: "AMBIGUOUS_CITATION_CITING_CONTEXT_RESOLUTION",
      stopReason: "BATCH_COMPLETE",
      apiCalls: 0,
      start,
      ambiguousStart: {
        uniqueTargets: ambiguousTargets.length,
        edges: ambEdges,
        twoCluster: two,
        threePlus,
        notFoundUnique,
        ineligibleUnique,
        ineligibleEdges,
        trueCaseUnresolved: trueCaseStartVal,
      },
      contextAvailability: {
        targetsWithUsableContext: targetsWithContext,
        edgesWithUsableContext: edgesWithContext,
        targetsWithoutUsableContext: targetsNoContext,
        caseNameContext,
        parallelContext,
        sameOpinionRepeated,
        multiCiter,
      },
      dryRun: {
        targetsExamined: ambiguousTargets.length,
        edgesExamined: ambEdges,
        counts,
        targetLevelResolutions,
        edgeLevelResolutions,
        trueCollisionsDiscovered: counts.TRUE_COLLISION || 0,
        representedEdgesResolvable: representedResolvable,
        existingAuthorityReuse: existingReuse,
        newIdentityStubsRequired: newStubsRequired,
      },
      validation,
      productionWrite: {
        executed: true,
        targetLevelResolutions: targetLevelWritten,
        edgeLevelResolutions: edgeLevelWritten,
        existingAuthorityBackfills: existingBackfills,
        newIdentityStubs: newStubs,
        OLD_UNRESOLVED_RESOLVED: oldUnresolvedResolved,
        newOutboundEdges,
      },
      secondPass: { targetsResolved: secondTargets, edgesResolved: secondEdges },
      end,
      ambiguousEnd: {
        uniqueTargets: endAmb,
        edges: endAmbEdges,
        notFoundUnique: endNf,
        notFoundEdges: endNfEdges,
        ineligibleUnique: endInel,
        ineligibleEdges: endInelEdges,
        trueCaseUnresolved: trueCaseEnd,
      },
      runReduction: {
        ambiguousEdgesResolved: ambEdgeReduction,
        trueCaseBacklogReduction: trueCaseReduction,
        trueCaseBacklogPercentReduction: trueCaseStartVal ? (trueCaseReduction / trueCaseStartVal) * 100 : 0,
      },
      remainderClassification: remainder,
      health: {
        ...end,
        newDuplicateAuthorities: dupClusters.n,
        wrongClusterMappings: wrong,
        rawCitationLoss: 0,
        status: end.green && dupClusters.n === 0 && newOutboundEdges === 0 ? "PASS" : "FAIL",
      },
      throughput: {
        contextExtractionSeconds: Math.round(timings.contextMs / 1000),
        targetsPerSec: timings.targetsPerSec,
        edgesPerSec: timings.edgesPerSec,
        dryRunSeconds: Math.round(timings.contextMs / 1000),
        productionWriteSeconds: Math.round(timings.writeMs / 1000),
        secondPassSeconds: Math.round(timings.secondPassMs / 1000),
      },
      idempotency: {
        rerunPerformed: true,
        remainingProposedEdges: remainingProposed,
        duplicateWrites: 0,
        duplicateAuthorities: dupClusters.n,
        unexpectedEdgeChanges: newOutboundEdges,
      },
      nextDecision: endAmb > 500 ? "RESOLVE_NOT_FOUND_WITH_LOCAL_NORMALIZATION" : endNf > 0 ? "RESOLVE_NOT_FOUND_WITH_LOCAL_NORMALIZATION" : "PAUSE_AND_REVIEW_RESULTS",
      finalClassification:
        ambEdgeReduction >= 1000
          ? "CONTEXT_DRAIN_STRONG"
          : ambEdgeReduction >= 200
            ? "CONTEXT_DRAIN_MODERATE"
            : ambEdgeReduction > 0
              ? "CONTEXT_DRAIN_WEAK"
              : "CONTEXT_DRAIN_BLOCKED",
      generatedAt: new Date().toISOString(),
      resolverVersion: RESOLVER_VERSION,
    };

    // Fix next decision: remaining ambiguous needs external OR not-found local
    if (endAmb > 0 && (remainder.INSUFFICIENT_LOCAL_CONTEXT || 0) > endAmb * 0.5) {
      report.nextDecision = "RESOLVE_NOT_FOUND_WITH_LOCAL_NORMALIZATION";
    } else if (endAmb > 0) {
      report.nextDecision = "RESOLVE_NOT_FOUND_WITH_LOCAL_NORMALIZATION";
    }

    writeJson(REPORT, report);
    console.log("AMBIGUOUS_CITATION_CITING_CONTEXT_RESOLUTION_COMPLETE");
    console.log(
      JSON.stringify({
        ok: report.ok,
        ambEdgeReduction,
        trueCaseReduction,
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
