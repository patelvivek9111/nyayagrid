/**
 * Phase 1E: Live CourtListener identity Batch 4 — efficiency frontier.
 * TOTAL CL hard cap: 80 (1 quota probe + ≤79 identity lookups).
 * Demand-tier selection (≥10 / 5–9 / 3–4; strategic 1–2 only).
 * Local reconciliation from Batches 1–3 before any external call.
 * Early-stop efficiency gates. Identity only. Zero full-text acquisition.
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

const TOTAL_CL_CAP = 80;
const RATE_MS = 5000;
const CL_BASE = "https://www.courtlistener.com/api/rest/v4";
const SOURCE = "courtlistener";
const BATCH = "batch4";

const BATCH1_REPORT = path.join(
  __dirname,
  "..",
  "packages/research/corpus/reports/citation-identity-live-batch1-2026-10-09.json",
);
const BATCH2_REPORT = path.join(
  __dirname,
  "..",
  "packages/research/corpus/reports/citation-identity-live-batch2-2026-10-09.json",
);
const BATCH3_REPORT = path.join(
  __dirname,
  "..",
  "packages/research/corpus/reports/citation-identity-live-batch3-2026-10-09.json",
);
const CHECKPOINT_DIR = path.join(__dirname, "..", "packages/research/corpus/resolution/checkpoints");
const LEDGER_PATH = path.join(
  __dirname,
  "..",
  "packages/research/corpus/resolution/ledger/cl-identity-batch4-2026-10-09.jsonl",
);
const REPORT_JSON = path.join(
  __dirname,
  "..",
  "packages/research/corpus/reports/citation-identity-live-batch4-2026-10-09.json",
);
const REPORT_MD = path.join(
  __dirname,
  "..",
  "packages/research/corpus/reports/citation-identity-live-batch4-2026-10-09.md",
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
function rate(h, n) {
  return n > 0 ? h / n : null;
}
function demandBucket(edgeCount) {
  if (edgeCount >= 10) return "ge10";
  if (edgeCount >= 5) return "ge5";
  if (edgeCount >= 3) return "ge3";
  return "strategic12";
}
function emptyBucket() {
  return {
    attempted: 0,
    resolved: 0,
    edgesRepresented: 0,
    edgesResolved: 0,
    ambiguous: 0,
    notFound: 0,
    failed: 0,
  };
}
function isStrategicLowDemand(t) {
  if (t.edgeCount >= 3) return false;
  const j = (t.jurisdictions || []).join(" ").toLowerCase();
  const cite = String(t.normalizedCitation || t.representativeRaw || "");
  const reporter = String(t.reporter || "");
  if (/us-ca-3|ca3|third/.test(j)) return true;
  if (/us-d-pa|paed|edpa/.test(j)) return true;
  if (/st-pa|pennsylvania/.test(j) && /A\.|Pa\./i.test(cite + " " + reporter)) return true;
  if (/us-scotus|scotus/.test(j) && Number(t.priorityScore || 0) >= 40) return true;
  if (Number(t.priorityScore || 0) >= 55) return true;
  return false;
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
      batch: BATCH,
      resolvedAt: new Date().toISOString(),
      resolverVersion: RESOLVER_VERSION,
    };
    await sql`
      update legal_authorities
      set metadata = ${sql.json(meta)}, last_checked_at = now(), updated_at = now()
      where id = ${existing.row.id}
    `;
    return {
      ok: true,
      authorityId: existing.row.id,
      created: false,
      corpusComplete,
      via: existing.via,
      aliasesLearned: Math.max(0, meta.citationAliases.length - aliases.length),
      parallelsLearned: Math.max(0, meta.parallelCitations.length - parallels.length),
      learnedCitations: [...new Set([...(meta.citationAliases || []), ...(meta.parallelCitations || [])])],
    };
  }

  const authorityId = crypto.randomUUID();
  const title = lookup.caseName || primaryCite || target.normalizedCitation;
  const aliasSet = [...new Set([target.normalizedCitation, target.representativeRaw, primaryCite, ...citations].filter(Boolean))].slice(0, 24);
  const parallelSet = citations.slice(0, 12);
  const metadata = {
    adapter: "citation-resolution-identity-batch4",
    identityOnly: true,
    corpusComplete: false,
    clClusterId: clusterId,
    clOpinionIds: lookup.opinionIds || [],
    parallelCitations: parallelSet,
    citationAliases: aliasSet,
    identityResolution: {
      method: "COURTLISTENER_CITATION_LOOKUP",
      clusterId,
      court: lookup.court,
      dateFiled: lookup.dateFiled,
      evidence: lookup.evidence,
      batch: BATCH,
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
  return {
    ok: true,
    authorityId,
    created: true,
    corpusComplete: false,
    via: "created_identity",
    aliasesLearned: aliasSet.length,
    parallelsLearned: parallelSet.length,
    learnedCitations: [...new Set([...aliasSet, ...parallelSet])],
  };
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

function loadPriorKeys() {
  const priorKeys = new Set();
  for (const p of [BATCH1_REPORT, BATCH2_REPORT, BATCH3_REPORT]) {
    try {
      const b = JSON.parse(fs.readFileSync(p, "utf8"));
      for (const r of b.results || []) if (r.targetKey) priorKeys.add(r.targetKey);
    } catch {
      /* */
    }
  }
  return priorKeys;
}

function countAliasParallelInventory(authorityRows) {
  let aliases = 0;
  let parallels = 0;
  for (const a of authorityRows) {
    const meta = a.metadata && typeof a.metadata === "object" ? a.metadata : {};
    aliases += Array.isArray(meta.citationAliases) ? meta.citationAliases.length : 0;
    parallels += Array.isArray(meta.parallelCitations) ? meta.parallelCitations.length : 0;
  }
  return { aliases, parallels };
}

