CREATE TYPE "public"."graph_node_type" AS ENUM('person', 'organization', 'client', 'document', 'event', 'fact', 'deadline', 'task', 'matter', 'other');
CREATE TYPE "public"."graph_edge_direction" AS ENUM('directed', 'undirected');
CREATE TYPE "public"."memory_status" AS ENUM('proposed', 'approved', 'edited_and_approved', 'rejected', 'archived', 'superseded');
CREATE TYPE "public"."memory_importance" AS ENUM('low', 'normal', 'high', 'critical');
CREATE TYPE "public"."memory_type" AS ENUM('verified_context', 'strategic_note', 'entity_resolution', 'document_significance', 'factual_caveat', 'user_instruction', 'matter_preference', 'procedural_context', 'other');

CREATE TABLE "graph_nodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "node_type" "graph_node_type" NOT NULL,
  "canonical_entity_type" text NOT NULL,
  "canonical_entity_id" uuid NOT NULL,
  "display_name" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "origin" "intelligence_origin" DEFAULT 'ai' NOT NULL,
  "status" "intelligence_status" DEFAULT 'approved' NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "graph_nodes_canonical_uidx" ON "graph_nodes" ("matter_id", "canonical_entity_type", "canonical_entity_id");
CREATE INDEX "graph_nodes_matter_idx" ON "graph_nodes" ("matter_id");
CREATE INDEX "graph_nodes_organization_idx" ON "graph_nodes" ("organization_id");
CREATE INDEX "graph_nodes_type_idx" ON "graph_nodes" ("matter_id", "node_type");

ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

CREATE TABLE "graph_edges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "from_node_id" uuid NOT NULL,
  "to_node_id" uuid NOT NULL,
  "relationship_type" text NOT NULL,
  "label" text,
  "direction" "graph_edge_direction" DEFAULT 'directed' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "origin" "intelligence_origin" DEFAULT 'ai' NOT NULL,
  "status" "intelligence_status" DEFAULT 'proposed' NOT NULL,
  "confidence" "confidence_level",
  "created_by_user_id" uuid,
  "approved_by_user_id" uuid,
  "approved_at" timestamp with time zone,
  "rejected_by_user_id" uuid,
  "rejected_at" timestamp with time zone,
  "rejection_reason" text,
  "dedupe_key" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "graph_edges_matter_idx" ON "graph_edges" ("matter_id");
CREATE INDEX "graph_edges_organization_idx" ON "graph_edges" ("organization_id");
CREATE INDEX "graph_edges_from_idx" ON "graph_edges" ("from_node_id");
CREATE INDEX "graph_edges_to_idx" ON "graph_edges" ("to_node_id");
CREATE INDEX "graph_edges_status_idx" ON "graph_edges" ("status");
CREATE INDEX "graph_edges_dedupe_idx" ON "graph_edges" ("matter_id", "dedupe_key");
CREATE UNIQUE INDEX "graph_edges_active_dedupe_uidx" ON "graph_edges" ("matter_id", "dedupe_key") WHERE "status" IN ('proposed', 'approved', 'edited_and_approved');

ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_from_node_id_graph_nodes_id_fk" FOREIGN KEY ("from_node_id") REFERENCES "public"."graph_nodes"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_to_node_id_graph_nodes_id_fk" FOREIGN KEY ("to_node_id") REFERENCES "public"."graph_nodes"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_rejected_by_user_id_users_id_fk" FOREIGN KEY ("rejected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

CREATE TABLE "graph_edge_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "graph_edge_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "document_version_id" uuid NOT NULL,
  "chunk_id" uuid NOT NULL,
  "page" integer,
  "segment_ref" text,
  "supporting_text" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "graph_edge_sources_edge_chunk_uidx" ON "graph_edge_sources" ("graph_edge_id", "chunk_id");
CREATE INDEX "graph_edge_sources_edge_idx" ON "graph_edge_sources" ("graph_edge_id");

ALTER TABLE "graph_edge_sources" ADD CONSTRAINT "graph_edge_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "graph_edge_sources" ADD CONSTRAINT "graph_edge_sources_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "graph_edge_sources" ADD CONSTRAINT "graph_edge_sources_graph_edge_id_graph_edges_id_fk" FOREIGN KEY ("graph_edge_id") REFERENCES "public"."graph_edges"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "graph_edge_sources" ADD CONSTRAINT "graph_edge_sources_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "graph_edge_sources" ADD CONSTRAINT "graph_edge_sources_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "graph_edge_sources" ADD CONSTRAINT "graph_edge_sources_chunk_id_document_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."document_chunks"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "matter_memories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "memory_type" "memory_type" DEFAULT 'other' NOT NULL,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "normalized_content" text,
  "status" "memory_status" DEFAULT 'proposed' NOT NULL,
  "origin" "intelligence_origin" DEFAULT 'manual' NOT NULL,
  "confidence" "confidence_level",
  "importance" "memory_importance" DEFAULT 'normal' NOT NULL,
  "created_by_user_id" uuid,
  "approved_by_user_id" uuid,
  "approved_at" timestamp with time zone,
  "rejected_by_user_id" uuid,
  "rejected_at" timestamp with time zone,
  "rejection_reason" text,
  "source_type" text,
  "source_reference" jsonb DEFAULT '{}'::jsonb,
  "expires_at" timestamp with time zone,
  "superseded_by" uuid,
  "embedding" vector(384),
  "embedding_model" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "matter_memories_matter_idx" ON "matter_memories" ("matter_id");
CREATE INDEX "matter_memories_organization_idx" ON "matter_memories" ("organization_id");
CREATE INDEX "matter_memories_status_idx" ON "matter_memories" ("status");
CREATE INDEX "matter_memories_type_idx" ON "matter_memories" ("matter_id", "memory_type");

ALTER TABLE "matter_memories" ADD CONSTRAINT "matter_memories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "matter_memories" ADD CONSTRAINT "matter_memories_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "matter_memories" ADD CONSTRAINT "matter_memories_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "matter_memories" ADD CONSTRAINT "matter_memories_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "matter_memories" ADD CONSTRAINT "matter_memories_rejected_by_user_id_users_id_fk" FOREIGN KEY ("rejected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "matter_memories" ADD CONSTRAINT "matter_memories_superseded_by_matter_memories_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."matter_memories"("id") ON DELETE set null ON UPDATE no action;

CREATE TABLE "graph_materialization_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "idempotency_key" text NOT NULL,
  "status" "intelligence_run_status" DEFAULT 'queued' NOT NULL,
  "stats" jsonb DEFAULT '{}'::jsonb,
  "last_error" text,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);

CREATE UNIQUE INDEX "graph_materialization_runs_idempotency_uidx" ON "graph_materialization_runs" ("idempotency_key");
CREATE INDEX "graph_materialization_runs_matter_idx" ON "graph_materialization_runs" ("matter_id");

ALTER TABLE "graph_materialization_runs" ADD CONSTRAINT "graph_materialization_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "graph_materialization_runs" ADD CONSTRAINT "graph_materialization_runs_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "graph_materialization_runs" ADD CONSTRAINT "graph_materialization_runs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
