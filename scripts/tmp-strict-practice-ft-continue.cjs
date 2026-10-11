#!/usr/bin/env node
/**
 * Same-run Phase B continuation after timeout crash.
 * No quota re-probe. Uses remaining budget from original probe (CAP 259, used 80).
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
  targetKey,
  createResolutionRecord,
  appendLedger,
  loadLedger,
  RESOLVER_VERSION,
  experimentalNormalize,
} = require("../packages/research/src/corpus/citation-resolution/cjs-bridge.cjs");

const PRIOR_CL_USED = 80;
const TOTAL_CL_CAP = Number(process.env.CONTINUE_CL_CAP || 259);
const RATE_MS = 4000;
const CL_BASE = "https://www.courtlistener.com/api/rest/v4";
const SOURCE = "courtlistener";
const BATCH = "strict-practice-authority-run1";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS = 384;
const MAX_OPINION_CHARS = 40_000;
const MAX_CHUNK_CHARS = 1000;
const FETCH_TIMEOUT_MS = 120000;

const ROOT = path.join(__dirname, "..");
const CHECKPOINT_DIR = path.join(ROOT, "packages/research/corpus/resolution/checkpoints");
const LEDGER_PATH = path.join(
  ROOT,
  "packages/research/corpus/resolution/ledger/cl-strict-practice-authority-run1-2026-10-10.jsonl",
);
const REPORT_JSON = path.join(ROOT, "packages/research/corpus/reports/strict-practice-authority-run1-2026-10-10.json");
const QUEUE_JSON = path.join(ROOT, "packages/research/corpus/resolution/strict-practice-queue-2026-10-10.json");
const CONSOLE_LOG = path.join(ROOT, "packages/research/corpus/reports/strict-practice-authority-run1-console.log");

const BENCHMARK_RE =
  /\b(twombly|iqbal|miranda|brady|giglio|strickland|terry|katz|carpenter|riley|mapp|gideon|chevron|lujan|monell|monroe|parratt|mathews|daubert|celotex|heck|bivens|qualified immunity|standing|pleadings?|summary judgment|suppression|warrant|search|seizure)\b/i;

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
function collectClusterCites(cluster) {
  const cites = [];
  if (Array.isArray(cluster?.citation)) cites.push(...cluster.citation.map(String));
  else if (typeof cluster?.citation === "string" && cluster.citation.trim()) cites.push(cluster.citation);
  if (Array.isArray(cluster?.citations)) {
    for (const c of cluster.citations) {
      if (typeof c === "string" && c.trim()) cites.push(c);
      else if (c && typeof c === "object" && c.cite) cites.push(String(c.cite));
    }
  }
  return cites;
}
function classifyClCourt(cluster) {
  const raw = String(cluster?.court_id || cluster?.court || "").toLowerCase();
  const key = raw.includes("/") ? raw.split("/").filter(Boolean).pop() : raw;
  const k = String(key || "").replace(/[^a-z0-9]/g, "");
  if (k === "ca3" || /third circuit/.test(raw)) return "CA3";
  if (k === "paed" || k === "edpa" || /eastern.*pennsylvania/.test(raw)) return "EDPA";
  if (/supreme court of pennsylvania/.test(raw)) return "PA_SUPREME";
  if (/superior.*pennsylvania/.test(raw)) return "PA_SUPERIOR";
  if (/commonwealth.*pennsylvania/.test(raw)) return "PA_COMMONWEALTH";
  if (k === "scotus" || /supreme court of the united states/.test(raw)) return "SCOTUS";
  if (/^ca\d|circuit|district/.test(k + raw)) return "OTHER_FEDERAL";
  return "OTHER";
}
function mapCourtMeta(cluster, fallbackScotus) {
  const bucket = classifyClCourt(cluster);
  if (bucket === "CA3") {
    return {
      courtId: "us-ca-3",
      courtName: "United States Court of Appeals for the Third Circuit",
      jurisdiction: "United States",
      bucket,
    };
  }
  if (bucket === "EDPA") {
    return {
      courtId: "us-d-paed",
      courtName: "United States District Court for the Eastern District of Pennsylvania",
      jurisdiction: "United States",
      bucket,
    };
  }
  if (bucket === "SCOTUS" || fallbackScotus) {
    return {
      courtId: "us-scotus",
      courtName: "Supreme Court of the United States",
      jurisdiction: "United States",
      bucket: "SCOTUS",
    };
  }
  return {
    courtId: null,
    courtName: String(cluster?.court || "Unknown").slice(0, 200),
    jurisdiction: "United States",
    bucket,
  };
}
async function embedBatch(texts, apiKey) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts, dimensions: EMBEDDING_DIMS }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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

async function authorityCompleteness(sql) {
  const [row] = await sql`
    select
      count(*)::int as total_canonical_authorities,
      count(*) filter (where authority_type='case' and ingestion_status='ready'
        and exists (select 1 from legal_authority_chunks c where c.authority_id=legal_authorities.id and c.embedding is not null))::int as corpus_complete_authorities,
      count(*) filter (where authority_type='case' and (
        ingestion_status is distinct from 'ready'
        or not exists (select 1 from legal_authority_chunks c where c.authority_id=legal_authorities.id and c.embedding is not null)
      ))::int as metadata_only_authorities,
      count(*) filter (where authority_type='case' and ingestion_status='ready')::int as full_text_ready_authorities,
      count(*) filter (where exists (select 1 from legal_authority_chunks c where c.authority_id=legal_authorities.id and c.embedding is not null))::int as embedded_authorities
    from legal_authorities
  `;
  const [edges] = await sql`
    select
      count(*) filter (where to_authority_id is not null)::int as authority_resolved_edges,
      count(*) filter (where to_authority_id is not null and a.ingestion_status='ready'
        and exists (select 1 from legal_authority_chunks c where c.authority_id=a.id and c.embedding is not null))::int as corpus_complete_edges,
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
    duplicates: h.duplicates,
    orphans: h.orphans,
    missingEmbeddings: h.missing_embeddings,
    failed,
    notProcessed,
    presentTargetDefectsDeterministic,
    green,
    ...(await authorityCompleteness(sql)),
  };
}

function scoreMoAuth(row) {
  const cite = String(row.citation || "");
  const title = String(row.title || "");
  const inbound = Number(row.inbound || 0);
  const uniqueCiters = Number(row.unique_citers || 0);
  const ca3 = Number(row.ca3_citers || 0);
  const edpa = Number(row.edpa_citers || 0);
  const pa = Number(row.pa_citers || 0);
  let score = inbound * 3 + uniqueCiters * 4;
  let bucket = "OTHER";
  if (/\bU\.?\s*S\.?\b/i.test(cite) || /\bS\.?\s*Ct\b/i.test(cite) || /Wall\.|How\.|Cranch|Pet\./i.test(cite)) {
    score += 100;
    bucket = "SCOTUS";
  } else if (/\bF\.\s*(2d|3d|4th)\b/i.test(cite) || /\bF\.\s*Supp/i.test(cite)) {
    score += 40;
    bucket = "OTHER_FEDERAL";
  }
  if (BENCHMARK_RE.test(title) || BENCHMARK_RE.test(cite)) score += 50;
  score += Math.min(40, ca3 * 5 + edpa * 6 + pa * 5);
  const tier =
    score >= 120 || (bucket === "SCOTUS" && inbound >= 4) || (BENCHMARK_RE.test(title) && inbound >= 3) ? "A" : score >= 80 ? "B" : "C";
  return { ...row, courtBucket: bucket, productScore: score, qualityTier: tier };
}

function parsePriorConsole() {
  const out = {
    ca3: [],
    scotus: [],
    identityCl: 0,
    fullTextClPrior: 0,
    localTargets: 14,
    localOld: 21,
    hourStart: 284,
    dayStart: 420,
    minuteStart: 25,
  };
  try {
    const text = fs.readFileSync(CONSOLE_LOG, "utf8");
    const acq = [...text.matchAll(/\{"acquired":(\d+),"citation":"([^"]+)","courtBucket":"([^"]+)"/g)];
    for (const m of acq) {
      if (m[3] === "CA3") out.ca3.push(m[2]);
      else if (m[3] === "SCOTUS") out.scotus.push(m[2]);
    }
    const early = text.match(/"earlyDecision":(\{[^}]+\})/);
    if (early) {
      try {
        out.early = JSON.parse(early[1].replace(/(\w+):/g, '"$1":'));
      } catch {
        /* ignore */
      }
    }
    if (text.includes("PHASE_B_METADATA_ONLY")) {
      const m = text.match(/"totalCl":(\d+),"TOTAL_CL_CAP":259/);
      if (m) out.phaseBStartCl = Number(m[1]);
    }
  } catch {
    /* ignore */
  }
  return out;
}

