/**
 * Separate legal-research corpus database connection.
 *
 * PRODUCT DB  = process.env.DATABASE_URL (matters, users, audit, …)
 * CORPUS DB   = process.env.CORPUS_DATABASE_URL (legal_authorities / chunks / citations)
 *
 * Never substitute CORPUS_DATABASE_URL for DATABASE_URL.
 * Read-only transaction defaults are an extra guard — not a substitute for a SELECT-only role.
 */
import { createReadOnlyDb, type Database } from "@nyayagrid/database";

export const CORPUS_DATABASE_ENV = "CORPUS_DATABASE_URL";
export const FEATURE_NEON_CORPUS_RESEARCH_ENV = "FEATURE_NEON_CORPUS_RESEARCH";

export type CorpusConnectionStatus =
  | { ok: true; mode: "corpus"; redactedHost: string; redactedDatabase: string }
  | { ok: false; code: "RESEARCH_CORPUS_UNAVAILABLE" | "CORPUS_FLAG_DISABLED"; reason: string };

export function isNeonCorpusResearchEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  const raw = String(env[FEATURE_NEON_CORPUS_RESEARCH_ENV] ?? "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function getCorpusDatabaseUrl(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | null {
  const value = env[CORPUS_DATABASE_ENV]?.trim();
  return value ? value : null;
}

export function redactCorpusUrl(url: string): { host: string; database: string; port: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    database: parsed.pathname.replace(/^\//, "").split("?")[0] ?? "",
    port: parsed.port || "(default)",
  };
}

/**
 * Inspect whether the guarded Neon/corpus path can be used.
 * Does not open a connection and never prints credentials.
 */
export function inspectCorpusConnection(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): CorpusConnectionStatus {
  if (!isNeonCorpusResearchEnabled(env)) {
    return {
      ok: false,
      code: "CORPUS_FLAG_DISABLED",
      reason: `${FEATURE_NEON_CORPUS_RESEARCH_ENV} is not enabled`,
    };
  }
  const url = getCorpusDatabaseUrl(env);
  if (!url) {
    return {
      ok: false,
      code: "RESEARCH_CORPUS_UNAVAILABLE",
      reason: `${CORPUS_DATABASE_ENV} is required when ${FEATURE_NEON_CORPUS_RESEARCH_ENV}=1`,
    };
  }
  const redacted = redactCorpusUrl(url);
  return {
    ok: true,
    mode: "corpus",
    redactedHost: redacted.host,
    redactedDatabase: redacted.database,
  };
}

export type CreateCorpusDbOptions = {
  max?: number;
  statementTimeoutMs?: number;
  connectionString?: string;
};

/**
 * Open a corpus DB client with read-only session defaults and tight limits.
 * Throws RESEARCH_CORPUS_UNAVAILABLE when URL missing.
 */
export function createCorpusDb(options: CreateCorpusDbOptions = {}): Database {
  const connectionString = options.connectionString ?? getCorpusDatabaseUrl();
  if (!connectionString) {
    throw new Error("RESEARCH_CORPUS_UNAVAILABLE: CORPUS_DATABASE_URL is not set");
  }
  return createReadOnlyDb(connectionString, {
    max: options.max ?? 3,
    statementTimeoutMs: options.statementTimeoutMs ?? 30_000,
    applicationName: "nyayagrid-corpus-ro",
  });
}

export class ResearchCorpusUnavailableError extends Error {
  readonly code = "RESEARCH_CORPUS_UNAVAILABLE" as const;
  constructor(message: string) {
    super(message);
    this.name = "ResearchCorpusUnavailableError";
  }
}
