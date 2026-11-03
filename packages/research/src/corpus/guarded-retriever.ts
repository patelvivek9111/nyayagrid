/**
 * Guarded corpus authority retrieval.
 *
 * - When FEATURE_NEON_CORPUS_RESEARCH=1: uses CORPUS_DATABASE_URL only (fail-closed).
 * - When flag off: uses the provided product/local Database (dev/cert default).
 * - Never returns chunk hits that fail opinion-quote eligibility.
 * - Identity-only authorities without text never appear as quotable search hits
 *   (hybrid search is chunk-backed); citation identity APIs remain separate.
 */
import type { Database } from "@nyayagrid/database";
import type { EmbeddingProvider } from "@nyayagrid/ai";
import { sql } from "@nyayagrid/database";
import { AuthorityHybridRetriever, type AuthoritySearchOptions } from "../search";
import type { AuthoritySearchFilters, AuthoritySearchHit } from "../provider";
import { classifyAuthorityEligibility, type AuthorityEligibility } from "./authority-eligibility";
import {
  createCorpusDb,
  inspectCorpusConnection,
  isNeonCorpusResearchEnabled,
  ResearchCorpusUnavailableError,
} from "./corpus-db";

export type GuardedSearchHit = AuthoritySearchHit & {
  eligibility: AuthorityEligibility;
  textAvailability: "FULL_TEXT" | "PARTIAL_TEXT" | "IDENTITY_ONLY" | "NONE";
};

export type GuardedRetrieverOptions = {
  /** Product/local DB used when Neon corpus flag is off. */
  productDb: Database;
  embeddings: EmbeddingProvider;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /** Injected corpus DB for tests (avoids env). */
  corpusDb?: Database;
  minQuoteChars?: number;
};

function textAvailabilityFromEligibility(
  eligibility: AuthorityEligibility,
): GuardedSearchHit["textAvailability"] {
  if (eligibility.classes.includes("IDENTITY_ONLY")) return "IDENTITY_ONLY";
  if (eligibility.classes.includes("PARTIAL_TEXT")) return "PARTIAL_TEXT";
  if (eligibility.allowOpinionQuote || eligibility.classes.includes("FULL_TEXT_VERIFIED")) {
    return "FULL_TEXT";
  }
  if (eligibility.allowFullTextGrounding) return "PARTIAL_TEXT";
  return "NONE";
}

async function loadEligibilityForHits(
  db: Database,
  hits: AuthoritySearchHit[],
  minQuoteChars: number,
): Promise<Map<string, AuthorityEligibility>> {
  const map = new Map<string, AuthorityEligibility>();
  if (hits.length === 0) return map;
  const ids = [...new Set(hits.map((h) => h.authorityId))];
  const exec = db as unknown as {
    execute: (q: unknown) => Promise<
      Array<{
        id: string;
        canonical_source_url: string | null;
        source_external_id: string | null;
        source_provider: string | null;
        ingestion_status: string | null;
        identity_only: string | null;
        corpus_complete: string | null;
        text_chars: number;
        has_text: boolean;
        has_emb: boolean;
      }>
    >;
  };
  const rows = await exec.execute(sql`
    SELECT
      a.id,
      a.canonical_source_url,
      a.source_external_id,
      a.source_provider,
      a.ingestion_status::text AS ingestion_status,
      a.metadata->>'identityOnly' AS identity_only,
      a.metadata->>'corpusComplete' AS corpus_complete,
      coalesce((
        SELECT sum(length(coalesce(c.content, '')))::int
        FROM legal_authority_chunks c
        WHERE c.authority_id = a.id
      ), 0) AS text_chars,
      EXISTS (
        SELECT 1 FROM legal_authority_chunks c
        WHERE c.authority_id = a.id
          AND c.content IS NOT NULL
          AND length(btrim(c.content)) > 0
      ) AS has_text,
      EXISTS (
        SELECT 1 FROM legal_authority_chunks c
        WHERE c.authority_id = a.id AND c.embedding IS NOT NULL
      ) AS has_emb
    FROM legal_authorities a
    WHERE a.id IN (${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
  `);

  for (const row of Array.from(rows)) {
    const identityOnly =
      row.identity_only == null
        ? null
        : ["true", "t", "1"].includes(String(row.identity_only).toLowerCase());
    const corpusComplete =
      row.corpus_complete == null
        ? null
        : ["true", "t", "1"].includes(String(row.corpus_complete).toLowerCase());
    map.set(
      row.id,
      classifyAuthorityEligibility({
        authorityId: row.id,
        hasTextContent: Boolean(row.has_text),
        textCharCount: Number(row.text_chars) || 0,
        hasEmbedding: Boolean(row.has_emb),
        canonicalSourceUrl: row.canonical_source_url,
        sourceExternalId: row.source_external_id,
        sourceProvider: row.source_provider,
        ingestionStatus: row.ingestion_status,
        identityOnly,
        corpusComplete,
        minQuoteChars,
      }),
    );
  }

  // Hits whose authority row vanished — fail closed.
  for (const id of ids) {
    if (!map.has(id)) {
      map.set(
        id,
        classifyAuthorityEligibility({
          authorityId: id,
          hasTextContent: false,
          identityOnly: true,
          minQuoteChars,
        }),
      );
    }
  }
  return map;
}

