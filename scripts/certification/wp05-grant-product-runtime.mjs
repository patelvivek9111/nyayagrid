#!/usr/bin/env node
/** Grant least-privilege product runtime access on PRODUCT branch only. */
import postgres from "postgres";

const adminUrl = process.env.PRODUCT_ADMIN_DATABASE_URL;
const role = process.env.PRODUCT_RUNTIME_ROLE || "nyaya_product_runtime";
if (!adminUrl) {
  console.error(JSON.stringify({ error: "PRODUCT_ADMIN_DATABASE_URL required" }));
  process.exit(1);
}
if (!/^[a-z0-9_]+$/.test(role)) throw new Error("bad role");

const sql = postgres(adminUrl.replace("-pooler", ""), { max: 1, ssl: "require", prepare: false });
await sql.unsafe(`GRANT CONNECT ON DATABASE neondb TO ${role}`);
await sql.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
await sql.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
await sql.unsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
await sql.unsafe(
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
);
await sql.unsafe(
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role}`,
);
// Explicitly ensure no corpus tables remain to grant
const corpus = await sql`
  SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r'
    AND (c.relname LIKE 'legal_authority%' OR c.relname LIKE 'corpus_%')`;
await sql.end({ timeout: 5 });
console.log(
  JSON.stringify({
    ok: true,
    role,
    corpusTablesRemaining: corpus.map((r) => r.t),
  }),
);
process.exit(corpus.length === 0 ? 0 : 2);
