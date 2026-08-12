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
} from "drizzle-orm/pg-core";
import {
  confidenceLevelEnum,
  documentChunks,
  documents,
  documentVersions,
  matters,
  organizations,
  users,
} from "./index";

export const draftStatusEnum = pgEnum("draft_status", ["draft", "in_review", "final", "archived"]);
export const draftOriginEnum = pgEnum("draft_origin", ["manual", "ai", "ai_edited"]);
export const analysisAttentionEnum = pgEnum("analysis_attention", [
  "informational",
  "review",
  "high_attention",
]);
export const analysisItemStatusEnum = pgEnum("analysis_item_status", [
  "proposed",
  "reviewed",
  "dismissed",
]);
export const redlineStatusEnum = pgEnum("redline_status", ["proposed", "accepted", "rejected"]);
export const comparisonChangeTypeEnum = pgEnum("comparison_change_type", [
  "added",
  "removed",
  "changed",
  "moved",
  "formatting",
]);
export const analysisRunTypeEnum = pgEnum("analysis_run_type", [
  "contract",
  "deposition",
  "evidence",
  "contradiction",
  "document_review",
  "discovery",
  "comparison",
]);
export const relevanceStatusEnum = pgEnum("relevance_status", [
  "unknown",
  "relevant",
  "not_relevant",
]);
export const privilegeStatusEnum = pgEnum("privilege_status", [
  "unknown",
  "potentially_privileged",
  "privileged",
  "not_privileged",
]);
export const responsivenessStatusEnum = pgEnum("responsiveness_status", [
  "unknown",
  "responsive",
  "not_responsive",
]);
export const confidentialityStatusEnum = pgEnum("confidentiality_status", [
  "unknown",
  "confidential",
  "not_confidential",
]);

export const drafts = pgTable(
  "drafts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    draftType: text("draft_type").notNull(),
    status: draftStatusEnum("status").notNull().default("draft"),
    currentVersionNumber: integer("current_version_number").notNull().default(1),
    aiGenerated: boolean("ai_generated").notNull().default(false),
    sourceContext: jsonb("source_context").$type<Record<string, unknown>>().default({}),
    promptVersion: text("prompt_version"),
    provider: text("provider"),
    model: text("model"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("drafts_matter_idx").on(table.matterId),
    index("drafts_organization_idx").on(table.organizationId),
  ],
);

export const draftVersions = pgTable(
  "draft_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    content: text("content").notNull(),
    changeSummary: text("change_summary"),
    origin: draftOriginEnum("origin").notNull().default("manual"),
    sourceAssertions: jsonb("source_assertions")
      .$type<
        Array<{
          text: string;
          chunkIds: string[];
          /**
           * FACT_SOURCE chunkIds are matter document chunks; LEGAL_AUTHORITY chunkIds are legal
           * corpus authority chunks. Older rows predate the distinction and have no value.
           */
          provenanceClass?: "FACT_SOURCE" | "LEGAL_AUTHORITY";
          authorityIds?: string[];
        }>
      >()
      .default([]),
    provider: text("provider"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("draft_versions_draft_version_uidx").on(table.draftId, table.versionNumber),
    index("draft_versions_matter_idx").on(table.matterId),
  ],
);

export const documentAnalyses = pgTable(
  "document_analyses",
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
    analysisType: text("analysis_type").notNull().default("contract"),
    summary: text("summary"),
    status: analysisItemStatusEnum("status").notNull().default("proposed"),
    provider: text("provider"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("document_analyses_idempotency_uidx").on(table.idempotencyKey),
    index("document_analyses_matter_idx").on(table.matterId),
    index("document_analyses_document_idx").on(table.documentId),
  ],
);

export const documentAnalysisItems = pgTable(
  "document_analysis_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => documentAnalyses.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    originalText: text("original_text"),
    explanation: text("explanation"),
    attention: analysisAttentionEnum("attention").notNull().default("informational"),
    status: analysisItemStatusEnum("status").notNull().default("proposed"),
    confidence: confidenceLevelEnum("confidence").notNull().default("medium"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => [index("document_analysis_items_analysis_idx").on(table.analysisId)],
);

export const documentAnalysisSources = pgTable(
  "document_analysis_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    analysisItemId: uuid("analysis_item_id")
      .notNull()
      .references(() => documentAnalysisItems.id, { onDelete: "cascade" }),
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
    uniqueIndex("document_analysis_sources_item_chunk_uidx").on(
      table.analysisItemId,
      table.chunkId,
    ),
  ],
);

export const redlineSuggestions = pgTable(
  "redline_suggestions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    analysisId: uuid("analysis_id").references(() => documentAnalyses.id, { onDelete: "set null" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    currentClause: text("current_clause").notNull(),
    proposedClause: text("proposed_clause").notNull(),
    reason: text("reason").notNull(),
    issue: text("issue"),
    status: redlineStatusEnum("status").notNull().default("proposed"),
    chunkId: uuid("chunk_id").references(() => documentChunks.id, { onDelete: "set null" }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("redline_suggestions_matter_idx").on(table.matterId)],
);

