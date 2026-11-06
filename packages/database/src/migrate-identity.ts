/**
 * Fail-closed migrate target identity gates.
 * Never log or return raw connection strings / passwords.
 */

export type MigrateIdentityInput = {
  appEnv: string | undefined | null;
  databaseUrl: string | undefined | null;
  expectedDbName: string | undefined | null;
  expectedNeonEndpointId: string | undefined | null;
  expectedNeonProjectId: string | undefined | null;
  expectedNeonBranchId: string | undefined | null;
  corpusDatabaseUrl: string | undefined | null;
  /** Explicit operator attestation that neondb on the matched Neon endpoint is product. */
  allowNeondbProduct: boolean;
};

export type ParsedDbTarget = {
  dbName: string | null;
  role: string | null;
  host: string | null;
  neonEndpointId: string | null;
  isNeon: boolean;
  isLocalhost: boolean;
  sslmodeDisable: boolean;
};

export type MigrateIdentityOk = {
  ok: true;
  appEnv: string;
  requireTls: boolean;
  dbName: string;
  neonEndpointId: string | null;
  mode: "local" | "remote";
};

export type MigrateIdentityErr = {
  ok: false;
  code: string;
  message: string;
};

export type MigrateIdentityResult = MigrateIdentityOk | MigrateIdentityErr;

const LOCAL_ENVS = new Set(["development", "test", "local", "ci"]);

export function redactSecrets(value: string): string {
  return value.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi, "[redacted]");
}

export function isLocalhostUrl(url: string): boolean {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1/i.test(url);
}

