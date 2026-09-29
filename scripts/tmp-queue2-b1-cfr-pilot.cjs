/**
 * Bounded zero-CL B1 CFR pilot. Max 5 authorities. ZERO CourtListener.
 * Hard quality gates: eCFR primary text, deterministic citation, dedupe, embeddings.
 *
 * Usage: node tmp-queue2-b1-cfr-pilot.cjs
 * Env: B1_MAX=5
 */
"use strict";
const { createHash, randomUUID } = require("node:crypto");
const postgres = require("postgres");

const MAX = Math.min(Math.max(Number.parseInt(process.env.B1_MAX || "5", 10) || 5, 1), 5);
const MIN_CHARS = 200;

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
function chunkContent(content) {
  const parts = String(content)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks = [];
  for (const p of parts) {
    if (p.length <= 1000) chunks.push(p);
    else {
      let rest = p;
      while (rest.length > 1000) {
        let cut = rest.lastIndexOf(" ", 1000);
        if (cut < 500) cut = 1000;
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) chunks.push(rest);
    }
  }
  return chunks.length ? chunks : [String(content).slice(0, 1000)];
}
function parseCfr(raw) {
  const m = /\b(\d{1,2})\s+C\.?\s?F\.?\s?R\.?\s*§*\s*(\d+(?:\.\d+)*)/i.exec(String(raw || ""));
  return m ? { title: Number(m[1]), section: m[2], citation: `${m[1]} C.F.R. § ${m[2]}` } : null;
}

async function embedBatch(texts, apiKey) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts, dimensions: 384 }),
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

