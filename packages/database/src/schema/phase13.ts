import {
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
  index,
  jsonb,
  integer,
  boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { matters, organizations, users } from "./index";

/**
 * Queue #9 — versioned legal-work recovery.
 *
 * Tradeoff: generic append-only version rows (JSON payload) for structured objects,
 * rather than one history table per feature. Payloads are small attribute snapshots
 * (timeline, memory, review, graph attributes, notes). Drafts keep `draft_versions`
 * as the canonical content store; generic rows point at those versions so restore
 * never duplicates large document bodies unnecessarily.
 *
 * Original uploaded evidence (`documents` / `document_versions` bytes) is not stored
 * here and must never be mutated by restore. Audit logs are not versioned through
 * this table — restorations write new audit events.
 */

export const legalWorkSessions = pgTable(
  "legal_work_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    reason: text("reason"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("legal_work_sessions_matter_idx").on(table.matterId),
    index("legal_work_sessions_actor_idx").on(table.actorUserId, table.startedAt),
  ],
);

export const legalWorkCheckpoints = pgTable(
  "legal_work_checkpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    kind: text("kind").notNull(),
    reason: text("reason"),
    sessionId: uuid("session_id").references(() => legalWorkSessions.id, { onDelete: "set null" }),
    parentActionId: uuid("parent_action_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("legal_work_checkpoints_matter_idx").on(table.matterId),
    index("legal_work_checkpoints_session_idx").on(table.sessionId),
  ],
);

export const legalWorkVersions = pgTable(
  "legal_work_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    source: text("source").notNull().default("user"),
    priorVersionId: uuid("prior_version_id"),
    actionId: uuid("action_id"),
    restorationOfVersionId: uuid("restoration_of_version_id"),
    nativeVersionId: uuid("native_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("legal_work_versions_object_version_uidx").on(
      table.objectType,
      table.objectId,
      table.versionNumber,
    ),
    index("legal_work_versions_matter_idx").on(table.matterId),
    index("legal_work_versions_object_idx").on(table.objectType, table.objectId),
  ],
);

export const legalWorkHeads = pgTable(
  "legal_work_heads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id").notNull(),
    currentVersionId: uuid("current_version_id")
      .notNull()
      .references(() => legalWorkVersions.id),
    currentVersionNumber: integer("current_version_number").notNull(),
    lockState: text("lock_state").notNull().default("unlocked"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedByUserId: uuid("locked_by_user_id").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("legal_work_heads_object_uidx").on(table.objectType, table.objectId),
    index("legal_work_heads_matter_idx").on(table.matterId),
  ],
);

export const legalWorkActions = pgTable(
  "legal_work_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id").notNull(),
    operation: text("operation").notNull(),
    source: text("source").notNull().default("user"),
    beforeVersionId: uuid("before_version_id").references(() => legalWorkVersions.id),
    afterVersionId: uuid("after_version_id").references(() => legalWorkVersions.id),
    sessionId: uuid("session_id").references(() => legalWorkSessions.id, { onDelete: "set null" }),
    checkpointId: uuid("checkpoint_id").references(() => legalWorkCheckpoints.id, {
      onDelete: "set null",
    }),
    parentActionId: uuid("parent_action_id"),
    reversible: boolean("reversible").notNull().default(true),
    irreversibleReason: text("irreversible_reason"),
    description: text("description"),
    aiArtifactId: uuid("ai_artifact_id"),
    provider: text("provider"),
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("legal_work_actions_matter_idx").on(table.matterId, table.createdAt),
    index("legal_work_actions_actor_idx").on(table.matterId, table.actorUserId, table.createdAt),
    index("legal_work_actions_object_idx").on(table.objectType, table.objectId, table.createdAt),
    index("legal_work_actions_session_idx").on(table.sessionId),
    index("legal_work_actions_checkpoint_idx").on(table.checkpointId),
  ],
);

export const legalWorkCheckpointItems = pgTable(
  "legal_work_checkpoint_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    checkpointId: uuid("checkpoint_id")
      .notNull()
      .references(() => legalWorkCheckpoints.id, { onDelete: "cascade" }),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id").notNull(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => legalWorkVersions.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("legal_work_checkpoint_items_uidx").on(
      table.checkpointId,
      table.objectType,
      table.objectId,
    ),
    index("legal_work_checkpoint_items_checkpoint_idx").on(table.checkpointId),
  ],
);

export const legalWorkRestorations = pgTable(
  "legal_work_restorations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id").notNull(),
    targetVersionId: uuid("target_version_id")
      .notNull()
      .references(() => legalWorkVersions.id),
    previousCurrentVersionId: uuid("previous_current_version_id")
      .notNull()
      .references(() => legalWorkVersions.id),
    restoredVersionId: uuid("restored_version_id")
      .notNull()
      .references(() => legalWorkVersions.id),
    actionId: uuid("action_id")
      .notNull()
      .references(() => legalWorkActions.id),
    sessionId: uuid("session_id").references(() => legalWorkSessions.id, { onDelete: "set null" }),
    checkpointId: uuid("checkpoint_id").references(() => legalWorkCheckpoints.id, {
      onDelete: "set null",
    }),
    reason: text("reason"),
    conflicts: jsonb("conflicts").$type<Record<string, unknown>>().notNull().default({}),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("legal_work_restorations_idempotency_uidx")
      .on(table.organizationId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    index("legal_work_restorations_matter_idx").on(table.matterId),
    index("legal_work_restorations_object_idx").on(table.objectType, table.objectId),
  ],
);

export const legalWorkStaleMarkers = pgTable(
  "legal_work_stale_markers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id").notNull(),
    sourceObjectType: text("source_object_type").notNull(),
    sourceObjectId: uuid("source_object_id").notNull(),
    sourceVersionId: uuid("source_version_id").references(() => legalWorkVersions.id),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id),
  },
  (table) => [
    uniqueIndex("legal_work_stale_markers_active_uidx")
      .on(table.objectType, table.objectId, table.sourceObjectType, table.sourceObjectId)
      .where(sql`${table.resolvedAt} IS NULL`),
    index("legal_work_stale_markers_matter_idx").on(table.matterId),
    index("legal_work_stale_markers_object_idx").on(table.objectType, table.objectId),
  ],
);

export type LegalWorkSession = typeof legalWorkSessions.$inferSelect;
export type LegalWorkCheckpoint = typeof legalWorkCheckpoints.$inferSelect;
export type LegalWorkVersion = typeof legalWorkVersions.$inferSelect;
export type LegalWorkHead = typeof legalWorkHeads.$inferSelect;
export type LegalWorkAction = typeof legalWorkActions.$inferSelect;
export type LegalWorkRestoration = typeof legalWorkRestorations.$inferSelect;
export type LegalWorkStaleMarker = typeof legalWorkStaleMarkers.$inferSelect;
