/**
 * Lean CourtListener staging ingest — runs on Fly without @nyayagrid packages.
 * Discover → fetch → parse → persist (idempotent) with OpenAI embeddings (384-dim).
 * Never prints DATABASE_URL, COURTLISTENER_API_KEY, or OPENAI_API_KEY.
 */
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";

const CL_BASE = "https://www.courtlistener.com/api/rest/v4";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS = 384;
const EMBEDDING_BATCH_SIZE = 32;
const MAX_CHUNK_CHARS = 1000;
const MAX_OPINION_CHARS = 40_000;

type CourtMapEntry = {
  courtId: string;
  courtLevel: string;
  authorityState: string;
  courtName: string;
  federalCircuit: string | null;
  jurisdiction: string;
};

/** CourtListener court id → NyayaGrid court registry (do not guess unmapped). */
const CL_COURT_MAP: Record<string, CourtMapEntry> = {
  scotus: {
    courtId: "us-scotus",
    courtLevel: "scotus",
    authorityState: "US",
    courtName: "Supreme Court of the United States",
    federalCircuit: null,
    jurisdiction: "United States",
  },
  ca1: {
    courtId: "us-ca-1",
    courtLevel: "circuit",
    authorityState: "US",
    courtName: "United States Court of Appeals for the First Circuit",
    federalCircuit: "1",
    jurisdiction: "United States",
  },
  ca2: {
    courtId: "us-ca-2",
    courtLevel: "circuit",
    authorityState: "US",
    courtName: "United States Court of Appeals for the Second Circuit",
    federalCircuit: "2",
    jurisdiction: "United States",
  },
  ca3: {
    courtId: "us-ca-3",
    courtLevel: "circuit",
    authorityState: "US",
    courtName: "United States Court of Appeals for the Third Circuit",
    federalCircuit: "3",
    jurisdiction: "United States",
  },
  ca4: {
    courtId: "us-ca-4",
    courtLevel: "circuit",
    authorityState: "US",
    courtName: "United States Court of Appeals for the Fourth Circuit",
    federalCircuit: "4",
    jurisdiction: "United States",
  },
  ca5: {
    courtId: "us-ca-5",
    courtLevel: "circuit",
    authorityState: "US",
    courtName: "United States Court of Appeals for the Fifth Circuit",
    federalCircuit: "5",
    jurisdiction: "United States",
  },
  ca6: {
    courtId: "us-ca-6",
    courtLevel: "circuit",
    authorityState: "US",
    courtName: "United States Court of Appeals for the Sixth Circuit",
    federalCircuit: "6",
    jurisdiction: "United States",
  },
  ca7: {
    courtId: "us-ca-7",
    courtLevel: "circuit",
    authorityState: "US",
    courtName: "United States Court of Appeals for the Seventh Circuit",
    federalCircuit: "7",
    jurisdiction: "United States",
  },
  ca8: {
    courtId: "us-ca-8",
    courtLevel: "circuit",
    authorityState: "US",
    courtName: "United States Court of Appeals for the Eighth Circuit",
    federalCircuit: "8",
    jurisdiction: "United States",
  },
  ca9: {
    courtId: "us-ca-9",
    courtLevel: "circuit",
    authorityState: "US",
    courtName: "United States Court of Appeals for the Ninth Circuit",
    federalCircuit: "9",
    jurisdiction: "United States",
  },
  ca10: {
    courtId: "us-ca-10",
    courtLevel: "circuit",
    authorityState: "US",
    courtName: "United States Court of Appeals for the Tenth Circuit",
    federalCircuit: "10",
    jurisdiction: "United States",
  },
  ca11: {
    courtId: "us-ca-11",
    courtLevel: "circuit",
    authorityState: "US",
    courtName: "United States Court of Appeals for the Eleventh Circuit",
    federalCircuit: "11",
    jurisdiction: "United States",
  },
  cadc: {
    courtId: "us-ca-dc",
    courtLevel: "circuit",
    authorityState: "US",
    courtName: "United States Court of Appeals for the District of Columbia Circuit",
    federalCircuit: "dc",
    jurisdiction: "United States",
  },
  cafc: {
    courtId: "us-ca-fed",
    courtLevel: "circuit",
    authorityState: "US",
    courtName: "United States Court of Appeals for the Federal Circuit",
    federalCircuit: "fed",
    jurisdiction: "United States",
  },
  cal: {
    courtId: "st-ca-high",
    courtLevel: "state_high",
    authorityState: "CA",
    courtName: "Supreme Court of California",
    federalCircuit: null,
    jurisdiction: "CA",
  },
  calctapp: {
    courtId: "st-ca-app",
    courtLevel: "state_appellate",
    authorityState: "CA",
    courtName: "California Court of Appeal",
    federalCircuit: null,
    jurisdiction: "CA",
  },
  ny: {
    courtId: "st-ny-high",
    courtLevel: "state_high",
    authorityState: "NY",
    courtName: "New York Court of Appeals",
    federalCircuit: null,
    jurisdiction: "NY",
  },
  nyappdiv: {
    courtId: "st-ny-app",
    courtLevel: "state_appellate",
    authorityState: "NY",
    courtName: "New York Supreme Court, Appellate Division",
    federalCircuit: null,
    jurisdiction: "NY",
  },
  pa: {
    courtId: "st-pa-high",
    courtLevel: "state_high",
    authorityState: "PA",
    courtName: "Supreme Court of Pennsylvania",
    federalCircuit: null,
    jurisdiction: "PA",
  },
  pasuperct: {
    courtId: "st-pa-super",
    courtLevel: "state_appellate",
    authorityState: "PA",
    courtName: "Superior Court of Pennsylvania",
    federalCircuit: null,
    jurisdiction: "PA",
  },
  tex: {
    courtId: "st-tx-high",
    courtLevel: "state_high",
    authorityState: "TX",
    courtName: "Supreme Court of Texas",
    federalCircuit: null,
    jurisdiction: "TX",
  },
  texapp: {
    courtId: "st-tx-app",
    courtLevel: "state_appellate",
    authorityState: "TX",
    courtName: "Texas Courts of Appeals",
    federalCircuit: null,
    jurisdiction: "TX",
  },
  nj: {
    courtId: "st-nj-high",
    courtLevel: "state_high",
    authorityState: "NJ",
    courtName: "Supreme Court of New Jersey",
    federalCircuit: null,
    jurisdiction: "NJ",
  },
  njsuperct: {
    courtId: "st-nj-app",
    courtLevel: "state_appellate",
    authorityState: "NJ",
    courtName: "Superior Court of New Jersey, Appellate Division",
    federalCircuit: null,
    jurisdiction: "NJ",
  },
  fla: {
    courtId: "st-fl-high",
    courtLevel: "state_high",
    authorityState: "FL",
    courtName: "Supreme Court of Florida",
    federalCircuit: null,
    jurisdiction: "FL",
  },
  fladistctapp: {
    courtId: "st-fl-app",
    courtLevel: "state_appellate",
    authorityState: "FL",
    courtName: "Florida District Courts of Appeal",
    federalCircuit: null,
    jurisdiction: "FL",
  },
  ill: {
    courtId: "st-il-high",
    courtLevel: "state_high",
    authorityState: "IL",
    courtName: "Supreme Court of Illinois",
    federalCircuit: null,
    jurisdiction: "IL",
  },
  illappct: {
    courtId: "st-il-app",
    courtLevel: "state_appellate",
    authorityState: "IL",
    courtName: "Appellate Court of Illinois",
    federalCircuit: null,
    jurisdiction: "IL",
  },
  mass: {
    courtId: "st-ma-high",
    courtLevel: "state_high",
    authorityState: "MA",
    courtName: "Supreme Judicial Court of Massachusetts",
    federalCircuit: null,
    jurisdiction: "MA",
  },
  massappct: {
    courtId: "st-ma-app",
    courtLevel: "state_appellate",
    authorityState: "MA",
    courtName: "Massachusetts Appeals Court",
    federalCircuit: null,
    jurisdiction: "MA",
  },
  va: {
    courtId: "st-va-high",
    courtLevel: "state_high",
    authorityState: "VA",
    courtName: "Supreme Court of Virginia",
    federalCircuit: null,
    jurisdiction: "VA",
  },
  vacapp: {
    courtId: "st-va-app",
    courtLevel: "state_appellate",
    authorityState: "VA",
    courtName: "Court of Appeals of Virginia",
    federalCircuit: null,
    jurisdiction: "VA",
  },
  del: {
    courtId: "st-de-high",
    courtLevel: "state_high",
    authorityState: "DE",
    courtName: "Supreme Court of Delaware",
    federalCircuit: null,
    jurisdiction: "DE",
  },
};

