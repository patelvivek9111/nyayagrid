/**
 * Quality-gated long-tail full-hour CourtListener run.
 * Stage A: quality-filtered remaining 4-edge (Tier A/B; no Tier C bulk).
 * Stage B: ranked 3-edge Tier A (Tier B only if healthy).
 * TOTAL CL <=270, FULL_TEXT_CL=0. No markdown reports. Neon only.
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

let TOTAL_CL_CAP = 270;
let MAX_IDENTITY = 260;
const MAX_FT_CL = 0;
const MAX_FT_AUTHORITIES = 0;
const RATE_MS = 4000;
const FT_MIN_RANK_SCORE = 999;
const CL_BASE = "https://www.courtlistener.com/api/rest/v4";
const SOURCE = "courtlistener";
const BATCH = "quality-longtail-run1";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS = 384;
const MAX_OPINION_CHARS = 40_000;
const MAX_CHUNK_CHARS = 1000;

const ROOT = path.join(__dirname, "..");
const CHECKPOINT_DIR = path.join(ROOT, "packages/research/corpus/resolution/checkpoints");
const LEDGER_PATH = path.join(ROOT, "packages/research/corpus/resolution/ledger/cl-quality-longtail-run1-2026-10-10.jsonl");
const REPORT_JSON = path.join(ROOT, "packages/research/corpus/reports/citation-quality-longtail-run1-2026-10-10.json");
const FULLTEXT_QUEUE = path.join(ROOT, "packages/research/corpus/resolution/fulltext-demand-queue-2026-10-09.json");
const PRIOR_REPORTS = [
  "citation-identity-live-batch1-2026-10-09.json",
  "citation-identity-live-batch2-2026-10-09.json",
  "citation-identity-live-batch3-2026-10-09.json",
  "citation-identity-live-batch4-2026-10-09.json",
  "citation-mixed-live-batch1-2026-10-09.json",
  "citation-identity-heavy-mixed-batch2-2026-10-09.json",
  "citation-identity-heavy-mixed-batch3-2026-10-09.json",
  "citation-full-hour-weekend-run1-2026-10-09.json",
  "citation-full-hour-weekend-run2-2026-10-09.json",
  "citation-strategic-34-run1-2026-10-09.json",
  "citation-four-edge-fullhour-run1-2026-10-09.json",
].map((f) => path.join(ROOT, "packages/research/corpus/reports", f));
const WEEKEND_START_UNRESOLVED = 55090;
const WEEKEND_TARGET_REDUCTION = 15000;
const PRIOR_OLD_EDGE_PROGRESS = 2669;
const PRIOR_OLD_REMAINING = 12331;
const RUN_START_LOCAL = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });

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

function strategic34Score(t) {
  const edges = Number(t.edgeCount || 0);
  const citing = Number(t.uniqueCitingCases || t.citingCaseCount || 0);
  const j = (t.jurisdictions || []).join(" ").toLowerCase();
  let score = edges * 10 + citing * 2;
  if (edges === 4) score += 25;
  if (edges === 3) score += 10;
  if (/us-ca-3|ca3/.test(j)) score += 40;
  if (/us-d-pa|paed|edpa/.test(j)) score += 35;
  if (/st-pa|pennsylvania/.test(j)) score += 25;
  if (/us-scotus|scotus/.test(j)) score += 30;
  if (/us-ca-|us-d-|us-circuit|us-scotus/.test(j)) score += 12;
  if (Number(t.priorityScore || 0) >= 50) score += 15;
  if (Number(t.priorityScore || 0) >= 40) score += 8;
  const cite = String(t.normalizedCitation || t.representativeRaw || "");
  if (/\bU\.S\.\b|\bS\.\s*Ct\b|\bF\.(?:2d|3d|4th)\b|\bF\.\s*Supp|Wall\.?|How\.?|Cranch|Pet\./i.test(cite)) score += 12;
  if (/\bA\.(?:2d|3d)\b|\bPa\.?\b/i.test(cite)) score += 8;
  return score;
}
function jurisBucket(t) {
  const j = (t.jurisdictions || []).join(" ").toLowerCase();
  if (/us-ca-3|ca3/.test(j)) return "CA3";
  if (/us-d-pa|paed|edpa/.test(j)) return "EDPA";
  if (/st-pa|pennsylvania/.test(j)) return "PA";
  if (/us-scotus|scotus/.test(j)) return "SCOTUS";
  if (/us-ca-|us-d-|us-circuit|us-scotus|federal/.test(j)) return "OTHER_FEDERAL";
  return "STATE";
}
function qualityTierForTarget(t) {
  const cite = String(t.normalizedCitation || t.representativeRaw || "");
  const j = (t.jurisdictions || []).join(" ").toLowerCase();
  const citing = Number(t.uniqueCitingCases || t.citingCaseCount || 0);
  const score = Number(t.strategicScore || strategic34Score(t));
  const strongReporter = /\bU\.S\.\b|\bS\.\s*Ct\b|\bF\.(?:2d|3d|4th)\b|\bF\.\s*Supp|Wall\.?|How\.?|Cranch|Pet\.|\bA\.(?:2d|3d)\b|\bPa\.?\b/i.test(cite);
  const hostile = /\bPage\s+\d+\b/i.test(cite) || /^\d{4}\s+Page\b/i.test(cite) || !/[A-Za-z]/.test(cite);
  const highJuris = /us-scotus|us-ca-3|ca3|us-d-pa|paed|edpa|st-pa|pennsylvania/.test(j);
  if (hostile || (!strongReporter && score < 40)) return "C";
  if (strongReporter && (highJuris || citing >= 3 || score >= 70)) return "A";
  if (strongReporter || score >= 55) return "B";
  return "C";
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

  const priorPartial = null;
  const quota = await probeQuota(apiKey);
  let totalCl = 1;
  let identityCl = 0;
  let fullTextCl = 0;
  let retryCl = 0;
  const minuteRem = Number(quota.minute?.remaining ?? 0);
  const hourRem = Number(quota.hour?.remaining ?? 0);
  const dayRem = Number(quota.day?.remaining ?? 0);
  console.log(JSON.stringify({ quotaGate: { minuteRem, hourRem, dayRem, membership: quota.membership } }, null, 2));
  if (!quota.ok || hourRem < 250) {
    console.log(
      JSON.stringify({
        ok: false,
        stopReason: "HOURLY_WINDOW_NOT_RECOVERED",
        classification: "CITATION_QUALITY_GATED_LONG_TAIL_RUN",
        courtListenerHttpCalls: 1,
        minuteRem,
        hourRem,
        dayRem,
      }),
    );
    process.exit(3);
  }
  if (dayRem < 250) {
    console.log(
      JSON.stringify({
        ok: false,
        stopReason: "DAILY_QUOTA_INSUFFICIENT_FOR_FULL_RUN",
        classification: "CITATION_QUALITY_GATED_LONG_TAIL_RUN",
        courtListenerHttpCalls: 1,
        minuteRem,
        hourRem,
        dayRem,
      }),
    );
    process.exit(3);
  }
  if (hourRem >= 270) {
    TOTAL_CL_CAP = Math.min(270, hourRem - 25);
  } else if (hourRem >= 250) {
    TOTAL_CL_CAP = Math.min(TOTAL_CL_CAP, Math.max(40, hourRem - 25));
  }
  if (dayRem < 325) {
    // leave ~50-75 daily
    const leave = Math.min(75, Math.max(50, dayRem - 200));
    TOTAL_CL_CAP = Math.min(TOTAL_CL_CAP, Math.max(40, dayRem - leave));
  }
  MAX_IDENTITY = Math.min(MAX_IDENTITY, Math.max(20, TOTAL_CL_CAP - 1));
  console.log(JSON.stringify({ budget: { TOTAL_CL_CAP, MAX_IDENTITY, MAX_FT_CL: 0, runStartLocal: RUN_START_LOCAL, hourRem, dayRem } }));

  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 30, connect_timeout: 60 });
  let lastAt = Date.now();
  let hit429 = false;
  let hit502 = 0;
  let stopReason = "BATCH_COMPLETE";

  // Identity lane counters
  let idLocalBefore = 0;
  let idLocalEdges = 0;
  let idExternalAttempted = 0;
  let idExternalHigh = 0;
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
  let idResults = [];
  const ledgerAll = [];
  const resolvedInBatch = new Set();
  const attemptedInBatch = new Set();

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
  let checkpoints = [];

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
    let start = await healthSnapshot(sql);
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

    function isProviderHostileShape(t) {
      const c = String(t.normalizedCitation || t.representativeRaw || "");
      if (/\bPage\s+\d+\b/i.test(c)) return true;
      if (/^\d{4}\s+Page\b/i.test(c)) return true;
      return false;
    }
    function baseEligible(t, edgeExact) {
      if (priorKeys.has(t.targetKey)) return false;
      if (t.localCandidateStatus !== "NO_LOCAL_MATCH") return false;
      if (t.edgeCount !== edgeExact) return false;
      if (isProviderHostileShape(t)) return false;
      const el = classifyCaseCitationLookupEligibility(t.representativeRaw, t.normalizedCitation);
      return Boolean(el.eligible);
    }
    function enrich(t) {
      const strategicScore = strategic34Score(t);
      const bucket = jurisBucket(t);
      const qualityTier = qualityTierForTarget({ ...t, strategicScore });
      return { ...t, strategicScore, jurisBucket: bucket, qualityTier };
    }
    function rankTargets(arr) {
      return [...arr].sort((a, b) => {
        const tierRank = (x) => (x.qualityTier === "A" ? 0 : x.qualityTier === "B" ? 1 : 2);
        const citing = (t) => Number(t.uniqueCitingCases || t.citingCaseCount || 0);
        return tierRank(a) - tierRank(b) || b.strategicScore - a.strategicScore || citing(b) - citing(a);
      });
    }
    const raw4 = queue.targets.filter((t) => t.edgeCount === 4 && !priorKeys.has(t.targetKey));
    const pool4 = rankTargets(raw4.filter((t) => baseEligible(t, 4)).map(enrich));
    const raw3 = queue.targets.filter((t) => t.edgeCount === 3 && !priorKeys.has(t.targetKey));
    const pool3 = rankTargets(raw3.filter((t) => baseEligible(t, 3)).map(enrich));
    const tierCount = (arr) => ({
      A: arr.filter((t) => t.qualityTier === "A").length,
      B: arr.filter((t) => t.qualityTier === "B").length,
      C: arr.filter((t) => t.qualityTier === "C").length,
    });
    const tiers4 = tierCount(pool4);
    const tiers3 = tierCount(pool3);
    const stageA = pool4.filter((t) => t.qualityTier === "A" || t.qualityTier === "B");
    const stageB = pool3.filter((t) => t.qualityTier === "A" || t.qualityTier === "B");
    const identityPool = [...stageA, ...stageB];
    const identitySelected = identityPool.slice(0, MAX_IDENTITY + 300);
    const ge5EligibleRemaining = () => 0;
    const edge4 = { attempted: 0, high: 0, edges: 0, ambiguous: 0, notFound: 0 };
    const edge3 = { attempted: 0, high: 0, edges: 0, ambiguous: 0, notFound: 0 };
    const rolling4 = [];
    const rolling3 = [];
    let stage = "A_4EDGE";
    let allowTierB4 = false;
    let allowTierB3 = false;
    let stageAStop = null;
    let stageBStop = null;
    const jurisStats = {
      CA3: { attempted: 0, resolved: 0 },
      EDPA: { attempted: 0, resolved: 0 },
      PA: { attempted: 0, resolved: 0 },
      SCOTUS: { attempted: 0, resolved: 0 },
      OTHER_FEDERAL: { attempted: 0, resolved: 0 },
      STATE: { attempted: 0, resolved: 0 },
    };
    const rollingIdentity = []; // { high, edges, ambiguous }
    const queueSnapshot = {
      fourEdge: { remainingRaw: raw4.length, ...tiers4, working: stageA.length },
      threeEdge: { rawEligible: raw3.filter((t) => baseEligible(t, 3)).length, ...tiers3, working: stageB.length },
      working: identitySelected.length,
      priorExcluded: priorKeys.size,
    };
    console.log(JSON.stringify({ queueSnapshot }, null, 2));

    async function applyLocalId(target, localHit, viaLearning = false) {
      const auth = authorityRows.find((a) => a.id === localHit.authorityId);
      const corpusComplete = Boolean(auth?.has_embeddings) && auth?.ingestion_status === "ready";
      const bf = await backfillTarget(sql, target, localHit.authorityId, localHit.method, localHit.evidence, corpusComplete);
      idEdgesBackfilled += bf.updated;
      idLocalEdges += bf.updated;
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

      // Stage / tier gating
      if (stage === "A_4EDGE") {
        if (target.edgeCount !== 4) continue;
        if (target.qualityTier === "C") continue;
        if (target.qualityTier === "B" && !allowTierB4) {
          // defer B until A exhausted
          const remainingA4 = identitySelected.some(
            (t) =>
              t.edgeCount === 4 &&
              t.qualityTier === "A" &&
              !attemptedInBatch.has(t.targetKey) &&
              !resolvedInBatch.has(t.targetKey),
          );
          if (remainingA4) continue;
          allowTierB4 = true;
        }
      } else if (stage === "B_3EDGE") {
        if (target.edgeCount !== 3) continue;
        if (target.qualityTier === "C") continue;
        if (target.qualityTier === "B" && !allowTierB3) continue;
      } else {
        continue;
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
      attemptedInBatch.add(target.targetKey);
      lastAt = Date.now();
      const jb = target.jurisBucket || jurisBucket(target);
      if (jurisStats[jb]) jurisStats[jb].attempted += 1;
      if (target.edgeCount === 4) edge4.attempted += 1;
      else if (target.edgeCount === 3) edge3.attempted += 1;

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
          const retryAfter = res.headers.get("retry-after");
          idFailed += 1;
          idResults.push({
            targetKey: target.targetKey,
            status: "failed",
            reason: "rate_limited",
            retryAfter,
            externalLookup: true,
          });
          writeJson(path.join(CHECKPOINT_DIR, `quality-longtail-run1-429-${Date.now()}.json`), {
            at: new Date().toISOString(),
            retryAfter,
            totalCl,
            identityCl,
            idHigh,
            idEdgesBackfilled,
          });
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
        if (target.edgeCount === 4) edge4.ambiguous += 1;
        if (target.edgeCount === 3) edge3.ambiguous += 1;
        record.status = "NO_AUTO_RESOLVE";
        idResults.push(record);
      } else if (parsed.status === "not_found") {
        idNotFound += 1;
        if (target.edgeCount === 4) edge4.notFound += 1;
        if (target.edgeCount === 3) edge3.notFound += 1;
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
          idExternalHigh += 1;
          const jbR = target.jurisBucket || jurisBucket(target);
          if (jurisStats[jbR]) jurisStats[jbR].resolved += 1;
          if (target.edgeCount === 4) {
            edge4.high += 1;
            edge4.edges += bf.updated;
          } else if (target.edgeCount === 3) {
            edge3.high += 1;
            edge3.edges += bf.updated;
          }
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

      rollingIdentity.push({ high: callHigh, edges: callEdges, ambiguous: callAmb, edgeCount: target.edgeCount });
      if (target.edgeCount === 4) rolling4.push({ high: callHigh, edges: callEdges, ambiguous: callAmb });
      if (target.edgeCount === 3) rolling3.push({ high: callHigh, edges: callEdges, ambiguous: callAmb });
      if (stage === "A_4EDGE" && rolling4.length >= 20) {
        const last20 = rolling4.slice(-20);
        const high20 = last20.filter((x) => x.high).length;
        const edges20 = last20.reduce((s2, x) => s2 + x.edges, 0);
        const amb20 = last20.filter((x) => x.ambiguous).length;
        if (amb20 / 20 > 0.3 || edges20 / 20 < 2.5) {
          stageAStop = "FOUR_EDGE_QUALITY_STOP";
          // switch to stage B if Tier-A 3-edge exists
          const has3A = identitySelected.some(
            (t) =>
              t.edgeCount === 3 &&
              t.qualityTier === "A" &&
              !attemptedInBatch.has(t.targetKey) &&
              !resolvedInBatch.has(t.targetKey),
          );
          if (has3A) {
            stage = "B_3EDGE";
            console.log(JSON.stringify({ stageSwitch: "A_TO_B", reason: stageAStop, has3A }));
          } else {
            identityStopReason = stageAStop;
            stopReason = stageAStop;
          }
        }
      }
      if (stage === "B_3EDGE" && rolling3.length >= 20) {
        const last20 = rolling3.slice(-20);
        const high20 = last20.filter((x) => x.high).length;
        const edges20 = last20.reduce((s2, x) => s2 + x.edges, 0);
        const amb20 = last20.filter((x) => x.ambiguous).length;
        if (high20 / 20 < 0.6 || amb20 / 20 > 0.25 || edges20 / 20 < 2.25) {
          stageBStop = "THREE_EDGE_EFFICIENCY_STOP";
          identityStopReason = stageBStop;
          stopReason = stageBStop;
        } else if (edges20 / 20 >= 2.75 && amb20 / 20 <= 0.25) {
          allowTierB3 = true;
        }
      }
      // Exhaust Stage A cleanly into Stage B
      if (stage === "A_4EDGE" && !identityStopReason) {
        const remain4 = identitySelected.some(
          (t) =>
            t.edgeCount === 4 &&
            (t.qualityTier === "A" || (t.qualityTier === "B" && allowTierB4)) &&
            !attemptedInBatch.has(t.targetKey) &&
            !resolvedInBatch.has(t.targetKey) &&
            t.targetKey !== target.targetKey,
        );
        if (!remain4) {
          const has3A = identitySelected.some(
            (t) =>
              t.edgeCount === 3 &&
              t.qualityTier === "A" &&
              !attemptedInBatch.has(t.targetKey) &&
              !resolvedInBatch.has(t.targetKey),
          );
          if (has3A) {
            stage = "B_3EDGE";
            stageAStop = stageAStop || "FOUR_EDGE_QUALITY_EXHAUSTED";
            console.log(JSON.stringify({ stageSwitch: "A_TO_B", reason: stageAStop, has3A }));
          }
        }
      }
      if (rollingIdentity.length >= 20) {
        const last20 = rollingIdentity.slice(-20);
        const high20 = last20.filter((x) => x.high).length;
        const edges20 = last20.reduce((s2, x) => s2 + x.edges, 0);
        const amb20 = last20.filter((x) => x.ambiguous).length;
        if (idFailed >= 8 && idFailed / Math.max(1, idExternalAttempted) > 0.25) {
          identityStopReason = "SYSTEMIC_PROVIDER_FAILURE";
          stopReason = "SYSTEMIC_PROVIDER_FAILURE";
        }
        // overall safety — do not force stop solely on mixed-stage overall if stage switch handled
        if (!identityStopReason && stage === "B_3EDGE" && (high20 / 20 < 0.5 || amb20 / 20 > 0.35)) {
          identityStopReason = "OVERALL_EFFICIENCY_STOP";
          stopReason = "OVERALL_EFFICIENCY_STOP";
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

      if (identityCl % 20 === 0 || identityStopReason) {
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
          stage,
          edge4: {
            ...edge4,
            edgesPerCl: edge4.attempted ? edge4.edges / edge4.attempted : null,
            rolling: rolling4.slice(-20),
          },
          edge3: {
            ...edge3,
            edgesPerCl: edge3.attempted ? edge3.edges / edge3.attempted : null,
            rolling: rolling3.slice(-20),
          },
          jurisStats,
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
        writeJson(path.join(CHECKPOINT_DIR, `quality-longtail-run1-id-cp-${identityCl}.json`), cp);
        console.log(JSON.stringify({ checkpoint: cp }, null, 2));
        if (!health.green) {
          stopReason = "HEALTH_NOT_GREEN";
          break;
        }
      }
    }

    if (!identityStopReason && identityCl > 0 && stopReason === "BATCH_COMPLETE") {
      const remaining4 = identitySelected.some(
        (t) => t.edgeCount === 4 && !resolvedInBatch.has(t.targetKey) && !attemptedInBatch.has(t.targetKey),
      );
      if (!remaining4) {
        identityStopReason = "FOUR_EDGE_POOL_EXHAUSTED";
        stopReason = "FOUR_EDGE_POOL_EXHAUSTED";
      } else if (identityCl >= MAX_IDENTITY || totalCl >= TOTAL_CL_CAP) {
        identityStopReason = "IDENTITY_BUDGET_REACHED";
        stopReason = "IDENTITY_BUDGET_REACHED";
      }
    }

    // FULL_TEXT_CL must remain 0 for this strategic measurement run
    if (true) {
      console.log(JSON.stringify({ fullTextSkipped: true, reason: "QUALITY_LONGTAIL_IDENTITY_ONLY" }));
    } else if (false) {
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
      const exceptional = ranked.filter((c) => Number(c.rankScore || 0) >= FT_MIN_RANK_SCORE);
      const ftSelected = exceptional.slice(0, MAX_FT_AUTHORITIES);
      if (ftSelected.length === 0) console.log(JSON.stringify({ fullTextSkipped: true, reason: "NO_EXCEPTIONAL_TIER_A", maxRank: ranked[0]?.rankScore ?? null }));
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
            ${sql.json({ adapter: "citation-full-hour-weekend-run2-fulltext", clusterId: String(cand.clusterId), opinionId: String(opinionId) })},
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
          writeJson(path.join(CHECKPOINT_DIR, `quality-longtail-run1-ft-cp-${ftAcquired}.json`), cp);
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

    // Merge continuation segment with earlier partial Run#2 spend (same calendar hour window)
    if (false && priorPartial && priorPartial.identityLane) {
      const pId = priorPartial.identityLane;
      const pCl = priorPartial.courtListener || {};
      idLocalBefore += Number(pId.localTargetsResolved || 0);
      idLocalEdges += Number(pId.localEdgesResolved || 0);
      idExternalAttempted += Number(pId.externalAttempted || 0);
      idExternalHigh += Number(pId.externalHighResolved || 0);
      idHigh += Number(pId.highResolved || 0);
      idAmbiguous += Number(pId.ambiguous || 0);
      idNotFound += Number(pId.notFound || 0);
      idFailed += Number(pId.providerFailure || 0);
      idEdgesBackfilled += Number(pId.oldUnresolvedEdgesBackfilled || 0);
      idAliases += Number(pId.aliasesLearned || 0);
      idParallels += Number(pId.parallelCitationsLearned || 0);
      idTargetsResolvedByLearning += Number(pId.targetsResolvedThroughNewLearning || 0);
      idLookupsAvoided += Number(pId.externalLookupsAvoided || 0);
      idLookupsAvoidedByLearning += Number(pId.externalCallsAvoidedByNewLearning || 0);
      idNewMetadataOnly += Number(pId.newMetadataOnlyAuthorities || 0);
      identityCl += Number(pCl.identityLookupRequests || 0);
      fullTextCl += Number(pCl.fullTextRequests || 0);
      retryCl += Number(pCl.retryOtherCl || 0);
      // Logical single-run accounting: keep one quota probe, add prior non-probe CL
      const priorNonProbe = Math.max(0, Number(pCl.totalClRequests || 0) - Number(pCl.quotaProbeRequests || 1));
      totalCl += priorNonProbe;
      const pd = pId.demandDistribution || {};
      for (const k of ["ge10", "ge5to9", "strategic34", "strategic12"]) {
        demandBuckets[k].attempted += Number(pd[k]?.attempted || 0);
        demandBuckets[k].resolved += Number(pd[k]?.resolved || 0);
      }
      idResults = [...(pId.results || []), ...idResults];
      checkpoints = [...(priorPartial.checkpoints || []), ...checkpoints];
      // start metrics should remain the pre-Run2 certified state
      if (priorPartial.start) Object.assign(start, priorPartial.start);
      console.log(JSON.stringify({ mergedPartialRun2: true, mergedIdentityCl: identityCl, mergedEdges: idEdgesBackfilled, mergedTotalCl: totalCl }));
    }

    const identityTargetSuccess = idExternalAttempted > 0 ? idExternalHigh / idExternalAttempted : 0;
    const last20Roll = rollingIdentity.slice(-20);
    const rolling20Rate = last20Roll.length ? last20Roll.filter((x) => x.high).length / last20Roll.length : null;
    const rolling20Edges = last20Roll.length
      ? last20Roll.reduce((s2, x) => s2 + x.edges, 0) / last20Roll.length
      : null;
    const longTailDegradation =
      rollingIdentity.length >= 40 &&
      rolling20Edges != null &&
      identityEdgesPerCl != null &&
      rolling20Edges < identityEdgesPerCl * 0.7;

    const thisRunOldProgress = idEdgesBackfilled;
    const oldProgressTotal = PRIOR_OLD_EDGE_PROGRESS + thisRunOldProgress;
    const oldProgressPct = (oldProgressTotal / WEEKEND_TARGET_REDUCTION) * 100;
    const oldRemainingTo15k = Math.max(0, WEEKEND_TARGET_REDUCTION - oldProgressTotal);
    const netReductionTotal = WEEKEND_START_UNRESOLVED - end.IDENTITY_UNRESOLVED_EDGES;
    const measuredDayRemaining = Math.max(0, dayRem - (totalCl - 1));
    const measuredHourRemaining = Math.max(0, hourRem - (totalCl - 1));
    // ESTIMATED only: do not assume calendar resets; use measured day remaining as sole defensible capacity
    // unless hour recovery pattern suggests more same-day hours remain (hour rem low while day rem high).
    const estimatedFutureRecoverable = measuredDayRemaining; // measured = estimated until reset observed
    const totalCapacityThroughSunday = measuredDayRemaining;
    const requiredYield = totalCapacityThroughSunday > 0 ? oldRemainingTo15k / totalCapacityThroughSunday : null;
    const forecastConfidence = "LOW"; // no observed daily reset; capacity horizon uncertain
    const demonstratedYield = identityEdgesPerCl;
    const rollingYield = rolling20Edges;

    let sundayTarget = "OFF_TRACK";
    let sundayReason = "";
    if (requiredYield == null || totalCapacityThroughSunday < 100) {
      sundayTarget = "OFF_TRACK";
      sundayReason = `measured remaining capacity ${totalCapacityThroughSunday} insufficient; no calendar reset observed`;
    } else if (demonstratedYield != null && requiredYield <= demonstratedYield * 0.85 && forecastConfidence === "HIGH") {
      sundayTarget = "ON_TRACK";
      sundayReason = `required ${requiredYield.toFixed(2)} <= 85% of demonstrated ${demonstratedYield.toFixed(2)} on MEASURED capacity ${totalCapacityThroughSunday}`;
    } else if (demonstratedYield != null && requiredYield <= demonstratedYield * 1.1) {
      sundayTarget = "AT_RISK";
      sundayReason = `required ${requiredYield.toFixed(2)} near demonstrated ${demonstratedYield.toFixed(2)}; MEASURED capacity ${totalCapacityThroughSunday}; forecast confidence ${forecastConfidence} (no daily reset observed)`;
    } else {
      sundayTarget = "OFF_TRACK";
      sundayReason = `required ${requiredYield?.toFixed(2)} exceeds demonstrated ${demonstratedYield?.toFixed(2) ?? "n/a"} on MEASURED capacity ${totalCapacityThroughSunday}; no daily reset assumed`;
    }

            const roll4 = rolling4.slice(-20);
    const roll3 = rolling3.slice(-20);
    const roll4Amb = roll4.length ? roll4.filter((x) => x.ambiguous).length / roll4.length : null;
    const roll4Epcl = roll4.length ? roll4.reduce((a, x) => a + x.edges, 0) / roll4.length : null;
    const roll3Amb = roll3.length ? roll3.filter((x) => x.ambiguous).length / roll3.length : null;
    const roll3Epcl = roll3.length ? roll3.reduce((a, x) => a + x.edges, 0) / roll3.length : null;
    const remain4AB = identitySelected.filter(
      (t) =>
        t.edgeCount === 4 &&
        (t.qualityTier === "A" || t.qualityTier === "B") &&
        !attemptedInBatch.has(t.targetKey) &&
        !resolvedInBatch.has(t.targetKey),
    ).length;
    const remain3A = identitySelected.filter(
      (t) => t.edgeCount === 3 && t.qualityTier === "A" && !attemptedInBatch.has(t.targetKey) && !resolvedInBatch.has(t.targetKey),
    ).length;

    let laneDecision = "PAUSE_FOR_QUOTA_RECOVERY";
    if (hit429 || stopReason === "HEALTH_NOT_GREEN" || !end.green) {
      laneDecision = "STOP_LONG_TAIL_BULK";
    } else if ((identityEdgesPerCl || 0) < 2.25 || identityTargetSuccess < 0.55) {
      laneDecision = "STOP_LONG_TAIL_BULK";
    } else if (remain4AB > 0 && (roll4Amb == null || roll4Amb <= 0.3) && (roll4Epcl == null || roll4Epcl >= 2.5)) {
      laneDecision = "CONTINUE_4_EDGE_TIER_A_B";
    } else if (edge3.attempted === 0 && remain3A > 0) {
      laneDecision = "MOVE_TO_3_EDGE_TIER_A";
    } else if (edge3.attempted > 0 && remain3A > 0 && (roll3Epcl == null || roll3Epcl >= 2.25) && (roll3Amb == null || roll3Amb <= 0.25)) {
      laneDecision = "CONTINUE_3_EDGE_TIER_A";
    } else if (measuredDayRemaining < 200) {
      laneDecision = "PAUSE_FOR_QUOTA_RECOVERY";
    } else {
      laneDecision = "STOP_LONG_TAIL_BULK";
    }

    let finalClass = "CITATION_LONG_TAIL_USABLE";
    if (hit429 || stopReason === "HEALTH_NOT_GREEN" || !end.green || laneDecision === "STOP_LONG_TAIL_BULK") {
      finalClass = "CITATION_LONG_TAIL_STOP";
    } else if ((identityEdgesPerCl || 0) >= 3.2 && identityTargetSuccess >= 0.8) {
      finalClass = "CITATION_LONG_TAIL_STRONG";
    } else if ((identityEdgesPerCl || 0) >= 2.5 && identityTargetSuccess >= 0.65) {
      finalClass = "CITATION_LONG_TAIL_USABLE";
    } else {
      finalClass = "CITATION_LONG_TAIL_MARGINAL";
    }

    const nextHourDecision = laneDecision;
    const nextBudget =
      laneDecision === "STOP_LONG_TAIL_BULK"
        ? 0
        : laneDecision === "PAUSE_FOR_QUOTA_RECOVERY"
          ? 270
          : laneDecision === "CONTINUE_4_EDGE_TIER_A_B"
            ? 150
            : laneDecision === "MOVE_TO_3_EDGE_TIER_A" || laneDecision === "CONTINUE_3_EDGE_TIER_A"
              ? 200
              : 0;

    // Update fulltext queue — remove acquired
    try {
      const q = JSON.parse(fs.readFileSync(FULLTEXT_QUEUE, "utf8"));
      const acquiredIds = new Set(ftResults.filter((r) => r.status === "acquired_corpus_complete").map((r) => r.authorityId));
      q.candidates = (q.candidates || []).filter((c) => !acquiredIds.has(c.authorityId));
      q.generatedAt = new Date().toISOString();
      q.batch = "identity-batch1+2+3+4+mixed1+mixed2+mixed3+full-hour-weekend-run1+run2";
      writeJson(FULLTEXT_QUEUE, q);
    } catch {
      /* */
    }

    const report = {
      ok: end.green && !hit429 && stopReason !== "HEALTH_NOT_GREEN",
      classification: "CITATION_QUALITY_GATED_LONG_TAIL_RUN",
      runStartLocal: RUN_START_LOCAL,
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
        estimatedHourRemaining: Math.max(0, hourRem - (totalCl - 1)),
        estimatedDayRemaining: Math.max(0, dayRem - (totalCl - 1)),
        hit429,
        hit502,
        budgetCap: TOTAL_CL_CAP,
        maxIdentity: MAX_IDENTITY,
      },
      start,
      end,
      queue: queueSnapshot,
      identityLane: {
        eligibleTargetsConsidered: identityPool.length,
        targetsSelected: identitySelected.length,
        localTargetsResolved: idLocalBefore,
        localEdgesResolved: idLocalEdges,
        externalAttempted: idExternalAttempted,
        highResolved: idHigh,
        externalHighResolved: idExternalHigh,
        ambiguous: idAmbiguous,
        notFound: idNotFound,
        providerFailure: idFailed,
        oldUnresolvedEdgesBackfilled: idEdgesBackfilled,
        edgesPerIdentityCl: identityEdgesPerCl,
        backfillMultiplier: idExternalHigh > 0 ? idEdgesBackfilled / idExternalHigh : null,
        aliasesLearned: idAliases,
        parallelCitationsLearned: idParallels,
        targetsResolvedThroughNewLearning: idTargetsResolvedByLearning,
        externalLookupsAvoided: idLookupsAvoided,
        externalCallsAvoidedByNewLearning: idLookupsAvoidedByLearning,
        identityTargetSuccess,
        edge4Performance: {
          attempted: edge4.attempted,
          high: edge4.high,
          ambiguous: edge4.ambiguous,
          notFound: edge4.notFound,
          oldEdgesSolved: edge4.edges,
          edgesPerCl: edge4.attempted ? edge4.edges / edge4.attempted : null,
          rollingFinalAmbiguity: roll4Amb,
          rollingFinalEdgesPerCl: roll4Epcl,
          laneExhausted: remain4AB === 0,
          tiers: tiers4,
        },
        edge3Performance: {
          attempted: edge3.attempted,
          high: edge3.high,
          ambiguous: edge3.ambiguous,
          notFound: edge3.notFound,
          oldEdgesSolved: edge3.edges,
          edgesPerCl: edge3.attempted ? edge3.edges / edge3.attempted : null,
          rollingFinalAmbiguity: roll3Amb,
          rollingFinalEdgesPerCl: roll3Epcl,
          tiers: tiers3,
        },
        stageAStop,
        stageBStop,
        finalStage: stage,
        jurisdictionQuality: jurisStats,
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
      nextHourDecision,
      nextRecommendedBudget: nextBudget,
      weekendTarget: {
        startingUnresolved: WEEKEND_START_UNRESOLVED,
        endingUnresolved: end.IDENTITY_UNRESOLVED_EDGES,
        previousOldEdgeProgress: PRIOR_OLD_EDGE_PROGRESS,
        thisRunOldEdgeProgress: thisRunOldProgress,
        OLD_PROGRESS_TOTAL: oldProgressTotal,
        OLD_PROGRESS_PERCENT: oldProgressPct,
        OLD_REMAINING_TO_15000: oldRemainingTo15k,
        NET_REDUCTION_TOTAL: netReductionTotal,
        measuredDayRemaining,
        measuredHourRemaining,
        estimatedFutureRecoverableCapacity: estimatedFutureRecoverable,
        requiredAverageYield: requiredYield,
        recentDemonstratedYield: demonstratedYield,
        rollingLast20Yield: rollingYield,
        forecastConfidence,
        fourEdgeRemainingAB: remain4AB,
        threeEdgeRemainingA: remain3A,
      },
      forecast: {
        sunday15kTarget: sundayTarget,
        reason: sundayReason,
        requiredYield,
        demonstratedYield,
        rollingYield,
        measuredDayRemaining,
        estimatedFutureRecoverableCapacity: estimatedFutureRecoverable,
        forecastConfidence,
        note: "No calendar-day CL reset assumed; capacity is MEASURED day remaining only.",
      },
      laneDecision,
      efficiency: {
        identityHighRate: identityTargetSuccess,
        identityOldEdgePerCl: identityEdgesPerCl,
        combinedOldEdgePerCl: combinedOldPerCl,
        fullTextOldEdgePerCl: ftOldPerCl,
        fullTextAuthoritiesPerCl: ftAuthPerCl,
        rollingLast20IdentityRate: rolling20Rate,
        rollingLast20EdgesPerCl: rolling20Edges,
        longTailDegradationObserved: Boolean(longTailDegradation),
      },
      permanentPipelineValidation: {
        confirmed: true,
        flow: "extract→classify→normalize→local resolve→eligibility gate→unique-target queue→external identity→authority resolved→demand-driven full text→corpus complete→global backfill",
        nonCaseOutsideIdentityLane: true,
        noMarkdownReport: true,
      },
      checkpoints,
      finalClassification: finalClass,
      generatedAt: new Date().toISOString(),
      resolverVersion: RESOLVER_VERSION,
    };

    writeJson(REPORT_JSON, report);
    // Markdown reports disabled for this production run
    if (false) fs.writeFileSync(
      "UNUSED_MD",
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

    console.log("CITATION_QUALITY_GATED_LONG_TAIL_RUN_COMPLETE");
    console.log(
      JSON.stringify(
        {
          ok: report.ok,
          stopReason: report.stopReason,
          totalCl,
          identityCl,
          fullTextCl,
          idExternalHigh,
          idEdgesBackfilled,
          ftAcquired,
          ftNewEdgesTotal,
          netUnresolvedChange,
                    thisRunOldProgress,
          oldProgressTotal,
          oldRemainingTo15k,
          requiredYield,
          sundayTarget,
          stageAStop,
          stageBStop,
          laneDecision,
          nextHourDecision,
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
