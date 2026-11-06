-- PR #9 migration safety: assert expected shapes after 0025–0030 repairs.
-- Fail closed when a table exists but lacks required columns (IF NOT EXISTS alone is insufficient).
-- Stub→reviewable graph upgrade must create the FULL reviewable schema (FKs, CHECKs, indexes),
-- matching 0026 — not bare CREATE TABLE shells.
--> statement-breakpoint
DO $$
DECLARE
  missing text;
BEGIN
  -- Contacts (0027 / 0029)
  IF to_regclass('public.contacts') IS NOT NULL THEN
    SELECT string_agg(c, ', ') INTO missing
    FROM (VALUES ('organization_id'), ('display_name'), ('created_at')) AS required(c)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = required.c
    );
    IF missing IS NOT NULL THEN
      RAISE EXCEPTION '0031: contacts exists but missing columns: %', missing;
    END IF;
  END IF;

  IF to_regclass('public.document_folders') IS NOT NULL THEN
    SELECT string_agg(c, ', ') INTO missing
    FROM (VALUES ('organization_id'), ('matter_id'), ('name')) AS required(c)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'document_folders' AND column_name = required.c
    );
    IF missing IS NOT NULL THEN
      RAISE EXCEPTION '0031: document_folders exists but missing columns: %', missing;
    END IF;
  END IF;

  -- Billing fee-assistance columns (0028 / 0029)
  IF to_regclass('public.time_entries') IS NOT NULL THEN
    SELECT string_agg(c, ', ') INTO missing
    FROM (VALUES ('billable'), ('hourly_rate_cents')) AS required(c)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'time_entries' AND column_name = required.c
    );
    IF missing IS NOT NULL THEN
      RAISE EXCEPTION '0031: time_entries exists but missing billing columns: %', missing;
    END IF;
  END IF;

  IF to_regclass('public.invoices') IS NOT NULL THEN
    SELECT string_agg(c, ', ') INTO missing
    FROM (VALUES ('total_minutes'), ('total_cents')) AS required(c)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = required.c
    );
    IF missing IS NOT NULL THEN
      RAISE EXCEPTION '0031: invoices exists but missing billing columns: %', missing;
    END IF;
  END IF;

  -- Prosecution memory (0025 / 0029)
  IF to_regclass('public.prosecution_case_memories') IS NOT NULL THEN
    SELECT string_agg(c, ', ') INTO missing
    FROM (VALUES ('organization_id'), ('criminal_case_id'), ('status'), ('provenance')) AS required(c)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'prosecution_case_memories' AND column_name = required.c
    );
    IF missing IS NOT NULL THEN
      RAISE EXCEPTION '0031: prosecution_case_memories exists but missing columns: %', missing;
    END IF;
  END IF;
END $$;
--> statement-breakpoint
-- Safe stub→reviewable graph upgrade when 0026/0030 were journaled but stubs remain.
DO $$
DECLARE
  has_node_kind boolean;
  has_node_type boolean;
  archive_suffix text := to_char(clock_timestamp(), 'YYYYMMDDHH24MISS');
