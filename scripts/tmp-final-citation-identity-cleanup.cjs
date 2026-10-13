/**
 * FINAL citation identity cleanup:
 * local deterministic normalization/retry → validate/write → CL quota-gated identity → global backfill → post-CL local.
 * No fulltext. No new outbound edges. Neon only.
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
  deterministicCitationVariants,
  isUnsafeOcrTransform,
  targetKey,
  classifyCaseCitationLookupEligibility,
  createResolutionRecord,
  appendLedger,
  RESOLVER_VERSION,
  citationToBulkVrpKey,
  classifyBulkIdentity,
  isDeterministicBulkStatus,
  BULK_SNAPSHOT_ID,
  parseCitationLookupResponse,
  filterExternalIdentityQueueTargets,
} = require("../packages/research/src/corpus/citation-resolution/cjs-bridge.cjs");
const {
  acquireWorkerLock,
  releaseWorkerLock,
  refreshWorkerHeartbeat,
  newWorkerId,
  newProcessStartNonce,
  ACTIVE_REFUSAL_CODE,
} = require("./queue2-worker-lock.cjs");

const SOURCE = "courtlistener";
const BATCH = "final-citation-identity-cleanup-2026-10-13";
const METHOD_LOCAL = "LOCAL_NORMALIZED";
const METHOD_BULK = BULK_SNAPSHOT_ID;
const METHOD_CL = "COURTLISTENER_CITATION_LOOKUP";
const ROOT = path.join(__dirname, "../packages/research/corpus/tmp-bulk-prototype");
const DB_PATH = path.join(ROOT, "citations-index-2026-09-30.sqlite");
const REPORT = path.join(ROOT, "final-identity-cleanup-report-2026-10-13.json");
const NEG_CACHE = path.join(ROOT, "cl-identity-negative-cache-2026-10-13.json");
const LEDGER = path.join(__dirname, "../packages/research/corpus/resolution/ledger/cl-final-identity-cleanup-2026-10-13.jsonl");
const REPORTS_DIR = path.join(__dirname, "../packages/research/corpus/reports");
const CL_BASE = "https://www.courtlistener.com/api/rest/v4";
const DRY_ONLY = process.env.FINAL_CLEANUP_DRY_ONLY === "1";
const SKIP_CL = process.env.FINAL_CLEANUP_SKIP_CL === "1";
const CL_PACING_MS_OVERRIDE = process.env.FINAL_CLEANUP_CL_PACING_MS ? Number(process.env.FINAL_CLEANUP_CL_PACING_MS) : null;
const CL_BUDGET_CAP = Number(process.env.FINAL_CLEANUP_CL_BUDGET || 275);
const CL_ONLY = process.env.FINAL_CLEANUP_CL_ONLY === "1";
const WORKER_ID = process.env.QUEUE2_WORKER_ID || newWorkerId();
const PROCESS_NONCE = newProcessStartNonce();

function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
}

function loadNegCache() {
  if (!fs.existsSync(NEG_CACHE)) return { notFound: {}, ambiguous: {}, updatedAt: null };
  try {
    return JSON.parse(fs.readFileSync(NEG_CACHE, "utf8"));
  } catch {
    return { notFound: {}, ambiguous: {}, updatedAt: null };
  }
}

function saveNegCache(cache) {
  cache.updatedAt = new Date().toISOString();
  writeJson(NEG_CACHE, cache);
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

function openBulkDb() {
  if (!fs.existsSync(DB_PATH)) throw new Error(`missing_index:${DB_PATH}`);
  return new DatabaseSync(DB_PATH, { readOnly: true });
}

function lookupClusters(db, vrpKey) {
  if (!vrpKey) return [];
  const rows = db.prepare("SELECT DISTINCT cluster_id AS id FROM vrp_map WHERE vrp_key = ?").all(vrpKey);
  return rows.map((r) => String(r.id));
}

/** volume|compactReporter coverage from bulk citations index (provider digitization proxy). */
function buildBulkVolumeCoverage(db) {
  const cov = new Set();
  const rows = db
    .prepare(
      `SELECT DISTINCT volume || '|' || reporter_compact AS vol_rep
       FROM vrp_map
       WHERE volume IS NOT NULL AND reporter_compact IS NOT NULL AND reporter_compact <> ''`,
    )
    .all();
  for (const row of rows) {
    if (row.vol_rep) cov.add(String(row.vol_rep));
  }
  return cov;
}

function volumeCoverageKeyFromCitation(cite) {
  const vk = citationToBulkVrpKey(cite);
  if (!vk) return null;
  const parts = vk.split("|");
  if (parts.length < 3) return null;
  return `${parts[0]}|${parts[1]}`;
}

function clusterParallels(db, clusterId) {
  const rows = db.prepare("SELECT citation_display FROM cluster_cites WHERE cluster_id = ?").all(String(clusterId));
  return rows.map((r) => r.citation_display);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function periodFromRate(row) {
  const periodRaw = String(row.period || row.window || row.rate || row.name || "").toLowerCase();
  if (periodRaw.includes("min")) return "minute";
  if (periodRaw.includes("hour")) return "hour";
  if (periodRaw.includes("day")) return "day";
  const ws = Number(row.window_seconds);
  if (ws === 60) return "minute";
  if (ws === 3600) return "hour";
  if (ws === 86400) return "day";
  return null;
}

function normalizeUsageRows(raw) {
  const out = [];
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    if (row.minute || row.hour || row.day) {
      for (const period of ["minute", "hour", "day"]) {
        const p = row[period];
        if (!p) continue;
        out.push({
          scope: String(row.scope || "user"),
          period,
          limit: Number(p.limit ?? p.rate_limit ?? null),
          usage: Number(p.usage ?? p.used ?? null),
          remaining: Number(p.remaining ?? (p.limit != null && p.usage != null ? Number(p.limit) - Number(p.usage) : null)),
          reset_at: p.reset_at || p.resetAt || null,
          blocked: Boolean(p.blocked || false),
        });
      }
      continue;
    }
    const period = periodFromRate(row);
    out.push({
      scope: String(row.scope || row.throttle || "user"),
      period,
      limit: Number(row.limit ?? row.rate_limit ?? row.allowed ?? null),
      usage: Number(row.usage ?? row.used ?? row.count ?? null),
      remaining: Number(
        row.remaining ?? (row.limit != null && (row.usage != null || row.used != null) ? Number(row.limit) - Number(row.usage ?? row.used) : null),
      ),
      reset_at: row.reset_at || row.resetAt || null,
      blocked: Boolean(row.blocked || row.is_blocked || false),
    });
  }
  return out;
}

