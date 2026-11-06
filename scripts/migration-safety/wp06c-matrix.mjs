/**
 * WP-06C disposable matrix matching verified staging baseline:
 * - Journal: 0000–0017 + 0024 (19 rows), max when 1788200000000
 * - Missing criminal_cases / contacts / memories / graph (week3 skipped)
 * - Preserves org/client/matter/document seed rows through migrate→0033
 *
 * Localhost Docker only. Never staging/Neon URLs.
 */
import postgres from "postgres";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import crypto from "node:crypto";
import { assertGraphSchemaContract } from "./graph-schema-contract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ADMIN_URL = "postgresql://nyayagrid:nyayagrid@localhost:5433/postgres";
const DRIZZLE = path.join(ROOT, "packages/database/drizzle");
const results = [];

function dbUrl(name) {
  return `postgresql://nyayagrid:nyayagrid@localhost:5433/${name}`;
}

function migrate(name, migrationsFolder = DRIZZLE) {
  const tsxCli = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  execFileSync(process.execPath, [tsxCli, "packages/database/src/migrate.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: dbUrl(name),
      APP_ENV: "development",
      MIGRATIONS_FOLDER: migrationsFolder,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function withAdmin(fn) {
  const sql = postgres(ADMIN_URL, { max: 1 });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function resetDb(name) {
  await withAdmin(async (sql) => {
    await sql.unsafe(`DROP DATABASE IF EXISTS ${name}`);
    await sql.unsafe(`CREATE DATABASE ${name}`);
  });
}

async function withDb(name, fn) {
  const sql = postgres(dbUrl(name), { max: 1 });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function record(state, pass, detail) {
  results.push({ state, pass, detail });
  console.log(JSON.stringify({ state, pass, detail }));
  if (!pass) throw new Error(`${state} FAILED: ${detail}`);
}

function buildFolderThrough(tags, dest) {
  fs.mkdirSync(path.join(dest, "meta"), { recursive: true });
  const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, "meta/_journal.json"), "utf8"));
  journal.entries = journal.entries.filter((e) => tags.includes(e.tag));
  fs.writeFileSync(path.join(dest, "meta/_journal.json"), JSON.stringify(journal, null, 2));
  for (const e of journal.entries) {
    fs.copyFileSync(path.join(DRIZZLE, `${e.tag}.sql`), path.join(dest, `${e.tag}.sql`));
  }
}

async function assertMainProductContract(sql) {
  for (const t of [
    "criminal_cases",
    "contacts",
    "client_contacts",
    "document_folders",
    "prosecution_case_memories",
    "prosecution_graph_nodes",
    "prosecution_graph_edges",
  ]) {
    const rows = await sql`
      select 1 from information_schema.tables where table_schema='public' and table_name=${t}
    `;
    if (!rows.length) throw new Error(`missing ${t}`);
  }
  for (const [t, c] of [
    ["time_entries", "billable"],
    ["invoices", "total_minutes"],
    ["prosecution_graph_nodes", "node_kind"],
  ]) {
    const rows = await sql`
      select 1 from information_schema.columns
      where table_schema='public' and table_name=${t} and column_name=${c}
    `;
    if (!rows.length) throw new Error(`missing ${t}.${c}`);
  }
  await assertGraphSchemaContract(sql);
}

async function main() {
  const stamp = Date.now().toString(36);
  const dbs = [];
  const tmp = path.join(ROOT, "scripts/migration-safety/.tmp-wp06c");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });

  const through0017 = path.join(tmp, "through-0017");
  const tags0017 = JSON.parse(fs.readFileSync(path.join(DRIZZLE, "meta/_journal.json"), "utf8"))
    .entries.filter((e) => e.when <= 1787500000000)
    .map((e) => e.tag);
  buildFolderThrough(tags0017, through0017);

  const only0024 = path.join(tmp, "only-0024");
  buildFolderThrough(["0024_citation_target_classification"], only0024);

  // --- A: Staging-shaped baseline → full migrate through tip ---
  const a = `nyaya_wp06c_a_${stamp}`;
  dbs.push(a);
  await resetDb(a);
  migrate(a, through0017);
  // Apply 0024 SQL + journal row to mimic staging hole (skip 0018–0023)
  await withDb(a, async (sql) => {
    const sql0024 = fs.readFileSync(
      path.join(DRIZZLE, "0024_citation_target_classification.sql"),
      "utf8",
    );
    for (const part of sql0024.split("--> statement-breakpoint")) {
      const s = part.trim();
      if (s) await sql.unsafe(s);
    }
    const hash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(DRIZZLE, "0024_citation_target_classification.sql")))
      .digest("hex");
    await sql`
      insert into drizzle.__drizzle_migrations (hash, created_at)
      values (${hash}, ${1788200000000})
    `;
    const j =
      await sql`select count(*)::int as n, max(created_at) as mx from drizzle.__drizzle_migrations`;
    if (j[0].n !== 19) throw new Error(`expected 19 journal rows, got ${j[0].n}`);
    if (String(j[0].mx) !== "1788200000000") throw new Error(`bad max when ${j[0].mx}`);
    const cc = await sql`select to_regclass('public.criminal_cases') as r`;
    if (cc[0].r) throw new Error("precondition: criminal_cases should be absent");
  });

  // Seed product-ish rows before migrate
  const seed = await withDb(a, async (sql) => {
    const [user] = await sql`
      insert into users (auth_subject, email, name)
      values (${`w6c_${stamp}`}, ${`w6c_${stamp}@example.nyayagrid.local`}, 'w6c')
      returning id
    `;
    const [org] = await sql`
      insert into organizations (name, slug, type)
      values (${`W6C ${stamp}`}, ${`w6c-${stamp}`}, 'firm')
      returning id
    `;
    const [client] = await sql`
      insert into clients (organization_id, client_type, display_name, created_by_user_id)
      values (${org.id}, 'individual', 'Preserve Client', ${user.id})
      returning id
    `;
    const [matter] = await sql`
      insert into matters (organization_id, client_id, matter_number, title, created_by_user_id)
      values (${org.id}, ${client.id}, ${`W6C-${stamp}`}, 'preserve matter', ${user.id})
      returning id
    `;
    return { userId: user.id, orgId: org.id, clientId: client.id, matterId: matter.id };
  });

  migrate(a); // applies 0034 then 0025–0033
  await withDb(a, async (sql) => {
    await assertMainProductContract(sql);
    const org = await sql`select id from organizations where id=${seed.orgId}`;
    const matter = await sql`select id, title from matters where id=${seed.matterId}`;
    const client = await sql`select id from clients where id=${seed.clientId}`;
    if (!org.length || !matter.length || !client.length) throw new Error("data loss after migrate");
    if (matter[0].title !== "preserve matter") throw new Error("matter title changed");
    const journal = await sql`
      select created_at from drizzle.__drizzle_migrations order by created_at
    `;
    const whens = journal.map((r) => String(r.created_at));
    if (!whens.includes("1788250000000")) throw new Error("0034 when missing");
    if (!whens.includes("1789100000000")) throw new Error("0033 when missing");
    // collision millis for Deepening should now be present via main tags (expected)
    if (!whens.includes("1788300000000")) throw new Error("0025 when missing");
  });
  record(
    "A_staging_baseline_to_0033",
    true,
    "0034 repaired hole; product contract; seed preserved",
  );

  // --- B: Retry idempotent ---
  const before = await withDb(a, async (sql) => {
    const rows = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
    return rows[0].n;
  });
  migrate(a);
  await withDb(a, async (sql) => {
    const after = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
    if (after[0].n !== before) throw new Error(`journal grew on retry ${before}->${after[0].n}`);
    await assertMainProductContract(sql);
  });
  record("B_retry_idempotent", true, `retry no-op journal_count=${before}`);

  // --- C: Without 0034, migrate from staging baseline must fail (fail-closed evidence) ---
  const c = `nyaya_wp06c_c_${stamp}`;
  dbs.push(c);
  await resetDb(c);
  const no0034 = path.join(tmp, "no-0034");
  fs.mkdirSync(path.join(no0034, "meta"), { recursive: true });
  const fullJournal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, "meta/_journal.json"), "utf8"));
  fullJournal.entries = fullJournal.entries.filter(
    (e) => e.tag !== "0034_repair_skipped_week3_through_0023",
  );
  fs.writeFileSync(path.join(no0034, "meta/_journal.json"), JSON.stringify(fullJournal, null, 2));
  for (const e of fullJournal.entries) {
    fs.copyFileSync(path.join(DRIZZLE, `${e.tag}.sql`), path.join(no0034, `${e.tag}.sql`));
  }
  migrate(c, through0017);
  await withDb(c, async (sql) => {
    const sql0024 = fs.readFileSync(
      path.join(DRIZZLE, "0024_citation_target_classification.sql"),
      "utf8",
    );
    for (const part of sql0024.split("--> statement-breakpoint")) {
      const s = part.trim();
      if (s) await sql.unsafe(s);
    }
    const hash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(DRIZZLE, "0024_citation_target_classification.sql")))
      .digest("hex");
    await sql`
      insert into drizzle.__drizzle_migrations (hash, created_at)
      values (${hash}, ${1788200000000})
    `;
  });
  let failed = false;
  try {
    migrate(c, no0034);
  } catch {
    failed = true;
  }
  if (!failed) throw new Error("expected migrate without 0034 to fail on missing criminal_cases");
  record("C_without_0034_fail_closed", true, "0025 fails without week3 repair");

  // cleanup A as well (already migrated)
  dbs.push(a);
  for (const name of [...new Set(dbs)]) {
    await withAdmin(async (sql) => {
      await sql.unsafe(`DROP DATABASE IF EXISTS ${name}`);
    });
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(
    JSON.stringify({ ok: true, classification: "NYAYAGRID_WP06C_MATRIX", results }, null, 2),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