/**
 * Resolve which Database powers corpus search under the current feature gate.
 */
export function resolveCorpusSearchDatabase(params: {
  productDb: Database;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  corpusDb?: Database;
}): { db: Database; mode: "corpus" | "product"; unavailable?: ResearchCorpusUnavailableError } {
  const env = params.env ?? process.env;
  if (!isNeonCorpusResearchEnabled(env)) {
    return { db: params.productDb, mode: "product" };
  }
  const status = inspectCorpusConnection(env);
  if (!status.ok) {
    return {
      db: params.productDb,
      mode: "corpus",
      unavailable: new ResearchCorpusUnavailableError(status.reason),
    };
  }
  if (params.corpusDb) {
    return { db: params.corpusDb, mode: "corpus" };
  }
  return { db: createCorpusDb({ connectionString: undefined }), mode: "corpus" };
}

export class GuardedAuthorityRetriever {
  readonly name = "guarded-authority-hybrid";
  private readonly productDb: Database;
  private readonly embeddings: EmbeddingProvider;
  private readonly env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  private readonly injectedCorpusDb?: Database;
  private readonly minQuoteChars: number;
  private cachedCorpusDb: Database | null = null;

  constructor(options: GuardedRetrieverOptions) {
    this.productDb = options.productDb;
    this.embeddings = options.embeddings;
    this.env = options.env ?? process.env;
    this.injectedCorpusDb = options.corpusDb;
    this.minQuoteChars = options.minQuoteChars ?? 500;
  }

  private corpusDbOrThrow(): Database {
    if (this.injectedCorpusDb) return this.injectedCorpusDb;
    if (this.cachedCorpusDb) return this.cachedCorpusDb;
    this.cachedCorpusDb = createCorpusDb();
    return this.cachedCorpusDb;
  }

  /**
   * Search eligible full-text authorities. Throws ResearchCorpusUnavailableError when
   * FEATURE_NEON_CORPUS_RESEARCH=1 but CORPUS_DATABASE_URL is missing.
   */
  async search(
    query: string,
    filters: AuthoritySearchFilters = {},
    options: AuthoritySearchOptions = {},
  ): Promise<GuardedSearchHit[]> {
    const env = this.env;
    if (isNeonCorpusResearchEnabled(env)) {
      const status = inspectCorpusConnection(env);
      if (!status.ok) {
        throw new ResearchCorpusUnavailableError(status.reason);
      }
    }

    const db = isNeonCorpusResearchEnabled(env) ? this.corpusDbOrThrow() : this.productDb;

    const inner = new AuthorityHybridRetriever(db, this.embeddings);
    const hits = await inner.search(query, filters, options);
    const eligibility = await loadEligibilityForHits(db, hits, this.minQuoteChars);

    const guarded: GuardedSearchHit[] = [];
    for (const hit of hits) {
      const elig = eligibility.get(hit.authorityId)!;
      // Never surface non-groundable hits as opinion passages.
      if (!elig.allowFullTextGrounding) continue;
      // Snippets require quote-ready text; partial text may ground weakly but not quote.
      if (!elig.allowOpinionQuote && (hit.snippet?.trim().length ?? 0) > 0) {
        // Keep hit for ranking/context only if grounding allowed; strip snippet to block quotes.
        guarded.push({
          ...hit,
          snippet: "",
          eligibility: elig,
          textAvailability: textAvailabilityFromEligibility(elig),
        });
        continue;
      }
      guarded.push({
        ...hit,
        eligibility: elig,
        textAvailability: textAvailabilityFromEligibility(elig),
      });
    }
    return guarded;
  }

  /**
   * Citation / identity lookup may return metadata for identity-only authorities.
   * Never attaches opinion text when quote is forbidden.
   */
  async lookupIdentity(authorityId: string): Promise<{
    authorityId: string;
    eligibility: AuthorityEligibility;
    allowOpinionQuote: boolean;
  } | null> {
    const env = this.env;
    if (isNeonCorpusResearchEnabled(env)) {
      const status = inspectCorpusConnection(env);
      if (!status.ok) {
        throw new ResearchCorpusUnavailableError(status.reason);
      }
    }
    const db = isNeonCorpusResearchEnabled(env) ? this.corpusDbOrThrow() : this.productDb;
    const map = await loadEligibilityForHits(
      db,
      [
        {
          authorityId,
          authorityVersionId: authorityId,
          chunkId: authorityId,
          title: "",
          citation: null,
          authorityType: "case",
          jurisdiction: null,
          court: null,
          decisionDate: null,
          score: 0,
          snippet: "",
        },
      ],
      this.minQuoteChars,
    );
    const eligibility = map.get(authorityId);
    if (!eligibility) return null;
    return {
      authorityId,
      eligibility,
      allowOpinionQuote: eligibility.allowOpinionQuote,
    };
  }
}

export function createGuardedAuthorityRetriever(
  options: GuardedRetrieverOptions,
): GuardedAuthorityRetriever {
  return new GuardedAuthorityRetriever(options);
}