export const documentComparisons = pgTable(
  "document_comparisons",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    documentAId: uuid("document_a_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    documentAVersionId: uuid("document_a_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    documentBId: uuid("document_b_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    documentBVersionId: uuid("document_b_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    summary: text("summary"),
    idempotencyKey: text("idempotency_key").notNull(),
    provider: text("provider"),
    model: text("model"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("document_comparisons_idempotency_uidx").on(table.idempotencyKey),
    index("document_comparisons_matter_idx").on(table.matterId),
  ],
);

export const documentComparisonChanges = pgTable(
  "document_comparison_changes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    comparisonId: uuid("comparison_id")
      .notNull()
      .references(() => documentComparisons.id, { onDelete: "cascade" }),
    changeType: comparisonChangeTypeEnum("change_type").notNull(),
    locationA: text("location_a"),
    locationB: text("location_b"),
    oldText: text("old_text"),
    newText: text("new_text"),
    explanation: text("explanation"),
    attention: analysisAttentionEnum("attention").notNull().default("informational"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("document_comparison_changes_comparison_idx").on(table.comparisonId)],
);

export const analysisRuns = pgTable(
  "analysis_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    runType: analysisRunTypeEnum("run_type").notNull(),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }),
    documentVersionId: uuid("document_version_id").references(() => documentVersions.id, {
      onDelete: "cascade",
    }),
    status: analysisItemStatusEnum("status").notNull().default("proposed"),
    summary: text("summary"),
    idempotencyKey: text("idempotency_key").notNull(),
    provider: text("provider"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("analysis_runs_idempotency_uidx").on(table.idempotencyKey),
    index("analysis_runs_matter_idx").on(table.matterId),
  ],
);

export const analysisFindings = pgTable(
  "analysis_findings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    analysisRunId: uuid("analysis_run_id")
      .notNull()
      .references(() => analysisRuns.id, { onDelete: "cascade" }),
    findingType: text("finding_type").notNull(),
    title: text("title").notNull(),
    explanation: text("explanation"),
    confidence: confidenceLevelEnum("confidence").notNull().default("medium"),
    status: analysisItemStatusEnum("status").notNull().default("proposed"),
    attention: analysisAttentionEnum("attention").notNull().default("review"),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("analysis_findings_run_idx").on(table.analysisRunId),
    index("analysis_findings_matter_idx").on(table.matterId),
  ],
);

export const analysisFindingSources = pgTable(
  "analysis_finding_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => analysisFindings.id, { onDelete: "cascade" }),
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
    side: text("side"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("analysis_finding_sources_finding_chunk_side_uidx").on(
      table.findingId,
      table.chunkId,
      table.side,
    ),
  ],
);

export const documentReviewStates = pgTable(
  "document_review_states",
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
    relevance: relevanceStatusEnum("relevance").notNull().default("unknown"),
    privilege: privilegeStatusEnum("privilege").notNull().default("unknown"),
    responsiveness: responsivenessStatusEnum("responsiveness").notNull().default("unknown"),
    confidentiality: confidentialityStatusEnum("confidentiality").notNull().default("unknown"),
    aiRelevance: relevanceStatusEnum("ai_relevance"),
    aiPrivilege: privilegeStatusEnum("ai_privilege"),
    aiResponsiveness: responsivenessStatusEnum("ai_responsiveness"),
    aiProposalNote: text("ai_proposal_note"),
    humanPrivilegeFinal: boolean("human_privilege_final").notNull().default(false),
    important: boolean("important").notNull().default(false),
    reviewNotes: text("review_notes"),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("document_review_states_matter_document_uidx").on(table.matterId, table.documentId),
    index("document_review_states_matter_idx").on(table.matterId),
  ],
);

export const matterDocumentTags = pgTable(
  "matter_document_tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("matter_document_tags_matter_key_uidx").on(table.matterId, table.key)],
);

export const documentTagAssignments = pgTable(
  "document_tag_assignments",
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
    tagId: uuid("tag_id")
      .notNull()
      .references(() => matterDocumentTags.id, { onDelete: "cascade" }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("document_tag_assignments_doc_tag_uidx").on(table.documentId, table.tagId),
  ],
);

export const documentDuplicateGroups = pgTable(
  "document_duplicate_groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    groupType: text("group_type").notNull().default("exact_hash"),
    fingerprint: text("fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("document_duplicate_groups_matter_fp_uidx").on(
      table.matterId,
      table.groupType,
      table.fingerprint,
    ),
  ],
);

export const documentDuplicateMembers = pgTable(
  "document_duplicate_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => documentDuplicateGroups.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("document_duplicate_members_group_doc_uidx").on(table.groupId, table.documentId),
  ],
);
