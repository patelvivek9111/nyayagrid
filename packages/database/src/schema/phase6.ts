import {
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
  index,
  jsonb,
  integer,
  real,
  date,
  pgEnum,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { matters, organizations, users } from "./index";

const vector384 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(384)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
});

export const authorityTypeEnum = pgEnum("authority_type", [
  "case",
  "statute",
  "regulation",
  "constitution",
  "rule",
  "administrative_decision",
  "other",
]);
export const authorityIngestionStatusEnum = pgEnum("authority_ingestion_status", [
  "pending",
  "processing",
  "ready",
  "failed",
]);
export const authorityTreatmentStatusEnum = pgEnum("authority_treatment_status", [
  "unknown",
  "source_reported",
]);
export const authorityRelationshipTypeEnum = pgEnum("authority_relationship_type", [
  "cites",
  "interprets",
  "supersedes",
  "amends",
  "related",
]);
export const researchSessionStatusEnum = pgEnum("research_session_status", ["active", "archived"]);
export const matterAuthorityStatusEnum = pgEnum("matter_authority_status", [
  "saved",
  "key_authority",
  "rejected",
  "not_relevant",
]);
/**
 * Coarse weight labels only. NyayaGrid never assigns numeric authority scores and never
 * claims binding force without sufficient jurisdiction and court metadata.
 */
export const authorityWeightLabelEnum = pgEnum("authority_weight_label", [
  "potentially_binding",
  "persuasive",
  "unknown",
]);

export type AuthorityHierarchyNode = {
  level: string;
  ref: string;
  label?: string;
};

/**
 * Shared legal authority corpus. Deliberately has no organizationId/matterId: authorities are
 * public-domain-style reference material and must never be mixed with confidential matter data.
 */
export const legalAuthorities = pgTable(
  "legal_authorities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    authorityType: authorityTypeEnum("authority_type").notNull(),
    jurisdiction: text("jurisdiction"),
    court: text("court"),
    title: text("title").notNull(),
    shortTitle: text("short_title"),
    citation: text("citation"),
    normalizedCitation: text("normalized_citation"),
    docketNumber: text("docket_number"),
    decisionDate: date("decision_date"),
    effectiveDate: date("effective_date"),
    publicationStatus: text("publication_status"),
    sourceProvider: text("source_provider"),
    sourceExternalId: text("source_external_id"),
    canonicalSourceUrl: text("canonical_source_url"),
    ingestionStatus: authorityIngestionStatusEnum("ingestion_status").notNull().default("pending"),
    treatmentStatus: authorityTreatmentStatusEnum("treatment_status").notNull().default("unknown"),
    hierarchyPath: jsonb("hierarchy_path").$type<AuthorityHierarchyNode[]>().default([]),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("legal_authorities_source_uidx")
      .on(table.sourceProvider, table.sourceExternalId)
      .where(sql`${table.sourceProvider} IS NOT NULL AND ${table.sourceExternalId} IS NOT NULL`),
    index("legal_authorities_citation_idx").on(table.citation),
    index("legal_authorities_normalized_citation_idx").on(table.normalizedCitation),
    index("legal_authorities_jurisdiction_idx").on(table.jurisdiction),
    index("legal_authorities_type_idx").on(table.authorityType),
  ],
);

