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
  pgEnum,
  customType,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const organizationTypeEnum = pgEnum("organization_type", ["firm", "solo"]);
export const membershipStatusEnum = pgEnum("membership_status", ["active", "invited", "disabled"]);
export const workspaceTypeEnum = pgEnum("workspace_type", ["professional", "student", "public"]);
export const documentProcessingStateEnum = pgEnum("document_processing_state", [
  "uploaded",
  "quarantined",
  "awaiting_malware_scan",
  "malware_scan_failed",
  "unscanned_development",
  "scan_clean",
  "scan_blocked",
  "extracting_text",
  "requires_ocr",
  "extraction_failed",
  "chunking",
  "embedding",
  "indexed",
  "ready",
  "failed",
]);
export const malwareScanStatusEnum = pgEnum("malware_scan_status", [
  "not_scanned",
  "pending",
  "clean",
  "blocked",
  "failed",
  "development_unscanned",
]);
export const clientTypeEnum = pgEnum("client_type", ["individual", "organization"]);
export const clientStatusEnum = pgEnum("client_status", ["active", "archived"]);
export const matterStatusEnum = pgEnum("matter_status", [
  "intake",
  "open",
  "active",
  "on_hold",
  "closed",
  "archived",
]);
export const matterAccessEnum = pgEnum("matter_access", ["read", "comment", "edit", "manage"]);
export const taskStatusEnum = pgEnum("task_status", [
  "open",
  "in_progress",
  "completed",
  "cancelled",
]);
export const taskPriorityEnum = pgEnum("task_priority", ["low", "medium", "high", "urgent"]);
export const noteOriginEnum = pgEnum("note_origin", ["user", "nyaya"]);
export const intelligenceStatusEnum = pgEnum("intelligence_status", [
  "proposed",
  "approved",
  "edited_and_approved",
  "rejected",
]);
export const datePrecisionEnum = pgEnum("date_precision", [
  "exact",
  "approximate",
  "month",
  "year",
  "range",
  "unknown",
]);
export const intelligenceOriginEnum = pgEnum("intelligence_origin", ["ai", "manual"]);
export const matterEntityTypeEnum = pgEnum("matter_entity_type", ["person", "organization"]);
export const deadlineDateKindEnum = pgEnum("deadline_date_kind", ["explicit", "inferred"]);
export const confidenceLevelEnum = pgEnum("confidence_level", ["low", "medium", "high"]);
export const intelligenceRunStatusEnum = pgEnum("intelligence_run_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "skipped",
]);
export const graphNodeTypeEnum = pgEnum("graph_node_type", [
  "person",
  "organization",
  "client",
  "document",
  "event",
  "fact",
  "deadline",
  "task",
  "matter",
  "other",
]);
export const graphEdgeDirectionEnum = pgEnum("graph_edge_direction", ["directed", "undirected"]);
export const memoryStatusEnum = pgEnum("memory_status", [
  "proposed",
  "approved",
  "edited_and_approved",
  "rejected",
  "archived",
  "superseded",
]);
export const memoryImportanceEnum = pgEnum("memory_importance", [
  "low",
  "normal",
  "high",
  "critical",
]);
export const memoryTypeEnum = pgEnum("memory_type", [
  "verified_context",
  "strategic_note",
  "entity_resolution",
  "document_significance",
  "factual_caveat",
  "user_instruction",
  "matter_preference",
  "procedural_context",
  "other",
]);

const vector384 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(384)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: unknown): number[] {
    if (Array.isArray(value)) return value as number[];
    if (typeof value === "string") {
      return value
        .replace(/^\[/, "")
        .replace(/\]$/, "")
        .split(",")
        .map((v) => Number(v.trim()));
    }
    return [];
  },
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    authSubject: text("auth_subject").notNull(),
    email: text("email").notNull(),
    name: text("name"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("users_auth_subject_uidx").on(table.authSubject),
    uniqueIndex("users_email_uidx").on(table.email),
  ],
);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    type: organizationTypeEnum("type").notNull().default("firm"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("organizations_slug_uidx").on(table.slug)],
);

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("roles_org_key_uidx").on(table.organizationId, table.key),
    index("roles_organization_idx").on(table.organizationId),
  ],
);

