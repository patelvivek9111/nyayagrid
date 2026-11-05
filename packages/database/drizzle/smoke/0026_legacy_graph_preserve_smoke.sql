-- Disposable smoke: seed 0018-shaped legacy graph rows, apply 0026 semantics,
-- assert archive + proposed backfill, then rollback restore.
-- Intended for local disposable DBs only.

BEGIN;

-- Reset graph tables to stub shape for the test.
DROP TABLE IF EXISTS prosecution_graph_edges CASCADE;
DROP TABLE IF EXISTS prosecution_graph_nodes CASCADE;
DROP TABLE IF EXISTS prosecution_graph_edges_0018_archive CASCADE;
DROP TABLE IF EXISTS prosecution_graph_nodes_0018_archive CASCADE;

CREATE TABLE prosecution_graph_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  criminal_case_id uuid NOT NULL REFERENCES criminal_cases(id) ON DELETE cascade,
  node_type text NOT NULL,
  ref_id text NOT NULL,
  provenance jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE prosecution_graph_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  criminal_case_id uuid NOT NULL REFERENCES criminal_cases(id) ON DELETE cascade,
  from_ref text NOT NULL,
  to_ref text NOT NULL,
  relationship text NOT NULL,
  provenance jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

COMMIT;
