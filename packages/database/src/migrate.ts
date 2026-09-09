import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";
import { fileURLToPath } from "node:url";

function redact(value: string): string {
  return value.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi, "[redacted]");
}

function isLocalhostUrl(url: string): boolean {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1/i.test(url);
}

function migrationsFolderFromEnv(): string {
  if (process.env.MIGRATIONS_FOLDER?.trim()) return process.env.MIGRATIONS_FOLDER.trim();
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.join(here, "..", "drizzle");
  } catch {
    return path.join(process.cwd(), "packages/database/drizzle");
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const appEnv = (process.env.APP_ENV ?? "").trim().toLowerCase();
  if ((appEnv === "staging" || appEnv === "production") && isLocalhostUrl(connectionString)) {
    throw new Error("Refusing to migrate: DATABASE_URL is localhost in staging/production");
  }

  const requireTls = !isLocalhostUrl(connectionString);
  if (requireTls && /[?&]sslmode=disable\b/i.test(connectionString)) {
    throw new Error("Refusing to migrate: DATABASE_URL sets sslmode=disable");
  }

  const client = postgres(connectionString, {
    max: 1,
    ssl: requireTls ? "require" : false,
    prepare: /neon\.tech/i.test(connectionString) ? false : undefined,
  });

  try {
    let pgStatSsl: boolean | "unavailable" = "unavailable";
    if (requireTls) {
      try {
        const sslRows = await client.unsafe(
          "select ssl from pg_stat_ssl where pid = pg_backend_pid()",
        );
        if (sslRows[0] && typeof sslRows[0].ssl === "boolean") {
          pgStatSsl = sslRows[0].ssl;
        }
      } catch {
        pgStatSsl = "unavailable";
      }
      const vectorProbe = await client.unsafe("select '[1,2,3]'::vector as v");
      if (!vectorProbe[0]) {
        throw new Error("Refusing to migrate: pgvector vector type is not usable");
      }
    }

    const db = drizzle(client);
    const migrationsFolder = migrationsFolderFromEnv();
    await migrate(db, { migrationsFolder });
    console.log(
      JSON.stringify({
        message: "Migrations applied",
        tlsClient: requireTls ? "require" : "off",
        pgStatSsl,
        pgvector: true,
        migrationsFolder,
      }),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(redact(raw));
  process.exit(1);
});