async function importOne(sql, rec, apiKey) {
  const content = rec.content || "";
  if (content.length < MIN_CHARS) return { status: "skipped_short", chars: content.length };
  const hash = sha256(content);
  const existing = await sql`
    select id from legal_authorities
    where source_provider = ${rec.sourceProvider} and source_external_id = ${rec.sourceExternalId}
    limit 1
  `;
  if (existing.length) return { status: "skipped_duplicate", id: existing[0].id };
  const byCite = await sql`
    select id from legal_authorities where normalized_citation = ${rec.normalizedCitation} limit 1
  `;
  if (byCite.length) return { status: "skipped_alias", aliasOf: byCite[0].id };

  const id = randomUUID();
  await sql`
    insert into legal_authorities (
      id, authority_type, jurisdiction, court, court_id, authority_state, court_level,
      title, citation, normalized_citation, source_provider, source_external_id,
      canonical_source_url, ingestion_status, currentness_status, last_checked_at,
      decision_date, effective_date, metadata, created_at, updated_at
    ) values (
      ${id}, ${"regulation"}::authority_type, ${"US"}, ${null}, ${null}, ${"US"}, ${null},
      ${rec.title}, ${rec.citation}, ${rec.normalizedCitation},
      ${rec.sourceProvider}, ${rec.sourceExternalId}, ${rec.canonicalSourceUrl},
      'ready'::authority_ingestion_status, 'current_as_of_source_date'::authority_currentness_status, now(),
      ${null}, ${rec.effectiveDate},
      ${sql.json(rec.sourceMetadata)}, now(), now()
    )
  `;
  const [version] = await sql`
    insert into legal_authority_versions (
      id, authority_id, version_number, content, effective_from, effective_to,
      source_provider, source_metadata, sha256
    ) values (
      ${randomUUID()}, ${id}, 1, ${content}, ${rec.effectiveDate}, ${null},
      ${rec.sourceProvider}, ${sql.json(rec.sourceMetadata)}, ${hash}
    )
    returning id
  `;
  const chunks = chunkContent(content);
  const vectors = await embedAll(chunks, apiKey);
  for (let i = 0; i < chunks.length; i++) {
    await sql`
      insert into legal_authority_chunks (
        id, authority_id, authority_version_id, chunk_index, content,
        segment_ref, embedding, embedding_model
      ) values (
        ${randomUUID()}, ${id}, ${version.id}, ${i}, ${chunks[i]},
        ${`p${i + 1}`}, ${toPgvector(vectors[i])}::vector, ${"text-embedding-3-small:384"}
      )
    `;
  }
  return { status: "imported", id, chunks: chunks.length, embedded: vectors.length, chars: content.length };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (!databaseUrl || !openaiKey) {
    console.log(JSON.stringify({ ok: false, reason: "missing_env", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  const sql = postgres(databaseUrl, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const unresolved = await sql`
      select coalesce(normalized_citation, raw_citation) as cite, count(*)::int as edges,
             count(distinct from_authority_id)::int as citing
      from legal_authority_citations
      where to_authority_id is null
        and coalesce(normalized_citation, raw_citation) ~* 'C\\.?\\s*F\\.?\\s*R'
      group by 1
      order by edges desc
      limit 40
    `;
    const existing = new Set(
      (await sql`select normalized_citation from legal_authorities where normalized_citation is not null`).map((r) =>
        String(r.normalized_citation),
      ),
    );

    let ecfrDate = new Date().toISOString().slice(0, 10);
    try {
      const titles = await fetch("https://www.ecfr.gov/api/versioner/v1/titles.json", {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(20000),
      });
      if (titles.ok) {
        const j = await titles.json();
        if (j?.meta?.date) ecfrDate = j.meta.date;
      }
    } catch {
      /* keep */
    }

    const candidates = [];
    for (const row of unresolved) {
      const p = parseCfr(row.cite);
      if (!p) continue;
      if (existing.has(p.citation)) continue;
      candidates.push({ ...p, edges: row.edges, citing: row.citing });
    }

    const results = [];
    let imported = 0;
    for (const c of candidates) {
      if (imported >= MAX) break;
      const page = `https://www.ecfr.gov/api/renderer/v1/content/enhanced/${ecfrDate}/title-${c.title}?section=${encodeURIComponent(c.section)}`;
      try {
        const res = await fetch(page, { headers: { Accept: "text/html" }, signal: AbortSignal.timeout(30000) });
        const text = stripHtml(await res.text());
        const sectionToken = c.section;
        const identityOk = res.ok && text.length >= MIN_CHARS && text.includes(sectionToken);
        if (!identityOk) {
          results.push({
            citation: c.citation,
            status: "quarantined",
            http: res.status,
            chars: text.length,
            reason: !res.ok ? `http_${res.status}` : text.length < MIN_CHARS ? "short_text" : "section_token_missing",
            edges: c.edges,
          });
          continue;
        }
        const rec = {
          title: c.citation,
          content: text,
          sourceProvider: "ecfr",
          sourceExternalId: `ecfr-t${c.title}-s${c.section}`,
          citation: c.citation,
          normalizedCitation: c.citation,
          canonicalSourceUrl: `https://www.ecfr.gov/current/title-${c.title}/section-${c.section}`,
          effectiveDate: ecfrDate,
          sourceMetadata: {
            adapter: "queue2-b1-cfr-pilot",
            asOfDate: ecfrDate,
            retrievedAt: new Date().toISOString(),
            expectedEdges: c.edges,
            queue: "#2",
            lane: "B1",
          },
        };
        const result = await importOne(sql, rec, openaiKey);
        results.push({ citation: c.citation, edges: c.edges, citing: c.citing, ...result, url: rec.canonicalSourceUrl });
        if (result.status === "imported") {
          imported += 1;
          existing.add(c.citation);
        }
      } catch (e) {
        results.push({ citation: c.citation, status: "error", error: String(e.message || e).slice(0, 160), edges: c.edges });
      }
    }

    const [corpus] = await sql`
      select count(*)::int as authorities,
             count(*) filter (where authority_type='case')::int as cases,
             count(*) filter (where authority_type='case' and source_provider='courtlistener')::int as cl_cases,
             count(*) filter (where authority_type='regulation')::int as regulations
      from legal_authorities
    `;
    const [chunks] = await sql`
      select count(*)::int as chunks,
             count(*) filter (where embedding is not null)::int as embeddings,
             count(*) filter (where embedding is null)::int as missing_embeddings
      from legal_authority_chunks
    `;
    const [dupes] = await sql`
      select count(*)::int as n from (
        select 1 from legal_authorities where source_external_id is not null
        group by source_provider, source_external_id having count(*)>1
      ) d
    `;
    const [orphans] = await sql`
      select count(*)::int as n from legal_authority_chunks c
      left join legal_authorities a on a.id=c.authority_id where a.id is null
    `;

    console.log(
      JSON.stringify({
        ok: true,
        classification: "B1_CFR_ZERO_CL_PILOT",
        generatedAt: new Date().toISOString(),
        courtListenerHttpCalls: 0,
        max: MAX,
        ecfrDate,
        imported,
        results,
        corpus,
        chunks,
        duplicateSourceIds: dupes[0]?.n || 0,
        orphanCount: orphans[0]?.n || 0,
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 400), courtListenerHttpCalls: 0 }));
  process.exit(1);
});
