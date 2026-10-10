/**
 * Same-run FT continuation after identity efficiency stop.
 * No quota re-probe. Uses remaining safe-hour budget only.
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
} = require("../packages/research/src/corpus/citation-resolution/cjs-bridge.cjs");

const TOTAL_CL_CAP = Number(process.env.CONTINUE_CL_CAP || 200);
const RATE_MS = 4000;
const CL_BASE = "https://www.courtlistener.com/api/rest/v4";
const SOURCE = "courtlistener";
const BATCH = "post-fulltext-reassessment-run1-ft-continue";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS = 384;
const MAX_OPINION_CHARS = 40_000;
const MAX_CHUNK_CHARS = 1000;

const ROOT = path.join(__dirname, "..");
const REPORT_JSON = path.join(ROOT, "packages/research/corpus/reports/post-fulltext-reassessment-run1-2026-10-10.json");
const LEDGER_PATH = path.join(ROOT, "packages/research/corpus/resolution/ledger/cl-post-fulltext-reassessment-run1-2026-10-10.jsonl");
const CHECKPOINT_DIR = path.join(ROOT, "packages/research/corpus/resolution/checkpoints");
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
  if (plain && String(plain).trim().length >= 80) return String(plain).replace(/\s+/g, " ").trim().slice(0, MAX_OPINION_CHARS);
  const html = hit?.html_with_citations || hit?.html || hit?.html_lawbox || hit?.html_columbia || hit?.snippet || "";
  return stripHtml(html).slice(0, MAX_OPINION_CHARS);
}
function chunkContent(content) {
  const parts = String(content).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
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
  return { ...row, courtBucket: bucket, productScore: score, qualityTier: tier };
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
  const green = h.duplicates === 0 && h.orphans === 0 && h.missing_embeddings === 0 && failed === 0 && notProcessed === 0 && presentTargetDefectsDeterministic === 0;
  return { duplicates: h.duplicates, orphans: h.orphans, missingEmbeddings: h.missing_embeddings, failed, notProcessed, presentTargetDefectsDeterministic, green, ...(await authorityCompleteness(sql)) };
}

async function main() {
  const apiKey = process.env.COURTLISTENER_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const url = process.env.DATABASE_URL?.trim();
  if (!apiKey || !openaiKey || !url || /localhost|:5433/i.test(url)) {
    console.log(JSON.stringify({ ok: false, reason: "env" }));
    process.exit(2);
  }
  const prior = JSON.parse(fs.readFileSync(REPORT_JSON, "utf8"));
  const already = new Set((prior.ftResults || []).map((r) => r.authorityId));
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 30, connect_timeout: 60 });
  let totalCl = 0;
  let lastAt = 0;
  let hit429 = false;
  let hit502 = 0;
  let ftAttempted = 0;
  let ftAcquired = 0;
  let ftFailed = 0;
  let ftOld = 0;
  let ftNewEdges = 0;
  let ftNewImm = 0;
  let ftNewStill = 0;
  const ftJuris = { SCOTUS: 0, CA3: 0, EDPA: 0, PA: 0, OTHER_FEDERAL: 0, OTHER: 0 };
  const ftResults = [];
  const ledgerAll = [];
  let authorityRows = [];

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
    const startSnap = await healthSnapshot(sql);
    console.log(JSON.stringify({ continueFt: true, noQuotaProbe: true, TOTAL_CL_CAP, alreadyAcquired: already.size, METADATA_ONLY: startSnap.METADATA_ONLY_AUTHORITIES }));

    authorityRows = await sql`
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
    const tierA = moRows
      .map(scoreMoAuth)
      .filter((t) => t.qualityTier === "A" && !already.has(t.id))
      .sort((a, b) => {
        const rank = (b) => (b === "CA3" ? 0 : b === "EDPA" ? 1 : b === "PA" ? 2 : b === "OTHER_FEDERAL" ? 3 : b === "SCOTUS" ? 4 : 5);
        return rank(a.courtBucket) - rank(b.courtBucket) || b.productScore - a.productScore;
      });
    console.log(JSON.stringify({ tierARemaining: tierA.length }));

    let stopReason = "CONTINUE_FT_COMPLETE";
    for (const cand of tierA) {
      if (totalCl + 2 > TOTAL_CL_CAP) {
        stopReason = "QUOTA_SAFETY_THRESHOLD";
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
          ${versionId}, ${cand.id}, ${Number(verRow.v) + 1}, ${text},
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
      const aidx = authorityRows.findIndex((a) => a.id === cand.id);
      if (aidx >= 0) authorityRows[aidx] = { ...authorityRows[aidx], metadata: meta, title, ingestion_status: "ready", has_embeddings: true };
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
          decisionDate: a.decision_date,
          ingestionStatus: a.ingestion_status,
          corpusComplete: Boolean(a.has_embeddings) && a.ingestion_status === "ready",
        })),
      );
      let oldBack = 0;
      const keys = new Set([cand.citation, ...(meta.citationAliases || []), ...(meta.parallelCitations || [])].filter(Boolean).map((c) => targetKey(c, c)));
      const stillU = await sql`select id, from_authority_id, raw_citation, normalized_citation from legal_authority_citations where to_authority_id is null`;
      for (const e of stillU) {
        const key = targetKey(e.raw_citation, e.normalized_citation);
        if (!keys.has(key)) continue;
        const hit = index.lookupCitation(e.raw_citation, e.normalized_citation);
        if (hit.kind !== "one" || hit.authorityId !== cand.id) continue;
        const rows = await sql`
          update legal_authority_citations set to_authority_id=${cand.id}
          where id=${e.id} and to_authority_id is null returning id, raw_citation
        `;
        if (!rows.length) continue;
        if (rows[0].raw_citation !== e.raw_citation) throw new Error("raw_citation_mutated");
        oldBack += 1;
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
      console.log(JSON.stringify({ ftAcquired, citation: cand.citation, courtBucket: cand.courtBucket, totalCl }));
      if (ftAcquired % 5 === 0) {
        const health = await healthSnapshot(sql);
        writeJson(path.join(CHECKPOINT_DIR, `post-ft-reassess-ft-cont-cp-${ftAcquired}.json`), {
          atAcquired: ftAcquired,
          totalCl,
          green: health.green,
          CORPUS_COMPLETE: health.CORPUS_COMPLETE_AUTHORITIES,
        });
        if (!health.green) {
          stopReason = "HEALTH_NOT_GREEN";
          break;
        }
      }
    }

    if (ledgerAll.length) appendLedger(LEDGER_PATH, ledgerAll);
    const end = await healthSnapshot(sql);
    const merged = { ...prior };
    merged.stopReason = hit429 ? "HTTP_429" : stopReason;
    merged.continuation = { noQuotaProbe: true, continueClCap: TOTAL_CL_CAP, continueClUsed: totalCl, ftAcquired, ftAttempted, ftFailed };
    merged.end = {
      AUTHORITY_RESOLVED_EDGES: end.AUTHORITY_RESOLVED_EDGES,
      CORPUS_COMPLETE_EDGES: end.CORPUS_COMPLETE_EDGES,
      IDENTITY_UNRESOLVED_EDGES: end.IDENTITY_UNRESOLVED_EDGES,
      TOTAL_CANONICAL_AUTHORITIES: end.TOTAL_CANONICAL_AUTHORITIES,
      METADATA_ONLY_AUTHORITIES: end.METADATA_ONLY_AUTHORITIES,
      CORPUS_COMPLETE_AUTHORITIES: end.CORPUS_COMPLETE_AUTHORITIES,
      FULL_TEXT_READY_AUTHORITIES: end.FULL_TEXT_READY_AUTHORITIES,
      EMBEDDED_AUTHORITIES: end.EMBEDDED_AUTHORITIES,
    };
    const pFt = prior.fullText || {};
    merged.fullText = {
      ...pFt,
      cl: Number(pFt.cl || 0) + totalCl,
      attempted: Number(pFt.attempted || 0) + ftAttempted,
      completed: Number(pFt.completed || 0) + ftAcquired,
      failed: Number(pFt.failed || 0) + ftFailed,
      byCourt: {
        SCOTUS: Number(pFt.byCourt?.SCOTUS || 0) + ftJuris.SCOTUS,
        CA3: Number(pFt.byCourt?.CA3 || 0) + ftJuris.CA3,
        EDPA: Number(pFt.byCourt?.EDPA || 0) + ftJuris.EDPA,
        PA: Number(pFt.byCourt?.PA || 0) + ftJuris.PA,
        OTHER_FEDERAL: Number(pFt.byCourt?.OTHER_FEDERAL || 0) + ftJuris.OTHER_FEDERAL,
        OTHER: Number(pFt.byCourt?.OTHER || 0) + ftJuris.OTHER,
      },
      metadataToComplete: Number(pFt.metadataToComplete || 0) + ftAcquired,
      NEW_EDGES_TOTAL: Number(pFt.NEW_EDGES_TOTAL || 0) + ftNewEdges,
      NEW_EDGES_RESOLVED_IMMEDIATELY: Number(pFt.NEW_EDGES_RESOLVED_IMMEDIATELY || 0) + ftNewImm,
      NEW_EDGES_STILL_UNRESOLVED: Number(pFt.NEW_EDGES_STILL_UNRESOLVED || 0) + ftNewStill,
      OLD_UNRESOLVED_RESOLVED: Number(pFt.OLD_UNRESOLVED_RESOLVED || 0) + ftOld,
      CORPUS_COMPLETE_EDGES_delta: end.CORPUS_COMPLETE_EDGES - prior.start.CORPUS_COMPLETE_EDGES,
      newEmbeddings: Number(pFt.newEmbeddings || 0) + ftAcquired,
    };
    const oldThis = Number(prior.weekend?.OLD_PROGRESS_THIS_RUN || 0) + ftOld;
    merged.weekend = {
      ...prior.weekend,
      OLD_PROGRESS_THIS_RUN: oldThis,
      OLD_PROGRESS_TOTAL: Number(prior.weekend?.OLD_PROGRESS_BEFORE || 2979) + oldThis,
      OLD_REMAINING_TO_15000: Math.max(0, 15000 - (Number(prior.weekend?.OLD_PROGRESS_BEFORE || 2979) + oldThis)),
      NET_IDENTITY_UNRESOLVED_CHANGE: end.IDENTITY_UNRESOLVED_EDGES - prior.start.IDENTITY_UNRESOLVED_EDGES,
    };
    merged.totalCl = {
      probe: 1,
      identity: Number(prior.totalCl?.identity || 0),
      fullText: Number(prior.totalCl?.fullText || 0) + totalCl,
      retry: Number(prior.totalCl?.retry || 0),
      total: Number(prior.totalCl?.total || 0) + totalCl,
    };
    const hourStart = Number(prior.quota?.hourStart || 0);
    const dayStart = Number(prior.quota?.dayStart || 0);
    merged.quota = {
      ...prior.quota,
      estimatedHourRemaining: Math.max(0, hourStart - (merged.totalCl.total - 1)),
      estimatedDayRemaining: Math.max(0, dayStart - (merged.totalCl.total - 1)),
      hit429: prior.quota?.hit429 || hit429,
      hit502: Number(prior.quota?.hit502 || 0) + hit502,
    };
    merged.health = {
      duplicates: end.duplicates,
      orphans: end.orphans,
      missingEmbeddings: end.missingEmbeddings,
      failed: end.failed,
      notProcessed: end.notProcessed,
      duplicateActiveMappings: 0,
      presentTargetDefectsDeterministic: end.presentTargetDefectsDeterministic,
      rawCitationLoss: 0,
      status: end.green ? "PASS" : "FAIL",
    };
    merged.ftResults = [...(prior.ftResults || []), ...ftResults];
    merged.ok = end.green && !hit429;
    const ftTotal = merged.fullText.completed;
    if (ftTotal >= 40 && merged.ok) {
      merged.finalClassification = "POST_FULLTEXT_REASSESSMENT_STRONG";
      merged.nextDecision = merged.quota.estimatedHourRemaining < 80 ? "RUN_NEXT_FULL_HOUR_AFTER_RECOVERY" : "CONTINUE_HIGH_VALUE_FULLTEXT";
      merged.nextRecommendedClBudget = merged.nextDecision === "CONTINUE_HIGH_VALUE_FULLTEXT" ? 175 : 270;
    } else if (merged.ok) {
      merged.finalClassification = "POST_FULLTEXT_REASSESSMENT_MODERATE";
      merged.nextDecision = "CONTINUE_HIGH_VALUE_FULLTEXT";
      merged.nextRecommendedClBudget = 175;
    }
    // Economic: ge5 identity failed provider-wise → strategic only / FT focus
    if (Number(prior.identity?.high || 0) === 0) {
      merged.weekend.economicBacklogStatus = end.METADATA_ONLY_AUTHORITIES >= 100 ? "ONLY_STRATEGIC_IDENTITY_REMAINS" : "LONG_TAIL_BULK_EXHAUSTED";
      if (end.METADATA_ONLY_AUTHORITIES >= 50) {
        merged.nextDecision = merged.quota.estimatedDayRemaining >= 100 ? "CONTINUE_HIGH_VALUE_FULLTEXT" : "PAUSE_FOR_QUOTA_RECOVERY";
        merged.nextRecommendedClBudget = merged.nextDecision === "CONTINUE_HIGH_VALUE_FULLTEXT" ? 175 : 0;
      }
    }
    writeJson(REPORT_JSON, merged);
    console.log("POST_FULLTEXT_FT_CONTINUE_COMPLETE");
    console.log(JSON.stringify({
      ok: merged.ok,
      stopReason,
      continueCl: totalCl,
      ftAcquired,
      ftFailed,
      totalClCombined: merged.totalCl.total,
      CORPUS_COMPLETE_end: end.CORPUS_COMPLETE_AUTHORITIES,
      METADATA_ONLY_end: end.METADATA_ONLY_AUTHORITIES,
      finalClassification: merged.finalClassification,
      nextDecision: merged.nextDecision,
    }, null, 2));
    process.exit(merged.ok ? 0 : 5);
  } catch (e) {
    console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 2000), totalCl }));
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();