/** Append-only authority text. Existing rows are never overwritten; re-ingestion adds a version. */
export const legalAuthorityVersions = pgTable(
  "legal_authority_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    authorityId: uuid("authority_id")
      .notNull()
      .references(() => legalAuthorities.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    content: text("content").notNull(),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    validFrom: timestamp("valid_from", { withTimezone: true }).defaultNow().notNull(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    sourceProvider: text("source_provider"),
    sourceMetadata: jsonb("source_metadata").$type<Record<string, unknown>>().default({}),
    sha256: text("sha256"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("legal_authority_versions_authority_version_uidx").on(
      table.authorityId,
      table.versionNumber,
    ),
    index("legal_authority_versions_authority_idx").on(table.authorityId),
  ],
);

export const legalAuthorityChunks = pgTable(
  "legal_authority_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    authorityId: uuid("authority_id")
      .notNull()
      .references(() => legalAuthorities.id, { onDelete: "cascade" }),
    authorityVersionId: uuid("authority_version_id")
      .notNull()
      .references(() => legalAuthorityVersions.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    /** majority | concurrence | dissent for cases; null for statutes and other authority types. */
    opinionPart: text("opinion_part").$type<"majority" | "concurrence" | "dissent" | null>(),
    sectionRef: text("section_ref"),
    subsectionRef: text("subsection_ref"),
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
    uniqueIndex("legal_authority_chunks_version_index_uidx").on(
      table.authorityVersionId,
      table.chunkIndex,
    ),
    index("legal_authority_chunks_authority_idx").on(table.authorityId),
  ],
);

/** Outbound citations parsed from authority text. Unresolved citations keep toAuthorityId null. */
export const legalAuthorityCitations = pgTable(
  "legal_authority_citations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fromAuthorityId: uuid("from_authority_id")
      .notNull()
      .references(() => legalAuthorities.id, { onDelete: "cascade" }),
    toAuthorityId: uuid("to_authority_id").references(() => legalAuthorities.id, {
      onDelete: "set null",
    }),
    rawCitation: text("raw_citation").notNull(),
    normalizedCitation: text("normalized_citation"),
    pinpoint: text("pinpoint"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("legal_authority_citations_from_idx").on(table.fromAuthorityId),
    index("legal_authority_citations_to_idx").on(table.toAuthorityId),
    index("legal_authority_citations_normalized_idx").on(table.normalizedCitation),
  ],
);

export const legalAuthorityRelationships = pgTable(
  "legal_authority_relationships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fromAuthorityId: uuid("from_authority_id")
      .notNull()
      .references(() => legalAuthorities.id, { onDelete: "cascade" }),
    toAuthorityId: uuid("to_authority_id")
      .notNull()
      .references(() => legalAuthorities.id, { onDelete: "cascade" }),
    relationshipType: authorityRelationshipTypeEnum("relationship_type").notNull(),
    label: text("label"),
    origin: text("origin").$type<"parsed" | "reviewed" | "source_metadata">().notNull(),
    treatmentStatus: authorityTreatmentStatusEnum("treatment_status").notNull().default("unknown"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("legal_authority_relationships_edge_uidx").on(
      table.fromAuthorityId,
      table.toAuthorityId,
      table.relationshipType,
    ),
    index("legal_authority_relationships_from_idx").on(table.fromAuthorityId),
  ],
);

export const researchSessions = pgTable(
  "research_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id").references(() => matters.id, { onDelete: "cascade" }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    title: text("title").notNull(),
    status: researchSessionStatusEnum("status").notNull().default("active"),
    jurisdictionFilters: jsonb("jurisdiction_filters").$type<string[]>().default([]),
    authorityTypeFilters: jsonb("authority_type_filters").$type<string[]>().default([]),
    dateFrom: date("date_from"),
    dateTo: date("date_to"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("research_sessions_organization_idx").on(table.organizationId),
    index("research_sessions_matter_idx").on(table.matterId),
  ],
);

export const researchQueries = pgTable(
  "research_queries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => researchSessions.id, { onDelete: "cascade" }),
    queryText: text("query_text").notNull(),
    normalizedQuery: text("normalized_query"),
    filters: jsonb("filters").$type<Record<string, unknown>>().default({}),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("research_queries_session_idx").on(table.sessionId),
    index("research_queries_organization_idx").on(table.organizationId),
  ],
);

export const researchResults = pgTable(
  "research_results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => researchSessions.id, { onDelete: "cascade" }),
    queryId: uuid("query_id")
      .notNull()
      .references(() => researchQueries.id, { onDelete: "cascade" }),
    authorityId: uuid("authority_id")
      .notNull()
      .references(() => legalAuthorities.id, { onDelete: "cascade" }),
    authorityVersionId: uuid("authority_version_id")
      .notNull()
      .references(() => legalAuthorityVersions.id, { onDelete: "cascade" }),
    chunkId: uuid("chunk_id").references(() => legalAuthorityChunks.id, { onDelete: "set null" }),
    score: real("score"),
    snippet: text("snippet"),
    relevanceExplanation: text("relevance_explanation"),
    rank: integer("rank"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("research_results_query_idx").on(table.queryId),
    index("research_results_session_idx").on(table.sessionId),
    index("research_results_authority_idx").on(table.authorityId),
  ],
);

export const researchNotes = pgTable(
  "research_notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => researchSessions.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id").references(() => matters.id, { onDelete: "cascade" }),
    authorityId: uuid("authority_id").references(() => legalAuthorities.id, {
      onDelete: "set null",
    }),
    authorityChunkId: uuid("authority_chunk_id").references(() => legalAuthorityChunks.id, {
      onDelete: "set null",
    }),
    content: text("content").notNull(),
    origin: text("origin").$type<"manual" | "ai">().notNull().default("manual"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("research_notes_session_idx").on(table.sessionId),
    index("research_notes_matter_idx").on(table.matterId),
    index("research_notes_organization_idx").on(table.organizationId),
  ],
);

/**
 * Where a persisted assertion draws its support from. FACT_SOURCE points at confidential matter
 * document chunks; LEGAL_AUTHORITY points at shared corpus authority chunks. The two are never
 * interchangeable: matter documents are not legal authority.
 */
export type ResearchProvenanceClass = "FACT_SOURCE" | "LEGAL_AUTHORITY";

export type ResearchProposition = {
  text: string;
  authorityIds: string[];
  chunkIds?: string[];
  provenanceClass?: ResearchProvenanceClass;
  /** Matter document chunk ids, only ever set on FACT_SOURCE entries. */
  matterChunkIds?: string[];
};

export const researchArtifacts = pgTable(
  "research_artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => researchSessions.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id").references(() => matters.id, { onDelete: "cascade" }),
    artifactType: text("artifact_type")
      .$type<"synthesis" | "memo" | "authority_summary" | "contrary_search">()
      .notNull(),
    issue: text("issue"),
    answer: text("answer"),
    propositions: jsonb("propositions").$type<ResearchProposition[]>().default([]),
    supportingAuthorities: jsonb("supporting_authorities").$type<string[]>().default([]),
    contraryAuthorities: jsonb("contrary_authorities").$type<string[]>().default([]),
    jurisdictionAssumptions: jsonb("jurisdiction_assumptions").$type<string[]>().default([]),
    coverageWarnings: jsonb("coverage_warnings").$type<string[]>().default([]),
    provider: text("provider"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("research_artifacts_session_idx").on(table.sessionId),
    index("research_artifacts_matter_idx").on(table.matterId),
    index("research_artifacts_organization_idx").on(table.organizationId),
  ],
);

/** Join table linking confidential matters to shared corpus authorities. */
export const matterAuthorities = pgTable(
  "matter_authorities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    authorityId: uuid("authority_id")
      .notNull()
      .references(() => legalAuthorities.id, { onDelete: "cascade" }),
    status: matterAuthorityStatusEnum("status").notNull().default("saved"),
    relevanceNote: text("relevance_note"),
    addedByUserId: uuid("added_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("matter_authorities_matter_authority_uidx").on(table.matterId, table.authorityId),
    index("matter_authorities_organization_idx").on(table.organizationId),
    index("matter_authorities_authority_idx").on(table.authorityId),
  ],
);
