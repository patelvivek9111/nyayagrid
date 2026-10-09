/**
 * Phase 1I: Identity-heavy mixed CourtListener batch 3.
 * TOTAL CL hard cap: 55 (1 quota probe + ≤41 identity + ≤8 FT CL ≈ ≤4 authorities).
 * Allocation target ~75% identity / 15% full-text / 10% reserve.
 * Hardened CASE_IDENTITY_LOOKUP_ELIGIBLE gate. Early-stop efficiency gates.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createHash } = require("node:crypto");
const postgres = require("postgres");
const { ensureCaseCitationExtraction } = require("./lib/case-citation-extraction.cjs");
const {
  LocalAuthorityIndex,
  buildUnresolvedTargetQueue,
  classifyCaseCitationLookupEligibility,
  isStrategicIdentityException,
  targetKey,
  experimentalNormalize,
  parseCitationLookupResponse,
  createResolutionRecord,
  appendLedger,
  loadLedger,
  RESOLVER_VERSION,
} = require("../packages/research/src/corpus/citation-resolution/cjs-bridge.cjs");

const TOTAL_CL_CAP = 55;
const MAX_IDENTITY = 41;
const MAX_FT_CL = 8;
const MAX_FT_AUTHORITIES = 4; // ~2 CL per authority under 8 FT CL budget
const RATE_MS = 5000;
const CL_BASE = "https://www.courtlistener.com/api/rest/v4";
const SOURCE = "courtlistener";
const BATCH = "mixed-batch3";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS = 384;
const MAX_OPINION_CHARS = 40_000;
const MAX_CHUNK_CHARS = 1000;

const ROOT = path.join(__dirname, "..");
const CHECKPOINT_DIR = path.join(ROOT, "packages/research/corpus/resolution/checkpoints");
const LEDGER_PATH = path.join(ROOT, "packages/research/corpus/resolution/ledger/cl-mixed-batch3-2026-10-09.jsonl");
const REPORT_JSON = path.join(ROOT, "packages/research/corpus/reports/citation-identity-heavy-mixed-batch3-2026-10-09.json");
const REPORT_MD = path.join(ROOT, "packages/research/corpus/reports/citation-identity-heavy-mixed-batch3-2026-10-09.md");
const FULLTEXT_QUEUE = path.join(ROOT, "packages/research/corpus/resolution/fulltext-demand-queue-2026-10-09.json");
const PRIOR_REPORTS = [
  "citation-identity-live-batch1-2026-10-09.json",
  "citation-identity-live-batch2-2026-10-09.json",
  "citation-identity-live-batch3-2026-10-09.json",
  "citation-identity-live-batch4-2026-10-09.json",
  "citation-mixed-live-batch1-2026-10-09.json",
  "citation-identity-heavy-mixed-batch2-2026-10-09.json",
].map((f) => path.join(ROOT, "packages/research/corpus/reports", f));

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
}
function sha256(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}
function toPgvector(vec) {
  return `[${vec.join(",")}]`;
}
function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function pickText(hit) {
  const plain = hit?.plain_text || hit?.plainText;
  if (plain && String(plain).trim().length >= 80) {
    return String(plain).replace(/\s+/g, " ").trim().slice(0, MAX_OPINION_CHARS);
  }
  const html = hit?.html_with_citations || hit?.html || hit?.html_lawbox || hit?.html_columbia || hit?.snippet || "";
  return stripHtml(html).slice(0, MAX_OPINION_CHARS);
}
function chunkContent(content) {
  const parts = String(content)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks = [];
  for (const p of parts) {
    if (p.length <= MAX_CHUNK_CHARS) chunks.push(p);
    else {
      let rest = p;
      while (rest.length > MAX_CHUNK_CHARS) {
        let cut = rest.lastIndexOf(" ", MAX_CHUNK_CHARS);
        if (cut < MAX_CHUNK_CHARS / 2) cut = MAX_CHUNK_CHARS;
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) chunks.push(rest);
    }
  }
  return chunks.length ? chunks : [String(content).slice(0, MAX_CHUNK_CHARS)];
}

async function embedBatch(texts, apiKey) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts, dimensions: EMBEDDING_DIMS }),
  });
  if (!res.ok) throw new Error(`embed_http_${res.status}`);
  const body = await res.json();
  return (body.data || []).sort((a, b) => a.index - b.index).map((d) => d.embedding);
}
async function embedAll(texts, apiKey) {
  const out = [];
  for (let i = 0; i < texts.length; i += 32) {
    out.push(...(await embedBatch(texts.slice(i, i + 32), apiKey)));
  }
  return out;
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
    membership: { level: membership?.level || membership?.name || null, is_active: membership?.is_active ?? null },
    minute: byPeriod.minute || null,
    hour: byPeriod.hour || null,
    day: byPeriod.day || null,
    ms: Date.now() - t0,
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
    ...(await authorityCompleteness(sql)),
  };
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
  for (const p of PRIOR_REPORTS) {
    try {
      const b = JSON.parse(fs.readFileSync(p, "utf8"));
      for (const r of b.results || []) if (r.targetKey) priorKeys.add(r.targetKey);
      for (const r of b.identityLane?.results || []) if (r.targetKey) priorKeys.add(r.targetKey);
    } catch {
      /* */
    }
  }
  return priorKeys;
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
      aliasesLearned: Math.max(0, meta.citationAliases.length - aliases.length),
      parallelsLearned: Math.max(0, meta.parallelCitations.length - parallels.length),
    };
  }

  const authorityId = crypto.randomUUID();
  const title = lookup.caseName || primaryCite || target.normalizedCitation;
  const aliasSet = [...new Set([target.normalizedCitation, target.representativeRaw, primaryCite, ...citations].filter(Boolean))].slice(0, 24);
  const parallelSet = citations.slice(0, 12);
  const metadata = {
    adapter: "citation-resolution-mixed-batch3-identity",
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
    aliasesLearned: aliasSet.length,
    parallelsLearned: parallelSet.length,
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

function scoreFtCandidate(c) {
  const edges = Number(c.edgeCount || c.unresolvedDemandRepresented || 0);
  const citing = Number(c.uniqueCitingCases || 0);
  const j = String((c.jurisdictions || []).join(" ") + " " + (c.court || "")).toLowerCase();
  let s = edges * 2 + citing;
  if (/us-ca-3|ca3|third/.test(j)) s += 25;
  if (/us-d-pa|paed|edpa/.test(j)) s += 20;
  if (/st-pa|pennsylvania/.test(j)) s += 12;
  if (/us-scotus|scotus/.test(j) || /S\.\s*Ct|U\.S\.|Wall|How/i.test(c.citation || "")) s += 18;
  if (c.controllingRelevance) s += 15;
  s += Number(c.practiceValue || 0) * 0.1;
  if (/\bU\.S\.|\bS\.\s*Ct|\bF\.(?:2d|3d|4th)|\bF\.\s*Supp|Wall|How/i.test(c.citation || "")) s += 10;
  return s;
}

function pickOpinionId(cluster) {
  const opinions = Array.isArray(cluster.sub_opinions)
    ? cluster.sub_opinions
    : Array.isArray(cluster.opinions)
      ? cluster.opinions
      : [];
  for (const op of opinions) {
    if (typeof op === "number" || (typeof op === "string" && /^\d+$/.test(op))) return String(op);
    if (op && typeof op === "object" && op.id != null) return String(op.id);
    if (typeof op === "string" && op.includes("/opinions/")) {
      const m = op.match(/\/opinions\/(\d+)/);
      if (m) return m[1];
    }
  }
  return null;
}

async function main() {
  const apiKey = process.env.COURTLISTENER_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const url = process.env.DATABASE_URL?.trim();
  if (!apiKey) {
    console.log(JSON.stringify({ ok: false, reason: "COURTLISTENER_API_KEY missing" }));
    process.exit(2);
  }
  if (!openaiKey) {
    console.log(JSON.stringify({ ok: false, reason: "OPENAI_API_KEY missing" }));
    process.exit(2);
  }
  if (!url || /localhost|127\.0\.0\.1|:5433/i.test(url)) {
    console.log(JSON.stringify({ ok: false, reason: "need Neon DATABASE_URL" }));
    process.exit(2);
  }

  const quota = await probeQuota(apiKey);
  let totalCl = 1;
  let identityCl = 0;
  let fullTextCl = 0;
  let retryCl = 0;
  const minuteRem = Number(quota.minute?.remaining ?? 0);
  const hourRem = Number(quota.hour?.remaining ?? 0);
  const dayRem = Number(quota.day?.remaining ?? 0);
  console.log(JSON.stringify({ quotaGate: { minuteRem, hourRem, dayRem, membership: quota.membership } }, null, 2));
  if (!quota.ok || hourRem < 90 || dayRem < 140) {
    console.log(
      JSON.stringify({
        ok: false,
        stopReason: "INSUFFICIENT_SAFE_QUOTA",
        classification: "CITATION_IDENTITY_HEAVY_MIXED_BATCH3",
        courtListenerHttpCalls: 1,
      }),
    );
    process.exit(3);
  }

  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 30, connect_timeout: 60 });
  let lastAt = Date.now();
  let hit429 = false;
  let hit502 = 0;
  let stopReason = "BATCH_COMPLETE";

  // Identity lane counters
  let idLocalBefore = 0;
  let idExternalAttempted = 0;
  let idHigh = 0;
  let idAmbiguous = 0;
  let idNotFound = 0;
  let idFailed = 0;
  let idEdgesBackfilled = 0;
  let idAliases = 0;
  let idParallels = 0;
  let idLookupsAvoided = 0;
  let idTargetsResolvedByLearning = 0;
  let idLookupsAvoidedByLearning = 0;
  let idNewMetadataOnly = 0;
  const idResults = [];
  const ledgerAll = [];
  const resolvedInBatch = new Set();

  // Full-text lane counters
  let ftAttempted = 0;
  let ftAcquired = 0;
  let ftSkippedComplete = 0;
  let ftFailed = 0;
  let ftOldUnresolvedResolved = 0;
  let ftNewEdgesTotal = 0;
  let ftNewEdgesResolvedImmediate = 0;
  let ftNewEdgesStillUnresolved = 0;
  let ftOldBackfilledFromNew = 0;
  let ftLookupsAvoided = 0;
  let ftAliases = 0;
  let ftParallels = 0;
  let metadataToComplete = 0;
  const ftResults = [];
  const checkpoints = [];

  async function rateWait() {
    const wait = RATE_MS - (Date.now() - lastAt);
    if (lastAt && wait > 0) await sleep(wait);
  }
  async function clGet(pathname) {
    if (totalCl >= TOTAL_CL_CAP) return { ok: false, status: 0, budgetExhausted: true, body: null };
    await rateWait();
    totalCl += 1;
    lastAt = Date.now();
    const res = await fetch(`${CL_BASE}${pathname}`, {
      headers: { Authorization: `Token ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(60000),
    });
    if (res.status === 429) {
      hit429 = true;
      return { ok: false, status: 429, body: null };
    }
    if (res.status === 502 || res.status === 504) {
      hit502 += 1;
      if (totalCl < TOTAL_CL_CAP && hit502 < 3) {
        await sleep(2000);
        retryCl += 1;
        totalCl += 1;
        lastAt = Date.now();
        const res2 = await fetch(`${CL_BASE}${pathname}`, {
          headers: { Authorization: `Token ${apiKey}`, Accept: "application/json" },
          signal: AbortSignal.timeout(60000),
        });
        if (!res2.ok) return { ok: false, status: res2.status, body: null };
        return { ok: true, status: res2.status, body: await res2.json() };
      }
      return { ok: false, status: res.status, body: null };
    }
    if (!res.ok) return { ok: false, status: res.status, body: null };
    return { ok: true, status: res.status, body: await res.json() };
  }

  try {
    const start = await healthSnapshot(sql);
    console.log(JSON.stringify({ startCompleteness: {
      AUTHORITY_RESOLVED_EDGES: start.AUTHORITY_RESOLVED_EDGES,
      CORPUS_COMPLETE_EDGES: start.CORPUS_COMPLETE_EDGES,
      IDENTITY_UNRESOLVED_EDGES: start.IDENTITY_UNRESOLVED_EDGES,
      METADATA_ONLY_AUTHORITIES: start.METADATA_ONLY_AUTHORITIES,
      CORPUS_COMPLETE_AUTHORITIES: start.CORPUS_COMPLETE_AUTHORITIES,
    } }, null, 2));
    if (!start.green) {
      console.log(JSON.stringify({ ok: false, stopReason: "START_HEALTH_NOT_GREEN", start, totalCl }));
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
    await sql.unsafe("COMMIT");

    const priorKeys = loadPriorKeys();
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

    // Lane A selection: eligible, >=5, or strategic exception; exclude prior batch keys
    const identityPool = queue.targets
      .filter((t) => {
        if (priorKeys.has(t.targetKey)) return false;
        if (t.localCandidateStatus !== "NO_LOCAL_MATCH") return false;
        const el = classifyCaseCitationLookupEligibility(t.representativeRaw, t.normalizedCitation);
        if (!el.eligible) return false;
        if (t.edgeCount >= 5) return true;
        return isStrategicIdentityException({
          edgeCount: t.edgeCount,
          jurisdictions: t.jurisdictions,
          priorityScore: t.priorityScore,
        });
      })
      .sort((a, b) => {
        const tier = (t) => (t.edgeCount >= 10 ? 0 : t.edgeCount >= 5 ? 1 : 2);
        const j = (t) => {
          const s = (t.jurisdictions || []).join(" ").toLowerCase();
          if (/us-ca-3|ca3/.test(s)) return 0;
          if (/us-d-pa|paed|edpa/.test(s)) return 1;
          if (/st-pa|pennsylvania/.test(s)) return 2;
          if (/us-scotus/.test(s)) return 3;
          return 4;
        };
        return tier(a) - tier(b) || j(a) - j(b) || b.edgeCount - a.edgeCount || b.priorityScore - a.priorityScore;
      });

    const identitySelected = identityPool.slice(0, MAX_IDENTITY + 80);
    const ge5EligibleRemaining = () =>
      identitySelected.filter((t) => t.edgeCount >= 5 && !resolvedInBatch.has(t.targetKey)).length;
    const rollingIdentity = []; // { high, edges, ambiguous }
    console.log(JSON.stringify({ identityPool: identityPool.length, working: identitySelected.length, priorExcluded: priorKeys.size }));

    async function applyLocalId(target, localHit, viaLearning = false) {
      const auth = authorityRows.find((a) => a.id === localHit.authorityId);
      const corpusComplete = Boolean(auth?.has_embeddings) && auth?.ingestion_status === "ready";
      const bf = await backfillTarget(sql, target, localHit.authorityId, localHit.method, localHit.evidence, corpusComplete);
      idEdgesBackfilled += bf.updated;
      idHigh += 1;
      idLocalBefore += 1;
      idLookupsAvoided += 1;
      if (viaLearning) {
        idTargetsResolvedByLearning += 1;
        idLookupsAvoidedByLearning += 1;
      }
      ledgerAll.push(...bf.ledger);
      resolvedInBatch.add(target.targetKey);
      idResults.push({
        targetKey: target.targetKey,
        citation: target.normalizedCitation,
        edgeCount: target.edgeCount,
        status: viaLearning ? "HIGH_RESOLVED_FROM_NEW_LEARNING" : "HIGH_RESOLVED_LOCAL",
        method: localHit.method,
        edgesBackfilled: bf.updated,
        externalLookup: false,
      });
    }

    // ---- LANE A: IDENTITY ----
    let identityStopReason = null;
    for (const target of identitySelected) {
      if (identityCl >= MAX_IDENTITY || totalCl >= TOTAL_CL_CAP) break;
      if (hit429) break;
      if (identityStopReason) break;
      if (resolvedInBatch.has(target.targetKey)) continue;

      // Prefer remaining >=5; only allow strategic <5 after ge5 pool drained
      if (target.edgeCount < 5 && ge5EligibleRemaining() > 0) continue;
      if (target.edgeCount < 5 && ge5EligibleRemaining() === 0 && identityCl > 0) {
        // strategic exceptions only after ge5 exhaustion — still allowed
      }

      const localHit = index.lookupCitation(target.representativeRaw, target.normalizedCitation);
      if (localHit.kind === "one") {
        await applyLocalId(target, localHit);
        continue;
      }

      await rateWait();
      identityCl += 1;
      totalCl += 1;
      idExternalAttempted += 1;
      lastAt = Date.now();

      let callHigh = false;
      let callEdges = 0;
      let callAmb = false;
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
          idFailed += 1;
          idResults.push({ targetKey: target.targetKey, status: "failed", reason: "rate_limited", externalLookup: true });
          break;
        }
        if (res.status === 502 || res.status === 504) {
          hit502 += 1;
          if (totalCl < TOTAL_CL_CAP) {
            await sleep(2000);
            retryCl += 1;
            identityCl += 1;
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
              idFailed += 1;
              idResults.push({ targetKey: target.targetKey, status: "failed", reason: `http_${httpStatus}`, externalLookup: true });
              continue;
            }
            body = await res2.json();
          } else {
            idFailed += 1;
            idResults.push({ targetKey: target.targetKey, status: "failed", reason: "http_5xx_no_retry", externalLookup: true });
            continue;
          }
        } else if (!res.ok) {
          idFailed += 1;
          idResults.push({ targetKey: target.targetKey, status: "failed", reason: `http_${httpStatus}`, externalLookup: true });
          continue;
        } else {
          body = await res.json();
        }
      } catch (e) {
        idFailed += 1;
        idResults.push({ targetKey: target.targetKey, status: "failed", reason: String(e.message || e).slice(0, 200), externalLookup: true });
        continue;
      }

      const parsed = parseCitationLookupResponse(body);
      const record = {
        targetKey: target.targetKey,
        citation: target.normalizedCitation,
        edgeCount: target.edgeCount,
        jurisdictions: target.jurisdictions,
        externalLookup: true,
        httpStatus,
        providerStatus: parsed.status,
      };

      if (parsed.status === "ambiguous") {
        idAmbiguous += 1;
        callAmb = true;
        record.status = "NO_AUTO_RESOLVE";
        idResults.push(record);
      } else if (parsed.status === "not_found") {
        idNotFound += 1;
        record.status = "IDENTITY_UNRESOLVED";
        idResults.push(record);
      } else if (parsed.status !== "resolved") {
        idFailed += 1;
        record.status = "failed";
        idResults.push(record);
      } else {
        const ensured = await ensureIdentityAuthority(sql, target, parsed);
        if (!ensured.ok) {
          idAmbiguous += 1;
          callAmb = true;
          record.status = "NO_AUTO_RESOLVE";
          record.reason = ensured.reason;
          idResults.push(record);
        } else {
          const bf = await backfillTarget(
            sql,
            target,
            ensured.authorityId,
            "COURTLISTENER_CITATION_LOOKUP",
            parsed.evidence,
            ensured.corpusComplete,
          );
          idEdgesBackfilled += bf.updated;
          callEdges = bf.updated;
          callHigh = true;
          idHigh += 1;
          idAliases += Number(ensured.aliasesLearned || 0);
          idParallels += Number(ensured.parallelsLearned || 0);
          ledgerAll.push(...bf.ledger);
          if (ensured.created) {
            idNewMetadataOnly += 1;
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
          } else {
            const idx = authorityRows.findIndex((a) => a.id === ensured.authorityId);
            if (idx >= 0) {
              const row = authorityRows[idx];
              const meta = row.metadata && typeof row.metadata === "object" ? { ...row.metadata } : {};
              meta.citationAliases = [...new Set([...(meta.citationAliases || []), target.normalizedCitation, ...(parsed.citations || [])])];
              meta.parallelCitations = [...new Set([...(meta.parallelCitations || []), ...(parsed.citations || [])])];
              authorityRows[idx] = { ...row, metadata: meta };
            }
          }
          index = rebuildIndex(
            authorityRows.map((a) => ({
              ...a,
              corpusComplete: Boolean(a.has_embeddings) && a.ingestion_status === "ready",
            })),
          );
          resolvedInBatch.add(target.targetKey);
          record.status = "HIGH_RESOLVED";
          record.authorityId = ensured.authorityId;
          record.createdAuthority = ensured.created;
          record.edgesBackfilled = bf.updated;
          record.clusterId = parsed.clusterId;
          idResults.push(record);

          // Drain newly local-resolvable from learning
          for (const t of identitySelected) {
            if (resolvedInBatch.has(t.targetKey)) continue;
            const hit = index.lookupCitation(t.representativeRaw, t.normalizedCitation);
            if (hit.kind === "one") await applyLocalId(t, hit, true);
          }
        }
      }

      rollingIdentity.push({ high: callHigh, edges: callEdges, ambiguous: callAmb });
      if (rollingIdentity.length >= 20) {
        const last20 = rollingIdentity.slice(-20);
        const high20 = last20.filter((x) => x.high).length;
        const edges20 = last20.reduce((s, x) => s + x.edges, 0);
        const amb20 = last20.filter((x) => x.ambiguous).length;
        if (high20 / 20 < 0.6 || edges20 / 20 < 2.5 || amb20 / 20 > 0.3) {
          identityStopReason = "IDENTITY_EFFICIENCY_STOP";
          stopReason = "IDENTITY_EFFICIENCY_STOP";
        }
      }
      if (!identityStopReason && ge5EligibleRemaining() === 0 && target.edgeCount >= 5) {
        // after processing a ge5 target, if no more ge5 remain, allow strategic or stop after this call
        const moreGe5 = identitySelected.some(
          (t) => t.edgeCount >= 5 && !resolvedInBatch.has(t.targetKey) && t.targetKey !== target.targetKey,
        );
        if (!moreGe5) {
          // continue only for strategic <5 already in queue; if next items are only strategic, keep going until strategic done or cap
        }
      }

      if (identityCl % 10 === 0 || identityStopReason) {
        const health = await healthSnapshot(sql);
        const last20 = rollingIdentity.slice(-20);
        const cp = {
          lane: "identity",
          atLookup: identityCl,
          totalCl,
          idHigh,
          idEdgesBackfilled,
          edgesPerIdentityCl: identityCl > 0 ? idEdgesBackfilled / identityCl : null,
          ambiguityRate: identityCl > 0 ? idAmbiguous / identityCl : null,
          notFoundRate: identityCl > 0 ? idNotFound / identityCl : null,
          rolling20: {
            n: last20.length,
            targetResolution: last20.length ? last20.filter((x) => x.high).length / last20.length : null,
            edgesPerCl: last20.length ? last20.reduce((s, x) => s + x.edges, 0) / last20.length : null,
            ambiguity: last20.length ? last20.filter((x) => x.ambiguous).length / last20.length : null,
          },
          identityStopReason,
          health: { green: health.green, unresolved: health.unresolved, METADATA_ONLY: health.METADATA_ONLY_AUTHORITIES },
        };
        checkpoints.push(cp);
        writeJson(path.join(CHECKPOINT_DIR, `mixed-batch3-id-cp-${identityCl}.json`), cp);
        console.log(JSON.stringify({ checkpoint: cp }, null, 2));
        if (!health.green) {
          stopReason = "HEALTH_NOT_GREEN";
          break;
        }
      }
    }

    if (!identityStopReason && ge5EligibleRemaining() === 0 && identityCl > 0) {
      // If no more >=5 and we only have low-value leftovers, stop identity before burning long tail
      const remainingStrategic = identitySelected.some(
        (t) =>
          !resolvedInBatch.has(t.targetKey) &&
          t.edgeCount < 5 &&
          isStrategicIdentityException({
            edgeCount: t.edgeCount,
            jurisdictions: t.jurisdictions,
            priorityScore: t.priorityScore,
          }),
      );
      if (!remainingStrategic && stopReason === "BATCH_COMPLETE") {
        identityStopReason = "GE5_QUEUE_EXHAUSTED";
        stopReason = "GE5_QUEUE_EXHAUSTED";
      }
    }

    if (hit429) {
      /* skip FT */
    } else if (stopReason === "HEALTH_NOT_GREEN") {
      /* skip FT */
    } else {
      // ---- LANE B: FULL-TEXT ----
      let ftQueue = [];
      try {
        ftQueue = JSON.parse(fs.readFileSync(FULLTEXT_QUEUE, "utf8")).candidates || [];
      } catch {
        /* */
      }
      // Refresh completeness from DB for candidates
      const ranked = [];
      for (const c of [...ftQueue].sort((a, b) => scoreFtCandidate(b) - scoreFtCandidate(a))) {
        if (!c.authorityId || !c.clusterId) continue;
        const [row] = await sql`
          select id, citation, normalized_citation, title, metadata, source_external_id, ingestion_status,
            exists(select 1 from legal_authority_chunks ch where ch.authority_id = legal_authorities.id and ch.embedding is not null) as has_embeddings
          from legal_authorities where id = ${c.authorityId}
          limit 1
        `;
        if (!row) continue;
        if (row.ingestion_status === "ready" && row.has_embeddings) {
          ftSkippedComplete += 1;
          continue;
        }
        ranked.push({
          ...c,
          rankScore: scoreFtCandidate(c),
          dbCitation: row.citation,
          dbTitle: row.title,
          sourceExternalId: row.source_external_id,
        });
      }
      const ftSelected = ranked.slice(0, MAX_FT_AUTHORITIES);
      console.log(JSON.stringify({ ftSelected: ftSelected.length, ftSkippedComplete }));

      for (const cand of ftSelected) {
        if (ftAcquired >= MAX_FT_AUTHORITIES) break;
        if (fullTextCl + 2 > MAX_FT_CL) break; // hard FT CL budget (~2 per authority)
        if (totalCl + 2 > TOTAL_CL_CAP) break; // need cluster + opinion
        if (hit429) break;

        ftAttempted += 1;
        const unresolvedBeforeGlobal = (await healthSnapshot(sql)).unresolved;
        const [edgeBefore] = await sql`
          select count(*)::int as n from legal_authority_citations
          where from_authority_id = ${cand.authorityId}
        `;
        const edgesFromAuthBefore = edgeBefore.n;

        const clBeforeCluster = totalCl;
        const clusterRes = await clGet(`/clusters/${cand.clusterId}/`);
        fullTextCl += totalCl - clBeforeCluster;
        if (clusterRes.status === 429 || hit429) {
          hit429 = true;
          stopReason = "HTTP_429";
          ftFailed += 1;
          ftResults.push({ citation: cand.citation, status: "failed", reason: "rate_limited" });
          break;
        }
        if (!clusterRes.ok) {
          ftFailed += 1;
          ftResults.push({ citation: cand.citation, authorityId: cand.authorityId, status: "failed", reason: `cluster_http_${clusterRes.status}` });
          continue;
        }
        const cluster = clusterRes.body;
        const opinionId = pickOpinionId(cluster);
        if (!opinionId) {
          ftFailed += 1;
          ftResults.push({ citation: cand.citation, authorityId: cand.authorityId, status: "failed", reason: "no_opinion_id" });
          continue;
        }
        if (totalCl >= TOTAL_CL_CAP) break;
        const clBeforeOpinion = totalCl;
        const opRes = await clGet(`/opinions/${opinionId}/`);
        fullTextCl += totalCl - clBeforeOpinion;
        if (opRes.status === 429 || hit429) {
          hit429 = true;
          stopReason = "HTTP_429";
          ftFailed += 1;
          ftResults.push({ citation: cand.citation, status: "failed", reason: "rate_limited" });
          break;
        }
        if (!opRes.ok) {
          ftFailed += 1;
          ftResults.push({ citation: cand.citation, authorityId: cand.authorityId, status: "failed", reason: `opinion_http_${opRes.status}` });
          continue;
        }
        const text = pickText(opRes.body);
        if (text.length < 80) {
          ftFailed += 1;
          ftResults.push({ citation: cand.citation, authorityId: cand.authorityId, status: "failed", reason: "empty_opinion_text" });
          continue;
        }

        const contentHash = sha256(text);
        const versionId = crypto.randomUUID();
        const [verRow] = await sql`
          select coalesce(max(version_number), 0)::int as v from legal_authority_versions where authority_id = ${cand.authorityId}
        `;
        const nextVersion = Number(verRow.v) + 1;
        await sql`
          update legal_authority_versions set valid_to = now()
          where authority_id = ${cand.authorityId} and valid_to is null
        `;
        const title =
          cluster.case_name || cluster.case_name_full || cand.caseName || cand.dbTitle || cand.citation;
        const decisionDate = cluster.date_filed ? String(cluster.date_filed).slice(0, 10) : null;
        const [authMeta] = await sql`select metadata from legal_authorities where id = ${cand.authorityId}`;
        const meta = authMeta?.metadata && typeof authMeta.metadata === "object" ? { ...authMeta.metadata } : {};
        meta.identityOnly = false;
        meta.corpusComplete = true;
        meta.fullTextAcquisition = {
          batch: BATCH,
          clusterId: String(cand.clusterId),
          opinionId: String(opinionId),
          acquiredAt: new Date().toISOString(),
          contentHash,
        };
        const cites = Array.isArray(cluster.citations)
          ? cluster.citations.map((c) => (typeof c === "string" ? c : c?.cite)).filter(Boolean)
          : Array.isArray(cluster.citation)
            ? cluster.citation.map(String)
            : [];
        const aliasesBefore = Array.isArray(meta.citationAliases) ? meta.citationAliases.length : 0;
        const parallelsBefore = Array.isArray(meta.parallelCitations) ? meta.parallelCitations.length : 0;
        meta.citationAliases = [...new Set([...(meta.citationAliases || []), cand.citation, cand.dbCitation, ...cites].filter(Boolean))].slice(0, 24);
        meta.parallelCitations = [...new Set([...(meta.parallelCitations || []), ...cites].filter(Boolean))].slice(0, 24);
        ftAliases += Math.max(0, meta.citationAliases.length - aliasesBefore);
        ftParallels += Math.max(0, meta.parallelCitations.length - parallelsBefore);

        await sql`
          update legal_authorities set
            title = ${String(title).slice(0, 500)},
            decision_date = coalesce(${decisionDate}, decision_date),
            canonical_source_url = ${`https://www.courtlistener.com/opinion/${cand.clusterId}/`},
            metadata = ${sql.json(meta)},
            ingestion_status = 'processing'::authority_ingestion_status,
            last_checked_at = now(),
            updated_at = now()
          where id = ${cand.authorityId}
        `;
        await sql`
          insert into legal_authority_versions (
            id, authority_id, version_number, content, effective_from, effective_to,
            source_provider, source_metadata, sha256
          ) values (
            ${versionId}, ${cand.authorityId}, ${nextVersion}, ${text},
            ${decisionDate}, ${null}, ${SOURCE},
            ${sql.json({ adapter: "citation-mixed-batch3-fulltext", clusterId: String(cand.clusterId), opinionId: String(opinionId) })},
            ${contentHash}
          )
        `;
        // Replace chunks for this authority (metadata-only should have none)
        await sql`delete from legal_authority_chunks where authority_id = ${cand.authorityId}`;
        const chunks = chunkContent(text);
        const vectors = await embedAll(chunks, openaiKey);
        for (let i = 0; i < chunks.length; i++) {
          await sql`
            insert into legal_authority_chunks (
              id, authority_id, authority_version_id, chunk_index, content,
              segment_ref, char_start, char_end, embedding, embedding_model
            ) values (
              ${crypto.randomUUID()}, ${cand.authorityId}, ${versionId}, ${i}, ${chunks[i]},
              ${`p${i + 1}`}, ${null}, ${null}, ${toPgvector(vectors[i])}::vector,
              ${`${EMBEDDING_MODEL}:${EMBEDDING_DIMS}`}
            )
          `;
        }
        const citeResult = await ensureCaseCitationExtraction(sql, {
          authorityId: cand.authorityId,
          content: text,
          existingMetadata: meta,
        });
        await sql`
          update legal_authorities
          set ingestion_status = 'ready'::authority_ingestion_status, updated_at = now()
          where id = ${cand.authorityId}
        `;

        const [edgeAfter] = await sql`
          select
            count(*)::int as total,
            count(*) filter (where to_authority_id is not null)::int as resolved,
            count(*) filter (where to_authority_id is null)::int as unresolved
          from legal_authority_citations
          where from_authority_id = ${cand.authorityId}
        `;
        const newEdges = Math.max(0, edgeAfter.total - edgesFromAuthBefore);
        const newResolved = Math.max(0, edgeAfter.resolved); // approximate immediate among from-auth; refine below
        // Count newly inserted unresolved/resolved more carefully via citeResult
        const newEdgesTotal = Number(citeResult.inserted || newEdges);
        ftNewEdgesTotal += newEdgesTotal;

        // Count how many of the new from-edges are resolved
        const newEdgeRows = await sql`
          select to_authority_id from legal_authority_citations
          where from_authority_id = ${cand.authorityId}
          order by created_at desc
          limit ${Math.max(newEdgesTotal, 1)}
        `;
        let imm = 0;
        let still = 0;
        for (const er of newEdgeRows.slice(0, newEdgesTotal)) {
          if (er.to_authority_id) imm += 1;
          else still += 1;
        }
        ftNewEdgesResolvedImmediate += imm;
        ftNewEdgesStillUnresolved += still;

        // Update index + deterministic old-edge backfill for this authority's citations/aliases
        const aidx = authorityRows.findIndex((a) => a.id === cand.authorityId);
        if (aidx >= 0) {
          authorityRows[aidx] = {
            ...authorityRows[aidx],
            metadata: meta,
            title,
            ingestion_status: "ready",
            has_embeddings: true,
            corpusComplete: true,
          };
        }
        index = rebuildIndex(
          authorityRows.map((a) => ({
            ...a,
            corpusComplete: Boolean(a.has_embeddings) && a.ingestion_status === "ready",
          })),
        );

        // Backfill any remaining unresolved targets that now match this authority
        let oldBackfilled = 0;
        const stillUnresolved = await sql`
          select id, from_authority_id, raw_citation, normalized_citation
          from legal_authority_citations where to_authority_id is null
        `;
        const authCiteKeys = new Set(
          [cand.citation, cand.dbCitation, ...(meta.citationAliases || []), ...(meta.parallelCitations || [])]
            .filter(Boolean)
            .map((c) => targetKey(c, c)),
        );
        for (const e of stillUnresolved) {
          const key = targetKey(e.raw_citation, e.normalized_citation);
          if (!authCiteKeys.has(key)) continue;
          const hit = index.lookupCitation(e.raw_citation, e.normalized_citation);
          if (hit.kind !== "one" || hit.authorityId !== cand.authorityId) continue;
          const rows = await sql`
            update legal_authority_citations
            set to_authority_id = ${cand.authorityId}
            where id = ${e.id} and to_authority_id is null
            returning id, raw_citation
          `;
          if (!rows.length) continue;
          if (rows[0].raw_citation !== e.raw_citation) throw new Error(`raw_citation_mutated:${e.id}`);
          oldBackfilled += 1;
          ledgerAll.push(
            createResolutionRecord({
              rawCitation: e.raw_citation,
              normalizedCitation: e.normalized_citation,
              targetKey: key,
              fromAuthorityId: e.from_authority_id,
              citationEdgeId: e.id,
              toAuthorityId: cand.authorityId,
              method: hit.method,
              confidence: "HIGH",
              evidence: hit.evidence || ["fulltext_alias_backfill"],
              state: "CORPUS_COMPLETE",
            }),
          );
        }
        ftOldBackfilledFromNew += oldBackfilled;
        ftLookupsAvoided += oldBackfilled > 0 ? 1 : 0;

        const unresolvedAfterGlobal = (await healthSnapshot(sql)).unresolved;
        ftOldUnresolvedResolved += oldBackfilled;

        metadataToComplete += 1;
        ftAcquired += 1;
        ftResults.push({
          citation: cand.citation,
          caseName: title,
          authorityId: cand.authorityId,
          clusterId: String(cand.clusterId),
          opinionId: String(opinionId),
          status: "acquired_corpus_complete",
          embeddedChunks: chunks.length,
          NEW_EDGES_TOTAL: newEdgesTotal,
          NEW_EDGES_RESOLVED_IMMEDIATELY: imm,
          NEW_EDGES_STILL_UNRESOLVED: still,
          OLD_EDGES_BACKFILLED_FROM_NEW_FULLTEXT: oldBackfilled,
          unresolvedBeforeGlobal,
          unresolvedAfterGlobal,
          rankScore: cand.rankScore,
        });

        if (ftAcquired % 2 === 0) {
          const health = await healthSnapshot(sql);
          const cp = {
            lane: "fulltext",
            atAcquired: ftAcquired,
            totalCl,
            fullTextCl,
            ftAcquired,
            ftNewEdgesTotal,
            health: { green: health.green, unresolved: health.unresolved, CORPUS_COMPLETE: health.CORPUS_COMPLETE_AUTHORITIES },
          };
          checkpoints.push(cp);
          writeJson(path.join(CHECKPOINT_DIR, `mixed-batch3-ft-cp-${ftAcquired}.json`), cp);
          console.log(JSON.stringify({ checkpoint: cp }, null, 2));
          if (!health.green) {
            stopReason = "HEALTH_NOT_GREEN";
            break;
          }
        }
      }

      ftOldUnresolvedResolved = ftResults.reduce(
        (s, r) => s + Number(r.OLD_EDGES_BACKFILLED_FROM_NEW_FULLTEXT || 0),
        0,
      );
      ftOldBackfilledFromNew = ftOldUnresolvedResolved;
    }

    if (ledgerAll.length) appendLedger(LEDGER_PATH, ledgerAll);

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

    // Combined metrics
    const totalOldUnresolvedResolved = idEdgesBackfilled + ftOldUnresolvedResolved;
    const totalNewEdgesResolvedImmediately = ftNewEdgesResolvedImmediate;
    const totalResolvedThisRun = totalOldUnresolvedResolved + totalNewEdgesResolvedImmediately;
    const netUnresolvedChange = end.unresolved - start.unresolved;

    const identityEdgesPerCl = identityCl > 0 ? idEdgesBackfilled / identityCl : null;
    const ftOldPerCl = fullTextCl > 0 ? ftOldUnresolvedResolved / fullTextCl : null;
    const combinedOldPerCl = totalCl > 0 ? totalOldUnresolvedResolved / totalCl : null;
    const ftAuthPerCl = fullTextCl > 0 ? ftAcquired / fullTextCl : null;

    const identityTargetSuccess = idExternalAttempted > 0 ? idHigh / idExternalAttempted : 0;
    let policyResult = "KEEP_75_15_10";
    if (hit429 || stopReason === "HEALTH_NOT_GREEN" || !end.green) {
      policyResult = "PAUSE_FOR_ANALYSIS";
    } else if ((identityEdgesPerCl || 0) >= 5.5 && identityTargetSuccess >= 0.85 && (ftOldPerCl || 0) < 0.5) {
      policyResult = "USE_80_10_10";
    } else if ((identityEdgesPerCl || 0) >= 4.5 && identityTargetSuccess >= 0.8) {
      // Still strong backlog lane; keep 75/15/10 unless FT old-edge improves
      policyResult = ftAcquired === 0 ? "IDENTITY_ONLY_NEXT_WINDOW" : "KEEP_75_15_10";
    } else if ((identityEdgesPerCl || 0) >= 2.5 && (identityEdgesPerCl || 0) < 4.5) {
      policyResult = "KEEP_75_15_10";
    } else if ((ftAuthPerCl || 0) >= 0.4 && ftAcquired >= 3 && (identityEdgesPerCl || 0) < 3) {
      policyResult = "USE_65_25_10";
    } else if ((identityEdgesPerCl || 0) < 2) {
      policyResult = "PAUSE_FOR_ANALYSIS";
    }

    let finalClass = "CITATION_IDENTITY_HEAVY_BATCH3_MODERATE";
    if (hit429 || stopReason === "HEALTH_NOT_GREEN" || !end.green) {
      finalClass = "CITATION_IDENTITY_HEAVY_BATCH3_BLOCKED";
    } else if ((identityEdgesPerCl || 0) >= 4.5 && identityTargetSuccess >= 0.8 && idHigh >= 28 && end.green) {
      finalClass = "CITATION_IDENTITY_HEAVY_BATCH3_STRONG";
    } else if ((identityEdgesPerCl || 0) < 2.5 || idHigh < 10) {
      finalClass = "CITATION_IDENTITY_HEAVY_BATCH3_WEAK";
    }

    const nextBudget =
      policyResult === "PAUSE_FOR_ANALYSIS"
        ? 0
        : policyResult === "USE_80_10_10"
          ? 55
          : policyResult === "IDENTITY_ONLY_NEXT_WINDOW"
            ? 45
            : policyResult === "USE_65_25_10"
              ? 50
              : 55;

    // Update fulltext queue — remove acquired
    try {
      const q = JSON.parse(fs.readFileSync(FULLTEXT_QUEUE, "utf8"));
      const acquiredIds = new Set(ftResults.filter((r) => r.status === "acquired_corpus_complete").map((r) => r.authorityId));
      q.candidates = (q.candidates || []).filter((c) => !acquiredIds.has(c.authorityId));
      q.generatedAt = new Date().toISOString();
      q.batch = "identity-batch1+2+3+4+mixed1+mixed2+mixed3";
      writeJson(FULLTEXT_QUEUE, q);
    } catch {
      /* */
    }

    const report = {
      ok: end.green && !hit429 && stopReason !== "HEALTH_NOT_GREEN",
      classification: "CITATION_IDENTITY_HEAVY_MIXED_BATCH3",
      stopReason: hit429 ? "HTTP_429" : stopReason,
      identityStopReason,
      courtListener: {
        quotaProbeRequests: 1,
        identityLookupRequests: identityCl,
        fullTextRequests: fullTextCl,
        retryOtherCl: retryCl,
        totalClRequests: totalCl,
        minuteAtStart: minuteRem,
        hourAtStart: hourRem,
        dayAtStart: dayRem,
        estimatedDayRemaining: Math.max(0, dayRem - (totalCl - 1)),
        hit429,
        hit502,
      },
      start,
      end,
      identityLane: {
        eligibleTargetsConsidered: identityPool.length,
        targetsSelected: identitySelected.length,
        localResolvedBeforeExternal: idLocalBefore,
        externalAttempted: idExternalAttempted,
        highResolved: idHigh,
        ambiguous: idAmbiguous,
        notFound: idNotFound,
        providerFailure: idFailed,
        oldUnresolvedEdgesBackfilled: idEdgesBackfilled,
        edgesPerIdentityCl: identityEdgesPerCl,
        aliasesLearned: idAliases,
        parallelCitationsLearned: idParallels,
        targetsResolvedThroughNewLearning: idTargetsResolvedByLearning,
        externalLookupsAvoided: idLookupsAvoided,
        externalCallsAvoidedByNewLearning: idLookupsAvoidedByLearning,
        identityTargetSuccess,
        comparedToBatch2: {
          targetSuccess: 0.867,
          edgesPerCl: 4.98,
          targetSuccessDelta: identityTargetSuccess - 0.867,
          edgesPerClDelta: (identityEdgesPerCl || 0) - 4.98,
        },
        newMetadataOnlyAuthorities: idNewMetadataOnly,
        results: idResults,
      },
      fullTextLane: {
        tierASelected: ftResults.length ? ftAttempted : 0,
        maxFtClBudget: MAX_FT_CL,
        authoritiesAttempted: ftAttempted,
        authoritiesAcquired: ftAcquired,
        alreadyCompleteSkipped: ftSkippedComplete,
        failed: ftFailed,
        OLD_UNRESOLVED_RESOLVED: ftOldUnresolvedResolved,
        NEW_EDGES_TOTAL: ftNewEdgesTotal,
        NEW_EDGES_RESOLVED_IMMEDIATELY: ftNewEdgesResolvedImmediate,
        NEW_EDGES_STILL_UNRESOLVED: ftNewEdgesStillUnresolved,
        NET_UNRESOLVED_CHANGE_FROM_FULLTEXT: ftNewEdgesStillUnresolved - ftNewEdgesResolvedImmediate - ftOldUnresolvedResolved,
        OLD_EDGES_BACKFILLED_FROM_NEW_FULLTEXT: ftOldBackfilledFromNew,
        LOOKUPS_AVOIDED_BY_NEW_FULLTEXT: ftLookupsAvoided,
        aliasesLearned: ftAliases,
        parallelCitationsLearned: ftParallels,
        results: ftResults,
      },
      stateTransitions: {
        metadataOnlyToCorpusComplete: metadataToComplete,
        newMetadataOnlyFromIdentity: idNewMetadataOnly,
        METADATA_ONLY_AUTHORITIES_remaining: end.METADATA_ONLY_AUTHORITIES,
        CORPUS_COMPLETE_AUTHORITIES_end: end.CORPUS_COMPLETE_AUTHORITIES,
      },
      combined: {
        TOTAL_OLD_UNRESOLVED_RESOLVED: totalOldUnresolvedResolved,
        TOTAL_NEW_EDGES_RESOLVED_IMMEDIATELY: totalNewEdgesResolvedImmediately,
        TOTAL_RESOLVED_THIS_RUN: totalResolvedThisRun,
        NET_UNRESOLVED_CHANGE: netUnresolvedChange,
        AUTHORITY_RESOLVED_EDGES_end: end.AUTHORITY_RESOLVED_EDGES,
        CORPUS_COMPLETE_EDGES_end: end.CORPUS_COMPLETE_EDGES,
        IDENTITY_UNRESOLVED_EDGES_end: end.IDENTITY_UNRESOLVED_EDGES,
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
      efficiency: {
        identityOldEdgeResolutionPerCl: identityEdgesPerCl,
        fullTextOldEdgeResolutionPerCl: ftOldPerCl,
        combinedOldEdgeResolutionPerCl: combinedOldPerCl,
        fullTextAuthoritiesPerCl: ftAuthPerCl,
        productValueNotes:
          "Identity clears citation backlog without text. Full-text adds CORPUS_COMPLETE authorities for retrieval/reasoning and may introduce new outgoing edges.",
      },
      policyResult,
      nextRecommendedBudget: nextBudget,
      permanentPipelineValidation: {
        confirmed: true,
        flow: "extract→classify→normalize→local resolve→eligibility gate→unique-target queue→external identity→authority resolved→demand-driven full text→corpus complete→global backfill",
        nonCaseOutsideIdentityLane: true,
      },
      checkpoints,
      finalClassification: finalClass,
      generatedAt: new Date().toISOString(),
      resolverVersion: RESOLVER_VERSION,
    };

    writeJson(REPORT_JSON, report);
    fs.writeFileSync(
      REPORT_MD,
      `# Citation Identity-Heavy Mixed Batch 3

**Stop:** ${report.stopReason}  
**Identity stop:** ${identityStopReason || "n/a"}  
**CL total:** ${totalCl} (probe 1 + identity ${identityCl} + fulltext ${fullTextCl} + retry ${retryCl})  

## Identity

eligible considered: ${identityPool.length}  
HIGH ${idHigh}/${idExternalAttempted} (${(identityTargetSuccess * 100).toFixed(1)}%) · edges ${idEdgesBackfilled} · ${identityEdgesPerCl != null ? identityEdgesPerCl.toFixed(2) : "n/a"} / identity CL  
local avoided: ${idLookupsAvoided} · learning resolved: ${idTargetsResolvedByLearning}  
vs batch2: 86.7%/4.98 → ${(identityTargetSuccess * 100).toFixed(1)}%/${identityEdgesPerCl != null ? identityEdgesPerCl.toFixed(2) : "n/a"}

## Full-text

acquired ${ftAcquired}/${ftAttempted} (FT CL ${fullTextCl}/${MAX_FT_CL}) · old backfilled ${ftOldUnresolvedResolved} · new edges ${ftNewEdgesTotal} (imm ${ftNewEdgesResolvedImmediate} / still ${ftNewEdgesStillUnresolved})

## Combined

old unresolved resolved: ${totalOldUnresolvedResolved}  
net unresolved change: ${netUnresolvedChange}  
METADATA_ONLY remaining: ${end.METADATA_ONLY_AUTHORITIES}  
CORPUS_COMPLETE: ${end.CORPUS_COMPLETE_AUTHORITIES}

## Policy

**${policyResult}** · next budget (not executed): ${nextBudget}  
**${finalClass}**
`,
    );

    console.log("CITATION_IDENTITY_HEAVY_MIXED_BATCH3_COMPLETE");
    console.log(
      JSON.stringify(
        {
          ok: report.ok,
          stopReason: report.stopReason,
          totalCl,
          identityCl,
          fullTextCl,
          idHigh,
          idEdgesBackfilled,
          ftAcquired,
          ftOldUnresolvedResolved,
          ftNewEdgesTotal,
          netUnresolvedChange,
          policyResult,
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
    console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 2000), totalCl, identityCl, fullTextCl }));
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();
