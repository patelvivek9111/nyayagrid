#!/usr/bin/env node
/**
 * Pass-1 bounded EDPA recovery via known CL cluster IDs / court-filtered search.
 * Does NOT modify shared citation parser architecture.
 * Bypasses exact F.Supp.2d string-match gate by using CL cluster citation metadata
 * after verifying docket court_id === paed and warrant-relevance keywords.
 */
"use strict";
const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const postgres = require("postgres");
const { ensureCaseCitationExtraction } = require("./lib/case-citation-extraction.cjs");

const CL_BASE = "https://www.courtlistener.com/api/rest/v4";
const SOURCE = "courtlistener";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS = 384;
const MAX_OPINION_CHARS = 40000;
const MAX_CHUNK_CHARS = 1000;
const OUT = path.join(
  __dirname,
  "..",
  "packages/research/corpus/reports/corpus-strengthening-pass1-edpa-recovery.json",
);

const KNOWN_CLUSTERS = [
  { clusterId: "2369213", seedCite: "75 F.Supp.2d 411" },
  { clusterId: "2422226", seedCite: "248 F.Supp.2d 393" },
  { clusterId: "2580154", seedCite: "390 F.Supp.2d 471" },
];

const WARRANT_RE =
  /\b(Fourth Amendment|search warrant|motion to suppress|suppression hearing|exclusionary rule|good.?faith exception|particularity requirement|Franks|Illinois v\.\s*Gates|United States v\.\s*Leon|staleness|nexus|affidavit for (a )?search|probable cause to search|probable cause to believe)\b/i;

const EDPA = {
  courtId: "us-d-paed",
  courtLevel: "district",
  authorityState: "US",
  courtName: "United States District Court for the Eastern District of Pennsylvania",
  federalCircuit: "3",
  jurisdiction: "United States",
};