export const permissions = pgTable(
  "permissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    capability: text("capability").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("permissions_role_capability_uidx").on(table.roleId, table.capability),
    index("permissions_role_idx").on(table.roleId),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    status: membershipStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("memberships_org_user_uidx").on(table.organizationId, table.userId),
    index("memberships_user_idx").on(table.userId),
    index("memberships_organization_idx").on(table.organizationId),
  ],
);

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientType: clientTypeEnum("client_type").notNull(),
    displayName: text("display_name").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    organizationName: text("organization_name"),
    email: text("email"),
    phone: text("phone"),
    status: clientStatusEnum("status").notNull().default("active"),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("clients_organization_idx").on(table.organizationId),
    index("clients_status_idx").on(table.status),
  ],
);

export const matters = pgTable(
  "matters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    matterNumber: text("matter_number").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    practiceArea: text("practice_area"),
    jurisdiction: text("jurisdiction"),
    court: text("court"),
    status: matterStatusEnum("status").notNull().default("open"),
    openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("matters_org_number_uidx").on(table.organizationId, table.matterNumber),
    index("matters_organization_idx").on(table.organizationId),
    index("matters_client_idx").on(table.clientId),
    index("matters_status_idx").on(table.status),
  ],
);

export const matterMembers = pgTable(
  "matter_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    access: matterAccessEnum("access").notNull().default("read"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("matter_members_matter_user_uidx").on(table.matterId, table.userId),
    index("matter_members_user_idx").on(table.userId),
    index("matter_members_organization_idx").on(table.organizationId),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id").references(() => matters.id, { onDelete: "cascade" }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    title: text("title").notNull(),
    processingState: documentProcessingStateEnum("processing_state").notNull().default("uploaded"),
    malwareScanStatus: malwareScanStatusEnum("malware_scan_status")
      .notNull()
      .default("not_scanned"),
    processingError: text("processing_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("documents_organization_idx").on(table.organizationId),
    index("documents_matter_idx").on(table.matterId),
  ],
);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    originalFilename: text("original_filename").notNull(),
    uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("document_versions_doc_version_uidx").on(table.documentId, table.versionNumber),
    index("document_versions_organization_idx").on(table.organizationId),
    uniqueIndex("document_versions_storage_key_uidx").on(table.storageKey),
  ],
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    pageStart: integer("page_start"),
    pageEnd: integer("page_end"),
    segmentRef: text("segment_ref"),
    charStart: integer("char_start"),
    charEnd: integer("char_end"),
    tokenCount: integer("token_count"),
    searchVector: text("search_vector"),
    embedding: vector384("embedding"),
    embeddingModel: text("embedding_model"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("document_chunks_version_index_uidx").on(table.documentVersionId, table.chunkIndex),
    index("document_chunks_organization_idx").on(table.organizationId),
    index("document_chunks_matter_idx").on(table.matterId),
    index("document_chunks_document_idx").on(table.documentId),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("conversations_matter_idx").on(table.matterId),
    index("conversations_organization_idx").on(table.organizationId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("messages_conversation_idx").on(table.conversationId),
    index("messages_matter_idx").on(table.matterId),
  ],
);

