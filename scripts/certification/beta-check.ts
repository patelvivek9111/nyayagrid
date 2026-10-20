#!/usr/bin/env npx tsx
/**
 * Non-destructive controlled-beta production check.
 * Never prints secret values.
 *
 *   npm run beta:check
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
  collectProductionConfigProblems,
  getFeatureFlags,
  pingRedis,
  resolveAppEnvDetailed,
  summarizeConfig,
} from "@nyayagrid/platform";

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

applyDotEnv(resolve(repoRoot, ".env"));

const EXPECTED_MIGRATIONS = [
  "0000_phase1_foundation",
  "0001_phase2_matter_workflow",
  "0002_phase3_matter_intelligence",
  "0003_phase4_graph_memory",
  "0004_phase5_professional_intelligence",
  "0005_phase6_nyaya_research",
  "0006_phase7_nyaya_agents",
  "0007_phase8_professor_guide",
  "0008_phase9_production_readiness",
  "0009_professor_hardening",
  "0010_firm_ops",
  "0011_enterprise_trust",
  "0012_phase6s_jurisdiction",
];

function redact(value: string): string {
  return value.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, "[redacted]");
}

const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];

function record(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
  const mark = ok ? "ok" : "FAIL";
  console.log(`${mark.padEnd(4)} ${name}${detail ? ` — ${detail}` : ""}`);
}

const resolution = resolveAppEnvDetailed();
record(
  "app_env_declared",
  resolution.source === "APP_ENV",
  `appEnv=${resolution.appEnv} source=${resolution.source}`,
);

const summary = summarizeConfig();
record("auth_not_dev", summary.authProvider !== "dev", `auth=${summary.authProvider}`);
record("ai_not_mock", summary.aiProvider !== "mock", `ai=${summary.aiProvider}`);
record(
  "embeddings_not_mock",
  summary.embeddingProvider !== "mock",
  `embeddings=${summary.embeddingProvider}`,
);
record(
  "malware_clamav",
  summary.malwareScanner === "clamav",
  `malware=${summary.malwareScanner}`,
);
record("rate_limit_redis", summary.rateLimitProvider === "redis", `rate=${summary.rateLimitProvider}`);
record("database_configured", summary.databaseConfigured);
record("bucket_configured", summary.storageBucketConfigured);

const flags = getFeatureFlags();
record("professor_off", flags.professor === false, `professor=${flags.professor}`);
record("agents_off", flags.agents === false, `agents=${flags.agents}`);

const problems = collectProductionConfigProblems();
record("production_config_gate", problems.length === 0, problems[0]);
for (const problem of problems.slice(1, 8)) {
  console.log(`     ${problem}`);
}

if (process.env.DATABASE_URL) {
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    await sql`select 1`;
    record("database_reachable", true);
    const extensions = await sql<{ extname: string }[]>`
      select extname from pg_extension where extname in ('vector', 'pgcrypto')
    `;
    const names = new Set(extensions.map((row) => row.extname));
    record("pgvector", names.has("vector"));
    record("pgcrypto", names.has("pgcrypto"));
    try {
      const applied = await sql<{ hash: string }[]>`
        select hash from drizzle.__drizzle_migrations order by created_at
      `;
      record(
        "migrations_table",
        applied.length >= EXPECTED_MIGRATIONS.length,
        `applied=${applied.length} expected>=${EXPECTED_MIGRATIONS.length}`,
      );
    } catch {
      record("migrations_table", false, "drizzle.__drizzle_migrations missing (check mode; not migrated)");
    }
  } catch (error) {
    record("database_reachable", false, redact(error instanceof Error ? error.message : "error"));
  } finally {
    await sql.end({ timeout: 2 });
  }
} else {
  record("database_reachable", false, "DATABASE_URL unset; skipped live probe");
}

if (summary.rateLimitProvider === "redis") {
  const redis = await pingRedis();
  record("redis_reachable", redis.ok, redis.ok ? undefined : "unreachable");
}

const failed = checks.filter((c) => !c.ok);
console.log(
  JSON.stringify({
    ok: failed.length === 0,
    appEnv: resolution.appEnv,
    failed: failed.map((c) => c.name),
    summary,
    flags,
  }),
);
process.exit(failed.length === 0 ? 0 : 1);
