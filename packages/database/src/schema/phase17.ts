/**
 * Phase 17 — Matter motions + communications (Deepening Pass 6).
 *
 * First-class professional Matter workflows. Reuses documents, matter_entities,
 * tasks, inbound_emails. No automatic jurisdictional deadline inference —
 * date columns persist only explicitly supplied / source-backed values.
 * No court CMS, e-filing, or outcome-prediction fields.
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
import {
  documents,
  matterEntities,
  matters,
  organizations,
  tasks,
  users,
} from "./index";
import { inboundEmails } from "./phase10";
import { type RecordProvenance } from "./phase14";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

const provenanceCol = () => jsonb("provenance").$type<RecordProvenance>().notNull();

/** Extensible motion types — not a closed jurisdictional taxonomy. */
export const MATTER_MOTION_TYPES = [
  "MOTION_TO_COMPEL",
  "PROTECTIVE_ORDER",
  "SANCTIONS",
  "MOTION_TO_DISMISS",
  "SUMMARY_JUDGMENT",
  "MOTION_IN_LIMINE",
  "MOTION_TO_EXCLUDE",
  "MOTION_TO_STRIKE",
  "RECONSIDERATION",
  "DISCOVERY",
  "PROCEDURAL",
  "OTHER",
] as const;
export type MatterMotionType = (typeof MATTER_MOTION_TYPES)[number];

/** Lifecycle labels only — schema does not enforce jurisdictional sequencing. */
export const MATTER_MOTION_STATUSES = [
  "DRAFT",
  "PLANNED",
  "FILED",
  "SERVED",
  "OPPOSITION_DUE",
  "OPPOSITION_FILED",
  "REPLY_DUE",
  "REPLY_FILED",
  "HEARING_SCHEDULED",
  "SUBMITTED",
  "GRANTED",
  "DENIED",
  "GRANTED_IN_PART",
  "WITHDRAWN",
  "MOOT",
  "OTHER",
  "UNKNOWN",
] as const;
export type MatterMotionStatus = (typeof MATTER_MOTION_STATUSES)[number];

export const MATTER_MOTION_DISPOSITIONS = [
  "GRANTED",
  "DENIED",
  "GRANTED_IN_PART",
  "DENIED_IN_PART",
  "WITHDRAWN",
  "MOOT",
  "OTHER",
  "UNKNOWN",
] as const;
export type MatterMotionDisposition = (typeof MATTER_MOTION_DISPOSITIONS)[number];

export const MATTER_MOTION_DOCUMENT_ROLES = [
  "MOTION",
  "BRIEF",
  "OPPOSITION",
  "REPLY",
  "DECLARATION",
  "EXHIBIT",
  "ORDER",
  "TRANSCRIPT",
  "OTHER",
] as const;
export type MatterMotionDocumentRole = (typeof MATTER_MOTION_DOCUMENT_ROLES)[number];

export const MATTER_MOTION_LINK_TYPES = [
  "CLAIM",
  "DEFENSE",
  "CLAIM_ELEMENT",
  "DEFENSE_ELEMENT",
  "LEGAL_ISSUE",
  "DISCOVERY_REQUEST_ITEM",
  "DISCOVERY_DEFICIENCY",
  "PRIVILEGE_ASSERTION",
  "EVIDENCE",
  "COMMUNICATION",
  "TASK",
  "DEADLINE_CANDIDATE",
] as const;
export type MatterMotionLinkType = (typeof MATTER_MOTION_LINK_TYPES)[number];

export const MATTER_COMMUNICATION_TYPES = [
  "MEET_AND_CONFER",
  "DEMAND",
  "RESPONSE",
  "FOLLOW_UP",
  "DEFICIENCY_NOTICE",
  "EXTENSION_REQUEST",
  "STIPULATION_DISCUSSION",
  "PRIVILEGE",
  "OTHER_CORRESPONDENCE",
] as const;
export type MatterCommunicationType = (typeof MATTER_COMMUNICATION_TYPES)[number];

export const MATTER_COMMUNICATION_DIRECTIONS = [
  "OUTBOUND",
  "INBOUND",
  "INTERNAL",
  "UNKNOWN",
] as const;
export type MatterCommunicationDirection = (typeof MATTER_COMMUNICATION_DIRECTIONS)[number];

export const MATTER_COMMUNICATION_STATUSES = [
  "DRAFT",
  "SENT",
  "RECEIVED",
  "AWAITING_RESPONSE",
  "CLOSED",
  "UNKNOWN",
] as const;
export type MatterCommunicationStatus = (typeof MATTER_COMMUNICATION_STATUSES)[number];

export const MATTER_COMMUNICATION_LINK_TYPES = [
  "DISCOVERY_REQUEST_ITEM",
  "DISCOVERY_RESPONSE",
  "DISCOVERY_DEFICIENCY",
  "MEET_AND_CONFER",
  "MOTION",
  "PRIVILEGE_ASSERTION",
  "CLAIM",
  "DEFENSE",
  "EVIDENCE",
  "DOCUMENT",
  "TASK",
] as const;
export type MatterCommunicationLinkType = (typeof MATTER_COMMUNICATION_LINK_TYPES)[number];

