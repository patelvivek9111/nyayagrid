#!/usr/bin/env node
/**
 * Finish chunk+embed for two pre-existing stuck processing authorities.
 * Not new acquisition — corpus-health closeout only.
 */
"use strict";
const { createHash, randomUUID } = require("node:crypto");
const postgres = require("postgres");

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS = 384;
const MAX_CHUNK_CHARS = 1000;
const IDS = [
  "c203201e-4500-42e2-9748-be3a9c03bc54",
  "3d9e2f0a-119d-4710-a3ac-44cdef0bbe01",
];

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

(async () => {
  const url = process.env.DATABASE_URL?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (!url || !openaiKey) {
    console.log(JSON.stringify({ ok: false, reason: "missing_env", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 10, connect_timeout: 30 });
  const results = [];
  try {
    for (const id of IDS) {
      const [auth] = await sql`
        select id, ingestion_status::text as st from legal_authorities where id = ${id}
      `;
      if (!auth) {
        results.push({ id, status: "missing" });
        continue;
      }
      const [ver] = await sql`
        select id, content from legal_authority_versions
        where authority_id = ${id}
        order by version_number desc limit 1
      `;
      if (!ver?.content) {
        results.push({ id, status: "no_version_content" });
        continue;
      }
      const existingChunks = await sql`
        select count(*)::int as n from legal_authority_chunks where authority_id = ${id}
      `;
      if (existingChunks[0].n > 0) {
        await sql`
          update legal_authorities
          set ingestion_status = 'ready'::authority_ingestion_status, updated_at = now()
          where id = ${id}
        `;
        results.push({ id, status: "marked_ready_existing_chunks", chunks: existingChunks[0].n });
        continue;
      }
      const chunks = chunkContent(ver.content);
      const vectors = await embedAll(chunks, openaiKey);
      for (let i = 0; i < chunks.length; i++) {
        await sql`
          insert into legal_authority_chunks (
            id, authority_id, authority_version_id, chunk_index, content,
            segment_ref, char_start, char_end, embedding, embedding_model
          ) values (
            ${randomUUID()}, ${id}, ${ver.id}, ${i}, ${chunks[i]},
            ${`p${i + 1}`}, ${null}, ${null}, ${toPgvector(vectors[i])}::vector,
            ${`${EMBEDDING_MODEL}:${EMBEDDING_DIMS}`}
          )
        `;
      }
      await sql`
        update legal_authorities
        set ingestion_status = 'ready'::authority_ingestion_status, updated_at = now()
        where id = ${id}
      `;
      results.push({
        id,
        status: "chunked_embedded_ready",
        chunks: chunks.length,
        contentSha: createHash("sha256").update(ver.content, "utf8").digest("hex").slice(0, 12),
      });
    }
    const [left] = await sql`
      select count(*)::int as n from legal_authorities
      where ingestion_status::text in ('pending','processing','not_processed')
    `;
    console.log(
      JSON.stringify({
        ok: left.n === 0,
        classification: "PASS1_STUCK_PROCESSING_CLOSEOUT",
        courtListenerHttpCalls: 0,
        results,
        remainingProcessing: left.n,
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
})().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 500), courtListenerHttpCalls: 0 }));
  process.exit(1);
});