type ClSearchHit = {
  id?: number | string;
  cluster_id?: number | string;
  absolute_url?: string;
  download_url?: string | null;
  case_name?: string;
  caseName?: string;
  citation?: string[] | string;
  date_filed?: string;
  dateFiled?: string;
  docket_number?: string | null;
  docketNumber?: string | null;
  court?: string;
  court_id?: string;
  plain_text?: string;
  html?: string;
  html_with_citations?: string;
  snippet?: string;
  /** Search API nests opinion ids under opinions[].id (no top-level id). */
  opinions?: Array<{ id?: number | string; type?: string }>;
};

/** Resolve CourtListener opinion id from search or opinions-list payloads. */
function resolveOpinionId(hit: ClSearchHit): string | null {
  if (hit.id != null && String(hit.id).trim() !== "") return String(hit.id);
  const nested = hit.opinions?.find((o) => o?.id != null);
  if (nested?.id != null) return String(nested.id);
  return null;
}

type ParsedOpinion = {
  sourceExternalId: string;
  title: string;
  citation: string | null;
  docketNumber: string | null;
  decisionDate: string | null;
  content: string;
  contentHash: string;
  canonicalSourceUrl: string | null;
  clCourtId: string;
  mapped: CourtMapEntry;
  retrievedAt: string;
  treatmentSignals: Array<{ kind: string; sourceSentence: string }>;
};

