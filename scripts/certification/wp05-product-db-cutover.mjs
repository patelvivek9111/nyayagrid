#!/usr/bin/env node
/**
 * WP-05 controlled product DB cutover helpers (verification + destination soft-ref).
 * Connection strings via env only; never logged.
 *
 * CORPUS_TABLES are excluded from the product database.
 * Soft-ref: drop product→corpus FKs on DESTINATION only (source untouched).
 */
import postgres from "postgres";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const reportsDir = join(__dirname, "../../packages/research/corpus/reports");

export const CORPUS_TABLES = [
  "legal_authorities",
  "legal_authority_chunks",
  "legal_authority_versions",
  "legal_authority_citations",
  "legal_authority_relationships",
  "corpus_ingest_jobs",
  "corpus_refresh_jobs",
  "corpus_source_health",
];

export const SOFT_REF_FK_DROPS = [
  "ALTER TABLE public.matter_authorities DROP CONSTRAINT IF EXISTS matter_authorities_authority_fk",
  "ALTER TABLE public.research_notes DROP CONSTRAINT IF EXISTS research_notes_authority_fk",
  "ALTER TABLE public.research_notes DROP CONSTRAINT IF EXISTS research_notes_authority_chunk_fk",
  "ALTER TABLE public.research_results DROP CONSTRAINT IF EXISTS research_results_authority_fk",
  "ALTER TABLE public.research_results DROP CONSTRAINT IF EXISTS research_results_chunk_fk",
  "ALTER TABLE public.research_results DROP CONSTRAINT IF EXISTS research_results_authority_version_fk",
];

function redact(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}/${u.pathname.replace(/^\//, "")}`;
  } catch {
    return "(unparseable)";
  }
}

function toDirect(url) {
  // Prefer non-pooler for DDL/dump.
  return url.replace("-pooler", "");
}

export async function listPublicTables(url) {
  const sql = postgres(url, { max: 1, ssl: "require", prepare: false });
  try {
    const rows = await sql`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r'
      ORDER BY 1`;
    return rows.map((r) => r.table_name);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function tableCount(url, table) {
  if (!/^[a-z0-9_]+$/.test(table)) throw new Error("bad table");
  const sql = postgres(url, { max: 1, ssl: "require", prepare: false });
  try {
    const rows = await sql.unsafe(`SELECT COUNT(*)::bigint AS c FROM public.${table}`);
    return Number(rows[0].c);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function applySoftRefDrops(destUrl) {
  const sql = postgres(toDirect(destUrl), { max: 1, ssl: "require", prepare: false });
  try {
    for (const stmt of SOFT_REF_FK_DROPS) {
      await sql.unsafe(stmt);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function dropCorpusTablesIfEmpty(destUrl) {
  const sql = postgres(toDirect(destUrl), { max: 1, ssl: "require", prepare: false });
  const dropped = [];
  try {
    for (const table of CORPUS_TABLES) {
      const exists = await sql`SELECT to_regclass(${"public." + table}) AS reg`;
      if (!exists[0]?.reg) continue;
      const c = await sql.unsafe(`SELECT COUNT(*)::bigint AS c FROM public.${table}`);
      if (Number(c[0].c) !== 0) {
        throw new Error(`Refusing to drop non-empty corpus table on destination: ${table}`);
      }
      await sql.unsafe(`DROP TABLE IF EXISTS public.${table} CASCADE`);
      dropped.push(table);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
  return dropped;
}

export function buildPgDumpExcludeArgs() {
  return CORPUS_TABLES.flatMap((t) => ["--exclude-table-data", `public.${t}`, "--exclude-table", `public.${t}`]);
}

export function runDockerPgDumpRestore({ sourceUrl, destUrl }) {
  const src = toDirect(sourceUrl);
  const dst = toDirect(destUrl);
  const exclude = CORPUS_TABLES.flatMap((t) => ["--exclude-table", `public.${t}`]);

  // Schema+data dump excluding corpus tables entirely.
  const dump = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "-e",
      `SOURCE_URL=${src}`,
      "postgres:16-alpine",
      "sh",
      "-c",
      [
        "pg_dump \"$SOURCE_URL\" --no-owner --no-acl --format=plain",
        ...CORPUS_TABLES.map((t) => `--exclude-table='public.${t}'`),
      ].join(" "),
    ],
    { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
  );
  if (dump.status !== 0) {
    throw new Error(`pg_dump failed: ${(dump.stderr || dump.stdout || "").slice(0, 500)}`);
  }
  let sqlText = dump.stdout;
  // Strip any residual REFERENCES to corpus tables (soft-ref on destination).
  for (const table of CORPUS_TABLES) {
    const re = new RegExp(
      `,?\\s*CONSTRAINT\\s+"[^"]+"\\s+FOREIGN KEY\\s*\\([^)]+\\)\\s+REFERENCES\\s+"?public"?\\."?${table}"?\\s*\\([^)]+\\)[^,)]*`,
      "gi",
    );
    sqlText = sqlText.replace(re, "");
    const re2 = new RegExp(
      `ALTER TABLE ONLY[^;]+FOREIGN KEY[^;]+REFERENCES\\s+(public\\.)?${table}\\s*\\([^)]+\\)[^;]*;`,
      "gi",
    );
    sqlText = sqlText.replace(re2, "");
  }

  const restore = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "-i",
      "-e",
      `DEST_URL=${dst}`,
      "postgres:16-alpine",
      "psql",
      "$DEST_URL",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { encoding: "utf8", input: sqlText, maxBuffer: 512 * 1024 * 1024 },
  );
  // psql with env expansion issue — use explicit connection via sh
  if (restore.status !== 0) {
    // Fallback via sh -c
    const restore2 = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "-i",
        "-e",
        `DEST_URL=${dst}`,
        "postgres:16-alpine",
        "sh",
        "-c",
        'psql "$DEST_URL" -v ON_ERROR_STOP=1',
      ],
      { encoding: "utf8", input: sqlText, maxBuffer: 512 * 1024 * 1024 },
    );
    if (restore2.status !== 0) {
      throw new Error(
        `psql restore failed: ${(restore2.stderr || restore.stderr || "").slice(0, 800)}`,
      );
    }
    return { dumpBytes: Buffer.byteLength(sqlText), method: "docker-pg_dump-psql-sh" };
  }
  return { dumpBytes: Buffer.byteLength(sqlText), method: "docker-pg_dump-psql" };
}

export function writeReport(name, report) {
  mkdirSync(reportsDir, { recursive: true });
  const path = join(reportsDir, name);
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
  return path;
}

export { redact, toDirect };
