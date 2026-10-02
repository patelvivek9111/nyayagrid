#!/usr/bin/env node
/**
 * Queue #2 verified F.3d micro-batch:
 * citation-lookup pre-verify only (no search fallback), then acquire.
 *
 * Usage:
 *   node tmp-queue2-f3d-verified-batch.cjs '<cite|cite|...>' <maxCalls> [acquireLimit]
 */
"use strict";

const { createHash, randomUUID } = require("node:crypto");
const postgres = require("postgres");
const { ensureCaseCitationExtraction } = require("./lib/case-citation-extraction.cjs");

const CL_BASE = "https://www.courtlistener.com/api/rest/v4";
const SOURCE = "courtlistener";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS = 384;
const MAX_OPINION_CHARS = 40_000;
const MAX_CHUNK_CHARS = 1000;

const CIRCUIT_MAP = {
  ca1: { courtId: "us-ca-1", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the First Circuit", federalCircuit: "1", jurisdiction: "United States", clCourt: "ca1" },
  ca2: { courtId: "us-ca-2", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Second Circuit", federalCircuit: "2", jurisdiction: "United States", clCourt: "ca2" },
  ca3: { courtId: "us-ca-3", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Third Circuit", federalCircuit: "3", jurisdiction: "United States", clCourt: "ca3" },
  ca4: { courtId: "us-ca-4", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Fourth Circuit", federalCircuit: "4", jurisdiction: "United States", clCourt: "ca4" },
  ca5: { courtId: "us-ca-5", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Fifth Circuit", federalCircuit: "5", jurisdiction: "United States", clCourt: "ca5" },
  ca6: { courtId: "us-ca-6", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Sixth Circuit", federalCircuit: "6", jurisdiction: "United States", clCourt: "ca6" },
  ca7: { courtId: "us-ca-7", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Seventh Circuit", federalCircuit: "7", jurisdiction: "United States", clCourt: "ca7" },
  ca8: { courtId: "us-ca-8", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Eighth Circuit", federalCircuit: "8", jurisdiction: "United States", clCourt: "ca8" },
  ca9: { courtId: "us-ca-9", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Ninth Circuit", federalCircuit: "9", jurisdiction: "United States", clCourt: "ca9" },
  ca10: { courtId: "us-ca-10", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Tenth Circuit", federalCircuit: "10", jurisdiction: "United States", clCourt: "ca10" },
  ca11: { courtId: "us-ca-11", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Eleventh Circuit", federalCircuit: "11", jurisdiction: "United States", clCourt: "ca11" },
  cadc: { courtId: "us-ca-dc", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the District of Columbia Circuit", federalCircuit: "dc", jurisdiction: "United States", clCourt: "cadc" },
  cafc: { courtId: "us-ca-fed", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Federal Circuit", federalCircuit: "fed", jurisdiction: "United States", clCourt: "cafc" },
};

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
function leanNormalizeF3d(cite) {
  const m = String(cite || "")
    .replace(/\s+/g, " ")
    .trim()
    .match(/^(\d{1,4})\s+F\.?\s*3d\s+(\d{1,4})$/i);
  return m ? `${m[1]} F.3d ${m[2]}` : null;
}
function parseF3d(cite) {
  const norm = leanNormalizeF3d(cite);
  if (!norm) return null;
  const m = norm.match(/^(\d{1,4}) F\.3d (\d{1,4})$/);
  return m ? { volume: Number(m[1]), page: Number(m[2]), citation: norm, reporter: "F.3d", family: "f3d", series: "3d" } : null;
}
function citationMatchesTarget(candidate, target) {
  const parsed = parseF3d(candidate);
  if (!parsed) return false;
  return parsed.volume === target.volume && parsed.page === target.page;
}
function collectClusterCites(cluster) {
  const cites = [];
  if (Array.isArray(cluster?.citation)) cites.push(...cluster.citation.map(String));
  else if (typeof cluster?.citation === "string" && cluster.citation.trim()) cites.push(cluster.citation);
  if (Array.isArray(cluster?.citations)) {
    for (const c of cluster.citations) {
      if (typeof c === "string" && c.trim()) cites.push(c);
      else if (c && typeof c === "object") {
        if (c.cite) cites.push(String(c.cite));
        const vol = c.volume != null ? Number(c.volume) : null;
        const page = c.page != null ? Number(c.page) : null;
        const reporter = String(c.reporter || c.reporter_name || "");
        if (vol && page && /F\.?\s*3d/i.test(reporter)) cites.push(`${vol} F.3d ${page}`);
      }
    }
  }
  return cites;
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
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function mapCourt(cluster, hit) {
  const raw =
    cluster?.court_id ||
    cluster?.court ||
    hit?.court_id ||
    hit?.court ||
    "";
  let key = String(raw).toLowerCase();
  if (key.includes("/")) key = key.split("/").filter(Boolean).pop() || key;
  key = key.replace(/[^a-z0-9]/g, "");
  if (CIRCUIT_MAP[key]) return CIRCUIT_MAP[key];
  // fallback generic federal appellate
  return {
    courtId: key ? `us-${key}` : "us-ca-unknown",
    courtLevel: "circuit",
    authorityState: "US",
    courtName: cluster?.court || hit?.court || "United States Court of Appeals",
    federalCircuit: null,
    jurisdiction: "United States",
    clCourt: key || "unknown",
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
  for (let i = 0; i < texts.length; i += 32) {
    out.push(...(await embedBatch(texts.slice(i, i + 32), apiKey)));
  }
  return out;
}
async function clFetch(url, apiKey, counters, init = {}) {
  if (counters.apiCalls >= counters.maxCalls) {
    return { status: 0, ok: false, rateLimited: false, budgetExhausted: true, json: async () => ({}) };
  }
  const rateMs = Math.max(Number(process.env.CL_RATE_MS || 2200), 400);
  const wait = rateMs - (Date.now() - (counters.lastAt || 0));
  if (wait > 0) await sleep(wait);
  counters.apiCalls += 1;
  counters.lastAt = Date.now();
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Token ${apiKey}`,
      Accept: "application/json",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(45000),
  });
  if (res.status === 429) {
    counters.rateLimited = true;
    counters.lastRetryAfter = res.headers.get("retry-after");
  }
  return res;
}
async function authorityPresent(sql, citation) {
  return sql`
    select id, citation, normalized_citation, source_external_id
    from legal_authorities
    where normalized_citation = ${citation} or citation = ${citation}
    limit 5
  `;
}

async function resolveClusterViaLookup(apiKey, target, counters) {
  const res = await clFetch(`${CL_BASE}/citation-lookup/`, apiKey, counters, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: target.citation }),
  });
  if (res.budgetExhausted) return { ok: false, reason: "budget_exhausted" };
  if (res.status === 429) return { ok: false, reason: "rate_limited", retryAfter: counters.lastRetryAfter };
  if (!res.ok) return { ok: false, reason: `lookup_http_${res.status}` };
  const body = await res.json();
  const rows = Array.isArray(body) ? body : Array.isArray(body?.results) ? body.results : [];
  for (const row of rows) {
    const clusters = Array.isArray(row.clusters) ? row.clusters : row.cluster ? [row.cluster] : [];
    for (const cluster of clusters) {
      const cites = collectClusterCites(cluster);
      const matched = cites.some((c) => citationMatchesTarget(c, target));
      const statusOk = row.status == null || Number(row.status) === 200;
      if (matched && statusOk) {
        return {
          ok: true,
          method: "citation-lookup",
          clusterId: cluster.id || cluster.cluster_id || null,
          cluster,
          cites,
        };
      }
    }
    const normCites = Array.isArray(row.normalized_citations) ? row.normalized_citations : [];
    if (normCites.some((c) => citationMatchesTarget(String(c), target)) && clusters[0]) {
      return {
        ok: true,
        method: "citation-lookup",
        clusterId: clusters[0].id || clusters[0].cluster_id || null,
        cluster: clusters[0],
        cites: normCites.map(String),
      };
    }
  }
  return { ok: false, reason: "no_verified_cluster_match" };
}

async function fetchOpinionAndCluster(apiKey, seed, target, counters) {
  let cluster = seed.cluster || null;
  let clusterId = seed.clusterId || cluster?.id || null;

  if (!cluster && clusterId) {
    const cRes = await clFetch(`${CL_BASE}/clusters/${clusterId}/`, apiKey, counters);
    if (cRes.budgetExhausted) return { ok: false, reason: "budget_exhausted" };
    if (cRes.status === 429) return { ok: false, reason: "rate_limited" };
    if (!cRes.ok) return { ok: false, reason: `cluster_http_${cRes.status}` };
    cluster = await cRes.json();
  }

  if (cluster) {
    const cites = collectClusterCites(cluster);
    if (!cites.some((c) => citationMatchesTarget(c, target))) {
      return { ok: false, reason: "cluster_citation_mismatch", cites };
    }
  }

  let opinionId = seed.opinionId || null;
  if (!opinionId && cluster) {
    const opinions = Array.isArray(cluster.sub_opinions)
      ? cluster.sub_opinions
      : Array.isArray(cluster.opinions)
        ? cluster.opinions
        : [];
    for (const op of opinions) {
      if (typeof op === "number" || (typeof op === "string" && /^\d+$/.test(op))) {
        opinionId = String(op);
        break;
      }
      if (op && typeof op === "object" && op.id != null) {
        opinionId = String(op.id);
        break;
      }
      if (typeof op === "string" && op.includes("/opinions/")) {
        const m = op.match(/\/opinions\/(\d+)/);
        if (m) {
          opinionId = m[1];
          break;
        }
      }
    }
  }
  if (!opinionId) return { ok: false, reason: "no_opinion_id" };

  const oRes = await clFetch(`${CL_BASE}/opinions/${opinionId}/`, apiKey, counters);
  if (oRes.budgetExhausted) return { ok: false, reason: "budget_exhausted" };
  if (oRes.status === 429) return { ok: false, reason: "rate_limited" };
  if (!oRes.ok) return { ok: false, reason: `opinion_http_${oRes.status}` };
  const hit = await oRes.json();
  const text = pickText(hit);
  if (text.length < 80) return { ok: false, reason: "empty_opinion_text" };

  const mapped = mapCourt(cluster, hit);
  const title =
    (cluster && (cluster.case_name || cluster.case_name_full)) ||
    hit.case_name ||
    hit.caseName ||
    target.citation;
  const decisionDate = cluster?.date_filed || hit.date_filed || null;
  const docket = cluster?.docket_number || hit.docket_number || null;
  const canonicalSourceUrl = `https://www.courtlistener.com/opinion/${clusterId || opinionId}/`;

  return {
    ok: true,
    opinion: {
      title: String(title).slice(0, 500),
      citation: target.citation,
      normalizedCitation: target.citation,
      targetCitation: target.citation,
      docketNumber: docket,
      decisionDate,
      content: text,
      contentHash: sha256(text),
      canonicalSourceUrl,
      retrievedAt: new Date().toISOString(),
      opinionId,
      clusterId: clusterId != null ? String(clusterId) : null,
      sourceExternalId: `cl-opinion-${opinionId}`,
      mapped,
    },
  };
}

async function persistOpinion(sql, opinion, apiKey) {
  const mapped = opinion.mapped;
  const existing = await sql`
    select id from legal_authorities
    where source_provider = ${SOURCE} and source_external_id = ${opinion.sourceExternalId}
    limit 1
  `;
  const metadata = {
    sourceClass: "PRIMARY_PUBLIC_REPOSITORY",
    adapter: "courtlistener-a2-f3d-verified",
    clCourt: mapped.clCourt,
    retrievedAt: opinion.retrievedAt,
    citationStatus: "reported",
    a2TargetCitation: opinion.targetCitation,
    verifiedReporterMatch: true,
    reporter: "F.3d",
  };

  if (existing.length > 0) {
    const authorityId = existing[0].id;
    const latest = await sql`
      select id, version_number, sha256 from legal_authority_versions
      where authority_id = ${authorityId} order by version_number desc limit 1
    `;
    if (latest.length > 0 && latest[0].sha256 === opinion.contentHash) {
      await sql`update legal_authorities set last_checked_at = now(), updated_at = now() where id = ${authorityId}`;
      return { status: "skipped", authorityId, embeddedChunks: 0 };
    }
  }

  const authorityId = existing.length > 0 ? existing[0].id : randomUUID();
  const versionId = randomUUID();
  const norm = opinion.normalizedCitation;

  if (existing.length === 0) {
    await sql`
      insert into legal_authorities (
        id, authority_type, jurisdiction, court, court_id, authority_state,
        federal_circuit, court_level, title, citation, normalized_citation,
        docket_number, decision_date, source_provider, source_external_id,
        canonical_source_url, metadata, ingestion_status, created_at, updated_at, last_checked_at
      ) values (
        ${authorityId}, 'case', ${mapped.jurisdiction}, ${mapped.courtName}, ${mapped.courtId},
        ${mapped.authorityState}, ${mapped.federalCircuit}, ${mapped.courtLevel},
        ${opinion.title}, ${opinion.citation}, ${norm},
        ${opinion.docketNumber}, ${opinion.decisionDate}, ${SOURCE}, ${opinion.sourceExternalId},
        ${opinion.canonicalSourceUrl}, ${sql.json(metadata)}, 'processing'::authority_ingestion_status,
        now(), now(), now()
      )
    `;
  } else {
    await sql`
      update legal_authority_versions set valid_to = now()
      where authority_id = ${authorityId} and valid_to is null
    `;
    await sql`
      update legal_authorities set
        title = ${opinion.title},
        citation = ${opinion.citation},
        normalized_citation = ${norm},
        docket_number = ${opinion.docketNumber},
        decision_date = ${opinion.decisionDate},
        court = ${mapped.courtName},
        court_id = ${mapped.courtId},
        court_level = ${mapped.courtLevel},
        federal_circuit = ${mapped.federalCircuit},
        canonical_source_url = ${opinion.canonicalSourceUrl},
        metadata = ${sql.json(metadata)},
        last_checked_at = now(),
        updated_at = now()
      where id = ${authorityId}
    `;
  }

  const nextVersion =
    existing.length === 0
      ? 1
      : Number(
          (
            await sql`
              select coalesce(max(version_number), 0)::int as v
              from legal_authority_versions where authority_id = ${authorityId}
            `
          )[0].v,
        ) + 1;

  await sql`
    insert into legal_authority_versions (
      id, authority_id, version_number, content, effective_from, effective_to,
      source_provider, source_metadata, sha256
    ) values (
      ${versionId}, ${authorityId}, ${nextVersion}, ${opinion.content},
      ${opinion.decisionDate}, ${null}, ${SOURCE},
      ${sql.json({ adapter: "courtlistener-a2-f3d-verified", retrievedAt: opinion.retrievedAt, target: opinion.targetCitation })},
      ${opinion.contentHash}
    )
  `;

  const chunks = chunkContent(opinion.content);
  const vectors = await embedAll(chunks, apiKey);
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
  const citeResult = await ensureCaseCitationExtraction(sql, {
    authorityId,
    content: opinion.content,
    existingMetadata: typeof metadata !== "undefined" ? metadata : { adapter: "courtlistener-a2-f3d-verified" },
  });
  await sql`
    update legal_authorities
    set ingestion_status = 'ready'::authority_ingestion_status, updated_at = now()
    where id = ${authorityId}
  `;
  return {
    status: existing.length ? "new_version" : "imported",
    authorityId,
    embeddedChunks: chunks.length,
    citationEdges: citeResult.inserted,
  };
}

async function main() {
  const clKey = process.env.COURTLISTENER_API_KEY?.trim();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const maxCalls = Math.min(
    Math.max(Number.parseInt(process.argv[3] || process.env.A2_MAX_PRODUCTIVE_CALLS || "15", 10) || 15, 1),
    15,
  );
  const acquireLimit = Math.min(
    Math.max(Number.parseInt(process.argv[4] || process.env.A2_ACQUIRE_LIMIT || "5", 10) || 5, 1),
    5,
  );
  const citations = String(process.argv[2] || process.env.A2_CITATIONS || "")
    .split("|")
    .map((s) => leanNormalizeF3d(s.trim()))
    .filter(Boolean);

  if (!clKey || !databaseUrl || !openaiKey) {
    console.log(JSON.stringify({ ok: false, reason: "missing_env" }));
    process.exit(2);
  }

  const sql = postgres(databaseUrl, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  const counters = { apiCalls: 0, maxCalls, rateLimited: false, lastAt: 0, lastRetryAfter: null };
  const preverify = [];
  const results = [];
  const deferred = [];
  const verified = [];

  try {
    for (const citation of citations) {
      if (verified.length >= acquireLimit) break;
      if (counters.apiCalls >= maxCalls || counters.rateLimited) break;
      const target = parseF3d(citation);
      if (!target) {
        deferred.push({ citation, reason: "unsupported_non_f3d", clRequests: 0, retry: "defer" });
        continue;
      }
      const present = await authorityPresent(sql, target.citation);
      if (present.length > 0) {
        preverify.push({ citation: target.citation, status: "already_present", authorityId: present[0].id, clRequests: 0 });
        continue;
      }
      const before = counters.apiCalls;
      const resolved = await resolveClusterViaLookup(clKey, target, counters);
      const spent = counters.apiCalls - before;
      if (!resolved.ok) {
        const row = {
          citation: target.citation,
          reason: resolved.reason,
          clRequests: spent,
          retry: resolved.reason === "rate_limited" || resolved.reason === "budget_exhausted" ? "stop" : "defer",
        };
        deferred.push(row);
        preverify.push({ ...row, status: "preverify_fail" });
        if (row.retry === "stop") break;
        continue;
      }
      verified.push({ target, seed: resolved, preverifyCl: spent });
      preverify.push({
        citation: target.citation,
        status: "verified",
        method: resolved.method,
        clusterId: resolved.clusterId,
        clRequests: spent,
      });
    }

    for (const item of verified) {
      if (counters.apiCalls >= maxCalls || counters.rateLimited) {
        results.push({ citation: item.target.citation, status: "skipped", reason: counters.rateLimited ? "rate_limited" : "budget_exhausted", clRequests: 0 });
        break;
      }
      const before = counters.apiCalls;
      const fetched = await fetchOpinionAndCluster(clKey, item.seed, item.target, counters);
      if (!fetched.ok) {
        const spent = counters.apiCalls - before;
        results.push({
          citation: item.target.citation,
          status: "skipped",
          reason: fetched.reason,
          clRequests: item.preverifyCl + spent,
          retry: "defer",
        });
        deferred.push({ citation: item.target.citation, reason: fetched.reason, clRequests: item.preverifyCl + spent, retry: "defer" });
        if (fetched.reason === "rate_limited" || fetched.reason === "budget_exhausted") break;
        continue;
      }
      const persisted = await persistOpinion(sql, fetched.opinion, openaiKey);
      const spent = counters.apiCalls - before;
      results.push({
        citation: item.target.citation,
        status: persisted.status,
        authorityId: persisted.authorityId,
        sourceExternalId: fetched.opinion.sourceExternalId,
        clusterId: fetched.opinion.clusterId,
        opinionId: fetched.opinion.opinionId,
        embeddedChunks: persisted.embeddedChunks,
        title: fetched.opinion.title,
        circuit: fetched.opinion.mapped.federalCircuit,
        court: fetched.opinion.mapped.courtName,
        method: item.seed.method,
        clRequests: item.preverifyCl + spent,
        preverifyCl: item.preverifyCl,
        acquireCl: spent,
        canonicalSourceUrl: fetched.opinion.canonicalSourceUrl,
        reporter: "F.3d",
      });
    }

    const [corpus] = await sql`
      select count(*)::int as authorities,
             count(*) filter (where authority_type='case')::int as cases,
             count(*) filter (where authority_type='case' and source_provider='courtlistener')::int as cl_cases
      from legal_authorities
    `;
    const [chunks] = await sql`
      select count(*)::int as chunks,
             count(*) filter (where embedding is not null)::int as embeddings,
             count(*) filter (where embedding is null)::int as missing_embeddings
      from legal_authority_chunks
    `;
    const dupes = await sql`
      select count(*)::int as n from (
        select 1 from legal_authorities where source_external_id is not null
        group by source_provider, source_external_id having count(*) > 1
      ) d
    `;
    const orphans = await sql`
      select count(*)::int as n from legal_authority_chunks c
      left join legal_authorities a on a.id = c.authority_id where a.id is null
    `;

    console.log(
      JSON.stringify({
        ok: true,
        classification: "A2_F3D_VERIFIED_MICRO_BATCH",
        maxCalls,
        acquireLimit,
        courtListenerHttpCalls: counters.apiCalls,
        rateLimited: counters.rateLimited,
        considered: citations.length,
        preverified: verified.length,
        acquired: results.filter((r) => r.status === "imported" || r.status === "new_version").length,
        deferred,
        preverify,
        results,
        corpus,
        chunks,
        duplicateSourceIds: dupes[0]?.n || 0,
        orphans: orphans[0]?.n || 0,
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 500), courtListenerHttpCalls: 0 }));
  process.exit(1);
});
