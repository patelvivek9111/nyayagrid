import {
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
  index,
  jsonb,
  integer,
  date,
  pgEnum,
  customType,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./index";

const vector384 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(384)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
});

/**
 * Phase 8 — Student Workspace (Nyaya Professor) and Public Workspace (Nyaya Guide).
 *
 * Every table in this file is scoped by `userId` alone. There is deliberately no organizationId
 * and no matterId column anywhere: study material and personal legal documents are private to the
 * individual user and must never be joinable against confidential professional matter data. The
 * shared `legal_authorities*` corpus is the only store these workspaces read across that boundary,
 * and it holds non-confidential reference material.
 */

/** How much depth an explanation should carry. Students choose; the model never escalates on its own. */
export const explanationLevelEnum = pgEnum("explanation_level", ["simple", "standard", "advanced"]);

export const studentCaseProcessingStateEnum = pgEnum("student_case_processing_state", [
  "uploaded",
  "extracting",
  "chunking",
  "embedding",
  "ready",
  "failed",
]);

export const guideDocumentProcessingStateEnum = pgEnum("guide_document_processing_state", [
  "uploaded",
  "extracting",
  "chunking",
  "embedding",
  "ready",
  "failed",
]);

/**
 * Where a Guide-facing statement came from. Keeping these apart is what stops a user's own
 * description of events from being presented back to them as legal authority.
 */
export const guideProvenanceNoteEnum = pgEnum("guide_provenance_note", [
  "user_provided",
  "document_extracted",
  "legal_authority",
  "guide_explanation",
]);

export type ExplanationLevel = (typeof explanationLevelEnum.enumValues)[number];
export type StudentCaseProcessingState = (typeof studentCaseProcessingStateEnum.enumValues)[number];
export type GuideDocumentProcessingState =
  (typeof guideDocumentProcessingStateEnum.enumValues)[number];
export type GuideProvenanceNote = (typeof guideProvenanceNoteEnum.enumValues)[number];

/**
 * Provenance classes for Professor answers. An uploaded case is the student's own material, legal
 * authority is the shared corpus, and an explanation is the model's own teaching language. None of
 * the three is interchangeable, and an explanation is never presented as a source.
 */
export type StudentProvenanceClass = "UPLOADED_CASE" | "LEGAL_AUTHORITY" | "PROFESSOR_EXPLANATION";

export type StudentSourceRef = {
  provenance: StudentProvenanceClass;
  caseId?: string;
  caseVersionId?: string;
  chunkId?: string;
  authorityId?: string;
  authorityChunkId?: string;
  page?: number | null;
  opinionPart?: "majority" | "concurrence" | "dissent" | null;
  quote?: string | null;
  note?: string;
};

export type StudentBriefSection = {
  text: string;
  chunkIds: string[];
};

/** Case brief sections from the Phase 8 spec. Concurrence and dissent stay out of the holding. */
export type StudentCaseBriefContent = {
  caseName: string;
  court: string | null;
  year: string | null;
  proceduralPosture: StudentBriefSection | null;
  parties: StudentBriefSection | null;
  materialFacts: StudentBriefSection;
  issue: StudentBriefSection;
  rule: StudentBriefSection;
  holding: StudentBriefSection;
  reasoning: StudentBriefSection;
  judgment: StudentBriefSection | null;
  concurrence: StudentBriefSection | null;
  dissent: StudentBriefSection | null;
  keyQuotations: Array<{ quote: string; chunkId: string; page?: number | null }>;
  importance: StudentBriefSection | null;
  openQuestions: string[];
  limitations: string[];
};

export type StudentSectionSource = {
  chunkId: string;
  quote: string;
  page?: number | null;
};

/** section name -> the passages that support it. Sections with no support are recorded as empty. */
export type StudentSectionSources = Record<string, StudentSectionSource[]>;

export type StudentComparisonField = {
  text: string;
  caseAChunkIds: string[];
  caseBChunkIds: string[];
};

export type StudentCaseComparisonContent = {
  facts: StudentComparisonField;
  issue: StudentComparisonField;
  rule: StudentComparisonField;
  reasoning: StudentComparisonField;
  holding: StudentComparisonField;
  outcome: StudentComparisonField;
  /** Only populated when passages from both cases actually support the divergence. */
  tensions: StudentComparisonField[];
  limitations: string[];
};

