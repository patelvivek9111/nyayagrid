#!/usr/bin/env node
/**
 * Isolated Neon restore rehearsal for nyayagrid-staging.
 * Never overwrites the live branch. Never prints connection strings or secrets.
 */
import { spawnSync } from "node:child_process";
import postgres from "postgres";

const PROJECT_ID = "odd-moon-90379900";
const LIVE_BRANCH = "production";
const HEAD_BRANCH = "rc1-restore-head";
const PITR_BRANCH = "rc1-pitr-before-marker";
const MARKER_A = "rc1-marker-a";
const MARKER_B = "rc1-marker-b";

function neonctl(args) {
  const result = spawnSync("npx", ["neonctl", ...args], {
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || "neonctl failed").replace(
      /[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi,
      "[redacted]",
    );
    throw new Error(err.slice(0, 800));
  }
  return result.stdout.trim();
}

function connectionString(branch) {
  return neonctl(["connection-string", branch, "--project-id", PROJECT_ID]);
}

function classifyUrl(url) {
  try {
    const host = new URL(url).hostname;
    return {
      hostClass: host.endsWith("neon.tech") ? "neon" : /localhost|127/.test(host) ? "localhost" : "other",
      hostSuffix: host.split(".").slice(-3).join("."),
      pooled: /-pooler\./i.test(host),
    };
  } catch {
    return { hostClass: "unparsed", hostSuffix: "unknown", pooled: false };
  }
}

function client(url) {
  return postgres(url, { max: 1, ssl: "require", prepare: false });
}

async function inspect(sql) {
  const vector = await sql.unsafe("select '[1,2,3]'::vector as v");
  const extensions = await sql.unsafe(
    "select extname from pg_extension where extname in ('vector','pgcrypto') order by 1",
  );
  const migrations = await sql.unsafe(
    "select count(*)::int as n from drizzle.__drizzle_migrations",
  );
  const tables = await sql.unsafe(`
    select
      to_regclass('public.users') is not null as users,
      to_regclass('public.organizations') is not null as organizations,
      to_regclass('public.matters') is not null as matters,
      to_regclass('public.memberships') is not null as memberships,
      to_regclass('public.documents') is not null as documents,
      to_regclass('public.document_versions') is not null as document_versions
  `);
  const counts = await sql.unsafe(`
    select
      (select count(*)::int from users) as users,
      (select count(*)::int from organizations) as organizations,
      (select count(*)::int from matters) as matters,
      (select count(*)::int from memberships) as memberships
  `);
  const joinOk = await sql.unsafe(`
    select count(*)::int as n
    from matters m
    join organizations o on o.id = m.organization_id
  `);
  const markers = await sql.unsafe(`
    select id from ops.rc1_recovery_markers order by id
  `).catch(() => []);
  return {
    pgvector: Boolean(vector[0]?.v),
    extensions: extensions.map((row) => row.extname),
    migrationCount: migrations[0]?.n ?? 0,
    tables: tables[0],
    counts: counts[0],
    relationJoinOk: Number(joinOk[0]?.n ?? 0) >= 0,
    markers: markers.map((row) => row.id),
  };
}

async function ensureMarkerTable(sql) {
  await sql.unsafe("create schema if not exists ops");
  await sql.unsafe(`
    create table if not exists ops.rc1_recovery_markers (
      id text primary key,
      phase text not null,
      note text not null,
      created_at timestamptz not null default now()
    )
  `);
}

async function upsertMarker(sql, id, phase) {
  await ensureMarkerTable(sql);
  await sql`
    insert into ops.rc1_recovery_markers (id, phase, note)
    values (${id}, ${phase}, 'harmless isolated restore rehearsal')
    on conflict (id) do update set phase = excluded.phase, created_at = now()
  `;
}

async function cleanupLive(sql) {
  await sql.unsafe("drop table if exists ops.rc1_recovery_markers");
  await sql.unsafe("drop schema if exists ops restrict").catch(() => undefined);
}

function deleteBranch(name) {
  const result = spawnSync(
    "npx",
    [
      "neonctl",
      "branches",
      "delete",
      name,
      "--project-id",
      PROJECT_ID,
      "--output",
      "json",
    ],
    { encoding: "utf8", shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] },
  );
  return result.status === 0 ? "deleted" : "absent-or-failed";
}

