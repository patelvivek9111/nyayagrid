/** JS mirror of packages/database/src/migrate-identity.ts for preflight scripts. */
const LOCAL_ENVS = new Set(["development", "test", "local", "ci"]);

export function isLocalhostUrl(url) {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1/i.test(url);
}

export function parseDbTarget(url) {
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

function fail(code, message) {
  return { ok: false, code, message };
}

export function assertMigrateIdentity(input) {
  const appEnv = (input.appEnv ?? "").trim().toLowerCase();
  if (!appEnv) return fail("APP_ENV_REQUIRED", "Refusing to migrate: APP_ENV is required");

  const url = input.databaseUrl?.trim();
  if (!url) return fail("DATABASE_URL_REQUIRED", "Refusing to migrate: DATABASE_URL is required");

  const parsed = parseDbTarget(url);
  if (parsed.parseError) {
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
      const normalizeEndpoint = (ep) => ep.replace(/-pooler$/i, "");
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
    }

    const corpusUrl = input.corpusDatabaseUrl?.trim();
    if (corpusUrl) {
      const corpus = parseDbTarget(corpusUrl);
      if (!corpus.parseError) {
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
