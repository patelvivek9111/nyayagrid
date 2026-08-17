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

const schema = {
  ...schemaCore,
  ...schemaPhase5,
  ...schemaPhase6,
  ...schemaPhase7,
  ...schemaPhase8,
  ...schemaPhase9,
  ...schemaPhase10,
  ...schemaPhase11,
};

export type Database = ReturnType<typeof createDb>;

export function createDb(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }
  const client = postgres(connectionString, { max: 10 });
  return drizzle(client, { schema });
}

export * from "./schema/index";
export * from "./schema/phase5";
export * from "./schema/phase6";
export * from "./schema/phase7";
export * from "./schema/phase8";
export * from "./schema/phase9";
export * from "./schema/phase10";
export * from "./schema/phase11";
export { schema };
export { SYSTEM_ROLE_DEFINITIONS, OWNER_CAPABILITIES } from "./system-roles";
export { createOrganizationWithDefaults } from "./organizations";
export { sql, eq, and, desc, asc, inArray, isNull, or } from "drizzle-orm";
