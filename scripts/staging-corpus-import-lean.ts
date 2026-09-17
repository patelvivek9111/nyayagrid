/**
 * Lean staging corpus importer — runs on Fly without @nyayagrid/ai or workspace packages.
 * Fetches curated bundles from a pinned GitHub SHA; embeds via OpenAI HTTP API (384-dim).
 * Never prints DATABASE_URL or OPENAI_API_KEY.
 */
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";

const PINNED =
  process.env.CORPUS_GIT_SHA?.trim() ||
  "84f3bef1de66c766ea5da34a6b6185e783231375";
const BASE = `https://raw.githubusercontent.com/patelvivek9111/nyayagrid/${PINNED}/packages/research/corpus/bundles`;

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS = 384;
const EMBEDDING_BATCH_SIZE = 32;
const MAX_CHUNK_CHARS = 1000;

type HierarchyNode = { level: string; ref: string; label?: string };

type BundleAuthority = {
  title: string;
  authorityType: string;
  content: string;
  sourceProvider: string;
  sourceExternalId: string;
  shortTitle?: string | null;
  citation?: string | null;
  normalizedCitation?: string | null;
  jurisdiction?: string | null;
  court?: string | null;
  courtId?: string | null;
  authorityState?: string | null;
  federalCircuit?: string | null;
  courtLevel?: string | null;
  decisionDate?: string | null;
  effectiveDate?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  publicationStatus?: string | null;
  canonicalSourceUrl?: string | null;
  hierarchyPath?: HierarchyNode[];
  metadata?: Record<string, unknown>;
  sourceMetadata?: Record<string, unknown>;
  bundleSourceClass?: string;
  docketNumber?: string | null;
};

type RunSummary = {
  total: number;
  imported: number;
  newVersions: number;
  skipped: number;
  errors: number;
  errorDetails: Array<{ sourceExternalId: string; title: string; error: string }>;
};

type CountsRow = {
  real: number;
  total: number;
  cases: number;
  statutes: number;
  regulations: number;
  rules: number;
  jurisdictions: number;
};