export const matterMotions = pgTable(
  "matter_motions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    motionType: text("motion_type").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    status: text("status").notNull().default("DRAFT"),
    movingPartyEntityId: uuid("moving_party_entity_id").references(() => matterEntities.id, {
      onDelete: "set null",
    }),
    opposingPartyEntityId: uuid("opposing_party_entity_id").references(() => matterEntities.id, {
      onDelete: "set null",
    }),
    /** Explicit / source-backed only — no automatic jurisdictional inference. */
    filedAt: timestamp("filed_at", { withTimezone: true }),
    servedAt: timestamp("served_at", { withTimezone: true }),
    oppositionDueAt: timestamp("opposition_due_at", { withTimezone: true }),
    oppositionFiledAt: timestamp("opposition_filed_at", { withTimezone: true }),
    replyDueAt: timestamp("reply_due_at", { withTimezone: true }),
    replyFiledAt: timestamp("reply_filed_at", { withTimezone: true }),
    hearingAt: timestamp("hearing_at", { withTimezone: true }),
    rulingAt: timestamp("ruling_at", { withTimezone: true }),
    disposition: text("disposition"),
    rulingSummary: text("ruling_summary"),
    courtName: text("court_name"),
    judgeName: text("judge_name"),
    primaryDocumentId: uuid("primary_document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    orderDocumentId: uuid("order_document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    provenance: provenanceCol(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("matter_motions_id_matter_uidx").on(table.id, table.matterId),
    uniqueIndex("matter_motions_id_org_uidx").on(table.id, table.organizationId),
    index("matter_motions_org_matter_idx").on(table.organizationId, table.matterId),
    index("matter_motions_matter_status_idx").on(table.matterId, table.status),
    index("matter_motions_matter_type_idx").on(table.matterId, table.motionType),
    index("matter_motions_matter_hearing_idx").on(table.matterId, table.hearingAt),
  ],
);

export const matterMotionDocuments = pgTable(
  "matter_motion_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    motionId: uuid("motion_id")
      .notNull()
      .references(() => matterMotions.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("matter_motion_documents_edge_uidx").on(
      table.motionId,
      table.documentId,
      table.role,
    ),
    index("matter_motion_documents_org_matter_idx").on(table.organizationId, table.matterId),
    index("matter_motion_documents_motion_idx").on(table.motionId),
    index("matter_motion_documents_document_idx").on(table.documentId),
  ],
);

export const matterMotionLinks = pgTable(
  "matter_motion_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    motionId: uuid("motion_id")
      .notNull()
      .references(() => matterMotions.id, { onDelete: "cascade" }),
    linkType: text("link_type").notNull(),
    targetId: uuid("target_id").notNull(),
    note: text("note"),
    provenance: provenanceCol(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("matter_motion_links_edge_uidx").on(table.motionId, table.linkType, table.targetId),
    index("matter_motion_links_org_matter_idx").on(table.organizationId, table.matterId),
    index("matter_motion_links_matter_type_idx").on(table.matterId, table.linkType),
    index("matter_motion_links_target_type_idx").on(table.targetId, table.linkType),
  ],
);

export const matterCommunications = pgTable(
  "matter_communications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    communicationType: text("communication_type").notNull(),
    direction: text("direction").notNull().default("UNKNOWN"),
    status: text("status").notNull().default("DRAFT"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    subject: text("subject").notNull(),
    summary: text("summary"),
    senderEntityId: uuid("sender_entity_id").references(() => matterEntities.id, {
      onDelete: "set null",
    }),
    recipientEntityId: uuid("recipient_entity_id").references(() => matterEntities.id, {
      onDelete: "set null",
    }),
    primaryDocumentId: uuid("primary_document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    inboundEmailId: uuid("inbound_email_id").references(() => inboundEmails.id, {
      onDelete: "set null",
    }),
    followUpNeeded: boolean("follow_up_needed").notNull().default(false),
    /** Explicit / source-backed only — no automatic jurisdictional inference. */
    followUpDueAt: timestamp("follow_up_due_at", { withTimezone: true }),
    followUpTaskId: uuid("follow_up_task_id").references(() => tasks.id, { onDelete: "set null" }),
    provenance: provenanceCol(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("matter_communications_id_matter_uidx").on(table.id, table.matterId),
    uniqueIndex("matter_communications_id_org_uidx").on(table.id, table.organizationId),
    index("matter_communications_org_matter_idx").on(table.organizationId, table.matterId),
    index("matter_communications_matter_occurred_idx").on(table.matterId, table.occurredAt),
    index("matter_communications_matter_type_idx").on(table.matterId, table.communicationType),
    index("matter_communications_matter_follow_up_idx").on(table.matterId, table.followUpNeeded),
  ],
);

export const matterCommunicationLinks = pgTable(
  "matter_communication_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    communicationId: uuid("communication_id")
      .notNull()
      .references(() => matterCommunications.id, { onDelete: "cascade" }),
    linkType: text("link_type").notNull(),
    targetId: uuid("target_id").notNull(),
    note: text("note"),
    provenance: provenanceCol(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("matter_communication_links_edge_uidx").on(
      table.communicationId,
      table.linkType,
      table.targetId,
    ),
    index("matter_communication_links_org_matter_idx").on(table.organizationId, table.matterId),
    index("matter_communication_links_matter_type_idx").on(table.matterId, table.linkType),
    index("matter_communication_links_target_type_idx").on(table.targetId, table.linkType),
  ],
);
