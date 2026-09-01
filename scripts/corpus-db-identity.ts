#!/usr/bin/env npx tsx
/**
 * Safe corpus/database identity diagnostic. Never prints credentials.
 *
 *   npx tsx scripts/corpus-db-identity.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
  CERTIFICATION_DATABASE_FALLBACK,
  intendedCertificationTarget,
  redactDatabaseUrl,
  summarizeCorpusCoverage,
} from "@nyayagrid/research";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

function applyDotEnv(filePath: string) {
  if (!existsSync(filePath)) return;
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function envFileStatus(rel: string) {
  const filePath = resolve(repoRoot, rel);
  if (!existsSync(filePath)) return { path: rel, exists: false, keys: [] as string[] };
  const keys: string[] = [];
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    keys.push(line.slice(0, line.indexOf("=")).trim());
  }
  return { path: rel, exists: true, keys };
}

async function main() {
  applyDotEnv(resolve(repoRoot, ".env"));
  applyDotEnv(resolve(repoRoot, "benchmarks/nyaya-bench/.env"));
  const databaseUrl = process.env.DATABASE_URL ?? CERTIFICATION_DATABASE_FALLBACK;
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const [server] = await sql<{
      current_database: string;
      current_schema: string;
      search_path: string;
    }[]>`
      SELECT
        current_database() AS current_database,
        current_schema() AS current_schema,
        current_setting('search_path') AS search_path
    `;
    const rows = await sql<
      {
        source_provider: string | null;
        authority_type: string;
        authority_state: string | null;
        court_id: string | null;
        metadata: Record<string, unknown> | null;
      }[]
    >`
      SELECT source_provider, authority_type::text AS authority_type, authority_state, court_id, metadata
      FROM legal_authorities
    `;
    const coverage = summarizeCorpusCoverage(
      rows.map((row) => ({
        sourceProvider: row.source_provider,
        authorityType: row.authority_type,
        authorityState: row.authority_state,
        courtId: row.court_id,
        metadata: row.metadata,
      })),
    );
    console.log(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          cwd: process.cwd(),
          APP_ENV: process.env.APP_ENV ?? null,
          NODE_ENV: process.env.NODE_ENV ?? null,
          dotenvFiles: [
            envFileStatus(".env"),
            envFileStatus("benchmarks/nyaya-bench/.env"),
            envFileStatus("packages/research/.env"),
            envFileStatus("apps/web/.env"),
          ],
          database: redactDatabaseUrl(databaseUrl),
          server: server ?? null,
          intendedCertification: intendedCertificationTarget(),
          inventory: coverage,
        },
        null,
        2,
      ),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
