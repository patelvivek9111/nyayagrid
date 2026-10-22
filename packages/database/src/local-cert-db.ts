/**
 * Local certification DATABASE_URL safety for integration and live-cert tests.
 *
 * Accepts ephemeral GitHub Actions Postgres (host port 5432) and the developer
 * Docker-mapped certification DB (host port 5433 → container 5432). Rejects remote
 * hosts (Neon, staging, production) so tests never mutate non-local data.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const ALLOWED_LOCAL_PORTS = new Set(["5432", "5433"]);

export type LocalCertificationDbOptions = {
  /** Default `nyayagrid` — the CI and local Docker database name. */
  expectedDatabase?: string;
};

function databaseName(pathname: string): string {
  return pathname.replace(/^\//, "").split("?")[0] ?? "";
}

/**
 * True when `url` is a loopback Postgres URL on an allowed local port with the
 * expected database name. Remote hosts and unexpected DB names are rejected.
 */
export function isLocalCertificationDatabaseUrl(
  url: string,
  options: LocalCertificationDbOptions = {},
): boolean {
  if (!url || typeof url !== "string") return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (!LOCAL_HOSTS.has(host)) return false;
  // URL.port is "" when omitted; Postgres default is 5432.
  const port = parsed.port === "" ? "5432" : parsed.port;
  if (!ALLOWED_LOCAL_PORTS.has(port)) return false;
  const expected = options.expectedDatabase ?? "nyayagrid";
  return databaseName(parsed.pathname) === expected;
}

/** Throws when `url` is not a safe local certification database. */
export function assertLocalCertificationDatabaseUrl(
  url: string,
  options: LocalCertificationDbOptions = {},
): void {
  if (isLocalCertificationDatabaseUrl(url, options)) return;
  throw new Error(
    "DATABASE_URL must be a local certification database " +
      "(postgresql://…@localhost|127.0.0.1:5432|5433/nyayagrid). " +
      "Remote, staging, and production hosts are rejected.",
  );
}
