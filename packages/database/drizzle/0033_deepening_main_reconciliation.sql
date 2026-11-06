-- WP-06B: reconcile Deepening-era 0025–0028 journal collision with main PR #6–#9 schema.
-- Historical when values 1788300000000–1788600000000 may already be journaled under
-- Deepening tags (drop_professor / disclosure / legal_workflow / office_operations).
-- Drizzle will not re-apply main 0025–0028 SQL in that case; 0029–0032 are additive repairs.
-- This migration fail-closes unless the main product contract is present, while allowing
-- Deepening additive prosecution columns to coexist. Never drops Deepening columns/archives.
-- Reverse: 0033_deepening_main_reconciliation.down.sql (intentionally no-op).
--> statement-breakpoint
DO $$
DECLARE
  missing text;
  deepening_marker boolean := false;
BEGIN
  -- Detect Deepening additive marker (disclosure deepening 0026).
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'prosecution_discovery_items'
      AND column_name = 'title'
  ) INTO deepening_marker;

  -- Main contract: prosecution memories
  IF to_regclass('public.prosecution_case_memories') IS NULL THEN
    RAISE EXCEPTION '0033: prosecution_case_memories missing — main 0025/0029 path incomplete';
  END IF;

  -- Main contract: contacts / folders
  IF to_regclass('public.contacts') IS NULL THEN
    RAISE EXCEPTION '0033: contacts missing — main 0027/0029 path incomplete';
  END IF;
  IF to_regclass('public.document_folders') IS NULL THEN
    RAISE EXCEPTION '0033: document_folders missing — main 0027/0029 path incomplete';
  END IF;
  IF to_regclass('public.client_contacts') IS NULL THEN
    RAISE EXCEPTION '0033: client_contacts missing — main 0027/0029 path incomplete';
  END IF;

  -- Main contract: billing columns
  SELECT string_agg(c, ', ') INTO missing
  FROM (VALUES ('billable'), ('hourly_rate_cents')) AS required(c)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'time_entries' AND column_name = required.c
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '0033: time_entries missing billing columns: %', missing;
  END IF;

  SELECT string_agg(c, ', ') INTO missing
  FROM (VALUES ('total_minutes'), ('total_cents')) AS required(c)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = required.c
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '0033: invoices missing billing columns: %', missing;
  END IF;

  -- Main contract: reviewable graph (not stub)
  IF to_regclass('public.prosecution_graph_nodes') IS NULL
     OR to_regclass('public.prosecution_graph_edges') IS NULL THEN
    RAISE EXCEPTION '0033: prosecution graph tables missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'prosecution_graph_nodes'
      AND column_name = 'node_kind'
  ) THEN
    RAISE EXCEPTION '0033: graph still stub-shaped (no node_kind) — refuse unknown/partial upgrade';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'prosecution_graph_nodes'
      AND column_name = 'node_type'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'prosecution_graph_nodes'
      AND column_name = 'node_kind'
  ) THEN
    RAISE EXCEPTION '0033: unknown mixed stub graph shape';
  END IF;

  -- Required isolation FKs from 0032
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_graph_nodes_case_org_fk') THEN
    RAISE EXCEPTION '0033: missing prosecution_graph_nodes_case_org_fk';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_graph_edges_from_case_fk') THEN
    RAISE EXCEPTION '0033: missing prosecution_graph_edges_from_case_fk';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prosecution_graph_edges_to_case_fk') THEN
    RAISE EXCEPTION '0033: missing prosecution_graph_edges_to_case_fk';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_contacts_contact_org_fk') THEN
    RAISE EXCEPTION '0033: missing client_contacts_contact_org_fk';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_folders_matter_org_fk') THEN
    RAISE EXCEPTION '0033: missing document_folders_matter_org_fk';
  END IF;

  -- Never destroy 0018 archives if present
  -- (presence is optional; absence is fine on clean main installs)

  RAISE NOTICE '0033: main product contract OK; deepening_marker=%', deepening_marker;
END $$;