/** Prefer user scope for Tier ceilings; also expose binding mins across scopes. */
async function probeQuota(apiKey) {
  const res = await fetch(`${CL_BASE}/api-usage/`, {
    headers: { Authorization: `Token ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  const j = await res.json().catch(() => ({}));
  const current = j.current_usage || j.usage || [];
  const all = normalizeUsageRows(current);
  const userRows = all.filter((r) => String(r.scope).toLowerCase().includes("user"));
  const byPeriod = {};
  for (const row of userRows.length ? userRows : all) {
    if (!row.period) continue;
    byPeriod[row.period] = row;
  }
  const binding = {};
  for (const period of ["minute", "hour", "day"]) {
    const candidates = all.filter((r) => r.period === period && Number.isFinite(r.remaining));
    if (!candidates.length) continue;
    binding[period] = candidates.reduce((best, r) => (r.remaining < best.remaining ? r : best), candidates[0]);
  }
  return {
    ok: res.ok,
    status: res.status,
    membership: j.membership || null,
    minute: byPeriod.minute || null,
    hour: byPeriod.hour || null,
    day: byPeriod.day || null,
    bindingMinute: binding.minute || null,
    bindingHour: binding.hour || null,
    bindingDay: binding.day || null,
    allRows: all,
    raw: j,
  };
}

function selectExternalBudget(quota, eligibleCount, cap) {
  const userMin = Number(quota.minute?.remaining ?? 0);
  const userHour = Number(quota.hour?.remaining ?? 0);
  const userDay = Number(quota.day?.remaining ?? 0);
  const bindMin = Number(quota.bindingMinute?.remaining ?? userMin);
  const bindHour = Number(quota.bindingHour?.remaining ?? userHour);
  const bindDay = Number(quota.bindingDay?.remaining ?? userDay);
  // Leave headroom on the binding (often api_usage 10/min + 120/hour) and user day.
  const safeHour = Math.max(0, Math.min(cap, bindHour - 15, userHour - 25, bindDay - 20, userDay - 50, 275));
  const minuteLimit = Number(quota.bindingMinute?.limit ?? quota.minute?.limit ?? 10);
  const pacingMs = Math.max(4000, Math.ceil(60000 / Math.max(1, minuteLimit - 1)) + 250);
  return {
    externalBudget: Math.min(safeHour, eligibleCount),
    pacingMs,
    userMin,
    userHour,
    userDay,
    bindMin,
    bindHour,
    bindDay,
    minuteLimit,
  };
}

async function findExistingAuthority(sql, { clusterId, normalizedCitation, citations }) {
  const ext = `cl-cluster-${clusterId}`;
  const byExt = await sql`
    select id, ingestion_status,
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
    select id, ingestion_status,
      exists(select 1 from legal_authority_chunks c where c.authority_id = legal_authorities.id and c.embedding is not null) as has_embeddings
    from legal_authorities
    where normalized_citation = any(${norms}) or citation = any(${norms})
    limit 5
  `;
  if (hits.length === 1) return { row: hits[0], via: "citation" };
  if (hits.length > 1) return { ambiguous: true, via: "citation" };
  return { row: null, via: null };
}

async function ensureIdentityStub(sql, target, clusterId, parallels, methodTag) {
  const primaryCite = experimentalNormalize(target.normalizedCitation) || target.normalizedCitation;
  const existing = await findExistingAuthority(sql, {
    clusterId,
    normalizedCitation: primaryCite,
    citations: parallels,
  });
  if (existing.ambiguous) return { ok: false, reason: "local_ambiguous_after_identity" };
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
      method: methodTag,
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
  const aliasSet = [...new Set([target.normalizedCitation, target.representativeRaw, primaryCite, ...parallels].filter(Boolean))].slice(0, 32);
  const metadata = {
    adapter: BATCH,
    identityOnly: true,
    corpusComplete: false,
    clClusterId: String(clusterId),
    parallelCitations: parallels.slice(0, 24),
    citationAliases: aliasSet,
    identityResolution: {
      method: methodTag,
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
      ${primaryCite}, ${primaryCite}, ${experimentalNormalize(primaryCite) || primaryCite},
      ${null},
      ${SOURCE}, ${`cl-cluster-${clusterId}`},
      ${`https://www.courtlistener.com/opinion/${clusterId}/`},
      ${sql.json(metadata)}, 'pending'::authority_ingestion_status,
      now(), now(), now()
    )
  `;
  return { ok: true, authorityId, created: true, corpusComplete: false };
}

async function backfillTargetEdges(sql, target, authorityId, method, evidence, corpusComplete, provider) {
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
        externalIdentity: {
          provider: provider || "courtlistener",
          clusterId: String(evidence.find((x) => String(x).startsWith("cluster:")) || "").replace("cluster:", "") || null,
          opinionId: null,
        },
        state: corpusComplete ? "CORPUS_COMPLETE" : "AUTHORITY_RESOLVED",
      }),
    );
  }
  return { updated, ledger };
}

function classifyLocalTarget(t, index, bulkDb) {
  const el = classifyCaseCitationLookupEligibility(t.representativeRaw, t.normalizedCitation);
  if (!el.eligible) {
    return {
      bucket: "INELIGIBLE",
      status: "INELIGIBLE",
      eligibility: el,
      clusterId: null,
      clusterIds: [],
      parallelCitations: [],
      vrpKey: null,
      method: null,
      evidence: el.reasons || [],
      via: "eligibility",
    };
  }

  const seeds = deterministicCitationVariants(t.normalizedCitation || t.representativeRaw);
  const safeSeeds = seeds.filter((s) => !isUnsafeOcrTransform(t.representativeRaw || t.normalizedCitation || "", s));

  // 1) Nyaya local index (exact/normalized/alias/parallel/VRP)
  const localHit = index.lookupCitation(t.representativeRaw, t.normalizedCitation);
  if (localHit.kind === "one") {
    return {
      bucket: "LOCAL_RESOLVED",
      status: localHit.method || "LOCAL_ALIAS",
      clusterId: null,
      authorityId: localHit.authorityId,
      clusterIds: [],
      parallelCitations: [],
      vrpKey: null,
      method: localHit.method,
      evidence: localHit.evidence || [],
      via: "nyaya_local",
      priorBucket: null,
    };
  }
  if (localHit.kind === "ambiguous") {
    // still try bulk unique — may collapse; else remain AMBIGUOUS
  }

  // 2) Bulk unique VRP across deterministic variants
  const clusterSet = new Set();
  let chosenVrp = null;
  let parallels = [];
  for (const seed of safeSeeds) {
    const vk = citationToBulkVrpKey(seed);
    if (!vk) continue;
    const clusters = lookupClusters(bulkDb, vk);
    for (const c of clusters) clusterSet.add(c);
    if (clusters.length === 1 && !chosenVrp) {
      chosenVrp = vk;
      parallels = clusterParallels(bulkDb, clusters[0]);
    }
  }
  const clusterIds = [...clusterSet];
  if (clusterIds.length === 1) {
    const bulk = classifyBulkIdentity({
      raw: t.representativeRaw,
      normalized: t.normalizedCitation,
      clusterIds,
      parallelCitations: parallels,
      vrpKey: chosenVrp || citationToBulkVrpKey(t.normalizedCitation),
    });
    if (isDeterministicBulkStatus(bulk.status)) {
      return {
        bucket: "LOCAL_RESOLVED",
        status: bulk.status,
        clusterId: clusterIds[0],
        clusterIds,
        parallelCitations: parallels,
        vrpKey: chosenVrp,
        method: METHOD_BULK,
        evidence: [`cluster:${clusterIds[0]}`, `vrp:${chosenVrp}`, `bulk:${bulk.status}`],
        via: "bulk_variant",
      };
    }
  }
  if (clusterIds.length > 1) {
    return {
      bucket: "AMBIGUOUS",
      status: "AMBIGUOUS",
      clusterId: null,
      clusterIds,
      parallelCitations: [],
      vrpKey: chosenVrp,
      method: null,
      evidence: [`clusters:${clusterIds.slice(0, 8).join(",")}`],
      via: "bulk_multi",
    };
  }
  if (localHit.kind === "ambiguous") {
    return {
      bucket: "AMBIGUOUS",
      status: "AMBIGUOUS",
      clusterId: null,
      clusterIds: [],
      authorityIds: localHit.authorityIds,
      parallelCitations: [],
      vrpKey: null,
      method: null,
      evidence: localHit.evidence || [],
      via: "nyaya_ambiguous",
    };
  }
  return {
    bucket: "NOT_FOUND",
    status: "NOT_FOUND",
    clusterId: null,
    clusterIds: [],
    parallelCitations: [],
    vrpKey: citationToBulkVrpKey(t.normalizedCitation) || citationToBulkVrpKey(t.representativeRaw),
    method: null,
    evidence: ["no_local_or_bulk_unique"],
    via: "not_found",
  };
}

async function clLookup(apiKey, text) {
  const res = await fetch(`${CL_BASE}/citation-lookup/`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(45000),
  });
  const retryAfter = res.headers.get("retry-after");
  if (res.status === 429) {
    return { httpStatus: 429, retryAfter, result: { status: "failed", reason: "rate_limited", evidence: ["http_429"] } };
  }
  if (res.status === 502 || res.status === 504) {
    return { httpStatus: res.status, retryAfter, result: { status: "failed", reason: `http_${res.status}`, evidence: [`http_${res.status}`] } };
  }
  if (!res.ok) {
    return { httpStatus: res.status, retryAfter, result: { status: "failed", reason: `http_${res.status}`, evidence: [`http_${res.status}`] } };
  }
  const body = await res.json();
  return { httpStatus: 200, retryAfter: null, result: parseCitationLookupResponse(body) };
}

/** Alternate VRP triad form — only when text lookup fails and parse is clean. */
async function clLookupVrp(apiKey, cite) {
  const lean = experimentalNormalize(cite) || cite;
  const m = String(lean).match(/^(\d{1,4})\s+(.+?)\s+(\d{1,5})$/);
  if (!m) return null;
  const res = await fetch(`${CL_BASE}/citation-lookup/`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ volume: Number(m[1]), reporter: m[2], page: Number(m[3]) }),
    signal: AbortSignal.timeout(45000),
  });
  if (res.status === 429) {
    return { httpStatus: 429, retryAfter: res.headers.get("retry-after"), result: { status: "failed", reason: "rate_limited", evidence: ["http_429"] } };
  }
  if (!res.ok) {
    return { httpStatus: res.status, retryAfter: null, result: { status: "failed", reason: `http_${res.status}`, evidence: [`http_${res.status}`] } };
  }
  const body = await res.json();
  return { httpStatus: 200, retryAfter: null, result: parseCitationLookupResponse(body) };
}

async function main() {
  console.log("SHARED_RUNTIME_LOCK_REQUIRED");
  console.log(
    JSON.stringify({
      task: "final citation identity cleanup",
      mutations: "citation identity mappings / canonical identity stubs / global edge backfill",
      CourtListener: "possible targeted identity calls after local pass",
      schema: "no shared schema migration expected",
      estimatedDuration: "45-90 minutes",
    }),
  );

  const url = process.env.DATABASE_URL?.trim();
  const apiKey = process.env.COURTLISTENER_API_KEY?.trim();
  if (!url || /localhost|127\.0\.0\.1|:5433/i.test(url)) {
    console.log(JSON.stringify({ ok: false, reason: "need Neon DATABASE_URL" }));
    process.exit(2);
  }
  if (!apiKey) {
    console.log(JSON.stringify({ ok: false, reason: "COURTLISTENER_API_KEY missing" }));
    process.exit(2);
  }
  if (!fs.existsSync(DB_PATH)) {
    console.log(JSON.stringify({ ok: false, reason: "missing_sqlite_index", DB_PATH }));
    process.exit(2);
  }

  const owned = acquireWorkerLock({
    reportsDir: REPORTS_DIR,
    workerId: WORKER_ID,
    processStartNonce: PROCESS_NONCE,
    currentLane: "CITATION_IDENTITY",
    currentTask: "final_citation_identity_cleanup",
  });
  if (!owned.ok) {
    console.log(JSON.stringify({ ok: false, reason: owned.refusal || ACTIVE_REFUSAL_CODE, lock: owned.lock }));
    process.exit(2);
  }
  console.log(JSON.stringify({ runtimeLockAcquired: true, workerId: WORKER_ID, code: owned.code }));

  const hb = setInterval(() => {
    try {
      refreshWorkerHeartbeat({
        reportsDir: REPORTS_DIR,
        workerId: WORKER_ID,
        processStartNonce: PROCESS_NONCE,
        currentLane: "CITATION_IDENTITY",
        currentTask: "final_citation_identity_cleanup",
      });
    } catch {
      /* ignore */
    }
  }, 5 * 60 * 1000);

  const release = () => {
    clearInterval(hb);
    try {
      releaseWorkerLock({ reportsDir: REPORTS_DIR, workerId: WORKER_ID, processStartNonce: PROCESS_NONCE });
    } catch {
      /* ignore */
    }
  };
  process.on("exit", release);
  process.on("SIGINT", () => {
    release();
    process.exit(130);
  });

  const bulkDb = openBulkDb();
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 30, connect_timeout: 60 });
  const ledgerAll = [];
  const negCache = loadNegCache();
  const report = {
    classification: "FINAL_REMAINING_CITATION_IDENTITY_CLEANUP",
    ok: false,
  };

  try {
    const startHealth = await healthSnapshot(sql);
    console.log(JSON.stringify({ phase: "START_HEALTH", startHealth, host: new URL(url.replace(/^postgresql:/, "http:")).host }, null, 2));
    if (!startHealth.green) {
      report.stopReason = "START_HEALTH_NOT_GREEN";
      report.startHealth = startHealth;
      writeJson(REPORT, report);
      process.exit(3);
    }

    await sql.unsafe("BEGIN READ ONLY");
    const unresolved = await sql`
      select e.id, e.from_authority_id, e.raw_citation, e.normalized_citation, e.created_at,
             a.court_id as from_court_id, a.court as from_court
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
    const [edgeTotalStart] = await sql`select count(*)::int as n from legal_authority_citations`;
    await sql.unsafe("COMMIT");

    let index = rebuildIndex(authorityRows);
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

    // ---- PHASE A/B/C local classify ----
    const localResolved = [];
    const ambiguous = [];
    const notFound = [];
    const ineligible = [];
    let targetsExamined = 0;
    for (const t of queue.targets) {
      targetsExamined += 1;
      const classified = classifyLocalTarget(t, index, bulkDb);
      const row = { ...t, ...classified };
      if (classified.bucket === "LOCAL_RESOLVED") localResolved.push(row);
      else if (classified.bucket === "AMBIGUOUS") ambiguous.push(row);
      else if (classified.bucket === "NOT_FOUND") notFound.push(row);
      else ineligible.push(row);
    }
    if (CL_ONLY) {
      console.log(JSON.stringify({ phase: "CL_ONLY_SKIP_LOCAL_WRITE", localCandidates: localResolved.length }));
      localResolved.length = 0;
    }

    const startState = {
      TOTAL_CANONICAL_AUTHORITIES: startHealth.TOTAL_CANONICAL_AUTHORITIES,
      AUTHORITY_RESOLVED_EDGES: startHealth.AUTHORITY_RESOLVED_EDGES,
      CORPUS_COMPLETE_EDGES: startHealth.CORPUS_COMPLETE_EDGES,
      IDENTITY_UNRESOLVED_EDGES_RAW: startHealth.IDENTITY_UNRESOLVED_EDGES,
      TRUE_CASE_IDENTITY_UNRESOLVED_EDGES: ambiguous.reduce((s, r) => s + r.edgeCount, 0) + notFound.reduce((s, r) => s + r.edgeCount, 0),
      AMBIGUOUS_UNIQUE_TARGETS: ambiguous.length,
      AMBIGUOUS_EDGES: ambiguous.reduce((s, r) => s + r.edgeCount, 0),
      NOT_FOUND_UNIQUE_TARGETS: notFound.length,
      NOT_FOUND_EDGES: notFound.reduce((s, r) => s + r.edgeCount, 0),
      INELIGIBLE_UNIQUE_TARGETS: ineligible.length,
      INELIGIBLE_EDGES: ineligible.reduce((s, r) => s + r.edgeCount, 0),
      LOCAL_CANDIDATE_TARGETS: localResolved.length,
      LOCAL_CANDIDATE_EDGES: localResolved.reduce((s, r) => s + r.edgeCount, 0),
    };
    console.log(JSON.stringify({ phase: "RECOUNT_AND_LOCAL_CLASSIFY", startState, targetsExamined }, null, 2));

    // ---- PHASE D validate local ----
    const high = localResolved.filter((d) => d.edgeCount >= 5);
    const med = localResolved.filter((d) => d.edgeCount >= 3 && d.edgeCount <= 4);
    const low = localResolved.filter((d) => d.edgeCount <= 2);
    const unusual = localResolved.filter((d) => d.via === "bulk_variant" || (d.method && String(d.method).includes("NORMALIZED")));
    const sample = [];
    const seen = new Set();
    for (const arr of [high, med, low, unusual, localResolved]) {
      for (const r of arr) {
        if (seen.has(r.targetKey)) continue;
        seen.add(r.targetKey);
        sample.push(r);
        if (sample.length >= 200) break;
      }
      if (sample.length >= 200) break;
    }
    let wrong = 0;
    const wrongExamples = [];
    for (const r of sample) {
      if (r.authorityId) {
        const again = index.lookupCitation(r.representativeRaw, r.normalizedCitation);
        if (again.kind !== "one" || again.authorityId !== r.authorityId) {
          // bulk-only resolutions may not re-hit via index until stub exists
          if (!r.clusterId) {
            wrong += 1;
            wrongExamples.push({ citation: r.normalizedCitation, issue: "local_relookup_mismatch" });
          }
        }
        continue;
      }
      if (!r.clusterId || (r.clusterIds || []).length !== 1) {
        wrong += 1;
        wrongExamples.push({ citation: r.normalizedCitation, issue: "not_unique_cluster" });
        continue;
      }
      const vk = r.vrpKey || citationToBulkVrpKey(r.normalizedCitation);
      const again = lookupClusters(bulkDb, vk);
      if (again.length !== 1 || again[0] !== r.clusterId) {
        wrong += 1;
        wrongExamples.push({ citation: r.normalizedCitation, issue: "bulk_relookup_mismatch", again });
      }
    }
    const validation = {
      sampleValidated: sample.length,
      highEdge: Math.min(50, high.length),
      mediumEdge: Math.min(50, med.length),
      lowEdge: Math.min(50, low.length),
      unusual: Math.min(50, unusual.length),
      wrongMatchesFound: wrong,
      wrongExamples: wrongExamples.slice(0, 20),
      validationResult: wrong === 0 ? "PASS" : "FAIL",
    };
    console.log(JSON.stringify({ phase: "LOCAL_VALIDATION", validation, localResolved: localResolved.length }, null, 2));
    if (validation.validationResult !== "PASS") {
      report.stopReason = "LOCAL_VALIDATION_FAILED";
      report.startState = startState;
      report.validation = validation;
      writeJson(REPORT, report);
      process.exit(3);
    }

    // ---- PHASE E apply local ----
    let localTargetsResolved = 0;
    let localEdgesResolved = 0;
    let ambToResolved = 0;
    let nfToResolved = 0;
    let newStubs = 0;
    const unresolvedIdSet = new Set(unresolved.map((e) => e.id));
    const priorAmbKeys = new Set(ambiguous.map((a) => a.targetKey));
    const priorNfKeys = new Set(notFound.map((a) => a.targetKey));
    // Note: localResolved came from full queue; classify already excluded amb/nf leftovers.
    // Track whether each resolution was from a target that would have been nf/amb without local hit:
    // For reporting, count by via.

    if (!DRY_ONLY) {
      for (const d of localResolved) {
        const liveEdgeIds = (d.edgeIds || []).filter((id) => unresolvedIdSet.has(id));
        if (!liveEdgeIds.length) continue;
        const dLive = { ...d, edgeIds: liveEdgeIds };
        let authorityId = d.authorityId || null;
        let corpusComplete = false;
        if (!authorityId && d.clusterId) {
          const ensured = await ensureIdentityStub(sql, dLive, d.clusterId, d.parallelCitations || [], METHOD_BULK);
          if (!ensured.ok) continue;
          authorityId = ensured.authorityId;
          corpusComplete = ensured.corpusComplete;
          if (ensured.created) {
            newStubs += 1;
            authorityRows.push({
              id: authorityId,
              citation: d.normalizedCitation,
              normalized_citation: experimentalNormalize(d.normalizedCitation) || d.normalizedCitation,
              metadata: { parallelCitations: d.parallelCitations, citationAliases: [d.normalizedCitation], clClusterId: d.clusterId, identityOnly: true },
              source_external_id: `cl-cluster-${d.clusterId}`,
              source_provider: SOURCE,
              ingestion_status: "pending",
              has_embeddings: false,
            });
          }
        } else if (authorityId) {
          const auth = authorityRows.find((a) => a.id === authorityId);
          corpusComplete = Boolean(auth?.has_embeddings) && auth?.ingestion_status === "ready";
        } else {
          continue;
        }
        const method = d.method || METHOD_LOCAL;
        const evidence = d.evidence || [`via:${d.via}`];
        const bf = await backfillTargetEdges(sql, dLive, authorityId, method, evidence, corpusComplete, d.clusterId ? "courtlistener" : "local");
        if (bf.updated > 0) {
          localTargetsResolved += 1;
          localEdgesResolved += bf.updated;
          for (const id of liveEdgeIds) unresolvedIdSet.delete(id);
          ledgerAll.push(...bf.ledger);
          if (d.via === "bulk_variant") nfToResolved += bf.updated;
        }
      }
    }

    // Rebuild index + second local pass over remaining (alias/parallel learning)
    index = rebuildIndex(authorityRows);
    let postLocalSecondTargets = 0;
    let postLocalSecondEdges = 0;
    if (!DRY_ONLY) {
      const remainingLocal = await sql`
        select id, from_authority_id, raw_citation, normalized_citation
        from legal_authority_citations where to_authority_id is null
      `;
      const byKey = new Map();
      for (const e of remainingLocal) {
        const k = targetKey(e.raw_citation, e.normalized_citation);
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push(e);
      }
      for (const [k, edges] of byKey) {
        const sampleEdge = edges[0];
        const hit = index.lookupCitation(sampleEdge.raw_citation, sampleEdge.normalized_citation);
        if (hit.kind !== "one") continue;
        const auth = authorityRows.find((a) => a.id === hit.authorityId);
        const corpusComplete = Boolean(auth?.has_embeddings) && auth?.ingestion_status === "ready";
        let updated = 0;
        for (const e of edges) {
          const rows = await sql`
            update legal_authority_citations
            set to_authority_id = ${hit.authorityId}
            where id = ${e.id} and to_authority_id is null
            returning id, raw_citation, from_authority_id, normalized_citation
          `;
          if (!rows.length) continue;
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
              externalIdentity: { provider: "local", clusterId: null, opinionId: null },
              state: corpusComplete ? "CORPUS_COMPLETE" : "AUTHORITY_RESOLVED",
            }),
          );
        }
        if (updated > 0) {
          postLocalSecondTargets += 1;
          postLocalSecondEdges += updated;
          localTargetsResolved += 1;
          localEdgesResolved += updated;
        }
      }
    }

    // Recount after local
    const afterLocalHealth = await healthSnapshot(sql);
    const remAfterLocal = await sql`
      select e.id, e.from_authority_id, e.raw_citation, e.normalized_citation, e.created_at,
             a.court_id as from_court_id, a.court as from_court
      from legal_authority_citations e
      left join legal_authorities a on a.id = e.from_authority_id
      where e.to_authority_id is null
    `;
    index = rebuildIndex(authorityRows);
    const queue2 = buildUnresolvedTargetQueue(
      remAfterLocal.map((e) => ({
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
    const amb2 = [];
    const nf2 = [];
    const inel2 = [];
    for (const t of queue2.targets) {
      const c = classifyLocalTarget(t, index, bulkDb);
      const row = { ...t, ...c };
      if (c.bucket === "AMBIGUOUS") amb2.push(row);
      else if (c.bucket === "NOT_FOUND") nf2.push(row);
      else if (c.bucket === "INELIGIBLE") inel2.push(row);
      else if (c.bucket === "LOCAL_RESOLVED") {
        // should be rare after write; leave for post-CL local
      }
    }
    const afterLocal = {
      IDENTITY_UNRESOLVED_EDGES_RAW: afterLocalHealth.IDENTITY_UNRESOLVED_EDGES,
      TRUE_CASE_IDENTITY_UNRESOLVED_EDGES: amb2.reduce((s, r) => s + r.edgeCount, 0) + nf2.reduce((s, r) => s + r.edgeCount, 0),
      AMBIGUOUS_TARGETS: amb2.length,
      AMBIGUOUS_EDGES: amb2.reduce((s, r) => s + r.edgeCount, 0),
      NOT_FOUND_TARGETS: nf2.length,
      NOT_FOUND_EDGES: nf2.reduce((s, r) => s + r.edgeCount, 0),
      INELIGIBLE_EDGES: inel2.reduce((s, r) => s + r.edgeCount, 0),
      localTargetsResolved,
      localEdgesResolved,
      postLocalSecondTargets,
      postLocalSecondEdges,
      newStubs,
    };
    console.log(JSON.stringify({ phase: "AFTER_LOCAL", afterLocal }, null, 2));

    // ---- PHASE G/H external queue + quota ----
    const volumeCoverage = buildBulkVolumeCoverage(bulkDb);
    console.log(JSON.stringify({ phase: "BULK_VOLUME_COVERAGE", reporterVolumes: volumeCoverage.size }));

    const providerUnsupportedPre = [];
    const eligibleExternal = [];
    for (const t of filterExternalIdentityQueueTargets(nf2)) {
      if (negCache.notFound[t.targetKey] || negCache.ambiguous[t.targetKey]) continue;
      const covKey = volumeCoverageKeyFromCitation(t.normalizedCitation) || volumeCoverageKeyFromCitation(t.representativeRaw);
      const covered = covKey ? volumeCoverage.has(covKey) : false;
      const row = { ...t, bulkVolumeCovered: covered, bulkVolumeKey: covKey };
      // Volumes entirely absent from CL bulk citation dump are extremely likely EXTERNAL_NOT_FOUND
      // via citation-lookup (confirmed for recent U.S. vols). Do not burn quota; classify provider gap.
      if (covKey && !covered) {
        providerUnsupportedPre.push(row);
        negCache.notFound[t.targetKey] = {
          at: new Date().toISOString(),
          query: t.normalizedCitation,
          reason: "bulk_volume_absent_provider_gap",
          bulkVolumeKey: covKey,
        };
        continue;
      }
      eligibleExternal.push(row);
    }
    // Prefer bulk-covered volumes, then edge demand / citing breadth.
    eligibleExternal.sort(
      (a, b) =>
        Number(b.bulkVolumeCovered) - Number(a.bulkVolumeCovered) ||
        b.edgeCount - a.edgeCount ||
        b.uniqueCitingCases - a.uniqueCitingCases,
    );
    console.log(
      JSON.stringify({
        phase: "EXTERNAL_QUEUE",
        eligibleExternal: eligibleExternal.length,
        providerUnsupportedPreclassified: providerUnsupportedPre.length,
        providerUnsupportedEdges: providerUnsupportedPre.reduce((s, t) => s + t.edgeCount, 0),
        top: eligibleExternal.slice(0, 15).map((t) => ({
          cite: t.normalizedCitation,
          edges: t.edgeCount,
          covered: t.bulkVolumeCovered,
          vol: t.bulkVolumeKey,
        })),
      }),
    );
    saveNegCache(negCache);

    const quota = await probeQuota(apiKey);
    const selected = selectExternalBudget(quota, eligibleExternal.length, CL_BUDGET_CAP);
    const minuteRem = selected.userMin;
    const hourRem = selected.userHour;
    const dayRem = selected.userDay;
    const CL_PACING_MS = CL_PACING_MS_OVERRIDE || selected.pacingMs;
    const externalBudget = SKIP_CL || DRY_ONLY ? 0 : selected.externalBudget;
    console.log(
      JSON.stringify(
        {
          phase: "CL_QUOTA",
          minuteRem,
          hourRem,
          dayRem,
          binding: {
            minute: quota.bindingMinute,
            hour: quota.bindingHour,
            day: quota.bindingDay,
          },
          membership: quota.membership,
          resets: {
            minute: quota.bindingMinute?.reset_at || quota.minute?.reset_at || null,
            hour: quota.bindingHour?.reset_at || quota.hour?.reset_at || null,
            day: quota.bindingDay?.reset_at || quota.day?.reset_at || null,
          },
          eligibleExternal: eligibleExternal.length,
          externalBudget,
          pacingMs: CL_PACING_MS,
          selected,
        },
        null,
        2,
      ),
    );

    // ---- PHASE I/J CL run ----
    let clRequests = 0;
    let clHigh = 0;
    let clAmb = 0;
    let clNf = 0;
    let clFail = 0;
    let cl429 = false;
    let cl5xx = 0;
    let externalTargetsResolved = 0;
    let externalEdgesResolved = 0;
    let stopExternalReason = null;
    const clCheckpoint = { completed: [], lastTargetKey: null, retryAfter: null, timestamp: null };

    const rolling = { high: 0, amb: 0, nf: 0, edges: 0, req: 0 };

    for (let i = 0; i < eligibleExternal.length && clRequests < externalBudget; i++) {
      const t = eligibleExternal[i];
      const texts = [...new Set([t.normalizedCitation, ...deterministicCitationVariants(t.normalizedCitation)].filter(Boolean))];
      const queryText = texts[0];
      if (clRequests > 0) await sleep(CL_PACING_MS);

      let look = await clLookup(apiKey, queryText);
      clRequests += 1;
      rolling.req += 1;
      clCheckpoint.lastTargetKey = t.targetKey;
      clCheckpoint.completed.push(t.targetKey);

      if (look.httpStatus === 429) {
        cl429 = true;
        clCheckpoint.retryAfter = look.retryAfter;
        clCheckpoint.timestamp = new Date().toISOString();
        stopExternalReason = "HTTP_429";
        console.log(JSON.stringify({ phase: "CL_429_STOP", ...clCheckpoint, clRequests }));
        break;
      }
      if (look.httpStatus === 502 || look.httpStatus === 504) {
        cl5xx += 1;
        await sleep(2000);
        look = await clLookup(apiKey, queryText);
        clRequests += 1;
        rolling.req += 1;
        if (look.httpStatus === 502 || look.httpStatus === 504 || look.httpStatus === 429) {
          stopExternalReason = `HTTP_${look.httpStatus}`;
          break;
        }
      }

      let result = look.result;
      // Materially different strategy only when text miss and volume is bulk-covered.
      if (result.status === "not_found" && t.bulkVolumeCovered) {
        await sleep(CL_PACING_MS);
        const vrpLook = await clLookupVrp(apiKey, queryText);
        if (vrpLook) {
          clRequests += 1;
          rolling.req += 1;
          if (vrpLook.httpStatus === 429) {
            cl429 = true;
            clCheckpoint.retryAfter = vrpLook.retryAfter;
            clCheckpoint.timestamp = new Date().toISOString();
            stopExternalReason = "HTTP_429";
            break;
          }
          if (vrpLook.result.status === "resolved" || vrpLook.result.status === "ambiguous") {
            result = vrpLook.result;
          }
        }
      }
      if (result.status === "resolved" && result.clusterId) {
        clHigh += 1;
        rolling.high += 1;
        const ensured = await ensureIdentityStub(sql, t, result.clusterId, result.citations || [], METHOD_CL);
        if (ensured.ok) {
          if (ensured.created) {
            newStubs += 1;
            authorityRows.push({
              id: ensured.authorityId,
              citation: t.normalizedCitation,
              normalized_citation: experimentalNormalize(t.normalizedCitation) || t.normalizedCitation,
              metadata: { parallelCitations: result.citations || [], citationAliases: [t.normalizedCitation], clClusterId: result.clusterId, identityOnly: true },
              source_external_id: `cl-cluster-${result.clusterId}`,
              source_provider: SOURCE,
              ingestion_status: "pending",
              has_embeddings: false,
            });
          }
          const bf = await backfillTargetEdges(
            sql,
            t,
            ensured.authorityId,
            METHOD_CL,
            result.evidence || [`cluster:${result.clusterId}`],
            ensured.corpusComplete,
            "courtlistener",
          );
          if (bf.updated > 0) {
            externalTargetsResolved += 1;
            externalEdgesResolved += bf.updated;
            rolling.edges += bf.updated;
            ledgerAll.push(...bf.ledger);
          }
        }
      } else if (result.status === "ambiguous") {
        clAmb += 1;
        rolling.amb += 1;
        negCache.ambiguous[t.targetKey] = {
          at: new Date().toISOString(),
          evidence: result.evidence || [],
          candidates: (result.candidates || []).slice(0, 6),
        };
      } else if (result.status === "not_found") {
        clNf += 1;
        rolling.nf += 1;
        negCache.notFound[t.targetKey] = { at: new Date().toISOString(), query: queryText };
      } else {
        clFail += 1;
      }

      // Early-stop economic gates after meaningful sample
      if (rolling.req >= 40) {
        const highRate = rolling.high / rolling.req;
        const ambRate = rolling.amb / rolling.req;
        const edgesPer = rolling.edges / rolling.req;
        if (highRate < 0.55 || ambRate > 0.3 || edgesPer < 2.5) {
          stopExternalReason = "ECONOMIC_GATE";
          console.log(JSON.stringify({ phase: "CL_EARLY_STOP", highRate, ambRate, edgesPer, clRequests }));
          break;
        }
      }
      if (clRequests % 25 === 0) {
        console.log(
          JSON.stringify({
            phase: "CL_PROGRESS",
            clRequests,
            clHigh,
            clAmb,
            clNf,
            externalEdgesResolved,
            edgesPerCl: clRequests ? externalEdgesResolved / clRequests : 0,
          }),
        );
      }
    }
    saveNegCache(negCache);

    // ---- PHASE K post-CL local ----
    index = rebuildIndex(authorityRows);
    let postClLocalTargets = 0;
    let postClLocalEdges = 0;
    if (!DRY_ONLY) {
      const rem3 = await sql`
        select id, from_authority_id, raw_citation, normalized_citation
        from legal_authority_citations where to_authority_id is null
      `;
      const byKey3 = new Map();
      for (const e of rem3) {
        const k = targetKey(e.raw_citation, e.normalized_citation);
        if (!byKey3.has(k)) byKey3.set(k, []);
        byKey3.get(k).push(e);
      }
      for (const [k, edges] of byKey3) {
        const sampleEdge = edges[0];
        const hit = index.lookupCitation(sampleEdge.raw_citation, sampleEdge.normalized_citation);
        if (hit.kind !== "one") continue;
        const auth = authorityRows.find((a) => a.id === hit.authorityId);
        const corpusComplete = Boolean(auth?.has_embeddings) && auth?.ingestion_status === "ready";
        let updated = 0;
        for (const e of edges) {
          const rows = await sql`
            update legal_authority_citations
            set to_authority_id = ${hit.authorityId}
            where id = ${e.id} and to_authority_id is null
            returning id, raw_citation, from_authority_id, normalized_citation
          `;
          if (!rows.length) continue;
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
              externalIdentity: { provider: "local_post_cl", clusterId: null, opinionId: null },
              state: corpusComplete ? "CORPUS_COMPLETE" : "AUTHORITY_RESOLVED",
            }),
          );
        }
        if (updated > 0) {
          postClLocalTargets += 1;
          postClLocalEdges += updated;
        }
      }
    }

    if (ledgerAll.length) appendLedger(LEDGER, ledgerAll);

    // ---- END recount + remainder classification ----
    const endHealth = await healthSnapshot(sql);
    const [edgeTotalEnd] = await sql`select count(*)::int as n from legal_authority_citations`;
    const remFinal = await sql`
      select e.id, e.from_authority_id, e.raw_citation, e.normalized_citation, e.created_at,
             a.court_id as from_court_id, a.court as from_court
      from legal_authority_citations e
      left join legal_authorities a on a.id = e.from_authority_id
      where e.to_authority_id is null
    `;
    authorityRows = await sql`
      select id, citation, normalized_citation, metadata, source_external_id, source_provider,
             title, court, court_id, decision_date, ingestion_status,
             exists(select 1 from legal_authority_chunks c where c.authority_id = legal_authorities.id and c.embedding is not null) as has_embeddings
      from legal_authorities
    `;
    index = rebuildIndex(authorityRows);
    const queueF = buildUnresolvedTargetQueue(
      remFinal.map((e) => ({
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
    const endAmb = [];
    const endNf = [];
    const endInel = [];
    const remainderBuckets = {
      EXTERNAL_AMBIGUOUS: 0,
      EXTERNAL_NOT_FOUND: 0,
      INSUFFICIENT_CONTEXT: 0,
      TRUE_VRP_COLLISION: 0,
      PROVIDER_UNSUPPORTED: 0,
      MALFORMED_BUT_CASE_LIKE: 0,
      DEFERRED_DUE_TO_QUOTA: 0,
    };
    const deferredKeys = new Set(eligibleExternal.slice(externalBudget).map((t) => t.targetKey));
    for (const t of queueF.targets) {
      const c = classifyLocalTarget(t, index, bulkDb);
      if (c.bucket === "INELIGIBLE") {
        endInel.push({ ...t, ...c });
        continue;
      }
      if (c.bucket === "AMBIGUOUS") {
        endAmb.push({ ...t, ...c });
        if ((c.clusterIds || []).length >= 2) remainderBuckets.TRUE_VRP_COLLISION += t.edgeCount;
        else if (negCache.ambiguous[t.targetKey]) remainderBuckets.EXTERNAL_AMBIGUOUS += t.edgeCount;
        else remainderBuckets.INSUFFICIENT_CONTEXT += t.edgeCount;
        continue;
      }
      if (c.bucket === "NOT_FOUND") {
        endNf.push({ ...t, ...c });
        const nfMeta = negCache.notFound[t.targetKey];
        if (nfMeta?.reason === "bulk_volume_absent_provider_gap") {
          remainderBuckets.PROVIDER_UNSUPPORTED += t.edgeCount;
        } else if (nfMeta) {
          remainderBuckets.EXTERNAL_NOT_FOUND += t.edgeCount;
        } else if (deferredKeys.has(t.targetKey) || stopExternalReason === "ECONOMIC_GATE" || stopExternalReason === "HTTP_429") {
          remainderBuckets.DEFERRED_DUE_TO_QUOTA += t.edgeCount;
        } else {
          const el = classifyCaseCitationLookupEligibility(t.representativeRaw, t.normalizedCitation);
          if (!el.eligible) remainderBuckets.MALFORMED_BUT_CASE_LIKE += t.edgeCount;
          else remainderBuckets.PROVIDER_UNSUPPORTED += t.edgeCount;
        }
      }
    }

    // Idempotency dry: localResolved should not re-write
    let idempotentWouldWrite = 0;
    for (const d of localResolved.slice(0, 200)) {
      const still = remFinal.filter((e) => targetKey(e.raw_citation, e.normalized_citation) === d.targetKey);
      if (still.length) idempotentWouldWrite += still.length;
    }

    const endState = {
      IDENTITY_UNRESOLVED_EDGES_RAW: endHealth.IDENTITY_UNRESOLVED_EDGES,
      TRUE_CASE_IDENTITY_UNRESOLVED_EDGES: endAmb.reduce((s, r) => s + r.edgeCount, 0) + endNf.reduce((s, r) => s + r.edgeCount, 0),
      AMBIGUOUS_EDGES: endAmb.reduce((s, r) => s + r.edgeCount, 0),
      NOT_FOUND_EDGES: endNf.reduce((s, r) => s + r.edgeCount, 0),
      INELIGIBLE_EDGES: endInel.reduce((s, r) => s + r.edgeCount, 0),
      AMBIGUOUS_TARGETS: endAmb.length,
      NOT_FOUND_TARGETS: endNf.length,
    };

    const trueCaseStart = startState.TRUE_CASE_IDENTITY_UNRESOLVED_EDGES;
    const trueCaseEnd = endState.TRUE_CASE_IDENTITY_UNRESOLVED_EDGES;
    const totalTrueResolved = Math.max(0, trueCaseStart - trueCaseEnd);
    const pctReduced = trueCaseStart ? Math.round((totalTrueResolved / trueCaseStart) * 1000) / 10 : 0;
    const newOutboundEdges = Math.max(0, edgeTotalEnd.n - edgeTotalStart.n);

    const highRate = clRequests ? clHigh / clRequests : 0;
    const ambRate = clRequests ? clAmb / clRequests : 0;
    const nfRate = clRequests ? clNf / clRequests : 0;
    const edgesPerCl = clRequests ? externalEdgesResolved / clRequests : 0;

    Object.assign(report, {
      ok: true,
      startState,
      local: {
        targetsExamined,
        newNormalizationRules: [
          "scrubCitationUnicode",
          "deterministicCitationVariants",
          "regional reporter aliases",
          "F.4th / P.2d / So.2d / A.2d VRP",
          "isUnsafeOcrTransform gate",
        ],
        targetsResolved: localTargetsResolved,
        edgesResolved: localEdgesResolved,
        wrongMatches: wrong,
        ambToResolved,
        nfToResolved,
        postLocalSecondTargets,
        postLocalSecondEdges,
        newStubsLocalPhase: newStubs,
      },
      validation,
      afterLocal,
      clQuota: { minuteRem, hourRem, dayRem, externalBudget, membership: quota.membership },
      external: {
        clRequests,
        high: clHigh,
        highRate,
        ambiguous: clAmb,
        ambRate,
        notFound: clNf,
        nfRate,
        externalTargetsResolved,
        externalEdgesResolved,
        edgesPerCl,
        cl429,
        cl5xx,
        stopExternalReason,
        checkpoint: clCheckpoint,
      },
      postClLocal: { targetsResolved: postClLocalTargets, edgesResolved: postClLocalEdges },
      endState,
      remainderBuckets,
      health: endHealth,
      newOutboundEdges,
      idempotency: { duplicateWrites: idempotentWouldWrite, note: "nonzero means still-unresolved prior local candidates" },
      reduction: {
        localEdgesResolved,
        externalEdgesResolved,
        postClLocalEdges,
        TOTAL_TRUE_CASE_EDGES_RESOLVED: totalTrueResolved,
        percentReduced: pctReduced,
      },
    });
    writeJson(REPORT, report);
    console.log(JSON.stringify({ phase: "DONE", reportSummary: {
      startTrueCase: trueCaseStart,
      endTrueCase: trueCaseEnd,
      localEdgesResolved,
      externalEdgesResolved,
      postClLocalEdges,
      clRequests,
      newOutboundEdges,
      endHealthGreen: endHealth.green,
      stopExternalReason,
    } }, null, 2));
  } catch (err) {
    report.ok = false;
    report.error = String(err?.stack || err);
    writeJson(REPORT, report);
    console.error(report.error);
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
    release();
  }
}

main();
