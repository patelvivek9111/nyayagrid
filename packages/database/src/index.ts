import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schemaCore from "./schema/index";
import * as schemaPhase5 from "./schema/phase5";
import * as schemaPhase6 from "./schema/phase6";
import * as schemaPhase7 from "./schema/phase7";
import * as schemaPhase8 from "./schema/phase8";
import * as schemaPhase9 from "./schema/phase9";
import * as schemaPhase10 from "./schema/phase10";
import * as schemaPhase11 from "./schema/phase11";
import * as schemaPhase12 from "./schema/phase12";
import * as schemaPhase13 from "./schema/phase13";
import * as schemaPhase14 from "./schema/phase14";
import * as schemaPhase15 from "./schema/phase15";
import * as schemaPhase16 from "./schema/phase16";
import * as schemaPhase17 from "./schema/phase17";

const schema = {
  ...schemaCore,
  ...schemaPhase5,
  ...schemaPhase6,
  ...schemaPhase7,
  ...schemaPhase8,
  ...schemaPhase9,
  ...schemaPhase10,
  ...schemaPhase11,
  ...schemaPhase12,
  ...schemaPhase13,
  ...schemaPhase14,
  ...schemaPhase15,
  ...schemaPhase16,
  ...schemaPhase17,
};

export type Database = ReturnType<typeof createDb>;

export function createDb(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }
  const client = postgres(connectionString, { max: 10 });
  const db = drizzle(client, { schema });
  Object.assign(db, { $client: client });
  return db;
}

export type CreateReadOnlyDbOptions = {
  max?: number;
  /** Postgres statement_timeout in milliseconds. */
  statementTimeoutMs?: number;
  applicationName?: string;
};

/**
 * Open a SELECT-oriented pool with session `default_transaction_read_only=on`.
 * Intended for CORPUS_DATABASE_URL — never a substitute for a restricted DB role.
 */
export function createReadOnlyDb(connectionString: string, options: CreateReadOnlyDbOptions = {}) {
  if (!connectionString) {
    throw new Error("connectionString is required for createReadOnlyDb");
  }
  const max = options.max ?? 3;
  const statementTimeoutMs = options.statementTimeoutMs ?? 30_000;
  const applicationName = options.applicationName ?? "nyayagrid-readonly";
  const isNeon = /neon\.tech/i.test(connectionString);
  const client = postgres(connectionString, {
    max,
    prepare: isNeon ? false : undefined,
    idle_timeout: 20,
    connect_timeout: 15,
    connection: {
      application_name: applicationName,
      options: `-c default_transaction_read_only=on -c statement_timeout=${statementTimeoutMs}`,
    },
  });
  const db = drizzle(client, { schema });
  Object.assign(db, { $client: client });
  return db;
}

/** Close the postgres.js pool opened by `createDb`. Safe to call more than once. */
export async function closeDb(db: Database): Promise<void> {
  const client = (db as { $client?: { end?: (options?: { timeout?: number }) => Promise<void> } })
    .$client;
  await client?.end?.({ timeout: 5 });
}

export * from "./schema/index";
export * from "./schema/phase5";
export * from "./schema/phase6";
export * from "./schema/phase7";
export * from "./schema/phase8";
export * from "./schema/phase9";
export * from "./schema/phase10";
export * from "./schema/phase11";
export * from "./schema/phase12";
export * from "./schema/phase13";
export * from "./schema/phase14";
export * from "./schema/phase15";
export * from "./schema/phase16";
export * from "./schema/phase17";
export { schema };
export {
  SYSTEM_ROLE_DEFINITIONS,
  OWNER_CAPABILITIES,
  PROSECUTION_ROLE_DEFINITIONS,
} from "./system-roles";
export { createOrganizationWithDefaults } from "./organizations";
export { ensureProsecutionRoles } from "./prosecution-roles";
export {
  assertLocalCertificationDatabaseUrl,
  isLocalCertificationDatabaseUrl,
  type LocalCertificationDbOptions,
} from "./local-cert-db";
export { sql, eq, and, desc, asc, inArray, isNull, or } from "drizzle-orm";
