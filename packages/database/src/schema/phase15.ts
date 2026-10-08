/**
 * Phase 15 — Civil claims / defenses / counterclaims persistence.
 *
 * Non-deciding support statuses only. No liability/win/lose fields.
 * Composite matter/org isolation FKs live in drizzle/0020_civil_claims.sql
 * (mirrors week3 case isolation).
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
import { documents, matterEntities, matterFacts, matters, organizations, users } from "./index";
import { legalAuthorities } from "./phase6";
import { legalIssues, legalStandards, type RecordProvenance } from "./phase14";

export type CivilDamagesRemedy = {
  category: string | null;
  remedySought: string | null;
  notes: string | null;
};

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

const provenanceCol = () => jsonb("provenance").$type<RecordProvenance>().notNull();

export const civilPleadings = pgTable(
  "civil_pleadings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    pleadingType: text("pleading_type").notNull().default("complaint"),
    filedAt: timestamp("filed_at", { withTimezone: true }),
    isCurrent: boolean("is_current").notNull().default(true),
    supersededById: uuid("superseded_by_id"),
    provenance: provenanceCol(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("civil_pleadings_id_matter_uidx").on(table.id, table.matterId),
    uniqueIndex("civil_pleadings_id_org_uidx").on(table.id, table.organizationId),
    index("civil_pleadings_org_matter_idx").on(table.organizationId, table.matterId),
    index("civil_pleadings_matter_current_idx").on(table.matterId, table.isCurrent),
  ],
);

export const civilClaims = pgTable(
  "civil_claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    pleadingId: uuid("pleading_id").references(() => civilPleadings.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    category: text("category").notNull().default("OTHER"),
    label: text("label").notNull(),
    description: text("description").notNull().default(""),
    supportStatus: text("support_status").notNull().default("UNKNOWN"),
    proceduralStatus: text("procedural_status").notNull().default("PLED"),
    isCurrent: boolean("is_current").notNull().default(true),
    supersededById: uuid("superseded_by_id"),
    damagesOrRemedy: jsonb("damages_or_remedy").$type<CivilDamagesRemedy | null>(),
    uncertainty: jsonb("uncertainty").$type<string[]>().notNull().default([]),
    provenance: provenanceCol(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("civil_claims_id_matter_uidx").on(table.id, table.matterId),
    uniqueIndex("civil_claims_id_org_uidx").on(table.id, table.organizationId),
    index("civil_claims_org_matter_idx").on(table.organizationId, table.matterId),
    index("civil_claims_matter_current_idx").on(table.matterId, table.isCurrent),
    index("civil_claims_pleading_idx").on(table.pleadingId),
  ],
);

export const civilClaimParties = pgTable(
  "civil_claim_parties",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => civilClaims.id, { onDelete: "cascade" }),
    partyEntityId: uuid("party_entity_id")
      .notNull()
      .references(() => matterEntities.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("civil_claim_parties_edge_uidx").on(table.claimId, table.partyEntityId, table.role),
    index("civil_claim_parties_claim_idx").on(table.claimId),
    index("civil_claim_parties_party_idx").on(table.partyEntityId),
    index("civil_claim_parties_org_matter_idx").on(table.organizationId, table.matterId),
  ],
);

export const civilDefenses = pgTable(
  "civil_defenses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    pleadingId: uuid("pleading_id").references(() => civilPleadings.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    description: text("description").notNull().default(""),
    supportStatus: text("support_status").notNull().default("UNKNOWN"),
    proceduralStatus: text("procedural_status").notNull().default("PLED"),
    isCurrent: boolean("is_current").notNull().default(true),
    supersededById: uuid("superseded_by_id"),
    uncertainty: jsonb("uncertainty").$type<string[]>().notNull().default([]),
    provenance: provenanceCol(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("civil_defenses_id_matter_uidx").on(table.id, table.matterId),
    uniqueIndex("civil_defenses_id_org_uidx").on(table.id, table.organizationId),
    index("civil_defenses_org_matter_idx").on(table.organizationId, table.matterId),
    index("civil_defenses_matter_current_idx").on(table.matterId, table.isCurrent),
    index("civil_defenses_pleading_idx").on(table.pleadingId),
  ],
);

export const civilDefenseClaimRelations = pgTable(
  "civil_defense_claim_relations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    defenseId: uuid("defense_id")
      .notNull()
      .references(() => civilDefenses.id, { onDelete: "cascade" }),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => civilClaims.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("civil_defense_claim_relations_uidx").on(table.defenseId, table.claimId),
    index("civil_defense_claim_relations_defense_idx").on(table.defenseId),
    index("civil_defense_claim_relations_claim_idx").on(table.claimId),
    index("civil_defense_claim_relations_org_matter_idx").on(table.organizationId, table.matterId),
  ],
);

export const civilDefenseParties = pgTable(
  "civil_defense_parties",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    defenseId: uuid("defense_id")
      .notNull()
      .references(() => civilDefenses.id, { onDelete: "cascade" }),
    partyEntityId: uuid("party_entity_id")
      .notNull()
      .references(() => matterEntities.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("civil_defense_parties_edge_uidx").on(table.defenseId, table.partyEntityId, table.role),
    index("civil_defense_parties_defense_idx").on(table.defenseId),
    index("civil_defense_parties_party_idx").on(table.partyEntityId),
  ],
);

export const civilClaimElements = pgTable(
  "civil_claim_elements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    claimId: uuid("claim_id").references(() => civilClaims.id, { onDelete: "cascade" }),
    defenseId: uuid("defense_id").references(() => civilDefenses.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    requirementText: text("requirement_text"),
    status: text("status").notNull().default("UNKNOWN"),
    sortOrder: integer("sort_order").notNull().default(0),
    uncertainty: jsonb("uncertainty").$type<string[]>().notNull().default([]),
    provenance: provenanceCol(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("civil_claim_elements_id_matter_uidx").on(table.id, table.matterId),
    uniqueIndex("civil_claim_elements_id_org_uidx").on(table.id, table.organizationId),
    index("civil_claim_elements_claim_idx").on(table.claimId),
    index("civil_claim_elements_defense_idx").on(table.defenseId),
    index("civil_claim_elements_org_matter_idx").on(table.organizationId, table.matterId),
  ],
);

export const civilEvidenceItems = pgTable(
  "civil_evidence_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    provenance: provenanceCol(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("civil_evidence_items_id_matter_uidx").on(table.id, table.matterId),
    uniqueIndex("civil_evidence_items_id_org_uidx").on(table.id, table.organizationId),
    index("civil_evidence_items_org_matter_idx").on(table.organizationId, table.matterId),
    index("civil_evidence_items_document_idx").on(table.documentId),
  ],
);

export const civilEvidenceRelations = pgTable(
  "civil_evidence_relations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    claimId: uuid("claim_id").references(() => civilClaims.id, { onDelete: "cascade" }),
    elementId: uuid("element_id").references(() => civilClaimElements.id, { onDelete: "cascade" }),
    defenseId: uuid("defense_id").references(() => civilDefenses.id, { onDelete: "cascade" }),
    evidenceId: uuid("evidence_id").references(() => civilEvidenceItems.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    partyEntityIds: jsonb("party_entity_ids").$type<string[]>().notNull().default([]),
    note: text("note"),
    provenance: provenanceCol(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("civil_evidence_relations_claim_idx").on(table.claimId),
    index("civil_evidence_relations_element_idx").on(table.elementId),
    index("civil_evidence_relations_defense_idx").on(table.defenseId),
    index("civil_evidence_relations_evidence_idx").on(table.evidenceId),
    index("civil_evidence_relations_org_matter_idx").on(table.organizationId, table.matterId),
  ],
);

export const civilFactRelations = pgTable(
  "civil_fact_relations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    claimId: uuid("claim_id").references(() => civilClaims.id, { onDelete: "cascade" }),
    elementId: uuid("element_id").references(() => civilClaimElements.id, { onDelete: "cascade" }),
    defenseId: uuid("defense_id").references(() => civilDefenses.id, { onDelete: "cascade" }),
    factId: uuid("fact_id")
      .notNull()
      .references(() => matterFacts.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    partyEntityIds: jsonb("party_entity_ids").$type<string[]>().notNull().default([]),
    note: text("note"),
    provenance: provenanceCol(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("civil_fact_relations_claim_idx").on(table.claimId),
    index("civil_fact_relations_element_idx").on(table.elementId),
    index("civil_fact_relations_defense_idx").on(table.defenseId),
    index("civil_fact_relations_fact_idx").on(table.factId),
    index("civil_fact_relations_org_matter_idx").on(table.organizationId, table.matterId),
  ],
);

export const civilLegalIssueRelations = pgTable(
  "civil_legal_issue_relations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    claimId: uuid("claim_id").references(() => civilClaims.id, { onDelete: "cascade" }),
    elementId: uuid("element_id").references(() => civilClaimElements.id, { onDelete: "cascade" }),
    defenseId: uuid("defense_id").references(() => civilDefenses.id, { onDelete: "cascade" }),
    legalIssueId: uuid("legal_issue_id")
      .notNull()
      .references(() => legalIssues.id, { onDelete: "cascade" }),
    provenance: provenanceCol(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("civil_legal_issue_relations_claim_idx").on(table.claimId),
    index("civil_legal_issue_relations_element_idx").on(table.elementId),
    index("civil_legal_issue_relations_defense_idx").on(table.defenseId),
    index("civil_legal_issue_relations_issue_idx").on(table.legalIssueId),
    index("civil_legal_issue_relations_org_matter_idx").on(table.organizationId, table.matterId),
  ],
);

export const civilAuthorityRelations = pgTable(
  "civil_authority_relations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    claimId: uuid("claim_id").references(() => civilClaims.id, { onDelete: "cascade" }),
    elementId: uuid("element_id").references(() => civilClaimElements.id, { onDelete: "cascade" }),
    defenseId: uuid("defense_id").references(() => civilDefenses.id, { onDelete: "cascade" }),
    legalIssueId: uuid("legal_issue_id").references(() => legalIssues.id, { onDelete: "cascade" }),
    authorityId: uuid("authority_id")
      .notNull()
      .references(() => legalAuthorities.id, { onDelete: "cascade" }),
    relation: text("relation").notNull(),
    proposition: text("proposition"),
    sourceSpan: text("source_span"),
    sourceSupported: boolean("source_supported").notNull().default(false),
    treatment: text("treatment").notNull().default("UNVERIFIED"),
    currentness: text("currentness").notNull().default("unknown"),
    provenance: provenanceCol(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("civil_authority_relations_claim_idx").on(table.claimId),
    index("civil_authority_relations_element_idx").on(table.elementId),
    index("civil_authority_relations_defense_idx").on(table.defenseId),
    index("civil_authority_relations_issue_idx").on(table.legalIssueId),
    index("civil_authority_relations_authority_idx").on(table.authorityId),
    index("civil_authority_relations_org_matter_idx").on(table.organizationId, table.matterId),
  ],
);

export const civilStandardRelations = pgTable(
  "civil_standard_relations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    claimId: uuid("claim_id").references(() => civilClaims.id, { onDelete: "cascade" }),
    elementId: uuid("element_id").references(() => civilClaimElements.id, { onDelete: "cascade" }),
    defenseId: uuid("defense_id").references(() => civilDefenses.id, { onDelete: "cascade" }),
    standardId: uuid("standard_id")
      .notNull()
      .references(() => legalStandards.id, { onDelete: "cascade" }),
    provenance: provenanceCol(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("civil_standard_relations_claim_idx").on(table.claimId),
    index("civil_standard_relations_element_idx").on(table.elementId),
    index("civil_standard_relations_defense_idx").on(table.defenseId),
    index("civil_standard_relations_standard_idx").on(table.standardId),
    index("civil_standard_relations_org_matter_idx").on(table.organizationId, table.matterId),
  ],
);
