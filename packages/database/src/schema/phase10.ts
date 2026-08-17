import {
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
  index,
  integer,
  pgEnum,
} from "drizzle-orm/pg-core";
import { conversations, documents, matters, organizations, users } from "./index";
import { drafts } from "./phase5";

/**
 * Phase 10 — SYNTH/dev firm operations. These tables support in-app time, draft invoices from
 * posted minutes (not money), pasted inbound email filed to a matter with human confirm, and
 * in-app notifications. They are not Microsoft Graph, SMTP transport, or a payment processor.
 */

export const timeEntrySourceEnum = pgEnum("time_entry_source", ["manual", "chat", "draft"]);
export const timeEntryStatusEnum = pgEnum("time_entry_status", [
  "suggested",
  "posted",
  "rejected",
]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["draft", "issued", "void"]);
export const inboundEmailStatusEnum = pgEnum("inbound_email_status", [
  "pending",
  "filed",
  "discarded",
]);
export const notificationKindEnum = pgEnum("notification_kind", [
  "deadline",
  "invite",
  "time_suggestion",
  "review_queue",
]);

export type TimeEntrySource = (typeof timeEntrySourceEnum.enumValues)[number];
export type TimeEntryStatus = (typeof timeEntryStatusEnum.enumValues)[number];
export type InvoiceStatus = (typeof invoiceStatusEnum.enumValues)[number];
export type InboundEmailStatus = (typeof inboundEmailStatusEnum.enumValues)[number];
export type NotificationKind = (typeof notificationKindEnum.enumValues)[number];

export const timeEntries = pgTable(
  "time_entries",
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
    source: timeEntrySourceEnum("source").notNull().default("manual"),
    status: timeEntryStatusEnum("status").notNull().default("suggested"),
    description: text("description").notNull(),
    minutes: integer("minutes").notNull(),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    draftId: uuid("draft_id").references(() => drafts.id, { onDelete: "set null" }),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("time_entries_organization_idx").on(table.organizationId),
    index("time_entries_matter_idx").on(table.matterId),
    index("time_entries_user_idx").on(table.userId),
    index("time_entries_status_idx").on(table.status),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    invoiceNumber: text("invoice_number").notNull(),
    status: invoiceStatusEnum("status").notNull().default("draft"),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("invoices_org_number_uidx").on(table.organizationId, table.invoiceNumber),
    index("invoices_matter_idx").on(table.matterId),
    index("invoices_organization_idx").on(table.organizationId),
  ],
);

export const invoiceLineItems = pgTable(
  "invoice_line_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    timeEntryId: uuid("time_entry_id")
      .notNull()
      .references(() => timeEntries.id, { onDelete: "restrict" }),
    description: text("description").notNull(),
    minutes: integer("minutes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("invoice_line_items_time_entry_uidx").on(table.timeEntryId),
    index("invoice_line_items_invoice_idx").on(table.invoiceId),
  ],
);

export const inboundEmails = pgTable(
  "inbound_emails",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    fromAddress: text("from_address").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    status: inboundEmailStatusEnum("status").notNull().default("pending"),
    matterId: uuid("matter_id").references(() => matters.id, { onDelete: "set null" }),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("inbound_emails_organization_idx").on(table.organizationId),
    index("inbound_emails_status_idx").on(table.status),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: notificationKindEnum("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    href: text("href"),
    matterId: uuid("matter_id").references(() => matters.id, { onDelete: "set null" }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("notifications_user_idx").on(table.userId),
    index("notifications_organization_idx").on(table.organizationId),
  ],
);
