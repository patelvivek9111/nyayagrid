-- Corpus ingest job checkpoints for rate-safe CourtListener (and future) adapters.
-- Durable across Fly machine restarts; short batches resume from cursor.

CREATE TABLE IF NOT EXISTS "corpus_ingest_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source" text NOT NULL,
  "court_id" text NOT NULL,
  "cl_court" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "cursor" text,
  "last_successful_external_id" text,
  "completed_external_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "items_discovered" integer NOT NULL DEFAULT 0,
  "items_fetched" integer NOT NULL DEFAULT 0,
  "items_imported" integer NOT NULL DEFAULT 0,
  "items_skipped" integer NOT NULL DEFAULT 0,
  "items_failed" integer NOT NULL DEFAULT 0,
  "items_quarantined" integer NOT NULL DEFAULT 0,
  "rate_limit_count" integer NOT NULL DEFAULT 0,
  "api_calls" integer NOT NULL DEFAULT 0,
  "target_max" integer NOT NULL DEFAULT 20,
  "batch_size" integer NOT NULL DEFAULT 5,
  "next_page_url" text,
  "last_retry_after_sec" integer,
  "last_error" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "started_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "corpus_ingest_jobs_source_court_uidx"
  ON "corpus_ingest_jobs" ("source", "cl_court");

CREATE INDEX IF NOT EXISTS "corpus_ingest_jobs_status_idx"
  ON "corpus_ingest_jobs" ("status");