export const aiArtifacts = pgTable(
  "ai_artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    artifactType: text("artifact_type").notNull().default("matter_qa"),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    evidenceState: text("evidence_state").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    retrievedChunkIds: jsonb("retrieved_chunk_ids").$type<string[]>().default([]),
    citations: jsonb("citations")
      .$type<
        Array<{
          chunkId: string;
          documentId: string;
          documentVersionId: string;
          page?: number | null;
          segmentRef?: string | null;
          quote: string;
        }>
      >()
      .default([]),
    validation: jsonb("validation").$type<Record<string, unknown>>().default({}),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("ai_artifacts_matter_idx").on(table.matterId),
    index("ai_artifacts_organization_idx").on(table.organizationId),
  ],
);

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    origin: noteOriginEnum("origin").notNull().default("user"),
    aiArtifactId: uuid("ai_artifact_id").references(() => aiArtifacts.id, {
      onDelete: "set null",
    }),
    citations: jsonb("citations").$type<unknown[]>().default([]),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("notes_matter_idx").on(table.matterId),
    index("notes_organization_idx").on(table.organizationId),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: taskStatusEnum("status").notNull().default("open"),
    priority: taskPriorityEnum("priority").notNull().default("medium"),
    assignedToUserId: uuid("assigned_to_user_id").references(() => users.id),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    sourceNoteId: uuid("source_note_id").references(() => notes.id, { onDelete: "set null" }),
    sourceArtifactId: uuid("source_artifact_id").references(() => aiArtifacts.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("tasks_matter_idx").on(table.matterId),
    index("tasks_organization_idx").on(table.organizationId),
    index("tasks_assignee_idx").on(table.assignedToUserId),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    matterId: uuid("matter_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_events_organization_idx").on(table.organizationId),
    index("audit_events_actor_idx").on(table.actorUserId),
    index("audit_events_action_idx").on(table.action),
  ],
);

export const aiJobs = pgTable(
  "ai_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    jobType: text("job_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("queued"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ai_jobs_idempotency_uidx").on(table.idempotencyKey),
    index("ai_jobs_organization_idx").on(table.organizationId),
  ],
);