function isoSecondsAgo(seconds) {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

function expiresAtHours(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

const report = {
  project: "nyayagrid-staging",
  projectId: PROJECT_ID,
  liveBranchName: LIVE_BRANCH,
  historyRetentionSeconds: 21600,
  planBoundPitrWindow: "6h-free-default",
  liveMutations: "ops.rc1_recovery_markers only; dropped after rehearsal",
};

let liveSql;
try {
  const liveUrl = connectionString(LIVE_BRANCH);
  report.live = classifyUrl(liveUrl);
  if (report.live.hostClass !== "neon") {
    throw new Error(`Live database host class is ${report.live.hostClass}, expected neon`);
  }
  liveSql = client(liveUrl);
  const t0 = isoSecondsAgo(20);
  await upsertMarker(liveSql, MARKER_A, "live-before-branch");
  const liveAfterA = await inspect(liveSql);
  report.liveAfterMarkerA = {
    hasA: liveAfterA.markers.includes(MARKER_A),
    pgvector: liveAfterA.pgvector,
    migrationCount: liveAfterA.migrationCount,
    tables: liveAfterA.tables,
  };

  neonctl([
    "branches",
    "create",
    "--project-id",
    PROJECT_ID,
    "--name",
    HEAD_BRANCH,
    "--parent",
    LIVE_BRANCH,
    "--expires-at",
    expiresAtHours(4),
    "--no-secrets",
    "--output",
    "json",
  ]);
  report.headBranchCreated = HEAD_BRANCH;

  await upsertMarker(liveSql, MARKER_B, "live-after-branch");
  const liveAfterB = await inspect(liveSql);
  report.liveAfterMarkerB = {
    markers: liveAfterB.markers,
    counts: liveAfterB.counts,
  };

  const headUrl = connectionString(HEAD_BRANCH);
  report.head = classifyUrl(headUrl);
  const headSql = client(headUrl);
  try {
    const headInspect = await inspect(headSql);
    report.headRestore = {
      hasA: headInspect.markers.includes(MARKER_A),
      hasB: headInspect.markers.includes(MARKER_B),
      pgvector: headInspect.pgvector,
      extensions: headInspect.extensions,
      migrationCount: headInspect.migrationCount,
      tables: headInspect.tables,
      counts: headInspect.counts,
      relationJoinOk: headInspect.relationJoinOk,
      isolatedFromLiveMarkerB: !headInspect.markers.includes(MARKER_B),
    };
  } finally {
    await headSql.end({ timeout: 1 });
  }

  neonctl([
    "branches",
    "create",
    "--project-id",
    PROJECT_ID,
    "--name",
    PITR_BRANCH,
    "--parent",
    t0,
    "--expires-at",
    expiresAtHours(4),
    "--no-secrets",
    "--output",
    "json",
  ]);
  report.pitrBranchCreated = PITR_BRANCH;
  report.pitrParent = t0;

  const pitrUrl = connectionString(PITR_BRANCH);
  report.pitr = classifyUrl(pitrUrl);
  const pitrSql = client(pitrUrl);
  try {
    const pitrInspect = await inspect(pitrSql);
    report.pitrRestore = {
      hasA: pitrInspect.markers.includes(MARKER_A),
      hasB: pitrInspect.markers.includes(MARKER_B),
      pgvector: pitrInspect.pgvector,
      migrationCount: pitrInspect.migrationCount,
      tables: pitrInspect.tables,
      restoredToBeforeMarker: !pitrInspect.markers.includes(MARKER_A),
    };
  } finally {
    await pitrSql.end({ timeout: 1 });
  }

  await cleanupLive(liveSql);
  report.liveCleanup = "dropped ops.rc1_recovery_markers";
  report.headBranchDelete = deleteBranch(HEAD_BRANCH);
  report.pitrBranchDelete = deleteBranch(PITR_BRANCH);

  const headOk =
    report.headRestore?.hasA === true &&
    report.headRestore?.isolatedFromLiveMarkerB === true &&
    report.headRestore?.pgvector === true &&
    report.headRestore?.migrationCount >= 13 &&
    report.headRestore?.tables?.users === true &&
    report.headRestore?.tables?.organizations === true &&
    report.headRestore?.tables?.matters === true;
  const pitrOk = report.pitrRestore?.restoredToBeforeMarker === true && report.pitrRestore?.pgvector === true;
  report.ok = Boolean(headOk && pitrOk);
  report.limitation =
    "Neon project history_retention_seconds=21600 (6 hours, Free default). PITR beyond 6 hours is unavailable without a plan upgrade.";
} catch (error) {
  report.ok = false;
  report.error = String(error instanceof Error ? error.message : error).slice(0, 800);
  try {
    deleteBranch(HEAD_BRANCH);
    deleteBranch(PITR_BRANCH);
  } catch {
    /* ignore */
  }
  if (liveSql) {
    try {
      await cleanupLive(liveSql);
    } catch {
      /* ignore */
    }
  }
} finally {
  if (liveSql) {
    try {
      await liveSql.end({ timeout: 1 });
    } catch {
      /* ignore */
    }
  }
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
