-- Queue #9 — versioned legal-work recovery (append-only history).
-- Restores create NEW versions. Historical rows are never overwritten or deleted.
-- Original uploaded evidence is not stored here and must not be mutated by restore.
--
-- Reversible: see 0017_legal_work_recovery.down.sql (drop triggers + tables + retired_at).
-- Down is not auto-applied; restore a DB snapshot if this migration must be rolled back
-- after data has been written.

ALTER TABLE "timeline_events" ADD COLUMN IF NOT EXISTS "retired_at" timestamp with time zone;

CREATE TABLE "legal_work_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "actor_user_id" uuid NOT NULL,
  "reason" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ended_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "legal_work_sessions_matter_idx" ON "legal_work_sessions" ("matter_id");
CREATE INDEX "legal_work_sessions_actor_idx" ON "legal_work_sessions" ("actor_user_id", "started_at");
ALTER TABLE "legal_work_sessions" ADD CONSTRAINT "legal_work_sessions_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "legal_work_sessions" ADD CONSTRAINT "legal_work_sessions_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "legal_work_sessions" ADD CONSTRAINT "legal_work_sessions_actor_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

CREATE TABLE "legal_work_checkpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "actor_user_id" uuid,
  "kind" text NOT NULL,
  "reason" text,
  "session_id" uuid,
  "parent_action_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "legal_work_checkpoints_matter_idx" ON "legal_work_checkpoints" ("matter_id");
CREATE INDEX "legal_work_checkpoints_session_idx" ON "legal_work_checkpoints" ("session_id");
ALTER TABLE "legal_work_checkpoints" ADD CONSTRAINT "legal_work_checkpoints_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "legal_work_checkpoints" ADD CONSTRAINT "legal_work_checkpoints_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "legal_work_checkpoints" ADD CONSTRAINT "legal_work_checkpoints_actor_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "legal_work_checkpoints" ADD CONSTRAINT "legal_work_checkpoints_session_fk" FOREIGN KEY ("session_id") REFERENCES "public"."legal_work_sessions"("id") ON DELETE set null ON UPDATE no action;

CREATE TABLE "legal_work_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "object_type" text NOT NULL,
  "object_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "actor_user_id" uuid,
  "source" text DEFAULT 'user' NOT NULL,
  "prior_version_id" uuid,
  "action_id" uuid,
  "restoration_of_version_id" uuid,
  "native_version_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "legal_work_versions_object_version_uidx" ON "legal_work_versions" ("object_type", "object_id", "version_number");
CREATE INDEX "legal_work_versions_matter_idx" ON "legal_work_versions" ("matter_id");
CREATE INDEX "legal_work_versions_object_idx" ON "legal_work_versions" ("object_type", "object_id");
ALTER TABLE "legal_work_versions" ADD CONSTRAINT "legal_work_versions_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "legal_work_versions" ADD CONSTRAINT "legal_work_versions_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "legal_work_versions" ADD CONSTRAINT "legal_work_versions_actor_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

CREATE TABLE "legal_work_heads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "object_type" text NOT NULL,
  "object_id" uuid NOT NULL,
  "current_version_id" uuid NOT NULL,
  "current_version_number" integer NOT NULL,
  "lock_state" text DEFAULT 'unlocked' NOT NULL,
  "locked_at" timestamp with time zone,
  "locked_by_user_id" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "legal_work_heads_object_uidx" ON "legal_work_heads" ("object_type", "object_id");
CREATE INDEX "legal_work_heads_matter_idx" ON "legal_work_heads" ("matter_id");
ALTER TABLE "legal_work_heads" ADD CONSTRAINT "legal_work_heads_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "legal_work_heads" ADD CONSTRAINT "legal_work_heads_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "legal_work_heads" ADD CONSTRAINT "legal_work_heads_current_version_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."legal_work_versions"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "legal_work_heads" ADD CONSTRAINT "legal_work_heads_locked_by_fk" FOREIGN KEY ("locked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