function sha256(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function toPgvector(vec) {
  return `[${vec.join(",")}]`;
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
function pickText(hit) {
  const plain = hit?.plain_text || hit?.plainText;
  if (plain && String(plain).trim().length >= 80) {
    return String(plain).replace(/\s+/g, " ").trim().slice(0, MAX_OPINION_CHARS);
  }
  const html = hit?.html_with_citations || hit?.html || hit?.html_lawbox || hit?.html_columbia || hit?.snippet || "";
  return stripHtml(html).slice(0, MAX_OPINION_CHARS);
}
function normalizeClCite(c) {
  if (!c) return null;
  if (typeof c === "string") {
    const t = c.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    // Prefer F.Supp.2d shape our DB already uses
    const m = t.match(/^(\d{1,4})\s+F\.?\s*Supp\.?\s*2d\s+(\d{1,4})$/i);
    if (m) return `${Number(m[1])} F.Supp.2d ${Number(m[2])}`;
    const m3 = t.match(/^(\d{1,4})\s+F\.?\s*Supp\.?\s*3d\s+(\d{1,4})$/i);
    if (m3) return `${Number(m3[1])} F.Supp.3d ${Number(m3[2])}`;
    const m1 = t.match(/^(\d{1,4})\s+F\.?\s*Supp\.?\s+(\d{1,4})$/i);
    if (m1) return `${Number(m1[1])} F.Supp. ${Number(m1[2])}`;
    return t || null;
  }
  if (typeof c === "object") {
    const vol = c.volume != null ? Number(c.volume) : null;
    const page = c.page != null ? Number(c.page) : null;
    let reporter = String(c.reporter || c.reporter_name || "").trim();
    if (vol && page && reporter) {
      reporter = reporter
        .replace(/\s+/g, " ")
        .replace(/^F\.\s*Supp\.\s*2d$/i, "F.Supp.2d")
        .replace(/^F\.\s*Supp\.\s*3d$/i, "F.Supp.3d")
        .replace(/^F\.\s*Supp\.?$/i, "F.Supp.");
      return `${vol} ${reporter} ${page}`;
    }
    if (c.cite) return normalizeClCite(String(c.cite));
  }
  return null;
}
function collectCites(cluster) {
  const out = [];
  if (Array.isArray(cluster?.citation)) out.push(...cluster.citation.map(normalizeClCite));
  else if (typeof cluster?.citation === "string") out.push(normalizeClCite(cluster.citation));
  if (Array.isArray(cluster?.citations)) {
    for (const c of cluster.citations) out.push(normalizeClCite(c));
  }
  return [...new Set(out.filter(Boolean))];
}
function firstOpinionId(cluster) {
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

async function clFetch(url, apiKey, counters, init = {}) {
  if (counters.apiCalls >= counters.maxCalls) {
    return { status: 0, ok: false, budgetExhausted: true, json: async () => ({}) };
  }
  const rateMs = Math.max(Number(process.env.CL_RATE_MS || 5000), 400);
  const wait = rateMs - (Date.now() - (counters.lastAt || 0));
  if (wait > 0) await sleep(wait);
  counters.apiCalls += 1;
  counters.lastAt = Date.now();
  const timeoutMs = Math.max(Number(process.env.CL_FETCH_TIMEOUT_MS || 120000), 45000);
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Token ${apiKey}`,
      Accept: "application/json",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 429) counters.rateLimited = true;
  if (res.status === 502 || res.status === 504) counters.gatewayErrors += 1;
  return res;
}

async function embedAll(texts, apiKey) {
  const out = [];
  for (let i = 0; i < texts.length; i += 32) {
    const batch = texts.slice(i, i + 32);
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch, dimensions: EMBEDDING_DIMS }),
    });
    if (!res.ok) throw new Error(`embed_http_${res.status}`);
    const body = await res.json();
    out.push(...(body.data || []).sort((a, b) => a.index - b.index).map((d) => d.embedding));
  }
  return out;
}

async function resolveEdpaCluster(apiKey, clusterId, counters) {
  const cRes = await clFetch(`${CL_BASE}/clusters/${clusterId}/`, apiKey, counters);
  if (!cRes.ok) return { ok: false, reason: `cluster_http_${cRes.status}`, clusterId };
  const cluster = await cRes.json();
  let docketId = cluster.docket_id || null;
  if (!docketId && typeof cluster.docket === "string") {
    const m = cluster.docket.match(/dockets\/(\d+)/);
    if (m) docketId = m[1];
  }
  if (!docketId) return { ok: false, reason: "no_docket", clusterId };
  const dRes = await clFetch(`${CL_BASE}/dockets/${docketId}/`, apiKey, counters);
  if (!dRes.ok) return { ok: false, reason: `docket_http_${dRes.status}`, clusterId };
  const docket = await dRes.json();
  const courtKey = String(docket.court_id || docket.court || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (courtKey !== "paed") {
    return {
      ok: false,
      reason: "not_edpa",
      clusterId,
      clCourt: docket.court_id || docket.court || null,
      title: cluster.case_name || null,
    };
  }
  const cites = collectCites(cluster);
  const opinionId = firstOpinionId(cluster);
  if (!opinionId) return { ok: false, reason: "no_opinion_id", clusterId, cites };
  const oRes = await clFetch(`${CL_BASE}/opinions/${opinionId}/`, apiKey, counters);
  if (!oRes.ok) return { ok: false, reason: `opinion_http_${oRes.status}`, clusterId };
  const hit = await oRes.json();
  const text = pickText(hit);
  if (text.length < 80) return { ok: false, reason: "empty_opinion_text", clusterId };
  const warrantScore = (text.match(WARRANT_RE) || []).length + (WARRANT_RE.test(cluster.case_name || "") ? 2 : 0);
  if (warrantScore < 1) {
    return {
      ok: false,
      reason: "not_warrant_relevant",
      clusterId,
      title: cluster.case_name || null,
      cites,
    };
  }
  const citation = cites[0] || null;
  return {
    ok: true,
    clusterId: String(cluster.id || clusterId),
    opinionId,
    title: cluster.case_name || hit.case_name || citation || `CL cluster ${clusterId}`,
    citation,
    cites,
    decisionDate: cluster.date_filed || hit.date_filed || null,
    docketNumber: cluster.docket_number || docket.docket_number || null,
    text,
    warrantScore,
    contentHash: sha256(text),
  };
}

async function searchEdpaWarrant(apiKey, counters, q) {
  const params = new URLSearchParams({
    type: "o",
    court: "paed",
    order_by: "score desc",
    page_size: "8",
    q,
  });
  const url = `${CL_BASE}/search/?${params.toString()}`;
  const res = await clFetch(url, apiKey, counters);
  if (!res.ok) return { ok: false, reason: `search_http_${res.status}` };
  const body = await res.json();
  const results = Array.isArray(body.results) ? body.results : [];
  const clusterIds = [];
  for (const r of results) {
    const cid =
      r.cluster_id ||
      r.clusterId ||
      (typeof r.cluster === "number" || typeof r.cluster === "string" ? r.cluster : null) ||
      (r.cluster && r.cluster.id) ||
      null;
    if (cid) clusterIds.push(String(cid));
    else if (r.absolute_url) {
      const m = String(r.absolute_url).match(/\/opinion\/(\d+)\//);
      if (m) clusterIds.push(m[1]);
    }
  }
  return {
    ok: true,
    clusterIds: [...new Set(clusterIds)].slice(0, 8),
    rawCount: results.length,
    sampleTitles: results.slice(0, 5).map((r) => r.caseName || r.case_name || r.snippet || null),
  };
}

async function persist(sql, opinion, openaiKey) {
  const sourceExternalId = `cl-opinion-${opinion.opinionId}`;
  const existing = await sql`
    select id from legal_authorities
    where source_provider = ${SOURCE} and source_external_id = ${sourceExternalId}
    limit 1
  `;
  if (existing.length) {
    return { status: "already_present", authorityId: existing[0].id, embeddedChunks: 0 };
  }
  if (opinion.citation) {
    const byCite = await sql`
      select id from legal_authorities
      where normalized_citation = ${opinion.citation} or citation = ${opinion.citation}
      limit 1
    `;
    if (byCite.length) {
      return { status: "already_present_by_cite", authorityId: byCite[0].id, embeddedChunks: 0 };
    }
  }
  const authorityId = randomUUID();
  const versionId = randomUUID();
  const metadata = {
    sourceClass: "PRIMARY_PUBLIC_REPOSITORY",
    adapter: "pass1-edpa-cluster-recovery",
    clCourt: "paed",
    retrievedAt: new Date().toISOString(),
    citationStatus: opinion.citation ? "reported" : "unset",
    clusterId: opinion.clusterId,
    warrantScore: opinion.warrantScore,
    citesFromCluster: opinion.cites,
    note: "Acquired via cluster/docket EDPA verification; bypassed exact F.Supp string-match gate without changing shared parser.",
  };
  await sql`
    insert into legal_authorities (
      id, authority_type, jurisdiction, court, court_id, authority_state,
      federal_circuit, court_level, title, citation, normalized_citation,
      docket_number, decision_date, source_provider, source_external_id,
      canonical_source_url, metadata, ingestion_status, created_at, updated_at, last_checked_at
    ) values (
      ${authorityId}, 'case', ${EDPA.jurisdiction}, ${EDPA.courtName}, ${EDPA.courtId},
      ${EDPA.authorityState}, ${EDPA.federalCircuit}, ${EDPA.courtLevel},
      ${opinion.title}, ${opinion.citation}, ${opinion.citation},
      ${opinion.docketNumber}, ${opinion.decisionDate}, ${SOURCE}, ${sourceExternalId},
      ${`https://www.courtlistener.com/opinion/${opinion.clusterId}/`}, ${sql.json(metadata)},
      'processing'::authority_ingestion_status, now(), now(), now()
    )
  `;
  await sql`
    insert into legal_authority_versions (
      id, authority_id, version_number, content, effective_from, effective_to,
      source_provider, source_metadata, sha256
    ) values (
      ${versionId}, ${authorityId}, 1, ${opinion.text},
      ${opinion.decisionDate}, ${null}, ${SOURCE},
      ${sql.json({ adapter: "pass1-edpa-cluster-recovery", clusterId: opinion.clusterId })},
      ${opinion.contentHash}
    )
  `;
  const chunks = chunkContent(opinion.text);
  const vectors = await embedAll(chunks, openaiKey);
  for (let i = 0; i < chunks.length; i++) {
    await sql`
      insert into legal_authority_chunks (
        id, authority_id, authority_version_id, chunk_index, content,
        segment_ref, char_start, char_end, embedding, embedding_model
      ) values (
        ${randomUUID()}, ${authorityId}, ${versionId}, ${i}, ${chunks[i]},
        ${`p${i + 1}`}, ${null}, ${null}, ${toPgvector(vectors[i])}::vector,
        ${`${EMBEDDING_MODEL}:${EMBEDDING_DIMS}`}
      )
    `;
  }
  await ensureCaseCitationExtraction(sql, {
    authorityId,
    content: opinion.text,
    existingMetadata: metadata,
  });
  await sql`
    update legal_authorities
    set ingestion_status = 'ready'::authority_ingestion_status, updated_at = now()
    where id = ${authorityId}
  `;
  return { status: "imported", authorityId, embeddedChunks: chunks.length };
}

async function main() {
  const clKey = process.env.COURTLISTENER_API_KEY?.trim();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const maxCalls = Math.min(Math.max(Number(process.env.EDPA_MAX_CL || 25), 5), 30);
  const acquireLimit = Math.min(Math.max(Number(process.env.EDPA_ACQUIRE_LIMIT || 5), 1), 5);
  if (!clKey || !databaseUrl || !openaiKey) {
    console.log(JSON.stringify({ ok: false, reason: "missing_env", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  const sql = postgres(databaseUrl, { max: 1, ssl: "require", idle_timeout: 10, connect_timeout: 30 });
  const counters = { apiCalls: 0, maxCalls, rateLimited: false, lastAt: 0, gatewayErrors: 0 };
  const attempts = [];
  const acquired = [];
  const deferred = [];
  let limitation = null;

  try {
    const searchQueries = [
      '"search warrant" "probable cause"',
      '"motion to suppress" warrant',
      'Leon "good faith" warrant',
      'Gates "probable cause" affidavit',
    ];
    // Skip previously resolved known clusters that failed warrant filter / wrong court
    const skip = new Set(["2369213", "2422226", "2580154"]);
    const queue = [];
    for (const k of KNOWN_CLUSTERS) {
      if (!skip.has(k.clusterId)) queue.push(k.clusterId);
    }

    for (const q of searchQueries) {
      if (counters.apiCalls >= maxCalls - 8) break;
      const s = await searchEdpaWarrant(clKey, counters, q);
      attempts.push({ step: "search", q, ...s, clRequests: 1 });
      if (s.ok) {
        for (const id of s.clusterIds) {
          if (!skip.has(id) && !queue.includes(id)) queue.push(id);
        }
      } else if (s.reason && /502|504/.test(s.reason)) {
        limitation = "EDPA_LOOKUP_LIMITATION";
      }
    }

    for (const clusterId of queue) {
      if (acquired.length >= acquireLimit) break;
      if (counters.apiCalls >= maxCalls || counters.rateLimited) {
        deferred.push({ clusterId, reason: counters.rateLimited ? "rate_limited" : "budget" });
        break;
      }
      const resolved = await resolveEdpaCluster(clKey, clusterId, counters);
      attempts.push({ step: "resolve", ...resolved, clusterId });
      if (!resolved.ok) {
        deferred.push({ clusterId, reason: resolved.reason, clCourt: resolved.clCourt || null });
        if (resolved.reason && /502|504/.test(resolved.reason)) limitation = "EDPA_LOOKUP_LIMITATION";
        continue;
      }
      const persisted = await persist(sql, resolved, openaiKey);
      const row = {
        clusterId: resolved.clusterId,
        opinionId: resolved.opinionId,
        citation: resolved.citation,
        title: resolved.title,
        warrantScore: resolved.warrantScore,
        ...persisted,
      };
      if (persisted.status === "imported") acquired.push(row);
      else deferred.push({ ...row, reason: persisted.status });
    }

    if (acquired.length === 0 && !limitation) limitation = "EDPA_LOOKUP_LIMITATION";

    const [forum] = await sql`
      select count(*)::int as n from legal_authorities
      where authority_type='case' and court_id='us-d-paed'
    `;

    const payload = {
      ok: true,
      classification: "PASS1_EDPA_BOUNDED_RECOVERY",
      courtListenerHttpCalls: counters.apiCalls,
      rateLimited: counters.rateLimited,
      gatewayErrors: counters.gatewayErrors,
      acquireLimit,
      acquiredCount: acquired.length,
      acquired,
      deferred,
      attempts: attempts.slice(0, 40),
      edpaCaseCountAfter: forum.n,
      limitation,
      sharedArchitectureChanged: false,
      note:
        limitation && acquired.length === 0
          ? "EDPA_LOOKUP_LIMITATION: could not recover warrant-useful EDPA opinions within bounded cluster/search path without shared citation-architecture changes."
          : "Bounded EDPA recovery via cluster ID + docket court verification and/or court-filtered search.",
    };
    fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
    console.log(JSON.stringify(payload));
  } catch (e) {
    const payload = {
      ok: false,
      err: String(e.message || e).slice(0, 500),
      courtListenerHttpCalls: counters.apiCalls,
      limitation: "EDPA_LOOKUP_LIMITATION",
      sharedArchitectureChanged: false,
    };
    fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
    console.log(JSON.stringify(payload));
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();