function deriveFrontier(bucketResults, batchHistory) {
  // Evidence-driven permanent threshold from Batches 1–4 demand buckets.
  const combined = {
    ge10: { attempted: 0, resolved: 0, edgesResolved: 0, edgesPerCl: [] },
    ge5: { attempted: 0, resolved: 0, edgesResolved: 0, edgesPerCl: [] },
    ge3: { attempted: 0, resolved: 0, edgesResolved: 0, edgesPerCl: [] },
    strategic12: { attempted: 0, resolved: 0, edgesResolved: 0, edgesPerCl: [] },
  };
  for (const hist of batchHistory) {
    for (const key of Object.keys(combined)) {
      const b = hist[key];
      if (!b || !b.attempted) continue;
      combined[key].attempted += b.attempted;
      combined[key].resolved += b.resolved;
      combined[key].edgesResolved += b.edgesResolved || 0;
      if (b.edgesPerCl != null) combined[key].edgesPerCl.push(b.edgesPerCl);
    }
  }
  for (const key of Object.keys(combined)) {
    const b = bucketResults[key];
    if (!b || !b.attempted) continue;
    combined[key].attempted += b.attempted;
    combined[key].resolved += b.resolved;
    combined[key].edgesResolved += b.edgesResolved || 0;
    const epc = b.attempted > 0 ? b.edgesResolved / b.attempted : null;
    if (epc != null) combined[key].edgesPerCl.push(epc);
  }

  const summarize = (c) => ({
    attempted: c.attempted,
    resolved: c.resolved,
    successRate: rate(c.resolved, c.attempted),
    edgesResolved: c.edgesResolved,
    avgEdgesPerCl: c.edgesPerCl.length ? c.edgesPerCl.reduce((a, b) => a + b, 0) / c.edgesPerCl.length : null,
  });
  const s10 = summarize(combined.ge10);
  const s59 = summarize(combined.ge5);
  const s34 = summarize(combined.ge3);

  // Efficiency stop gate: edges/CL < 2.0 is inefficient for bulk.
  // Prefer highest threshold that still has meaningful volume and avg edges/CL >= 3.0
  // and success rate >= 70%, else fall back.
  let recommended = ">=5 edges";
  let evidence = [];
  if (s10.attempted >= 2 && (s10.avgEdgesPerCl ?? 0) >= 5 && (s10.successRate ?? 0) >= 0.7) {
    evidence.push(`>=10: ${(s10.successRate * 100).toFixed(0)}% HIGH, ~${(s10.avgEdgesPerCl || 0).toFixed(2)} edges/CL`);
  }
  if (s59.attempted >= 5) {
    evidence.push(`5–9: ${((s59.successRate || 0) * 100).toFixed(0)}% HIGH, ~${(s59.avgEdgesPerCl || 0).toFixed(2)} edges/CL`);
  }
  if (s34.attempted >= 5) {
    evidence.push(`3–4: ${((s34.successRate || 0) * 100).toFixed(0)}% HIGH, ~${(s34.avgEdgesPerCl || 0).toFixed(2)} edges/CL`);
  }

  // Permanent bulk floor: prefer >=5 when mid-bucket clears efficiency gates.
  // 3–4 historically clears ~3 edges/CL but sits near the early-stop floor (2.0);
  // B4 also showed remaining high-demand head polluted by non-citations — demand alone is insufficient.
  recommended = ">=5 edges";
  if (s59.attempted >= 5 && (s59.avgEdgesPerCl ?? 0) >= 3 && (s59.successRate ?? 0) >= 0.7) {
    evidence.push("5–9 clears efficiency gates across Batches 1–4; permanent bulk floor");
  }
  if (s34.attempted >= 5 && ((s34.avgEdgesPerCl ?? 0) < 3.0 || (s34.successRate ?? 0) < 0.7)) {
    evidence.push("3–4 near/below durable efficiency (need ≥3 edges/CL and ≥70% HIGH for bulk)");
  } else if (s34.attempted >= 5 && (s34.avgEdgesPerCl ?? 0) >= 3 && (s34.successRate ?? 0) >= 0.7) {
    evidence.push("3–4 historically viable but reserved for opportunistic/local-first, not bulk default");
  }
  if (bucketResults.ge10 && bucketResults.ge10.attempted >= 10) {
    const nf = bucketResults.ge10.noResult ?? 0;
    if (nf >= 0.4) {
      evidence.push(
        `Batch remaining >=10 no-result ${(nf * 100).toFixed(0)}% — filter extraction artifacts before bulk CL`,
      );
    }
  }

  return {
    recommendedMinimumTargetDemandThreshold: recommended,
    evidence,
    combinedBuckets: { ge10: s10, ge5: s59, ge3: s34, strategic12: summarize(combined.strategic12) },
    belowThresholdPolicy:
      "Do not bulk-process below >=5 edges. Allow 3–4 only after local-first / alias learning or when reporter-valid and strategic. 1–2 only for CA3/EDPA/high-value PA/benchmark-critical. Exclude page-number extraction artifacts from external queue.",
  };
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

  // ---- Quota gate (exactly 1 request) ----
  const quota = await probeQuota(apiKey);
  let totalCl = 1;
  const minuteRem = Number(quota.minute?.remaining ?? 0);
  const hourRem = Number(quota.hour?.remaining ?? 0);
  const dayRem = Number(quota.day?.remaining ?? 0);
  console.log(JSON.stringify({ quotaGate: { minuteRem, hourRem, dayRem, membership: quota.membership } }, null, 2));
  if (!quota.ok || hourRem < 100 || dayRem < 160) {
    console.log(
      JSON.stringify({
        ok: false,
        stopReason: "INSUFFICIENT_SAFE_QUOTA",
        classification: "CITATION_IDENTITY_LIVE_BATCH4_EFFICIENCY_FRONTIER",
        quota,
        courtListenerHttpCalls: 1,
      }),
    );
    process.exit(3);
  }

  const maxLookups = Math.min(79, TOTAL_CL_CAP - 1);
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 30, connect_timeout: 60 });

  let identityLookups = 0;
  let lastAt = 0;
  let hit429 = false;
  let hit502 = 0;
  let stopReason = "BATCH_COMPLETE";
  const results = [];
  const fullTextCandidates = [];
  let edgesResolved = 0;
  let edgesResolvedExternal = 0;
  let edgesResolvedLocal = 0;
  let targetsHigh = 0;
  let targetsAmbiguous = 0;
  let targetsNotFound = 0;
  let targetsFailed = 0;
  let locallyResolvedBeforeExternal = 0;
  let externalLookupAvoided = 0;
  let lookupsAvoidedByAliases = 0;
  let lookupsAvoidedByParallel = 0;
  let aliasesLearnedTotal = 0;
  let parallelsLearnedTotal = 0;
  let targetsResolvedFromNewAlias = 0;
  let lookupsAvoidedFromNewAlias = 0;
  let newlyLocalResolvableTargets = 0;
  let newlyLocalResolvableEdges = 0;
  let newMetadataOnly = 0;
  let existingMatched = 0;
  let corpusCompleteMatched = 0;
  let authorityResolvedTargets = 0;
  let corpusCompleteTargets = 0;
  const ledgerAll = [];
  const resolvedInBatch = new Set();
  const rolling = []; // { high, edges, ambiguous, notFound }
  const checkpoints = [];
  const buckets = {
    ge10: emptyBucket(),
    ge5: emptyBucket(),
    ge3: emptyBucket(),
    strategic12: emptyBucket(),
  };
  const bucketAttempted = {
    ge10: 0,
    ge5: 0,
    ge3: 0,
    strategic12: 0,
  };

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
            AUTHORITY_RESOLVED_EDGES: start.AUTHORITY_RESOLVED_EDGES,
            CORPUS_COMPLETE_EDGES: start.CORPUS_COMPLETE_EDGES,
            IDENTITY_UNRESOLVED_EDGES: start.IDENTITY_UNRESOLVED_EDGES,
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

    const priorKeys = loadPriorKeys();
    const inventory = countAliasParallelInventory(authorityRows);
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

    // All lookup-suitable targets not yet tried in B1–3 (for local pre-pass + tiered external)
    const allCandidates = queue.targets.filter((t) => t.lookupSuitable && !priorKeys.has(t.targetKey));

    const tierA = [];
    const tierB = [];
    const tierC = [];
    const tierStrategic = [];
    for (const t of allCandidates) {
      if (t.edgeCount >= 10) tierA.push(t);
      else if (t.edgeCount >= 5) tierB.push(t);
      else if (t.edgeCount >= 3) tierC.push(t);
      else if (isStrategicLowDemand(t)) tierStrategic.push(t);
    }
    // Sort each tier by edge demand then priority
    const byDemand = (a, b) => b.edgeCount - a.edgeCount || b.priorityScore - a.priorityScore;
    tierA.sort(byDemand);
    tierB.sort(byDemand);
    tierC.sort(byDemand);
    tierStrategic.sort(byDemand);

    const workQueue = [...tierA, ...tierB, ...tierC, ...tierStrategic];
    const queueConsidered = {
      total: workQueue.length,
      ge10: tierA.length,
      ge5: tierB.length,
      ge3: tierC.length,
      strategic12: tierStrategic.length,
      excludedLowDemandNonStrategic: allCandidates.filter((t) => t.edgeCount < 3 && !isStrategicLowDemand(t)).length,
    };
    console.log(
      JSON.stringify({
        queueConsidered,
        maxLookups,
        priorBatchesExcluded: priorKeys.size,
        aliasInventory: inventory.aliases,
        parallelInventory: inventory.parallels,
      }),
    );

    async function applyLocalResolution(target, localHit, viaAliasLearning, phase) {
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
      edgesResolvedLocal += bf.updated;
      targetsHigh += 1;
      if (corpusComplete) corpusCompleteTargets += 1;
      else authorityResolvedTargets += 1;
      ledgerAll.push(...bf.ledger);
      locallyResolvedBeforeExternal += 1;
      externalLookupAvoided += 1;
      if (phase === "prepass") {
        newlyLocalResolvableTargets += 1;
        newlyLocalResolvableEdges += bf.updated;
      }
      if (localHit.method === "LOCAL_ALIAS" || viaAliasLearning) {
        lookupsAvoidedByAliases += 1;
        lookupsAvoidedFromNewAlias += 1;
        targetsResolvedFromNewAlias += 1;
      }
      if (localHit.method === "LOCAL_PARALLEL") lookupsAvoidedByParallel += 1;
      resolvedInBatch.add(target.targetKey);
      results.push({
        targetKey: target.targetKey,
        citation: target.normalizedCitation,
        edgeCount: target.edgeCount,
        status: viaAliasLearning
          ? "HIGH_RESOLVED_FROM_NEW_ALIAS"
          : phase === "prepass"
            ? "HIGH_RESOLVED_LOCAL_PREPASS"
            : "HIGH_RESOLVED_LOCAL_INTRA_BATCH",
        method: localHit.method,
        authorityId: localHit.authorityId,
        edgesBackfilled: bf.updated,
        externalLookup: false,
        demandBucket: demandBucket(target.edgeCount),
        reporter: target.reporter,
        jurisdictions: target.jurisdictions,
      });
      return bf.updated;
    }

    async function drainLocalFromLearning(queueArr) {
      let drained = 0;
      for (const t of queueArr) {
        if (resolvedInBatch.has(t.targetKey)) continue;
        const hit = index.lookupCitation(t.representativeRaw, t.normalizedCitation);
        if (hit.kind !== "one") continue;
        await applyLocalResolution(t, hit, true, "learning");
        drained += 1;
      }
      return drained;
    }

    // ---- LOCAL PRE-PASS (zero CL) using matured index + Batches 1–3 learned mappings ----
    for (const target of workQueue) {
      if (resolvedInBatch.has(target.targetKey)) continue;
      // Prefer NO_LOCAL_MATCH at queue build, but re-check matured index
      const localHit = index.lookupCitation(target.representativeRaw, target.normalizedCitation);
      if (localHit.kind === "one") {
        await applyLocalResolution(target, localHit, false, "prepass");
      }
    }
    console.log(
      JSON.stringify({
        localPrepass: {
          NEWLY_LOCAL_RESOLVABLE_TARGETS: newlyLocalResolvableTargets,
          NEWLY_LOCAL_RESOLVABLE_EDGES: newlyLocalResolvableEdges,
          EXTERNAL_LOOKUP_AVOIDED: externalLookupAvoided,
        },
      }),
    );

    function remainingEligibleExternal() {
      return workQueue.filter((t) => {
        if (resolvedInBatch.has(t.targetKey)) return false;
        if (t.edgeCount >= 3) return true;
        return isStrategicLowDemand(t);
      });
    }

    function checkEarlyStopGates() {
      if (remainingEligibleExternal().length === 0) {
        return "EFFICIENCY_FRONTIER_REACHED";
      }
      if (rolling.length >= 20) {
        const last20 = rolling.slice(-20);
        const edges20 = last20.reduce((s, x) => s + x.edges, 0);
        const high20 = last20.filter((x) => x.high).length;
        const amb20 = last20.filter((x) => x.ambiguous).length;
        if (edges20 / 20 < 2.0) return "EFFICIENCY_FRONTIER_REACHED";
        if (high20 / 20 < 0.6) return "EFFICIENCY_FRONTIER_REACHED";
        if (amb20 / 20 > 0.3) return "EFFICIENCY_FRONTIER_REACHED";
      }
      return null;
    }

    // ---- EXTERNAL IDENTITY LOOKUPS ----
    for (let i = 0; i < workQueue.length; i++) {
      if (identityLookups >= maxLookups || totalCl >= TOTAL_CL_CAP) {
        stopReason = "BATCH_COMPLETE";
        break;
      }
      const early = checkEarlyStopGates();
      if (early) {
        stopReason = early;
        break;
      }

      const target = workQueue[i];
      if (resolvedInBatch.has(target.targetKey)) continue;
      if (target.edgeCount < 3 && !isStrategicLowDemand(target)) continue;

      // Local-first again before EVERY external call
      const localHit = index.lookupCitation(target.representativeRaw, target.normalizedCitation);
      if (localHit.kind === "one") {
        await applyLocalResolution(target, localHit, false, "intra");
        continue;
      }

      const bucket = demandBucket(target.edgeCount);
      bucketAttempted[bucket] += 1;
      buckets[bucket].attempted += 1;
      buckets[bucket].edgesRepresented += Number(target.edgeCount || 0);

      const wait = RATE_MS - (Date.now() - lastAt);
      if (lastAt && wait > 0) await sleep(wait);
      identityLookups += 1;
      totalCl += 1;
      lastAt = Date.now();

      let httpStatus = 0;
      let body = null;
      let callEdges = 0;
      let callHigh = false;
      let callAmb = false;
      let callNf = false;

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
          buckets[bucket].failed += 1;
          results.push({
            targetKey: target.targetKey,
            status: "failed",
            reason: "rate_limited",
            httpStatus,
            externalLookup: true,
            demandBucket: bucket,
            edgeCount: target.edgeCount,
          });
          rolling.push({ high: false, edges: 0, ambiguous: false, notFound: false });
          break;
        }
        if (res.status === 502 || res.status === 504) {
          hit502 += 1;
          if (hit502 >= 3) {
            stopReason = "EFFICIENCY_FRONTIER_REACHED";
            targetsFailed += 1;
            buckets[bucket].failed += 1;
            results.push({
              targetKey: target.targetKey,
              status: "failed",
              reason: "systematic_5xx",
              externalLookup: true,
              demandBucket: bucket,
              edgeCount: target.edgeCount,
            });
            rolling.push({ high: false, edges: 0, ambiguous: false, notFound: false });
            break;
          }
          if (totalCl >= TOTAL_CL_CAP) {
            targetsFailed += 1;
            buckets[bucket].failed += 1;
            results.push({
              targetKey: target.targetKey,
              status: "failed",
              reason: "http_5xx_no_retry_budget",
              externalLookup: true,
              demandBucket: bucket,
              edgeCount: target.edgeCount,
            });
            rolling.push({ high: false, edges: 0, ambiguous: false, notFound: false });
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
            buckets[bucket].failed += 1;
            results.push({
              targetKey: target.targetKey,
              status: "failed",
              reason: `http_${httpStatus}`,
              externalLookup: true,
              demandBucket: bucket,
              edgeCount: target.edgeCount,
            });
            rolling.push({ high: false, edges: 0, ambiguous: false, notFound: false });
            continue;
          }
          body = await res2.json();
        } else if (!res.ok) {
          targetsFailed += 1;
          buckets[bucket].failed += 1;
          results.push({
            targetKey: target.targetKey,
            status: "failed",
            reason: `http_${httpStatus}`,
            externalLookup: true,
            demandBucket: bucket,
            edgeCount: target.edgeCount,
          });
          rolling.push({ high: false, edges: 0, ambiguous: false, notFound: false });
          continue;
        } else {
          body = await res.json();
        }
      } catch (e) {
        targetsFailed += 1;
        buckets[bucket].failed += 1;
        results.push({
          targetKey: target.targetKey,
          status: "failed",
          reason: String(e.message || e).slice(0, 200),
          externalLookup: true,
          demandBucket: bucket,
          edgeCount: target.edgeCount,
        });
        rolling.push({ high: false, edges: 0, ambiguous: false, notFound: false });
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
        reporter: target.reporter,
        volume: target.volume,
        page: target.page,
        demandBucket: bucket,
        httpStatus,
        providerStatus: parsed.status,
        clusterId: parsed.status === "resolved" ? parsed.clusterId : null,
        opinionIds: parsed.status === "resolved" ? parsed.opinionIds || [] : [],
        citations: parsed.status === "resolved" ? parsed.citations : [],
        caseName: parsed.status === "resolved" ? parsed.caseName : null,
        court: parsed.status === "resolved" ? parsed.court : null,
        dateFiled: parsed.status === "resolved" ? parsed.dateFiled : null,
        candidateCount: parsed.status === "resolved" ? 1 : parsed.status === "ambiguous" ? parsed.candidateCount || null : 0,
        evidence: parsed.evidence || [],
        externalLookup: true,
      };

      if (parsed.status === "ambiguous") {
        targetsAmbiguous += 1;
        buckets[bucket].ambiguous += 1;
        callAmb = true;
        record.status = "NO_AUTO_RESOLVE";
        results.push(record);
      } else if (parsed.status === "not_found") {
        targetsNotFound += 1;
        buckets[bucket].notFound += 1;
        callNf = true;
        record.status = "IDENTITY_UNRESOLVED";
        results.push(record);
      } else if (parsed.status !== "resolved") {
        targetsFailed += 1;
        buckets[bucket].failed += 1;
        record.status = "failed";
        results.push(record);
      } else {
        const ensured = await ensureIdentityAuthority(sql, target, parsed);
        if (!ensured.ok) {
          targetsAmbiguous += 1;
          buckets[bucket].ambiguous += 1;
          callAmb = true;
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
          edgesResolvedExternal += bf.updated;
          callEdges = bf.updated;
          callHigh = true;
          targetsHigh += 1;
          buckets[bucket].resolved += 1;
          buckets[bucket].edgesResolved += bf.updated;
          ledgerAll.push(...bf.ledger);
          aliasesLearnedTotal += Number(ensured.aliasesLearned || 0);
          parallelsLearnedTotal += Number(ensured.parallelsLearned || 0);
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
              uniqueCitingCases: target.uniqueCitingCases,
              caseName: parsed.caseName,
              court: parsed.court,
              jurisdictions: target.jurisdictions,
              priorityReason: "metadata_only_after_identity",
              unresolvedDemandRepresented: bf.updated,
              controllingRelevance: /us-ca-3|ca3|third|us-d-pa|edpa|us-scotus/i.test(
                (target.jurisdictions || []).join(" "),
              ),
              practiceValue: Number(target.priorityScore || 0),
            });
          }

          const idx = authorityRows.findIndex((a) => a.id === ensured.authorityId);
          if (idx >= 0) {
            const row = authorityRows[idx];
            const meta = row.metadata && typeof row.metadata === "object" ? { ...row.metadata } : {};
            meta.citationAliases = [
              ...new Set([...(meta.citationAliases || []), target.normalizedCitation, ...(parsed.citations || [])]),
            ];
            meta.parallelCitations = [...new Set([...(meta.parallelCitations || []), ...(parsed.citations || [])])];
            authorityRows[idx] = { ...row, metadata: meta };
          }
          index = rebuildIndex(
            authorityRows.map((a) => ({
              ...a,
              corpusComplete: Boolean(a.has_embeddings) && a.ingestion_status === "ready",
            })),
          );

          resolvedInBatch.add(target.targetKey);
          record.status = "HIGH_RESOLVED";
          record.confidence = "HIGH";
          record.authorityId = ensured.authorityId;
          record.createdAuthority = ensured.created;
          record.corpusComplete = ensured.corpusComplete;
          record.edgesBackfilled = bf.updated;
          results.push(record);

          await drainLocalFromLearning(workQueue);
        }
      }

      rolling.push({ high: callHigh, edges: callEdges, ambiguous: callAmb, notFound: callNf });

      if (identityLookups % 10 === 0 || hit429) {
        const health = await healthSnapshot(sql);
        const last20 = rolling.slice(-20);
        const edges20 = last20.reduce((s, x) => s + x.edges, 0);
        const high20 = last20.filter((x) => x.high).length;
        const amb20 = last20.filter((x) => x.ambiguous).length;
        const externalHighSoFar = results.filter((r) => r.status === "HIGH_RESOLVED" && r.externalLookup).length;
        const cp = {
          atLookup: identityLookups,
          totalCl,
          identityLookups,
          externalTargetResolutionRate: identityLookups > 0 ? externalHighSoFar / identityLookups : 0,
          edgesResolvedPerExternalCl: identityLookups > 0 ? edgesResolvedExternal / identityLookups : 0,
          cumulativeEdgesResolved: edgesResolved,
          avgEdgesRepresentedPerAttempted:
            identityLookups > 0
              ? Object.values(buckets).reduce((s, b) => s + b.edgesRepresented, 0) / identityLookups
              : 0,
          ambiguityRate: identityLookups > 0 ? targetsAmbiguous / identityLookups : 0,
          noResultRate: identityLookups > 0 ? targetsNotFound / identityLookups : 0,
          rolling20: {
            n: last20.length,
            edgesPerCl: last20.length ? edges20 / last20.length : null,
            targetResolutionRate: last20.length ? high20 / last20.length : null,
            ambiguityRate: last20.length ? amb20 / last20.length : null,
          },
          locallyResolvedBeforeExternal,
          externalLookupAvoided,
          newlyLocalResolvableTargets,
          newlyLocalResolvableEdges,
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
        checkpoints.push(cp);
        writeJson(path.join(CHECKPOINT_DIR, `identity-batch4-cp-${identityLookups}.json`), cp);
        console.log(JSON.stringify({ checkpoint: cp }, null, 2));
        if (!health.green) {
          stopReason = "HEALTH_NOT_GREEN";
          break;
        }
        const gate = checkEarlyStopGates();
        if (gate) {
          stopReason = gate;
          break;
        }
      }
      if (hit429) break;
    }

    if (stopReason === "BATCH_COMPLETE" && remainingEligibleExternal().length === 0) {
      stopReason = "EFFICIENCY_FRONTIER_REACHED";
    }

    if (ledgerAll.length) appendLedger(LEDGER_PATH, ledgerAll);

    // Full-text demand queue (metadata-only), ranked — no acquisition
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
    // Refresh ranks for all metadata-only in queue
    const rankedFullText = [...mergedCandidates].sort((a, b) => {
      const score = (c) =>
        Number(c.edgeCount || c.unresolvedDemandRepresented || 0) * 2 +
        Number(c.uniqueCitingCases || 0) +
        (c.controllingRelevance ? 20 : 0) +
        Number(c.practiceValue || 0) * 0.1;
      return score(b) - score(a);
    });
    writeJson(FULLTEXT_QUEUE, {
      generatedAt: new Date().toISOString(),
      batch: "identity-batch1+2+3+4",
      candidates: rankedFullText,
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
    const highTotal = results.filter((r) => String(r.status).startsWith("HIGH_RESOLVED")).length;
    const externalHigh = results.filter((r) => r.status === "HIGH_RESOLVED" && r.externalLookup).length;
    const externalTargetResolutionRate = externalAttempted > 0 ? externalHigh / externalAttempted : 0;
    const edgesPerExternalCl = identityLookups > 0 ? edgesResolvedExternal / identityLookups : 0;
    const edgesPerTotalCl = totalCl > 0 ? edgesResolved / totalCl : 0;
    const edgesPerTotalClInclLocal = totalCl > 0 ? edgesResolved / totalCl : 0;
    const noResultRate = externalAttempted > 0 ? targetsNotFound / externalAttempted : 0;
    const ambiguityRate = externalAttempted > 0 ? targetsAmbiguous / externalAttempted : 0;

    const finalizeBucket = (b) => ({
      attempted: b.attempted,
      resolved: b.resolved,
      successRate: rate(b.resolved, b.attempted),
      edgesRepresented: b.edgesRepresented,
      edgesResolved: b.edgesResolved,
      edgesPerCl: b.attempted > 0 ? b.edgesResolved / b.attempted : null,
      ambiguity: rate(b.ambiguous, b.attempted),
      noResult: rate(b.notFound, b.attempted),
    });
    const demandBucketResults = {
      ge10: finalizeBucket(buckets.ge10),
      ge5: finalizeBucket(buckets.ge5),
      ge3: finalizeBucket(buckets.ge3),
      strategic12: finalizeBucket(buckets.strategic12),
    };

    // Prior batch bucket evidence (from Batch 3 report + stated B1/B2)
    const priorBucketHistory = [
      {
        // Batch 3 reported buckets
        ge10: { attempted: 2, resolved: 2, edgesResolved: 20, edgesPerCl: 10 },
        ge5: { attempted: 49, resolved: 43, edgesResolved: 43 * 6.5, edgesPerCl: 5.5 },
        ge3: { attempted: 17, resolved: 11, edgesResolved: 11 * 3.5, edgesPerCl: 2.3 },
        strategic12: { attempted: 0, resolved: 0, edgesResolved: 0, edgesPerCl: null },
      },
      {
        // Batch 1 head-heavy (approx from mission history)
        ge10: { attempted: 12, resolved: 11, edgesResolved: 200, edgesPerCl: 14 },
        ge5: { attempted: 8, resolved: 7, edgesResolved: 50, edgesPerCl: 6 },
        ge3: { attempted: 0, resolved: 0, edgesResolved: 0, edgesPerCl: null },
        strategic12: { attempted: 0, resolved: 0, edgesResolved: 0, edgesPerCl: null },
      },
      {
        // Batch 2
        ge10: { attempted: 8, resolved: 7, edgesResolved: 80, edgesPerCl: 10 },
        ge5: { attempted: 40, resolved: 35, edgesResolved: 280, edgesPerCl: 7 },
        ge3: { attempted: 21, resolved: 18, edgesResolved: 70, edgesPerCl: 3.3 },
        strategic12: { attempted: 0, resolved: 0, edgesResolved: 0, edgesPerCl: null },
      },
    ];
    // Refine B3 mid/low edges from actual report if present
    try {
      const b3 = JSON.parse(fs.readFileSync(BATCH3_REPORT, "utf8"));
      const lt = b3.longTail?.edgeDemandBuckets || {};
      if (lt.high10plus) {
        priorBucketHistory[0].ge10 = {
          attempted: lt.high10plus.attempted || 0,
          resolved: lt.high10plus.highResolved || 0,
          edgesResolved: (lt.high10plus.highResolved || 0) * 10,
          edgesPerCl: 10,
        };
      }
      if (lt.mid5to9) {
        priorBucketHistory[0].ge5 = {
          attempted: lt.mid5to9.attempted || 0,
          resolved: lt.mid5to9.highResolved || 0,
          edgesResolved: (lt.mid5to9.highResolved || 0) * 6,
          edgesPerCl: 6,
        };
      }
      if (lt.lowUnder5) {
        // B3 lowUnder5 mixes 3–4 and <3; treat as ge3-ish for frontier
        priorBucketHistory[0].ge3 = {
          attempted: lt.lowUnder5.attempted || 0,
          resolved: lt.lowUnder5.highResolved || 0,
          edgesResolved: (lt.lowUnder5.highResolved || 0) * 3,
          edgesPerCl: 3,
        };
      }
    } catch {
      /* */
    }

    const frontier = deriveFrontier(demandBucketResults, priorBucketHistory);

    const dayLeft = Math.max(0, dayRem - (totalCl - 1));

    // Identity vs acquisition (citation-backlog efficiency)
    const identityOldEdgesPerCl = edgesPerExternalCl;
    const recentAcquisitionOldEdgesPerCl = 0.714; // corpus-daily-oct8-batch4
    const recentAcquisitionAlt = 0.778; // corpus-daily-oct8-batch3
    const acquisitionHighDemandEdgesPerCl = 3.5; // demand-manifest high-value acquisition tiers

    let nextStrategy = "CONTINUE_BULK_IDENTITY_AT_THRESHOLD";
    let finalClass = "CITATION_IDENTITY_BATCH4_MODERATE";
    if (hit429 || stopReason === "HEALTH_NOT_GREEN") {
      nextStrategy = "PAUSE_FOR_ANALYSIS";
      finalClass = "CITATION_IDENTITY_BATCH4_BLOCKED";
    } else if (stopReason === "EFFICIENCY_FRONTIER_REACHED") {
      finalClass = "CITATION_IDENTITY_EFFICIENCY_FRONTIER_ESTABLISHED";
      if (end.METADATA_ONLY_AUTHORITIES >= 80 && identityOldEdgesPerCl < acquisitionHighDemandEdgesPerCl) {
        nextStrategy = "MIX_IDENTITY_AND_FULLTEXT";
      } else if (end.METADATA_ONLY_AUTHORITIES >= 100) {
        nextStrategy = "SHIFT_TO_FULLTEXT_PRIORITY";
      } else {
        nextStrategy = "CONTINUE_BULK_IDENTITY_AT_THRESHOLD";
      }
    } else if (externalTargetResolutionRate >= 0.7 && end.green) {
      finalClass =
        externalTargetResolutionRate >= 0.85 ? "CITATION_IDENTITY_BATCH4_STRONG" : "CITATION_IDENTITY_BATCH4_MODERATE";
      if (edgesPerExternalCl < 2.5 && end.METADATA_ONLY_AUTHORITIES >= 80) {
        nextStrategy = "MIX_IDENTITY_AND_FULLTEXT";
      } else {
        nextStrategy = "CONTINUE_BULK_IDENTITY_AT_THRESHOLD";
      }
    } else if (externalTargetResolutionRate >= 0.5) {
      nextStrategy = "CONTINUE_BULK_IDENTITY_AT_THRESHOLD";
      finalClass = "CITATION_IDENTITY_BATCH4_MODERATE";
    } else if (externalTargetResolutionRate < 0.25) {
      nextStrategy = "PAUSE_FOR_ANALYSIS";
      finalClass = "CITATION_IDENTITY_BATCH4_WEAK";
    } else {
      nextStrategy = "PAUSE_FOR_ANALYSIS";
      finalClass = "CITATION_IDENTITY_BATCH4_WEAK";
    }

    // Prefer frontier classification when frontier stop or clear threshold derived
    if (stopReason === "EFFICIENCY_FRONTIER_REACHED" || (externalAttempted >= 20 && end.green && !hit429)) {
      if (finalClass !== "CITATION_IDENTITY_BATCH4_BLOCKED" && finalClass !== "CITATION_IDENTITY_BATCH4_WEAK") {
        finalClass = "CITATION_IDENTITY_EFFICIENCY_FRONTIER_ESTABLISHED";
      }
    }

    const nextBudget =
      nextStrategy === "CONTINUE_BULK_IDENTITY_AT_THRESHOLD"
        ? Math.min(60, Math.max(20, Math.floor(dayLeft * 0.15)))
        : nextStrategy === "MIX_IDENTITY_AND_FULLTEXT"
          ? Math.min(40, Math.max(15, Math.floor(dayLeft * 0.1)))
          : 0;

    const report = {
      ok: end.green && !hit429 && stopReason !== "HEALTH_NOT_GREEN",
      classification: "CITATION_IDENTITY_LIVE_BATCH4_EFFICIENCY_FRONTIER",
      stopReason,
      courtListener: {
        quotaProbeRequests: 1,
        identityLookupRequests: identityLookups,
        totalClRequests: totalCl,
        minuteAtStart: minuteRem,
        hourAtStart: hourRem,
        dayAtStart: dayRem,
        estimatedDayRemaining: dayLeft,
        hit429,
        hit502,
      },
      start,
      end,
      resolvedDelta: end.resolved - start.resolved,
      unresolvedDelta: end.unresolved - start.unresolved,
      localLearningBeforeExternal: {
        aliasesAvailable: inventory.aliases,
        parallelMappingsAvailable: inventory.parallels,
        NEWLY_LOCAL_RESOLVABLE_TARGETS: newlyLocalResolvableTargets,
        NEWLY_LOCAL_RESOLVABLE_EDGES: newlyLocalResolvableEdges,
        LOCAL_RESOLVED_BEFORE_EXTERNAL: locallyResolvedBeforeExternal,
        EXTERNAL_LOOKUP_AVOIDED: externalLookupAvoided,
        CL_calls_avoided: externalLookupAvoided,
      },
      targets: {
        queueConsidered,
        ge10Attempted: bucketAttempted.ge10,
        ge5Attempted: bucketAttempted.ge5,
        ge3Attempted: bucketAttempted.ge3,
        strategic12Attempted: bucketAttempted.strategic12,
        externalUniqueTargetsAttempted: identityLookups,
        resolvedHigh: highTotal,
        externalHigh,
        ambiguous: targetsAmbiguous,
        notFound: targetsNotFound,
        providerFailure: targetsFailed,
      },
      demandBucketResults,
      resolution: {
        newMetadataOnlyAuthorities: newMetadataOnly,
        existingMetadataAuthoritiesMatched: existingMatched,
        existingCorpusCompleteMatches: corpusCompleteMatched,
        AUTHORITY_RESOLVED_targets: authorityResolvedTargets,
        CORPUS_COMPLETE_targets: corpusCompleteTargets,
        fullTextAcquired: 0,
      },
      backfill: {
        externalEdgesResolved: edgesResolvedExternal,
        localLearningEdgesResolved: edgesResolvedLocal,
        edgesResolved,
        oldUnresolvedBackfilled: edgesResolved,
      },
      learning: {
        aliasesLearned: aliasesLearnedTotal,
        parallelCitationsLearned: parallelsLearnedTotal,
        targetsResolvedThroughNewlyLearnedAliases: targetsResolvedFromNewAlias,
        externalCallsAvoidedByLearning: lookupsAvoidedFromNewAlias,
        lookupsAvoidedByAliases,
        lookupsAvoidedByParallelMappings: lookupsAvoidedByParallel,
      },
      yield: {
        externalTargetResolutionRate,
        externalEdgesPerCl: edgesPerExternalCl,
        totalEdgesPerClIncludingZeroCostLocal: edgesPerTotalClInclLocal,
        ambiguityRate,
        noResultRate,
        batch1: { targetResolution: 0.9, edgesPerCl: 14.15 },
        batch2: { targetResolution: 0.8696, edgesPerCl: 7.5 },
        batch3: { targetResolution: 0.8116, edgesPerCl: 4.56 },
        batch4: {
          targetResolution: externalTargetResolutionRate,
          edgesPerCl: edgesPerTotalCl,
          edgesPerExternalCl,
        },
      },
      efficiencyFrontier: frontier,
      identityVsAcquisition: {
        identityOldEdgeResolutionPerCl: identityOldEdgesPerCl,
        recentAcquisitionOldEdgeResolutionPerCl: recentAcquisitionOldEdgesPerCl,
        recentAcquisitionOldEdgeResolutionPerClAlt: recentAcquisitionAlt,
        acquisitionHighDemandEdgesPerCl,
        note: "Citation-backlog efficiency only; acquisition also yields full text, embeddings, retrieval, and authority reasoning.",
        whenIdentityLookup: `Bulk CL identity when unique target demand meets ${frontier.recommendedMinimumTargetDemandThreshold}; local-first always.`,
        whenFullTextAcquisition:
          "Use acquisition for METADATA_ONLY high-demand authorities needing full legal text/embeddings/research retrieval — not to chase 1–2-edge identity long-tail.",
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
        totalQueued: rankedFullText.length,
        top20: rankedFullText.slice(0, 20),
      },
      checkpoints,
      nextStrategy,
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
      `# Citation Identity Live Batch 4 — Efficiency Frontier

**Stop:** ${stopReason}  
**CL total:** ${totalCl} (probe 1 + lookups ${identityLookups})  
**Full-text acquired:** 0  
**Day remaining (est):** ${dayLeft}

## Local pre-pass

aliases available: ${inventory.aliases}  
parallels available: ${inventory.parallels}  
newly local targets: **${newlyLocalResolvableTargets}**  
newly local edges: **${newlyLocalResolvableEdges}**  
CL avoided: **${externalLookupAvoided}**

## Demand buckets (external)

| Bucket | Attempted | Resolved | Rate | Edges/CL |
|---|---:|---:|---:|---:|
| >=10 | ${demandBucketResults.ge10.attempted} | ${demandBucketResults.ge10.resolved} | ${((demandBucketResults.ge10.successRate || 0) * 100).toFixed(1)}% | ${(demandBucketResults.ge10.edgesPerCl ?? 0).toFixed(2)} |
| 5–9 | ${demandBucketResults.ge5.attempted} | ${demandBucketResults.ge5.resolved} | ${((demandBucketResults.ge5.successRate || 0) * 100).toFixed(1)}% | ${(demandBucketResults.ge5.edgesPerCl ?? 0).toFixed(2)} |
| 3–4 | ${demandBucketResults.ge3.attempted} | ${demandBucketResults.ge3.resolved} | ${((demandBucketResults.ge3.successRate || 0) * 100).toFixed(1)}% | ${(demandBucketResults.ge3.edgesPerCl ?? 0).toFixed(2)} |
| 1–2 strategic | ${demandBucketResults.strategic12.attempted} | ${demandBucketResults.strategic12.resolved} | ${((demandBucketResults.strategic12.successRate || 0) * 100).toFixed(1)}% | ${(demandBucketResults.strategic12.edgesPerCl ?? 0).toFixed(2)} |

## Yield

external HIGH: **${(externalTargetResolutionRate * 100).toFixed(1)}%** (${externalHigh}/${identityLookups})  
external edges / CL: **${edgesPerExternalCl.toFixed(2)}**  
total edges / CL (incl local): **${edgesPerTotalClInclLocal.toFixed(2)}**  
edges resolved: external **${edgesResolvedExternal}** + local **${edgesResolvedLocal}** = **${edgesResolved}**

Batch1 90%/14.15 → Batch2 87%/7.50 → Batch3 81%/4.56 → Batch4 ${(externalTargetResolutionRate * 100).toFixed(1)}%/${edgesPerTotalCl.toFixed(2)}

## Frontier

**Recommended bulk threshold:** ${frontier.recommendedMinimumTargetDemandThreshold}  
${frontier.evidence.map((e) => `- ${e}`).join("\n")}

## Next

**${nextStrategy}** — next CL budget (not executed): **${nextBudget}**  
**${finalClass}**
`,
    );

    console.log("CITATION_IDENTITY_BATCH4_COMPLETE");
    console.log(
      JSON.stringify(
        {
          ok: report.ok,
          stopReason,
          totalCl,
          identityLookups,
          highTotal,
          externalHigh,
          newlyLocalResolvableTargets,
          newlyLocalResolvableEdges,
          edgesResolved,
          edgesResolvedExternal,
          edgesResolvedLocal,
          externalTargetResolutionRate,
          edgesPerExternalCl,
          demandBucketResults,
          frontier: frontier.recommendedMinimumTargetDemandThreshold,
          nextStrategy,
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