function redactDatabaseUrl(url: string): {
  protocol: string;
  host: string;
  port: string;
  database: string;
  hasUser: boolean;
  hasPassword: boolean;
} {
  const parsed = new URL(url);
  return {
    protocol: parsed.protocol.replace(":", ""),
    host: parsed.hostname,
    port: parsed.port || "(default)",
    database: parsed.pathname.replace(/^\//, "").split("?")[0] ?? "",
    hasUser: Boolean(parsed.username),
    hasPassword: Boolean(parsed.password),
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch_failed ${res.status} ${url}`);
  return (await res.json()) as T;
}

async function loadAuthoritiesFromGithub(): Promise<{
  phase: string;
  authorities: BundleAuthority[];
}> {
  const manifest = await fetchJson<{
    phase: string;
    federalBundles?: Array<{ bundleFile: string }>;
    states: Array<{ code: string; bundleFile: string }>;
  }>(`${BASE}/manifest.json`);
  const files = [
    ...(manifest.federalBundles ?? []).map((b) => b.bundleFile),
    ...manifest.states.map((s) => s.bundleFile),
  ];
  const authorities: BundleAuthority[] = [];
  for (const file of files) {
    const rows = await fetchJson<BundleAuthority[]>(`${BASE}/${file}`);
    if (!Array.isArray(rows)) throw new Error(`bundle_not_array ${file}`);
    authorities.push(...rows);
  }
  return { phase: manifest.phase, authorities };
}

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Simple splitter: paragraphs, then hard-cap ~1000 chars. */
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

async function countByType(sql: postgres.Sql): Promise<CountsRow> {
  const rows = await sql`
    select
      count(*) filter (where source_provider = 'us-primary-corpus')::int as real,
      count(*)::int as total,
      count(*) filter (where authority_type = 'case' and source_provider = 'us-primary-corpus')::int as cases,
      count(*) filter (where authority_type = 'statute' and source_provider = 'us-primary-corpus')::int as statutes,
      count(*) filter (where authority_type = 'regulation' and source_provider = 'us-primary-corpus')::int as regulations,
      count(*) filter (where authority_type = 'rule' and source_provider = 'us-primary-corpus')::int as rules,
      count(distinct authority_state) filter (where source_provider = 'us-primary-corpus')::int as jurisdictions
    from legal_authorities
  `;
  const r = rows[0] as CountsRow;
  return {
    real: Number(r.real),
    total: Number(r.total),
    cases: Number(r.cases),
    statutes: Number(r.statutes),
    regulations: Number(r.regulations),
    rules: Number(r.rules),
    jurisdictions: Number(r.jurisdictions),
  };
}

async function hasCurrentnessColumn(sql: postgres.Sql): Promise<boolean> {
  const rows = await sql`
    select 1 as ok
    from information_schema.columns
    where table_name = 'legal_authorities'
      and column_name = 'currentness_status'
    limit 1
  `;
  return rows.length > 0;
}

async function importOne(
  sql: postgres.Sql,
  auth: BundleAuthority,
  apiKey: string,
  hasCurrentness: boolean,
): Promise<"imported" | "new_version" | "skipped"> {
  const hash = sha256Hex(auth.content);
  const metadata: Record<string, unknown> = {
    ...(auth.metadata ?? {}),
  };
  if (auth.bundleSourceClass) {
    metadata.bundleSourceClass = auth.bundleSourceClass;
  }

  const existing = await sql`
    select id from legal_authorities
    where source_provider = ${auth.sourceProvider}
      and source_external_id = ${auth.sourceExternalId}
    limit 1
  `;

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
      return "skipped";
    }

    // Close previous open version(s), then insert new version + chunks.
    await sql`
      update legal_authority_versions
      set valid_to = now()
      where authority_id = ${authorityId}
        and valid_to is null
    `;

    const nextVersion = Number(latest[0]?.version_number ?? 0) + 1;

    if (hasCurrentness) {
      await sql`
        update legal_authorities set
          title = ${auth.title},
          authority_type = ${auth.authorityType}::authority_type,
          jurisdiction = ${auth.jurisdiction ?? null},
          court = ${auth.court ?? null},
          court_id = ${auth.courtId ?? null},
          authority_state = ${auth.authorityState ?? null},
          federal_circuit = ${auth.federalCircuit ?? null},
          court_level = ${auth.courtLevel ?? null},
          citation = ${auth.citation ?? null},
          normalized_citation = ${auth.normalizedCitation ?? null},
          decision_date = ${auth.decisionDate ?? null},
          effective_date = ${auth.effectiveDate ?? null},
          canonical_source_url = ${auth.canonicalSourceUrl ?? null},
          hierarchy_path = ${sql.json(auth.hierarchyPath ?? [])},
          metadata = ${sql.json(metadata)},
          ingestion_status = 'processing'::authority_ingestion_status,
          currentness_status = 'unknown'::authority_currentness_status,
          updated_at = now()
        where id = ${authorityId}
      `;
    } else {
      await sql`
        update legal_authorities set
          title = ${auth.title},
          authority_type = ${auth.authorityType}::authority_type,
          jurisdiction = ${auth.jurisdiction ?? null},
          court = ${auth.court ?? null},
          court_id = ${auth.courtId ?? null},
          authority_state = ${auth.authorityState ?? null},
          federal_circuit = ${auth.federalCircuit ?? null},
          court_level = ${auth.courtLevel ?? null},
          citation = ${auth.citation ?? null},
          normalized_citation = ${auth.normalizedCitation ?? null},
          decision_date = ${auth.decisionDate ?? null},
          effective_date = ${auth.effectiveDate ?? null},
          canonical_source_url = ${auth.canonicalSourceUrl ?? null},
          hierarchy_path = ${sql.json(auth.hierarchyPath ?? [])},
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
        ${auth.content},
        ${auth.effectiveFrom ?? auth.effectiveDate ?? null},
        ${auth.effectiveTo ?? null},
        ${auth.sourceProvider},
        ${sql.json(auth.sourceMetadata ?? {})},
        ${hash}
      )
    `;

    await insertChunks(sql, authorityId, versionId, auth.content, apiKey);

    await sql`
      update legal_authorities
      set ingestion_status = 'ready'::authority_ingestion_status, updated_at = now()
      where id = ${authorityId}
    `;
    return "new_version";
  }

  // New authority
  const authorityId = randomUUID();
  const versionId = randomUUID();

  if (hasCurrentness) {
    await sql`
      insert into legal_authorities (
        id, authority_type, jurisdiction, court, court_id, authority_state,
        federal_circuit, court_level, title, short_title, citation, normalized_citation,
        docket_number, decision_date, effective_date, publication_status,
        source_provider, source_external_id, canonical_source_url,
        ingestion_status, currentness_status, hierarchy_path, metadata
      ) values (
        ${authorityId},
        ${auth.authorityType}::authority_type,
        ${auth.jurisdiction ?? null},
        ${auth.court ?? null},
        ${auth.courtId ?? null},
        ${auth.authorityState ?? null},
        ${auth.federalCircuit ?? null},
        ${auth.courtLevel ?? null},
        ${auth.title},
        ${auth.shortTitle ?? null},
        ${auth.citation ?? null},
        ${auth.normalizedCitation ?? null},
        ${auth.docketNumber ?? null},
        ${auth.decisionDate ?? null},
        ${auth.effectiveDate ?? null},
        ${auth.publicationStatus ?? null},
        ${auth.sourceProvider},
        ${auth.sourceExternalId},
        ${auth.canonicalSourceUrl ?? null},
        'processing'::authority_ingestion_status,
        'unknown'::authority_currentness_status,
        ${sql.json(auth.hierarchyPath ?? [])},
        ${sql.json(metadata)}
      )
    `;
  } else {
    await sql`
      insert into legal_authorities (
        id, authority_type, jurisdiction, court, court_id, authority_state,
        federal_circuit, court_level, title, short_title, citation, normalized_citation,
        docket_number, decision_date, effective_date, publication_status,
        source_provider, source_external_id, canonical_source_url,
        ingestion_status, hierarchy_path, metadata
      ) values (
        ${authorityId},
        ${auth.authorityType}::authority_type,
        ${auth.jurisdiction ?? null},
        ${auth.court ?? null},
        ${auth.courtId ?? null},
        ${auth.authorityState ?? null},
        ${auth.federalCircuit ?? null},
        ${auth.courtLevel ?? null},
        ${auth.title},
        ${auth.shortTitle ?? null},
        ${auth.citation ?? null},
        ${auth.normalizedCitation ?? null},
        ${auth.docketNumber ?? null},
        ${auth.decisionDate ?? null},
        ${auth.effectiveDate ?? null},
        ${auth.publicationStatus ?? null},
        ${auth.sourceProvider},
        ${auth.sourceExternalId},
        ${auth.canonicalSourceUrl ?? null},
        'processing'::authority_ingestion_status,
        ${sql.json(auth.hierarchyPath ?? [])},
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
      ${auth.content},
      ${auth.effectiveFrom ?? auth.effectiveDate ?? null},
      ${auth.effectiveTo ?? null},
      ${auth.sourceProvider},
      ${sql.json(auth.sourceMetadata ?? {})},
      ${hash}
    )
  `;

  await insertChunks(sql, authorityId, versionId, auth.content, apiKey);

  await sql`
    update legal_authorities
    set ingestion_status = 'ready'::authority_ingestion_status, updated_at = now()
    where id = ${authorityId}
  `;
  return "imported";
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

async function runImport(
  sql: postgres.Sql,
  authorities: BundleAuthority[],
  apiKey: string,
  hasCurrentness: boolean,
): Promise<RunSummary> {
  const summary: RunSummary = {
    total: authorities.length,
    imported: 0,
    newVersions: 0,
    skipped: 0,
    errors: 0,
    errorDetails: [],
  };

  for (const auth of authorities) {
    try {
      const status = await importOne(sql, auth, apiKey, hasCurrentness);
      if (status === "imported") summary.imported += 1;
      else if (status === "new_version") summary.newVersions += 1;
      else summary.skipped += 1;
    } catch (err) {
      summary.errors += 1;
      summary.errorDetails.push({
        sourceExternalId: auth.sourceExternalId,
        title: auth.title,
        error: String(err instanceof Error ? err.message : err).slice(0, 500),
      });
    }
  }
  return summary;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!databaseUrl) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing" }));
    process.exit(2);
  }
  if (!apiKey) {
    console.log(JSON.stringify({ ok: false, reason: "OPENAI_API_KEY missing" }));
    process.exit(2);
  }

  const sql = postgres(databaseUrl, { max: 5, ssl: "require" });

  try {
    const { phase, authorities } = await loadAuthoritiesFromGithub();
    const hasCurrentness = await hasCurrentnessColumn(sql);
    const before = await countByType(sql);

    const first = await runImport(sql, authorities, apiKey, hasCurrentness);
    const second = await runImport(sql, authorities, apiKey, hasCurrentness);
    const after = await countByType(sql);

    console.log(
      JSON.stringify(
        {
          ok: true,
          lean: true,
          pinned: PINNED,
          phase,
          authorityCount: authorities.length,
          embeddingModel: EMBEDDING_MODEL,
          embeddingDims: EMBEDDING_DIMS,
          hasCurrentnessColumn: hasCurrentness,
          database: redactDatabaseUrl(databaseUrl),
          before,
          first: {
            imported: first.imported,
            newVersions: first.newVersions,
            skipped: first.skipped,
            errors: first.errors,
            total: first.total,
            errorDetails: first.errorDetails.slice(0, 20),
          },
          second: {
            imported: second.imported,
            newVersions: second.newVersions,
            skipped: second.skipped,
            errors: second.errors,
            total: second.total,
            errorDetails: second.errorDetails.slice(0, 20),
          },
          after,
          featureAgents: process.env.FEATURE_AGENTS ?? null,
        },
        null,
        2,
      ),
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
