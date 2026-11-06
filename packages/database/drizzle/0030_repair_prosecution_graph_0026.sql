-- POST_PR08 repair: some environments journaled 0026 without upgrading stub graph tables
-- (still on node_type/ref_id). Re-applies 0026's idempotent upgrade (skips when node_kind exists).
-- Prosecution case-scoped graph (PROS-GRAPH-01).
-- Upgrades stub tables from 0018 (node_type/ref_id, from_ref/to_ref)
-- to reviewable node/edge schema WITHOUT discarding legacy rows.
--
-- Strategy:
-- 1. Snapshot 0018 rows into *_0018_archive tables (full copy).
-- 2. Drop stub tables (application never wrote productized data into them;
--    archives retain every prior row for audit/rollback).
-- 3. Create reviewable schema.
-- 4. Best-effort backfill: UUID ref_id rows become proposed projection nodes;
--    edges whose endpoints resolve become proposed edges (never auto-approved).
-- 5. Non-UUID / unresolvable rows remain only in archives.
--
-- Retry: safe if already upgraded (node_kind present). Partial failure before
-- DROP leaves originals intact; after archive+DROP, re-run recreates new tables
-- and re-backfills from archives.
-- Reverse: 0026_prosecution_case_graph.down.sql

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'prosecution_graph_nodes'
      AND column_name = 'node_kind'
  ) THEN
    RAISE NOTICE '0026: prosecution_graph_nodes already upgraded (node_kind present); skipping';
    RETURN;
  END IF;

  -- Snapshot legacy rows (overwrite archive only when upgrading from stub).
  DROP TABLE IF EXISTS "prosecution_graph_edges_0018_archive";
  DROP TABLE IF EXISTS "prosecution_graph_nodes_0018_archive";

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'prosecution_graph_nodes'
  ) THEN
    EXECUTE 'CREATE TABLE "prosecution_graph_nodes_0018_archive" AS
      SELECT * FROM "prosecution_graph_nodes"';
  ELSE
    CREATE TABLE "prosecution_graph_nodes_0018_archive" (
      "id" uuid NOT NULL,
      "organization_id" uuid NOT NULL,
      "criminal_case_id" uuid NOT NULL,
      "node_type" text NOT NULL,
      "ref_id" text NOT NULL,
      "provenance" jsonb NOT NULL,
      "created_at" timestamp with time zone NOT NULL
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'prosecution_graph_edges'
  ) THEN
    EXECUTE 'CREATE TABLE "prosecution_graph_edges_0018_archive" AS
      SELECT * FROM "prosecution_graph_edges"';
  ELSE
    CREATE TABLE "prosecution_graph_edges_0018_archive" (
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

  DROP TABLE IF EXISTS "prosecution_graph_edges";
  DROP TABLE IF EXISTS "prosecution_graph_nodes";
END $$;

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

CREATE UNIQUE INDEX IF NOT EXISTS "prosecution_graph_nodes_canonical_uidx"
  ON "prosecution_graph_nodes" ("criminal_case_id", "canonical_entity_type", "canonical_entity_id");
CREATE INDEX IF NOT EXISTS "prosecution_graph_nodes_case_idx"
  ON "prosecution_graph_nodes" ("criminal_case_id");
CREATE INDEX IF NOT EXISTS "prosecution_graph_nodes_org_idx"
  ON "prosecution_graph_nodes" ("organization_id");
CREATE INDEX IF NOT EXISTS "prosecution_graph_nodes_kind_idx"
  ON "prosecution_graph_nodes" ("criminal_case_id", "node_kind");

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

CREATE INDEX IF NOT EXISTS "prosecution_graph_edges_case_idx"
  ON "prosecution_graph_edges" ("criminal_case_id");
CREATE INDEX IF NOT EXISTS "prosecution_graph_edges_org_idx"
  ON "prosecution_graph_edges" ("organization_id");
CREATE INDEX IF NOT EXISTS "prosecution_graph_edges_from_idx"
  ON "prosecution_graph_edges" ("from_node_id");
CREATE INDEX IF NOT EXISTS "prosecution_graph_edges_to_idx"
  ON "prosecution_graph_edges" ("to_node_id");
CREATE INDEX IF NOT EXISTS "prosecution_graph_edges_status_idx"
  ON "prosecution_graph_edges" ("criminal_case_id", "status");

-- Best-effort backfill from archives. Migrated stubs are proposed projections —
-- never treated as verified relationships until human review.
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
    'migratedFrom', '0018'
  ),
  a."created_at",
  a."created_at"
FROM "prosecution_graph_nodes_0018_archive" a
WHERE a."ref_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND NOT EXISTS (
    SELECT 1 FROM "prosecution_graph_nodes" n WHERE n."id" = a."id"
  )
ON CONFLICT DO NOTHING;

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
WHERE NOT EXISTS (
  SELECT 1 FROM "prosecution_graph_edges" x WHERE x."id" = e."id"
)
ON CONFLICT DO NOTHING;

