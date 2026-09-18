const postgres = require("postgres");

const DDL = `
CREATE TABLE IF NOT EXISTS "corpus_refresh_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_key" text NOT NULL,
  "jurisdiction" text NOT NULL,
  "adapter_name" text NOT NULL,
  "cadence_class" text NOT NULL DEFAULT 'manual_only',
  "status" text NOT NULL DEFAULT 'pending',
  "cursor" text,
  "checkpoint" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "authorities_checked" integer NOT NULL DEFAULT 0,
  "authorities_unchanged" integer NOT NULL DEFAULT 0,
  "authorities_changed" integer NOT NULL DEFAULT 0,
  "authorities_failed" integer NOT NULL DEFAULT 0,
  "authorities_unavailable" integer NOT NULL DEFAULT 0,
  "http_fetches" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "last_successful_run_at" timestamp with time zone,
  "next_eligible_at" timestamp with time zone,
  "started_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "corpus_refresh_jobs_source_jur_uidx"
  ON "corpus_refresh_jobs" ("source_key", "jurisdiction");
CREATE INDEX IF NOT EXISTS "corpus_refresh_jobs_status_idx"
  ON "corpus_refresh_jobs" ("status");
CREATE INDEX IF NOT EXISTS "corpus_refresh_jobs_next_eligible_idx"
  ON "corpus_refresh_jobs" ("next_eligible_at");

CREATE TABLE IF NOT EXISTS "corpus_source_health" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_key" text NOT NULL,
  "jurisdiction" text NOT NULL,
  "adapter_name" text,
  "status" text NOT NULL DEFAULT 'healthy',
  "last_success_at" timestamp with time zone,
  "last_failure_at" timestamp with time zone,
  "consecutive_failures" integer NOT NULL DEFAULT 0,
  "last_http_status" integer,
  "last_error" text,
  "parser_version" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "corpus_source_health_source_jur_uidx"
  ON "corpus_source_health" ("source_key", "jurisdiction");
CREATE INDEX IF NOT EXISTS "corpus_source_health_status_idx"
  ON "corpus_source_health" ("status");
`;

(async () => {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require" });
  await sql.unsafe(DDL);
  // Seed health rows for known adapters (no CL).
  await sql`
    insert into corpus_source_health (source_key, jurisdiction, adapter_name, status, parser_version)
    values
      ('ecfr', 'US', 'ecfr', 'healthy', 'corpus1-v3'),
      ('state_regulation', 'PA', 'state_regulation_pa', 'healthy', 'corpus1-v3'),
      ('state_regulation', 'FL', 'state_regulation_fl', 'healthy', 'corpus1-v3'),
      ('state_regulation', 'VA', 'state_regulation_va', 'healthy', 'corpus1-v3'),
      ('uscourts_rules', 'US', 'uscourts_rules', 'degraded', 'corpus1-v3')
    on conflict (source_key, jurisdiction) do nothing
  `;
  const tables = await sql`
    select table_name from information_schema.tables
    where table_name in ('corpus_refresh_jobs','corpus_source_health')
    order by 1
  `;
  const health = await sql`select source_key, jurisdiction, status from corpus_source_health order by 1,2`;
  console.log(JSON.stringify({ ok: true, tables, health }, null, 2));
  await sql.end({ timeout: 2 });
})().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 500) }));
  process.exit(1);
});
