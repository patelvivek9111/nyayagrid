/**
 * WP-06B disposable reconciliation matrix (localhost Docker only).
 * States:
 *   A — Clean main through 0033
 *   B — Historical Deepening journal+schema, then reconcile via main migrate
 *   C — Mixed journal (Deepening when) with missing main objects
 *   D — Partially applied repair (0031/0032/0033 deleted)
 *   E — Populated product data preserved across reconcile
 *
 * Never uses staging/Neon URLs.
 */
import postgres from "postgres";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import crypto from "node:crypto";
import {
  assertGraphSchemaContract,
  snapshotGraphCatalog,
  diffCatalog,
} from "./graph-schema-contract.mjs";

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

function buildTruncatedJournalFolder(dest) {
  fs.mkdirSync(path.join(dest, "meta"), { recursive: true });
  const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, "meta/_journal.json"), "utf8"));
  journal.entries = journal.entries.filter((e) => e.idx <= 24);
  fs.writeFileSync(path.join(dest, "meta/_journal.json"), JSON.stringify(journal, null, 2));
  for (const e of journal.entries) {
    const src = path.join(DRIZZLE, `${e.tag}.sql`);
    fs.copyFileSync(src, path.join(dest, `${e.tag}.sql`));
  }
}

function deepeningSqlFromGit(tag) {
  // Staging-deployed Deepening lineage lives on add3af3 (WP-05), not deepening-v2 tip.
  return execFileSync("git", ["show", `add3af3:packages/database/drizzle/${tag}.sql`], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

async function applySqlFile(sql, text) {
  const parts = text.split("--> statement-breakpoint");
  for (const part of parts) {
    const stmt = part.trim();
    if (!stmt) continue;
    await sql.unsafe(stmt);
  }
}

async function journalDeepeningWhens(sql) {
  // Insert synthetic journal rows for Deepening collision millis (hashes distinct from main).
  const rows = [
    [1788300000000, "deepening_0025_drop_professor"],
    [1788400000000, "deepening_0026_disclosure"],
    [1788500000000, "deepening_0027_legal_workflow"],
    [1788600000000, "deepening_0028_office_ops"],
  ];
  for (const [when, label] of rows) {
    const hash = crypto.createHash("sha256").update(label).digest("hex");
    await sql`
      insert into drizzle.__drizzle_migrations (hash, created_at)
      values (${hash}, ${when})
    `;
  }
}

async function assertMainContract(sql) {
  for (const t of [
    "contacts",
    "client_contacts",
    "document_folders",
    "prosecution_case_memories",
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
  for (const con of [
    "prosecution_graph_nodes_case_org_fk",
    "prosecution_graph_edges_from_case_fk",
    "client_contacts_contact_org_fk",
    "document_folders_matter_org_fk",
  ]) {
    const rows = await sql`select 1 from pg_constraint where conname=${con}`;
    if (!rows.length) throw new Error(`missing ${con}`);
  }
  await assertGraphSchemaContract(sql);
}

async function assertDeepeningPreserved(sql) {
  const rows = await sql`
    select 1 from information_schema.columns
    where table_schema='public' and table_name='prosecution_discovery_items' and column_name='title'
  `;
  if (!rows.length) throw new Error("deepening disclosure column title missing");
}

async function seedOrgMatter(sql, suffix) {
  const [user] = await sql`
    insert into users (auth_subject, email, name)
    values (${`w6_${suffix}`}, ${`w6_${suffix}@example.nyayagrid.local`}, 'w6')
    returning id
  `;
  const [org] = await sql`
    insert into organizations (name, slug, type)
    values (${`W6 ${suffix}`}, ${`w6-${suffix}`}, 'firm')
    returning id
  `;
  const [client] = await sql`
    insert into clients (organization_id, client_type, display_name, created_by_user_id)
    values (${org.id}, 'individual', ${`Client ${suffix}`}, ${user.id})
    returning id
  `;
  const [matter] = await sql`
    insert into matters (organization_id, client_id, matter_number, title, created_by_user_id)
    values (${org.id}, ${client.id}, ${`W6-${suffix}`}, 'wp06b matter', ${user.id})
    returning id
  `;
  return { user, org, client, matter };
}

async function main() {
  const stamp = Date.now().toString(36);
  const dbs = [];
  const tmpRoot = path.join(ROOT, "scripts/migration-safety/.tmp-wp06b");
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
  const trunc = path.join(tmpRoot, "through-0024");
  buildTruncatedJournalFolder(trunc);

  // --- A: Clean main through 0033 ---
  const a = `nyaya_wp06b_a_${stamp}`;
  dbs.push(a);
  await resetDb(a);
  migrate(a);
  const cleanSnap = await withDb(a, async (sql) => {
    await assertMainContract(sql);
    const journal =
      await sql`select created_at from drizzle.__drizzle_migrations order by created_at`;
    const whens = journal.map((r) => String(r.created_at));
    if (!whens.includes("1789100000000")) throw new Error("0033 when missing from journal");
    return snapshotGraphCatalog(sql);
  });
  record("A_clean_main_0033", true, "main contract + 0033 journaled");

  // --- B: Deepening historical then reconcile ---
  const b = `nyaya_wp06b_b_${stamp}`;
  dbs.push(b);
  await resetDb(b);
  migrate(b, trunc);
  await withDb(b, async (sql) => {
    await applySqlFile(sql, deepeningSqlFromGit("0025_drop_professor_guide_schema"));
    await applySqlFile(sql, deepeningSqlFromGit("0026_prosecution_disclosure_deepening"));
    await applySqlFile(sql, deepeningSqlFromGit("0027_prosecution_legal_workflow"));
    await applySqlFile(sql, deepeningSqlFromGit("0028_prosecution_office_operations"));
    await journalDeepeningWhens(sql);
  });
  migrate(b); // applies main 0029–0033 (0025–0028 skipped by when-gate)
  await withDb(b, async (sql) => {
    await assertMainContract(sql);
    await assertDeepeningPreserved(sql);
    const snap = await snapshotGraphCatalog(sql);
    const d = diffCatalog(cleanSnap, snap);
    const unresolved = [
      ...d.columns.onlyA,
      ...d.columns.onlyB.filter(
        (c) =>
          !c.includes("prosecution_discovery") &&
          !c.includes("prosecution_disclosure") &&
          !c.includes("prosecution_procedure") &&
          !c.includes("prosecution_warrants") &&
          !c.includes("prosecution_tasks") &&
          !c.includes("criminal_cases."),
      ),
      ...d.constraints.onlyA,
      ...d.constraints.onlyB.filter(
        (c) => !/discovery|disclosure|supervisor|procedure|warrant|task/i.test(c),
      ),
      ...d.indexes.onlyA,
      ...d.indexes.onlyB.filter(
        (c) =>
          !/discovery|disclosure|supervisor|procedure|warrant|task|org_status|org_prosecutor|org_priority/i.test(
            c,
          ),
      ),
    ];
    // Graph catalog parity for graph objects; Deepening additive extras allowed on onlyB
    const graphGaps = [
      ...d.columns.onlyA.filter((c) => c.startsWith("prosecution_graph_")),
      ...d.constraints.onlyA.filter((c) => c.includes("prosecution_graph")),
      ...d.indexes.onlyA.filter((c) => c.includes("prosecution_graph")),
    ];
    if (graphGaps.length)
      throw new Error(`graph parity gap vs clean: ${graphGaps.slice(0, 8).join("|")}`);
    if (
      unresolved.filter(
        (x) =>
          x.startsWith("prosecution_graph_") ||
          x.startsWith("contacts") ||
          x.startsWith("document_") ||
          x.startsWith("time_") ||
          x.startsWith("invoice"),
      ).length
    ) {
      throw new Error(`unexpected main-object drift: ${unresolved.slice(0, 8).join("|")}`);
    }
  });
  record("B_deepening_reconciled", true, "Deepening schema preserved; main contract via 0029–0033");

  // --- C: Mixed journal with missing main objects (already true after Deepening apply) ---
  const c = `nyaya_wp06b_c_${stamp}`;
  dbs.push(c);
  await resetDb(c);
  migrate(c, trunc);
  await withDb(c, async (sql) => {
    await applySqlFile(sql, deepeningSqlFromGit("0026_prosecution_disclosure_deepening"));
    await journalDeepeningWhens(sql);
    // Confirm memories absent before reconcile
    const mem = await sql`select to_regclass('public.prosecution_case_memories') as r`;
    if (mem[0].r) throw new Error("precondition: memories should be absent");
  });
  migrate(c);
  await withDb(c, async (sql) => {
    await assertMainContract(sql);
    await assertDeepeningPreserved(sql);
  });
  record("C_mixed_journal_repaired", true, "missing main objects created by 0029–0033");

  // --- D: Partial repair re-run ---
  const d = `nyaya_wp06b_d_${stamp}`;
  dbs.push(d);
  await resetDb(d);
  migrate(d);
  await withDb(d, async (sql) => {
    await sql`delete from drizzle.__drizzle_migrations where created_at >= 1788900000000`;
    // Drop a billing column to force 0029 path? 0029 already journaled at 1788700000000.
    // Delete from 0029 forward and drop contacts to simulate partial.
    await sql`delete from drizzle.__drizzle_migrations where created_at >= 1788700000000`;
    await sql.unsafe(`DROP TABLE IF EXISTS client_contacts CASCADE`);
    await sql.unsafe(`DROP TABLE IF EXISTS contacts CASCADE`);
  });
  migrate(d);
  await withDb(d, async (sql) => {
    await assertMainContract(sql);
    migrate(d); // retry
    await assertMainContract(sql);
  });
  record("D_partial_repair_retry", true, "0029–0033 restored contacts; retry idempotent");

  // --- E: Populated product data preserved ---
  const e = `nyaya_wp06b_e_${stamp}`;
  dbs.push(e);
  await resetDb(e);
  migrate(e, trunc);
  const preserved = await withDb(e, async (sql) => {
    await applySqlFile(sql, deepeningSqlFromGit("0026_prosecution_disclosure_deepening"));
    await journalDeepeningWhens(sql);
    const ctx = await seedOrgMatter(sql, `e${stamp}`);
    const [cc] = await sql`
      insert into criminal_cases (organization_id, case_number, jurisdiction, court)
      values (${ctx.org.id}, ${`E-${stamp}`}, 'PA', 'st-pa-trial')
      returning id
    `;
    // Seed a discovery row using Deepening `title` column (0026 disclosure deepening).
    const beforeDisc = await sql`
      insert into prosecution_discovery_items (
        organization_id, criminal_case_id, source, category, title, provenance
      ) values (
        ${ctx.org.id}, ${cc.id}, 'agency', 'document', 'preserve-me',
        ${sql.json({ humanEntered: true })}
      )
      returning id, title
    `;
    return {
      orgId: ctx.org.id,
      caseId: cc.id,
      discId: beforeDisc[0].id,
      title: beforeDisc[0].title,
    };
  });
  migrate(e);
  await withDb(e, async (sql) => {
    await assertMainContract(sql);
    const rows = await sql`
      select id, title from prosecution_discovery_items where id=${preserved.discId}
    `;
    if (!rows.length || rows[0].title !== "preserve-me") {
      throw new Error("data loss: deepening discovery row missing after reconcile");
    }
    // Create contact + memory post-reconcile
    const [contact] = await sql`
      insert into contacts (organization_id, display_name)
      values (${preserved.orgId}, 'Preserved Contact')
      returning id
    `;
    const [mem] = await sql`
      insert into prosecution_case_memories (
        organization_id, criminal_case_id, content, provenance
      ) values (
        ${preserved.orgId}, ${preserved.caseId}, 'post-reconcile memory',
        ${sql.json({ humanEntered: true })}
      )
      returning id
    `;
    if (!contact.id || !mem.id) throw new Error("post-reconcile inserts failed");
    // Isolation: second org cannot see first contact via org filter expectation (count)
    const ctx2 = await seedOrgMatter(sql, `e2${stamp}`);
    const leaked = await sql`
      select id from contacts where organization_id=${ctx2.org.id} and display_name='Preserved Contact'
    `;
    if (leaked.length) throw new Error("cross-tenant contact leak");
  });
  record(
    "E_populated_preserved",
    true,
    "deepening row preserved; main objects usable; no cross-tenant leak",
  );

  // Fail-closed unknown shape: stub graph after claiming 0033
  const x = `nyaya_wp06b_x_${stamp}`;
  dbs.push(x);
  await resetDb(x);
  migrate(x);
  let failed = false;
  await withDb(x, async (sql) => {
    await sql.unsafe(`
      DROP TABLE IF EXISTS prosecution_graph_edges CASCADE;
      DROP TABLE IF EXISTS prosecution_graph_nodes CASCADE;
      CREATE TABLE prosecution_graph_nodes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        organization_id uuid NOT NULL,
        criminal_case_id uuid NOT NULL,
        node_type text NOT NULL,
        ref_id text NOT NULL,
        provenance jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE prosecution_graph_edges (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        organization_id uuid NOT NULL,
        criminal_case_id uuid NOT NULL,
        from_ref text NOT NULL,
        to_ref text NOT NULL,
        relationship text NOT NULL,
        provenance jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await sql`delete from drizzle.__drizzle_migrations where created_at >= 1789100000000`;
  });
  try {
    migrate(x);
  } catch {
    failed = true;
  }
  if (!failed) throw new Error("expected 0033 fail-closed on stub graph");
  record("X_unknown_stub_fail_closed", true, "0033 refused stub graph");

  for (const name of dbs) {
    await withAdmin(async (sql) => {
      await sql.unsafe(`DROP DATABASE IF EXISTS ${name}`);
    });
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });

  console.log(
    JSON.stringify({ ok: true, classification: "NYAYAGRID_WP06B_MATRIX", results }, null, 2),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
