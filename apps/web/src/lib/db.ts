import { createDb } from "@nyayagrid/database";

const globalForDb = globalThis as unknown as { __nyayagridDb?: ReturnType<typeof createDb> };

export function getDb() {
  if (!globalForDb.__nyayagridDb) {
    globalForDb.__nyayagridDb = createDb(process.env.DATABASE_URL);
  }
  return globalForDb.__nyayagridDb;
}
