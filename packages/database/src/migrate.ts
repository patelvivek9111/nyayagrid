import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrateIdentityFromEnv, redactSecrets } from "./migrate-identity";

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
  const identity = migrateIdentityFromEnv(process.env);
  if (!identity.ok) {
    throw new Error(`${identity.code}: ${identity.message}`);
  }

  const connectionString = process.env.DATABASE_URL!.trim();
  const client = postgres(connectionString, {
    max: 1,
    ssl: identity.requireTls ? "require" : false,
    prepare: /neon\.tech/i.test(connectionString) ? false : undefined,
  });

  try {
    // Live name check — refuse if connected DB differs from attested expected name.
    const live = await client.unsafe("select current_database() as db, current_user as usr");
    const liveDb = String(live[0]?.db ?? "");
    const liveUser = String(live[0]?.usr ?? "");
    if (liveDb !== identity.dbName) {
      throw new Error(
        `LIVE_DB_NAME_MISMATCH: connected database does not match EXPECTED_MIGRATE_DB_NAME`,
      );
    }
    if (/corpus/i.test(liveUser)) {
      throw new Error(`CORPUS_ROLE_REFUSED: connected role appears corpus-scoped`);
    }

    let pgStatSsl: boolean | "unavailable" = "unavailable";
    if (identity.requireTls) {
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
        appEnv: identity.appEnv,
        mode: identity.mode,
        dbName: identity.dbName,
        neonEndpointBound: Boolean(identity.neonEndpointId),
        tlsClient: identity.requireTls ? "require" : "off",
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
  console.error(redactSecrets(raw));
  process.exit(1);
});
