-- PR #9 schema integrity: ensure reviewable prosecution graph has full 0026-parity
-- constraints/indexes, then enforce case/organization isolation via composite FKs.
-- Additive follow-up for DBs that already journaled bare 0031 CREATE TABLE shells.
-- Downs are intentionally no-op (dropping isolation FKs would weaken live integrity).
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
-- Supporting unique indexes for composite FKs (criminal_cases_id_org_uidx from 0019).
CREATE UNIQUE INDEX IF NOT EXISTS "prosecution_graph_nodes_id_case_uidx"
  ON "prosecution_graph_nodes" ("id", "criminal_case_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prosecution_graph_nodes_id_org_uidx"
  ON "prosecution_graph_nodes" ("id", "organization_id");
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.prosecution_graph_nodes') IS NULL
     OR to_regclass('public.prosecution_graph_edges') IS NULL THEN
    RAISE EXCEPTION '0032: prosecution graph tables missing — refuse integrity contract';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'prosecution_graph_nodes' AND column_name = 'node_kind'
  ) THEN
    RAISE EXCEPTION '0032: prosecution_graph_nodes still stub-shaped (no node_kind)';
  END IF;

  -- Base FKs / CHECKs (idempotent attach for bare 0031 shells)
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

  -- Case / organization co-tenancy: edges and nodes must share case and office.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_graph_nodes_case_org_fk') THEN
    ALTER TABLE "prosecution_graph_nodes"
      ADD CONSTRAINT "prosecution_graph_nodes_case_org_fk"
      FOREIGN KEY ("criminal_case_id", "organization_id")
      REFERENCES "criminal_cases"("id", "organization_id") ON DELETE cascade;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_graph_edges_case_org_fk') THEN
    ALTER TABLE "prosecution_graph_edges"
      ADD CONSTRAINT "prosecution_graph_edges_case_org_fk"
      FOREIGN KEY ("criminal_case_id", "organization_id")
      REFERENCES "criminal_cases"("id", "organization_id") ON DELETE cascade;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_graph_edges_from_case_fk') THEN
    ALTER TABLE "prosecution_graph_edges"
      ADD CONSTRAINT "prosecution_graph_edges_from_case_fk"
      FOREIGN KEY ("from_node_id", "criminal_case_id")
      REFERENCES "prosecution_graph_nodes"("id", "criminal_case_id") ON DELETE cascade;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_graph_edges_to_case_fk') THEN
    ALTER TABLE "prosecution_graph_edges"
      ADD CONSTRAINT "prosecution_graph_edges_to_case_fk"
      FOREIGN KEY ("to_node_id", "criminal_case_id")
      REFERENCES "prosecution_graph_nodes"("id", "criminal_case_id") ON DELETE cascade;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_graph_edges_from_org_fk') THEN
    ALTER TABLE "prosecution_graph_edges"
      ADD CONSTRAINT "prosecution_graph_edges_from_org_fk"
      FOREIGN KEY ("from_node_id", "organization_id")
      REFERENCES "prosecution_graph_nodes"("id", "organization_id") ON DELETE cascade;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_graph_edges_to_org_fk') THEN
    ALTER TABLE "prosecution_graph_edges"
      ADD CONSTRAINT "prosecution_graph_edges_to_org_fk"
      FOREIGN KEY ("to_node_id", "organization_id")
      REFERENCES "prosecution_graph_nodes"("id", "organization_id") ON DELETE cascade;
  END IF;
END $$;
--> statement-breakpoint
-- Fail closed if critical integrity objects are still missing.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(req, ', ' ORDER BY req) INTO missing
  FROM (
    VALUES
      ('prosecution_graph_nodes_organization_id_fkey'),
      ('prosecution_graph_nodes_criminal_case_id_fkey'),
      ('prosecution_graph_nodes_kind_chk'),
      ('prosecution_graph_nodes_origin_chk'),
      ('prosecution_graph_nodes_status_chk'),
      ('prosecution_graph_nodes_case_org_fk'),
      ('prosecution_graph_edges_organization_id_fkey'),
      ('prosecution_graph_edges_criminal_case_id_fkey'),
      ('prosecution_graph_edges_from_node_id_fkey'),
      ('prosecution_graph_edges_to_node_id_fkey'),
      ('prosecution_graph_edges_origin_chk'),
      ('prosecution_graph_edges_status_chk'),
      ('prosecution_graph_edges_confidence_chk'),
      ('prosecution_graph_edges_case_org_fk'),
      ('prosecution_graph_edges_from_case_fk'),
      ('prosecution_graph_edges_to_case_fk'),
      ('prosecution_graph_edges_from_org_fk'),
      ('prosecution_graph_edges_to_org_fk')
  ) AS required(req)
  WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = required.req);

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '0032: missing graph integrity constraints: %', missing;
  END IF;

  SELECT string_agg(req, ', ' ORDER BY req) INTO missing
  FROM (
    VALUES
      ('prosecution_graph_nodes_canonical_uidx'),
      ('prosecution_graph_nodes_case_idx'),
      ('prosecution_graph_nodes_org_idx'),
      ('prosecution_graph_nodes_kind_idx'),
      ('prosecution_graph_nodes_id_case_uidx'),
      ('prosecution_graph_nodes_id_org_uidx'),
      ('prosecution_graph_edges_case_idx'),
      ('prosecution_graph_edges_org_idx'),
      ('prosecution_graph_edges_from_idx'),
      ('prosecution_graph_edges_to_idx'),
      ('prosecution_graph_edges_status_idx')
  ) AS required(req)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'i' AND c.relname = required.req
  );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '0032: missing graph integrity indexes: %', missing;
  END IF;
END $$;
