import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";
import { fileURLToPath } from "node:url";

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid";

async function main() {
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = path.join(here, "..", "drizzle");
  await migrate(db, { migrationsFolder });
  await client.end();
  console.log(JSON.stringify({ message: "Migrations applied", migrationsFolder }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