export const studentConversations = pgTable(
  "student_conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** When set, this thread is the persistent case-room conversation for that opinion. */
    caseId: uuid("case_id").references((): AnyPgColumn => studentCases.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    explanationLevel: explanationLevelEnum("explanation_level").notNull().default("standard"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("student_conversations_user_idx").on(table.userId),
    uniqueIndex("student_conversations_user_case_uidx")
      .on(table.userId, table.caseId)
      .where(sql`${table.caseId} IS NOT NULL`),
  ],
);

export const studentMessages = pgTable(
  "student_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => studentConversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant" | "system">().notNull(),
    content: text("content").notNull(),
    explanationLevel: explanationLevelEnum("explanation_level"),
    sources: jsonb("sources")
      .$type<StudentSourceRef[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** An optional question back to the student. Never forced, and never a substitute for the answer. */
    socraticFollowUp: text("socratic_follow_up"),
    provider: text("provider"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("student_messages_conversation_idx").on(table.conversationId),
    index("student_messages_user_idx").on(table.userId),
  ],
);

/** A judicial opinion the student uploaded or pasted. Personal study material, not firm evidence. */
export const studentCases = pgTable(
  "student_cases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    citation: text("citation"),
    court: text("court"),
    decisionDate: date("decision_date"),
    sourceType: text("source_type")
      .$type<"pasted_text" | "uploaded_file">()
      .notNull()
      .default("pasted_text"),
    processingState: studentCaseProcessingStateEnum("processing_state")
      .notNull()
      .default("uploaded"),
    processingError: text("processing_error"),
    storageKey: text("storage_key"),
    mimeType: text("mime_type"),
    sha256: text("sha256"),
    byteSize: integer("byte_size").notNull().default(0),
    /** Lightweight course folder label — not an LMS, just a string the student typed. */
    courseLabel: text("course_label"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("student_cases_user_idx").on(table.userId),
    index("student_cases_state_idx").on(table.processingState),
    uniqueIndex("student_cases_user_sha_uidx")
      .on(table.userId, table.sha256)
      .where(sql`${table.sha256} IS NOT NULL`),
  ],
);

/** Append-only case text. Re-uploading changed content adds a version instead of overwriting. */
export const studentCaseVersions = pgTable(
  "student_case_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => studentCases.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    content: text("content").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("student_case_versions_case_version_uidx").on(table.caseId, table.versionNumber),
    index("student_case_versions_case_idx").on(table.caseId),
    index("student_case_versions_user_idx").on(table.userId),
  ],
);

export const studentCaseChunks = pgTable(
  "student_case_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => studentCases.id, { onDelete: "cascade" }),
    caseVersionId: uuid("case_version_id")
      .notNull()
      .references(() => studentCaseVersions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    pageStart: integer("page_start"),
    pageEnd: integer("page_end"),
    segmentRef: text("segment_ref"),
    charStart: integer("char_start"),
    charEnd: integer("char_end"),
    /** Only set when the opinion text itself labels the part; never guessed as "majority". */
    opinionPart: text("opinion_part").$type<"majority" | "concurrence" | "dissent" | null>(),
    embedding: vector384("embedding"),
    embeddingModel: text("embedding_model"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("student_case_chunks_version_index_uidx").on(table.caseVersionId, table.chunkIndex),
    index("student_case_chunks_case_idx").on(table.caseId),
    index("student_case_chunks_user_idx").on(table.userId),
  ],
);

export const studentCaseBriefs = pgTable(
  "student_case_briefs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    caseId: uuid("case_id")
      .notNull()
      .references(() => studentCases.id, { onDelete: "cascade" }),
    caseVersionId: uuid("case_version_id")
      .notNull()
      .references(() => studentCaseVersions.id, { onDelete: "cascade" }),
    brief: jsonb("brief")
      .$type<StudentCaseBriefContent>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    sectionSources: jsonb("section_sources")
      .$type<StudentSectionSources>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    provider: text("provider"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("student_case_briefs_user_idx").on(table.userId),
    index("student_case_briefs_case_idx").on(table.caseId),
    uniqueIndex("student_case_briefs_version_uidx").on(table.caseVersionId),
  ],
);

export const studentCaseComparisons = pgTable(
  "student_case_comparisons",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    caseAId: uuid("case_a_id")
      .notNull()
      .references(() => studentCases.id, { onDelete: "cascade" }),
    caseBId: uuid("case_b_id")
      .notNull()
      .references(() => studentCases.id, { onDelete: "cascade" }),
    comparison: jsonb("comparison")
      .$type<StudentCaseComparisonContent>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    sources: jsonb("sources")
      .$type<StudentSourceRef[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    provider: text("provider"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("student_case_comparisons_user_idx").on(table.userId),
    index("student_case_comparisons_case_a_idx").on(table.caseAId),
    index("student_case_comparisons_case_b_idx").on(table.caseBId),
  ],
);

export const studentSavedItems = pgTable(
  "student_saved_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    itemType: text("item_type")
      .$type<"explanation" | "case_brief" | "authority" | "case_comparison">()
      .notNull(),
    title: text("title").notNull(),
    content: text("content"),
    ref: jsonb("ref")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    courseLabel: text("course_label"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("student_saved_items_user_idx").on(table.userId),
    index("student_saved_items_type_idx").on(table.itemType),
  ],
);

/**
 * Private study notes. User-scoped only — never written to professional `notes`.
 * `brief_challenge` flags a generated brief section without overwriting the validated brief.
 */
export const studentNotes = pgTable(
  "student_notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    caseId: uuid("case_id").references(() => studentCases.id, { onDelete: "cascade" }),
    briefId: uuid("brief_id").references(() => studentCaseBriefs.id, { onDelete: "set null" }),
    kind: text("kind").$type<"note" | "brief_challenge">().notNull().default("note"),
    sectionKey: text("section_key"),
    title: text("title").notNull(),
    content: text("content").notNull(),
    courseLabel: text("course_label"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("student_notes_user_idx").on(table.userId),
    index("student_notes_case_idx").on(table.caseId),
  ],
);

export type GuideSourceRef = {
  provenance: GuideProvenanceNote;
  documentId?: string;
  documentVersionId?: string;
  chunkId?: string;
  authorityId?: string;
  authorityChunkId?: string;
  page?: number | null;
  quote?: string | null;
  note?: string;
};

/** Dates copied verbatim from a document. Guide never computes a deadline from them. */
export type GuideExplicitDate = {
  rawText: string;
  isoDate: string | null;
  chunkId: string;
  page?: number | null;
  label?: string | null;
};

export type GuideDocumentExplanationContent = {
  plainLanguageSummary: string;
  obligations: string[];
  rightsMentioned: string[];
  risksOrUnusualLanguage: string[];
  termsNeedingClarification: string[];
  questionsForALawyer: string[];
  limitations: string[];
};

export type GuideConsultationPacketContent = {
  situationSummary: string;
  peopleInvolved: string[];
  timeline: Array<{ date: string | null; title: string; sourceLabel: GuideProvenanceNote }>;
  documentsAvailable: string[];
  questionsForTheLawyer: string[];
  desiredOutcome: string | null;
  missingInformation: string[];
  potentiallyUrgentItems: string[];
  limitations: string[];
};

export const guideConversations = pgTable(
  "guide_conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    jurisdiction: text("jurisdiction"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("guide_conversations_user_idx").on(table.userId)],
);

export const guideMessages = pgTable(
  "guide_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => guideConversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant" | "system">().notNull(),
    content: text("content").notNull(),
    sources: jsonb("sources")
      .$type<GuideSourceRef[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** elevated for safety-critical situations (deadlines, detention, eviction, personal safety). */
    cautionLevel: text("caution_level")
      .$type<"standard" | "elevated">()
      .notNull()
      .default("standard"),
    provider: text("provider"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("guide_messages_conversation_idx").on(table.conversationId),
    index("guide_messages_user_idx").on(table.userId),
  ],
);

export const guideDocuments = pgTable(
  "guide_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    documentKind: text("document_kind").$type<
      "lease" | "employment" | "court_notice" | "demand" | "settlement" | "other"
    >(),
    processingState: guideDocumentProcessingStateEnum("processing_state")
      .notNull()
      .default("uploaded"),
    processingError: text("processing_error"),
    storageKey: text("storage_key"),
    mimeType: text("mime_type"),
    sha256: text("sha256"),
    byteSize: integer("byte_size").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("guide_documents_user_idx").on(table.userId),
    index("guide_documents_state_idx").on(table.processingState),
    uniqueIndex("guide_documents_user_sha_uidx")
      .on(table.userId, table.sha256)
      .where(sql`${table.sha256} IS NOT NULL`),
  ],
);

export const guideDocumentVersions = pgTable(
  "guide_document_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => guideDocuments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    content: text("content").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("guide_document_versions_document_version_uidx").on(
      table.documentId,
      table.versionNumber,
    ),
    index("guide_document_versions_document_idx").on(table.documentId),
    index("guide_document_versions_user_idx").on(table.userId),
  ],
);

export const guideDocumentChunks = pgTable(
  "guide_document_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => guideDocuments.id, { onDelete: "cascade" }),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => guideDocumentVersions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    pageStart: integer("page_start"),
    pageEnd: integer("page_end"),
    segmentRef: text("segment_ref"),
    charStart: integer("char_start"),
    charEnd: integer("char_end"),
    embedding: vector384("embedding"),
    embeddingModel: text("embedding_model"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("guide_document_chunks_version_index_uidx").on(
      table.documentVersionId,
      table.chunkIndex,
    ),
    index("guide_document_chunks_document_idx").on(table.documentId),
    index("guide_document_chunks_user_idx").on(table.userId),
  ],
);

export const guideDocumentExplanations = pgTable(
  "guide_document_explanations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => guideDocuments.id, { onDelete: "cascade" }),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => guideDocumentVersions.id, { onDelete: "cascade" }),
    explanation: jsonb("explanation")
      .$type<GuideDocumentExplanationContent>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    explicitDates: jsonb("explicit_dates")
      .$type<GuideExplicitDate[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    sources: jsonb("sources")
      .$type<GuideSourceRef[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    provider: text("provider"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("guide_document_explanations_user_idx").on(table.userId),
    index("guide_document_explanations_document_idx").on(table.documentId),
  ],
);

export const guideSituations = pgTable(
  "guide_situations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    jurisdiction: text("jurisdiction"),
    issueCategory: text("issue_category"),
    desiredOutcome: text("desired_outcome"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("guide_situations_user_idx").on(table.userId)],
);

export const guideSituationEvents = pgTable(
  "guide_situation_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    situationId: uuid("situation_id")
      .notNull()
      .references(() => guideSituations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventDate: date("event_date"),
    eventDateEnd: date("event_date_end"),
    title: text("title").notNull(),
    description: text("description"),
    sourceLabel: guideProvenanceNoteEnum("source_label").notNull().default("user_provided"),
    guideDocumentId: uuid("guide_document_id").references(() => guideDocuments.id, {
      onDelete: "set null",
    }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("guide_situation_events_situation_idx").on(table.situationId),
    index("guide_situation_events_user_idx").on(table.userId),
  ],
);

export const guideSituationDocuments = pgTable(
  "guide_situation_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    situationId: uuid("situation_id")
      .notNull()
      .references(() => guideSituations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    guideDocumentId: uuid("guide_document_id")
      .notNull()
      .references(() => guideDocuments.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("guide_situation_documents_pair_uidx").on(table.situationId, table.guideDocumentId),
    index("guide_situation_documents_user_idx").on(table.userId),
    index("guide_situation_documents_document_idx").on(table.guideDocumentId),
  ],
);

export const guideConsultationPackets = pgTable(
  "guide_consultation_packets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    situationId: uuid("situation_id").references(() => guideSituations.id, {
      onDelete: "cascade",
    }),
    packet: jsonb("packet")
      .$type<GuideConsultationPacketContent>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    provider: text("provider"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("guide_consultation_packets_user_idx").on(table.userId),
    index("guide_consultation_packets_situation_idx").on(table.situationId),
  ],
);

export type StudentConversation = typeof studentConversations.$inferSelect;
export type StudentMessage = typeof studentMessages.$inferSelect;
export type StudentCase = typeof studentCases.$inferSelect;
export type StudentCaseVersion = typeof studentCaseVersions.$inferSelect;
export type StudentCaseChunk = typeof studentCaseChunks.$inferSelect;
export type StudentCaseBrief = typeof studentCaseBriefs.$inferSelect;
export type StudentCaseComparison = typeof studentCaseComparisons.$inferSelect;
export type StudentSavedItem = typeof studentSavedItems.$inferSelect;
export type StudentNote = typeof studentNotes.$inferSelect;
export type GuideConversation = typeof guideConversations.$inferSelect;
export type GuideMessage = typeof guideMessages.$inferSelect;
export type GuideDocument = typeof guideDocuments.$inferSelect;
export type GuideDocumentVersion = typeof guideDocumentVersions.$inferSelect;
export type GuideDocumentChunk = typeof guideDocumentChunks.$inferSelect;
export type GuideDocumentExplanation = typeof guideDocumentExplanations.$inferSelect;
export type GuideSituation = typeof guideSituations.$inferSelect;
export type GuideSituationEvent = typeof guideSituationEvents.$inferSelect;
export type GuideSituationDocument = typeof guideSituationDocuments.$inferSelect;
export type GuideConsultationPacket = typeof guideConsultationPackets.$inferSelect;