type QuarantineRow = { sourceExternalId: string; reason: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function sanitizeUntrustedLegalText(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, " ")
    .replace(/javascript:/gi, "")
    .replace(/ignore previous instructions/gi, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(html: string): string {
  return sanitizeUntrustedLegalText(html.replace(/<[^>]+>/g, " "));
}

function absoluteUrl(maybeRelative: string | null | undefined): string | undefined {
  if (!maybeRelative) return undefined;
  try {
    return new URL(maybeRelative, "https://www.courtlistener.com").toString();
  } catch {
    return maybeRelative;
  }
}

function pickCitation(hit: ClSearchHit): string | null {
  if (Array.isArray(hit.citation) && hit.citation.length > 0) {
    return String(hit.citation[0]).trim() || null;
  }
  if (typeof hit.citation === "string" && hit.citation.trim()) return hit.citation.trim();
  return null;
}

function pickText(hit: ClSearchHit): string {
  if (hit.plain_text && String(hit.plain_text).trim()) {
    return sanitizeUntrustedLegalText(String(hit.plain_text)).slice(0, MAX_OPINION_CHARS);
  }
  const html = hit.html_with_citations || hit.html || hit.snippet || "";
  return stripHtml(String(html)).slice(0, MAX_OPINION_CHARS);
}

function chunkContent(content: string): string[] {
  const paragraphs = content
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= MAX_CHUNK_CHARS) {
      chunks.push(paragraph);
      continue;
    }
    let remaining = paragraph;
    while (remaining.length > MAX_CHUNK_CHARS) {
      let cut = remaining.lastIndexOf(" ", MAX_CHUNK_CHARS);
      if (cut < MAX_CHUNK_CHARS / 2) cut = MAX_CHUNK_CHARS;
      chunks.push(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trim();
    }
    if (remaining) chunks.push(remaining);
  }
  return chunks.length > 0 ? chunks : [content.slice(0, MAX_CHUNK_CHARS)];
}

function toPgvector(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

async function embedBatch(texts: string[], apiKey: string): Promise<number[][]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMS,
    }),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 500);
    throw new Error(`openai_embeddings_${res.status}: ${body}`);
  }
  const json = (await res.json()) as {
    data: Array<{ embedding: number[]; index: number }>;
  };
  const sorted = [...json.data].sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}

async function embedAll(texts: string[], apiKey: string): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    out.push(...(await embedBatch(batch, apiKey)));
  }
  return out;
}

const CITATION_RES = [
  /\d+ U\.?\s?S\.? \d+/g,
  /\d+ F\.(?:\s?2d|\s?3d|\s?4th)? \d+/g,
  /\d+ F\.\s?Supp\.(?:\s?2d|\s?3d)? \d+/g,
];

function normalizeCitation(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().toUpperCase();
}

function extractCitations(content: string): Array<{ raw: string; normalized: string }> {
  const seen = new Set<string>();
  const out: Array<{ raw: string; normalized: string }> = [];
  for (const re of CITATION_RES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const raw = m[0].trim();
      const normalized = normalizeCitation(raw);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push({ raw, normalized });
    }
  }
  return out;
}

const TREATMENT_PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: "overruled", re: /\boverrul(ed|ing)\b/i },
  { kind: "reversed", re: /\brevers(ed|ing)\b/i },
  { kind: "vacated", re: /\bvacat(ed|ing|e)\b/i },
  { kind: "superseded", re: /\bsupersed(ed|ing|es)\b/i },
  { kind: "distinguished", re: /\bdistinguish(ed|ing)\b/i },
  { kind: "followed", re: /\bfollow(ed|ing)\b/i },
  { kind: "criticized", re: /\bcriticiz(ed|ing|e)\b/i },
];

