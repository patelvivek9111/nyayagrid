/**
 * Queue #2 A2 citation-target recovery — bounded CourtListener ingest by citation.
 * Deterministic identity match only. No fabricated reporter/case metadata.
 *
 * Usage on staging:
 *   A2_MAX_PRODUCTIVE_CALLS=15 A2_CITATIONS='466 U.S. 668|373 U.S. 83' \
 *     node tmp-queue2-a2-citation-target-ingest.cjs
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

const SCOTUS_MAP = {
  courtId: "us-scotus",
  courtLevel: "scotus",
  authorityState: "US",
  courtName: "Supreme Court of the United States",
  federalCircuit: null,
  jurisdiction: "United States",
  clCourt: "scotus",
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

function leanNormalizeUs(cite) {
  const m = String(cite || "")
    .replace(/\s+/g, " ")
    .trim()
    .match(/^(\d{1,3})\s+U\.?\s*S\.?\s+(\d{1,4})$/i);
  return m ? `${m[1]} U.S. ${m[2]}` : null;
}

function parseUsReports(cite) {
  const norm = leanNormalizeUs(cite);
  if (!norm) return null;
  const m = norm.match(/^(\d{1,3}) U\.S\. (\d{1,4})$/);
  return m ? { volume: Number(m[1]), page: Number(m[2]), citation: norm, reporter: "U.S.", family: "us_reports" } : null;
}

function citationMatchesTarget(candidate, target) {
  const parsed = parseUsReports(candidate);
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
        if (vol && page && /U\.?\s*S\.?/i.test(reporter)) cites.push(`${vol} U.S. ${page}`);
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
    const batch = texts.slice(i, i + 32);
    out.push(...(await embedBatch(batch, apiKey)));
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
  const rows = await sql`
    select id, citation, normalized_citation, source_external_id
    from legal_authorities
    where normalized_citation = ${citation}
       or citation = ${citation}
       or normalized_citation ilike ${citation}
       or citation ilike ${citation}
    limit 5
  `;
  return rows;
}

async function persistOpinion(sql, opinion, apiKey) {
  const mapped = SCOTUS_MAP;
  const existing = await sql`
    select id from legal_authorities
    where source_provider = ${SOURCE} and source_external_id = ${opinion.sourceExternalId}
    limit 1
  `;
  const metadata = {
    sourceClass: "PRIMARY_PUBLIC_REPOSITORY",
    adapter: "courtlistener-a2-citation-target",
    clCourt: "scotus",
    retrievedAt: opinion.retrievedAt,
    citationStatus: "reported",
    a2TargetCitation: opinion.targetCitation,
    verifiedReporterMatch: true,
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
        canonical_source_url, ingestion_status, currentness_status, last_checked_at,
        hierarchy_path, metadata
      ) values (
        ${authorityId}, ${"case"}::authority_type, ${mapped.jurisdiction}, ${mapped.courtName},
        ${mapped.courtId}, ${mapped.authorityState}, ${mapped.federalCircuit}, ${mapped.courtLevel},
        ${opinion.title}, ${opinion.citation}, ${norm}, ${opinion.docketNumber}, ${opinion.decisionDate},
        ${SOURCE}, ${opinion.sourceExternalId}, ${opinion.canonicalSourceUrl},
        'processing'::authority_ingestion_status, 'unknown'::authority_currentness_status, now(),
        ${sql.json([])}, ${sql.json(metadata)}
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
      ${sql.json({ adapter: "courtlistener-a2-citation-target", retrievedAt: opinion.retrievedAt, target: opinion.targetCitation })},
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
    existingMetadata: metadata,
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
    // Some responses nest citations at row level with cluster ids only
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
  return { ok: false, reason: "no_verified_cluster_match", sample: rows.slice(0, 2) };
}

async function resolveViaSearch(apiKey, target, counters) {
  const params = new URLSearchParams({
    type: "o",
    q: `"${target.citation}"`,
    court: "scotus",
    order_by: "score desc",
    page_size: "5",
  });
  const res = await clFetch(`${CL_BASE}/search/?${params}`, apiKey, counters);
  if (res.budgetExhausted) return { ok: false, reason: "budget_exhausted" };
  if (res.status === 429) return { ok: false, reason: "rate_limited", retryAfter: counters.lastRetryAfter };
  if (!res.ok) return { ok: false, reason: `search_http_${res.status}` };
  const body = await res.json();
  const results = Array.isArray(body.results) ? body.results : [];
  for (const hit of results) {
    const cites = [];
    if (Array.isArray(hit.citation)) cites.push(...hit.citation.map(String));
    else if (typeof hit.citation === "string") cites.push(hit.citation);
    if (Array.isArray(hit.citations)) {
      for (const c of hit.citations) {
        if (typeof c === "string") cites.push(c);
        else if (c?.cite) cites.push(String(c.cite));
      }
    }
    if (!cites.some((c) => citationMatchesTarget(c, target))) continue;
    const opinionId = hit.id ?? hit.opinion_id ?? (Array.isArray(hit.opinions) ? hit.opinions[0]?.id : null);
    return {
      ok: true,
      method: "search",
      hit,
      opinionId: opinionId != null ? String(opinionId) : null,
      clusterId: hit.cluster_id ?? hit.clusterId ?? null,
      cites,
    };
  }
  return { ok: false, reason: "no_verified_search_match", hits: results.length };
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
    // Prefer numeric ids; first listed is typically the lead/majority when ordered by CL.
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

  let hit = seed.hit || null;
  let text = hit ? pickText(hit) : "";
  if ((!opinionId || text.length < 80) && opinionId) {
    const oRes = await clFetch(`${CL_BASE}/opinions/${opinionId}/`, apiKey, counters);
    if (oRes.budgetExhausted) return { ok: false, reason: "budget_exhausted" };
    if (oRes.status === 429) return { ok: false, reason: "rate_limited" };
    if (!oRes.ok) return { ok: false, reason: `opinion_http_${oRes.status}` };
    hit = await oRes.json();
    text = pickText(hit);
    if (!clusterId && hit.cluster) {
      clusterId =
        typeof hit.cluster === "object"
          ? hit.cluster.id
          : String(hit.cluster).match(/\/clusters\/(\d+)/)?.[1] || hit.cluster;
    }
  } else if (!opinionId && hit?.id) {
    opinionId = String(hit.id);
  }

  if (!opinionId) return { ok: false, reason: "missing_opinion_id" };
  if (text.length < 80) return { ok: false, reason: "insufficient_opinion_text", chars: text.length };

  // Final identity gate: cluster cites or hit cites must match target.
  const allCites = [
    ...collectClusterCites(cluster || {}),
    ...(Array.isArray(hit?.citation) ? hit.citation.map(String) : hit?.citation ? [String(hit.citation)] : []),
  ];
  if (!allCites.some((c) => citationMatchesTarget(c, target))) {
    return { ok: false, reason: "final_citation_mismatch", cites: allCites.slice(0, 8) };
  }

  const title =
    (cluster && cluster.case_name) ||
    hit?.case_name ||
    hit?.caseName ||
    target.citation;
  const docket =
    cluster?.docket_number != null
      ? String(cluster.docket_number)
      : hit?.docketNumber || hit?.docket_number || null;
  const decisionDate = (cluster?.date_filed || hit?.date_filed || hit?.dateFiled || null)?.slice?.(0, 10) || null;
  const abs =
    cluster?.absolute_url || hit?.absolute_url || (opinionId ? `/opinion/${opinionId}/` : null);
  const canonicalSourceUrl = abs
    ? abs.startsWith("http")
      ? abs
      : `https://www.courtlistener.com${abs.startsWith("/") ? "" : "/"}${abs}`
    : `https://www.courtlistener.com/opinion/${opinionId}/`;

  return {
    ok: true,
    opinion: {
      sourceExternalId: `cl-opinion-${opinionId}`,
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
    },
  };
}

async function main() {
  const clKey = process.env.COURTLISTENER_API_KEY?.trim();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const maxCalls = Math.min(
    Math.max(
      Number.parseInt(process.argv[3] || process.env.A2_MAX_PRODUCTIVE_CALLS || "15", 10) || 15,
      1,
    ),
    15,
  );
  const rawList =
    process.argv[2] ||
    process.env.A2_CITATIONS ||
    "466 U.S. 668|373 U.S. 83|567 U.S. 460|543 U.S. 551|386 U.S. 738|392 U.S. 1|443 U.S. 307";
  const citations = String(rawList)
    .split("|")
    .map((s) => leanNormalizeUs(s.trim()))
    .filter(Boolean);

  if (!clKey || !databaseUrl || !openaiKey) {
    console.log(
      JSON.stringify({
        ok: false,
        reason: "missing_env",
        hasCl: Boolean(clKey),
        hasDb: Boolean(databaseUrl),
        hasOpenAI: Boolean(openaiKey),
      }),
    );
    process.exit(2);
  }

  const sql = postgres(databaseUrl, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  const counters = { apiCalls: 0, maxCalls, rateLimited: false, lastAt: 0, lastRetryAfter: null };
  const results = [];

  try {
    for (const citation of citations) {
      if (counters.apiCalls >= maxCalls || counters.rateLimited) {
        results.push({ citation, status: "skipped", reason: counters.rateLimited ? "rate_limited" : "budget_exhausted" });
        continue;
      }
      const target = parseUsReports(citation);
      if (!target) {
        results.push({ citation, status: "skipped", reason: "unsupported_non_us_reports" });
        continue;
      }

      const present = await authorityPresent(sql, target.citation);
      if (present.length > 0) {
        results.push({
          citation: target.citation,
          status: "already_present",
          authorityId: present[0].id,
          sourceExternalId: present[0].source_external_id,
          clRequests: 0,
        });
        continue;
      }

      const callsBefore = counters.apiCalls;
      let resolved = await resolveClusterViaLookup(clKey, target, counters);
      if (!resolved.ok && resolved.reason !== "rate_limited" && resolved.reason !== "budget_exhausted") {
        resolved = await resolveViaSearch(clKey, target, counters);
      }
      if (!resolved.ok) {
        results.push({
          citation: target.citation,
          status: "skipped",
          reason: resolved.reason,
          clRequests: counters.apiCalls - callsBefore,
          detail: resolved.cites || resolved.sample || null,
        });
        if (resolved.reason === "rate_limited" || resolved.reason === "budget_exhausted") break;
        continue;
      }

      const fetched = await fetchOpinionAndCluster(clKey, resolved, target, counters);
      if (!fetched.ok) {
        results.push({
          citation: target.citation,
          status: "skipped",
          reason: fetched.reason,
          clRequests: counters.apiCalls - callsBefore,
          detail: fetched.cites || null,
        });
        if (fetched.reason === "rate_limited" || fetched.reason === "budget_exhausted") break;
        continue;
      }

      const persisted = await persistOpinion(sql, fetched.opinion, openaiKey);
      results.push({
        citation: target.citation,
        status: persisted.status,
        authorityId: persisted.authorityId,
        sourceExternalId: fetched.opinion.sourceExternalId,
        clusterId: fetched.opinion.clusterId,
        opinionId: fetched.opinion.opinionId,
        embeddedChunks: persisted.embeddedChunks,
        title: fetched.opinion.title,
        method: resolved.method,
        clRequests: counters.apiCalls - callsBefore,
        canonicalSourceUrl: fetched.opinion.canonicalSourceUrl,
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
      select source_provider, source_external_id, count(*)::int as n
      from legal_authorities
      where source_external_id is not null
      group by 1, 2 having count(*) > 1
      limit 5
    `;

    console.log(
      JSON.stringify({
        ok: true,
        classification: "A2_CITATION_TARGET_RECOVERY_PILOT",
        maxCalls,
        courtListenerHttpCalls: counters.apiCalls,
        rateLimited: counters.rateLimited,
        lastRetryAfter: counters.lastRetryAfter,
        acquired: results.filter((r) => r.status === "imported" || r.status === "new_version").length,
        results,
        corpus,
        chunks,
        duplicateSourceIds: dupes.length,
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e?.message || e).slice(0, 500) }));
  process.exit(1);
});
