/**
 * Session 3 Phase C+D — ingest up to N opinion IDs discovered earlier.
 * Bounded: max 5 opinions. Hard timeout. Uses same persist path as batch job subset.
 *
 * Env:
 *   CL_OPINION_IDS=1,2,3
 *   CL_COURT=ca5
 *   CL_HARD_TIMEOUT_MS=120000
 *   CL_MAX_INGEST=5
 */
"use strict";
const { createHash, randomUUID } = require("node:crypto");
const postgres = require("postgres");
const fs = require("fs");

const CL_BASE = "https://www.courtlistener.com/api/rest/v4";
const SOURCE = "courtlistener";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS = 384;
const MAX_OPINION_CHARS = 40_000;
const MAX_CHUNK_CHARS = 1000;

const COURT_MAP = {
  scotus: { courtId: "us-scotus", courtLevel: "scotus", authorityState: "US", courtName: "Supreme Court of the United States", federalCircuit: null, jurisdiction: "United States" },
  ca1: { courtId: "us-ca-1", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the First Circuit", federalCircuit: "1", jurisdiction: "United States" },
  ca2: { courtId: "us-ca-2", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Second Circuit", federalCircuit: "2", jurisdiction: "United States" },
  ca3: { courtId: "us-ca-3", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Third Circuit", federalCircuit: "3", jurisdiction: "United States" },
  ca4: { courtId: "us-ca-4", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Fourth Circuit", federalCircuit: "4", jurisdiction: "United States" },
  ca5: { courtId: "us-ca-5", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Fifth Circuit", federalCircuit: "5", jurisdiction: "United States" },
  ca6: { courtId: "us-ca-6", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Sixth Circuit", federalCircuit: "6", jurisdiction: "United States" },
  ca7: { courtId: "us-ca-7", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Seventh Circuit", federalCircuit: "7", jurisdiction: "United States" },
  ca8: { courtId: "us-ca-8", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Eighth Circuit", federalCircuit: "8", jurisdiction: "United States" },
  ca9: { courtId: "us-ca-9", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Ninth Circuit", federalCircuit: "9", jurisdiction: "United States" },
  ca10: { courtId: "us-ca-10", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Tenth Circuit", federalCircuit: "10", jurisdiction: "United States" },
  ca11: { courtId: "us-ca-11", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Eleventh Circuit", federalCircuit: "11", jurisdiction: "United States" },
  cadc: { courtId: "us-ca-dc", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the District of Columbia Circuit", federalCircuit: "dc", jurisdiction: "United States" },
  cafc: { courtId: "us-ca-fed", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Federal Circuit", federalCircuit: "fed", jurisdiction: "United States" },
  arizctapp: { courtId: "st-az-app", courtLevel: "state_appellate", authorityState: "AZ", courtName: "Arizona Court of Appeals", federalCircuit: null, jurisdiction: "AZ" },
  connappct: { courtId: "st-ct-app", courtLevel: "state_appellate", authorityState: "CT", courtName: "Connecticut Appellate Court", federalCircuit: null, jurisdiction: "CT" },
  wisctapp: { courtId: "st-wi-app", courtLevel: "state_appellate", authorityState: "WI", courtName: "Wisconsin Court of Appeals", federalCircuit: null, jurisdiction: "WI" },
  utahctapp: { courtId: "st-ut-app", courtLevel: "state_appellate", authorityState: "UT", courtName: "Utah Court of Appeals", federalCircuit: null, jurisdiction: "UT" },
  nmctapp: { courtId: "st-nm-app", courtLevel: "state_appellate", authorityState: "NM", courtName: "New Mexico Court of Appeals", federalCircuit: null, jurisdiction: "NM" },
  indctapp: { courtId: "st-in-app", courtLevel: "state_appellate", authorityState: "IN", courtName: "Indiana Court of Appeals", federalCircuit: null, jurisdiction: "IN" },
  ariz: { courtId: "st-az-high", courtLevel: "state_high", authorityState: "AZ", courtName: "Arizona Supreme Court", federalCircuit: null, jurisdiction: "AZ" },
  conn: { courtId: "st-ct-high", courtLevel: "state_high", authorityState: "CT", courtName: "Supreme Court of Connecticut", federalCircuit: null, jurisdiction: "CT" },
  wis: { courtId: "st-wi-high", courtLevel: "state_high", authorityState: "WI", courtName: "Wisconsin Supreme Court", federalCircuit: null, jurisdiction: "WI" },
  utah: { courtId: "st-ut-high", courtLevel: "state_high", authorityState: "UT", courtName: "Utah Supreme Court", federalCircuit: null, jurisdiction: "UT" },
  nm: { courtId: "st-nm-high", courtLevel: "state_high", authorityState: "NM", courtName: "New Mexico Supreme Court", federalCircuit: null, jurisdiction: "NM" },
  ind: { courtId: "st-in-high", courtLevel: "state_high", authorityState: "IN", courtName: "Indiana Supreme Court", federalCircuit: null, jurisdiction: "IN" },
  nysd: { courtId: "us-d-nysd", courtLevel: "district", authorityState: "US", courtName: "United States District Court for the Southern District of New York", federalCircuit: "2", jurisdiction: "United States" },
  cacd: { courtId: "us-d-cacd", courtLevel: "district", authorityState: "US", courtName: "United States District Court for the Central District of California", federalCircuit: "9", jurisdiction: "United States" },
  ilnd: { courtId: "us-d-ilnd", courtLevel: "district", authorityState: "US", courtName: "United States District Court for the Northern District of Illinois", federalCircuit: "7", jurisdiction: "United States" },
  txsd: { courtId: "us-d-txsd", courtLevel: "district", authorityState: "US", courtName: "United States District Court for the Southern District of Texas", federalCircuit: "5", jurisdiction: "United States" },
  dcd: { courtId: "us-d-dcd", courtLevel: "district", authorityState: "US", courtName: "United States District Court for the District of Columbia", federalCircuit: "dc", jurisdiction: "United States" },
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
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`embed_http_${res.status}`);
    const body = await res.json();
    out.push(...(body.data || []).sort((a, b) => a.index - b.index).map((d) => d.embedding));
  }
  return out;
}

async function main() {
  const key = process.env.COURTLISTENER_API_KEY;
  const db = process.env.DATABASE_URL;
  const openai = process.env.OPENAI_API_KEY;
  const clCourt = (process.argv[2] || process.env.CL_COURT || "ca5").trim().toLowerCase();
  const mapped = COURT_MAP[clCourt];
  const ids = String(process.argv[3] || process.env.CL_OPINION_IDS || "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  const maxIngest = Math.min(Math.max(Number(process.argv[4] || process.env.CL_MAX_INGEST || 8), 1), 10);
  const hardTimeoutMs = Math.min(Math.max(Number(process.env.CL_HARD_TIMEOUT_MS || 120000), 30000), 180000);
  const started = Date.now();
  let calls = 0;

  if (!key || !db || !openai) {
    console.log(JSON.stringify({ ok: false, phase: "INGEST", reason: "missing_env", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  if (!mapped) {
    console.log(JSON.stringify({ ok: false, phase: "INGEST", reason: `unmapped:${clCourt}`, courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  if (!ids.length) {
    console.log(JSON.stringify({ ok: false, phase: "INGEST", reason: "no_ids", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }

  const timer = setTimeout(() => {
    console.log(
      JSON.stringify({
        ok: false,
        phase: "INGEST",
        status: "HIST_QUERY_TIMEOUT",
        courtListenerHttpCalls: calls,
        elapsedMs: Date.now() - started,
      }),
    );
    process.exit(1);
  }, hardTimeoutMs);

  const sql = postgres(db, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  const results = [];
  let imported = 0;
  try {
    for (const id of ids.slice(0, maxIngest)) {
      if (Date.now() - started > hardTimeoutMs - 5000) break;
      await new Promise((r) => setTimeout(r, 2200));
      const res = await fetch(`${CL_BASE}/opinions/${id}/`, {
        headers: { Authorization: `Token ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(30000),
      });
      calls += 1;
      if (res.status === 429) {
        results.push({ id, status: "rate_limited" });
        break;
      }
      if (!res.ok) {
        results.push({ id, status: `http_${res.status}` });
        continue;
      }
      const op = await res.json();
      let cluster = null;
      const clusterId = op.cluster
        ? String(op.cluster).match(/\/clusters\/(\d+)/)?.[1] || op.cluster_id
        : op.cluster_id;
      if (clusterId) {
        await new Promise((r) => setTimeout(r, 2200));
        const cRes = await fetch(`${CL_BASE}/clusters/${clusterId}/`, {
          headers: { Authorization: `Token ${key}`, Accept: "application/json" },
          signal: AbortSignal.timeout(30000),
        });
        calls += 1;
        if (cRes.ok) cluster = await cRes.json();
      }
      const html = op.html_with_citations || op.html_columbia || op.html || op.plain_text || "";
      const content = stripHtml(html).slice(0, MAX_OPINION_CHARS);
      if (content.length < 200) {
        results.push({ id, status: "skipped_short" });
        continue;
      }
      const sourceExternalId = `cl-opinion-${id}`;
      const existing = await sql`
        select id from legal_authorities
        where source_provider=${SOURCE} and source_external_id=${sourceExternalId} limit 1
      `;
      if (existing.length) {
        results.push({ id, status: "duplicate" });
        continue;
      }
      const title = String(cluster?.case_name || op.case_name || `Opinion ${id}`).slice(0, 500);
      const citation = Array.isArray(cluster?.citation)
        ? cluster.citation[0]
        : cluster?.citation || null;
      const decisionDate = cluster?.date_filed || op.date_filed || null;
      const authorityId = randomUUID();
      const versionId = randomUUID();
      const hash = sha256(content);
      await sql`
        insert into legal_authorities (
          id, authority_type, jurisdiction, court, court_id, authority_state,
          federal_circuit, court_level, title, citation, normalized_citation,
          docket_number, decision_date, source_provider, source_external_id,
          canonical_source_url, ingestion_status, hierarchy_path, metadata
        ) values (
          ${authorityId}, ${"case"}::authority_type, ${mapped.jurisdiction}, ${mapped.courtName},
          ${mapped.courtId}, ${mapped.authorityState}, ${mapped.federalCircuit}, ${mapped.courtLevel},
          ${title}, ${citation}, ${citation}, ${cluster?.docket_number || null}, ${decisionDate},
          ${SOURCE}, ${sourceExternalId},
          ${`https://www.courtlistener.com/opinion/${id}/`},
          'processing'::authority_ingestion_status, ${sql.json([])},
          ${sql.json({ clCourt, adapter: "s3-hist-ingest", clusterId: clusterId || null })}
        )
      `;
      await sql`
        insert into legal_authority_versions (
          id, authority_id, version_number, content, effective_from, effective_to,
          source_provider, source_metadata, sha256
        ) values (
          ${versionId}, ${authorityId}, 1, ${content}, ${decisionDate}, ${null},
          ${SOURCE}, ${sql.json({ retrievedAt: new Date().toISOString() })}, ${hash}
        )
      `;
      const chunks = chunkContent(content);
      const vectors = await embedAll(chunks, openai);
      for (let i = 0; i < chunks.length; i++) {
        await sql`
          insert into legal_authority_chunks (
            id, authority_id, authority_version_id, chunk_index, content,
            segment_ref, embedding, embedding_model
          ) values (
            ${randomUUID()}, ${authorityId}, ${versionId}, ${i}, ${chunks[i]},
            ${`p${i + 1}`}, ${toPgvector(vectors[i])}::vector, ${`${EMBEDDING_MODEL}:${EMBEDDING_DIMS}`}
          )
        `;
      }
      await sql`
        update legal_authorities set ingestion_status='ready'::authority_ingestion_status, updated_at=now()
        where id=${authorityId}
      `;
      imported += 1;
      results.push({ id, status: "imported", decisionDate, title: title.slice(0, 80) });
    }
    clearTimeout(timer);
    const payload = {
      ok: true,
      phase: "INGEST",
      status: "done",
      clCourt,
      imported,
      results,
      courtListenerHttpCalls: calls,
      elapsedMs: Date.now() - started,
      mutations: imported,
    };
    try {
      fs.writeFileSync("/tmp/queue2-s3-hist-ingest.json", JSON.stringify(payload, null, 2));
    } catch (_) {
      /* ignore */
    }
    console.log(JSON.stringify(payload));
  } finally {
    clearTimeout(timer);
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, phase: "INGEST", err: String(e.message || e).slice(0, 300), courtListenerHttpCalls: 0 }));
  process.exit(1);
});