CREATE TABLE "legal_work_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "actor_user_id" uuid NOT NULL,
  "object_type" text NOT NULL,
  "object_id" uuid NOT NULL,
  "operation" text NOT NULL,
  "source" text DEFAULT 'user' NOT NULL,
  "before_version_id" uuid,
  "after_version_id" uuid,
  "session_id" uuid,
  "checkpoint_id" uuid,
  "parent_action_id" uuid,
  "reversible" boolean DEFAULT true NOT NULL,
  "irreversible_reason" text,
  "description" text,
  "ai_artifact_id" uuid,
  "provider" text,
  "model" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "legal_work_actions_matter_idx" ON "legal_work_actions" ("matter_id", "created_at");
CREATE INDEX "legal_work_actions_actor_idx" ON "legal_work_actions" ("matter_id", "actor_user_id", "created_at");
CREATE INDEX "legal_work_actions_object_idx" ON "legal_work_actions" ("object_type", "object_id", "created_at");
CREATE INDEX "legal_work_actions_session_idx" ON "legal_work_actions" ("session_id");
CREATE INDEX "legal_work_actions_checkpoint_idx" ON "legal_work_actions" ("checkpoint_id");
ALTER TABLE "legal_work_actions" ADD CONSTRAINT "legal_work_actions_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "legal_work_actions" ADD CONSTRAINT "legal_work_actions_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "legal_work_actions" ADD CONSTRAINT "legal_work_actions_actor_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "legal_work_actions" ADD CONSTRAINT "legal_work_actions_before_version_fk" FOREIGN KEY ("before_version_id") REFERENCES "public"."legal_work_versions"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "legal_work_actions" ADD CONSTRAINT "legal_work_actions_after_version_fk" FOREIGN KEY ("after_version_id") REFERENCES "public"."legal_work_versions"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "legal_work_actions" ADD CONSTRAINT "legal_work_actions_session_fk" FOREIGN KEY ("session_id") REFERENCES "public"."legal_work_sessions"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "legal_work_actions" ADD CONSTRAINT "legal_work_actions_checkpoint_fk" FOREIGN KEY ("checkpoint_id") REFERENCES "public"."legal_work_checkpoints"("id") ON DELETE set null ON UPDATE no action;

CREATE TABLE "legal_work_checkpoint_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "checkpoint_id" uuid NOT NULL,
  "object_type" text NOT NULL,
  "object_id" uuid NOT NULL,
  "version_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "legal_work_checkpoint_items_uidx" ON "legal_work_checkpoint_items" ("checkpoint_id", "object_type", "object_id");
CREATE INDEX "legal_work_checkpoint_items_checkpoint_idx" ON "legal_work_checkpoint_items" ("checkpoint_id");
ALTER TABLE "legal_work_checkpoint_items" ADD CONSTRAINT "legal_work_checkpoint_items_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "legal_work_checkpoint_items" ADD CONSTRAINT "legal_work_checkpoint_items_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "legal_work_checkpoint_items" ADD CONSTRAINT "legal_work_checkpoint_items_checkpoint_fk" FOREIGN KEY ("checkpoint_id") REFERENCES "public"."legal_work_checkpoints"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "legal_work_checkpoint_items" ADD CONSTRAINT "legal_work_checkpoint_items_version_fk" FOREIGN KEY ("version_id") REFERENCES "public"."legal_work_versions"("id") ON DELETE restrict ON UPDATE no action;

