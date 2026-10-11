#!/usr/bin/env node
/**
 * STRICT practice-court acquisition: CA3 / EDPA / PA only for absent FT,
 * then pivot remaining quota to high-value metadata-only fulltext.
 * Neon production only. No markdown.
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
  classifyCaseCitationLookupEligibility,
  experimentalNormalize,
  parseCitationLookupResponse,
} = require("../packages/research/src/corpus/citation-resolution/cjs-bridge.cjs");

let TOTAL_CL_CAP = 270;
const RATE_MS = 4000;
const CL_BASE = "https://www.courtlistener.com/api/rest/v4";
const SOURCE = "courtlistener";
const BATCH = "strict-practice-authority-run1";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS = 384;
const MAX_OPINION_CHARS = 40_000;
const MAX_CHUNK_CHARS = 1000;
const OLD_PROGRESS_BEFORE = 3062;
const WEEKEND_TARGET = 15000;
const MAX_IDENTITY_CL = 40;
const EARLY_DECISION_AT = 20;

const ROOT = path.join(__dirname, "..");
const CHECKPOINT_DIR = path.join(ROOT, "packages/research/corpus/resolution/checkpoints");
const LEDGER_PATH = path.join(
  ROOT,
  "packages/research/corpus/resolution/ledger/cl-strict-practice-authority-run1-2026-10-10.jsonl",
);
const REPORT_JSON = path.join(ROOT, "packages/research/corpus/reports/strict-practice-authority-run1-2026-10-10.json");
const QUEUE_JSON = path.join(ROOT, "packages/research/corpus/resolution/strict-practice-queue-2026-10-10.json");
const RUN_START_LOCAL = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });

const BENCHMARK_RE =
  /\b(twombly|iqbal|miranda|brady|giglio|strickland|terry|katz|carpenter|riley|mapp|gideon|chevron|lujan|monell|monroe|parratt|mathews|daubert|celotex|heck|bivens|qualified immunity|standing|pleadings?|summary judgment|suppression|warrant|search|seizure)\b/i;

const REPORTER_SPECS = [
  { re: /^(\d{1,4})\s+F\.?\s*4th\s+(\d{1,4})$/i, fmt: (v, p) => `${v} F.4th ${p}`, family: "F.4th" },
  { re: /^(\d{1,4})\s+F\.?\s*3d\s+(\d{1,4})$/i, fmt: (v, p) => `${v} F.3d ${p}`, family: "F.3d" },
  { re: /^(\d{1,4})\s+F\.?\s*2d\s+(\d{1,4})$/i, fmt: (v, p) => `${v} F.2d ${p}`, family: "F.2d" },
  { re: /^(\d{1,4})\s+F\.?\s*Supp\.?\s*3d\s+(\d{1,4})$/i, fmt: (v, p) => `${v} F.Supp.3d ${p}`, family: "F.Supp.3d" },
  { re: /^(\d{1,4})\s+F\.?\s*Supp\.?\s*2d\s+(\d{1,4})$/i, fmt: (v, p) => `${v} F.Supp.2d ${p}`, family: "F.Supp.2d" },
  { re: /^(\d{1,4})\s+F\.?\s*Supp\.?\s+(\d{1,4})$/i, fmt: (v, p) => `${v} F.Supp. ${p}`, family: "F.Supp." },
  { re: /^(\d{1,4})\s+A\.?\s*3d\s+(\d{1,4})$/i, fmt: (v, p) => `${v} A.3d ${p}`, family: "A.3d" },
  { re: /^(\d{1,4})\s+A\.?\s*2d\s+(\d{1,4})$/i, fmt: (v, p) => `${v} A.2d ${p}`, family: "A.2d" },
];

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
function normalizeLoose(cite) {
  return String(cite || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\bF\.?\s*Supp\.?\s*3d\b/gi, "F.Supp.3d")
    .replace(/\bF\.?\s*Supp\.?\s*2d\b/gi, "F.Supp.2d")
    .replace(/\bF\.?\s*Supp\.?(?!\s*[23]d)(?=\s*\d)/gi, "F.Supp.")
    .replace(/\bF\.Supp\.(\d+)/gi, "F.Supp. $1")
    .trim();
}
function parseCitation(cite) {
  const raw = normalizeLoose(cite);
  for (const spec of REPORTER_SPECS) {
    const m = raw.match(spec.re);
    if (!m) continue;
    return { volume: Number(m[1]), page: Number(m[2]), citation: spec.fmt(Number(m[1]), Number(m[2])), family: spec.family };
  }
  return null;
}
function citationMatchesTarget(candidate, target) {
  const parsed = parseCitation(candidate);
  if (!parsed) return false;
  return parsed.volume === target.volume && parsed.page === target.page && parsed.family === target.family;
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

function classifyClCourt(cluster) {
  const raw = String(cluster?.court_id || cluster?.court || "").toLowerCase();
  const key = raw.includes("/") ? raw.split("/").filter(Boolean).pop() : raw;
  const k = String(key || "").replace(/[^a-z0-9]/g, "");
  if (k === "ca3" || /thirdcircuit/.test(k) || /third circuit/.test(raw)) return "CA3";
  if (k === "paed" || k === "edpa" || /eastern.*pennsylvania/.test(raw)) return "EDPA";
  if (/pennsylvania supreme|supremecourtofpennsylvania/.test(k) || /supreme court of pennsylvania/.test(raw)) return "PA_SUPREME";
  if (/superior.*pennsylvania|pennsylvania superior|pasuper/.test(raw + k)) return "PA_SUPERIOR";
  if (/commonwealth.*pennsylvania|pennsylvania commonwealth|pacomm/.test(raw + k)) return "PA_COMMONWEALTH";
  if (/pennsylvania/.test(raw) || (k === "pa" && !/paed|pamd|pawd/.test(k))) return "PA_OTHER";
  if (k === "scotus" || /supreme court of the united states/.test(raw)) return "SCOTUS";
  if (/^ca\d|^cadc|^cafc/.test(k) || /circuit/.test(raw)) return "OTHER_FEDERAL";
  if (/district|f\.?\s*supp|^d[a-z]{2}|paed|pamd|pawd/.test(k + raw)) return "OTHER_FEDERAL";
  return "OTHER";
}

function isTargetPracticeCourt(bucket) {
  return ["CA3", "EDPA", "PA_SUPREME", "PA_SUPERIOR", "PA_COMMONWEALTH"].includes(bucket);
}

function mapCourtMeta(cluster) {
  const bucket = classifyClCourt(cluster);
  if (bucket === "CA3") {
    return {
      courtId: "us-ca-3",
      courtName: "United States Court of Appeals for the Third Circuit",
      jurisdiction: "United States",
      clCourt: "ca3",
      bucket,
    };
  }
  if (bucket === "EDPA") {
    return {
      courtId: "us-d-paed",
      courtName: "United States District Court for the Eastern District of Pennsylvania",
      jurisdiction: "United States",
      clCourt: "paed",
      bucket,
    };
  }
  if (bucket === "PA_SUPREME") {
    return { courtId: "st-pa", courtName: "Supreme Court of Pennsylvania", jurisdiction: "PA", clCourt: "pa", bucket };
  }
  if (bucket === "PA_SUPERIOR") {
    return {
      courtId: "st-pa-super",
      courtName: "Superior Court of Pennsylvania",
      jurisdiction: "PA",
      clCourt: "pasuperct",
      bucket,
    };
  }
  if (bucket === "PA_COMMONWEALTH") {
    return {
      courtId: "st-pa-comm",
      courtName: "Commonwealth Court of Pennsylvania",
      jurisdiction: "PA",
      clCourt: "pacommwct",
      bucket,
    };
  }
  if (bucket === "SCOTUS") {
    return {
      courtId: "us-scotus",
      courtName: "Supreme Court of the United States",
      jurisdiction: "United States",
      clCourt: "scotus",
      bucket,
    };
  }
  const raw = cluster?.court_id || cluster?.court || "";
  let key = String(raw).toLowerCase();
  if (key.includes("/")) key = key.split("/").filter(Boolean).pop() || key;
  key = key.replace(/[^a-z0-9]/g, "");
  return {
    courtId: key ? `us-${key}` : "us-unknown",
    courtName: String(cluster?.court || key || "Unknown Court").slice(0, 200),
    jurisdiction: "United States",
    clCourt: key || "unknown",
    bucket,
  };
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
      const period = periodRaw.includes("min")
        ? "minute"
        : periodRaw.includes("hour")
          ? "hour"
          : periodRaw.includes("day")
            ? "day"
            : null;
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

function emptyJuris() {
  return {
    CA3: { attempted: 0, completed: 0, failed: 0 },
    EDPA: { attempted: 0, completed: 0, failed: 0 },
    PA_SUPREME: { attempted: 0, completed: 0, failed: 0 },
    PA_SUPERIOR: { attempted: 0, completed: 0, failed: 0 },
    PA_COMMONWEALTH: { attempted: 0, completed: 0, failed: 0 },
    PA_OTHER: { attempted: 0, completed: 0, failed: 0 },
    SCOTUS: { attempted: 0, completed: 0, failed: 0 },
    OTHER_FEDERAL: { attempted: 0, completed: 0, failed: 0 },
    OTHER: { attempted: 0, completed: 0, failed: 0 },
  };
}

/** Require ≥2 strong practice signals; high practice concentration. */
function qualifyStrictAbsent(row, parsed) {
  const edges = Number(row.edges || 0);
  const unique = Number(row.unique_citers || 0);
  const ca3 = Number(row.ca3_citers || 0);
  const edpa = Number(row.edpa_citers || 0);
  const pa = Number(row.pa_citers || 0);
  const other = Math.max(0, edges - ca3 - edpa - pa);
  const practice = ca3 + edpa + pa;
  const concentration = edges > 0 ? practice / edges : 0;
  const isAtlantic = parsed.family === "A.2d" || parsed.family === "A.3d";
  const isFSupp = /F\.Supp/.test(parsed.family);
  const signals = [];

  if (ca3 >= 2 && ca3 >= edpa && ca3 >= pa && concentration >= 0.5) signals.push("predominantly_CA3");
  if (edpa >= 2 && edpa >= ca3 && concentration >= 0.4) signals.push("predominantly_EDPA");
  if (pa >= 2 && pa >= ca3 && pa >= edpa && concentration >= 0.5) signals.push("predominantly_PA");
  if (practice >= 3 && concentration >= 0.6) signals.push("repeated_CA3_EDPA_PA_demand");
  if (isAtlantic && pa >= 2 && concentration >= 0.5) signals.push("PA_atlantic_concentration");
  if (isFSupp && edpa >= 2) signals.push("EDPA_FSupp_pattern");
  if (/F\.(2d|3d|4th)/.test(parsed.family) && ca3 >= 2 && concentration >= 0.5) signals.push("CA3_federal_reporter_concentration");
  if (BENCHMARK_RE.test(parsed.citation) && practice >= 2) signals.push("benchmark_with_practice");
  if (unique >= 4 && practice >= 3 && concentration >= 0.5) signals.push("high_unique_practice_citers");

  // Reporter alone is never enough — need ≥2 signals and concentration floor
  if (signals.length < 2) return null;
  if (concentration < 0.45 && !(edpa >= 2 && isFSupp)) return null;
  if (practice < 2) return null;

  let score = practice * 20 + concentration * 50 + unique * 3 + edges;
  if (signals.includes("predominantly_CA3")) score += 40;
  if (signals.includes("predominantly_EDPA")) score += 35;
  if (signals.includes("predominantly_PA") || signals.includes("PA_atlantic_concentration")) score += 35;
  score += Math.min(30, ca3 * 8 + edpa * 10 + pa * 8);

  let reason = signals.join("+");
  return {
    edges,
    uniqueCiters: unique,
    ca3,
    edpa,
    pa,
    other,
    practice,
    concentration,
    signals,
    score,
    reason,
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
  return {
    ...row,
    clusterId: String(row.source_external_id || "").replace(/^cl-cluster-/, ""),
    courtBucket: bucket,
    productScore: score,
    qualityTier: tier,
  };
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

  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 30, connect_timeout: 60 });
  let totalCl = 0;
  let fullTextCl = 0;
  let identityCl = 0;
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
  const results = [];
  const identityResults = [];
  const juris = emptyJuris();

  let localTargets = 0;
  let localOld = 0;
  let localNew = 0;
  let localEdges = 0;
  let lookupAttempted = 0;
  let lookupHigh = 0;
  let lookupTargetHigh = 0;
  let lookupOtherHigh = 0;
  let lookupAmb = 0;
  let lookupNf = 0;
  let lookupFail = 0;
  let idOld = 0;
  let ftAttempted = 0;
  let ftAcquired = 0;
  let ftFailed = 0;
  let ftNewEdgesTotal = 0;
  let ftNewImm = 0;
  let ftNewStill = 0;
  let ftOld = 0;
  let newAuthoritiesCreated = 0;
  let metadataToComplete = 0;
  let continuedAfter20 = false;
  let earlyDecisionReason = "";
  let identityLaneStopped = false;

  async function rateWait() {
    const wait = RATE_MS - (Date.now() - lastAt);
    if (lastAt && wait > 0) await sleep(wait);
  }
  async function clGet(pathname, method = "GET", body = null) {
    if (totalCl >= TOTAL_CL_CAP) return { ok: false, status: 0, budgetExhausted: true, body: null };
    await rateWait();
    totalCl += 1;
    lastAt = Date.now();
    const init = {
      method,
      headers: { Authorization: `Token ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(60000),
    };
    if (body != null) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const res = await fetch(`${CL_BASE}${pathname}`, init);
    if (res.status === 429) {
      hit429 = true;
      return { ok: false, status: 429, body: null, retryAfter: res.headers.get("retry-after") };
    }
    if (res.status === 502 || res.status === 504) {
      hit502 += 1;
      if (totalCl < TOTAL_CL_CAP && hit502 < 4) {
        await sleep(2000);
        retryCl += 1;
        totalCl += 1;
        lastAt = Date.now();
        const res2 = await fetch(`${CL_BASE}${pathname}`, init);
        if (!res2.ok) return { ok: false, status: res2.status, body: null };
        return { ok: true, status: res2.status, body: await res2.json() };
      }
      return { ok: false, status: res.status, body: null };
    }
    if (!res.ok) return { ok: false, status: res.status, body: null };
    return { ok: true, status: res.status, body: await res.json() };
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
    let n = 0;
    for (const e of unresolved) {
      if (targetKey(e.raw_citation, e.normalized_citation) !== key) continue;
      n += await resolveEdgeRow(e, authorityId, method, evidence, corpusComplete);
    }
    return n;
  }

  try {
    const start = await healthSnapshot(sql);
    console.log(JSON.stringify({ phase: "PRECHECK_STATE", host: new URL(url).hostname, start }, null, 2));
    if (!start.green) {
      console.log(JSON.stringify({ ok: false, stopReason: "START_HEALTH_NOT_GREEN", classification: "STRICT_PRACTICE_AUTHORITY_RUN" }));
      process.exit(3);
    }

    await sql.unsafe("BEGIN READ ONLY");
    let authorityRows = await sql`
      select id, citation, normalized_citation, metadata, source_external_id, source_provider,
             title, court, court_id, decision_date, ingestion_status,
             exists(select 1 from legal_authority_chunks c where c.authority_id=legal_authorities.id and c.embedding is not null) as has_embeddings
      from legal_authorities
    `;
    const unresolvedLive = await sql`
      select id, from_authority_id, raw_citation, normalized_citation
      from legal_authority_citations where to_authority_id is null
    `;
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
    const absentRows = await sql`
      select
        coalesce(nullif(btrim(e.normalized_citation), ''), nullif(btrim(e.raw_citation), '')) as cite,
        count(*)::int as edges,
        count(distinct e.from_authority_id)::int as unique_citers,
        count(*) filter (where fa.court_id = 'us-ca-3' or fa.court ilike '%third circuit%')::int as ca3_citers,
        count(*) filter (where fa.court_id in ('us-d-paed','paed') or fa.court ilike '%eastern%pennsylvania%')::int as edpa_citers,
        count(*) filter (where fa.court_id like 'st-pa%' or fa.court ilike '%pennsylvania%')::int as pa_citers
      from legal_authority_citations e
      left join legal_authorities fa on fa.id = e.from_authority_id
      where e.to_authority_id is null
        and coalesce(nullif(btrim(e.normalized_citation), ''), nullif(btrim(e.raw_citation), '')) is not null
      group by 1
      having count(*) >= 2
    `;
    await sql.unsafe("COMMIT");

    let index = rebuildIndex(
      authorityRows.map((a) => ({ ...a, corpusComplete: Boolean(a.has_embeddings) && a.ingestion_status === "ready" })),
    );

    const localByTarget = new Map();
    for (const e of unresolvedLive) {
      const hit = index.lookupCitation(e.raw_citation, e.normalized_citation);
      if (hit.kind !== "one") continue;
      const auth = authorityRows.find((a) => a.id === hit.authorityId);
      const corpusComplete = Boolean(auth?.has_embeddings) && auth?.ingestion_status === "ready";
      const n = await resolveEdgeRow(e, hit.authorityId, hit.method, hit.evidence, corpusComplete);
      if (!n) continue;
      localEdges += 1;
      localOld += 1;
      const key = targetKey(e.raw_citation, e.normalized_citation);
      if (!localByTarget.has(key)) localByTarget.set(key, hit.method);
    }
    localTargets = localByTarget.size;
    console.log(JSON.stringify({ phase: "LOCAL_FIRST", localTargets, localEdges, localOld, clAvoided: localTargets }, null, 2));

    const presentCiteSet = new Set(
      authorityRows.flatMap((a) => [a.citation, a.normalized_citation].filter(Boolean).map((c) => normalizeLoose(c).toLowerCase())),
    );
    let candidatesBefore = 0;
    const strictQueue = [];
    for (const row of absentRows) {
      const parsed = parseCitation(row.cite);
      if (!parsed) continue;
      candidatesBefore += 1;
      if (presentCiteSet.has(parsed.citation.toLowerCase())) continue;
      const el = classifyCaseCitationLookupEligibility(parsed.citation, parsed.citation);
      if (!el.eligible) continue;
      const q = qualifyStrictAbsent(row, parsed);
      if (!q) continue;
      const localHit = index.lookupCitation(parsed.citation, parsed.citation);
      strictQueue.push({
        ...parsed,
        rawCite: row.cite,
        normalizedCitation: experimentalNormalize(parsed.citation) || parsed.citation,
        ...q,
        localResolvable: localHit.kind === "one",
        localMethod: localHit.kind === "one" ? localHit.method : null,
        externalIdentityRequired: localHit.kind !== "one",
        benchmarkRelevance: BENCHMARK_RE.test(parsed.citation),
      });
    }
    strictQueue.sort((a, b) => b.score - a.score || b.concentration - a.concentration || b.practice - a.practice);

    const avgConcentration =
      strictQueue.length > 0 ? strictQueue.reduce((s, t) => s + t.concentration, 0) / strictQueue.length : 0;

    writeJson(QUEUE_JSON, {
      generatedAt: new Date().toISOString(),
      candidatesBeforeFilter: candidatesBefore,
      qualified: strictQueue.length,
      averagePracticeConcentration: avgConcentration,
      topTargets: strictQueue.slice(0, 40).map((t) => ({
        rawCitation: t.rawCite,
        normalizedCitation: t.normalizedCitation,
        reporter: t.family,
        demand: t.edges,
        uniqueCiters: t.uniqueCiters,
        ca3: t.ca3,
        edpa: t.edpa,
        pa: t.pa,
        other: t.other,
        concentration: Number(t.concentration.toFixed(3)),
        benchmarkRelevance: t.benchmarkRelevance,
        signals: t.signals,
        reason: t.reason,
        externalIdentityRequired: t.externalIdentityRequired,
      })),
      note: "Reporter alone insufficient; require ≥2 practice signals + concentration floor",
    });

    console.log(
      JSON.stringify(
        {
          phase: "STRICT_QUEUE",
          candidatesBefore,
          qualified: strictQueue.length,
          avgConcentration,
          top: strictQueue.slice(0, 15).map((t) => ({
            citation: t.citation,
            ca3: t.ca3,
            edpa: t.edpa,
            pa: t.pa,
            conc: Number(t.concentration.toFixed(2)),
            reason: t.reason,
          })),
        },
        null,
        2,
      ),
    );

    // Local-resolve strict targets that match
    for (const t of strictQueue) {
      if (!t.localResolvable) continue;
      const key = targetKey(t.citation, t.normalizedCitation);
      const n = await backfillKey(key, index.lookupCitation(t.citation, t.citation).authorityId, t.localMethod, ["strict_local"], true);
      if (n > 0) {
        localTargets += 1;
        localEdges += n;
        localOld += n;
        t.externalIdentityRequired = false;
        t.status = "LOCAL_RESOLVED";
      }
    }

    const moScored = moRows.map(scoreMoAuth).filter((t) => t.qualityTier === "A").sort((a, b) => b.productScore - a.productScore);

    // ===== ONE QUOTA PROBE =====
    const quota = await probeQuota(apiKey);
    totalCl = 1;
    quotaProbed = true;
    minuteRem = Number(quota.minute?.remaining ?? 0);
    hourRem = Number(quota.hour?.remaining ?? 0);
    dayRem = Number(quota.day?.remaining ?? 0);
    console.log(JSON.stringify({ quotaGate: { minuteRem, hourRem, dayRem, membership: quota.membership } }, null, 2));

    if (!quota.ok || hourRem < 280) {
      stopReason = "HOURLY_WINDOW_NOT_READY";
      console.log(JSON.stringify({ ok: false, stopReason, classification: "STRICT_PRACTICE_AUTHORITY_RUN", totalCl }));
    } else if (dayRem < 300) {
      stopReason = "DAILY_CAPACITY_TOO_LOW_FOR_FULL_RUN";
      console.log(JSON.stringify({ ok: false, stopReason, classification: "STRICT_PRACTICE_AUTHORITY_RUN", totalCl }));
    } else {
      TOTAL_CL_CAP = Math.min(270, hourRem - 25, dayRem - 50);
      console.log(JSON.stringify({ budget: { TOTAL_CL_CAP, MAX_IDENTITY_CL, runStartLocal: RUN_START_LOCAL } }));

      async function acquireFullText({ authorityId, clusterId, cluster, opinionText, title, decisionDate, courtMeta, citation, createdNew }) {
        const bucket = courtMeta.bucket || "OTHER";
        if (!juris[bucket]) juris[bucket] = { attempted: 0, completed: 0, failed: 0 };
        juris[bucket].attempted += 1;
        ftAttempted += 1;

        const contentHash = sha256(opinionText);
        const versionId = crypto.randomUUID();
        const [verRow] = await sql`
          select coalesce(max(version_number), 0)::int as v from legal_authority_versions where authority_id = ${authorityId}
        `;
        const nextVersion = Number(verRow.v) + 1;
        await sql`update legal_authority_versions set valid_to = now() where authority_id = ${authorityId} and valid_to is null`;
        const [authMeta] = await sql`select metadata, citation from legal_authorities where id = ${authorityId}`;
        const meta = authMeta?.metadata && typeof authMeta.metadata === "object" ? { ...authMeta.metadata } : {};
        meta.identityOnly = false;
        meta.corpusComplete = true;
        meta.fullTextAcquisition = {
          batch: BATCH,
          clusterId: String(clusterId),
          acquiredAt: new Date().toISOString(),
          contentHash,
          courtBucket: bucket,
        };
        const cites = collectClusterCites(cluster);
        meta.citationAliases = [...new Set([...(meta.citationAliases || []), citation, authMeta?.citation, ...cites].filter(Boolean))].slice(0, 24);
        meta.parallelCitations = [...new Set([...(meta.parallelCitations || []), ...cites].filter(Boolean))].slice(0, 24);

        await sql`
          update legal_authorities set
            title = ${String(title).slice(0, 500)},
            court = coalesce(${courtMeta.courtName}, court),
            court_id = coalesce(${courtMeta.courtId}, court_id),
            decision_date = coalesce(${decisionDate}, decision_date),
            canonical_source_url = ${`https://www.courtlistener.com/opinion/${clusterId}/`},
            metadata = ${sql.json(meta)},
            ingestion_status = 'processing'::authority_ingestion_status,
            last_checked_at = now(),
            updated_at = now()
          where id = ${authorityId}
        `;
        await sql`
          insert into legal_authority_versions (
            id, authority_id, version_number, content, effective_from, effective_to,
            source_provider, source_metadata, sha256
          ) values (
            ${versionId}, ${authorityId}, ${nextVersion}, ${opinionText},
            ${decisionDate}, ${null}, ${SOURCE},
            ${sql.json({ adapter: BATCH, clusterId: String(clusterId) })},
            ${contentHash}
          )
        `;
        await sql`delete from legal_authority_chunks where authority_id = ${authorityId}`;
        const chunks = chunkContent(opinionText);
        const vectors = await embedAll(chunks, openaiKey);
        for (let i = 0; i < chunks.length; i++) {
          await sql`
            insert into legal_authority_chunks (
              id, authority_id, authority_version_id, chunk_index, content,
              segment_ref, char_start, char_end, embedding, embedding_model
            ) values (
              ${crypto.randomUUID()}, ${authorityId}, ${versionId}, ${i}, ${chunks[i]},
              ${`p${i + 1}`}, ${null}, ${null}, ${toPgvector(vectors[i])}::vector,
              ${`${EMBEDDING_MODEL}:${EMBEDDING_DIMS}`}
            )
          `;
        }
        const citeResult = await ensureCaseCitationExtraction(sql, {
          authorityId,
          content: opinionText,
          existingMetadata: meta,
        });
        await sql`
          update legal_authorities
          set ingestion_status = 'ready'::authority_ingestion_status, updated_at = now()
          where id = ${authorityId}
        `;

        const newEdgesTotal = Number(citeResult.inserted || 0);
        ftNewEdgesTotal += newEdgesTotal;
        const newEdgeRows = await sql`
          select to_authority_id from legal_authority_citations
          where from_authority_id = ${authorityId}
          order by created_at desc
          limit ${Math.max(newEdgesTotal, 1)}
        `;
        let imm = 0;
        let still = 0;
        for (const er of newEdgeRows.slice(0, newEdgesTotal)) {
          if (er.to_authority_id) imm += 1;
          else still += 1;
        }
        ftNewImm += imm;
        ftNewStill += still;

        const aidx = authorityRows.findIndex((a) => a.id === authorityId);
        const rowObj = {
          id: authorityId,
          citation,
          normalized_citation: experimentalNormalize(citation) || citation,
          metadata: meta,
          source_external_id: `cl-cluster-${clusterId}`,
          source_provider: SOURCE,
          title,
          court: courtMeta.courtName,
          court_id: courtMeta.courtId,
          ingestion_status: "ready",
          has_embeddings: true,
          corpusComplete: true,
        };
        if (aidx >= 0) authorityRows[aidx] = { ...authorityRows[aidx], ...rowObj };
        else authorityRows.push(rowObj);
        index = rebuildIndex(
          authorityRows.map((a) => ({
            ...a,
            corpusComplete: Boolean(a.has_embeddings) && a.ingestion_status === "ready",
          })),
        );

        let oldBackfilled = 0;
        const authCiteKeys = new Set(
          [citation, authMeta?.citation, ...(meta.citationAliases || []), ...(meta.parallelCitations || [])]
            .filter(Boolean)
            .map((c) => targetKey(c, c)),
        );
        if (authCiteKeys.size) {
          const stillUnresolved = await sql`
            select id, from_authority_id, raw_citation, normalized_citation
            from legal_authority_citations where to_authority_id is null
          `;
          for (const e of stillUnresolved) {
            const key = targetKey(e.raw_citation, e.normalized_citation);
            if (!authCiteKeys.has(key)) continue;
            const hit = index.lookupCitation(e.raw_citation, e.normalized_citation);
            if (hit.kind !== "one" || hit.authorityId !== authorityId) continue;
            oldBackfilled += await resolveEdgeRow(e, authorityId, hit.method, hit.evidence || ["fulltext_alias_backfill"], true);
          }
        }
        ftOld += oldBackfilled;
        if (createdNew) newAuthoritiesCreated += 1;
        else metadataToComplete += 1;
        ftAcquired += 1;
        juris[bucket].completed += 1;

        results.push({
          citation,
          caseName: title,
          authorityId,
          clusterId: String(clusterId),
          courtBucket: bucket,
          status: "acquired_corpus_complete",
          createdNew: Boolean(createdNew),
          lane: createdNew ? "strict_absent" : "metadata_only",
          embeddedChunks: chunks.length,
          NEW_EDGES_TOTAL: newEdgesTotal,
          NEW_EDGES_RESOLVED_IMMEDIATELY: imm,
          NEW_EDGES_STILL_UNRESOLVED: still,
          OLD_EDGES_BACKFILLED: oldBackfilled,
        });
        console.log(
          JSON.stringify({
            acquired: ftAcquired,
            citation,
            courtBucket: bucket,
            createdNew: Boolean(createdNew),
            chunks: chunks.length,
            totalCl,
          }),
        );
      }

      // ---- PHASE A: STRICT IDENTITY (max 40) ----
      const externalTargets = strictQueue.filter((t) => t.externalIdentityRequired && t.status !== "LOCAL_RESOLVED");
      for (const target of externalTargets) {
        if (stopReason !== "BATCH_COMPLETE") break;
        if (hit429) break;
        if (identityLaneStopped) break;
        if (identityCl >= MAX_IDENTITY_CL) {
          identityLaneStopped = true;
          earlyDecisionReason = earlyDecisionReason || "MAX_IDENTITY_CL_40";
          break;
        }
        if (totalCl + 1 > TOTAL_CL_CAP) {
          stopReason = "QUOTA_SAFETY_THRESHOLD";
          break;
        }

        lookupAttempted += 1;
        identityCl += 1;
        const look = await clGet("/citation-lookup/", "POST", { text: target.citation });
        if (look.status === 429 || hit429) {
          hit429 = true;
          stopReason = "HTTP_429";
          writeJson(path.join(CHECKPOINT_DIR, `strict-practice-429-${Date.now()}.json`), {
            totalCl,
            identityCl,
            retryAfter: look.retryAfter,
          });
          break;
        }
        if (!look.ok) {
          lookupFail += 1;
          identityResults.push({ citation: target.citation, status: "PROVIDER_FAILURE" });
          continue;
        }

        const body = look.body;
        const rows = Array.isArray(body) ? body : Array.isArray(body?.results) ? body.results : [];
        let matched = null;
        for (const row of rows) {
          const clusters = Array.isArray(row.clusters) ? row.clusters : row.cluster ? [row.cluster] : [];
          for (const cluster of clusters) {
            const cites = collectClusterCites(cluster);
            const statusOk = row.status == null || Number(row.status) === 200;
            if (statusOk && cites.some((c) => citationMatchesTarget(c, target))) {
              matched = { cluster, cites, clusterId: cluster.id || cluster.cluster_id || null };
              break;
            }
          }
          if (matched) break;
        }
        if (!matched || !matched.clusterId) {
          const parsed = parseCitationLookupResponse(body);
          if (parsed.status === "ambiguous") {
            lookupAmb += 1;
            identityResults.push({ citation: target.citation, status: "AMBIGUOUS" });
          } else if (parsed.status === "resolved" && parsed.clusterId) {
            matched = {
              cluster: { id: parsed.clusterId, court: parsed.court, case_name: parsed.caseName },
              cites: parsed.citations || [],
              clusterId: parsed.clusterId,
            };
          } else {
            lookupNf += 1;
            identityResults.push({ citation: target.citation, status: "NOT_FOUND" });
          }
        }

        if (matched?.clusterId) {
          // Refresh cluster for court classification
          let cluster = matched.cluster;
          if (totalCl < TOTAL_CL_CAP) {
            const clBefore = totalCl;
            const clusterRes = await clGet(`/clusters/${matched.clusterId}/`);
            // cluster fetch counts toward identity diagnostic (court verification)
            identityCl += totalCl - clBefore;
            if (clusterRes.ok) cluster = clusterRes.body;
            else if (clusterRes.status === 429) {
              hit429 = true;
              stopReason = "HTTP_429";
              break;
            }
          }
          if (!cluster.court_id && !cluster.court && cluster.docket && totalCl < TOTAL_CL_CAP) {
            const docketUrl =
              typeof cluster.docket === "string" ? cluster.docket.replace(CL_BASE, "") : `/dockets/${cluster.docket_id}/`;
            if (docketUrl.startsWith("/")) {
              const dRes = await clGet(docketUrl);
              identityCl += 1;
              if (dRes.ok && dRes.body) {
                cluster = { ...cluster, court_id: dRes.body.court_id || cluster.court_id, court: dRes.body.court || cluster.court };
              }
            }
          }

          const courtMeta = mapCourtMeta(cluster);
          const bucket = courtMeta.bucket;
          lookupHigh += 1;
          if (isTargetPracticeCourt(bucket)) lookupTargetHigh += 1;
          else lookupOtherHigh += 1;

          // Persist identity (even for non-target courts)
          const ext = `cl-cluster-${matched.clusterId}`;
          const existing = await sql`
            select id, ingestion_status,
              exists(select 1 from legal_authority_chunks c where c.authority_id=legal_authorities.id and c.embedding is not null) as has_embeddings
            from legal_authorities where source_provider=${SOURCE} and source_external_id=${ext} limit 2
          `;
          let authorityId = null;
          let createdNew = false;
          let corpusComplete = false;
          if (existing.length > 1) {
            lookupAmb += 1;
            lookupHigh -= 1;
            if (isTargetPracticeCourt(bucket)) lookupTargetHigh -= 1;
            else lookupOtherHigh -= 1;
            identityResults.push({ citation: target.citation, status: "AMBIGUOUS_DUP_EXT" });
          } else if (existing.length === 1) {
            authorityId = existing[0].id;
            corpusComplete = Boolean(existing[0].has_embeddings) && existing[0].ingestion_status === "ready";
            const [full] = await sql`select metadata from legal_authorities where id=${authorityId}`;
            const meta = full?.metadata && typeof full.metadata === "object" ? { ...full.metadata } : {};
            meta.citationAliases = [...new Set([...(meta.citationAliases || []), target.citation, ...(matched.cites || [])].filter(Boolean))].slice(
              0,
              24,
            );
            meta.parallelCitations = [...new Set([...(meta.parallelCitations || []), ...(matched.cites || [])].filter(Boolean))].slice(0, 24);
            await sql`
              update legal_authorities set
                court = coalesce(${courtMeta.courtName}, court),
                court_id = coalesce(${courtMeta.courtId}, court_id),
                metadata = ${sql.json(meta)},
                last_checked_at = now(), updated_at = now()
              where id = ${authorityId}
            `;
          } else {
            authorityId = crypto.randomUUID();
            createdNew = true;
            await sql`
              insert into legal_authorities (
                id, authority_type, jurisdiction, court, court_id, title, citation, normalized_citation,
                decision_date, source_provider, source_external_id, canonical_source_url,
                metadata, ingestion_status, created_at, updated_at, last_checked_at
              ) values (
                ${authorityId}, 'case', ${courtMeta.jurisdiction}, ${courtMeta.courtName}, ${courtMeta.courtId},
                ${cluster.case_name || cluster.case_name_full || target.citation}, ${target.citation},
                ${experimentalNormalize(target.citation) || target.citation},
                ${cluster.date_filed ? String(cluster.date_filed).slice(0, 10) : null},
                ${SOURCE}, ${ext},
                ${`https://www.courtlistener.com/api/rest/v4/clusters/${matched.clusterId}/`},
                ${sql.json({
                  adapter: BATCH,
                  identityOnly: !isTargetPracticeCourt(bucket),
                  corpusComplete: false,
                  clClusterId: String(matched.clusterId),
                  parallelCitations: matched.cites || [],
                  citationAliases: [target.citation, ...(matched.cites || [])].slice(0, 24),
                  identityResolution: {
                    method: "COURTLISTENER_CITATION_LOOKUP",
                    clusterId: String(matched.clusterId),
                    batch: BATCH,
                    resolverVersion: RESOLVER_VERSION,
                    verifiedCourt: bucket,
                  },
                })},
                'pending'::authority_ingestion_status, now(), now(), now()
              )
            `;
            authorityRows.push({
              id: authorityId,
              citation: target.citation,
              normalized_citation: experimentalNormalize(target.citation) || target.citation,
              metadata: {},
              source_external_id: ext,
              source_provider: SOURCE,
              title: cluster.case_name,
              court: courtMeta.courtName,
              court_id: courtMeta.courtId,
              ingestion_status: "pending",
              has_embeddings: false,
            });
            if (!isTargetPracticeCourt(bucket)) newAuthoritiesCreated += 1; // identity-only stub; FT path also counts
          }

          if (authorityId) {
            index = rebuildIndex(
              authorityRows.map((a) => ({
                ...a,
                corpusComplete: Boolean(a.has_embeddings) && a.ingestion_status === "ready",
              })),
            );
            const bf = await backfillKey(
              targetKey(target.citation, target.normalizedCitation),
              authorityId,
              "COURTLISTENER_CITATION_LOOKUP",
              [`cluster:${matched.clusterId}`, `court:${bucket}`],
              corpusComplete,
            );
            idOld += bf;

            identityResults.push({
              citation: target.citation,
              status: "HIGH_RESOLVED",
              courtBucket: bucket,
              targetCourt: isTargetPracticeCourt(bucket),
              authorityId,
              createdNew,
              oldEdges: bf,
            });

            // FULL TEXT only for target practice courts
            if (isTargetPracticeCourt(bucket) && !corpusComplete && totalCl + 2 <= TOTAL_CL_CAP) {
              const opinionId = pickOpinionId(cluster);
              if (opinionId) {
                const clBeforeOp = totalCl;
                const opRes = await clGet(`/opinions/${opinionId}/`);
                fullTextCl += totalCl - clBeforeOp;
                if (opRes.status === 429) {
                  hit429 = true;
                  stopReason = "HTTP_429";
                  break;
                }
                if (opRes.ok) {
                  const text = pickText(opRes.body);
                  if (text.length >= 80) {
                    await acquireFullText({
                      authorityId,
                      clusterId: matched.clusterId,
                      cluster,
                      opinionText: text,
                      title: cluster.case_name || cluster.case_name_full || target.citation,
                      decisionDate: cluster.date_filed ? String(cluster.date_filed).slice(0, 10) : null,
                      courtMeta,
                      citation: target.citation,
                      createdNew,
                    });
                  } else {
                    ftFailed += 1;
                    juris[bucket].failed += 1;
                  }
                } else {
                  ftFailed += 1;
                }
              }
            } else if (!isTargetPracticeCourt(bucket)) {
              results.push({
                citation: target.citation,
                status: "identity_persisted_no_fulltext",
                courtBucket: bucket,
                authorityId,
                reason: "non_target_court",
              });
            }
          }
        }

        // Early decision after 20 identity *lookups* (not counting cluster refreshes in attempted)
        if (lookupAttempted === EARLY_DECISION_AT) {
          const highRate = lookupHigh / lookupAttempted;
          const ambRate = lookupAmb / lookupAttempted;
          const targetShare = lookupHigh > 0 ? lookupTargetHigh / lookupHigh : 0;
          continuedAfter20 =
            highRate >= 0.4 && ambRate <= 0.45 && targetShare >= 0.25;
          earlyDecisionReason = continuedAfter20
            ? `continue HIGH=${(highRate * 100).toFixed(1)}% amb=${(ambRate * 100).toFixed(1)}% targetShare=${(targetShare * 100).toFixed(1)}%`
            : `pivot HIGH=${(highRate * 100).toFixed(1)}% amb=${(ambRate * 100).toFixed(1)}% targetShare=${(targetShare * 100).toFixed(1)}%`;
          console.log(JSON.stringify({ earlyDecision: { continuedAfter20, earlyDecisionReason, lookupHigh, lookupAmb, lookupTargetHigh } }));
          if (!continuedAfter20) {
            identityLaneStopped = true;
            break;
          }
        }

        if (lookupAttempted % 10 === 0) {
          const health = await healthSnapshot(sql);
          writeJson(path.join(CHECKPOINT_DIR, `strict-practice-id-cp-${lookupAttempted}.json`), {
            lookupAttempted,
            lookupHigh,
            lookupTargetHigh,
            lookupAmb,
            totalCl,
            green: health.green,
          });
          if (!health.green) {
            stopReason = "HEALTH_NOT_GREEN";
            break;
          }
        }
      }

      // ---- PHASE B: HIGH-VALUE METADATA-ONLY FULLTEXT ----
      if (stopReason === "BATCH_COMPLETE" && !hit429) {
        console.log(JSON.stringify({ phase: "PHASE_B_METADATA_ONLY", moTierA: moScored.length, totalCl, TOTAL_CL_CAP }));
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

          const clBefore = totalCl;
          const clusterRes = await clGet(`/clusters/${clusterId}/`);
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
          const courtMeta = mapCourtMeta(cluster);
          // Prefer target courts if present among MO; otherwise allow SCOTUS/federal
          if (!isTargetPracticeCourt(courtMeta.bucket) && courtMeta.bucket !== "SCOTUS" && courtMeta.bucket !== "OTHER_FEDERAL") {
            // still allow if bucket OTHER but citation is SCOTUS-shaped
            if (cand.courtBucket !== "SCOTUS") continue;
            courtMeta.bucket = "SCOTUS";
            courtMeta.courtId = courtMeta.courtId || "us-scotus";
            courtMeta.courtName = courtMeta.courtName || "Supreme Court of the United States";
          }

          const opinionId = pickOpinionId(cluster);
          if (!opinionId) {
            ftFailed += 1;
            continue;
          }
          const clBeforeOp = totalCl;
          const opRes = await clGet(`/opinions/${opinionId}/`);
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
          await acquireFullText({
            authorityId: cand.id,
            clusterId,
            cluster,
            opinionText: text,
            title: cluster.case_name || cluster.case_name_full || cand.title || cand.citation,
            decisionDate: cluster.date_filed ? String(cluster.date_filed).slice(0, 10) : null,
            courtMeta,
            citation: cand.citation,
            createdNew: false,
          });

          if (ftAcquired % 5 === 0) {
            const health = await healthSnapshot(sql);
            writeJson(path.join(CHECKPOINT_DIR, `strict-practice-ft-cp-${ftAcquired}.json`), {
              lane: "metadata_only",
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

    const measuredHourRemaining = hourRem != null ? Math.max(0, hourRem - (totalCl - (quotaProbed ? 1 : 0))) : null;
    const measuredDayRemaining = dayRem != null ? Math.max(0, dayRem - (totalCl - (quotaProbed ? 1 : 0))) : null;
    const ccDelta = end.CORPUS_COMPLETE_EDGES - start.CORPUS_COMPLETE_EDGES;
    const oldThisRun = localOld + idOld + ftOld;
    const oldTotal = OLD_PROGRESS_BEFORE + oldThisRun;
    const highRate = lookupAttempted > 0 ? lookupHigh / lookupAttempted : 0;
    const ambRate = lookupAttempted > 0 ? lookupAmb / lookupAttempted : 0;
    const targetShare = lookupHigh > 0 ? lookupTargetHigh / lookupHigh : 0;

    let nextDecision = "CONTINUE_HIGH_VALUE_METADATA_FULLTEXT";
    let nextBudget = 200;
    let finalClass = "STRICT_PRACTICE_MODERATE";
    if (stopReason === "HOURLY_WINDOW_NOT_READY" || stopReason === "DAILY_CAPACITY_TOO_LOW_FOR_FULL_RUN") {
      finalClass = "STRICT_PRACTICE_BLOCKED";
      nextDecision = "PAUSE_FOR_QUOTA_RECOVERY";
      nextBudget = 0;
    } else if (hit429 || stopReason === "HEALTH_NOT_GREEN" || !end.green) {
      finalClass = "STRICT_PRACTICE_BLOCKED";
      nextDecision = "PAUSE_FOR_QUOTA_RECOVERY";
      nextBudget = 0;
    } else if (
      juris.CA3.completed + juris.EDPA.completed + juris.PA_SUPREME.completed + juris.PA_SUPERIOR.completed + juris.PA_COMMONWEALTH.completed >=
        5 &&
      highRate >= 0.4
    ) {
      finalClass = "STRICT_PRACTICE_STRONG";
      nextDecision = "CONTINUE_STRICT_PRACTICE_ACQUISITION";
      nextBudget = Math.min(270, Math.max(0, (measuredHourRemaining || 0) - 25));
    } else if (ftAcquired >= 10 || metadataToComplete >= 10) {
      finalClass = "STRICT_PRACTICE_MODERATE";
      nextDecision = "CONTINUE_HIGH_VALUE_METADATA_FULLTEXT";
      nextBudget = Math.min(200, Math.max(0, (measuredHourRemaining || 0) - 25));
    } else if (ftAcquired > 0) {
      finalClass = "STRICT_PRACTICE_WEAK";
      nextDecision = "CONTINUE_HIGH_VALUE_METADATA_FULLTEXT";
      nextBudget = Math.min(150, Math.max(0, (measuredHourRemaining || 0) - 25));
    } else {
      finalClass = "STRICT_PRACTICE_WEAK";
      nextDecision = "RETURN_TO_PRODUCT_WORK";
      nextBudget = 0;
    }
    if ((measuredHourRemaining != null && measuredHourRemaining < 40) || (measuredDayRemaining != null && measuredDayRemaining < 80)) {
      nextDecision = "PAUSE_FOR_QUOTA_RECOVERY";
      nextBudget = 0;
    } else if (measuredHourRemaining != null && measuredHourRemaining < 280 && nextBudget > 0) {
      nextDecision = "RUN_NEXT_FULL_HOUR_AFTER_RECOVERY";
      nextBudget = 270;
    }

    const report = {
      ok: end.green && !hit429 && !["HOURLY_WINDOW_NOT_READY", "DAILY_CAPACITY_TOO_LOW_FOR_FULL_RUN"].includes(stopReason),
      classification: "STRICT_PRACTICE_AUTHORITY_RUN",
      runStartLocal: RUN_START_LOCAL,
      stopReason,
      courtListener: {
        quotaProbeRequests: quotaProbed ? 1 : 0,
        identityLookupCl: identityCl,
        fullTextCl,
        retryOtherCl: retryCl,
        totalClRequests: totalCl,
        minuteAtStart: minuteRem,
        hourAtStart: hourRem,
        dayAtStart: dayRem,
        estimatedHourRemaining: measuredHourRemaining,
        estimatedDayRemaining: measuredDayRemaining,
        hit429,
        hit502,
        budgetCap: TOTAL_CL_CAP,
      },
      start,
      end,
      strictQueue: {
        candidatesBeforeFilter: candidatesBefore,
        qualified: strictQueue.length,
        averagePracticeConcentration: avgConcentration,
        topTargets: strictQueue.slice(0, 20).map((t) => ({
          citation: t.citation,
          demand: t.edges,
          ca3: t.ca3,
          edpa: t.edpa,
          pa: t.pa,
          other: t.other,
          concentration: Number(t.concentration.toFixed(3)),
          reason: t.reason,
        })),
      },
      localFirst: {
        targetsResolved: localTargets,
        oldEdgesResolved: localOld,
        newEdgesResolved: localNew,
        clAvoided: localTargets,
      },
      identity: {
        cl: identityCl,
        attempted: lookupAttempted,
        HIGH: lookupHigh,
        targetCourtHigh: lookupTargetHigh,
        otherCourtHigh: lookupOtherHigh,
        ambiguous: lookupAmb,
        notFound: lookupNf,
        providerFailures: lookupFail,
        oldUnresolvedResolved: idOld,
        highRate,
        ambiguityRate: ambRate,
        targetCourtShareOfHigh: targetShare,
        continuedAfter20,
        earlyDecisionReason,
        results: identityResults,
      },
      acquisition: {
        attempted: ftAttempted,
        completed: ftAcquired,
        failed: ftFailed,
        newAuthoritiesCreated,
        metadataOnlyToCorpusComplete: metadataToComplete,
        byCourt: juris,
      },
      citations: {
        NEW_EDGES_TOTAL: ftNewEdgesTotal,
        NEW_EDGES_RESOLVED_IMMEDIATELY: ftNewImm,
        NEW_EDGES_STILL_UNRESOLVED: ftNewStill,
        OLD_UNRESOLVED_RESOLVED: oldThisRun,
        CORPUS_COMPLETE_EDGES_start: start.CORPUS_COMPLETE_EDGES,
        CORPUS_COMPLETE_EDGES_end: end.CORPUS_COMPLETE_EDGES,
        delta: ccDelta,
      },
      historical15k: {
        OLD_PROGRESS_BEFORE,
        OLD_PROGRESS_THIS_RUN: oldThisRun,
        OLD_PROGRESS_TOTAL: oldTotal,
        OLD_REMAINING_TO_15000: Math.max(0, WEEKEND_TARGET - oldTotal),
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
        ca3: juris.CA3.completed,
        edpa: juris.EDPA.completed,
        pa: juris.PA_SUPREME.completed + juris.PA_SUPERIOR.completed + juris.PA_COMMONWEALTH.completed,
        scotusFederal: juris.SCOTUS.completed + juris.OTHER_FEDERAL.completed,
        major: results.filter((r) => r.status === "acquired_corpus_complete").map((r) => `${r.citation} [${r.courtBucket}]`),
      },
      nextDecision,
      nextRecommendedClBudget: nextBudget,
      results,
      checkpoints,
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
          identityCl,
          fullTextCl,
          lookupAttempted,
          lookupHigh,
          lookupTargetHigh,
          lookupOtherHigh,
          lookupAmb,
          continuedAfter20,
          earlyDecisionReason,
          ftAcquired,
          metadataToComplete,
          juris: Object.fromEntries(Object.entries(juris).map(([k, v]) => [k, v.completed])),
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
