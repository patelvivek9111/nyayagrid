/**
 * Phase 1C: Scaled live CourtListener identity batch 2.
 * TOTAL CL hard cap: 70 (1 quota probe + ≤69 identity lookups).
 * Identity only. Zero full-text acquisition. Intra-batch learning.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const postgres = require("postgres");
const {
  LocalAuthorityIndex,
  buildUnresolvedTargetQueue,
  targetKey,
  experimentalNormalize,
  parseCitationLookupResponse,
  createResolutionRecord,
  appendLedger,
  loadLedger,
  RESOLVER_VERSION,
} = require("../packages/research/src/corpus/citation-resolution/cjs-bridge.cjs");

const TOTAL_CL_CAP = 70;
const RATE_MS = 5000;
const CL_BASE = "https://www.courtlistener.com/api/rest/v4";
const SOURCE = "courtlistener";
const BATCH1_REPORT = path.join(
  __dirname,
  "..",
  "packages/research/corpus/reports/citation-identity-live-batch1-2026-10-09.json",
);
const CHECKPOINT_DIR = path.join(__dirname, "..", "packages/research/corpus/resolution/checkpoints");
const LEDGER_PATH = path.join(
  __dirname,
  "..",
  "packages/research/corpus/resolution/ledger/cl-identity-batch2-2026-10-09.jsonl",
);
const REPORT_JSON = path.join(
  __dirname,
  "..",
  "packages/research/corpus/reports/citation-identity-live-batch2-2026-10-09.json",
);
const REPORT_MD = path.join(
  __dirname,
  "..",
  "packages/research/corpus/reports/citation-identity-live-batch2-2026-10-09.md",
);
const FULLTEXT_QUEUE = path.join(
  __dirname,
  "..",
  "packages/research/corpus/resolution/fulltext-demand-queue-2026-10-09.json",
);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
}

async function probeQuota(apiKey) {
  const t0 = Date.now();
  const res = await fetch(`${CL_BASE}/api-usage/`, {
    headers: { Authorization: `Token ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  const j = await res.json().catch(() => ({}));
  const membership = j.membership || null;
  const current = j.current_usage || j.usage || [];
  function normalizeRows(raw) {
    const out = [];
    const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
    for (const row of list) {
      if (!row || typeof row !== "object") continue;
      if (row.minute || row.hour || row.day) {
        for (const period of ["minute", "hour", "day"]) {
          const p = row[period];
          if (!p) continue;
          out.push({
            period,
            limit: Number(p.limit ?? p.rate_limit ?? null),
            usage: Number(p.usage ?? p.used ?? null),
            remaining: Number(
              p.remaining ?? (p.limit != null && p.usage != null ? Number(p.limit) - Number(p.usage) : null),
            ),
          });
        }
        continue;
      }
      const periodRaw = String(row.period || row.window || row.rate || row.name || "").toLowerCase();
      const period = periodRaw.includes("min")
        ? "minute"
        : periodRaw.includes("hour")
          ? "hour"
          : periodRaw.includes("day")
            ? "day"
            : null;
      out.push({
        period,
        limit: Number(row.limit ?? row.rate_limit ?? null),
        usage: Number(row.usage ?? row.used ?? null),
        remaining: Number(
          row.remaining ?? (row.limit != null && row.usage != null ? Number(row.limit) - Number(row.usage) : null),
        ),
      });
    }
    return out;
  }
  let rows = [];
  if (Array.isArray(current)) {
    const userish = current.filter((x) =>
      String(x.scope || x.throttle || x.name || "")
        .toLowerCase()
        .includes("user"),
    );
    rows = normalizeRows(userish.length ? userish : current);
  } else if (current && typeof current === "object") {
    rows = normalizeRows(current.user || current);
  }
  const byPeriod = {};
  for (const row of rows) if (row.period) byPeriod[row.period] = row;
  return {
    ok: res.ok,
    status: res.status,
    ms: Date.now() - t0,
    membership: { level: membership?.level || membership?.name || null, is_active: membership?.is_active ?? null },
    minute: byPeriod.minute || null,
    hour: byPeriod.hour || null,
    day: byPeriod.day || null,
    courtListenerHttpCalls: 1,
  };
}

async function authorityCompleteness(sql) {
  const [row] = await sql`
    select
      count(*)::int as total_canonical_authorities,
      count(*) filter (where authority_type='case')::int as case_typed_authorities,
      count(*) filter (
        where authority_type='case'
          and ingestion_status = 'ready'
          and exists (
            select 1 from legal_authority_chunks c
            where c.authority_id = legal_authorities.id and c.embedding is not null
          )
      )::int as corpus_complete_authorities,
      count(*) filter (
        where authority_type='case'
          and (
            ingestion_status is distinct from 'ready'
            or not exists (
              select 1 from legal_authority_chunks c
              where c.authority_id = legal_authorities.id and c.embedding is not null
            )
          )
      )::int as metadata_only_authorities,
      count(*) filter (where authority_type='case' and ingestion_status='ready')::int as full_text_ready_authorities,
      count(*) filter (
        where exists (
          select 1 from legal_authority_chunks c
          where c.authority_id = legal_authorities.id and c.embedding is not null
        )
      )::int as embedded_authorities
    from legal_authorities
  `;
  const [edges] = await sql`
    select
      count(*) filter (where to_authority_id is not null)::int as authority_resolved_edges,
      count(*) filter (
        where to_authority_id is not null
          and a.ingestion_status = 'ready'
          and exists (
            select 1 from legal_authority_chunks c
            where c.authority_id = a.id and c.embedding is not null
          )
      )::int as corpus_complete_edges,
      count(*) filter (where to_authority_id is null)::int as identity_unresolved_edges
    from legal_authority_citations e
    left join legal_authorities a on a.id = e.to_authority_id
  `;
  return {
    TOTAL_CANONICAL_AUTHORITIES: row.total_canonical_authorities,
    METADATA_ONLY_AUTHORITIES: row.metadata_only_authorities,
    CORPUS_COMPLETE_AUTHORITIES: row.corpus_complete_authorities,
    FULL_TEXT_READY_AUTHORITIES: row.full_text_ready_authorities,
    EMBEDDED_AUTHORITIES: row.embedded_authorities,
    CASE_TYPED_AUTHORITIES: row.case_typed_authorities,
    note: "case-typed count includes metadata-only AUTHORITY_RESOLVED identities; CORPUS_COMPLETE requires ready+embeddings",
    AUTHORITY_RESOLVED_EDGES: edges.authority_resolved_edges,
    CORPUS_COMPLETE_EDGES: edges.corpus_complete_edges,
    IDENTITY_UNRESOLVED_EDGES: edges.identity_unresolved_edges,
  };
}

async function healthSnapshot(sql) {
  const [cases] = await sql`select count(*)::int as n from legal_authorities where authority_type='case'`;
  const [auth] = await sql`select count(*)::int as n from legal_authorities`;
  const [cite] = await sql`
    select count(*)::int as extracted,
           count(*) filter (where to_authority_id is not null)::int as resolved,
           count(*) filter (where to_authority_id is null)::int as unresolved
    from legal_authority_citations
  `;
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
  const green =
    h.duplicates === 0 &&
    h.orphans === 0 &&
    h.missing_embeddings === 0 &&
    failed === 0 &&
    notProcessed === 0 &&
    presentTargetDefectsDeterministic === 0;
  const completeness = await authorityCompleteness(sql);
  return {
    casesTyped: cases.n,
    authorities: auth.n,
    extracted: cite.extracted,
    resolved: cite.resolved,
    unresolved: cite.unresolved,
    duplicates: h.duplicates,
    orphans: h.orphans,
    missingEmbeddings: h.missing_embeddings,
    failed,
    notProcessed,
    presentTargetDefectsDeterministic,
    presentTargetAmbiguous: presentRows.filter((r) => Number(r.n) > 1).length,
    green,
    ...completeness,
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

async function ensureIdentityAuthority(sql, target, lookup) {
  const clusterId = lookup.clusterId;
  const citations = lookup.citations || [];
  const primaryCite =
    citations.find((c) => targetKey(c, c) === target.targetKey) ||
    experimentalNormalize(target.normalizedCitation) ||
    target.normalizedCitation;
  const existing = await findExistingAuthority(sql, { clusterId, normalizedCitation: primaryCite, citations });
  if (existing.ambiguous) return { ok: false, reason: "local_ambiguous_after_lookup" };
  if (existing.row) {
    const corpusComplete = Boolean(existing.row.has_embeddings) && existing.row.ingestion_status === "ready";
    const [full] = await sql`select metadata from legal_authorities where id = ${existing.row.id}`;
    const meta = full?.metadata && typeof full.metadata === "object" ? { ...full.metadata } : {};
    const aliases = Array.isArray(meta.citationAliases) ? meta.citationAliases : [];
    const parallels = Array.isArray(meta.parallelCitations) ? meta.parallelCitations : [];
    meta.citationAliases = [...new Set([...aliases, target.normalizedCitation, target.representativeRaw, ...citations].filter(Boolean))].slice(0, 24);
    meta.parallelCitations = [...new Set([...parallels, ...citations].filter(Boolean))].slice(0, 24);
    meta.identityResolution = {
      method: "COURTLISTENER_CITATION_LOOKUP",
      clusterId,
      batch: "batch2",
      resolvedAt: new Date().toISOString(),
      resolverVersion: RESOLVER_VERSION,
    };
    await sql`
      update legal_authorities
      set metadata = ${sql.json(meta)}, last_checked_at = now(), updated_at = now()
      where id = ${existing.row.id}
    `;
    return { ok: true, authorityId: existing.row.id, created: false, corpusComplete, via: existing.via };
  }

  const authorityId = crypto.randomUUID();
  const title = lookup.caseName || primaryCite || target.normalizedCitation;
  const metadata = {
    adapter: "citation-resolution-identity-batch2",
    identityOnly: true,
    corpusComplete: false,
    clClusterId: clusterId,
    clOpinionIds: lookup.opinionIds || [],
    parallelCitations: citations.slice(0, 12),
    citationAliases: [...new Set([target.normalizedCitation, target.representativeRaw, primaryCite, ...citations].filter(Boolean))].slice(0, 24),
    identityResolution: {
      method: "COURTLISTENER_CITATION_LOOKUP",
      clusterId,
      court: lookup.court,
      dateFiled: lookup.dateFiled,
      evidence: lookup.evidence,
      batch: "batch2",
      resolvedAt: new Date().toISOString(),
      resolverVersion: RESOLVER_VERSION,
    },
    demandQueueCandidate: true,
    edgeDemand: target.edgeCount,
  };
  await sql`
    insert into legal_authorities (
      id, authority_type, jurisdiction, court, court_id, title, citation, normalized_citation,
      decision_date, source_provider, source_external_id, canonical_source_url,
      metadata, ingestion_status, created_at, updated_at, last_checked_at
    ) values (
      ${authorityId}, 'case', ${lookup.court ? "us" : null}, ${lookup.court}, ${null},
      ${title}, ${primaryCite}, ${experimentalNormalize(primaryCite) || primaryCite},
      ${lookup.dateFiled ? String(lookup.dateFiled).slice(0, 10) : null},
      ${SOURCE}, ${`cl-cluster-${clusterId}`},
      ${`https://www.courtlistener.com/api/rest/v4/clusters/${clusterId}/`},
      ${sql.json(metadata)}, 'pending'::authority_ingestion_status,
      now(), now(), now()
    )
  `;
  return { ok: true, authorityId, created: true, corpusComplete: false, via: "created_identity" };
}

async function backfillTarget(sql, target, authorityId, method, evidence, corpusComplete) {
  const unresolved = await sql`
    select id, from_authority_id, raw_citation, normalized_citation
    from legal_authority_citations where to_authority_id is null
  `;
  const matches = unresolved.filter((e) => targetKey(e.raw_citation, e.normalized_citation) === target.targetKey);
  const ledger = [];
  let updated = 0;
  for (const e of matches) {
    const rows = await sql`
      update legal_authority_citations
      set to_authority_id = ${authorityId}
      where id = ${e.id} and to_authority_id is null
      returning id, raw_citation
    `;
    if (!rows.length) continue;
    if (rows[0].raw_citation !== e.raw_citation) throw new Error(`raw_citation_mutated:${e.id}`);
    updated += 1;
    ledger.push(
      createResolutionRecord({
        rawCitation: e.raw_citation || target.representativeRaw,
        normalizedCitation: e.normalized_citation || target.normalizedCitation,
        targetKey: target.targetKey,
        fromAuthorityId: e.from_authority_id,
        citationEdgeId: e.id,
        toAuthorityId: authorityId,
        method,
        confidence: "HIGH",
        evidence,
        externalIdentity: {
          provider: "courtlistener",
          clusterId: String(evidence.find((x) => String(x).startsWith("cluster:")) || "").replace("cluster:", "") || null,
          opinionId: null,
        },
        state: corpusComplete ? "CORPUS_COMPLETE" : "AUTHORITY_RESOLVED",
      }),
    );
  }
  return { updated, ledger };
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
      corpusComplete: a.corpusComplete,
    })),
  );
}

async function main() {
  const apiKey = process.env.COURTLISTENER_API_KEY?.trim();
  const url = process.env.DATABASE_URL?.trim();
  if (!apiKey) {
    console.log(JSON.stringify({ ok: false, reason: "COURTLISTENER_API_KEY missing" }));
    process.exit(2);
  }
  if (!url || /localhost|127\.0\.0\.1|:5433/i.test(url)) {
    console.log(JSON.stringify({ ok: false, reason: "need Neon DATABASE_URL" }));
    process.exit(2);
  }

  // ---- Quota gate (1 request) ----
  const quota = await probeQuota(apiKey);
  let totalCl = 1;
  const minuteRem = Number(quota.minute?.remaining ?? 0);
  const hourRem = Number(quota.hour?.remaining ?? 0);
  const dayRem = Number(quota.day?.remaining ?? 0);
  console.log(JSON.stringify({ quotaGate: { minuteRem, hourRem, dayRem, membership: quota.membership } }, null, 2));
  if (!quota.ok || hourRem < 100 || dayRem < 150) {
    console.log(
      JSON.stringify({
        ok: false,
        stopReason: "INSUFFICIENT_SAFE_CAPACITY",
        classification: "CITATION_IDENTITY_LIVE_BATCH2",
        quota,
        courtListenerHttpCalls: 1,
      }),
    );
    process.exit(3);
  }

  const maxLookups = Math.min(69, TOTAL_CL_CAP - 1);
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 30, connect_timeout: 60 });

  let identityLookups = 0;
  let lastAt = 0;
  let hit429 = false;
  let hit502 = 0;
  let stopReason = "BATCH_COMPLETE";
  const results = [];
  const fullTextCandidates = [];
  let edgesResolved = 0;
  let targetsHigh = 0;
  let targetsAmbiguous = 0;
  let targetsNotFound = 0;
  let targetsFailed = 0;
  let locallyResolvedBeforeExternal = 0;
  let lookupsAvoidedByBatchLearning = 0;
  let lookupsAvoidedByAliases = 0;
  let lookupsAvoidedByParallel = 0;
  let newMetadataOnly = 0;
  let existingMatched = 0;
  let corpusCompleteMatched = 0;
  let authorityResolvedTargets = 0;
  let corpusCompleteTargets = 0;
  const ledgerAll = [];

  try {
    await sql.unsafe("BEGIN READ ONLY");
    const start = await healthSnapshot(sql);
    console.log(
      JSON.stringify(
        {
          preBatchCompleteness: {
            METADATA_ONLY_AUTHORITIES: start.METADATA_ONLY_AUTHORITIES,
            CORPUS_COMPLETE_AUTHORITIES: start.CORPUS_COMPLETE_AUTHORITIES,
            TOTAL_CANONICAL_AUTHORITIES: start.TOTAL_CANONICAL_AUTHORITIES,
            FULL_TEXT_READY_AUTHORITIES: start.FULL_TEXT_READY_AUTHORITIES,
            EMBEDDED_AUTHORITIES: start.EMBEDDED_AUTHORITIES,
            CASE_TYPED_AUTHORITIES: start.CASE_TYPED_AUTHORITIES,
          },
        },
        null,
        2,
      ),
    );

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
    await sql.unsafe("COMMIT");

    if (!start.green) {
      console.log(JSON.stringify({ ok: false, stopReason: "START_HEALTH_NOT_GREEN", start, courtListenerHttpCalls: totalCl }));
      process.exit(3);
    }

    const batch1Keys = new Set();
    try {
      const b1 = JSON.parse(fs.readFileSync(BATCH1_REPORT, "utf8"));
      for (const r of b1.results || []) if (r.targetKey) batch1Keys.add(r.targetKey);
    } catch {
      /* */
    }

    let index = rebuildIndex(
      authorityRows.map((a) => ({ ...a, corpusComplete: Boolean(a.has_embeddings) && a.ingestion_status === "ready" })),
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

    const candidates = queue.targets.filter(
      (t) => t.lookupSuitable && t.localCandidateStatus === "NO_LOCAL_MATCH" && !batch1Keys.has(t.targetKey),
    );
    // Take a larger candidate pool; we may skip some via learning without burning lookup slots
    const workQueue = candidates.slice(0, maxLookups + 40);
    const edgesRepresented = workQueue.slice(0, maxLookups).reduce((s, t) => s + t.edgeCount, 0);
    console.log(
      JSON.stringify({
        selectedPool: workQueue.length,
        maxLookups,
        batch1Excluded: batch1Keys.size,
        edgesRepresentedApprox: edgesRepresented,
      }),
    );

    for (let i = 0; i < workQueue.length; i++) {
      if (identityLookups >= maxLookups || totalCl >= TOTAL_CL_CAP) break;
      const target = workQueue[i];

      // Intra-batch local check before any external call
      const localHit = index.lookupCitation(target.representativeRaw, target.normalizedCitation);
      if (localHit.kind === "one") {
        locallyResolvedBeforeExternal += 1;
        lookupsAvoidedByBatchLearning += 1;
        if (localHit.method === "LOCAL_ALIAS") lookupsAvoidedByAliases += 1;
        if (localHit.method === "LOCAL_PARALLEL") lookupsAvoidedByParallel += 1;
        const auth = authorityRows.find((a) => a.id === localHit.authorityId);
        const corpusComplete = Boolean(auth?.has_embeddings) && auth?.ingestion_status === "ready";
        const bf = await backfillTarget(
          sql,
          target,
          localHit.authorityId,
          localHit.method,
          localHit.evidence,
          corpusComplete,
        );
        edgesResolved += bf.updated;
        targetsHigh += 1;
        if (corpusComplete) corpusCompleteTargets += 1;
        else authorityResolvedTargets += 1;
        ledgerAll.push(...bf.ledger);
        results.push({
          targetKey: target.targetKey,
          citation: target.normalizedCitation,
          edgeCount: target.edgeCount,
          status: "HIGH_RESOLVED_LOCAL_INTRA_BATCH",
          method: localHit.method,
          authorityId: localHit.authorityId,
          edgesBackfilled: bf.updated,
          externalLookup: false,
        });
        continue;
      }

      // External lookup
      const wait = RATE_MS - (Date.now() - lastAt);
      if (lastAt && wait > 0) await sleep(wait);
      identityLookups += 1;
      totalCl += 1;
      lastAt = Date.now();

      let httpStatus = 0;
      let body = null;
      try {
        const res = await fetch(`${CL_BASE}/citation-lookup/`, {
          method: "POST",
          headers: {
            Authorization: `Token ${apiKey}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text: target.normalizedCitation || target.representativeRaw }),
          signal: AbortSignal.timeout(60000),
        });
        httpStatus = res.status;
        if (res.status === 429) {
          hit429 = true;
          stopReason = "HTTP_429";
          targetsFailed += 1;
          results.push({ targetKey: target.targetKey, status: "failed", reason: "rate_limited", httpStatus });
          break;
        }
        if (res.status === 502 || res.status === 504) {
          hit502 += 1;
          if (totalCl >= TOTAL_CL_CAP) {
            targetsFailed += 1;
            results.push({ targetKey: target.targetKey, status: "failed", reason: "http_5xx_no_retry_budget" });
            break;
          }
          await sleep(2000);
          identityLookups += 1;
          totalCl += 1;
          lastAt = Date.now();
          const res2 = await fetch(`${CL_BASE}/citation-lookup/`, {
            method: "POST",
            headers: {
              Authorization: `Token ${apiKey}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ text: target.normalizedCitation || target.representativeRaw }),
            signal: AbortSignal.timeout(60000),
          });
          httpStatus = res2.status;
          if (!res2.ok) {
            targetsFailed += 1;
            results.push({ targetKey: target.targetKey, status: "failed", reason: `http_${httpStatus}` });
            continue;
          }
          body = await res2.json();
        } else if (!res.ok) {
          targetsFailed += 1;
          results.push({ targetKey: target.targetKey, status: "failed", reason: `http_${httpStatus}` });
          continue;
        } else {
          body = await res.json();
        }
      } catch (e) {
        targetsFailed += 1;
        results.push({ targetKey: target.targetKey, status: "failed", reason: String(e.message || e).slice(0, 200) });
        continue;
      }

      const parsed = parseCitationLookupResponse(body);
      const record = {
        targetKey: target.targetKey,
        citation: target.normalizedCitation,
        representativeRaw: target.representativeRaw,
        edgeCount: target.edgeCount,
        uniqueCitingCases: target.uniqueCitingCases,
        jurisdictions: target.jurisdictions,
        httpStatus,
        providerStatus: parsed.status,
        clusterId: parsed.status === "resolved" ? parsed.clusterId : null,
        citations: parsed.status === "resolved" ? parsed.citations : [],
        caseName: parsed.status === "resolved" ? parsed.caseName : null,
        court: parsed.status === "resolved" ? parsed.court : null,
        dateFiled: parsed.status === "resolved" ? parsed.dateFiled : null,
        evidence: parsed.evidence || [],
        externalLookup: true,
      };

      if (parsed.status === "ambiguous") {
        targetsAmbiguous += 1;
        record.status = "NO_AUTO_RESOLVE";
        results.push(record);
      } else if (parsed.status === "not_found") {
        targetsNotFound += 1;
        record.status = "IDENTITY_UNRESOLVED";
        results.push(record);
      } else if (parsed.status !== "resolved") {
        targetsFailed += 1;
        record.status = "failed";
        results.push(record);
      } else {
        const ensured = await ensureIdentityAuthority(sql, target, parsed);
        if (!ensured.ok) {
          targetsAmbiguous += 1;
          record.status = "NO_AUTO_RESOLVE";
          record.reason = ensured.reason;
          results.push(record);
        } else {
          const bf = await backfillTarget(
            sql,
            target,
            ensured.authorityId,
            "COURTLISTENER_CITATION_LOOKUP",
            parsed.evidence,
            ensured.corpusComplete,
          );
          edgesResolved += bf.updated;
          targetsHigh += 1;
          ledgerAll.push(...bf.ledger);
          if (ensured.created) {
            newMetadataOnly += 1;
            authorityRows.push({
              id: ensured.authorityId,
              citation: target.normalizedCitation,
              normalized_citation: experimentalNormalize(target.normalizedCitation) || target.normalizedCitation,
              metadata: {
                parallelCitations: parsed.citations,
                citationAliases: [target.normalizedCitation, ...(parsed.citations || [])],
              },
              source_external_id: `cl-cluster-${parsed.clusterId}`,
              source_provider: SOURCE,
              title: parsed.caseName,
              court: parsed.court,
              ingestion_status: "pending",
              has_embeddings: false,
            });
          } else if (ensured.corpusComplete) {
            corpusCompleteMatched += 1;
            corpusCompleteTargets += 1;
          } else {
            existingMatched += 1;
          }
          if (!ensured.corpusComplete) {
            authorityResolvedTargets += 1;
            fullTextCandidates.push({
              targetKey: target.targetKey,
              authorityId: ensured.authorityId,
              clusterId: parsed.clusterId,
              citation: target.normalizedCitation,
              edgeCount: target.edgeCount,
              caseName: parsed.caseName,
              court: parsed.court,
              priorityReason: "high_edge_demand_identity_only",
              unresolvedDemandRepresented: bf.updated,
            });
          }

          // Immediate index rebuild for batch learning
          // Refresh metadata for matched existing rows too
          const idx = authorityRows.findIndex((a) => a.id === ensured.authorityId);
          if (idx >= 0) {
            const row = authorityRows[idx];
            const meta = row.metadata && typeof row.metadata === "object" ? { ...row.metadata } : {};
            meta.citationAliases = [...new Set([...(meta.citationAliases || []), target.normalizedCitation, ...(parsed.citations || [])])];
            meta.parallelCitations = [...new Set([...(meta.parallelCitations || []), ...(parsed.citations || [])])];
            authorityRows[idx] = { ...row, metadata: meta };
          }
          index = rebuildIndex(
            authorityRows.map((a) => ({
              ...a,
              corpusComplete: Boolean(a.has_embeddings) && a.ingestion_status === "ready",
            })),
          );

          record.status = "HIGH_RESOLVED";
          record.confidence = "HIGH";
          record.authorityId = ensured.authorityId;
          record.createdAuthority = ensured.created;
          record.corpusComplete = ensured.corpusComplete;
          record.edgesBackfilled = bf.updated;
          results.push(record);
        }
      }

      if (identityLookups % 10 === 0 || hit429) {
        const health = await healthSnapshot(sql);
        const cp = {
          atLookup: identityLookups,
          totalCl,
          identityLookups,
          targetsHigh,
          targetsAmbiguous,
          targetsNotFound,
          targetsFailed,
          edgesResolved,
          newMetadataOnly,
          existingMatched,
          corpusCompleteMatched,
          locallyResolvedBeforeExternal,
          lookupsAvoidedByBatchLearning,
          health: {
            green: health.green,
            resolved: health.resolved,
            unresolved: health.unresolved,
            METADATA_ONLY_AUTHORITIES: health.METADATA_ONLY_AUTHORITIES,
            CORPUS_COMPLETE_AUTHORITIES: health.CORPUS_COMPLETE_AUTHORITIES,
          },
          hit429,
          updatedAt: new Date().toISOString(),
        };
        writeJson(path.join(CHECKPOINT_DIR, `identity-batch2-cp-${identityLookups}.json`), cp);
        console.log(JSON.stringify({ checkpoint: cp }, null, 2));
        if (!health.green) {
          stopReason = "HEALTH_NOT_GREEN";
          break;
        }
      }
      if (hit429) break;
    }

    if (ledgerAll.length) appendLedger(LEDGER_PATH, ledgerAll);

    // Merge fulltext queue with batch1
    let priorQueue = [];
    try {
      priorQueue = JSON.parse(fs.readFileSync(FULLTEXT_QUEUE, "utf8")).candidates || [];
    } catch {
      /* */
    }
    const mergedCandidates = [...priorQueue];
    const seenAuth = new Set(priorQueue.map((c) => c.authorityId));
    for (const c of fullTextCandidates) {
      if (!seenAuth.has(c.authorityId)) {
        mergedCandidates.push(c);
        seenAuth.add(c.authorityId);
      }
    }
    writeJson(FULLTEXT_QUEUE, {
      generatedAt: new Date().toISOString(),
      batch: "identity-batch1+2",
      candidates: mergedCandidates,
      note: "Demand-driven full-text queue; not acquired in identity batches.",
    });

    const end = await healthSnapshot(sql);
    const ledger = loadLedger(LEDGER_PATH);
    const active = ledger.filter((r) => r.active);
    const byEdge = new Map();
    let duplicateActiveMappings = 0;
    for (const r of active) {
      if (!r.citationEdgeId) continue;
      if (byEdge.has(r.citationEdgeId)) duplicateActiveMappings += 1;
      byEdge.set(r.citationEdgeId, r);
    }

    const externalAttempted = identityLookups;
    const targetResolutionRate = externalAttempted > 0 ? targetsHigh / (externalAttempted + locallyResolvedBeforeExternal) : 0;
    // Mission: HIGH targets / external targets attempted — but also count local intra-batch as resolved
    // Prefer: HIGH among (external attempted + local skips that resolved) for overall, and separately external-only rate
    const highTotal = results.filter((r) => String(r.status).startsWith("HIGH_RESOLVED")).length;
    const externalHigh = results.filter((r) => r.status === "HIGH_RESOLVED" && r.externalLookup).length;
    const externalTargetResolutionRate = externalAttempted > 0 ? externalHigh / externalAttempted : 0;
    const edgesPerCl = totalCl > 0 ? edgesResolved / totalCl : 0;
    const edgesPerLookup = identityLookups > 0 ? edgesResolved / identityLookups : 0;
    const backfillMultiplier = highTotal > 0 ? edgesResolved / highTotal : 0;
    const noResultRate = externalAttempted > 0 ? targetsNotFound / externalAttempted : 0;
    const ambiguityRate = externalAttempted > 0 ? targetsAmbiguous / externalAttempted : 0;

    let scaleDecision = "CONTINUE_MODERATE_BATCHES";
    let finalClass = "CITATION_IDENTITY_BATCH2_MODERATE";
    if (hit429 || stopReason === "HEALTH_NOT_GREEN") {
      scaleDecision = "PAUSE_FOR_ANALYSIS";
      finalClass = "CITATION_IDENTITY_BATCH2_BLOCKED";
    } else if (externalTargetResolutionRate >= 0.7 && end.green && edgesPerLookup >= 8) {
      scaleDecision = "SCALE_FURTHER_TODAY";
      finalClass =
        externalTargetResolutionRate >= 0.85 ? "CITATION_IDENTITY_BATCH2_STRONG" : "CITATION_IDENTITY_BATCH2_MODERATE";
    } else if (externalTargetResolutionRate < 0.5) {
      scaleDecision = "PAUSE_FOR_ANALYSIS";
      finalClass = externalTargetResolutionRate < 0.25 ? "CITATION_IDENTITY_BATCH2_WEAK" : "CITATION_IDENTITY_BATCH2_MODERATE";
      if (externalTargetResolutionRate < 0.5 && externalTargetResolutionRate >= 0.25) scaleDecision = "CONTINUE_MODERATE_BATCHES";
      if (externalTargetResolutionRate < 0.25) {
        scaleDecision = "RESOLVER_YIELD_DEGRADED";
        finalClass = "CITATION_IDENTITY_BATCH2_WEAK";
      }
    }

    const dayLeft = Math.max(0, dayRem - (totalCl - 1)); // dayRem was after probe; subtract lookups
    const nextBudget =
      scaleDecision === "SCALE_FURTHER_TODAY"
        ? Math.min(100, Math.max(40, Math.floor(dayLeft * 0.25)))
        : scaleDecision === "CONTINUE_MODERATE_BATCHES"
          ? 40
          : 0;

    const report = {
      ok: end.green && !hit429 && stopReason !== "HEALTH_NOT_GREEN",
      classification: "CITATION_IDENTITY_LIVE_BATCH2",
      stopReason,
      courtListener: {
        quotaProbeRequests: 1,
        identityLookupRequests: identityLookups,
        totalClRequests: totalCl,
        minuteAtStart: minuteRem,
        hourAtStart: hourRem,
        dayAtStart: dayRem,
        hit429,
        hit502,
      },
      start,
      end,
      resolvedDelta: end.resolved - start.resolved,
      unresolvedDelta: end.unresolved - start.unresolved,
      targets: {
        externalUniqueTargetsAttempted: identityLookups,
        resolvedHigh: highTotal,
        externalHigh,
        ambiguous: targetsAmbiguous,
        notFound: targetsNotFound,
        providerFailure: targetsFailed,
        locallyResolvedBeforeExternalDueToBatchLearning: locallyResolvedBeforeExternal,
      },
      resolution: {
        newMetadataOnlyAuthorities: newMetadataOnly,
        existingAuthoritiesMatched: existingMatched,
        alreadyCorpusCompleteMatches: corpusCompleteMatched,
        AUTHORITY_RESOLVED_targets: authorityResolvedTargets,
        CORPUS_COMPLETE_targets: corpusCompleteTargets,
        fullTextAcquired: 0,
      },
      backfill: {
        edgesRepresented: workQueue.slice(0, identityLookups + locallyResolvedBeforeExternal).reduce((s, t) => s + t.edgeCount, 0),
        edgesResolved,
        oldUnresolvedBackfilled: edgesResolved,
        backfillMultiplier,
      },
      intraBatchLearning: {
        lookupsAvoidedByNewlyLearnedIdentities: lookupsAvoidedByBatchLearning,
        lookupsAvoidedByAliases,
        lookupsAvoidedByParallelMappings: lookupsAvoidedByParallel,
      },
      yield: {
        targetResolutionRateOverall: highTotal / Math.max(1, identityLookups + locallyResolvedBeforeExternal),
        targetResolutionRateExternal: externalTargetResolutionRate,
        edgesResolvedPerClTotal: edgesPerCl,
        edgesResolvedPerIdentityLookup: edgesPerLookup,
        ambiguityRate,
        noResultRate,
        batch1TargetResolution: 0.9,
        batch1EdgesPerCl: 14.15,
        comparedToBatch1: {
          targetRateDelta: externalTargetResolutionRate - 0.9,
          edgesPerClDelta: edgesPerLookup - 14.15,
        },
      },
      health: {
        duplicates: end.duplicates,
        orphans: end.orphans,
        missingEmbeddings: end.missingEmbeddings,
        failed: end.failed,
        notProcessed: end.notProcessed,
        duplicateActiveMappings,
        presentTargetDefectsDeterministic: end.presentTargetDefectsDeterministic,
        status: end.green && duplicateActiveMappings === 0 ? "PASS" : "FAIL",
      },
      fullTextQueue: {
        newCandidatesThisBatch: fullTextCandidates.length,
        totalQueued: mergedCandidates.length,
        highestDemand: [...fullTextCandidates].sort((a, b) => b.edgeCount - a.edgeCount).slice(0, 10),
      },
      scaleDecision,
      nextRecommendedBudget: nextBudget,
      finalClassification: finalClass,
      results,
      generatedAt: new Date().toISOString(),
      resolverVersion: RESOLVER_VERSION,
      fullTextAcquired: 0,
    };

    writeJson(REPORT_JSON, report);
    fs.writeFileSync(
      REPORT_MD,
      `# Citation Identity Live Batch 2

**Stop:** ${stopReason}  
**CL total:** ${totalCl} (probe 1 + lookups ${identityLookups})  
**Full-text acquired:** 0  

## Completeness (do not conflate with full-text cases)

| Metric | Start | End |
|---|---:|---:|
| TOTAL_CANONICAL_AUTHORITIES | ${start.TOTAL_CANONICAL_AUTHORITIES} | ${end.TOTAL_CANONICAL_AUTHORITIES} |
| METADATA_ONLY_AUTHORITIES | ${start.METADATA_ONLY_AUTHORITIES} | ${end.METADATA_ONLY_AUTHORITIES} |
| CORPUS_COMPLETE_AUTHORITIES | ${start.CORPUS_COMPLETE_AUTHORITIES} | ${end.CORPUS_COMPLETE_AUTHORITIES} |
| case-typed (incl. metadata-only) | ${start.CASE_TYPED_AUTHORITIES} | ${end.CASE_TYPED_AUTHORITIES} |

## Yield

external HIGH rate: **${(externalTargetResolutionRate * 100).toFixed(1)}%** (${externalHigh}/${identityLookups})  
intra-batch local resolutions (lookups avoided): **${locallyResolvedBeforeExternal}**  
edges resolved: **${edgesResolved}** (${edgesPerLookup.toFixed(2)} / identity lookup)  
backfill multiplier: **${backfillMultiplier.toFixed(2)}**

Batch 1: 90% / 14.15 edges/CL → Batch 2 external: ${(externalTargetResolutionRate * 100).toFixed(1)}% / ${edgesPerLookup.toFixed(2)} edges/lookup

## Scale

**${scaleDecision}** — next budget (not executed): **${nextBudget}**
`,
    );

    console.log("CITATION_IDENTITY_BATCH2_COMPLETE");
    console.log(
      JSON.stringify(
        {
          ok: report.ok,
          stopReason,
          totalCl,
          identityLookups,
          highTotal,
          externalHigh,
          locallyResolvedBeforeExternal,
          edgesResolved,
          externalTargetResolutionRate,
          scaleDecision,
          finalClassification: finalClass,
          health: report.health.status,
          reportJson: REPORT_JSON,
        },
        null,
        2,
      ),
    );
    process.exit(report.ok ? 0 : 5);
  } catch (e) {
    try {
      await sql.unsafe("ROLLBACK");
    } catch {
      /* */
    }
    console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 1500), totalCl, identityLookups }));
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();
