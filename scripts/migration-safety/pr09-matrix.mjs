/**
 * PR #9 disposable migration acceptance matrix (localhost Docker only).
 * States A–G: fresh, retry, journaled-stub repair, populated legacy, partial repair,
 * cross-case/office rejection, retry/interruption.
 */
import postgres from "postgres";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import fs from "node:fs";
import {
  assertGraphSchemaContract,
  snapshotGraphCatalog,
  diffCatalog,
} from "./graph-schema-contract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ADMIN_URL = "postgresql://nyayagrid:nyayagrid@localhost:5433/postgres";
const results = [];

function dbUrl(name) {
  return `postgresql://nyayagrid:nyayagrid@localhost:5433/${name}`;
}

function migrate(name) {
  const tsxCli = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  execFileSync(process.execPath, [tsxCli, "packages/database/src/migrate.ts"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: dbUrl(name), APP_ENV: "development" },
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

async function columnExists(sql, table, column) {
  const rows = await sql`
    select 1 from information_schema.columns
    where table_schema='public' and table_name=${table} and column_name=${column}
  `;
  return rows.length === 1;
}

async function assertBillingShape(sql) {
  for (const [t, c] of [
    ["time_entries", "billable"],
    ["time_entries", "hourly_rate_cents"],
    ["invoices", "total_minutes"],
    ["invoices", "total_cents"],
    ["invoice_line_items", "amount_cents"],
  ]) {
    if (!(await columnExists(sql, t, c))) throw new Error(`missing ${t}.${c}`);
  }
}

async function assertContactsShape(sql) {
  for (const t of ["contacts", "client_contacts", "document_folders"]) {
    const rows = await sql`
      select 1 from information_schema.tables
      where table_schema='public' and table_name=${t}
    `;
    if (!rows.length) throw new Error(`missing table ${t}`);
  }
  const folderFk = await sql`
    select 1 from pg_constraint where conname = 'document_folders_matter_org_fk'
  `;
  if (!folderFk.length) throw new Error("missing document_folders_matter_org_fk");
  const contactFk = await sql`
    select 1 from pg_constraint where conname = 'client_contacts_contact_org_fk'
  `;
  if (!contactFk.length) throw new Error("missing client_contacts_contact_org_fk");
}

async function seedOrgMatter(sql, suffix) {
  const [user] = await sql`
    insert into users (auth_subject, email, name)
    values (${`mx_${suffix}`}, ${`mx_${suffix}@example.nyayagrid.local`}, 'mx')
    returning id
  `;
  const [org] = await sql`
    insert into organizations (name, slug, type)
    values (${`MX ${suffix}`}, ${`mx-${suffix}`}, 'firm')
    returning id
  `;
  try {
    const [role] = await sql`
      insert into roles (organization_id, key, name, is_system)
      values (${org.id}, 'owner', 'Owner', true)
      returning id
    `;
    await sql`
      insert into memberships (organization_id, user_id, role_id, status)
      values (${org.id}, ${user.id}, ${role.id}, 'active')
    `;
  } catch {
    /* optional */
  }
  const [client] = await sql`
    insert into clients (organization_id, client_type, display_name, created_by_user_id)
    values (${org.id}, 'individual', ${`Client ${suffix}`}, ${user.id})
    returning id
  `;
  const [matter] = await sql`
    insert into matters (organization_id, client_id, matter_number, title, created_by_user_id)
    values (${org.id}, ${client.id}, ${`MX-${suffix}`}, 'matrix matter', ${user.id})
    returning id
  `;
  return { user, org, client, matter };
}

async function insertCase(sql, orgId, caseNumber) {
  const [cc] = await sql`
    insert into criminal_cases (organization_id, case_number, jurisdiction, court)
    values (${orgId}, ${caseNumber}, 'PA', 'st-pa-trial')
    returning id
  `;
  return cc;
}

async function insertNode(sql, { orgId, caseId, kind, entityId, name, status = "approved" }) {
  const [n] = await sql`
    insert into prosecution_graph_nodes (
      organization_id, criminal_case_id, node_kind, canonical_entity_type,
      canonical_entity_id, display_name, provenance, origin, status
    ) values (
      ${orgId}, ${caseId}, ${kind}, ${kind}, ${entityId}, ${name},
      ${sql.json({ extractionOrigin: "human", humanEntered: true })},
      'manual', ${status}
    )
    returning id
  `;
  return n;
}

function recreateStubGraphSql() {
  return `
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
  `;
}

async function main() {
  const stamp = Date.now().toString(36);
  const dbs = [];

  // --- A: Fresh schema + contract ---
  const a = `nyaya_pr09_a_${stamp}`;
  dbs.push(a);
  await resetDb(a);
  migrate(a);
  const cleanSnap = await withDb(a, async (sql) => {
    await assertBillingShape(sql);
    await assertContactsShape(sql);
    const contract = await assertGraphSchemaContract(sql);
    return { contract, snap: await snapshotGraphCatalog(sql) };
  });
  record("A_fresh", true, `contract ok constraints≈${cleanSnap.contract.constraints}`);

  // --- B: Fully migrated retry ---
  const b = `nyaya_pr09_b_${stamp}`;
  dbs.push(b);
  await resetDb(b);
  migrate(b);
  const before = await withDb(b, async (sql) => {
    const rows = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
    return rows[0].n;
  });
  migrate(b);
  await withDb(b, async (sql) => {
    const after = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
    if (after[0].n !== before) throw new Error(`journal grew on retry ${before}->${after[0].n}`);
    await assertGraphSchemaContract(sql);
  });
  record("B_fully_migrated_retry", true, `retry no-op journal_count=${before}`);

  // --- C: Journaled 0026/0030 while stub remains; repair via 0031/0032 ---
  const c = `nyaya_pr09_c_${stamp}`;
  dbs.push(c);
  await resetDb(c);
  migrate(c);
  await withDb(c, async (sql) => {
    await sql.unsafe(recreateStubGraphSql());
    // Keep journal claiming 0026–0032 applied; delete 0031+0032 so re-migrate repairs
    await sql`delete from drizzle.__drizzle_migrations where created_at >= 1788900000000`;
  });
  migrate(c);
  const repairedSnap = await withDb(c, async (sql) => {
    await assertGraphSchemaContract(sql);
    const snap = await snapshotGraphCatalog(sql);
    const d = diffCatalog(cleanSnap.snap, snap);
    const unresolved = [
      ...d.columns.onlyA,
      ...d.columns.onlyB,
      ...d.constraints.onlyA,
      ...d.constraints.onlyB,
      ...d.indexes.onlyA,
      ...d.indexes.onlyB,
    ];
    if (unresolved.length) {
      throw new Error(`clean vs repaired parity gap: ${unresolved.slice(0, 8).join(" | ")}`);
    }
    return snap;
  });
  record("C_journaled_stub_repaired", true, "0031/0032 restored full contract; parity with clean");

  // --- D: Populated legacy graph (valid/invalid/cross refs) ---
  const d = `nyaya_pr09_d_${stamp}`;
  dbs.push(d);
  await resetDb(d);
  migrate(d);
  const legacyCounts = await withDb(d, async (sql) => {
    await sql.unsafe(recreateStubGraphSql());
    const ctx1 = await seedOrgMatter(sql, `d1${stamp}`);
    const ctx2 = await seedOrgMatter(sql, `d2${stamp}`);
    const case1 = await insertCase(sql, ctx1.org.id, `D1-${stamp}`);
    const case2 = await insertCase(sql, ctx1.org.id, `D1b-${stamp}`);
    const caseOther = await insertCase(sql, ctx2.org.id, `D2-${stamp}`);
    const validRef = crypto.randomUUID();
    const validNodeId = crypto.randomUUID();
    const badRefNodeId = crypto.randomUUID();
    const edgeId = crypto.randomUUID();
    await sql`
      insert into prosecution_graph_nodes (id, organization_id, criminal_case_id, node_type, ref_id, provenance)
      values
        (${validNodeId}, ${ctx1.org.id}, ${case1.id}, 'evidence', ${validRef}, ${sql.json({ k: 1 })}),
        (${badRefNodeId}, ${ctx1.org.id}, ${case1.id}, 'witness', 'not-a-uuid', ${sql.json({ k: 2 })}),
        (${crypto.randomUUID()}, ${ctx1.org.id}, ${case2.id}, 'charge', ${crypto.randomUUID()}, ${sql.json({ k: 3 })}),
        (${crypto.randomUUID()}, ${ctx2.org.id}, ${caseOther.id}, 'defendant', ${crypto.randomUUID()}, ${sql.json({ k: 4 })})
    `;
    await sql`
      insert into prosecution_graph_edges (id, organization_id, criminal_case_id, from_ref, to_ref, relationship, provenance)
      values
        (${edgeId}, ${ctx1.org.id}, ${case1.id}, ${validRef}, 'missing-endpoint', 'related_to', ${sql.json({ e: 1 })}),
        (${crypto.randomUUID()}, ${ctx1.org.id}, ${case1.id}, 'ghost', 'ghost2', 'related_to', ${sql.json({ e: 2 })})
    `;
    const nodeArchBefore = await sql`select count(*)::int as n from prosecution_graph_nodes`;
    const edgeArchBefore = await sql`select count(*)::int as n from prosecution_graph_edges`;
    await sql`delete from drizzle.__drizzle_migrations where created_at >= 1788900000000`;
    return {
      nodeArchBefore: nodeArchBefore[0].n,
      edgeArchBefore: edgeArchBefore[0].n,
      validNodeId,
      badRefNodeId,
    };
  });
  migrate(d);
  await withDb(d, async (sql) => {
    await assertGraphSchemaContract(sql);
    const archN = await sql`select count(*)::int as n from prosecution_graph_nodes_0018_archive`;
    const archE = await sql`select count(*)::int as n from prosecution_graph_edges_0018_archive`;
    if (archN[0].n !== legacyCounts.nodeArchBefore) {
      throw new Error(`node archive incomplete ${archN[0].n}!=${legacyCounts.nodeArchBefore}`);
    }
    if (archE[0].n !== legacyCounts.edgeArchBefore) {
      throw new Error(`edge archive incomplete ${archE[0].n}!=${legacyCounts.edgeArchBefore}`);
    }
    const badStillArchived = await sql`
      select ref_id from prosecution_graph_nodes_0018_archive where id = ${legacyCounts.badRefNodeId}
    `;
    if (!badStillArchived.length || badStillArchived[0].ref_id !== "not-a-uuid") {
      throw new Error("malformed ref not preserved in archive");
    }
    const projected = await sql`
      select id, status, origin from prosecution_graph_nodes where origin = 'projection'
    `;
    for (const row of projected) {
      if (row.status !== "proposed") throw new Error(`projection not proposed: ${row.status}`);
    }
    const badProjected = projected.some((r) => r.id === legacyCounts.badRefNodeId);
    if (badProjected) throw new Error("non-UUID legacy node must not project");
  });
  record(
    "D_populated_legacy",
    true,
    `archives nodes=${legacyCounts.nodeArchBefore} edges=${legacyCounts.edgeArchBefore}; proposed-only projections`,
  );

  // --- E: Partially repaired bare schema (missing constraints) ---
  const e = `nyaya_pr09_e_${stamp}`;
  dbs.push(e);
  await resetDb(e);
  migrate(e);
  await withDb(e, async (sql) => {
    // Simulate broken 0031 shells: drop constraints that 0032 must restore
    await sql.unsafe(`
      ALTER TABLE prosecution_graph_edges DROP CONSTRAINT IF EXISTS prosecution_graph_edges_from_case_fk;
      ALTER TABLE prosecution_graph_edges DROP CONSTRAINT IF EXISTS prosecution_graph_edges_to_case_fk;
      ALTER TABLE prosecution_graph_edges DROP CONSTRAINT IF EXISTS prosecution_graph_edges_from_org_fk;
      ALTER TABLE prosecution_graph_edges DROP CONSTRAINT IF EXISTS prosecution_graph_edges_to_org_fk;
      ALTER TABLE prosecution_graph_edges DROP CONSTRAINT IF EXISTS prosecution_graph_edges_case_org_fk;
      ALTER TABLE prosecution_graph_nodes DROP CONSTRAINT IF EXISTS prosecution_graph_nodes_case_org_fk;
      ALTER TABLE prosecution_graph_edges DROP CONSTRAINT IF EXISTS prosecution_graph_edges_confidence_chk;
      ALTER TABLE prosecution_graph_nodes DROP CONSTRAINT IF EXISTS prosecution_graph_nodes_kind_chk;
    `);
    // Clear 0032 and any later reconciliation tags (0033+) so remigrate re-applies integrity.
    await sql`delete from drizzle.__drizzle_migrations where created_at >= 1789000000000`;
  });
  migrate(e);
  await withDb(e, async (sql) => {
    await assertGraphSchemaContract(sql);
  });
  record("E_partial_repaired", true, "0032/0033 restored dropped constraints; contract pass");

  // --- F: Cross-case / cross-office / invalid enum rejection ---
  const f = `nyaya_pr09_f_${stamp}`;
  dbs.push(f);
  await resetDb(f);
  migrate(f);
  await withDb(f, async (sql) => {
    await assertGraphSchemaContract(sql);
    const officeA = await seedOrgMatter(sql, `fa${stamp}`);
    const officeB = await seedOrgMatter(sql, `fb${stamp}`);
    const caseA1 = await insertCase(sql, officeA.org.id, `FA1-${stamp}`);
    const caseA2 = await insertCase(sql, officeA.org.id, `FA2-${stamp}`);
    const caseB = await insertCase(sql, officeB.org.id, `FB-${stamp}`);
    const ent1 = crypto.randomUUID();
    const ent2 = crypto.randomUUID();
    const ent3 = crypto.randomUUID();
    const nA1 = await insertNode(sql, {
      orgId: officeA.org.id,
      caseId: caseA1.id,
      kind: "evidence",
      entityId: ent1,
      name: "A1 evidence",
    });
    const nA2 = await insertNode(sql, {
      orgId: officeA.org.id,
      caseId: caseA2.id,
      kind: "witness",
      entityId: ent2,
      name: "A2 witness",
    });
    const nB = await insertNode(sql, {
      orgId: officeB.org.id,
      caseId: caseB.id,
      kind: "defendant",
      entityId: ent3,
      name: "B defendant",
    });

    async function expectReject(label, fn) {
      let rejected = false;
      try {
        await fn();
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error(`expected reject: ${label}`);
    }

    await expectReject(
      "cross-case edge",
      () =>
        sql`
        insert into prosecution_graph_edges (
          organization_id, criminal_case_id, from_node_id, to_node_id,
          relationship_type, provenance, origin, status
        ) values (
          ${officeA.org.id}, ${caseA1.id}, ${nA1.id}, ${nA2.id},
          'related_to', ${sql.json({ t: 1 })}, 'manual', 'proposed'
        )
      `,
    );

    await expectReject(
      "cross-office edge",
      () =>
        sql`
        insert into prosecution_graph_edges (
          organization_id, criminal_case_id, from_node_id, to_node_id,
          relationship_type, provenance, origin, status
        ) values (
          ${officeA.org.id}, ${caseA1.id}, ${nA1.id}, ${nB.id},
          'related_to', ${sql.json({ t: 2 })}, 'manual', 'proposed'
        )
      `,
    );

    await expectReject(
      "nonexistent actor",
      () =>
        sql`
        insert into prosecution_graph_edges (
          organization_id, criminal_case_id, from_node_id, to_node_id,
          relationship_type, provenance, origin, status, created_by_user_id
        ) values (
          ${officeA.org.id}, ${caseA1.id}, ${nA1.id}, ${nA1.id},
          'related_to', ${sql.json({ t: 3 })}, 'manual', 'proposed',
          ${crypto.randomUUID()}
        )
      `,
    );

    await expectReject(
      "invalid status",
      () =>
        sql`
        insert into prosecution_graph_edges (
          organization_id, criminal_case_id, from_node_id, to_node_id,
          relationship_type, provenance, origin, status
        ) values (
          ${officeA.org.id}, ${caseA1.id}, ${nA1.id}, ${nA1.id},
          'related_to', ${sql.json({ t: 4 })}, 'manual', 'verified_fact'
        )
      `,
    );

    await expectReject(
      "invalid origin",
      () =>
        sql`
        insert into prosecution_graph_nodes (
          organization_id, criminal_case_id, node_kind, canonical_entity_type,
          canonical_entity_id, display_name, provenance, origin, status
        ) values (
          ${officeA.org.id}, ${caseA1.id}, 'evidence', 'evidence', ${crypto.randomUUID()},
          'bad origin', ${sql.json({ t: 5 })}, 'imported', 'proposed'
        )
      `,
    );

    await expectReject(
      "invalid node_kind",
      () =>
        sql`
        insert into prosecution_graph_nodes (
          organization_id, criminal_case_id, node_kind, canonical_entity_type,
          canonical_entity_id, display_name, provenance, origin, status
        ) values (
          ${officeA.org.id}, ${caseA1.id}, 'jury', 'jury', ${crypto.randomUUID()},
          'bad kind', ${sql.json({ t: 6 })}, 'manual', 'proposed'
        )
      `,
    );

    // Same-case edge must succeed
    await sql`
      insert into prosecution_graph_edges (
        organization_id, criminal_case_id, from_node_id, to_node_id,
        relationship_type, provenance, origin, status
      ) values (
        ${officeA.org.id}, ${caseA1.id}, ${nA1.id}, ${nA1.id},
        'related_to', ${sql.json({ t: 7 })}, 'manual', 'proposed'
      )
    `;
  });
  record(
    "F_cross_isolation_rejects",
    true,
    "DB rejected cross-case/office/invalid enum/actor inserts",
  );

  // --- G: Retry + archive rename (no overwrite) ---
  const g = `nyaya_pr09_g_${stamp}`;
  dbs.push(g);
  await resetDb(g);
  migrate(g);
  await withDb(g, async (sql) => {
    await sql.unsafe(recreateStubGraphSql());
    const ctx = await seedOrgMatter(sql, `g${stamp}`);
    const cc = await insertCase(sql, ctx.org.id, `G-${stamp}`);
    const nodeId = crypto.randomUUID();
    const refId = crypto.randomUUID();
    await sql`
      insert into prosecution_graph_nodes (id, organization_id, criminal_case_id, node_type, ref_id, provenance)
      values (${nodeId}, ${ctx.org.id}, ${cc.id}, 'evidence', ${refId}, ${sql.json({ humanEntered: true })})
    `;
    // Prior archive (from 0026 or earlier) must be renamed by 0031, not overwritten.
    // Ensure a marker row exists in whatever archive table is present.
    const archExists =
      await sql`select to_regclass('public.prosecution_graph_nodes_0018_archive') as r`;
    if (!archExists[0].r) {
      await sql.unsafe(`
        CREATE TABLE prosecution_graph_nodes_0018_archive (
          id uuid NOT NULL,
          organization_id uuid NOT NULL,
          criminal_case_id uuid NOT NULL,
          node_type text NOT NULL,
          ref_id text NOT NULL,
          provenance jsonb NOT NULL,
          created_at timestamptz NOT NULL
        );
      `);
    }
    await sql`
      insert into prosecution_graph_nodes_0018_archive (
        id, organization_id, criminal_case_id, node_type, ref_id, provenance, created_at
      ) values (
        ${crypto.randomUUID()}, ${ctx.org.id}, ${cc.id}, 'other', 'prior-archive-marker',
        ${sql.json({ prior: true })}, now()
      )
    `;
    await sql`delete from drizzle.__drizzle_migrations where created_at >= 1788900000000`;
  });
  migrate(g);
  migrate(g); // retry
  await withDb(g, async (sql) => {
    await assertGraphSchemaContract(sql);
    const renamed = await sql`
      select tablename from pg_tables
      where schemaname='public' and tablename like 'prosecution_graph_nodes_0018_archive_%'
      order by tablename desc
    `;
    if (!renamed.length) throw new Error("prior archive was not renamed before rewrite");
    // Quote identifier safely
    const table = renamed[0].tablename;
    if (!/^prosecution_graph_nodes_0018_archive_\d+$/.test(table)) {
      throw new Error(`unexpected renamed archive name: ${table}`);
    }
    const marker = await sql.unsafe(
      `select 1 from "${table}" where ref_id = 'prior-archive-marker'`,
    );
    if (!marker.length) throw new Error("prior archive contents lost");
    const latest = await sql`select count(*)::int as n from prosecution_graph_nodes_0018_archive`;
    if (latest[0].n < 1) throw new Error("latest archive empty");
    const projected = await sql`
      select status from prosecution_graph_nodes where origin='projection'
    `;
    for (const row of projected) {
      if (row.status !== "proposed") throw new Error("retry projected non-proposed");
    }
    const dup = await sql`
      select id, count(*)::int as n from prosecution_graph_nodes group by id having count(*) > 1
    `;
    if (dup.length) throw new Error("duplicate projections after retry");
  });
  record("G_retry_archive_safe", true, "prior archive renamed; no overwrite; retry idempotent");

  for (const name of dbs) {
    await withAdmin(async (sql) => {
      await sql.unsafe(`DROP DATABASE IF EXISTS ${name}`);
    });
  }

  console.log(JSON.stringify({ ok: true, results, cleanVsRepaired: "parity" }, null, 2));
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
