/**
 * High-value METADATA_ONLY → CORPUS_COMPLETE full-text acquisition.
 * No bulk identity lookup. Neon production only. No markdown reports.
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
} = require("../packages/research/src/corpus/citation-resolution/cjs-bridge.cjs");

let TOTAL_CL_CAP = 175;
const RATE_MS = 4000;
const CL_BASE = "https://www.courtlistener.com/api/rest/v4";
const SOURCE = "courtlistener";
const BATCH = "high-value-fulltext-run1";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS = 384;
const MAX_OPINION_CHARS = 40_000;
const MAX_CHUNK_CHARS = 1000;

const ROOT = path.join(__dirname, "..");
const CHECKPOINT_DIR = path.join(ROOT, "packages/research/corpus/resolution/checkpoints");
const LEDGER_PATH = path.join(ROOT, "packages/research/corpus/resolution/ledger/cl-high-value-fulltext-run1-2026-10-10.jsonl");
const REPORT_JSON = path.join(ROOT, "packages/research/corpus/reports/corpus-high-value-fulltext-run1-2026-10-10.json");
const POLICY_JSON = path.join(ROOT, "packages/research/corpus/resolution/long-tail-identity-policy-2026-10-10.json");
const RUN_START_LOCAL = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });

const BENCHMARK_RE =
  /\b(twombly|iqbal|miranda|brady|giglio|strickland|terry|katz|carpenter|riley|mapp|gideon|chevron|lujan|monell|monroe|parratt|mathews|cleveland board|daubert|celotex|anderson v\. liberty|heck|bivens|qualified immunity|search|seizure|suppression|warrant|standing|pleadings?|summary judgment)\b/i;

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

function inferCourtBucket(cite, title, courtId, court, ca3, edpa, pa) {
  const c = `${cite || ""} ${title || ""} ${courtId || ""} ${court || ""}`.toLowerCase();
  if (/\bu\.?\s*s\.?\b/.test(cite || "") || /\bs\.?\s*ct\b/i.test(cite || "") || /wall\.|how\.|cranch|pet\./i.test(cite || "") || /us-scotus|supreme court of the united states/.test(c)) {
    return "SCOTUS";
  }
  if (ca3 > 0 && /f\.\s*(2d|3d|4th)/i.test(cite || "")) return "CA3";
  if (edpa > 0 && /f\.\s*supp/i.test(cite || "")) return "EDPA";
  if (pa > 0 && (/\ba\.\s*(2d|3d)\b/i.test(cite || "") || /\bpa\b/i.test(cite || ""))) return "PA";
  if (/us-ca-3|third circuit/.test(c)) return "CA3";
  if (/us-d-paed|paed|eastern district of pennsylvania/.test(c)) return "EDPA";
  if (/st-pa|pennsylvania/.test(c)) return "PA";
  if (/f\.\s*(2d|3d|4th)/i.test(cite || "") || /us-ca-/.test(c)) return "OTHER_FEDERAL";
  if (/f\.\s*supp/i.test(cite || "") || /us-d-/.test(c)) return "OTHER_FEDERAL";
  if (/\ba\.\s*(2d|3d)\b/i.test(cite || "") || /\bp\.\s*(2d|3d)\b/i.test(cite || "")) return "STATE";
  if (ca3 + edpa + pa >= 2) return "OTHER_FEDERAL";
  return "OTHER";
}

function scoreAuthority(row) {
  const cite = String(row.citation || "");
  const title = String(row.title || "");
  const inbound = Number(row.inbound || 0);
  const uniqueCiters = Number(row.unique_citers || 0);
  const ca3 = Number(row.ca3_citers || 0);
  const edpa = Number(row.edpa_citers || 0);
  const pa = Number(row.pa_citers || 0);
  const bucket = inferCourtBucket(cite, title, row.court_id, row.court, ca3, edpa, pa);
  let score = 0;
  const reasons = [];

  if (bucket === "SCOTUS") {
    score += 100;
    reasons.push("SCOTUS/controlling");
  } else if (bucket === "CA3") {
    score += 85;
    reasons.push("CA3");
  } else if (bucket === "EDPA") {
    score += 75;
    reasons.push("EDPA");
  } else if (bucket === "PA") {
    score += 70;
    reasons.push("PA");
  } else if (bucket === "OTHER_FEDERAL") {
    score += 40;
    reasons.push("federal");
  } else if (bucket === "STATE") {
    score += 25;
    reasons.push("state");
  }

  score += Math.min(60, inbound * 2);
  score += Math.min(40, uniqueCiters * 4);
  if (inbound >= 10) reasons.push(`high demand (${inbound})`);
  if (uniqueCiters >= 6) reasons.push(`unique citers (${uniqueCiters})`);

  score += Math.min(40, ca3 * 4);
  score += Math.min(35, edpa * 5);
  score += Math.min(30, pa * 4);
  if (ca3 >= 2) reasons.push(`CA3 practice (${ca3})`);
  if (edpa >= 1) reasons.push(`EDPA practice (${edpa})`);
  if (pa >= 1) reasons.push(`PA practice (${pa})`);

  if (BENCHMARK_RE.test(title) || BENCHMARK_RE.test(cite)) {
    score += 35;
    reasons.push("benchmark/doctrine");
  }
  if (/\bU\.?\s*S\.?\b/i.test(cite) || /\bS\.?\s*Ct\b/i.test(cite)) {
    score += 20;
    reasons.push("recognized reporter");
  }
  if (/\bF\.\s*(2d|3d|4th)\b/i.test(cite) || /\bF\.\s*Supp/i.test(cite)) {
    score += 12;
    reasons.push("federal reporter");
  }

  const year = row.decision_date ? Number(String(row.decision_date).slice(0, 4)) : null;
  if (year && year >= 2000) {
    score += 12;
    reasons.push("recent");
  } else if (year && year >= 1980) {
    score += 6;
  } else if (year && year < 1950 && inbound >= 8) {
    score += 10;
    reasons.push("foundational/heavily cited");
  }

  // Product usefulness proxy: research/ask/draft benefit from reasoning text on high-demand controlling cases
  if ((bucket === "SCOTUS" || ca3 + edpa + pa >= 3) && inbound >= 5) {
    score += 15;
    reasons.push("Research/Ask/Draft value");
  }

  let tier = "C";
  if (score >= 110 || (bucket === "SCOTUS" && inbound >= 4) || ca3 + edpa + pa >= 4 || (inbound >= 12 && uniqueCiters >= 6)) {
    tier = "A";
  } else if (score >= 70 || inbound >= 6 || ca3 + edpa + pa >= 2) {
    tier = "B";
  }

  return {
    ...row,
    clusterId: String(row.source_external_id || "").replace(/^cl-cluster-/, ""),
    courtBucket: bucket,
    productScore: score,
    qualityTier: tier,
    priorityReasons: reasons,
  };
}

function selectPortfolio(tierA, maxN) {
  const groups = { SCOTUS: [], CA3: [], EDPA: [], PA: [], OTHER_FEDERAL: [], STATE: [], OTHER: [] };
  for (const t of tierA) (groups[t.courtBucket] || groups.OTHER).push(t);
  for (const k of Object.keys(groups)) groups[k].sort((a, b) => b.productScore - a.productScore);

  const selected = [];
  const seen = new Set();
  const take = (arr, n) => {
    for (const x of arr) {
      if (selected.length >= maxN) break;
      if (seen.has(x.id)) continue;
      seen.add(x.id);
      selected.push(x);
      n -= 1;
      if (n <= 0) break;
    }
  };

  // Seed portfolio across practice jurisdictions before filling with SCOTUS
  take(groups.CA3, Math.min(8, maxN));
  take(groups.EDPA, Math.min(8, maxN));
  take(groups.PA, Math.min(8, maxN));
  take(groups.OTHER_FEDERAL, Math.min(12, maxN));
  take(groups.STATE, Math.min(6, maxN));
  take(groups.SCOTUS, Math.min(Math.ceil(maxN * 0.55), maxN));
  // Fill remainder by global score
  const rest = tierA.filter((t) => !seen.has(t.id)).sort((a, b) => b.productScore - a.productScore);
  take(rest, maxN);
  return selected;
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
  let fullTextCl = 0;
  let retryCl = 0;
  const minuteRem = Number(quota.minute?.remaining ?? 0);
  const hourRem = Number(quota.hour?.remaining ?? 0);
  const dayRem = Number(quota.day?.remaining ?? 0);
  console.log(JSON.stringify({ quotaGate: { minuteRem, hourRem, dayRem, membership: quota.membership } }, null, 2));

  if (!quota.ok || hourRem < 100) {
    console.log(
      JSON.stringify({
        ok: false,
        stopReason: "INSUFFICIENT_HOURLY_CAPACITY",
        classification: "CORPUS_HIGH_VALUE_FULLTEXT_RUN",
        courtListenerHttpCalls: 1,
        minuteRem,
        hourRem,
        dayRem,
      }),
    );
    process.exit(3);
  }
  if (dayRem < 100) {
    console.log(
      JSON.stringify({
        ok: false,
        stopReason: "INSUFFICIENT_DAILY_CAPACITY",
        classification: "CORPUS_HIGH_VALUE_FULLTEXT_RUN",
        courtListenerHttpCalls: 1,
        minuteRem,
        hourRem,
        dayRem,
      }),
    );
    process.exit(3);
  }

  // Cap: max 175 including probe; leave ~25 hourly and ~40 daily headroom
  TOTAL_CL_CAP = Math.min(175, Math.max(20, hourRem - 25), Math.max(20, dayRem - 40));
  const maxAuthorities = Math.floor((TOTAL_CL_CAP - 1) / 2);
  console.log(JSON.stringify({ budget: { TOTAL_CL_CAP, maxAuthorities, MAX_FT_ONLY: true, runStartLocal: RUN_START_LOCAL } }));

  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 30, connect_timeout: 60 });
  let lastAt = Date.now();
  let hit429 = false;
  let hit502 = 0;
  let stopReason = "BATCH_COMPLETE";

  let ftAttempted = 0;
  let ftAcquired = 0;
  let ftFailed = 0;
  let ftSkippedComplete = 0;
  let ftNewEdgesTotal = 0;
  let ftNewEdgesResolvedImmediate = 0;
  let ftNewEdgesStillUnresolved = 0;
  let ftOldUnresolvedResolved = 0;
  let ftAliases = 0;
  let ftParallels = 0;
  let metadataToComplete = 0;
  let localTargetsResolved = 0;
  let externalLookupsAvoided = 0;
  const ftResults = [];
  const checkpoints = [];
  const ledgerAll = [];
  const jurisAcquired = { SCOTUS: 0, CA3: 0, EDPA: 0, PA: 0, OTHER_FEDERAL: 0, STATE: 0, OTHER: 0 };

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

  try {
    const start = await healthSnapshot(sql);
    console.log(
      JSON.stringify(
        {
          startCompleteness: {
            TOTAL_CANONICAL_AUTHORITIES: start.TOTAL_CANONICAL_AUTHORITIES,
            METADATA_ONLY_AUTHORITIES: start.METADATA_ONLY_AUTHORITIES,
            CORPUS_COMPLETE_AUTHORITIES: start.CORPUS_COMPLETE_AUTHORITIES,
            AUTHORITY_RESOLVED_EDGES: start.AUTHORITY_RESOLVED_EDGES,
            CORPUS_COMPLETE_EDGES: start.CORPUS_COMPLETE_EDGES,
            IDENTITY_UNRESOLVED_EDGES: start.IDENTITY_UNRESOLVED_EDGES,
          },
        },
        null,
        2,
      ),
    );
    if (!start.green) {
      console.log(JSON.stringify({ ok: false, stopReason: "START_HEALTH_NOT_GREEN", start, totalCl }));
      process.exit(3);
    }

    await sql.unsafe("BEGIN READ ONLY");
    const moRows = await sql`
      select a.id, a.citation, a.normalized_citation, a.title, a.court, a.court_id, a.decision_date,
             a.source_external_id, a.source_provider, a.metadata, a.ingestion_status,
             exists(select 1 from legal_authority_chunks c where c.authority_id = a.id and c.embedding is not null) as has_embeddings,
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
          or not exists (
            select 1 from legal_authority_chunks c
            where c.authority_id = a.id and c.embedding is not null
          )
        )
    `;
    let authorityRows = await sql`
      select id, citation, normalized_citation, metadata, source_external_id, source_provider,
             title, court, court_id, decision_date, ingestion_status,
             exists(select 1 from legal_authority_chunks c where c.authority_id = legal_authorities.id and c.embedding is not null) as has_embeddings
      from legal_authorities
    `;
    await sql.unsafe("COMMIT");

    const scored = moRows.map(scoreAuthority).sort((a, b) => b.productScore - a.productScore);
    const tierA = scored.filter((t) => t.qualityTier === "A");
    const tierB = scored.filter((t) => t.qualityTier === "B");
    const tierC = scored.filter((t) => t.qualityTier === "C");
    const selected = selectPortfolio(tierA, maxAuthorities);
    const top20 = tierA.slice(0, 20).map((t) => ({
      citation: t.citation,
      name: t.title,
      court: t.courtBucket,
      demand: t.inbound,
      uniqueCitingCases: t.unique_citers,
      score: t.productScore,
      reason: t.priorityReasons.join("; "),
    }));

    console.log(
      JSON.stringify(
        {
          priorityQueue: {
            totalMetadataOnly: scored.length,
            tierA: tierA.length,
            tierB: tierB.length,
            tierC: tierC.length,
            selectedForRun: selected.length,
            top20,
          },
        },
        null,
        2,
      ),
    );

    writeJson(POLICY_JSON, {
      recordedAt: new Date().toISOString(),
      bulkIdentityCurrentlyStopped: true,
      policies: {
        ">=5": "bulk external identity allowed when reporter-valid",
        "4-edge": "quality-gated external identity only",
        "3-edge": "NO BULK after measured 1.09 e/CL + 54.5% ambiguity",
        "1-2": "NO BULK",
      },
      allowLowDemandVia: [
        "future local aliases/parallels",
        "future corpus additions",
        "on-demand Research queries",
        "specific strategic need",
        "future provider/index improvements",
      ],
      governingObjective: "CORPUS_COMPLETENESS_AND_LEGAL_PRODUCT_VALUE",
    });

    let index = rebuildIndex(
      authorityRows.map((a) => ({
        ...a,
        corpusComplete: Boolean(a.has_embeddings) && a.ingestion_status === "ready",
      })),
    );

    let consecutiveFail = 0;
    for (const cand of selected) {
      if (ftAcquired >= maxAuthorities) {
        stopReason = "BUDGET_REACHED";
        break;
      }
      if (totalCl + 2 > TOTAL_CL_CAP) {
        stopReason = "QUOTA_SAFETY_THRESHOLD";
        break;
      }
      if (hit429) break;

      // Pre-acquisition safety
      const [row] = await sql`
        select id, citation, normalized_citation, title, metadata, source_external_id, ingestion_status,
          exists(select 1 from legal_authority_chunks ch where ch.authority_id = legal_authorities.id and ch.embedding is not null) as has_embeddings
        from legal_authorities where id = ${cand.id}
        limit 1
      `;
      if (!row) {
        ftFailed += 1;
        continue;
      }
      if (row.ingestion_status === "ready" && row.has_embeddings) {
        ftSkippedComplete += 1;
        continue;
      }
      if (!row.source_external_id || !String(row.source_external_id).startsWith("cl-cluster-")) {
        ftFailed += 1;
        ftResults.push({ citation: cand.citation, status: "failed", reason: "missing_cluster_id" });
        continue;
      }
      const clusterId = String(row.source_external_id).replace(/^cl-cluster-/, "");

      ftAttempted += 1;
      fullTextCl += 0; // updated via clGet accounting
      const unresolvedBeforeGlobal = (await healthSnapshot(sql)).unresolved;
      const [edgeBefore] = await sql`
        select count(*)::int as n from legal_authority_citations
        where from_authority_id = ${cand.id}
      `;
      const edgesFromAuthBefore = edgeBefore.n;

      const clBeforeCluster = totalCl;
      const clusterRes = await clGet(`/clusters/${clusterId}/`);
      fullTextCl += totalCl - clBeforeCluster;
      if (clusterRes.status === 429 || hit429) {
        hit429 = true;
        stopReason = "HTTP_429";
        ftFailed += 1;
        ftResults.push({ citation: cand.citation, status: "failed", reason: "rate_limited" });
        writeJson(path.join(CHECKPOINT_DIR, `high-value-fulltext-run1-429-${Date.now()}.json`), {
          at: new Date().toISOString(),
          totalCl,
          fullTextCl,
          ftAcquired,
        });
        break;
      }
      if (!clusterRes.ok) {
        consecutiveFail += 1;
        ftFailed += 1;
        ftResults.push({ citation: cand.citation, authorityId: cand.id, status: "failed", reason: `cluster_http_${clusterRes.status}` });
        if (consecutiveFail >= 5) {
          stopReason = "SYSTEMIC_PROVIDER_FAILURE";
          break;
        }
        continue;
      }
      const cluster = clusterRes.body;
      const opinionId = pickOpinionId(cluster);
      if (!opinionId) {
        consecutiveFail += 1;
        ftFailed += 1;
        ftResults.push({ citation: cand.citation, authorityId: cand.id, status: "failed", reason: "no_opinion_id" });
        if (consecutiveFail >= 5) {
          stopReason = "SYSTEMIC_PROVIDER_FAILURE";
          break;
        }
        continue;
      }
      if (totalCl >= TOTAL_CL_CAP) {
        stopReason = "QUOTA_SAFETY_THRESHOLD";
        break;
      }
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
        consecutiveFail += 1;
        ftFailed += 1;
        ftResults.push({ citation: cand.citation, authorityId: cand.id, status: "failed", reason: `opinion_http_${opRes.status}` });
        if (consecutiveFail >= 5) {
          stopReason = "SYSTEMIC_PROVIDER_FAILURE";
          break;
        }
        continue;
      }
      const text = pickText(opRes.body);
      if (text.length < 80) {
        consecutiveFail += 1;
        ftFailed += 1;
        ftResults.push({ citation: cand.citation, authorityId: cand.id, status: "failed", reason: "empty_opinion_text" });
        if (consecutiveFail >= 5) {
          stopReason = "ACQUISITION_QUALITY_MARGINAL";
          break;
        }
        continue;
      }
      consecutiveFail = 0;

      const contentHash = sha256(text);
      const versionId = crypto.randomUUID();
      const [verRow] = await sql`
        select coalesce(max(version_number), 0)::int as v from legal_authority_versions where authority_id = ${cand.id}
      `;
      const nextVersion = Number(verRow.v) + 1;
      await sql`
        update legal_authority_versions set valid_to = now()
        where authority_id = ${cand.id} and valid_to is null
      `;
      const title = cluster.case_name || cluster.case_name_full || cand.title || cand.citation;
      const decisionDate = cluster.date_filed ? String(cluster.date_filed).slice(0, 10) : null;
      const courtName = cluster.court || null;
      const [authMeta] = await sql`select metadata from legal_authorities where id = ${cand.id}`;
      const meta = authMeta?.metadata && typeof authMeta.metadata === "object" ? { ...authMeta.metadata } : {};
      meta.identityOnly = false;
      meta.corpusComplete = true;
      meta.fullTextAcquisition = {
        batch: BATCH,
        clusterId: String(clusterId),
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
      meta.citationAliases = [...new Set([...(meta.citationAliases || []), cand.citation, row.citation, ...cites].filter(Boolean))].slice(0, 24);
      meta.parallelCitations = [...new Set([...(meta.parallelCitations || []), ...cites].filter(Boolean))].slice(0, 24);
      ftAliases += Math.max(0, meta.citationAliases.length - aliasesBefore);
      ftParallels += Math.max(0, meta.parallelCitations.length - parallelsBefore);

      await sql`
        update legal_authorities set
          title = ${String(title).slice(0, 500)},
          court = coalesce(${courtName}, court),
          decision_date = coalesce(${decisionDate}, decision_date),
          canonical_source_url = ${`https://www.courtlistener.com/opinion/${clusterId}/`},
          metadata = ${sql.json(meta)},
          ingestion_status = 'processing'::authority_ingestion_status,
          last_checked_at = now(),
          updated_at = now()
        where id = ${cand.id}
      `;
      await sql`
        insert into legal_authority_versions (
          id, authority_id, version_number, content, effective_from, effective_to,
          source_provider, source_metadata, sha256
        ) values (
          ${versionId}, ${cand.id}, ${nextVersion}, ${text},
          ${decisionDate}, ${null}, ${SOURCE},
          ${sql.json({ adapter: BATCH, clusterId: String(clusterId), opinionId: String(opinionId) })},
          ${contentHash}
        )
      `;
      await sql`delete from legal_authority_chunks where authority_id = ${cand.id}`;
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
      const citeResult = await ensureCaseCitationExtraction(sql, {
        authorityId: cand.id,
        content: text,
        existingMetadata: meta,
      });
      await sql`
        update legal_authorities
        set ingestion_status = 'ready'::authority_ingestion_status, updated_at = now()
        where id = ${cand.id}
      `;

      const newEdgesTotal = Number(citeResult.inserted || 0);
      ftNewEdgesTotal += newEdgesTotal;
      const newEdgeRows = await sql`
        select to_authority_id from legal_authority_citations
        where from_authority_id = ${cand.id}
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

      const aidx = authorityRows.findIndex((a) => a.id === cand.id);
      if (aidx >= 0) {
        authorityRows[aidx] = {
          ...authorityRows[aidx],
          metadata: meta,
          title,
          court: courtName || authorityRows[aidx].court,
          ingestion_status: "ready",
          has_embeddings: true,
          corpusComplete: true,
        };
      } else {
        authorityRows.push({
          id: cand.id,
          citation: cand.citation,
          normalized_citation: cand.normalized_citation,
          metadata: meta,
          source_external_id: row.source_external_id,
          source_provider: SOURCE,
          title,
          court: courtName,
          ingestion_status: "ready",
          has_embeddings: true,
          corpusComplete: true,
        });
      }
      index = rebuildIndex(
        authorityRows.map((a) => ({
          ...a,
          corpusComplete: Boolean(a.has_embeddings) && a.ingestion_status === "ready",
        })),
      );

      // Deterministic backfill for this authority's citation keys only (no bulk identity)
      let oldBackfilled = 0;
      const authCiteKeys = new Set(
        [cand.citation, row.citation, ...(meta.citationAliases || []), ...(meta.parallelCitations || [])]
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
          if (hit.kind !== "one" || hit.authorityId !== cand.id) continue;
          const rows = await sql`
            update legal_authority_citations
            set to_authority_id = ${cand.id}
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
              toAuthorityId: cand.id,
              method: hit.method,
              confidence: "HIGH",
              evidence: hit.evidence || ["fulltext_alias_backfill"],
              state: "CORPUS_COMPLETE",
            }),
          );
        }
      }
      if (oldBackfilled > 0) {
        localTargetsResolved += 1;
        externalLookupsAvoided += 1;
      }
      ftOldUnresolvedResolved += oldBackfilled;
      metadataToComplete += 1;
      ftAcquired += 1;
      jurisAcquired[cand.courtBucket] = (jurisAcquired[cand.courtBucket] || 0) + 1;

      ftResults.push({
        citation: cand.citation,
        caseName: title,
        authorityId: cand.id,
        clusterId: String(clusterId),
        opinionId: String(opinionId),
        courtBucket: cand.courtBucket,
        status: "acquired_corpus_complete",
        embeddedChunks: chunks.length,
        NEW_EDGES_TOTAL: newEdgesTotal,
        NEW_EDGES_RESOLVED_IMMEDIATELY: imm,
        NEW_EDGES_STILL_UNRESOLVED: still,
        OLD_EDGES_BACKFILLED_FROM_NEW_FULLTEXT: oldBackfilled,
        unresolvedBeforeGlobal,
        productScore: cand.productScore,
        priorityReasons: cand.priorityReasons,
      });

      console.log(
        JSON.stringify({
          acquired: ftAcquired,
          citation: cand.citation,
          courtBucket: cand.courtBucket,
          chunks: chunks.length,
          newEdges: newEdgesTotal,
          oldBackfilled,
          totalCl,
        }),
      );

      if (ftAcquired % 5 === 0 || ftAcquired === 1) {
        const health = await healthSnapshot(sql);
        const cp = {
          lane: "fulltext",
          atAcquired: ftAcquired,
          totalCl,
          fullTextCl,
          ftAcquired,
          ftFailed,
          ftNewEdgesTotal,
          ftOldUnresolvedResolved,
          health: {
            green: health.green,
            METADATA_ONLY: health.METADATA_ONLY_AUTHORITIES,
            CORPUS_COMPLETE: health.CORPUS_COMPLETE_AUTHORITIES,
            CORPUS_COMPLETE_EDGES: health.CORPUS_COMPLETE_EDGES,
          },
        };
        checkpoints.push(cp);
        writeJson(path.join(CHECKPOINT_DIR, `high-value-fulltext-run1-ft-cp-${ftAcquired}.json`), cp);
        console.log(JSON.stringify({ checkpoint: cp }, null, 2));
        if (!health.green) {
          stopReason = "HEALTH_NOT_GREEN";
          break;
        }
      }
    }

    if (!selected.length) stopReason = "TIER_A_EXHAUSTED";
    else if (ftAcquired >= tierA.length && stopReason === "BATCH_COMPLETE") stopReason = "TIER_A_EXHAUSTED";
    else if (totalCl + 2 > TOTAL_CL_CAP && stopReason === "BATCH_COMPLETE") stopReason = "QUOTA_SAFETY_THRESHOLD";

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

    const measuredHourRemaining = Math.max(0, hourRem - (totalCl - 1));
    const measuredDayRemaining = Math.max(0, dayRem - (totalCl - 1));
    const ccDelta = end.CORPUS_COMPLETE_EDGES - start.CORPUS_COMPLETE_EDGES;
    const successRate = ftAttempted > 0 ? ftAcquired / ftAttempted : 0;

    let nextStrategy = "CONTINUE_HIGH_VALUE_FULLTEXT";
    let nextBudget = 150;
    let finalClass = "CORPUS_FULLTEXT_HIGH_VALUE_MODERATE";
    if (hit429 || stopReason === "HEALTH_NOT_GREEN" || !end.green) {
      nextStrategy = "PAUSE_FOR_QUOTA_RECOVERY";
      nextBudget = 0;
      finalClass = "CORPUS_FULLTEXT_BLOCKED";
    } else if (tierA.length - ftAcquired <= 0 && tierB.length === 0) {
      nextStrategy = "FULLTEXT_VALUE_EXHAUSTED";
      nextBudget = 0;
    } else if (successRate >= 0.85 && ftAcquired >= 20) {
      finalClass = "CORPUS_FULLTEXT_HIGH_VALUE_STRONG";
      nextStrategy = "CONTINUE_HIGH_VALUE_FULLTEXT";
      nextBudget = Math.min(175, measuredHourRemaining - 25);
    } else if (successRate >= 0.6 && ftAcquired >= 5) {
      finalClass = "CORPUS_FULLTEXT_HIGH_VALUE_MODERATE";
      nextStrategy = "CONTINUE_HIGH_VALUE_FULLTEXT";
      nextBudget = Math.min(120, measuredHourRemaining - 25);
    } else if (ftAcquired > 0) {
      finalClass = "CORPUS_FULLTEXT_HIGH_VALUE_WEAK";
      nextStrategy = "RETURN_TO_PRODUCT_WORK";
      nextBudget = 0;
    } else {
      finalClass = "CORPUS_FULLTEXT_BLOCKED";
      nextStrategy = "RETURN_TO_PRODUCT_WORK";
      nextBudget = 0;
    }
    if (measuredDayRemaining < 80 || measuredHourRemaining < 40) {
      nextStrategy = "PAUSE_FOR_QUOTA_RECOVERY";
      nextBudget = 0;
    }

    const majorDoctrines = ftResults
      .filter((r) => r.status === "acquired_corpus_complete")
      .slice(0, 25)
      .map((r) => `${r.citation} (${r.caseName})`);

    const report = {
      ok: end.green && !hit429,
      classification: "CORPUS_HIGH_VALUE_FULLTEXT_RUN",
      runStartLocal: RUN_START_LOCAL,
      stopReason,
      courtListener: {
        quotaProbeRequests: 1,
        acquisitionCl: fullTextCl,
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
      start: {
        TOTAL_CANONICAL_AUTHORITIES: start.TOTAL_CANONICAL_AUTHORITIES,
        METADATA_ONLY_AUTHORITIES: start.METADATA_ONLY_AUTHORITIES,
        CORPUS_COMPLETE_AUTHORITIES: start.CORPUS_COMPLETE_AUTHORITIES,
        AUTHORITY_RESOLVED_EDGES: start.AUTHORITY_RESOLVED_EDGES,
        CORPUS_COMPLETE_EDGES: start.CORPUS_COMPLETE_EDGES,
        IDENTITY_UNRESOLVED_EDGES: start.IDENTITY_UNRESOLVED_EDGES,
      },
      end: {
        TOTAL_CANONICAL_AUTHORITIES: end.TOTAL_CANONICAL_AUTHORITIES,
        METADATA_ONLY_AUTHORITIES: end.METADATA_ONLY_AUTHORITIES,
        CORPUS_COMPLETE_AUTHORITIES: end.CORPUS_COMPLETE_AUTHORITIES,
        AUTHORITY_RESOLVED_EDGES: end.AUTHORITY_RESOLVED_EDGES,
        CORPUS_COMPLETE_EDGES: end.CORPUS_COMPLETE_EDGES,
        IDENTITY_UNRESOLVED_EDGES: end.IDENTITY_UNRESOLVED_EDGES,
      },
      priorityQueue: {
        tierA: tierA.length,
        tierB: tierB.length,
        tierC: tierC.length,
        selected: selected.length,
        top20,
      },
      acquisition: {
        attempted: ftAttempted,
        completed: ftAcquired,
        failed: ftFailed,
        alreadyCompleteSkipped: ftSkippedComplete,
        byCourt: jurisAcquired,
        metadataOnlyToCorpusComplete: metadataToComplete,
      },
      citations: {
        NEW_EDGES_TOTAL: ftNewEdgesTotal,
        NEW_EDGES_RESOLVED_IMMEDIATELY: ftNewEdgesResolvedImmediate,
        NEW_EDGES_STILL_UNRESOLVED: ftNewEdgesStillUnresolved,
        OLD_UNRESOLVED_RESOLVED: ftOldUnresolvedResolved,
        OLD_EDGES_BACKFILLED_FROM_NEW_FULLTEXT: ftOldUnresolvedResolved,
        note: "New outgoing edges are not backlog regressions",
      },
      localPostAcquisition: {
        OLD_EDGES_BACKFILLED_FROM_NEW_FULLTEXT: ftOldUnresolvedResolved,
        TARGETS_RESOLVED_LOCALLY: localTargetsResolved,
        EXTERNAL_IDENTITY_LOOKUPS_AVOIDED: externalLookupsAvoided,
        aliasesLearned: ftAliases,
        parallelLearned: ftParallels,
      },
      corpusCompleteValue: {
        CORPUS_COMPLETE_EDGES_start: start.CORPUS_COMPLETE_EDGES,
        CORPUS_COMPLETE_EDGES_end: end.CORPUS_COMPLETE_EDGES,
        delta: ccDelta,
      },
      embeddings: {
        newFullTextReady: ftAcquired,
        newEmbedded: ftAcquired,
        missingEmbeddings: end.missingEmbeddings,
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
      longTailPolicy: {
        ">=5": "bulk external identity allowed when reporter-valid",
        "4-edge": "quality-gated external identity only",
        "3-edge": "NO BULK after measured 1.09 e/CL + 54.5% ambiguity",
        "1-2": "NO BULK",
        bulkIdentityCurrentlyStopped: true,
      },
      productValue: {
        majorDoctrinesAuthoritiesAdded: majorDoctrines,
        benchmarkGapsImproved: ftResults.filter((r) => BENCHMARK_RE.test(`${r.caseName} ${r.citation}`)).map((r) => r.citation),
        researchValue: "Full opinion text + embeddings for high-demand controlling authorities",
        askDraftValue: "Reasoning-capable CORPUS_COMPLETE authorities for Research/Ask/Draft/Professor/Guide",
      },
      nextStrategy,
      nextRecommendedClBudget: Math.max(0, nextBudget),
      results: ftResults,
      checkpoints,
      finalClassification: finalClass,
      generatedAt: new Date().toISOString(),
      resolverVersion: RESOLVER_VERSION,
    };

    writeJson(REPORT_JSON, report);
    console.log("CORPUS_HIGH_VALUE_FULLTEXT_RUN_COMPLETE");
    console.log(
      JSON.stringify(
        {
          ok: report.ok,
          stopReason,
          totalCl,
          fullTextCl,
          ftAcquired,
          ftFailed,
          metadataToComplete,
          NEW_EDGES_TOTAL: ftNewEdgesTotal,
          OLD_UNRESOLVED_RESOLVED: ftOldUnresolvedResolved,
          CORPUS_COMPLETE_EDGES_delta: ccDelta,
          METADATA_ONLY_end: end.METADATA_ONLY_AUTHORITIES,
          CORPUS_COMPLETE_end: end.CORPUS_COMPLETE_AUTHORITIES,
          nextStrategy,
          nextRecommendedClBudget: nextBudget,
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
    console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 2000), totalCl, fullTextCl }));
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();