export const documentIntelligenceRuns = pgTable(
  "document_intelligence_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    runKind: text("run_kind").notNull(),
    status: intelligenceRunStatusEnum("status").notNull().default("queued"),
    idempotencyKey: text("idempotency_key").notNull(),
    provider: text("provider"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    stats: jsonb("stats").$type<Record<string, unknown>>().default({}),
    lastError: text("last_error"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("document_intelligence_runs_idempotency_uidx").on(table.idempotencyKey),
    index("document_intelligence_runs_matter_idx").on(table.matterId),
    index("document_intelligence_runs_document_version_idx").on(table.documentVersionId),
  ],
);

export const timelineEvents = pgTable(
  "timeline_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    eventType: text("event_type").notNull(),
    eventDate: timestamp("event_date", { withTimezone: true }),
    eventDateEnd: timestamp("event_date_end", { withTimezone: true }),
    datePrecision: datePrecisionEnum("date_precision").notNull().default("unknown"),
    status: intelligenceStatusEnum("status").notNull().default("proposed"),
    confidence: confidenceLevelEnum("confidence").notNull().default("medium"),
    origin: intelligenceOriginEnum("origin").notNull().default("ai"),
    actors: jsonb("actors").$type<string[]>().default([]),
    uncertaintyNotes: text("uncertainty_notes"),
    dedupeKey: text("dedupe_key"),
    extractionRunId: uuid("extraction_run_id").references(() => documentIntelligenceRuns.id, {
      onDelete: "set null",
    }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedByUserId: uuid("rejected_by_user_id").references(() => users.id),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("timeline_events_matter_idx").on(table.matterId),
    index("timeline_events_organization_idx").on(table.organizationId),
    index("timeline_events_status_idx").on(table.status),
    index("timeline_events_event_date_idx").on(table.eventDate),
    index("timeline_events_dedupe_idx").on(table.matterId, table.dedupeKey),
  ],
);

export const timelineEventSources = pgTable(
  "timeline_event_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    timelineEventId: uuid("timeline_event_id")
      .notNull()
      .references(() => timelineEvents.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    chunkId: uuid("chunk_id")
      .notNull()
      .references(() => documentChunks.id, { onDelete: "cascade" }),
    page: integer("page"),
    segmentRef: text("segment_ref"),
    supportingText: text("supporting_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("timeline_event_sources_event_chunk_uidx").on(table.timelineEventId, table.chunkId),
    index("timeline_event_sources_event_idx").on(table.timelineEventId),
    index("timeline_event_sources_chunk_idx").on(table.chunkId),
  ],
);

export const matterFacts = pgTable(
  "matter_facts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    factKey: text("fact_key").notNull(),
    label: text("label").notNull(),
    value: text("value").notNull(),
    normalizedValue: text("normalized_value"),
    status: intelligenceStatusEnum("status").notNull().default("proposed"),
    confidence: confidenceLevelEnum("confidence").notNull().default("medium"),
    origin: intelligenceOriginEnum("origin").notNull().default("ai"),
    uncertaintyNotes: text("uncertainty_notes"),
    extractionRunId: uuid("extraction_run_id").references(() => documentIntelligenceRuns.id, {
      onDelete: "set null",
    }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedByUserId: uuid("rejected_by_user_id").references(() => users.id),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("matter_facts_matter_idx").on(table.matterId),
    index("matter_facts_status_idx").on(table.status),
  ],
);

export const matterFactSources = pgTable(
  "matter_fact_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    matterFactId: uuid("matter_fact_id")
      .notNull()
      .references(() => matterFacts.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    chunkId: uuid("chunk_id")
      .notNull()
      .references(() => documentChunks.id, { onDelete: "cascade" }),
    page: integer("page"),
    segmentRef: text("segment_ref"),
    supportingText: text("supporting_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("matter_fact_sources_fact_chunk_uidx").on(table.matterFactId, table.chunkId),
    index("matter_fact_sources_fact_idx").on(table.matterFactId),
  ],
);

export const matterEntities = pgTable(
  "matter_entities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    entityType: matterEntityTypeEnum("entity_type").notNull(),
    displayName: text("display_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    description: text("description"),
    status: intelligenceStatusEnum("status").notNull().default("proposed"),
    confidence: confidenceLevelEnum("confidence").notNull().default("medium"),
    origin: intelligenceOriginEnum("origin").notNull().default("ai"),
    mergedIntoEntityId: uuid("merged_into_entity_id"),
    extractionRunId: uuid("extraction_run_id").references(() => documentIntelligenceRuns.id, {
      onDelete: "set null",
    }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedByUserId: uuid("rejected_by_user_id").references(() => users.id),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("matter_entities_matter_idx").on(table.matterId),
    index("matter_entities_normalized_idx").on(table.matterId, table.normalizedName),
    index("matter_entities_status_idx").on(table.status),
  ],
);

export const entityAliases = pgTable(
  "entity_aliases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => matterEntities.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("entity_aliases_entity_alias_uidx").on(table.entityId, table.alias),
    index("entity_aliases_matter_idx").on(table.matterId),
  ],
);

export const entityRoles = pgTable(
  "entity_roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => matterEntities.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    status: intelligenceStatusEnum("status").notNull().default("proposed"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("entity_roles_entity_role_uidx").on(table.entityId, table.role),
    index("entity_roles_matter_idx").on(table.matterId),
  ],
);

export const entitySources = pgTable(
  "entity_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => matterEntities.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    chunkId: uuid("chunk_id")
      .notNull()
      .references(() => documentChunks.id, { onDelete: "cascade" }),
    page: integer("page"),
    segmentRef: text("segment_ref"),
    supportingText: text("supporting_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("entity_sources_entity_chunk_uidx").on(table.entityId, table.chunkId),
    index("entity_sources_entity_idx").on(table.entityId),
  ],
);

export const deadlineCandidates = pgTable(
  "deadline_candidates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    dueAtEnd: timestamp("due_at_end", { withTimezone: true }),
    datePrecision: datePrecisionEnum("date_precision").notNull().default("unknown"),
    dateKind: deadlineDateKindEnum("date_kind").notNull().default("explicit"),
    timezone: text("timezone"),
    status: intelligenceStatusEnum("status").notNull().default("proposed"),
    confidence: confidenceLevelEnum("confidence").notNull().default("medium"),
    origin: intelligenceOriginEnum("origin").notNull().default("ai"),
    uncertaintyNotes: text("uncertainty_notes"),
    extractionRunId: uuid("extraction_run_id").references(() => documentIntelligenceRuns.id, {
      onDelete: "set null",
    }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedByUserId: uuid("rejected_by_user_id").references(() => users.id),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("deadline_candidates_matter_idx").on(table.matterId),
    index("deadline_candidates_status_idx").on(table.status),
    index("deadline_candidates_due_at_idx").on(table.dueAt),
  ],
);

export const deadlineCandidateSources = pgTable(
  "deadline_candidate_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    deadlineCandidateId: uuid("deadline_candidate_id")
      .notNull()
      .references(() => deadlineCandidates.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    chunkId: uuid("chunk_id")
      .notNull()
      .references(() => documentChunks.id, { onDelete: "cascade" }),
    page: integer("page"),
    segmentRef: text("segment_ref"),
    supportingText: text("supporting_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("deadline_candidate_sources_deadline_chunk_uidx").on(
      table.deadlineCandidateId,
      table.chunkId,
    ),
    index("deadline_candidate_sources_deadline_idx").on(table.deadlineCandidateId),
  ],
);

export const matterSummaries = pgTable(
  "matter_summaries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    provenance: jsonb("provenance").$type<Record<string, unknown>>().default({}),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("matter_summaries_matter_idx").on(table.matterId)],
);

export const graphNodes = pgTable(
  "graph_nodes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    nodeType: graphNodeTypeEnum("node_type").notNull(),
    canonicalEntityType: text("canonical_entity_type").notNull(),
    canonicalEntityId: uuid("canonical_entity_id").notNull(),
    displayName: text("display_name").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    origin: intelligenceOriginEnum("origin").notNull().default("ai"),
    status: intelligenceStatusEnum("status").notNull().default("approved"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("graph_nodes_canonical_uidx").on(
      table.matterId,
      table.canonicalEntityType,
      table.canonicalEntityId,
    ),
    index("graph_nodes_matter_idx").on(table.matterId),
    index("graph_nodes_organization_idx").on(table.organizationId),
    index("graph_nodes_type_idx").on(table.matterId, table.nodeType),
  ],
);

export const graphEdges = pgTable(
  "graph_edges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    fromNodeId: uuid("from_node_id")
      .notNull()
      .references(() => graphNodes.id, { onDelete: "cascade" }),
    toNodeId: uuid("to_node_id")
      .notNull()
      .references(() => graphNodes.id, { onDelete: "cascade" }),
    relationshipType: text("relationship_type").notNull(),
    label: text("label"),
    direction: graphEdgeDirectionEnum("direction").notNull().default("directed"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    origin: intelligenceOriginEnum("origin").notNull().default("ai"),
    status: intelligenceStatusEnum("status").notNull().default("proposed"),
    confidence: confidenceLevelEnum("confidence"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedByUserId: uuid("rejected_by_user_id").references(() => users.id),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    dedupeKey: text("dedupe_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("graph_edges_matter_idx").on(table.matterId),
    index("graph_edges_organization_idx").on(table.organizationId),
    index("graph_edges_from_idx").on(table.fromNodeId),
    index("graph_edges_to_idx").on(table.toNodeId),
    index("graph_edges_status_idx").on(table.status),
    index("graph_edges_dedupe_idx").on(table.matterId, table.dedupeKey),
  ],
);

export const graphEdgeSources = pgTable(
  "graph_edge_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    graphEdgeId: uuid("graph_edge_id")
      .notNull()
      .references(() => graphEdges.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    chunkId: uuid("chunk_id")
      .notNull()
      .references(() => documentChunks.id, { onDelete: "cascade" }),
    page: integer("page"),
    segmentRef: text("segment_ref"),
    supportingText: text("supporting_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("graph_edge_sources_edge_chunk_uidx").on(table.graphEdgeId, table.chunkId),
    index("graph_edge_sources_edge_idx").on(table.graphEdgeId),
  ],
);

export const matterMemories = pgTable(
  "matter_memories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    memoryType: memoryTypeEnum("memory_type").notNull().default("other"),
    title: text("title").notNull(),
    content: text("content").notNull(),
    normalizedContent: text("normalized_content"),
    status: memoryStatusEnum("status").notNull().default("proposed"),
    origin: intelligenceOriginEnum("origin").notNull().default("manual"),
    confidence: confidenceLevelEnum("confidence"),
    importance: memoryImportanceEnum("importance").notNull().default("normal"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedByUserId: uuid("rejected_by_user_id").references(() => users.id),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    sourceType: text("source_type"),
    sourceReference: jsonb("source_reference").$type<Record<string, unknown>>().default({}),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    supersededBy: uuid("superseded_by"),
    embedding: vector384("embedding"),
    embeddingModel: text("embedding_model"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("matter_memories_matter_idx").on(table.matterId),
    index("matter_memories_organization_idx").on(table.organizationId),
    index("matter_memories_status_idx").on(table.status),
    index("matter_memories_type_idx").on(table.matterId, table.memoryType),
  ],
);

export const graphMaterializationRuns = pgTable(
  "graph_materialization_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    status: intelligenceRunStatusEnum("status").notNull().default("queued"),
    stats: jsonb("stats").$type<Record<string, unknown>>().default({}),
    lastError: text("last_error"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("graph_materialization_runs_idempotency_uidx").on(table.idempotencyKey),
    index("graph_materialization_runs_matter_idx").on(table.matterId),
  ],
);

// Note: phase5 tables intentionally live in ./phase5.ts and are re-exported from the
// package root (../index.ts) instead of from here. phase5.ts imports base tables/enums
// from this file, so re-exporting it here would create a circular ESM dependency that
// leaves symbols like confidenceLevelEnum unresolved when this module is the entry point.

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
}));

export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  roles: many(roles),
  clients: many(clients),
  matters: many(matters),
  documents: many(documents),
}));

