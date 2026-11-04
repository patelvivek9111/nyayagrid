#!/usr/bin/env node
import postgres from "postgres";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const reportPath = join(
  __dirname,
  "../../packages/research/corpus/reports/wp05-isolation-inventory.json",
);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(JSON.stringify({ result: "ERROR", error: "DATABASE_URL required" }));
  process.exit(1);
}

const sql = postgres(url, { max: 1, ssl: "require", prepare: false });
await sql`SET default_transaction_read_only = on`;
const host = new URL(url).hostname;
const database = new URL(url).pathname.replace(/^\//, "").split("?")[0];

const tables = await sql`
  SELECT c.relname AS table_name,
         pg_catalog.pg_get_userbyid(c.relowner) AS owner,
         n.nspname AS schema
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND c.relname IN (
      'legal_authorities','legal_authority_chunks','legal_authority_versions','legal_authority_citations',
      'organizations','matters','documents','audit_events','users','memberships'
    )
  ORDER BY 1`;

const grants = await sql`
  SELECT table_name, grantee, privilege_type
  FROM information_schema.role_table_grants
  WHERE table_schema='public'
    AND table_name IN (
      'legal_authorities','legal_authority_chunks','legal_authority_versions','legal_authority_citations',
      'organizations','matters','documents','audit_events'
    )
  ORDER BY table_name, grantee, privilege_type`;

const fks = await sql`
  SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema='public'
    AND (
      tc.table_name LIKE 'legal_%' OR ccu.table_name LIKE 'legal_%'
      OR tc.table_name IN ('organizations','matters','documents','audit_events')
    )
  ORDER BY 1,2
  LIMIT 80`;

const report = {
  classification: "NYAYAGRID_WP05_ISOLATION_INVENTORY",
  at: new Date().toISOString(),
  readOnly: true,
  neonCorpusWrites: 0,
  target: { host, database, branch: "br-delicate-cloud-au0md4t9" },
  sharedPhysicalDatabase: true,
  tables,
  grantsSample: grants,
  foreignKeysSample: fks,
  owners: [...new Set(tables.map((t) => t.owner))],
  conclusion:
    "Product and corpus tables coexist in public schema on shared neondb — physical isolation OPEN pending operator-approved cutover",
};

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      ok: true,
      tableCount: tables.length,
      grantRows: grants.length,
      fkRows: fks.length,
      owners: report.owners,
    },
    null,
    2,
  ),
);
await sql.end({ timeout: 5 });