CREATE TABLE "legal_work_restorations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "actor_user_id" uuid NOT NULL,
  "object_type" text NOT NULL,
  "object_id" uuid NOT NULL,
  "target_version_id" uuid NOT NULL,
  "previous_current_version_id" uuid NOT NULL,
  "restored_version_id" uuid NOT NULL,
  "action_id" uuid NOT NULL,
  "session_id" uuid,
  "checkpoint_id" uuid,
  "reason" text,
  "conflicts" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "idempotency_key" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "legal_work_restorations_idempotency_uidx" ON "legal_work_restorations" ("organization_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE INDEX "legal_work_restorations_matter_idx" ON "legal_work_restorations" ("matter_id");
CREATE INDEX "legal_work_restorations_object_idx" ON "legal_work_restorations" ("object_type", "object_id");
ALTER TABLE "legal_work_restorations" ADD CONSTRAINT "legal_work_restorations_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "legal_work_restorations" ADD CONSTRAINT "legal_work_restorations_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "legal_work_restorations" ADD CONSTRAINT "legal_work_restorations_actor_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "legal_work_restorations" ADD CONSTRAINT "legal_work_restorations_target_version_fk" FOREIGN KEY ("target_version_id") REFERENCES "public"."legal_work_versions"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "legal_work_restorations" ADD CONSTRAINT "legal_work_restorations_previous_version_fk" FOREIGN KEY ("previous_current_version_id") REFERENCES "public"."legal_work_versions"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "legal_work_restorations" ADD CONSTRAINT "legal_work_restorations_restored_version_fk" FOREIGN KEY ("restored_version_id") REFERENCES "public"."legal_work_versions"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "legal_work_restorations" ADD CONSTRAINT "legal_work_restorations_action_fk" FOREIGN KEY ("action_id") REFERENCES "public"."legal_work_actions"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "legal_work_restorations" ADD CONSTRAINT "legal_work_restorations_session_fk" FOREIGN KEY ("session_id") REFERENCES "public"."legal_work_sessions"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "legal_work_restorations" ADD CONSTRAINT "legal_work_restorations_checkpoint_fk" FOREIGN KEY ("checkpoint_id") REFERENCES "public"."legal_work_checkpoints"("id") ON DELETE set null ON UPDATE no action;

CREATE TABLE "legal_work_stale_markers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "object_type" text NOT NULL,
  "object_id" uuid NOT NULL,
  "source_object_type" text NOT NULL,
  "source_object_id" uuid NOT NULL,
  "source_version_id" uuid,
  "reason" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  "resolved_by_user_id" uuid
);
CREATE UNIQUE INDEX "legal_work_stale_markers_active_uidx" ON "legal_work_stale_markers" ("object_type", "object_id", "source_object_type", "source_object_id") WHERE "resolved_at" IS NULL;
CREATE INDEX "legal_work_stale_markers_matter_idx" ON "legal_work_stale_markers" ("matter_id");
CREATE INDEX "legal_work_stale_markers_object_idx" ON "legal_work_stale_markers" ("object_type", "object_id");
ALTER TABLE "legal_work_stale_markers" ADD CONSTRAINT "legal_work_stale_markers_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "legal_work_stale_markers" ADD CONSTRAINT "legal_work_stale_markers_matter_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "legal_work_stale_markers" ADD CONSTRAINT "legal_work_stale_markers_source_version_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."legal_work_versions"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "legal_work_stale_markers" ADD CONSTRAINT "legal_work_stale_markers_resolved_by_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

CREATE OR REPLACE FUNCTION legal_work_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'legal work history is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER legal_work_versions_immutable
  BEFORE UPDATE OR DELETE ON legal_work_versions
  FOR EACH ROW EXECUTE PROCEDURE legal_work_reject_mutation();

CREATE TRIGGER legal_work_actions_immutable
  BEFORE UPDATE OR DELETE ON legal_work_actions
  FOR EACH ROW EXECUTE PROCEDURE legal_work_reject_mutation();

CREATE TRIGGER legal_work_restorations_immutable
  BEFORE UPDATE OR DELETE ON legal_work_restorations
  FOR EACH ROW EXECUTE PROCEDURE legal_work_reject_mutation();

CREATE TRIGGER legal_work_checkpoints_immutable
  BEFORE UPDATE OR DELETE ON legal_work_checkpoints
  FOR EACH ROW EXECUTE PROCEDURE legal_work_reject_mutation();

CREATE TRIGGER legal_work_checkpoint_items_immutable
  BEFORE UPDATE OR DELETE ON legal_work_checkpoint_items
  FOR EACH ROW EXECUTE PROCEDURE legal_work_reject_mutation();
