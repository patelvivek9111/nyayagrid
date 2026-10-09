/**
 * Phase 16 — Discovery / Production ledger persistence.
 *
 * Additive matter-scoped tables for Deepening Pass 4.
 * Reuses documents, civil_evidence_items, matter_entities, and tasks.
 * communication_id / motion_id harden to matter_communications / matter_motions
 * via composite FKs in migration 0023 (orphans nulled safely).
 * motion_document_id remains a convenience document pointer.
 * No sanctions or privilege legal-conclusion columns.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { documents, matterEntities, matters, organizations, tasks, users } from "./index";
import { type RecordProvenance } from "./phase14";
import { civilEvidenceItems } from "./phase15";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

const provenanceCol = () => jsonb("provenance").$type<RecordProvenance>().notNull();

export const discoveryRequestSets = pgTable(
  "discovery_request_sets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    discoveryType: text("discovery_type").notNull(),
    requestingPartyEntityId: uuid("requesting_party_entity_id")
      .notNull()
      .references(() => matterEntities.id, { onDelete: "restrict" }),
    respondingPartyEntityId: uuid("responding_party_entity_id")
      .notNull()
      .references(() => matterEntities.id, { onDelete: "restrict" }),
    servedAt: timestamp("served_at", { withTimezone: true }),
    responseDueAt: timestamp("response_due_at", { withTimezone: true }),
    sourceDocumentId: uuid("source_document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    isCurrent: boolean("is_current").notNull().default(true),
    supersededById: uuid("superseded_by_id"),
    provenance: provenanceCol(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("discovery_request_sets_id_matter_uidx").on(table.id, table.matterId),
    uniqueIndex("discovery_request_sets_id_org_uidx").on(table.id, table.organizationId),
    index("discovery_request_sets_org_matter_idx").on(table.organizationId, table.matterId),
    index("discovery_request_sets_matter_current_idx").on(table.matterId, table.isCurrent),
    index("discovery_request_sets_type_idx").on(table.matterId, table.discoveryType),
  ],
);

export const discoveryRequestItems = pgTable(
  "discovery_request_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    setId: uuid("set_id")
      .notNull()
      .references(() => discoveryRequestSets.id, { onDelete: "cascade" }),
    requestNumber: text("request_number").notNull(),
    title: text("title").notNull(),
    requestText: text("request_text").notNull().default(""),
    status: text("status").notNull().default("OPEN"),
    requestingPartyEntityId: uuid("requesting_party_entity_id")
      .notNull()
      .references(() => matterEntities.id, { onDelete: "restrict" }),
    respondingPartyEntityId: uuid("responding_party_entity_id")
      .notNull()
      .references(() => matterEntities.id, { onDelete: "restrict" }),
    servedAt: timestamp("served_at", { withTimezone: true }),
    responseDueAt: timestamp("response_due_at", { withTimezone: true }),
    provenance: provenanceCol(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("discovery_request_items_id_matter_uidx").on(table.id, table.matterId),
    uniqueIndex("discovery_request_items_id_org_uidx").on(table.id, table.organizationId),
    uniqueIndex("discovery_request_items_set_number_uidx").on(table.setId, table.requestNumber),
    index("discovery_request_items_set_idx").on(table.setId),
    index("discovery_request_items_org_matter_idx").on(table.organizationId, table.matterId),
    index("discovery_request_items_status_idx").on(table.matterId, table.status),
  ],
);

export const discoveryResponses = pgTable(
  "discovery_responses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => discoveryRequestItems.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    isSupplemental: boolean("is_supplemental").notNull().default(false),
    supplementsResponseId: uuid("supplements_response_id"),
    substantiveText: text("substantive_text"),
    sourceDocumentId: uuid("source_document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    provenance: provenanceCol(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("discovery_responses_id_matter_uidx").on(table.id, table.matterId),
    uniqueIndex("discovery_responses_id_org_uidx").on(table.id, table.organizationId),
    index("discovery_responses_item_idx").on(table.itemId),
    index("discovery_responses_item_date_idx").on(table.itemId, table.respondedAt),
    index("discovery_responses_org_matter_idx").on(table.organizationId, table.matterId),
  ],
);

export const discoveryObjections = pgTable(
  "discovery_objections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => discoveryRequestItems.id, { onDelete: "cascade" }),
    responseId: uuid("response_id")
      .notNull()
      .references(() => discoveryResponses.id, { onDelete: "cascade" }),
    basis: text("basis").notNull(),
    text: text("text").notNull().default(""),
    provenance: provenanceCol(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("discovery_objections_id_matter_uidx").on(table.id, table.matterId),
    index("discovery_objections_response_idx").on(table.responseId),
    index("discovery_objections_item_idx").on(table.itemId),
    index("discovery_objections_org_matter_idx").on(table.organizationId, table.matterId),
  ],
);

export const discoveryProductions = pgTable(
  "discovery_productions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    producingPartyEntityId: uuid("producing_party_entity_id")
      .notNull()
      .references(() => matterEntities.id, { onDelete: "restrict" }),
    receivingPartyEntityId: uuid("receiving_party_entity_id")
      .notNull()
      .references(() => matterEntities.id, { onDelete: "restrict" }),
    producedAt: timestamp("produced_at", { withTimezone: true }),
    isSupplemental: boolean("is_supplemental").notNull().default(false),
    supplementsProductionId: uuid("supplements_production_id"),
    transmittalDocumentId: uuid("transmittal_document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    provenance: provenanceCol(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("discovery_productions_id_matter_uidx").on(table.id, table.matterId),
    uniqueIndex("discovery_productions_id_org_uidx").on(table.id, table.organizationId),
    index("discovery_productions_org_matter_idx").on(table.organizationId, table.matterId),
    index("discovery_productions_matter_date_idx").on(table.matterId, table.producedAt),
    index("discovery_productions_party_idx").on(table.matterId, table.producingPartyEntityId),
  ],
);

export const discoveryProductionItems = pgTable(
  "discovery_production_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    productionId: uuid("production_id")
      .notNull()
      .references(() => discoveryProductions.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }),
    evidenceId: uuid("evidence_id").references(() => civilEvidenceItems.id, {
      onDelete: "cascade",
    }),
    requestItemId: uuid("request_item_id").references(() => discoveryRequestItems.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("discovery_production_items_production_idx").on(table.productionId),
    index("discovery_production_items_document_idx").on(table.documentId),
    index("discovery_production_items_evidence_idx").on(table.evidenceId),
    index("discovery_production_items_org_matter_idx").on(table.organizationId, table.matterId),
  ],
);

export const discoveryBatesRanges = pgTable(
  "discovery_bates_ranges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    productionId: uuid("production_id")
      .notNull()
      .references(() => discoveryProductions.id, { onDelete: "cascade" }),
    prefix: text("prefix").notNull().default(""),
    startNumber: integer("start_number"),
    endNumber: integer("end_number"),
    rawText: text("raw_text").notNull().default(""),
    provenance: provenanceCol(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("discovery_bates_ranges_id_matter_uidx").on(table.id, table.matterId),
    index("discovery_bates_ranges_production_idx").on(table.productionId),
    index("discovery_bates_ranges_prefix_idx").on(table.matterId, table.prefix),
    index("discovery_bates_ranges_org_matter_idx").on(table.organizationId, table.matterId),
  ],
);

export const discoveryProductionCustodians = pgTable(
  "discovery_production_custodians",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    productionId: uuid("production_id")
      .notNull()
      .references(() => discoveryProductions.id, { onDelete: "cascade" }),
    custodianEntityId: uuid("custodian_entity_id")
      .notNull()
      .references(() => matterEntities.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("discovery_production_custodians_uidx").on(
      table.productionId,
      table.custodianEntityId,
    ),
    index("discovery_production_custodians_org_matter_idx").on(
      table.organizationId,
      table.matterId,
    ),
  ],
);

export const discoveryResponseProductions = pgTable(
  "discovery_response_productions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    responseId: uuid("response_id")
      .notNull()
      .references(() => discoveryResponses.id, { onDelete: "cascade" }),
    productionId: uuid("production_id")
      .notNull()
      .references(() => discoveryProductions.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("discovery_response_productions_uidx").on(table.responseId, table.productionId),
    index("discovery_response_productions_org_matter_idx").on(
      table.organizationId,
      table.matterId,
    ),
  ],
);

export const discoveryMeetAndConferIssues = pgTable(
  "discovery_meet_and_confer_issues",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    /** Opaque matter-scoped communication reference until a general communications table exists. */
    communicationId: uuid("communication_id"),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    outcomeNotes: text("outcome_notes"),
    provenance: provenanceCol(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("discovery_meet_and_confer_issues_id_matter_uidx").on(table.id, table.matterId),
    uniqueIndex("discovery_meet_and_confer_issues_id_org_uidx").on(table.id, table.organizationId),
    index("discovery_meet_and_confer_issues_org_matter_idx").on(
      table.organizationId,
      table.matterId,
    ),
  ],
);

