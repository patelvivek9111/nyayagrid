/**
 * Phase 18 — Professional contacts + document folders (PROF-CONTACT-01 / PROF-FOLDER-01).
 *
 * Contacts are organization-scoped people distinct from clients (parties).
 * Optional client_contacts join links a contact to a client with a relationship role.
 * Document folders are matter-scoped trees; documents.folder_id is added in migration 0027.
 */

import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { clients, matters, organizations, users } from "./index";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

/** Common relationship labels — free text also allowed via validation max length. */
export const CLIENT_CONTACT_RELATIONSHIP_ROLES = [
  "primary",
  "billing",
  "legal",
  "assistant",
  "opposing_counsel",
  "witness",
  "expert",
  "other",
] as const;

export type ClientContactRelationshipRole = (typeof CLIENT_CONTACT_RELATIONSHIP_ROLES)[number];

/** Organization-scoped contacts — distinct from `clients` (matter parties). */
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    title: text("title"),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    ...timestamps,
  },
  (table) => [
    index("contacts_organization_idx").on(table.organizationId),
    index("contacts_org_display_name_idx").on(table.organizationId, table.displayName),
    index("contacts_org_email_idx").on(table.organizationId, table.email),
  ],
);

/** Optional many-to-many: contact ↔ client with relationship role. */
export const clientContacts = pgTable(
  "client_contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    relationshipRole: text("relationship_role").notNull().default("other"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("client_contacts_client_contact_uidx").on(table.clientId, table.contactId),
    index("client_contacts_organization_idx").on(table.organizationId),
    index("client_contacts_contact_idx").on(table.contactId),
    index("client_contacts_client_idx").on(table.clientId),
  ],
);

/**
 * Matter-scoped document folder tree.
 * parent_folder_id self-FK + matter/org isolation enforced in SQL migration.
 */
export const documentFolders = pgTable(
  "document_folders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    parentFolderId: uuid("parent_folder_id"),
    name: text("name").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    ...timestamps,
  },
  (table) => [
    index("document_folders_matter_idx").on(table.matterId),
    index("document_folders_organization_idx").on(table.organizationId),
    index("document_folders_parent_idx").on(table.parentFolderId),
    // Sibling uniqueness (including NULL roots) is enforced in SQL via COALESCE.
    foreignKey({
      columns: [table.parentFolderId],
      foreignColumns: [table.id],
      name: "document_folders_parent_fk",
    }).onDelete("restrict"),
  ],
);