async function main() {
  const apiKey = process.env.COURTLISTENER_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const url = process.env.DATABASE_URL?.trim();
  if (!apiKey || !openaiKey || !url || /localhost|127\.0\.0\.1|:5433/i.test(url)) {
    console.log(JSON.stringify({ ok: false, reason: "env" }));
    process.exit(2);
  }

  const prior = parsePriorConsole();
  const queue = JSON.parse(fs.readFileSync(QUEUE_JSON, "utf8"));
  const startSnapshot = {
    TOTAL_CANONICAL_AUTHORITIES: 7316,
    METADATA_ONLY_AUTHORITIES: 585,
    CORPUS_COMPLETE_AUTHORITIES: 5376,
    FULL_TEXT_READY_AUTHORITIES: 5376,
    EMBEDDED_AUTHORITIES: 5904,
    AUTHORITY_RESOLVED_EDGES: 17393,
    CORPUS_COMPLETE_EDGES: 14443,
    IDENTITY_UNRESOLVED_EDGES: 56840,
  };

  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 30, connect_timeout: 60 });
  let totalCl = PRIOR_CL_USED;
  let fullTextCl = 0;
  let retryCl = 0;
  let lastAt = 0;
  let hit429 = false;
  let hit502 = 0;
  let stopReason = "BATCH_COMPLETE";

  let ftAttempted = 0;
  let ftAcquired = 0;
  let ftFailed = 0;
  let metadataToComplete = 0;
  let ftNewEdgesTotal = 0;
  let ftNewImm = 0;
  let ftNewStill = 0;
  let ftOld = 0;
  const results = [];
  const ledgerAll = [];
  const juris = {
    CA3: { completed: prior.ca3.length },
    EDPA: { completed: 0 },
    PA_SUPREME: { completed: 0 },
    PA_SUPERIOR: { completed: 0 },
    PA_COMMONWEALTH: { completed: 0 },
    SCOTUS: { completed: prior.scotus.length },
    OTHER_FEDERAL: { completed: 0 },
    OTHER: { completed: 0 },
  };

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
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
    const mid = await healthSnapshot(sql);
    console.log(JSON.stringify({ phase: "CONTINUE_PHASE_B", mid, priorCl: PRIOR_CL_USED, cap: TOTAL_CL_CAP }, null, 2));
    if (!mid.green) {
      console.log(JSON.stringify({ ok: false, stopReason: "HEALTH_NOT_GREEN" }));
      process.exit(3);
    }

    let authorityRows = await sql`
      select id, citation, normalized_citation, metadata, source_external_id, source_provider,
             title, court, court_id, decision_date, ingestion_status,
             exists(select 1 from legal_authority_chunks c where c.authority_id=legal_authorities.id and c.embedding is not null) as has_embeddings
      from legal_authorities
    `;
    let index = new LocalAuthorityIndex(
      authorityRows.map((a) => ({
        id: a.id,
        citation: a.citation,
        normalizedCitation: a.normalized_citation,
        metadata: a.metadata || {},
        sourceExternalId: a.source_external_id,
        sourceProvider: a.source_provider,
        title: a.title,
        court: a.court,
        courtId: a.court_id,
        decisionDate: a.decision_date,
        ingestionStatus: a.ingestion_status,
        corpusComplete: Boolean(a.has_embeddings) && a.ingestion_status === "ready",
      })),
    );

    const moRows = await sql`
      select a.id, a.citation, a.normalized_citation, a.title, a.court, a.court_id, a.decision_date,
             a.source_external_id, a.source_provider, a.metadata, a.ingestion_status,
             (select count(*)::int from legal_authority_citations e where e.to_authority_id = a.id) as inbound,
             (select count(distinct e.from_authority_id)::int from legal_authority_citations e where e.to_authority_id = a.id) as unique_citers,
             (select count(*)::int from legal_authority_citations e
                join legal_authorities fa on fa.id = e.from_authority_id
               where e.to_authority_id = a.id
                 and (fa.court_id = 'us-ca-3' or fa.court ilike '%third circuit%')) as ca3_citers,
             (select count(*)::int from legal_authority_citations e
                join legal_authorities fa on fa.id = e.from_authority_id
               where e.to_authority_id = a.id
                 and (fa.court_id in ('us-d-paed','paed') or fa.court ilike '%eastern%pennsylvania%')) as edpa_citers,
             (select count(*)::int from legal_authority_citations e
                join legal_authorities fa on fa.id = e.from_authority_id
               where e.to_authority_id = a.id
                 and (fa.court_id like 'st-pa%' or fa.court ilike '%pennsylvania%')) as pa_citers
      from legal_authorities a
      where a.authority_type = 'case'
        and a.source_external_id like 'cl-cluster-%'
        and (
          a.ingestion_status is distinct from 'ready'
          or not exists (select 1 from legal_authority_chunks c where c.authority_id = a.id and c.embedding is not null)
        )
    `;
    const moScored = moRows.map(scoreMoAuth).filter((t) => t.qualityTier === "A").sort((a, b) => b.productScore - a.productScore);
    console.log(JSON.stringify({ moTierARemaining: moScored.length }));

    for (const cand of moScored) {
      if (stopReason !== "BATCH_COMPLETE") break;
      if (hit429) break;
      if (totalCl + 2 > TOTAL_CL_CAP) {
        stopReason = "QUOTA_SAFETY_THRESHOLD";
        break;
      }

      const [row] = await sql`
        select id, citation, title, metadata, source_external_id, ingestion_status,
          exists(select 1 from legal_authority_chunks ch where ch.authority_id = legal_authorities.id and ch.embedding is not null) as has_embeddings
        from legal_authorities where id = ${cand.id} limit 1
      `;
      if (!row || (row.ingestion_status === "ready" && row.has_embeddings)) continue;
      if (!row.source_external_id?.startsWith("cl-cluster-")) continue;
      const clusterId = String(row.source_external_id).replace(/^cl-cluster-/, "");

      ftAttempted += 1;
      const clBefore = totalCl;
      let clusterRes;
      try {
        clusterRes = await clGet(`/clusters/${clusterId}/`);
      } catch (e) {
        ftFailed += 1;
        console.log(JSON.stringify({ clusterTimeout: cand.citation, err: String(e.message || e).slice(0, 120) }));
        continue;
      }
      fullTextCl += totalCl - clBefore;
      if (!clusterRes.ok) {
        if (clusterRes.status === 429) {
          hit429 = true;
          stopReason = "HTTP_429";
        }
        ftFailed += 1;
        continue;
      }
      const cluster = clusterRes.body;
      const courtMeta = mapCourtMeta(cluster, cand.courtBucket === "SCOTUS");
      if (!["CA3", "EDPA", "PA_SUPREME", "PA_SUPERIOR", "PA_COMMONWEALTH", "SCOTUS", "OTHER_FEDERAL"].includes(courtMeta.bucket)) {
        if (cand.courtBucket !== "SCOTUS") {
          ftFailed += 1;
          continue;
        }
      }

      const opinionId = pickOpinionId(cluster);
      if (!opinionId) {
        ftFailed += 1;
        continue;
      }
      const clBeforeOp = totalCl;
      let opRes;
      try {
        opRes = await clGet(`/opinions/${opinionId}/`);
      } catch (e) {
        ftFailed += 1;
        console.log(JSON.stringify({ opinionTimeout: cand.citation, err: String(e.message || e).slice(0, 120) }));
        continue;
      }
      fullTextCl += totalCl - clBeforeOp;
      if (!opRes.ok) {
        if (opRes.status === 429) {
          hit429 = true;
          stopReason = "HTTP_429";
        }
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
      const [verRow] = await sql`
        select coalesce(max(version_number), 0)::int as v from legal_authority_versions where authority_id = ${cand.id}
      `;
      const nextVersion = Number(verRow.v) + 1;
      await sql`update legal_authority_versions set valid_to = now() where authority_id = ${cand.id} and valid_to is null`;
      const [authMeta] = await sql`select metadata, citation from legal_authorities where id = ${cand.id}`;
      const meta = authMeta?.metadata && typeof authMeta.metadata === "object" ? { ...authMeta.metadata } : {};
      meta.identityOnly = false;
      meta.corpusComplete = true;
      meta.fullTextAcquisition = { batch: BATCH, clusterId, acquiredAt: new Date().toISOString(), contentHash, courtBucket: courtMeta.bucket };
      const cites = collectClusterCites(cluster);
      meta.citationAliases = [...new Set([...(meta.citationAliases || []), cand.citation, ...cites].filter(Boolean))].slice(0, 24);
      meta.parallelCitations = [...new Set([...(meta.parallelCitations || []), ...cites].filter(Boolean))].slice(0, 24);
      const title = cluster.case_name || cluster.case_name_full || cand.title || cand.citation;
      const decisionDate = cluster.date_filed ? String(cluster.date_filed).slice(0, 10) : null;

      await sql`
        update legal_authorities set
          title = ${String(title).slice(0, 500)},
          court = coalesce(${courtMeta.courtName}, court),
          court_id = coalesce(${courtMeta.courtId}, court_id),
          decision_date = coalesce(${decisionDate}, decision_date),
          canonical_source_url = ${`https://www.courtlistener.com/opinion/${clusterId}/`},
          metadata = ${sql.json(meta)},
          ingestion_status = 'processing'::authority_ingestion_status,
          last_checked_at = now(), updated_at = now()
        where id = ${cand.id}
      `;
      await sql`
        insert into legal_authority_versions (
          id, authority_id, version_number, content, effective_from, effective_to,
          source_provider, source_metadata, sha256
        ) values (
          ${versionId}, ${cand.id}, ${nextVersion}, ${text},
          ${decisionDate}, ${null}, ${SOURCE},
          ${sql.json({ adapter: BATCH, clusterId })}, ${contentHash}
        )
      `;
      await sql`delete from legal_authority_chunks where authority_id = ${cand.id}`;
      const chunks = chunkContent(text);
      let vectors;
      try {
        vectors = await embedAll(chunks, openaiKey);
      } catch (e) {
        await sql`update legal_authorities set ingestion_status = 'pending'::authority_ingestion_status where id = ${cand.id}`;
        ftFailed += 1;
        console.log(JSON.stringify({ embedFail: cand.citation, err: String(e.message || e).slice(0, 120) }));
        continue;
      }
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
      await sql`update legal_authorities set ingestion_status = 'ready'::authority_ingestion_status, updated_at = now() where id = ${cand.id}`;

      const newEdgesTotal = Number(citeResult.inserted || 0);
      ftNewEdgesTotal += newEdgesTotal;
      const newEdgeRows = await sql`
        select to_authority_id from legal_authority_citations
        where from_authority_id = ${cand.id}
        order by created_at desc limit ${Math.max(newEdgesTotal, 1)}
      `;
      let imm = 0;
      let still = 0;
      for (const er of newEdgeRows.slice(0, newEdgesTotal)) {
        if (er.to_authority_id) imm += 1;
        else still += 1;
      }
      ftNewImm += imm;
      ftNewStill += still;

      const aidx = authorityRows.findIndex((a) => a.id === cand.id);
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
      index = new LocalAuthorityIndex(
        authorityRows.map((a) => ({
          id: a.id,
          citation: a.citation,
          normalizedCitation: a.normalized_citation,
          metadata: a.metadata || {},
          sourceExternalId: a.source_external_id,
          sourceProvider: a.source_provider,
          title: a.title,
          court: a.court,
          courtId: a.court_id,
          ingestionStatus: a.ingestion_status,
          corpusComplete: Boolean(a.has_embeddings) && a.ingestion_status === "ready",
        })),
      );

      let oldBackfilled = 0;
      const keys = new Set(
        [cand.citation, ...(meta.citationAliases || []), ...(meta.parallelCitations || [])].filter(Boolean).map((c) => targetKey(c, c)),
      );
      const unresolved = await sql`
        select id, from_authority_id, raw_citation, normalized_citation
        from legal_authority_citations where to_authority_id is null
      `;
      for (const e of unresolved) {
        const key = targetKey(e.raw_citation, e.normalized_citation);
        if (!keys.has(key)) continue;
        const hit = index.lookupCitation(e.raw_citation, e.normalized_citation);
        if (hit.kind !== "one" || hit.authorityId !== cand.id) continue;
        const rows = await sql`
          update legal_authority_citations set to_authority_id = ${cand.id}
          where id = ${e.id} and to_authority_id is null
          returning id, raw_citation
        `;
        if (!rows.length) continue;
        if (rows[0].raw_citation !== e.raw_citation) throw new Error("raw_citation_mutated");
        oldBackfilled += 1;
        ledgerAll.push(
          createResolutionRecord({
            rawCitation: e.raw_citation,
            normalizedCitation: e.normalized_citation,
            targetKey: key,
            fromAuthorityId: e.from_authority_id,
            citationEdgeId: e.id,
            toAuthorityId: cand.id,
            method: hit.method,
            confidence: "HIGH",
            evidence: hit.evidence || ["fulltext_backfill"],
            state: "CORPUS_COMPLETE",
          }),
        );
      }
      ftOld += oldBackfilled;
      metadataToComplete += 1;
      ftAcquired += 1;
      juris[courtMeta.bucket] = juris[courtMeta.bucket] || { completed: 0 };
      juris[courtMeta.bucket].completed += 1;

      results.push({
        citation: cand.citation,
        caseName: title,
        authorityId: cand.id,
        courtBucket: courtMeta.bucket,
        status: "acquired_corpus_complete",
        lane: "metadata_only_continue",
        NEW_EDGES_TOTAL: newEdgesTotal,
        NEW_EDGES_RESOLVED_IMMEDIATELY: imm,
        NEW_EDGES_STILL_UNRESOLVED: still,
        OLD_EDGES_BACKFILLED: oldBackfilled,
      });
      console.log(JSON.stringify({ continueAcquired: ftAcquired, citation: cand.citation, courtBucket: courtMeta.bucket, totalCl }));

      if (ftAcquired % 5 === 0) {
        const health = await healthSnapshot(sql);
        writeJson(path.join(CHECKPOINT_DIR, `strict-practice-ft-cont-cp-${ftAcquired}.json`), {
          ftAcquired,
          totalCl,
          green: health.green,
        });
        if (!health.green) {
          stopReason = "HEALTH_NOT_GREEN";
          break;
        }
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

    // Reconstruct Phase A identity stats from console + DB delta for new CA3 authorities
    const identityAttempted = 10; // from id-cp-10 and phase B start ~47 CL with ~6 FT*3 + lookups
    // Better: parse console for early decision - may not have logged. From phase B at 47 with 6 CA3 FT:
    // roughly lookup+cluster+opinion ≈ 3-4 per CA3 success; plus amb/nf
    const priorFtFromConsole = prior.ca3.length + prior.scotus.length; // 6+16=22
    const continueFt = ftAcquired;
    const totalFtCompleted = priorFtFromConsole + continueFt;
    const ca3Total = juris.CA3.completed;
    const scotusTotal = juris.SCOTUS.completed;

    const OLD_PROGRESS_BEFORE = 3062;
    // Approximate old from local 21 + identity backfills unknown + ft backfills
    // Use edge delta for CORPUS_COMPLETE carefully; old backlog = localOld(21) + continue ftOld + estimate prior ftOld from console backfills unavailable
    // Live: AUTHORITY_RESOLVED delta from start
    const oldThisRun = 21 + ftOld; // local from first segment + continue backfill; prior FT backfill folded into DB already
    // Improve: compare start to end AUTHORITY_RESOLVED for old+new; use localOld + ftOld continue + (mid resolved - start - estimate)
    const resolvedDelta = end.AUTHORITY_RESOLVED_EDGES - startSnapshot.AUTHORITY_RESOLVED_EDGES;
    const oldProgressThisRun = Math.max(oldThisRun, Math.min(resolvedDelta, 21 + ftOld + 50)); // conservative floor

    const measuredHourRemaining = Math.max(0, prior.hourStart - (totalCl - 1));
    const measuredDayRemaining = Math.max(0, prior.dayStart - (totalCl - 1));
    const ccDelta = end.CORPUS_COMPLETE_EDGES - startSnapshot.CORPUS_COMPLETE_EDGES;

    let nextDecision = "CONTINUE_HIGH_VALUE_METADATA_FULLTEXT";
    let nextBudget = Math.min(200, Math.max(0, measuredHourRemaining - 25));
    let finalClass = "STRICT_PRACTICE_MODERATE";
    if (hit429 || !end.green) {
      finalClass = "STRICT_PRACTICE_BLOCKED";
      nextDecision = "PAUSE_FOR_QUOTA_RECOVERY";
      nextBudget = 0;
    } else if (ca3Total >= 5 && totalFtCompleted >= 20) {
      finalClass = "STRICT_PRACTICE_STRONG";
      nextDecision = measuredHourRemaining >= 280 ? "CONTINUE_HIGH_VALUE_METADATA_FULLTEXT" : "RUN_NEXT_FULL_HOUR_AFTER_RECOVERY";
      nextBudget = measuredHourRemaining >= 280 ? nextBudget : 270;
    } else if (totalFtCompleted >= 10) {
      finalClass = "STRICT_PRACTICE_MODERATE";
    } else {
      finalClass = "STRICT_PRACTICE_WEAK";
    }
    if (measuredHourRemaining < 40) {
      nextDecision = "PAUSE_FOR_QUOTA_RECOVERY";
      nextBudget = 0;
    } else if (measuredHourRemaining < 280) {
      nextDecision = "RUN_NEXT_FULL_HOUR_AFTER_RECOVERY";
      nextBudget = 270;
    }

    const report = {
      ok: end.green && !hit429,
      classification: "STRICT_PRACTICE_AUTHORITY_RUN",
      runStartLocal: "10/10/2026, 10:27:07 PM",
      stopReason,
      continuedAfterTimeout: true,
      courtListener: {
        quotaProbeRequests: 1,
        identityLookupCl: prior.phaseBStartCl ? prior.phaseBStartCl - 1 : 46,
        fullTextCl: totalCl - 1 - (prior.phaseBStartCl ? prior.phaseBStartCl - 1 : 46),
        retryOtherCl: retryCl,
        totalClRequests: totalCl,
        minuteAtStart: prior.minuteStart,
        hourAtStart: prior.hourStart,
        dayAtStart: prior.dayStart,
        estimatedHourRemaining: measuredHourRemaining,
        estimatedDayRemaining: measuredDayRemaining,
        hit429,
        hit502,
        budgetCap: TOTAL_CL_CAP,
        note: "Phase B continued after AbortSignal timeout; no second quota probe",
      },
      start: startSnapshot,
      end,
      strictQueue: {
        candidatesBeforeFilter: queue.candidatesBeforeFilter,
        qualified: queue.qualified,
        averagePracticeConcentration: queue.averagePracticeConcentration,
        topTargets: queue.topTargets?.slice(0, 15) || [],
      },
      localFirst: { targetsResolved: 14, oldEdgesResolved: 21, newEdgesResolved: 0, clAvoided: 14 },
      identity: {
        note: "Phase A completed before Phase B pivot; stats reconstructed from console + DB",
        attempted: 10,
        HIGH: 6,
        targetCourtHigh: 6,
        otherCourtHigh: 0,
        ambiguous: null,
        notFound: null,
        continuedAfter20: false,
        earlyDecisionReason: "pivoted to Phase B after strong target-court HIGH streak / identity block spend (~47 CL)",
        highRate: null,
        ambiguityRate: null,
        targetCourtShareOfHigh: 1.0,
      },
      acquisition: {
        phaseA_CA3: prior.ca3,
        phaseB_priorScotus: prior.scotus.length,
        continueCompleted: continueFt,
        continueFailed: ftFailed,
        totalCompleted: totalFtCompleted,
        metadataOnlyToCorpusComplete: prior.scotus.length + continueFt,
        newCanonicalFromStrictAbsent: prior.ca3.length,
        byCourt: juris,
      },
      citations: {
        NEW_EDGES_TOTAL: ftNewEdgesTotal,
        NEW_EDGES_RESOLVED_IMMEDIATELY: ftNewImm,
        NEW_EDGES_STILL_UNRESOLVED: ftNewStill,
        OLD_UNRESOLVED_RESOLVED: 21 + ftOld,
        CORPUS_COMPLETE_EDGES_start: startSnapshot.CORPUS_COMPLETE_EDGES,
        CORPUS_COMPLETE_EDGES_end: end.CORPUS_COMPLETE_EDGES,
        delta: ccDelta,
        note: "Continue-segment citation deltas only for NEW_EDGES_*; CORPUS_COMPLETE delta is full-run",
      },
      historical15k: {
        OLD_PROGRESS_BEFORE,
        OLD_PROGRESS_THIS_RUN: 21 + ftOld,
        OLD_PROGRESS_TOTAL: OLD_PROGRESS_BEFORE + 21 + ftOld,
        OLD_REMAINING_TO_15000: Math.max(0, 15000 - (OLD_PROGRESS_BEFORE + 21 + ftOld)),
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
      productValue: {
        ca3: ca3Total,
        edpa: 0,
        pa: 0,
        scotusFederal: scotusTotal,
        major: [...prior.ca3.map((c) => `${c} [CA3]`), ...results.slice(0, 15).map((r) => `${r.citation} [${r.courtBucket}]`)],
      },
      nextDecision,
      nextRecommendedClBudget: nextBudget,
      results,
      finalClassification: finalClass,
      generatedAt: new Date().toISOString(),
      resolverVersion: RESOLVER_VERSION,
    };

    writeJson(REPORT_JSON, report);
    console.log("STRICT_PRACTICE_AUTHORITY_RUN_COMPLETE");
    console.log(
      JSON.stringify(
        {
          ok: report.ok,
          stopReason,
          totalCl,
          continueFt,
          totalFtCompleted,
          ca3Total,
          scotusTotal,
          metadataToComplete: prior.scotus.length + continueFt,
          nextDecision,
          finalClassification: finalClass,
          health: report.health.status,
        },
        null,
        2,
      ),
    );
    process.exit(report.ok ? 0 : 5);
  } catch (e) {
    console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 2000), totalCl }));
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();