function extractTreatmentSignals(
  content: string,
): Array<{ kind: string; sourceSentence: string }> {
  const sentences = content
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
  const found: Array<{ kind: string; sourceSentence: string }> = [];
  const seen = new Set<string>();
  for (const sentence of sentences) {
    for (const pattern of TREATMENT_PATTERNS) {
      if (pattern.re.test(sentence)) {
        const key = `${pattern.kind}:${sentence.slice(0, 80)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ kind: pattern.kind, sourceSentence: sentence.slice(0, 500) });
      }
    }
  }
  return found;
}

async function clFetch(
  url: string,
  apiKey: string,
  rateMs: number,
  counters: { apiCalls: number },
): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const wait =
      attempt === 0
        ? rateMs
        : last?.status === 429
          ? Math.min(rateMs * Math.pow(2, attempt) + Math.floor(Math.random() * 500), 60_000)
          : rateMs;
    await sleep(wait);
    counters.apiCalls += 1;
    last = await fetch(url, {
      headers: {
        Authorization: `Token ${apiKey}`,
        Accept: "application/json",
      },
    });
    if (last.status !== 429) return last;
  }
  return last!;
}

async function hasColumn(sql: postgres.Sql, column: string): Promise<boolean> {
  const rows = await sql`
    select 1 as ok
    from information_schema.columns
    where table_name = 'legal_authorities'
      and column_name = ${column}
    limit 1
  `;
  return rows.length > 0;
}

async function hasCitationsTable(sql: postgres.Sql): Promise<boolean> {
  const rows = await sql`
    select 1 as ok
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'legal_authority_citations'
    limit 1
  `;
  return rows.length > 0;
}

async function insertChunks(
  sql: postgres.Sql,
  authorityId: string,
  versionId: string,
  content: string,
  apiKey: string,
): Promise<void> {
  const chunks = chunkContent(content);
  const vectors = await embedAll(chunks, apiKey);
  for (let i = 0; i < chunks.length; i++) {
    const embedding = vectors[i];
    if (!embedding || embedding.length !== EMBEDDING_DIMS) {
      throw new Error(`bad_embedding_dims_${embedding?.length ?? 0}`);
    }
    const charStart = content.indexOf(chunks[i]!);
    const charEnd = charStart >= 0 ? charStart + chunks[i]!.length : null;
    await sql`
      insert into legal_authority_chunks (
        id, authority_id, authority_version_id, chunk_index, content,
        segment_ref, char_start, char_end, embedding, embedding_model
      ) values (
        ${randomUUID()},
        ${authorityId},
        ${versionId},
        ${i},
        ${chunks[i]!},
        ${`p${i + 1}`},
        ${charStart >= 0 ? charStart : null},
        ${charEnd},
        ${toPgvector(embedding)}::vector,
        ${`${EMBEDDING_MODEL}:${EMBEDDING_DIMS}`}
      )
    `;
  }
}

async function insertCitationEdges(
  sql: postgres.Sql,
  fromAuthorityId: string,
  content: string,
): Promise<number> {
  const citations = extractCitations(content);
  let inserted = 0;
  for (const cit of citations) {
    const matches = await sql`
      select id from legal_authorities
      where normalized_citation = ${cit.normalized}
         or citation = ${cit.raw}
         or upper(replace(coalesce(citation, ''), '  ', ' ')) = ${cit.normalized}
      limit 1
    `;
    const toId = matches.length > 0 ? (matches[0]!.id as string) : null;
    await sql`
      insert into legal_authority_citations (
        id, from_authority_id, to_authority_id, raw_citation, normalized_citation
      ) values (
        ${randomUUID()},
        ${fromAuthorityId},
        ${toId},
        ${cit.raw},
        ${cit.normalized}
      )
    `;
    inserted += 1;
  }
  return inserted;
}

async function persistOne(
  sql: postgres.Sql,
  opinion: ParsedOpinion,
  apiKey: string,
  opts: { hasCurrentness: boolean; hasLastChecked: boolean; hasCitations: boolean },
): Promise<"imported" | "skipped" | "new_version"> {
  const hash = opinion.contentHash;
  const retrievedAt = opinion.retrievedAt;
  const metadata: Record<string, unknown> = {
    sourceClass: "PRIMARY_PUBLIC_REPOSITORY",
    adapter: "courtlistener-lean",
    clCourt: opinion.clCourtId,
    retrievedAt,
    treatmentSignals: opinion.treatmentSignals,
  };

  const existing = await sql`
    select id from legal_authorities
    where source_provider = ${"courtlistener"}
      and source_external_id = ${opinion.sourceExternalId}
    limit 1
  `;

  const mapped = opinion.mapped;

  if (existing.length > 0) {
    const authorityId = existing[0]!.id as string;
    const latest = await sql`
      select id, version_number, sha256
      from legal_authority_versions
      where authority_id = ${authorityId}
      order by version_number desc
      limit 1
    `;
    if (latest.length > 0 && latest[0]!.sha256 === hash) {
      if (opts.hasLastChecked) {
        await sql`
          update legal_authorities
          set last_checked_at = now(), updated_at = now()
          where id = ${authorityId}
        `;
      }
      return "skipped";
    }

    await sql`
      update legal_authority_versions
      set valid_to = now()
      where authority_id = ${authorityId}
        and valid_to is null
    `;
    const nextVersion = Number(latest[0]?.version_number ?? 0) + 1;

    if (opts.hasCurrentness && opts.hasLastChecked) {
      await sql`
        update legal_authorities set
          title = ${opinion.title},
          authority_type = ${"case"}::authority_type,
          jurisdiction = ${mapped.jurisdiction},
          court = ${mapped.courtName},
          court_id = ${mapped.courtId},
          authority_state = ${mapped.authorityState},
          federal_circuit = ${mapped.federalCircuit},
          court_level = ${mapped.courtLevel},
          citation = ${opinion.citation},
          normalized_citation = ${opinion.citation ? normalizeCitation(opinion.citation) : null},
          docket_number = ${opinion.docketNumber},
          decision_date = ${opinion.decisionDate},
          canonical_source_url = ${opinion.canonicalSourceUrl},
          metadata = ${sql.json(metadata)},
          ingestion_status = 'processing'::authority_ingestion_status,
          currentness_status = 'unknown'::authority_currentness_status,
          last_checked_at = now(),
          updated_at = now()
        where id = ${authorityId}
      `;
    } else if (opts.hasCurrentness) {
      await sql`
        update legal_authorities set
          title = ${opinion.title},
          authority_type = ${"case"}::authority_type,
          jurisdiction = ${mapped.jurisdiction},
          court = ${mapped.courtName},
          court_id = ${mapped.courtId},
          authority_state = ${mapped.authorityState},
          federal_circuit = ${mapped.federalCircuit},
          court_level = ${mapped.courtLevel},
          citation = ${opinion.citation},
          normalized_citation = ${opinion.citation ? normalizeCitation(opinion.citation) : null},
          docket_number = ${opinion.docketNumber},
          decision_date = ${opinion.decisionDate},
          canonical_source_url = ${opinion.canonicalSourceUrl},
          metadata = ${sql.json(metadata)},
          ingestion_status = 'processing'::authority_ingestion_status,
          currentness_status = 'unknown'::authority_currentness_status,
          updated_at = now()
        where id = ${authorityId}
      `;
    } else if (opts.hasLastChecked) {
      await sql`
        update legal_authorities set
          title = ${opinion.title},
          authority_type = ${"case"}::authority_type,
          jurisdiction = ${mapped.jurisdiction},
          court = ${mapped.courtName},
          court_id = ${mapped.courtId},
          authority_state = ${mapped.authorityState},
          federal_circuit = ${mapped.federalCircuit},
          court_level = ${mapped.courtLevel},
          citation = ${opinion.citation},
          normalized_citation = ${opinion.citation ? normalizeCitation(opinion.citation) : null},
          docket_number = ${opinion.docketNumber},
          decision_date = ${opinion.decisionDate},
          canonical_source_url = ${opinion.canonicalSourceUrl},
          metadata = ${sql.json(metadata)},
          ingestion_status = 'processing'::authority_ingestion_status,
          last_checked_at = now(),
          updated_at = now()
        where id = ${authorityId}
      `;
    } else {
      await sql`
        update legal_authorities set
          title = ${opinion.title},
          authority_type = ${"case"}::authority_type,
          jurisdiction = ${mapped.jurisdiction},
          court = ${mapped.courtName},
          court_id = ${mapped.courtId},
          authority_state = ${mapped.authorityState},
          federal_circuit = ${mapped.federalCircuit},
          court_level = ${mapped.courtLevel},
          citation = ${opinion.citation},
          normalized_citation = ${opinion.citation ? normalizeCitation(opinion.citation) : null},
          docket_number = ${opinion.docketNumber},
          decision_date = ${opinion.decisionDate},
          canonical_source_url = ${opinion.canonicalSourceUrl},
          metadata = ${sql.json(metadata)},
          ingestion_status = 'processing'::authority_ingestion_status,
          updated_at = now()
        where id = ${authorityId}
      `;
    }

    const versionId = randomUUID();
    await sql`
      insert into legal_authority_versions (
        id, authority_id, version_number, content,
        effective_from, effective_to, source_provider, source_metadata, sha256
      ) values (
        ${versionId},
        ${authorityId},
        ${nextVersion},
        ${opinion.content},
        ${opinion.decisionDate},
        ${null},
        ${"courtlistener"},
        ${sql.json({ adapter: "courtlistener-lean", retrievedAt })},
        ${hash}
      )
    `;
    await insertChunks(sql, authorityId, versionId, opinion.content, apiKey);
    await sql`
      update legal_authorities
      set ingestion_status = 'ready'::authority_ingestion_status, updated_at = now()
      where id = ${authorityId}
    `;
    if (opts.hasCitations) {
      await insertCitationEdges(sql, authorityId, opinion.content);
    }
    return "new_version";
  }

  const authorityId = randomUUID();
  const versionId = randomUUID();

  if (opts.hasCurrentness && opts.hasLastChecked) {
    await sql`
      insert into legal_authorities (
        id, authority_type, jurisdiction, court, court_id, authority_state,
        federal_circuit, court_level, title, citation, normalized_citation,
        docket_number, decision_date,
        source_provider, source_external_id, canonical_source_url,
        ingestion_status, currentness_status, last_checked_at, hierarchy_path, metadata
      ) values (
        ${authorityId},
        ${"case"}::authority_type,
        ${mapped.jurisdiction},
        ${mapped.courtName},
        ${mapped.courtId},
        ${mapped.authorityState},
        ${mapped.federalCircuit},
        ${mapped.courtLevel},
        ${opinion.title},
        ${opinion.citation},
        ${opinion.citation ? normalizeCitation(opinion.citation) : null},
        ${opinion.docketNumber},
        ${opinion.decisionDate},
        ${"courtlistener"},
        ${opinion.sourceExternalId},
        ${opinion.canonicalSourceUrl},
        'processing'::authority_ingestion_status,
        'unknown'::authority_currentness_status,
        now(),
        ${sql.json([])},
        ${sql.json(metadata)}
      )
    `;
  } else if (opts.hasCurrentness) {
    await sql`
      insert into legal_authorities (
        id, authority_type, jurisdiction, court, court_id, authority_state,
        federal_circuit, court_level, title, citation, normalized_citation,
        docket_number, decision_date,
        source_provider, source_external_id, canonical_source_url,
        ingestion_status, currentness_status, hierarchy_path, metadata
      ) values (
        ${authorityId},
        ${"case"}::authority_type,
        ${mapped.jurisdiction},
        ${mapped.courtName},
        ${mapped.courtId},
        ${mapped.authorityState},
        ${mapped.federalCircuit},
        ${mapped.courtLevel},
        ${opinion.title},
        ${opinion.citation},
        ${opinion.citation ? normalizeCitation(opinion.citation) : null},
        ${opinion.docketNumber},
        ${opinion.decisionDate},
        ${"courtlistener"},
        ${opinion.sourceExternalId},
        ${opinion.canonicalSourceUrl},
        'processing'::authority_ingestion_status,
        'unknown'::authority_currentness_status,
        ${sql.json([])},
        ${sql.json(metadata)}
      )
    `;
  } else if (opts.hasLastChecked) {
    await sql`
      insert into legal_authorities (
        id, authority_type, jurisdiction, court, court_id, authority_state,
        federal_circuit, court_level, title, citation, normalized_citation,
        docket_number, decision_date,
        source_provider, source_external_id, canonical_source_url,
        ingestion_status, last_checked_at, hierarchy_path, metadata
      ) values (
        ${authorityId},
        ${"case"}::authority_type,
        ${mapped.jurisdiction},
        ${mapped.courtName},
        ${mapped.courtId},
        ${mapped.authorityState},
        ${mapped.federalCircuit},
        ${mapped.courtLevel},
        ${opinion.title},
        ${opinion.citation},
        ${opinion.citation ? normalizeCitation(opinion.citation) : null},
        ${opinion.docketNumber},
        ${opinion.decisionDate},
        ${"courtlistener"},
        ${opinion.sourceExternalId},
        ${opinion.canonicalSourceUrl},
        'processing'::authority_ingestion_status,
        now(),
        ${sql.json([])},
        ${sql.json(metadata)}
      )
    `;
  } else {
    await sql`
      insert into legal_authorities (
        id, authority_type, jurisdiction, court, court_id, authority_state,
        federal_circuit, court_level, title, citation, normalized_citation,
        docket_number, decision_date,
        source_provider, source_external_id, canonical_source_url,
        ingestion_status, hierarchy_path, metadata
      ) values (
        ${authorityId},
        ${"case"}::authority_type,
        ${mapped.jurisdiction},
        ${mapped.courtName},
        ${mapped.courtId},
        ${mapped.authorityState},
        ${mapped.federalCircuit},
        ${mapped.courtLevel},
        ${opinion.title},
        ${opinion.citation},
        ${opinion.citation ? normalizeCitation(opinion.citation) : null},
        ${opinion.docketNumber},
        ${opinion.decisionDate},
        ${"courtlistener"},
        ${opinion.sourceExternalId},
        ${opinion.canonicalSourceUrl},
        'processing'::authority_ingestion_status,
        ${sql.json([])},
        ${sql.json(metadata)}
      )
    `;
  }

  await sql`
    insert into legal_authority_versions (
      id, authority_id, version_number, content,
      effective_from, effective_to, source_provider, source_metadata, sha256
    ) values (
      ${versionId},
      ${authorityId},
      1,
      ${opinion.content},
      ${opinion.decisionDate},
      ${null},
      ${"courtlistener"},
      ${sql.json({ adapter: "courtlistener-lean", retrievedAt })},
      ${hash}
    )
  `;

  await insertChunks(sql, authorityId, versionId, opinion.content, apiKey);
  await sql`
    update legal_authorities
    set ingestion_status = 'ready'::authority_ingestion_status, updated_at = now()
    where id = ${authorityId}
  `;
  if (opts.hasCitations) {
    await insertCitationEdges(sql, authorityId, opinion.content);
  }
  return "imported";
}

function parseOpinion(
  sourceExternalId: string,
  searchHit: ClSearchHit | undefined,
  opinionRaw: ClSearchHit,
  retrievedAt: string,
  defaultClCourt: string,
  defaultMapped: CourtMapEntry | null,
  unmappedCourts: Set<string>,
): { ok: true; opinion: ParsedOpinion } | { ok: false; quarantine: QuarantineRow } {
  const merged: ClSearchHit = { ...searchHit, ...opinionRaw };
  const responseCourt = String(merged.court_id ?? "")
    .trim()
    .toLowerCase();
  const rawCourt = responseCourt || defaultClCourt;
  let mapped: CourtMapEntry | null = null;
  if (responseCourt) {
    mapped = CL_COURT_MAP[responseCourt] ?? null;
    if (!mapped) {
      unmappedCourts.add(responseCourt);
      return {
        ok: false,
        quarantine: {
          sourceExternalId,
          reason: `unmapped_court:${responseCourt}`,
        },
      };
    }
  } else {
    mapped = defaultMapped;
    if (!mapped) {
      unmappedCourts.add(defaultClCourt);
      return {
        ok: false,
        quarantine: {
          sourceExternalId,
          reason: `unmapped_court:${defaultClCourt || "unknown"}`,
        },
      };
    }
  }

  const content = pickText(merged);
  if (content.length < 20) {
    return {
      ok: false,
      quarantine: { sourceExternalId, reason: "Opinion text too short or absent after sanitize." },
    };
  }

  const title = sanitizeUntrustedLegalText(
    String(merged.case_name ?? merged.caseName ?? "Untitled CourtListener opinion"),
  );
  const citation = pickCitation(merged);
  const docket = merged.docket_number
    ? String(merged.docket_number)
    : merged.docketNumber
      ? String(merged.docketNumber)
      : null;
  if (!citation && !docket) {
    return {
      ok: false,
      quarantine: { sourceExternalId, reason: "Case requires citation or docket number." },
    };
  }

  const canonicalSourceUrl =
    absoluteUrl(merged.absolute_url) ??
    absoluteUrl(merged.download_url) ??
    null;

  return {
    ok: true,
    opinion: {
      sourceExternalId,
      title: title.length >= 3 ? title : "CourtListener opinion",
      citation,
      docketNumber: docket,
      decisionDate: merged.date_filed ?? merged.dateFiled ?? null,
      content,
      contentHash: sha256Hex(content),
      canonicalSourceUrl,
      clCourtId: rawCourt || defaultClCourt,
      mapped,
      retrievedAt,
      treatmentSignals: extractTreatmentSignals(content),
    },
  };
}

async function main() {
  const clKey = process.env.COURTLISTENER_API_KEY?.trim();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const clCourt = (process.env.CL_COURT ?? "scotus").trim().toLowerCase();
  const proofMode = process.env.CL_PROOF === "1";
  const maxItems = proofMode
    ? 2
    : Math.min(Math.max(Number.parseInt(process.env.CL_MAX ?? "20", 10) || 20, 1), 200);
  const rateMs = Math.max(Number.parseInt(process.env.CL_RATE_MS ?? "450", 10) || 450, 100);

  if (!clKey) {
    console.log(JSON.stringify({ ok: false, reason: "COURTLISTENER_API_KEY missing" }));
    process.exit(2);
  }
  if (!proofMode && !databaseUrl) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing" }));
    process.exit(2);
  }
  if (!proofMode && !openaiKey) {
    console.log(JSON.stringify({ ok: false, reason: "OPENAI_API_KEY missing" }));
    process.exit(2);
  }

  const mappedCourt = CL_COURT_MAP[clCourt] ?? null;
  const unmappedCourts = new Set<string>();
  if (!mappedCourt) unmappedCourts.add(clCourt);

  const counters = { apiCalls: 0 };
  const quarantined: QuarantineRow[] = [];
  const parsed: ParsedOpinion[] = [];
  let discovered = 0;
  let fetched = 0;
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let citationEdges = 0;
  let treatmentSignals = 0;

  // Discover: prefer opinions list (cluster__docket__court); fall back to search.
  const pageSize = Math.min(maxItems, 50);
  let discoverPath: "opinions" | "search" = "opinions";
  let hits: ClSearchHit[] = [];

  const opinionsParams = new URLSearchParams({
    cluster__docket__court: clCourt,
    order_by: "-id",
    page_size: String(pageSize),
  });
  let searchRes = await clFetch(
    `${CL_BASE}/opinions/?${opinionsParams}`,
    clKey,
    rateMs,
    counters,
  );
  if (searchRes.ok) {
    const body = (await searchRes.json()) as { results?: ClSearchHit[] };
    hits = (body.results ?? []).slice(0, maxItems);
  } else if (searchRes.status === 400 || searchRes.status === 404) {
    discoverPath = "search";
    const searchParams = new URLSearchParams({
      type: "o",
      q: "*",
      court: clCourt,
      order_by: "dateFiled desc",
      page_size: String(pageSize),
    });
    searchRes = await clFetch(`${CL_BASE}/search/?${searchParams}`, clKey, rateMs, counters);
    if (!searchRes.ok) {
      console.log(
        JSON.stringify({
          ok: false,
          reason: `discover_http_${searchRes.status}`,
          clCourt,
          mappedCourt: mappedCourt?.courtId ?? null,
          apiCalls: counters.apiCalls,
          discoverPath,
        }),
      );
      process.exit(1);
    }
    const body = (await searchRes.json()) as { results?: ClSearchHit[] };
    hits = (body.results ?? []).slice(0, maxItems);
  } else {
    console.log(
      JSON.stringify({
        ok: false,
        reason: `discover_http_${searchRes.status}`,
        clCourt,
        mappedCourt: mappedCourt?.courtId ?? null,
        apiCalls: counters.apiCalls,
        discoverPath,
      }),
    );
    process.exit(1);
  }
  discovered = hits.length;
  const searchById = new Map<string, ClSearchHit>();
  for (const hit of hits) {
    const id = resolveOpinionId(hit);
    if (id) searchById.set(id, hit);
  }

  // Fetch + parse (skip extra GET when list payload already has usable text)
  for (const hit of hits) {
    const id = resolveOpinionId(hit);
    if (!id) {
      quarantined.push({
        sourceExternalId: hit.cluster_id != null ? `cl-cluster-${hit.cluster_id}` : "cl-unknown",
        reason: "missing_opinion_id",
      });
      continue;
    }
    const sourceExternalId = `cl-opinion-${id}`;
    try {
      const listText = pickText(hit);
      let raw: ClSearchHit = hit;
      if (listText.length < 200) {
        const opRes = await clFetch(`${CL_BASE}/opinions/${id}/`, clKey, rateMs, counters);
        fetched += 1;
        if (!opRes.ok) {
          quarantined.push({
            sourceExternalId,
            reason: `fetch_http_${opRes.status}`,
          });
          continue;
        }
        raw = (await opRes.json()) as ClSearchHit;
      } else {
        fetched += 1;
      }
      const retrievedAt = new Date().toISOString();
      const result = parseOpinion(
        sourceExternalId,
        searchById.get(id) ?? hit,
        raw,
        retrievedAt,
        clCourt,
        mappedCourt,
        unmappedCourts,
      );
      if (!result.ok) {
        quarantined.push(result.quarantine);
        continue;
      }
      parsed.push(result.opinion);
      treatmentSignals += result.opinion.treatmentSignals.length;
    } catch (err) {
      failed += 1;
      quarantined.push({
        sourceExternalId,
        reason: String(err instanceof Error ? err.message : err).slice(0, 300),
      });
    }
  }

  const sample = parsed.slice(0, proofMode ? 2 : 3).map((o) => ({
    title: o.title,
    citation: o.citation,
    date: o.decisionDate,
    url: o.canonicalSourceUrl,
    court: o.mapped.courtId,
    hashPrefix: o.contentHash.slice(0, 12),
    textLen: o.content.length,
    treatmentSignals: o.treatmentSignals,
  }));

  if (proofMode) {
    // Single-line JSON so remote runners can parse stdout reliably.
    console.log(
      JSON.stringify({
        ok: true,
        proofMode: true,
        clCourt,
        mappedCourt: mappedCourt?.courtId ?? null,
        discovered,
        fetched,
        parsed: parsed.length,
        quarantined: quarantined.length,
        imported: 0,
        skipped: 0,
        failed,
        unmappedCourts: [...unmappedCourts].sort(),
        sample,
        citationEdges: 0,
        treatmentSignals,
        apiCalls: counters.apiCalls,
        featureAgents: process.env.FEATURE_AGENTS ?? null,
        quarantineSample: quarantined.slice(0, 5),
      }),
    );
    return;
  }

  const sql = postgres(databaseUrl!, { max: 5, ssl: "require" });
  try {
    const hasCurrentness = await hasColumn(sql, "currentness_status");
    const hasLastChecked = await hasColumn(sql, "last_checked_at");
    const hasCitations = await hasCitationsTable(sql);

    for (const opinion of parsed) {
      try {
        const status = await persistOne(sql, opinion, openaiKey!, {
          hasCurrentness,
          hasLastChecked,
          hasCitations,
        });
        if (status === "imported" || status === "new_version") {
          imported += 1;
          if (hasCitations) {
            citationEdges += extractCitations(opinion.content).length;
          }
        } else {
          skipped += 1;
        }
      } catch (err) {
        failed += 1;
        quarantined.push({
          sourceExternalId: opinion.sourceExternalId,
          reason: `persist:${String(err instanceof Error ? err.message : err).slice(0, 300)}`,
        });
      }
    }

    console.log(
      JSON.stringify({
        ok: true,
        proofMode: false,
        clCourt,
        mappedCourt: mappedCourt?.courtId ?? null,
        discovered,
        fetched,
        parsed: parsed.length,
        quarantined: quarantined.length,
        imported,
        skipped,
        failed,
        unmappedCourts: [...unmappedCourts].sort(),
        sample,
        citationEdges,
        treatmentSignals,
        apiCalls: counters.apiCalls,
        featureAgents: process.env.FEATURE_AGENTS ?? null,
        quarantineSample: quarantined.slice(0, 10),
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(
    JSON.stringify({
      ok: false,
      err: String(e?.stack || e).slice(0, 2500),
    }),
  );
  process.exit(1);
});
