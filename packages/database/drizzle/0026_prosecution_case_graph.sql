-- Prosecution case-scoped graph (PROS-GRAPH-01).
-- Upgrades stub tables created in 0018 (node_type/ref_id, from_ref/to_ref)
-- to reviewable node/edge schema. Stub rows are discarded (never productized).
-- Reverse with 0026_prosecution_case_graph.down.sql (restores 0018 stub shape).

DROP TABLE IF EXISTS "prosecution_graph_edges";
DROP TABLE IF EXISTS "prosecution_graph_nodes";

CREATE TABLE "prosecution_graph_nodes" (
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

CREATE UNIQUE INDEX "prosecution_graph_nodes_canonical_uidx"
  ON "prosecution_graph_nodes" ("criminal_case_id", "canonical_entity_type", "canonical_entity_id");
CREATE INDEX "prosecution_graph_nodes_case_idx"
  ON "prosecution_graph_nodes" ("criminal_case_id");
CREATE INDEX "prosecution_graph_nodes_org_idx"
  ON "prosecution_graph_nodes" ("organization_id");
CREATE INDEX "prosecution_graph_nodes_kind_idx"
  ON "prosecution_graph_nodes" ("criminal_case_id", "node_kind");

CREATE TABLE "prosecution_graph_edges" (
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

CREATE INDEX "prosecution_graph_edges_case_idx"
  ON "prosecution_graph_edges" ("criminal_case_id");
CREATE INDEX "prosecution_graph_edges_org_idx"
  ON "prosecution_graph_edges" ("organization_id");
CREATE INDEX "prosecution_graph_edges_from_idx"
  ON "prosecution_graph_edges" ("from_node_id");
CREATE INDEX "prosecution_graph_edges_to_idx"
  ON "prosecution_graph_edges" ("to_node_id");
CREATE INDEX "prosecution_graph_edges_status_idx"
  ON "prosecution_graph_edges" ("criminal_case_id", "status");
