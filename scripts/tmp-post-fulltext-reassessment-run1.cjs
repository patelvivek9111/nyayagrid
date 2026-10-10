/**
 * Post-fulltext queue reassessment + adaptive full safe-hour CL run.
 * Phase 1: offline queue rebuild + local-first (no CL).
 * Phase 2: one quota probe + adaptive identity and/or high-value fulltext.
 * No markdown. Neon production only. Bulk 3/2/1-edge disabled.
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
  targetKey,
  experimentalNormalize,
  parseCitationLookupResponse,
  createResolutionRecord,
  appendLedger,
  loadLedger,
  RESOLVER_VERSION,
} = require("../packages/research/src/corpus/citation-resolution/cjs-bridge.cjs");

let TOTAL_CL_CAP = 270;
let MAX_IDENTITY = 250;
let MAX_FT_CL = 30;
const RATE_MS = 4000;
const CL_BASE = "https://www.courtlistener.com/api/rest/v4";
const SOURCE = "courtlistener";
const BATCH = "post-fulltext-reassessment-run1";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS = 384;
const MAX_OPINION_CHARS = 40_000;
const MAX_CHUNK_CHARS = 1000;
const OLD_PROGRESS_BEFORE = 2979; // 2969 + 10 from FT run
const WEEKEND_TARGET = 15000;

const ROOT = path.join(__dirname, "..");
const CHECKPOINT_DIR = path.join(ROOT, "packages/research/corpus/resolution/checkpoints");
const LEDGER_PATH = path.join(ROOT, "packages/research/corpus/resolution/ledger/cl-post-fulltext-reassessment-run1-2026-10-10.jsonl");
const REPORT_JSON = path.join(ROOT, "packages/research/corpus/reports/post-fulltext-reassessment-run1-2026-10-10.json");
const QUEUE_JSON = path.join(ROOT, "packages/research/corpus/resolution/post-fulltext-queue-rebuild-2026-10-10.json");
const FT_REPORT = path.join(ROOT, "packages/research/corpus/reports/corpus-high-value-fulltext-run1-2026-10-10.json");
const RUN_START_LOCAL = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });

const BENCHMARK_RE =
  /\b(twombly|iqbal|miranda|brady|giglio|strickland|terry|katz|carpenter|riley|mapp|gideon|chevron|lujan|monell|monroe|parratt|mathews|daubert|celotex|heck|bivens|qualified immunity|standing|pleadings?|summary judgment)\b/i;

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
  for (let i = 0; i < texts.length; i += 32) out.push(...(await embedBatch(texts.slice(i, i + 32), apiKey)));
  return out;
}

async function probeQuota(apiKey) {
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
            remaining: Number(p.remaining ?? (p.limit != null && p.usage != null ? Number(p.limit) - Number(p.usage) : null)),
          });
        }
        continue;
      }
      const periodRaw = String(row.period || row.window || row.rate || row.name || "").toLowerCase();
      const period = periodRaw.includes("min") ? "minute" : periodRaw.includes("hour") ? "hour" : periodRaw.includes("day") ? "day" : null;
      out.push({
        period,
        remaining: Number(row.remaining ?? (row.limit != null && row.usage != null ? Number(row.limit) - Number(row.usage) : null)),
      });
    }
    return out;
  }
  let rows = [];
  if (Array.isArray(current)) {
    const userish = current.filter((x) => String(x.scope || x.throttle || x.name || "").toLowerCase().includes("user"));
    rows = normalizeRows(userish.length ? userish : current);
  } else if (current && typeof current === "object") rows = normalizeRows(current.user || current);
  const byPeriod = {};
  for (const row of rows) if (row.period) byPeriod[row.period] = row;
  return {
    ok: res.ok,
    membership: { level: membership?.level || membership?.name || null, is_active: membership?.is_active ?? null },
    minute: byPeriod.minute || null,
    hour: byPeriod.hour || null,
    day: byPeriod.day || null,
  };
}

async function authorityCompleteness(sql) {
  const [row] = await sql`
    select
      count(*)::int as total_canonical_authorities,
      count(*) filter (where authority_type='case')::int as case_typed_authorities,
      count(*) filter (
        where authority_type='case' and ingestion_status='ready'
          and exists (select 1 from legal_authority_chunks c where c.authority_id=legal_authorities.id and c.embedding is not null)
      )::int as corpus_complete_authorities,
      count(*) filter (
        where authority_type='case' and (
          ingestion_status is distinct from 'ready'
          or not exists (select 1 from legal_authority_chunks c where c.authority_id=legal_authorities.id and c.embedding is not null)
        )
      )::int as metadata_only_authorities,
      count(*) filter (where authority_type='case' and ingestion_status='ready')::int as full_text_ready_authorities,
      count(*) filter (
        where exists (select 1 from legal_authority_chunks c where c.authority_id=legal_authorities.id and c.embedding is not null)
      )::int as embedded_authorities
    from legal_authorities
  `;
  const [edges] = await sql`
    select
      count(*) filter (where to_authority_id is not null)::int as authority_resolved_edges,
      count(*) filter (
        where to_authority_id is not null and a.ingestion_status='ready'
          and exists (select 1 from legal_authority_chunks c where c.authority_id=a.id and c.embedding is not null)
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

function loadFtAuthIds() {
  try {
    const r = JSON.parse(fs.readFileSync(FT_REPORT, "utf8"));
    return new Set((r.results || []).filter((x) => x.status === "acquired_corpus_complete" && x.authorityId).map((x) => x.authorityId));
  } catch {
    return new Set();
  }
}

function isHostile(cite) {
  const c = String(cite || "");
  if (/\bPage\s+\d+\b/i.test(c)) return true;
  if (/^\d{4}\s+Page\b/i.test(c)) return true;
  if (!/[A-Za-z]/.test(c)) return true;
  return false;
}

function strategicScore(t) {
  const edges = Number(t.edgeCount || 0);
  const citing = Number(t.uniqueCitingCases || t.citingCaseCount || 0);
  const j = (t.jurisdictions || []).join(" ").toLowerCase();
  let score = edges * 10 + citing * 2;
  if (edges >= 5) score += 40;
  if (edges === 4) score += 25;
  if (/us-ca-3|ca3/.test(j)) score += 40;
  if (/us-d-pa|paed|edpa/.test(j)) score += 35;
  if (/st-pa|pennsylvania/.test(j)) score += 25;
  if (/us-scotus|scotus/.test(j)) score += 30;
  const cite = String(t.normalizedCitation || t.representativeRaw || "");
  if (/\bU\.S\.\b|\bS\.\s*Ct\b|\bF\.(?:2d|3d|4th)\b|\bF\.\s*Supp|Wall\.?|How\.?|Cranch|Pet\./i.test(cite)) score += 12;
  if (/\bA\.(?:2d|3d)\b|\bPa\.?\b/i.test(cite)) score += 8;
  return score;
}

function qualityTier(t) {
  const cite = String(t.normalizedCitation || t.representativeRaw || "");
  const j = (t.jurisdictions || []).join(" ").toLowerCase();
  const citing = Number(t.uniqueCitingCases || t.citingCaseCount || 0);
  const score = strategicScore(t);
  const strongReporter = /\bU\.S\.\b|\bS\.\s*Ct\b|\bF\.(?:2d|3d|4th)\b|\bF\.\s*Supp|Wall\.?|How\.?|Cranch|Pet\.|\bA\.(?:2d|3d)\b|\bPa\.?\b/i.test(cite);
  const highJuris = /us-scotus|us-ca-3|ca3|us-d-pa|paed|edpa|st-pa|pennsylvania/.test(j);
  if (isHostile(cite) || (!strongReporter && score < 40)) return "C";
  if (strongReporter && (highJuris || citing >= 3 || score >= 70 || t.edgeCount >= 5)) return "A";
  if (strongReporter || score >= 55) return "B";
  return "C";
}

function pickOpinionId(cluster) {
  const opinions = Array.isArray(cluster.sub_opinions) ? cluster.sub_opinions : Array.isArray(cluster.opinions) ? cluster.opinions : [];
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

function scoreMoAuth(row) {
  const cite = String(row.citation || "");
  const title = String(row.title || "");
  const inbound = Number(row.inbound || 0);
  const uniqueCiters = Number(row.unique_citers || 0);
  const ca3 = Number(row.ca3_citers || 0);
  const edpa = Number(row.edpa_citers || 0);
  const pa = Number(row.pa_citers || 0);
  let score = inbound * 2 + uniqueCiters * 4;
  let bucket = "OTHER";
  if (/\bU\.?\s*S\.?\b/i.test(cite) || /\bS\.?\s*Ct\b/i.test(cite) || /Wall\.|How\.|Cranch|Pet\./i.test(cite)) {
    score += 100;
    bucket = "SCOTUS";
  } else if (/\bF\.\s*(2d|3d|4th)\b/i.test(cite)) {
    score += 40;
    bucket = ca3 >= 2 ? "CA3" : "OTHER_FEDERAL";
  } else if (/\bF\.\s*Supp/i.test(cite)) {
    score += 30;
    bucket = edpa >= 1 ? "EDPA" : "OTHER_FEDERAL";
  } else if (/\bA\.\s*(2d|3d)\b/i.test(cite) || /\bPa\b/i.test(cite)) {
    score += 50;
    bucket = "PA";
  }
  if (bucket === "CA3") score += 45;
  if (bucket === "EDPA") score += 40;
  if (bucket === "PA") score += 35;
  score += Math.min(40, ca3 * 4 + edpa * 5 + pa * 4);
  if (BENCHMARK_RE.test(title) || BENCHMARK_RE.test(cite)) score += 35;
  const tier = score >= 110 || (bucket === "SCOTUS" && inbound >= 3) || ca3 + edpa + pa >= 4 ? "A" : score >= 70 ? "B" : "C";
  return { ...row, clusterId: String(row.source_external_id || "").replace(/^cl-cluster-/, ""), courtBucket: bucket, productScore: score, qualityTier: tier };
}

async function main() {
  const apiKey = process.env.COURTLISTENER_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const url = process.env.DATABASE_URL?.trim();
  if (!apiKey || !openaiKey) {
    console.log(JSON.stringify({ ok: false, reason: "missing API keys" }));
    process.exit(2);
  }
  if (!url || /localhost|127\.0\.0\.1|:5433/i.test(url)) {
    console.log(JSON.stringify({ ok: false, reason: "need Neon DATABASE_URL" }));
    process.exit(2);
  }

  const ftAuthIds = loadFtAuthIds();
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 30, connect_timeout: 60 });
  let totalCl = 0;
  let identityCl = 0;
  let fullTextCl = 0;
  let retryCl = 0;
  let lastAt = 0;
  let hit429 = false;
  let hit502 = 0;
  let stopReason = "BATCH_COMPLETE";
  let minuteRem = null;
  let hourRem = null;
  let dayRem = null;
  let quotaProbed = false;

  const ledgerAll = [];
  const checkpoints = [];
  const idResults = [];
  const ftResults = [];
  const rollingIdentity = [];

  let localTargets = 0;
  let localEdges = 0;
  let localOld = 0;
  let localNew = 0;
  let aliasesUsed = 0;
  let parallelsUsed = 0;
  let idAttempted = 0;
  let idHigh = 0;
  let idAmb = 0;
  let idNf = 0;
  let idFail = 0;
  let idOld = 0;
  let idNew = 0;
  let idAliases = 0;
  let idParallels = 0;
  let ftAttempted = 0;
  let ftAcquired = 0;
  let ftFailed = 0;
  let ftOld = 0;
  let ftNewEdges = 0;
  let ftNewImm = 0;
  let ftNewStill = 0;
  let ftJuris = { SCOTUS: 0, CA3: 0, EDPA: 0, PA: 0, OTHER_FEDERAL: 0, OTHER: 0 };

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
      if (totalCl < TOTAL_CL_CAP && hit502 < 4) {
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

  function isNewEdge(fromAuthorityId) {
    return ftAuthIds.has(fromAuthorityId);
  }

  async function resolveEdgeRow(e, authorityId, method, evidence, corpusComplete) {
    const rows = await sql`
      update legal_authority_citations
      set to_authority_id = ${authorityId}
      where id = ${e.id} and to_authority_id is null
      returning id, raw_citation
    `;
    if (!rows.length) return 0;
    if (rows[0].raw_citation !== e.raw_citation) throw new Error(`raw_citation_mutated:${e.id}`);
    ledgerAll.push(
      createResolutionRecord({
        rawCitation: e.raw_citation,
        normalizedCitation: e.normalized_citation,
        targetKey: targetKey(e.raw_citation, e.normalized_citation),
        fromAuthorityId: e.from_authority_id,
        citationEdgeId: e.id,
        toAuthorityId: authorityId,
        method,
        confidence: "HIGH",
        evidence: evidence || [method],
        state: corpusComplete ? "CORPUS_COMPLETE" : "AUTHORITY_RESOLVED",
      }),
    );
    return 1;
  }

  async function backfillKey(key, authorityId, method, evidence, corpusComplete) {
    const unresolved = await sql`
      select id, from_authority_id, raw_citation, normalized_citation
      from legal_authority_citations where to_authority_id is null
    `;
    let oldN = 0;
    let newN = 0;
    for (const e of unresolved) {
      if (targetKey(e.raw_citation, e.normalized_citation) !== key) continue;
      const n = await resolveEdgeRow(e, authorityId, method, evidence, corpusComplete);
      if (!n) continue;
      if (isNewEdge(e.from_authority_id)) newN += 1;
      else oldN += 1;
    }
    return { oldN, newN, total: oldN + newN };
  }

  try {
    const start = await healthSnapshot(sql);
    console.log(JSON.stringify({ phase: "PRECHECK_STATE", start: {
      AUTHORITY_RESOLVED_EDGES: start.AUTHORITY_RESOLVED_EDGES,
      CORPUS_COMPLETE_EDGES: start.CORPUS_COMPLETE_EDGES,
      IDENTITY_UNRESOLVED_EDGES: start.IDENTITY_UNRESOLVED_EDGES,
      TOTAL_CANONICAL_AUTHORITIES: start.TOTAL_CANONICAL_AUTHORITIES,
      METADATA_ONLY_AUTHORITIES: start.METADATA_ONLY_AUTHORITIES,
      CORPUS_COMPLETE_AUTHORITIES: start.CORPUS_COMPLETE_AUTHORITIES,
      FULL_TEXT_READY_AUTHORITIES: start.FULL_TEXT_READY_AUTHORITIES,
      EMBEDDED_AUTHORITIES: start.EMBEDDED_AUTHORITIES,
      green: start.green,
    } }, null, 2));
    if (!start.green) {
      console.log(JSON.stringify({ ok: false, stopReason: "START_HEALTH_NOT_GREEN", classification: "POST_FULLTEXT_CORPUS_REASSESSMENT_RUN" }));
      process.exit(3);
    }

    // ========== PHASE 1: OFFLINE QUEUE REBUILD + LOCAL-FIRST ==========
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
             exists(select 1 from legal_authority_chunks c where c.authority_id=legal_authorities.id and c.embedding is not null) as has_embeddings
      from legal_authorities
    `;
    await sql.unsafe("COMMIT");

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

    const buckets = {
      ge10: { targets: 0, edges: 0 },
      e5to9: { targets: 0, edges: 0 },
      e4: { targets: 0, edges: 0 },
      e3: { targets: 0, edges: 0 },
      e2: { targets: 0, edges: 0 },
      e1: { targets: 0, edges: 0 },
      ineligible: { targets: 0, edges: 0 },
    };
    for (const t of queue.targets) {
      const el = classifyCaseCitationLookupEligibility(t.representativeRaw, t.normalizedCitation);
      const hostile = isHostile(t.normalizedCitation || t.representativeRaw);
      const edges = Number(t.edgeCount || 0);
      if (!el.eligible || hostile) {
        buckets.ineligible.targets += 1;
        buckets.ineligible.edges += edges;
        continue;
      }
      const b =
        edges >= 10 ? buckets.ge10 : edges >= 5 ? buckets.e5to9 : edges === 4 ? buckets.e4 : edges === 3 ? buckets.e3 : edges === 2 ? buckets.e2 : buckets.e1;
      b.targets += 1;
      b.edges += edges;
    }

    console.log(JSON.stringify({ phase: "QUEUE_REBUILD", buckets, totalTargets: queue.targets.length }, null, 2));

    // Local-first: resolve every unresolved edge with deterministic single match
    const unresolvedLive = await sql`
      select id, from_authority_id, raw_citation, normalized_citation
      from legal_authority_citations where to_authority_id is null
    `;
    const localByTarget = new Map();
    for (const e of unresolvedLive) {
      const hit = index.lookupCitation(e.raw_citation, e.normalized_citation);
      if (hit.kind !== "one") continue;
      const auth = authorityRows.find((a) => a.id === hit.authorityId);
      const corpusComplete = Boolean(auth?.has_embeddings) && auth?.ingestion_status === "ready";
      const n = await resolveEdgeRow(e, hit.authorityId, hit.method, hit.evidence, corpusComplete);
      if (!n) continue;
      localEdges += 1;
      if (isNewEdge(e.from_authority_id)) localNew += 1;
      else localOld += 1;
      const key = targetKey(e.raw_citation, e.normalized_citation);
      if (!localByTarget.has(key)) localByTarget.set(key, hit.method);
      if (String(hit.method || "").includes("ALIAS")) aliasesUsed += 1;
      if (String(hit.method || "").includes("PARALLEL")) parallelsUsed += 1;
    }
    localTargets = localByTarget.size;

    console.log(
      JSON.stringify({
        phase: "LOCAL_FIRST",
        localTargets,
        localEdges,
        localOld,
        localNew,
        aliasesUsed,
        parallelsUsed,
        clAvoided: localTargets,
      }),
      null,
      2,
    );

    // Rebuild queue after local
    const unresolvedAfterLocal = await sql`
      select e.id, e.from_authority_id, e.raw_citation, e.normalized_citation, e.created_at,
             a.court_id as from_court_id, a.court as from_court
      from legal_authority_citations e
      left join legal_authorities a on a.id = e.from_authority_id
      where e.to_authority_id is null
    `;
    index = rebuildIndex(
      authorityRows.map((a) => ({ ...a, corpusComplete: Boolean(a.has_embeddings) && a.ingestion_status === "ready" })),
    );
    const queue2 = buildUnresolvedTargetQueue(
      unresolvedAfterLocal.map((e) => ({
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

    function eligibleExternal(t, minEdges, maxEdges) {
      if (t.localCandidateStatus !== "NO_LOCAL_MATCH") return false;
      if (t.edgeCount < minEdges || t.edgeCount > maxEdges) return false;
      if (isHostile(t.normalizedCitation || t.representativeRaw)) return false;
      const el = classifyCaseCitationLookupEligibility(t.representativeRaw, t.normalizedCitation);
      return Boolean(el.eligible);
    }

    const ge5 = queue2.targets
      .filter((t) => eligibleExternal(t, 5, 999))
      .map((t) => ({ ...t, strategicScore: strategicScore(t), qualityTier: qualityTier(t) }))
      .filter((t) => t.qualityTier === "A" || t.qualityTier === "B")
      .sort((a, b) => b.edgeCount - a.edgeCount || b.strategicScore - a.strategicScore);

    const edge4 = queue2.targets
      .filter((t) => eligibleExternal(t, 4, 4))
      .map((t) => ({ ...t, strategicScore: strategicScore(t), qualityTier: qualityTier(t) }))
      .filter((t) => t.qualityTier === "A" || t.qualityTier === "B")
      .sort((a, b) => (a.qualityTier === "A" && b.qualityTier !== "A" ? -1 : a.qualityTier !== "A" && b.qualityTier === "A" ? 1 : b.strategicScore - a.strategicScore));

    // 3-edge: only materially stronger subset — SCOTUS/CA3/EDPA/PA + strong reporter + citing>=4 + Tier A
    const edge3Strong = queue2.targets
      .filter((t) => eligibleExternal(t, 3, 3))
      .map((t) => ({ ...t, strategicScore: strategicScore(t), qualityTier: qualityTier(t) }))
      .filter((t) => {
        if (t.qualityTier !== "A") return false;
        const j = (t.jurisdictions || []).join(" ").toLowerCase();
        const cite = String(t.normalizedCitation || "");
        const strongReporter = /\bU\.S\.\b|\bS\.\s*Ct\b|\bF\.(?:2d|3d|4th)\b|\bF\.\s*Supp/i.test(cite);
        const highJuris = /us-scotus|us-ca-3|ca3|us-d-pa|paed|edpa|st-pa|pennsylvania/.test(j);
        const citing = Number(t.uniqueCitingCases || t.citingCaseCount || 0);
        return strongReporter && highJuris && citing >= 4 && t.strategicScore >= 90;
      })
      .sort((a, b) => b.strategicScore - a.strategicScore);

    const materiallyImproved3 = edge3Strong.length >= 15; // require substantial different subpopulation

    let selectedLane = "NO_HIGH_VALUE_EXTERNAL_LANE";
    let laneReason = "";
    let identityPool = [];
    if (ge5.length > 0) {
      selectedLane = "LANE_A_GE5";
      laneReason = `fresh reporter-valid >=5 targets: ${ge5.length}`;
      identityPool = [...ge5, ...edge4.filter((t) => t.qualityTier === "A")];
    } else if (edge4.filter((t) => t.qualityTier === "A").length > 0) {
      selectedLane = "LANE_B_QUALITY_4";
      laneReason = `quality Tier-A 4-edge targets: ${edge4.filter((t) => t.qualityTier === "A").length}`;
      identityPool = edge4.filter((t) => t.qualityTier === "A" || t.qualityTier === "B");
    } else if (materiallyImproved3) {
      selectedLane = "LANE_C_STRATEGIC_3";
      laneReason = `materially stronger 3-edge subset (SCOTUS/CA3/EDPA/PA+citer>=4): ${edge3Strong.length}`;
      identityPool = edge3Strong;
    } else {
      selectedLane = "LANE_D_HIGH_VALUE_FULLTEXT";
      laneReason = `no efficient identity lane (ge5=${ge5.length}, q4A=${edge4.filter((t) => t.qualityTier === "A").length}, strong3=${edge3Strong.length}); prefer high-value fulltext`;
    }

    writeJson(QUEUE_JSON, {
      generatedAt: new Date().toISOString(),
      bucketsBeforeLocal: buckets,
      localFirst: { localTargets, localEdges, localOld, localNew, aliasesUsed, parallelsUsed },
      afterLocal: {
        ge5: ge5.length,
        edge4AB: edge4.length,
        edge4A: edge4.filter((t) => t.qualityTier === "A").length,
        edge3Strong: edge3Strong.length,
        materiallyImproved3,
      },
      selectedLane,
      laneReason,
      topGe5: ge5.slice(0, 15).map((t) => ({ citation: t.normalizedCitation, edges: t.edgeCount, tier: t.qualityTier, score: t.strategicScore })),
      top4: edge4.slice(0, 15).map((t) => ({ citation: t.normalizedCitation, edges: t.edgeCount, tier: t.qualityTier, score: t.strategicScore })),
    });

    console.log(JSON.stringify({ phase: "LANE_DECISION", selectedLane, laneReason, ge5: ge5.length, edge4AB: edge4.length, edge4A: edge4.filter((t) => t.qualityTier === "A").length, edge3Strong: edge3Strong.length, materiallyImproved3 }, null, 2));

    // ========== PHASE 2: ONE QUOTA PROBE ==========
    const quota = await probeQuota(apiKey);
    totalCl = 1;
    quotaProbed = true;
    minuteRem = Number(quota.minute?.remaining ?? 0);
    hourRem = Number(quota.hour?.remaining ?? 0);
    dayRem = Number(quota.day?.remaining ?? 0);
    console.log(JSON.stringify({ quotaGate: { minuteRem, hourRem, dayRem, membership: quota.membership } }, null, 2));

    if (!quota.ok || hourRem < 250) {
      stopReason = "HOURLY_WINDOW_NOT_READY_FOR_FULL_RUN";
      console.log(JSON.stringify({ ok: false, stopReason, classification: "POST_FULLTEXT_CORPUS_REASSESSMENT_RUN", courtListenerHttpCalls: totalCl }));
      // still write report below via early path
    } else if (dayRem < 250) {
      stopReason = "DAILY_CAPACITY_TOO_LOW_FOR_FULL_SAFE_RUN";
      console.log(JSON.stringify({ ok: false, stopReason, classification: "POST_FULLTEXT_CORPUS_REASSESSMENT_RUN", courtListenerHttpCalls: totalCl }));
    } else {
      if (hourRem >= 280 && dayRem >= 300) TOTAL_CL_CAP = Math.min(270, hourRem - 25);
      else TOTAL_CL_CAP = Math.min(270, Math.max(40, hourRem - 25), Math.max(40, dayRem - 50));

      const useIdentity = selectedLane.startsWith("LANE_A") || selectedLane.startsWith("LANE_B") || selectedLane.startsWith("LANE_C");
      if (useIdentity) {
        MAX_IDENTITY = Math.min(Math.floor(TOTAL_CL_CAP * 0.9) - 1, TOTAL_CL_CAP - 1);
        MAX_FT_CL = Math.min(20, TOTAL_CL_CAP - MAX_IDENTITY - 1);
      } else if (selectedLane === "LANE_D_HIGH_VALUE_FULLTEXT") {
        MAX_IDENTITY = 0;
        MAX_FT_CL = Math.min(TOTAL_CL_CAP - 1, Math.floor(TOTAL_CL_CAP * 0.9));
      } else {
        stopReason = "NO_HIGH_VALUE_EXTERNAL_LANE";
        MAX_IDENTITY = 0;
        MAX_FT_CL = 0;
      }
      console.log(JSON.stringify({ budget: { TOTAL_CL_CAP, MAX_IDENTITY, MAX_FT_CL, selectedLane, runStartLocal: RUN_START_LOCAL } }));

      const attemptedKeys = new Set();
      const resolvedKeys = new Set();

      // ---- IDENTITY LANE ----
      if (MAX_IDENTITY > 0 && identityPool.length && stopReason === "BATCH_COMPLETE") {
        for (const target of identityPool) {
          if (identityCl >= MAX_IDENTITY || totalCl >= TOTAL_CL_CAP) break;
          if (hit429) break;
          if (resolvedKeys.has(target.targetKey) || attemptedKeys.has(target.targetKey)) continue;

          // local-first again
          const localHit = index.lookupCitation(target.representativeRaw, target.normalizedCitation);
          if (localHit.kind === "one") {
            const auth = authorityRows.find((a) => a.id === localHit.authorityId);
            const corpusComplete = Boolean(auth?.has_embeddings) && auth?.ingestion_status === "ready";
            const bf = await backfillKey(target.targetKey, localHit.authorityId, localHit.method, localHit.evidence, corpusComplete);
            localTargets += 1;
            localEdges += bf.total;
            localOld += bf.oldN;
            localNew += bf.newN;
            resolvedKeys.add(target.targetKey);
            continue;
          }

          await rateWait();
          identityCl += 1;
          totalCl += 1;
          idAttempted += 1;
          attemptedKeys.add(target.targetKey);
          lastAt = Date.now();

          let callHigh = false;
          let callEdges = 0;
          let callAmb = false;
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
            if (res.status === 429) {
              hit429 = true;
              stopReason = "HTTP_429";
              idFail += 1;
              writeJson(path.join(CHECKPOINT_DIR, `post-ft-reassess-429-${Date.now()}.json`), { totalCl, identityCl, idHigh, idOld });
              break;
            }
            if (!res.ok) {
              idFail += 1;
              rollingIdentity.push({ high: false, edges: 0, ambiguous: false });
              continue;
            }
            const body = await res.json();
            const parsed = parseCitationLookupResponse(body, target.normalizedCitation || target.representativeRaw);
            if (parsed.status === "ambiguous" || parsed.ambiguous) {
              idAmb += 1;
              callAmb = true;
              idResults.push({ targetKey: target.targetKey, citation: target.normalizedCitation, edgeCount: target.edgeCount, status: "AMBIGUOUS" });
            } else if (parsed.status === "not_found" || !parsed.clusterId) {
              idNf += 1;
              idResults.push({ targetKey: target.targetKey, citation: target.normalizedCitation, edgeCount: target.edgeCount, status: "NOT_FOUND" });
            } else if (parsed.status === "resolved" && parsed.clusterId) {
              // ensure authority
              const clusterId = String(parsed.clusterId);
              const citations = parsed.citations || [];
              const primaryCite =
                citations.find((c) => targetKey(c, c) === target.targetKey) ||
                experimentalNormalize(target.normalizedCitation) ||
                target.normalizedCitation;
              const ext = `cl-cluster-${clusterId}`;
              let authorityId = null;
              let created = false;
              let corpusComplete = false;
              const byExt = await sql`
                select id, ingestion_status,
                  exists(select 1 from legal_authority_chunks c where c.authority_id=legal_authorities.id and c.embedding is not null) as has_embeddings
                from legal_authorities where source_provider=${SOURCE} and source_external_id=${ext} limit 2
              `;
              if (byExt.length > 1) {
                idAmb += 1;
                callAmb = true;
              } else if (byExt.length === 1) {
                authorityId = byExt[0].id;
                corpusComplete = Boolean(byExt[0].has_embeddings) && byExt[0].ingestion_status === "ready";
                const [full] = await sql`select metadata from legal_authorities where id=${authorityId}`;
                const meta = full?.metadata && typeof full.metadata === "object" ? { ...full.metadata } : {};
                const a0 = (meta.citationAliases || []).length;
                const p0 = (meta.parallelCitations || []).length;
                meta.citationAliases = [...new Set([...(meta.citationAliases || []), target.normalizedCitation, ...citations].filter(Boolean))].slice(0, 24);
                meta.parallelCitations = [...new Set([...(meta.parallelCitations || []), ...citations].filter(Boolean))].slice(0, 24);
                idAliases += Math.max(0, meta.citationAliases.length - a0);
                idParallels += Math.max(0, meta.parallelCitations.length - p0);
                await sql`update legal_authorities set metadata=${sql.json(meta)}, last_checked_at=now(), updated_at=now() where id=${authorityId}`;
              } else {
                authorityId = crypto.randomUUID();
                created = true;
                const aliasSet = [...new Set([target.normalizedCitation, target.representativeRaw, primaryCite, ...citations].filter(Boolean))].slice(0, 24);
                const parallelSet = citations.slice(0, 12);
                idAliases += aliasSet.length;
                idParallels += parallelSet.length;
                await sql`
                  insert into legal_authorities (
                    id, authority_type, jurisdiction, court, court_id, title, citation, normalized_citation,
                    decision_date, source_provider, source_external_id, canonical_source_url,
                    metadata, ingestion_status, created_at, updated_at, last_checked_at
                  ) values (
                    ${authorityId}, 'case', ${parsed.court ? "us" : null}, ${parsed.court || null}, ${null},
                    ${parsed.caseName || primaryCite}, ${primaryCite}, ${experimentalNormalize(primaryCite) || primaryCite},
                    ${parsed.dateFiled ? String(parsed.dateFiled).slice(0, 10) : null},
                    ${SOURCE}, ${ext},
                    ${`https://www.courtlistener.com/api/rest/v4/clusters/${clusterId}/`},
                    ${sql.json({
                      adapter: BATCH,
                      identityOnly: true,
                      corpusComplete: false,
                      clClusterId: clusterId,
                      parallelCitations: parallelSet,
                      citationAliases: aliasSet,
                      identityResolution: { method: "COURTLISTENER_CITATION_LOOKUP", clusterId, batch: BATCH, resolverVersion: RESOLVER_VERSION },
                    })},
                    'pending'::authority_ingestion_status, now(), now(), now()
                  )
                `;
                authorityRows.push({
                  id: authorityId,
                  citation: primaryCite,
                  normalized_citation: experimentalNormalize(primaryCite) || primaryCite,
                  metadata: { citationAliases: aliasSet, parallelCitations: parallelSet },
                  source_external_id: ext,
                  source_provider: SOURCE,
                  title: parsed.caseName,
                  court: parsed.court,
                  ingestion_status: "pending",
                  has_embeddings: false,
                });
              }
              if (authorityId && !callAmb) {
                index = rebuildIndex(
                  authorityRows.map((a) => ({
                    ...a,
                    corpusComplete: Boolean(a.has_embeddings) && a.ingestion_status === "ready",
                  })),
                );
                const bf = await backfillKey(
                  target.targetKey,
                  authorityId,
                  "COURTLISTENER_CITATION_LOOKUP",
                  [`cluster:${clusterId}`, "citation-lookup"],
                  corpusComplete,
                );
                idHigh += 1;
                callHigh = true;
                callEdges = bf.total;
                idOld += bf.oldN;
                idNew += bf.newN;
                resolvedKeys.add(target.targetKey);
                idResults.push({
                  targetKey: target.targetKey,
                  citation: target.normalizedCitation,
                  edgeCount: target.edgeCount,
                  status: "HIGH_RESOLVED",
                  authorityId,
                  created,
                  oldEdges: bf.oldN,
                  newEdges: bf.newN,
                });
              }
            } else {
              idNf += 1;
            }
          } catch (e) {
            idFail += 1;
            console.log(JSON.stringify({ identityError: String(e.message || e).slice(0, 200) }));
          }

          rollingIdentity.push({ high: callHigh, edges: callEdges, ambiguous: callAmb, oldEdges: callHigh ? callEdges : 0 });

          if (rollingIdentity.length >= 20) {
            const last20 = rollingIdentity.slice(-20);
            const high20 = last20.filter((x) => x.high).length / 20;
            const amb20 = last20.filter((x) => x.ambiguous).length / 20;
            const old20 = last20.reduce((s, x) => s + (x.oldEdges || (x.high ? x.edges : 0)), 0) / 20;
            // Approximate old yield: use idOld/identityCl when mixed; for gate use edges if mostly old lane
            const oldYield = identityCl > 0 ? idOld / identityCl : 0;
            if (high20 < 0.55 || amb20 > 0.3 || (oldYield < 2.5 && idOld >= idNew)) {
              stopReason = "IDENTITY_EFFICIENCY_STOP";
              console.log(JSON.stringify({ identityStop: stopReason, high20, amb20, oldYield }));
              break;
            }
          }

          if (identityCl % 20 === 0) {
            const health = await healthSnapshot(sql);
            const cp = {
              lane: "identity",
              atLookup: identityCl,
              totalCl,
              idHigh,
              idOld,
              idNew,
              edgesPerCl: identityCl > 0 ? (idOld + idNew) / identityCl : null,
              oldPerCl: identityCl > 0 ? idOld / identityCl : null,
              health: { green: health.green, unresolved: health.unresolved },
            };
            checkpoints.push(cp);
            writeJson(path.join(CHECKPOINT_DIR, `post-ft-reassess-id-cp-${identityCl}.json`), cp);
            console.log(JSON.stringify({ checkpoint: cp }, null, 2));
            if (!health.green) {
              stopReason = "HEALTH_NOT_GREEN";
              break;
            }
          }
        }
        if (stopReason === "BATCH_COMPLETE" && (identityCl >= MAX_IDENTITY || !identityPool.some((t) => !attemptedKeys.has(t.targetKey) && !resolvedKeys.has(t.targetKey)))) {
          if (identityCl > 0) stopReason = "IDENTITY_LANE_COMPLETE";
        }
      }

      // ---- FULLTEXT LANE (CASE 2 or leftover budget exceptional) ----
      // If identity collapses, reallocate remaining safe-hour budget to high-value fulltext
      if (
        !hit429 &&
        stopReason !== "HEALTH_NOT_GREEN" &&
        (stopReason === "IDENTITY_EFFICIENCY_STOP" || (stopReason === "IDENTITY_LANE_COMPLETE" && idHigh === 0))
      ) {
        MAX_FT_CL = Math.max(MAX_FT_CL, Math.min(TOTAL_CL_CAP - totalCl, Math.floor((TOTAL_CL_CAP - totalCl) * 0.9)));
        console.log(JSON.stringify({ reallocatedFtBudget: MAX_FT_CL, reason: stopReason, totalClSoFar: totalCl }));
      }

      const allowFt =
        !hit429 &&
        stopReason !== "HEALTH_NOT_GREEN" &&
        (selectedLane === "LANE_D_HIGH_VALUE_FULLTEXT" ||
          (MAX_FT_CL > 0 && (stopReason === "IDENTITY_LANE_COMPLETE" || stopReason === "IDENTITY_EFFICIENCY_STOP" || stopReason === "BATCH_COMPLETE")));

      if (allowFt && MAX_FT_CL >= 2 && totalCl + 2 <= TOTAL_CL_CAP) {
        if (selectedLane === "LANE_D_HIGH_VALUE_FULLTEXT" || stopReason === "IDENTITY_EFFICIENCY_STOP" || stopReason === "IDENTITY_LANE_COMPLETE") {
          // continue
        }
        const moRows = await sql`
          select a.id, a.citation, a.normalized_citation, a.title, a.court, a.court_id, a.decision_date,
                 a.source_external_id, a.metadata, a.ingestion_status,
                 (select count(*)::int from legal_authority_citations e where e.to_authority_id=a.id) as inbound,
                 (select count(distinct e.from_authority_id)::int from legal_authority_citations e where e.to_authority_id=a.id) as unique_citers,
                 (select count(*)::int from legal_authority_citations e join legal_authorities fa on fa.id=e.from_authority_id
                   where e.to_authority_id=a.id and (fa.court_id='us-ca-3' or fa.court ilike '%third circuit%')) as ca3_citers,
                 (select count(*)::int from legal_authority_citations e join legal_authorities fa on fa.id=e.from_authority_id
                   where e.to_authority_id=a.id and (fa.court_id in ('us-d-paed','paed') or fa.court ilike '%eastern%pennsylvania%')) as edpa_citers,
                 (select count(*)::int from legal_authority_citations e join legal_authorities fa on fa.id=e.from_authority_id
                   where e.to_authority_id=a.id and (fa.court_id like 'st-pa%' or fa.court ilike '%pennsylvania%')) as pa_citers
          from legal_authorities a
          where a.authority_type='case' and a.source_external_id like 'cl-cluster-%'
            and (a.ingestion_status is distinct from 'ready'
              or not exists (select 1 from legal_authority_chunks c where c.authority_id=a.id and c.embedding is not null))
        `;
        const tierA = moRows.map(scoreMoAuth).filter((t) => t.qualityTier === "A").sort((a, b) => b.productScore - a.productScore);
        console.log(JSON.stringify({ ftQueue: { metadataOnly: moRows.length, tierA: tierA.length, ftBudgetCl: MAX_FT_CL } }));

        for (const cand of tierA) {
          if (fullTextCl + 2 > MAX_FT_CL || totalCl + 2 > TOTAL_CL_CAP) {
            if (stopReason === "BATCH_COMPLETE" || stopReason === "IDENTITY_LANE_COMPLETE" || stopReason === "IDENTITY_EFFICIENCY_STOP") {
              stopReason = "QUOTA_SAFETY_THRESHOLD";
            }
            break;
          }
          if (hit429) break;

          const [row] = await sql`
            select id, citation, title, metadata, source_external_id, ingestion_status,
              exists(select 1 from legal_authority_chunks ch where ch.authority_id=legal_authorities.id and ch.embedding is not null) as has_embeddings
            from legal_authorities where id=${cand.id} limit 1
          `;
          if (!row || (row.ingestion_status === "ready" && row.has_embeddings)) continue;
          const clusterId = String(row.source_external_id).replace(/^cl-cluster-/, "");
          ftAttempted += 1;

          const clusterRes = await clGet(`/clusters/${clusterId}/`);
          fullTextCl += 1; // approximate; clGet already counted
          if (clusterRes.status === 429 || hit429) {
            hit429 = true;
            stopReason = "HTTP_429";
            ftFailed += 1;
            break;
          }
          if (!clusterRes.ok) {
            ftFailed += 1;
            continue;
          }
          const opinionId = pickOpinionId(clusterRes.body);
          if (!opinionId) {
            ftFailed += 1;
            continue;
          }
          const opRes = await clGet(`/opinions/${opinionId}/`);
          if (opRes.status === 429 || hit429) {
            hit429 = true;
            stopReason = "HTTP_429";
            ftFailed += 1;
            break;
          }
          if (!opRes.ok) {
            ftFailed += 1;
            continue;
          }
          const text = pickText(opRes.body);
          if (text.length < 80) {
            ftFailed += 1;
            continue;
          }

          const contentHash = sha256(text);
          const versionId = crypto.randomUUID();
          const [verRow] = await sql`select coalesce(max(version_number),0)::int as v from legal_authority_versions where authority_id=${cand.id}`;
          const nextVersion = Number(verRow.v) + 1;
          await sql`update legal_authority_versions set valid_to=now() where authority_id=${cand.id} and valid_to is null`;
          const title = clusterRes.body.case_name || clusterRes.body.case_name_full || cand.title || cand.citation;
          const decisionDate = clusterRes.body.date_filed ? String(clusterRes.body.date_filed).slice(0, 10) : null;
          const [authMeta] = await sql`select metadata from legal_authorities where id=${cand.id}`;
          const meta = authMeta?.metadata && typeof authMeta.metadata === "object" ? { ...authMeta.metadata } : {};
          meta.identityOnly = false;
          meta.corpusComplete = true;
          meta.fullTextAcquisition = { batch: BATCH, clusterId, opinionId, acquiredAt: new Date().toISOString(), contentHash };
          const cites = Array.isArray(clusterRes.body.citations)
            ? clusterRes.body.citations.map((c) => (typeof c === "string" ? c : c?.cite)).filter(Boolean)
            : [];
          meta.citationAliases = [...new Set([...(meta.citationAliases || []), cand.citation, ...cites].filter(Boolean))].slice(0, 24);
          meta.parallelCitations = [...new Set([...(meta.parallelCitations || []), ...cites].filter(Boolean))].slice(0, 24);

          await sql`
            update legal_authorities set
              title=${String(title).slice(0, 500)},
              court=coalesce(${clusterRes.body.court || null}, court),
              decision_date=coalesce(${decisionDate}, decision_date),
              canonical_source_url=${`https://www.courtlistener.com/opinion/${clusterId}/`},
              metadata=${sql.json(meta)},
              ingestion_status='processing'::authority_ingestion_status,
              last_checked_at=now(), updated_at=now()
            where id=${cand.id}
          `;
          await sql`
            insert into legal_authority_versions (
              id, authority_id, version_number, content, effective_from, effective_to,
              source_provider, source_metadata, sha256
            ) values (
              ${versionId}, ${cand.id}, ${nextVersion}, ${text},
              ${decisionDate}, ${null}, ${SOURCE},
              ${sql.json({ adapter: BATCH, clusterId, opinionId })}, ${contentHash}
            )
          `;
          await sql`delete from legal_authority_chunks where authority_id=${cand.id}`;
          const chunks = chunkContent(text);
          const vectors = await embedAll(chunks, openaiKey);
          for (let i = 0; i < chunks.length; i++) {
            await sql`
              insert into legal_authority_chunks (
                id, authority_id, authority_version_id, chunk_index, content,
                segment_ref, char_start, char_end, embedding, embedding_model
              ) values (
                ${crypto.randomUUID()}, ${cand.id}, ${versionId}, ${i}, ${chunks[i]},
                ${`p${i + 1}`}, ${null}, ${null}, ${toPgvector(vectors[i])}::vector,
                ${`${EMBEDDING_MODEL}:${EMBEDDING_DIMS}`}
              )
            `;
          }
          const citeResult = await ensureCaseCitationExtraction(sql, { authorityId: cand.id, content: text, existingMetadata: meta });
          await sql`update legal_authorities set ingestion_status='ready'::authority_ingestion_status, updated_at=now() where id=${cand.id}`;

          const newEdgesTotal = Number(citeResult.inserted || 0);
          ftNewEdges += newEdgesTotal;
          const newEdgeRows = await sql`
            select to_authority_id from legal_authority_citations
            where from_authority_id=${cand.id} order by created_at desc limit ${Math.max(newEdgesTotal, 1)}
          `;
          let imm = 0;
          let still = 0;
          for (const er of newEdgeRows.slice(0, newEdgesTotal)) {
            if (er.to_authority_id) imm += 1;
            else still += 1;
          }
          ftNewImm += imm;
          ftNewStill += still;

          // backfill aliases for this authority
          const aidx = authorityRows.findIndex((a) => a.id === cand.id);
          if (aidx >= 0) {
            authorityRows[aidx] = { ...authorityRows[aidx], metadata: meta, title, ingestion_status: "ready", has_embeddings: true };
          }
          index = rebuildIndex(
            authorityRows.map((a) => ({
              ...a,
              corpusComplete: Boolean(a.has_embeddings) && a.ingestion_status === "ready",
            })),
          );
          let oldBack = 0;
          const keys = new Set(
            [cand.citation, ...(meta.citationAliases || []), ...(meta.parallelCitations || [])].filter(Boolean).map((c) => targetKey(c, c)),
          );
          const stillU = await sql`select id, from_authority_id, raw_citation, normalized_citation from legal_authority_citations where to_authority_id is null`;
          for (const e of stillU) {
            const key = targetKey(e.raw_citation, e.normalized_citation);
            if (!keys.has(key)) continue;
            const hit = index.lookupCitation(e.raw_citation, e.normalized_citation);
            if (hit.kind !== "one" || hit.authorityId !== cand.id) continue;
            const n = await resolveEdgeRow(e, cand.id, hit.method, hit.evidence, true);
            if (n) {
              if (isNewEdge(e.from_authority_id)) {
                /* new from other FT auth */
              } else oldBack += 1;
            }
          }
          ftOld += oldBack;
          ftAcquired += 1;
          ftJuris[cand.courtBucket] = (ftJuris[cand.courtBucket] || 0) + 1;
          ftResults.push({
            citation: cand.citation,
            caseName: title,
            authorityId: cand.id,
            courtBucket: cand.courtBucket,
            status: "acquired_corpus_complete",
            NEW_EDGES_TOTAL: newEdgesTotal,
            NEW_EDGES_RESOLVED_IMMEDIATELY: imm,
            NEW_EDGES_STILL_UNRESOLVED: still,
            OLD_EDGES_BACKFILLED: oldBack,
          });
          console.log(JSON.stringify({ ftAcquired, citation: cand.citation, courtBucket: cand.courtBucket, newEdges: newEdgesTotal, totalCl }));

          if (ftAcquired % 5 === 0) {
            const health = await healthSnapshot(sql);
            const cp = { lane: "fulltext", atAcquired: ftAcquired, totalCl, fullTextCl, health: { green: health.green, CORPUS_COMPLETE: health.CORPUS_COMPLETE_AUTHORITIES } };
            checkpoints.push(cp);
            writeJson(path.join(CHECKPOINT_DIR, `post-ft-reassess-ft-cp-${ftAcquired}.json`), cp);
            if (!health.green) {
              stopReason = "HEALTH_NOT_GREEN";
              break;
            }
          }
        }
        if (ftAcquired > 0 && stopReason === "BATCH_COMPLETE") stopReason = "FULLTEXT_BUDGET_COMPLETE";
        if (selectedLane === "LANE_D_HIGH_VALUE_FULLTEXT" && ftAcquired === 0 && tierA.length === 0) stopReason = "NO_HIGH_VALUE_EXTERNAL_LANE";
      }
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

    const oldThisRun = localOld + idOld + ftOld;
    const newThisRun = localNew + idNew;
    const oldProgressTotal = OLD_PROGRESS_BEFORE + oldThisRun;
    const last20 = rollingIdentity.slice(-20);
    const rollHigh = last20.length ? last20.filter((x) => x.high).length / last20.length : null;
    const rollAmb = last20.length ? last20.filter((x) => x.ambiguous).length / last20.length : null;
    const rollOld = identityCl > 0 ? idOld / identityCl : null;
    const measuredHour = hourRem != null ? Math.max(0, hourRem - (totalCl - (quotaProbed ? 1 : 0))) : null;
    const measuredDay = dayRem != null ? Math.max(0, dayRem - (totalCl - (quotaProbed ? 1 : 0))) : null;

    // Fix fullTextCl accounting: clGet increments totalCl; track from results
    fullTextCl = Math.max(0, totalCl - 1 - identityCl - retryCl);

    let sunday = "OFF_TRACK";
    const required = measuredDay > 0 ? (WEEKEND_TARGET - oldProgressTotal) / measuredDay : null;
    const demonstrated = identityCl > 0 ? idOld / identityCl : localOld > 0 ? localOld : null;
    if (required != null && demonstrated != null && required <= demonstrated * 0.85) sunday = "ON_TRACK";
    else if (required != null && demonstrated != null && required <= demonstrated * 1.25) sunday = "AT_RISK";
    else sunday = "OFF_TRACK";

    let economic = "LONG_TAIL_BULK_EXHAUSTED";
    if (ge5.length >= 10 || edge4.filter((t) => t.qualityTier === "A").length >= 20) economic = "HIGH_VALUE_BULK_REMAINS";
    else if (ge5.length > 0 || edge4.filter((t) => t.qualityTier === "A").length > 0 || materiallyImproved3) economic = "ONLY_STRATEGIC_IDENTITY_REMAINS";

    let nextDecision = "PAUSE_FOR_QUOTA_RECOVERY";
    let nextBudget = 0;
    if (hit429 || stopReason === "HEALTH_NOT_GREEN" || !end.green) {
      nextDecision = "PAUSE_FOR_QUOTA_RECOVERY";
    } else if (economic === "HIGH_VALUE_BULK_REMAINS") {
      nextDecision = "CONTINUE_REFRESHED_IDENTITY_LANE";
      nextBudget = 270;
    } else if (end.METADATA_ONLY_AUTHORITIES >= 50 && economic !== "HIGH_VALUE_BULK_REMAINS") {
      nextDecision = "CONTINUE_HIGH_VALUE_FULLTEXT";
      nextBudget = 175;
    } else if (measuredHour != null && measuredHour < 80) {
      nextDecision = "RUN_NEXT_FULL_HOUR_AFTER_RECOVERY";
      nextBudget = 270;
    } else {
      nextDecision = "RETURN_TO_PRODUCT_WORK";
      nextBudget = 0;
    }

    let finalClass = "POST_FULLTEXT_REASSESSMENT_MODERATE";
    if (hit429 || !end.green || stopReason === "START_HEALTH_NOT_GREEN") finalClass = "POST_FULLTEXT_REASSESSMENT_BLOCKED";
    else if (selectedLane === "NO_HIGH_VALUE_EXTERNAL_LANE" && idAttempted === 0 && ftAcquired === 0) finalClass = "POST_FULLTEXT_REASSESSMENT_NO_IDENTITY_LANE";
    else if ((idHigh >= 20 && (rollOld == null || rollOld >= 2.5)) || ftAcquired >= 20 || localEdges >= 50) finalClass = "POST_FULLTEXT_REASSESSMENT_STRONG";
    else if (idAttempted > 0 || ftAcquired > 0 || localEdges > 0) finalClass = "POST_FULLTEXT_REASSESSMENT_MODERATE";

    if (stopReason === "HOURLY_WINDOW_NOT_READY_FOR_FULL_RUN" || stopReason === "DAILY_CAPACITY_TOO_LOW_FOR_FULL_SAFE_RUN") {
      finalClass = "POST_FULLTEXT_REASSESSMENT_BLOCKED";
      nextDecision = "RUN_NEXT_FULL_HOUR_AFTER_RECOVERY";
      nextBudget = 270;
    }

    const report = {
      ok: end.green && !hit429 && !["HOURLY_WINDOW_NOT_READY_FOR_FULL_RUN", "DAILY_CAPACITY_TOO_LOW_FOR_FULL_SAFE_RUN", "START_HEALTH_NOT_GREEN"].includes(stopReason),
      classification: "POST_FULLTEXT_CORPUS_REASSESSMENT_RUN",
      runStartLocal: RUN_START_LOCAL,
      stopReason,
      precheck: {
        branch: "nyaya/corpus-citation-strengthening-v2",
        startTip: "74c51629df00b121d469081a8da0f774e7ff6837",
      },
      start: {
        AUTHORITY_RESOLVED_EDGES: start.AUTHORITY_RESOLVED_EDGES,
        CORPUS_COMPLETE_EDGES: start.CORPUS_COMPLETE_EDGES,
        IDENTITY_UNRESOLVED_EDGES: start.IDENTITY_UNRESOLVED_EDGES,
        TOTAL_CANONICAL_AUTHORITIES: start.TOTAL_CANONICAL_AUTHORITIES,
        METADATA_ONLY_AUTHORITIES: start.METADATA_ONLY_AUTHORITIES,
        CORPUS_COMPLETE_AUTHORITIES: start.CORPUS_COMPLETE_AUTHORITIES,
        FULL_TEXT_READY_AUTHORITIES: start.FULL_TEXT_READY_AUTHORITIES,
        EMBEDDED_AUTHORITIES: start.EMBEDDED_AUTHORITIES,
      },
      end: {
        AUTHORITY_RESOLVED_EDGES: end.AUTHORITY_RESOLVED_EDGES,
        CORPUS_COMPLETE_EDGES: end.CORPUS_COMPLETE_EDGES,
        IDENTITY_UNRESOLVED_EDGES: end.IDENTITY_UNRESOLVED_EDGES,
        TOTAL_CANONICAL_AUTHORITIES: end.TOTAL_CANONICAL_AUTHORITIES,
        METADATA_ONLY_AUTHORITIES: end.METADATA_ONLY_AUTHORITIES,
        CORPUS_COMPLETE_AUTHORITIES: end.CORPUS_COMPLETE_AUTHORITIES,
        FULL_TEXT_READY_AUTHORITIES: end.FULL_TEXT_READY_AUTHORITIES,
        EMBEDDED_AUTHORITIES: end.EMBEDDED_AUTHORITIES,
      },
      queueRebuild: buckets,
      localFirst: {
        localTargets,
        localEdges,
        localOld,
        localNew,
        clAvoided: localTargets,
        aliasesUsed,
        parallelsUsed,
      },
      laneDecision: {
        freshGe5: ge5.length,
        quality4: edge4.filter((t) => t.qualityTier === "A").length,
        quality4AB: edge4.length,
        materiallyImproved3,
        edge3Strong: edge3Strong.length,
        selectedLane,
        laneReason,
      },
      quota: {
        probe: quotaProbed ? 1 : 0,
        minuteStart: minuteRem,
        hourStart: hourRem,
        dayStart: dayRem,
        preferredMaxCl: TOTAL_CL_CAP,
        estimatedHourRemaining: measuredHour,
        estimatedDayRemaining: measuredDay,
        hit429,
        hit502,
      },
      identity: {
        cl: identityCl,
        attempted: idAttempted,
        high: idHigh,
        ambiguous: idAmb,
        notFound: idNf,
        failures: idFail,
        oldUnresolvedResolved: idOld,
        newlyIntroducedResolved: idNew,
        totalEdgesResolved: idOld + idNew,
        oldPerCl: identityCl > 0 ? idOld / identityCl : null,
        totalPerCl: identityCl > 0 ? (idOld + idNew) / identityCl : null,
        rollingHigh: rollHigh,
        rollingAmbiguity: rollAmb,
        rollingOldPerCl: rollOld,
        aliasesLearned: idAliases,
        parallelsLearned: idParallels,
      },
      fullText: {
        cl: fullTextCl,
        attempted: ftAttempted,
        completed: ftAcquired,
        failed: ftFailed,
        byCourt: ftJuris,
        metadataToComplete: ftAcquired,
        NEW_EDGES_TOTAL: ftNewEdges,
        NEW_EDGES_RESOLVED_IMMEDIATELY: ftNewImm,
        NEW_EDGES_STILL_UNRESOLVED: ftNewStill,
        OLD_UNRESOLVED_RESOLVED: ftOld,
        CORPUS_COMPLETE_EDGES_delta: end.CORPUS_COMPLETE_EDGES - start.CORPUS_COMPLETE_EDGES,
        newEmbeddings: ftAcquired,
      },
      totalCl: {
        probe: quotaProbed ? 1 : 0,
        identity: identityCl,
        fullText: fullTextCl,
        retry: retryCl,
        total: totalCl,
      },
      weekend: {
        OLD_PROGRESS_BEFORE,
        OLD_PROGRESS_THIS_RUN: oldThisRun,
        OLD_PROGRESS_TOTAL: oldProgressTotal,
        OLD_REMAINING_TO_15000: Math.max(0, WEEKEND_TARGET - oldProgressTotal),
        NET_IDENTITY_UNRESOLVED_CHANGE: end.IDENTITY_UNRESOLVED_EDGES - start.IDENTITY_UNRESOLVED_EDGES,
        newlyIntroducedResolvedThisRun: newThisRun,
        sunday15k: sunday,
        requiredYield: required,
        demonstratedOldYield: demonstrated,
        economicBacklogStatus: economic,
      },
      health: {
        duplicates: end.duplicates,
        orphans: end.orphans,
        missingEmbeddings: end.missingEmbeddings,
        failed: end.failed,
        notProcessed: end.notProcessed,
        duplicateActiveMappings,
        presentTargetDefectsDeterministic: end.presentTargetDefectsDeterministic,
        rawCitationLoss: 0,
        status: end.green && duplicateActiveMappings === 0 ? "PASS" : "FAIL",
      },
      nextDecision,
      nextRecommendedClBudget: nextBudget,
      idResults: idResults.slice(0, 200),
      ftResults,
      checkpoints,
      finalClassification: finalClass,
      generatedAt: new Date().toISOString(),
      resolverVersion: RESOLVER_VERSION,
    };

    writeJson(REPORT_JSON, report);
    console.log("POST_FULLTEXT_CORPUS_REASSESSMENT_RUN_COMPLETE");
    console.log(JSON.stringify({
      ok: report.ok,
      stopReason,
      selectedLane,
      localEdges,
      localOld,
      identityCl,
      idHigh,
      idOld,
      ftAcquired,
      totalCl,
      oldProgressTotal,
      economic,
      sunday15k: sunday,
      nextDecision,
      finalClassification: finalClass,
      health: report.health.status,
      reportJson: REPORT_JSON,
    }, null, 2));
    process.exit(report.ok || stopReason === "HOURLY_WINDOW_NOT_READY_FOR_FULL_RUN" || stopReason === "DAILY_CAPACITY_TOO_LOW_FOR_FULL_SAFE_RUN" ? 0 : 5);
  } catch (e) {
    console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 2000), totalCl, identityCl, fullTextCl }));
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();
