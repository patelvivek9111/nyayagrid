-- Rollback PROS-GRAPH-01 reviewable schema to 0018 stub shape.
-- Prefer restoring archived rows when archives exist.
-- Limitation: reviewable-only rows created after 0026 are discarded on rollback.
-- Archives themselves are retained unless an operator later drops them.

DROP TABLE IF EXISTS "prosecution_graph_edges";
DROP TABLE IF EXISTS "prosecution_graph_nodes";

CREATE TABLE "prosecution_graph_nodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "node_type" text NOT NULL,
  "ref_id" text NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "prosecution_graph_nodes_ref_uidx"
  ON "prosecution_graph_nodes" ("criminal_case_id", "node_type", "ref_id");
CREATE INDEX "prosecution_graph_nodes_case_idx"
  ON "prosecution_graph_nodes" ("criminal_case_id");
ALTER TABLE "prosecution_graph_nodes"
  ADD CONSTRAINT "prosecution_graph_nodes_organization_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_graph_nodes"
  ADD CONSTRAINT "prosecution_graph_nodes_case_fk"
  FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "prosecution_graph_edges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "criminal_case_id" uuid NOT NULL,
  "from_ref" text NOT NULL,
  "to_ref" text NOT NULL,
  "relationship" text NOT NULL,
  "provenance" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "prosecution_graph_edges_case_idx"
  ON "prosecution_graph_edges" ("criminal_case_id");
ALTER TABLE "prosecution_graph_edges"
  ADD CONSTRAINT "prosecution_graph_edges_organization_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "prosecution_graph_edges"
  ADD CONSTRAINT "prosecution_graph_edges_case_fk"
  FOREIGN KEY ("criminal_case_id") REFERENCES "public"."criminal_cases"("id") ON DELETE cascade ON UPDATE no action;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'prosecution_graph_nodes_0018_archive'
  ) THEN
    INSERT INTO "prosecution_graph_nodes" (
      "id", "organization_id", "criminal_case_id", "node_type", "ref_id", "provenance", "created_at"
    )
    SELECT
      a."id", a."organization_id", a."criminal_case_id", a."node_type", a."ref_id",
      a."provenance", a."created_at"
    FROM "prosecution_graph_nodes_0018_archive" a
    ON CONFLICT DO NOTHING;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'prosecution_graph_edges_0018_archive'
  ) THEN
    INSERT INTO "prosecution_graph_edges" (
      "id", "organization_id", "criminal_case_id", "from_ref", "to_ref",
      "relationship", "provenance", "created_at"
    )
    SELECT
      a."id", a."organization_id", a."criminal_case_id", a."from_ref", a."to_ref",
      a."relationship", a."provenance", a."created_at"
    FROM "prosecution_graph_edges_0018_archive" a
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