export function parseDbTarget(url: string): ParsedDbTarget | { parseError: true } {
  try {
    const u = new URL(url);
    const host = u.hostname;
    const neonEp = (host.match(/^(ep-[a-z0-9-]+)/i) || [])[1] || null;
    return {
      dbName: u.pathname.replace(/^\//, "").split("?")[0] || null,
      role: decodeURIComponent(u.username || "") || null,
      host,
      neonEndpointId: neonEp,
      isNeon: /neon\.tech$/i.test(host),
      isLocalhost: isLocalhostUrl(url),
      sslmodeDisable: /[?&]sslmode=disable\b/i.test(url),
    };
  } catch {
    return { parseError: true };
  }
}

function fail(code: string, message: string): MigrateIdentityErr {
  return { ok: false, code, message };
}

/**
 * Validate migrate target before opening a SQL session.
 * Staging/production are fail-closed; local/dev/test/ci remain usable without Neon attestation.
 */
export function assertMigrateIdentity(input: MigrateIdentityInput): MigrateIdentityResult {
  const appEnv = (input.appEnv ?? "").trim().toLowerCase();
  if (!appEnv) {
    return fail("APP_ENV_REQUIRED", "Refusing to migrate: APP_ENV is required");
  }

  const url = input.databaseUrl?.trim();
  if (!url) {
    return fail("DATABASE_URL_REQUIRED", "Refusing to migrate: DATABASE_URL is required");
  }

  const parsed = parseDbTarget(url);
  if ("parseError" in parsed) {
    return fail("DATABASE_URL_UNPARSEABLE", "Refusing to migrate: DATABASE_URL is unparseable");
  }

  const isLocalEnv = LOCAL_ENVS.has(appEnv);
  const isSharedEnv = appEnv === "staging" || appEnv === "production";

  if (isSharedEnv && parsed.isLocalhost) {
    return fail(
      "LOCALHOST_IN_SHARED_ENV",
      "Refusing to migrate: DATABASE_URL is localhost in staging/production",
    );
  }

  const requireTls = !parsed.isLocalhost;
  if (requireTls && parsed.sslmodeDisable) {
    return fail("SSLMODE_DISABLE", "Refusing to migrate: DATABASE_URL sets sslmode=disable");
  }

  if (isSharedEnv) {
    const expectedDb = input.expectedDbName?.trim() || "";
    if (!expectedDb) {
      return fail(
        "EXPECTED_MIGRATE_DB_NAME_REQUIRED",
        "Refusing to migrate: EXPECTED_MIGRATE_DB_NAME is required in staging/production",
      );
    }
    if (!parsed.dbName || parsed.dbName !== expectedDb) {
      return fail(
        "DB_NAME_MISMATCH",
        `Refusing to migrate: database name mismatch (expected=${expectedDb})`,
      );
    }

    const projectId = input.expectedNeonProjectId?.trim() || "";
    const branchId = input.expectedNeonBranchId?.trim() || "";
    const endpointId = input.expectedNeonEndpointId?.trim() || "";

    if (parsed.isNeon) {
      if (!projectId || !branchId) {
        return fail(
          "NEON_PROJECT_BRANCH_REQUIRED",
          "Refusing to migrate: EXPECTED_NEON_PROJECT_ID and EXPECTED_NEON_BRANCH_ID required for Neon targets",
        );
      }
      if (!endpointId) {
        return fail(
          "NEON_ENDPOINT_REQUIRED",
          "Refusing to migrate: EXPECTED_NEON_ENDPOINT_ID required to bind URL host to attested Neon identity",
        );
      }
      const normalizeEndpoint = (ep: string) => ep.replace(/-pooler$/i, "");
      if (
        !parsed.neonEndpointId ||
        normalizeEndpoint(parsed.neonEndpointId) !== normalizeEndpoint(endpointId)
      ) {
        return fail(
          "NEON_ENDPOINT_MISMATCH",
          "Refusing to migrate: DATABASE_URL Neon endpoint does not match EXPECTED_NEON_ENDPOINT_ID",
        );
      }
      if (parsed.dbName === "neondb" && !input.allowNeondbProduct) {
        return fail(
          "NEONDB_REQUIRES_EXPLICIT_ATTESTATION",
          "Refusing to migrate: neondb requires MIGRATE_ALLOW_NEONDB_PRODUCT=1 after product-vs-corpus attestation",
        );
      }
    } else if (!projectId && !branchId && !endpointId) {
      // Non-Neon shared targets still need explicit expected name (already checked)
      // and must not silently accept missing environment identification beyond APP_ENV.
    }

    const corpusUrl = input.corpusDatabaseUrl?.trim();
    if (corpusUrl) {
      const corpus = parseDbTarget(corpusUrl);
      if (!("parseError" in corpus)) {
        if (
          corpus.host &&
          parsed.host &&
          corpus.host === parsed.host &&
          corpus.dbName === parsed.dbName
        ) {
          return fail(
            "PRODUCT_CORPUS_SAME_TARGET",
            "Refusing to migrate: DATABASE_URL and CORPUS_DATABASE_URL resolve to the same host+database",
          );
        }
      }
    }

    // Corpus-shaped role names must never be migrate targets.
    if (parsed.role && /corpus/i.test(parsed.role)) {
      return fail(
        "CORPUS_ROLE_REFUSED",
        "Refusing to migrate: DATABASE_URL role appears corpus-scoped",
      );
    }
  }

  if (!isLocalEnv && !isSharedEnv) {
    return fail("UNKNOWN_APP_ENV", `Refusing to migrate: unsupported APP_ENV=${appEnv}`);
  }

  if (!parsed.dbName) {
    return fail("DB_NAME_MISSING", "Refusing to migrate: DATABASE_URL has no database name");
  }

  return {
    ok: true,
    appEnv,
    requireTls,
    dbName: parsed.dbName,
    neonEndpointId: parsed.neonEndpointId,
    mode: parsed.isLocalhost || isLocalEnv ? "local" : "remote",
  };
}

export function migrateIdentityFromEnv(
  env: NodeJS.Dict<string> = process.env,
): MigrateIdentityResult {
  return assertMigrateIdentity({
    appEnv: env.APP_ENV,
    databaseUrl: env.DATABASE_URL,
    expectedDbName: env.EXPECTED_MIGRATE_DB_NAME,
    expectedNeonEndpointId: env.EXPECTED_NEON_ENDPOINT_ID,
    expectedNeonProjectId: env.EXPECTED_NEON_PROJECT_ID,
    expectedNeonBranchId: env.EXPECTED_NEON_BRANCH_ID,
    corpusDatabaseUrl: env.CORPUS_DATABASE_URL,
    allowNeondbProduct: env.MIGRATE_ALLOW_NEONDB_PRODUCT === "1",
  });
}
