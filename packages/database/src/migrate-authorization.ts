/**
 * WP-05B — fail-closed migration authorization.
 *
 * Staging/production migrations require an explicit operator grant plus positive
 * database identity checks. The legal corpus URL must never be the migrate target.
 * Secret values are never included in thrown messages.
 */

export type MigrateAuthorizationEnv = Record<string, string | undefined>;

export type MigrateAuthorizationResult =
  | { ok: true; mode: "local_development" | "authorized_deployed" }
  | { ok: false; code: string; message: string };

function read(env: MigrateAuthorizationEnv, key: string): string {
  return String(env[key] ?? "").trim();
}

function isTruthyMigrateAllow(raw: string): boolean {
  const v = raw.toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function parsePostgresUrl(url: string): { host: string; port: string; database: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") return null;
    return {
      host: parsed.hostname.toLowerCase(),
      port: parsed.port === "" ? "5432" : parsed.port,
      database: (parsed.pathname.replace(/^\//, "").split("?")[0] ?? "").toLowerCase(),
    };
  } catch {
    return null;
  }
}

function isLocalhostHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1";
}

/**
 * Pure authorization decision for `npm run db:migrate` / migrate.cjs.
 * Does not open a database connection.
 */
export function evaluateMigrateAuthorization(
  env: MigrateAuthorizationEnv = process.env,
): MigrateAuthorizationResult {
  const databaseUrl = read(env, "DATABASE_URL");
  if (!databaseUrl) {
    return {
      ok: false,
      code: "MIGRATE_DATABASE_URL_MISSING",
      message: "DATABASE_URL is required to run migrations.",
    };
  }

  const target = parsePostgresUrl(databaseUrl);
  if (!target) {
    return {
      ok: false,
      code: "MIGRATE_DATABASE_URL_INVALID",
      message: "DATABASE_URL must be a valid postgres/postgresql URL.",
    };
  }

  const corpusUrl = read(env, "CORPUS_DATABASE_URL");
  if (corpusUrl) {
    if (corpusUrl === databaseUrl) {
      return {
        ok: false,
        code: "MIGRATE_TARGET_IS_CORPUS",
        message:
          "Refusing to migrate: DATABASE_URL matches CORPUS_DATABASE_URL. The legal corpus must never be a migration target.",
      };
    }
    const corpus = parsePostgresUrl(corpusUrl);
    if (
      corpus &&
      corpus.host === target.host &&
      corpus.port === target.port &&
      corpus.database === target.database
    ) {
      return {
        ok: false,
        code: "MIGRATE_TARGET_IS_CORPUS",
        message:
          "Refusing to migrate: DATABASE_URL identity matches CORPUS_DATABASE_URL. The legal corpus must never be a migration target.",
      };
    }
  }

  // Explicit forbid flag if an operator mis-points a corpus migrate helper.
  if (isTruthyMigrateAllow(read(env, "MIGRATE_LEGAL_CORPUS"))) {
    return {
      ok: false,
      code: "MIGRATE_CORPUS_FLAG_FORBIDDEN",
      message:
        "Refusing to migrate: MIGRATE_LEGAL_CORPUS is set. Corpus schema is not migrated by this tool.",
    };
  }

  const appEnv = read(env, "APP_ENV").toLowerCase();
  const deployed = appEnv === "staging" || appEnv === "production";

  if (!deployed) {
    // Local/dev/test: allow without ALLOW_DATABASE_MIGRATE, still corpus-safe above.
    return { ok: true, mode: "local_development" };
  }

  if (isLocalhostHost(target.host)) {
    return {
      ok: false,
      code: "MIGRATE_LOCALHOST_IN_DEPLOYED_ENV",
      message: `Refusing to migrate: DATABASE_URL is localhost while APP_ENV=${appEnv}.`,
    };
  }

  if (!isTruthyMigrateAllow(read(env, "ALLOW_DATABASE_MIGRATE"))) {
    return {
      ok: false,
      code: "MIGRATE_NOT_AUTHORIZED",
      message:
        "Refusing to migrate: set ALLOW_DATABASE_MIGRATE=1 for an explicit, reviewed staging/production migration. Application deploys must not auto-migrate.",
    };
  }

  const expectedHost = read(env, "EXPECTED_MIGRATE_DB_HOST").toLowerCase();
  const expectedName = read(env, "EXPECTED_MIGRATE_DB_NAME").toLowerCase();
  if (!expectedHost || !expectedName) {
    return {
      ok: false,
      code: "MIGRATE_IDENTITY_UNDECLARED",
      message:
        "Refusing to migrate: EXPECTED_MIGRATE_DB_HOST and EXPECTED_MIGRATE_DB_NAME are required in staging/production so the target identity is positively verified.",
    };
  }

  if (expectedHost !== target.host) {
    return {
      ok: false,
      code: "MIGRATE_HOST_MISMATCH",
      message: "Refusing to migrate: DATABASE_URL host does not match EXPECTED_MIGRATE_DB_HOST.",
    };
  }

  if (expectedName !== target.database) {
    return {
      ok: false,
      code: "MIGRATE_DATABASE_NAME_MISMATCH",
      message:
        "Refusing to migrate: DATABASE_URL database name does not match EXPECTED_MIGRATE_DB_NAME.",
    };
  }

  return { ok: true, mode: "authorized_deployed" };
}

export function assertMigrateAuthorized(env: MigrateAuthorizationEnv = process.env): void {
  const result = evaluateMigrateAuthorization(env);
  if (!result.ok) {
    const error = new Error(`${result.code}: ${result.message}`);
    error.name = "MigrateAuthorizationError";
    throw error;
  }
}
