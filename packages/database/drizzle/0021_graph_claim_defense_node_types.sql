-- Additive graph_node_type values for Deepening Pass 3 civil graph enablement.
-- Enables 'claim' and 'defense' on shared matter graph_nodes only.
-- Does not rewrite existing graph rows or recreate the enum/table.
-- Does not apply to production Neon in this workstream.

ALTER TYPE "public"."graph_node_type" ADD VALUE IF NOT EXISTS 'claim';
ALTER TYPE "public"."graph_node_type" ADD VALUE IF NOT EXISTS 'defense';