export const clientsRelations = relations(clients, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [clients.organizationId],
    references: [organizations.id],
  }),
  matters: many(matters),
}));

export const mattersRelations = relations(matters, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [matters.organizationId],
    references: [organizations.id],
  }),
  client: one(clients, {
    fields: [matters.clientId],
    references: [clients.id],
  }),
  members: many(matterMembers),
  documents: many(documents),
}));

export const matterMembersRelations = relations(matterMembers, ({ one }) => ({
  matter: one(matters, {
    fields: [matterMembers.matterId],
    references: [matters.id],
  }),
  user: one(users, {
    fields: [matterMembers.userId],
    references: [users.id],
  }),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  organization: one(organizations, {
    fields: [memberships.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [memberships.userId],
    references: [users.id],
  }),
  role: one(roles, {
    fields: [memberships.roleId],
    references: [roles.id],
  }),
}));

export const rolesRelations = relations(roles, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [roles.organizationId],
    references: [organizations.id],
  }),
  permissions: many(permissions),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [documents.organizationId],
    references: [organizations.id],
  }),
  matter: one(matters, {
    fields: [documents.matterId],
    references: [matters.id],
  }),
  versions: many(documentVersions),
  chunks: many(documentChunks),
}));

export const documentChunksRelations = relations(documentChunks, ({ one }) => ({
  document: one(documents, {
    fields: [documentChunks.documentId],
    references: [documents.id],
  }),
}));

export const conversationsRelations = relations(conversations, ({ many }) => ({
  messages: many(messages),
}));

export const aiArtifactsRelations = relations(aiArtifacts, ({ one }) => ({
  matter: one(matters, {
    fields: [aiArtifacts.matterId],
    references: [matters.id],
  }),
}));