export const discoveryDeficiencies = pgTable(
  "discovery_deficiencies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("OPEN"),
    description: text("description").notNull().default(""),
    itemId: uuid("item_id").references(() => discoveryRequestItems.id, { onDelete: "set null" }),
    productionId: uuid("production_id").references(() => discoveryProductions.id, {
      onDelete: "set null",
    }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    responsiblePartyEntityId: uuid("responsible_party_entity_id").references(
      () => matterEntities.id,
      { onDelete: "set null" },
    ),
    communicationId: uuid("communication_id"),
    meetAndConferId: uuid("meet_and_confer_id").references(
      () => discoveryMeetAndConferIssues.id,
      { onDelete: "set null" },
    ),
    /** Opaque matter-scoped motion reference until a general motions table exists. */
    motionId: uuid("motion_id"),
    motionDocumentId: uuid("motion_document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    isReviewSignal: boolean("is_review_signal").notNull().default(true),
    provenance: provenanceCol(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("discovery_deficiencies_id_matter_uidx").on(table.id, table.matterId),
    uniqueIndex("discovery_deficiencies_id_org_uidx").on(table.id, table.organizationId),
    index("discovery_deficiencies_org_matter_idx").on(table.organizationId, table.matterId),
    index("discovery_deficiencies_status_idx").on(table.matterId, table.status),
    index("discovery_deficiencies_item_idx").on(table.itemId),
  ],
);

export const discoveryMeetAndConferDeficiencyLinks = pgTable(
  "discovery_meet_and_confer_deficiency_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    meetAndConferId: uuid("meet_and_confer_id")
      .notNull()
      .references(() => discoveryMeetAndConferIssues.id, { onDelete: "cascade" }),
    deficiencyId: uuid("deficiency_id")
      .notNull()
      .references(() => discoveryDeficiencies.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("discovery_mac_deficiency_links_uidx").on(
      table.meetAndConferId,
      table.deficiencyId,
    ),
    index("discovery_mac_deficiency_links_org_matter_idx").on(
      table.organizationId,
      table.matterId,
    ),
  ],
);

export const discoveryPrivilegeAssertions = pgTable(
  "discovery_privilege_assertions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("ASSERTED"),
    assertedBasis: text("asserted_basis").notNull(),
    assertingPartyEntityId: uuid("asserting_party_entity_id")
      .notNull()
      .references(() => matterEntities.id, { onDelete: "restrict" }),
    assertedAt: timestamp("asserted_at", { withTimezone: true }),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    evidenceId: uuid("evidence_id").references(() => civilEvidenceItems.id, {
      onDelete: "set null",
    }),
    productionId: uuid("production_id").references(() => discoveryProductions.id, {
      onDelete: "set null",
    }),
    privilegeLogDocumentId: uuid("privilege_log_document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    reviewNotes: text("review_notes"),
    /** Explicit source-backed flag only — not an autonomous privilege conclusion. */
    courtRulingReferenced: boolean("court_ruling_referenced").notNull().default(false),
    provenance: provenanceCol(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("discovery_privilege_assertions_id_matter_uidx").on(table.id, table.matterId),
    uniqueIndex("discovery_privilege_assertions_id_org_uidx").on(table.id, table.organizationId),
    index("discovery_privilege_assertions_org_matter_idx").on(
      table.organizationId,
      table.matterId,
    ),
    index("discovery_privilege_assertions_status_idx").on(table.matterId, table.status),
  ],
);