BEGIN
  IF to_regclass('public.prosecution_graph_nodes') IS NULL THEN
    RAISE NOTICE '0031: no prosecution_graph_nodes; skip stub archive/drop';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'prosecution_graph_nodes' AND column_name = 'node_kind'
  ) INTO has_node_kind;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'prosecution_graph_nodes' AND column_name = 'node_type'
  ) INTO has_node_type;

  IF has_node_kind THEN
    RAISE NOTICE '0031: graph already reviewable (node_kind present); skip stub archive/drop';
    RETURN;
  END IF;

  IF NOT has_node_type THEN
    RAISE EXCEPTION '0031: prosecution_graph_nodes has neither node_kind nor node_type — refusing unsafe rewrite';
  END IF;

  -- Preserve any prior archives instead of DROP overwrite.
  IF to_regclass('public.prosecution_graph_nodes_0018_archive') IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.prosecution_graph_nodes_0018_archive RENAME TO %I',
      'prosecution_graph_nodes_0018_archive_' || archive_suffix
    );
  END IF;
  IF to_regclass('public.prosecution_graph_edges_0018_archive') IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.prosecution_graph_edges_0018_archive RENAME TO %I',
      'prosecution_graph_edges_0018_archive_' || archive_suffix
    );
  END IF;

  EXECUTE 'CREATE TABLE public.prosecution_graph_nodes_0018_archive AS
    SELECT * FROM public.prosecution_graph_nodes';
  IF to_regclass('public.prosecution_graph_edges') IS NOT NULL THEN
    EXECUTE 'CREATE TABLE public.prosecution_graph_edges_0018_archive AS
      SELECT * FROM public.prosecution_graph_edges';
  ELSE
    CREATE TABLE public.prosecution_graph_edges_0018_archive (
      "id" uuid NOT NULL,
      "organization_id" uuid NOT NULL,
      "criminal_case_id" uuid NOT NULL,
      "from_ref" text NOT NULL,
      "to_ref" text NOT NULL,
      "relationship" text NOT NULL,
      "provenance" jsonb NOT NULL,
      "created_at" timestamp with time zone NOT NULL
    );
  END IF;

  -- Verified archives exist before DROP.
  IF to_regclass('public.prosecution_graph_nodes_0018_archive') IS NULL THEN
    RAISE EXCEPTION '0031: refusing DROP — nodes archive missing';
  END IF;

  DROP TABLE IF EXISTS public.prosecution_graph_edges;
  DROP TABLE IF EXISTS public.prosecution_graph_nodes;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prosecution_graph_nodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "node_kind" text NOT NULL,
  "canonical_entity_type" text NOT NULL,
  "canonical_entity_id" uuid NOT NULL,
  "display_name" text NOT NULL,
  "provenance" jsonb NOT NULL,
  "origin" text DEFAULT 'manual' NOT NULL,
  "status" text DEFAULT 'approved' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "prosecution_graph_nodes_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade,
  CONSTRAINT "prosecution_graph_nodes_criminal_case_id_fkey"
    FOREIGN KEY ("criminal_case_id") REFERENCES "criminal_cases"("id") ON DELETE cascade,
  CONSTRAINT "prosecution_graph_nodes_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id"),
  CONSTRAINT "prosecution_graph_nodes_kind_chk" CHECK ("node_kind" IN (
    'criminal_case','defendant','charge','charge_element','evidence','witness',
    'warrant','motion','hearing','legal_issue','other'
  )),
  CONSTRAINT "prosecution_graph_nodes_origin_chk" CHECK ("origin" IN ('ai','manual','projection')),
  CONSTRAINT "prosecution_graph_nodes_status_chk" CHECK ("status" IN ('proposed','approved','rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prosecution_graph_nodes_canonical_uidx"
  ON "prosecution_graph_nodes" ("criminal_case_id", "canonical_entity_type", "canonical_entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prosecution_graph_nodes_case_idx"
  ON "prosecution_graph_nodes" ("criminal_case_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prosecution_graph_nodes_org_idx"
  ON "prosecution_graph_nodes" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prosecution_graph_nodes_kind_idx"
  ON "prosecution_graph_nodes" ("criminal_case_id", "node_kind");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prosecution_graph_edges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "from_node_id" uuid NOT NULL,
  "to_node_id" uuid NOT NULL,
  "relationship_type" text NOT NULL,
  "provenance" jsonb NOT NULL,
  "origin" text DEFAULT 'manual' NOT NULL,
  "status" text DEFAULT 'proposed' NOT NULL,
  "confidence" text,
  "created_by_user_id" uuid,
  "reviewed_by_user_id" uuid,
  "reviewed_at" timestamp with time zone,
  "rejection_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "prosecution_graph_edges_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade,
  CONSTRAINT "prosecution_graph_edges_criminal_case_id_fkey"
    FOREIGN KEY ("criminal_case_id") REFERENCES "criminal_cases"("id") ON DELETE cascade,
  CONSTRAINT "prosecution_graph_edges_from_node_id_fkey"
    FOREIGN KEY ("from_node_id") REFERENCES "prosecution_graph_nodes"("id") ON DELETE cascade,
  CONSTRAINT "prosecution_graph_edges_to_node_id_fkey"
    FOREIGN KEY ("to_node_id") REFERENCES "prosecution_graph_nodes"("id") ON DELETE cascade,
  CONSTRAINT "prosecution_graph_edges_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id"),
  CONSTRAINT "prosecution_graph_edges_reviewed_by_user_id_fkey"
    FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id"),
  CONSTRAINT "prosecution_graph_edges_origin_chk" CHECK ("origin" IN ('ai','manual','projection')),
  CONSTRAINT "prosecution_graph_edges_status_chk" CHECK ("status" IN ('proposed','approved','rejected')),
  CONSTRAINT "prosecution_graph_edges_confidence_chk" CHECK (
    "confidence" IS NULL OR "confidence" IN ('low','medium','high')
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prosecution_graph_edges_case_idx"
  ON "prosecution_graph_edges" ("criminal_case_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prosecution_graph_edges_org_idx"
  ON "prosecution_graph_edges" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prosecution_graph_edges_from_idx"
  ON "prosecution_graph_edges" ("from_node_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prosecution_graph_edges_to_idx"
  ON "prosecution_graph_edges" ("to_node_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prosecution_graph_edges_status_idx"
  ON "prosecution_graph_edges" ("criminal_case_id", "status");
--> statement-breakpoint
-- If a prior broken 0031 left bare reviewable tables (CREATE IF NOT EXISTS no-op),
-- attach missing 0026-parity constraints/indexes. 0032 also covers already-journaled DBs.
DO $$
BEGIN
  IF to_regclass('public.prosecution_graph_nodes') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'prosecution_graph_nodes' AND column_name = 'node_kind'
  ) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_graph_nodes_organization_id_fkey') THEN
    ALTER TABLE "prosecution_graph_nodes"
      ADD CONSTRAINT "prosecution_graph_nodes_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_graph_nodes_criminal_case_id_fkey') THEN
    ALTER TABLE "prosecution_graph_nodes"
      ADD CONSTRAINT "prosecution_graph_nodes_criminal_case_id_fkey"
      FOREIGN KEY ("criminal_case_id") REFERENCES "criminal_cases"("id") ON DELETE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_graph_nodes_created_by_user_id_fkey') THEN
    ALTER TABLE "prosecution_graph_nodes"
      ADD CONSTRAINT "prosecution_graph_nodes_created_by_user_id_fkey"
      FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_graph_nodes_kind_chk') THEN
    ALTER TABLE "prosecution_graph_nodes"
      ADD CONSTRAINT "prosecution_graph_nodes_kind_chk" CHECK ("node_kind" IN (
        'criminal_case','defendant','charge','charge_element','evidence','witness',
        'warrant','motion','hearing','legal_issue','other'
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_graph_nodes_origin_chk') THEN
    ALTER TABLE "prosecution_graph_nodes"
      ADD CONSTRAINT "prosecution_graph_nodes_origin_chk" CHECK ("origin" IN ('ai','manual','projection'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_graph_nodes_status_chk') THEN
    ALTER TABLE "prosecution_graph_nodes"
      ADD CONSTRAINT "prosecution_graph_nodes_status_chk" CHECK ("status" IN ('proposed','approved','rejected'));
  END IF;

  IF to_regclass('public.prosecution_graph_edges') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_graph_edges_organization_id_fkey') THEN
    ALTER TABLE "prosecution_graph_edges"
      ADD CONSTRAINT "prosecution_graph_edges_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_graph_edges_criminal_case_id_fkey') THEN
    ALTER TABLE "prosecution_graph_edges"
      ADD CONSTRAINT "prosecution_graph_edges_criminal_case_id_fkey"
      FOREIGN KEY ("criminal_case_id") REFERENCES "criminal_cases"("id") ON DELETE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_graph_edges_from_node_id_fkey') THEN
    ALTER TABLE "prosecution_graph_edges"
      ADD CONSTRAINT "prosecution_graph_edges_from_node_id_fkey"
      FOREIGN KEY ("from_node_id") REFERENCES "prosecution_graph_nodes"("id") ON DELETE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_graph_edges_to_node_id_fkey') THEN
    ALTER TABLE "prosecution_graph_edges"
      ADD CONSTRAINT "prosecution_graph_edges_to_node_id_fkey"
      FOREIGN KEY ("to_node_id") REFERENCES "prosecution_graph_nodes"("id") ON DELETE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_graph_edges_created_by_user_id_fkey') THEN
    ALTER TABLE "prosecution_graph_edges"
      ADD CONSTRAINT "prosecution_graph_edges_created_by_user_id_fkey"
      FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_graph_edges_reviewed_by_user_id_fkey') THEN
    ALTER TABLE "prosecution_graph_edges"
      ADD CONSTRAINT "prosecution_graph_edges_reviewed_by_user_id_fkey"
      FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_graph_edges_origin_chk') THEN
    ALTER TABLE "prosecution_graph_edges"
      ADD CONSTRAINT "prosecution_graph_edges_origin_chk" CHECK ("origin" IN ('ai','manual','projection'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_graph_edges_status_chk') THEN
    ALTER TABLE "prosecution_graph_edges"
      ADD CONSTRAINT "prosecution_graph_edges_status_chk" CHECK ("status" IN ('proposed','approved','rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_graph_edges_confidence_chk') THEN
    ALTER TABLE "prosecution_graph_edges"
      ADD CONSTRAINT "prosecution_graph_edges_confidence_chk" CHECK (
        "confidence" IS NULL OR "confidence" IN ('low','medium','high')
      );
  END IF;
END $$;
--> statement-breakpoint
-- Backfill proposed projections from the latest archive when present.
DO $$
BEGIN
  IF to_regclass('public.prosecution_graph_nodes_0018_archive') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'prosecution_graph_nodes' AND column_name = 'node_kind'
  ) THEN
    RAISE EXCEPTION '0031: expected reviewable graph nodes before backfill';
  END IF;

  INSERT INTO "prosecution_graph_nodes" (
    "id", "organization_id", "criminal_case_id", "node_kind", "canonical_entity_type",
    "canonical_entity_id", "display_name", "provenance", "origin", "status", "metadata",
    "created_at", "updated_at"
  )
  SELECT
    a."id",
    a."organization_id",
    a."criminal_case_id",
    CASE lower(a."node_type")
      WHEN 'criminal_case' THEN 'criminal_case'
      WHEN 'defendant' THEN 'defendant'
      WHEN 'charge' THEN 'charge'
      WHEN 'charge_element' THEN 'charge_element'
      WHEN 'evidence' THEN 'evidence'
      WHEN 'witness' THEN 'witness'
      WHEN 'warrant' THEN 'warrant'
      WHEN 'motion' THEN 'motion'
      WHEN 'hearing' THEN 'hearing'
      WHEN 'legal_issue' THEN 'legal_issue'
      ELSE 'other'
    END,
    lower(a."node_type"),
    a."ref_id"::uuid,
    lower(a."node_type") || ':' || a."ref_id",
    a."provenance",
    'projection',
    'proposed',
    jsonb_build_object(
      'legacyNodeType', a."node_type",
      'legacyRefId', a."ref_id",
      'migratedFrom', '0018',
      'repairedBy', '0031'
    ),
    a."created_at",
    a."created_at"
  FROM "prosecution_graph_nodes_0018_archive" a
  WHERE a."ref_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND NOT EXISTS (SELECT 1 FROM "prosecution_graph_nodes" n WHERE n."id" = a."id")
  ON CONFLICT DO NOTHING;

  IF to_regclass('public.prosecution_graph_edges_0018_archive') IS NOT NULL THEN
    INSERT INTO "prosecution_graph_edges" (
      "id", "organization_id", "criminal_case_id", "from_node_id", "to_node_id",
      "relationship_type", "provenance", "origin", "status", "created_at", "updated_at"
    )
    SELECT
      e."id",
      e."organization_id",
      e."criminal_case_id",
      fn."id",
      tn."id",
      e."relationship",
      e."provenance",
      'projection',
      'proposed',
      e."created_at",
      e."created_at"
    FROM "prosecution_graph_edges_0018_archive" e
    JOIN "prosecution_graph_nodes_0018_archive" fa
      ON fa."criminal_case_id" = e."criminal_case_id"
     AND (fa."ref_id" = e."from_ref" OR fa."id"::text = e."from_ref")
    JOIN "prosecution_graph_nodes" fn ON fn."id" = fa."id"
    JOIN "prosecution_graph_nodes_0018_archive" ta
      ON ta."criminal_case_id" = e."criminal_case_id"
     AND (ta."ref_id" = e."to_ref" OR ta."id"::text = e."to_ref")
    JOIN "prosecution_graph_nodes" tn ON tn."id" = ta."id"
    WHERE NOT EXISTS (SELECT 1 FROM "prosecution_graph_edges" x WHERE x."id" = e."id")
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
