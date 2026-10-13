/**
 * Export TRUE_VRP_COLLISION sample + wanted cluster IDs for opinion-map build.
 * ZERO CL API.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const postgres = require("postgres");
const {
  LocalAuthorityIndex,
  buildUnresolvedTargetQueue,
  citationToBulkVrpKey,
  classifyCaseCitationLookupEligibility,
} = require("../packages/research/src/corpus/citation-resolution/cjs-bridge.cjs");

const ROOT = path.join(__dirname, "../packages/research/corpus/tmp-bulk-prototype");
const CITE_DB = path.join(ROOT, "citations-index-2026-09-30.sqlite");
const NEG_CACHE = path.join(ROOT, "cl-identity-negative-cache-2026-10-13.json");
const SAMPLE_N = process.env.GRAPH_SAMPLE_N != null ? Number(process.env.GRAPH_SAMPLE_N) : 300;
const FULL = process.env.GRAPH_SAMPLE_N === "0";

function loadNeg() {
  try {
    return JSON.parse(fs.readFileSync(NEG_CACHE, "utf8"));
  } catch {
    return { notFound: {} };
  }
}

function extractClClusterId(auth) {
  const ext = String(auth.source_external_id || "");
  if (ext.startsWith("cl-cluster-")) return ext.slice("cl-cluster-".length);
  const meta = auth.metadata && typeof auth.metadata === "object" ? auth.metadata : {};
  if (meta.clClusterId != null) return String(meta.clClusterId);
  return null;
}

function extractClOpinionIds(auth) {
  const out = [];
  const ext = String(auth.source_external_id || "");
  if (ext.startsWith("cl-opinion-")) out.push(ext.slice("cl-opinion-".length));
  const meta = auth.metadata && typeof auth.metadata === "object" ? auth.metadata : {};
  if (meta.clOpinionId != null) out.push(String(meta.clOpinionId));
  return [...new Set(out.filter(Boolean))];
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url || /localhost|:5433/i.test(url)) throw new Error("need Neon DATABASE_URL");
  const citeDb = new DatabaseSync(CITE_DB, { readOnly: true });
  const neg = loadNeg();
  const sql = postgres(url, { max: 1, ssl: "require" });

  const unresolved = await sql`
    select e.id, e.from_authority_id, e.raw_citation, e.normalized_citation, e.created_at,
           a.court_id as from_court_id, a.court as from_court,
           a.source_external_id as from_source_external_id, a.metadata as from_metadata
    from legal_authority_citations e
    left join legal_authorities a on a.id = e.from_authority_id
    where e.to_authority_id is null
  `;
  const authorityRows = await sql`
    select id, citation, normalized_citation, metadata, source_external_id, source_provider,
           title, court, court_id, decision_date, ingestion_status,
           exists(select 1 from legal_authority_chunks c where c.authority_id = legal_authorities.id and c.embedding is not null) as has_embeddings
    from legal_authorities
  `;
  const [raw] = await sql`select count(*)::int as n from legal_authority_citations where to_authority_id is null`;
  await sql.end({ timeout: 5 });

  const index = new LocalAuthorityIndex(
    authorityRows.map((a) => ({
      id: a.id,
      citation: a.citation,
      normalizedCitation: a.normalized_citation,
      metadata: a.metadata || {},
      sourceExternalId: a.source_external_id,
      sourceProvider: a.source_provider,
      ingestionStatus: a.ingestion_status,
      corpusComplete: Boolean(a.has_embeddings) && a.ingestion_status === "ready",
    })),
  );
  const queue = buildUnresolvedTargetQueue(
    unresolved.map((e) => ({
      id: e.id,
      fromAuthorityId: e.from_authority_id,
      rawCitation: e.raw_citation,
      normalizedCitation: e.normalized_citation,
      createdAt: e.created_at,
      fromCourtId: e.from_court_id,
      fromCourt: e.from_court,
    })),
    index,
  );

  const lookup = (vk) =>
    vk
      ? citeDb
          .prepare("SELECT DISTINCT cluster_id AS id FROM vrp_map WHERE vrp_key = ?")
          .all(vk)
          .map((r) => String(r.id))
      : [];

  const buckets = { collision: [], unsupported: [], externalNf: [], deferred: [], ineligible: 0 };
  for (const t of queue.targets) {
    const el = classifyCaseCitationLookupEligibility(t.representativeRaw, t.normalizedCitation);
    if (!el.eligible) {
      buckets.ineligible += t.edgeCount;
      continue;
    }
    const vrpKey = citationToBulkVrpKey(t.normalizedCitation) || citationToBulkVrpKey(t.representativeRaw);
    const clusterIds = lookup(vrpKey);
    if (clusterIds.length >= 2) buckets.collision.push({ ...t, clusterIds, vrpKey });
    else if (neg.notFound?.[t.targetKey]?.reason === "bulk_volume_absent_provider_gap")
      buckets.unsupported.push({ ...t, clusterIds, vrpKey });
    else if (neg.notFound?.[t.targetKey]) buckets.externalNf.push({ ...t, clusterIds, vrpKey });
    else buckets.deferred.push({ ...t, clusterIds, vrpKey });
  }

  const edgeById = new Map(unresolved.map((e) => [e.id, e]));
  const authById = new Map(authorityRows.map((a) => [a.id, a]));
  let edges = [];
  for (const t of buckets.collision) {
    for (const edgeId of t.edgeIds || []) {
      const e = edgeById.get(edgeId);
      if (!e) continue;
      const from = authById.get(e.from_authority_id) || {
        source_external_id: e.from_source_external_id,
        metadata: e.from_metadata,
      };
      edges.push({
        edgeId,
        fromAuthorityId: e.from_authority_id,
        rawCitation: e.raw_citation,
        normalizedCitation: e.normalized_citation,
        targetKey: t.targetKey,
        representativeRaw: t.representativeRaw,
        clusterIds: t.clusterIds,
        vrpKey: t.vrpKey,
        edgeCount: t.edgeCount,
        citingClusterId: extractClClusterId(from),
        citingOpinionIdsDirect: extractClOpinionIds(from),
      });
    }
  }

  // sample selection
  const byTarget = new Map();
  for (const e of edges) {
    if (!byTarget.has(e.targetKey)) byTarget.set(e.targetKey, []);
    byTarget.get(e.targetKey).push(e);
  }
  const groups = [...byTarget.values()].sort((a, b) => b.length - a.length || b[0].clusterIds.length - a[0].clusterIds.length);
  let sample = edges;
  if (!FULL && SAMPLE_N > 0 && SAMPLE_N < edges.length) {
    sample = [];
    const seen = new Set();
    for (const g of groups) {
      if (sample.length >= SAMPLE_N) break;
      if (!seen.has(g[0].edgeId)) {
        seen.add(g[0].edgeId);
        sample.push(g[0]);
      }
    }
    for (const g of groups) {
      for (const e of g.slice(1)) {
        if (sample.length >= SAMPLE_N) break;
        if (seen.has(e.edgeId)) continue;
        seen.add(e.edgeId);
        sample.push(e);
      }
    }
  }

  const wanted = new Set();
  for (const e of sample) {
    if (e.citingClusterId) wanted.add(String(e.citingClusterId));
    for (const c of e.clusterIds) wanted.add(String(c));
  }

  const recount = {
    IDENTITY_UNRESOLVED_EDGES_RAW: raw.n,
    TRUE_VRP_COLLISION_EDGES: edges.length,
    TRUE_VRP_COLLISION_TARGETS: buckets.collision.length,
    PROVIDER_UNSUPPORTED_EDGES: buckets.unsupported.reduce((s, t) => s + t.edgeCount, 0),
    PROVIDER_UNSUPPORTED_TARGETS: buckets.unsupported.length,
    EXTERNAL_NOT_FOUND_EDGES: buckets.externalNf.reduce((s, t) => s + t.edgeCount, 0),
    EXTERNAL_NOT_FOUND_TARGETS: buckets.externalNf.length,
    DEFERRED_EDGES: buckets.deferred.reduce((s, t) => s + t.edgeCount, 0),
    DEFERRED_TARGETS: buckets.deferred.length,
    INELIGIBLE_EDGES: buckets.ineligible,
    TRUE_CASE_IDENTITY_UNRESOLVED_EDGES:
      edges.length +
      buckets.unsupported.reduce((s, t) => s + t.edgeCount, 0) +
      buckets.externalNf.reduce((s, t) => s + t.edgeCount, 0) +
      buckets.deferred.reduce((s, t) => s + t.edgeCount, 0),
  };

  fs.writeFileSync(path.join(ROOT, "wanted-clusters.json"), JSON.stringify([...wanted]));
  fs.writeFileSync(
    path.join(ROOT, "collision-sample-2026-10-13.json"),
    JSON.stringify({ recount, sampleN: sample.length, wantedClusters: wanted.size, edges: sample }, null, 2),
  );
  console.log(JSON.stringify({ ok: true, recount, sampleN: sample.length, wantedClusters: wanted.size }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
