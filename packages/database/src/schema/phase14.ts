import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { matters, organizations, users } from "./index";
import { legalAuthorities } from "./phase6";

export type RecordProvenance = {
  documentId?: string | null;
  authorityId?: string | null;
  sourceSpan?: string | null;
  sourcePage?: number | null;
  section?: string | null;
  extractionOrigin?: "human" | "import" | "deterministic_fixture" | "source_metadata" | null;
  humanEntered?: boolean;
};

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const legalStandards = pgTable(
  "legal_standards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    authorityId: uuid("authority_id").references(() => legalAuthorities.id, { onDelete: "set null" }),
    issueId: uuid("issue_id"),
    ruleText: text("rule_text").notNull(),
    standardType: text("standard_type").notNull(),
    elements: jsonb("elements").$type<string[]>().notNull().default([]),
    factors: jsonb("factors").$type<string[]>().notNull().default([]),
    exceptions: jsonb("exceptions").$type<string[]>().notNull().default([]),
    burdens: jsonb("burdens").$type<string[]>().notNull().default([]),
    standardOfReview: text("standard_of_review"),
    proceduralPosture: text("procedural_posture"),
    remedies: jsonb("remedies").$type<string[]>().notNull().default([]),
    effectiveContext: text("effective_context"),
    sourceSpan: text("source_span"),
    sourcePage: integer("source_page"),
    sourceCitation: text("source_citation"),
    confidence: text("confidence").notNull().default("low"),
    status: text("status").notNull().default("needs_review"),
    provenance: jsonb("provenance").$type<RecordProvenance>().notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    ...timestamps,
  },
  (table) => [
    index("legal_standards_org_idx").on(table.organizationId),
    index("legal_standards_authority_idx").on(table.authorityId),
  ],
);

export const legalIssues = pgTable(
  "legal_issues",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id").references(() => matters.id, { onDelete: "cascade" }),
    criminalCaseId: uuid("criminal_case_id"),
    issueType: text("issue_type").notNull(),
    jurisdiction: text("jurisdiction"),
    description: text("description").notNull(),
    relatedFactIds: jsonb("related_fact_ids").$type<string[]>().notNull().default([]),
    relatedEvidenceIds: jsonb("related_evidence_ids").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("open"),
    confidence: text("confidence").notNull().default("low"),
    provenance: jsonb("provenance").$type<RecordProvenance>().notNull(),
    ...timestamps,
  },
  (table) => [
    index("legal_issues_org_idx").on(table.organizationId),
    index("legal_issues_matter_idx").on(table.matterId),
    index("legal_issues_case_idx").on(table.criminalCaseId),
  ],
);

export const legalIssueAuthorities = pgTable(
  "legal_issue_authorities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => legalIssues.id, { onDelete: "cascade" }),
    authorityId: uuid("authority_id")
      .notNull()
      .references(() => legalAuthorities.id, { onDelete: "cascade" }),
    relation: text("relation").notNull(),
    authorityStatus: text("authority_status"),
    provenance: jsonb("provenance").$type<RecordProvenance>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("legal_issue_authorities_edge_uidx").on(table.issueId, table.authorityId, table.relation),
    index("legal_issue_authorities_org_idx").on(table.organizationId),
  ],
);

export const authorityTreatments = pgTable(
  "authority_treatments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceAuthorityId: uuid("source_authority_id")
      .notNull()
      .references(() => legalAuthorities.id, { onDelete: "cascade" }),
    targetAuthorityId: uuid("target_authority_id")
      .notNull()
      .references(() => legalAuthorities.id, { onDelete: "cascade" }),
    treatment: text("treatment").notNull(),
    evidenceSpan: text("evidence_span"),
    sourcePage: integer("source_page"),
    confidence: text("confidence").notNull().default("low"),
    verificationStatus: text("verification_status").notNull().default("unknown"),
    authoritativeMetadata: boolean("authoritative_metadata").notNull().default(false),
    provenance: jsonb("provenance").$type<RecordProvenance>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("authority_treatments_source_idx").on(table.sourceAuthorityId),
    index("authority_treatments_target_idx").on(table.targetAuthorityId),
  ],
);

export const authorityConflicts = pgTable(
  "authority_conflicts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    authorityA: uuid("authority_a")
      .notNull()
      .references(() => legalAuthorities.id, { onDelete: "cascade" }),
    authorityB: uuid("authority_b")
      .notNull()
      .references(() => legalAuthorities.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").references(() => legalIssues.id, { onDelete: "set null" }),
    conflictType: text("conflict_type").notNull(),
    explanation: text("explanation").notNull(),
    supportingSourceSpans: jsonb("supporting_source_spans").$type<string[]>().notNull().default([]),
    confidence: text("confidence").notNull().default("low"),
    status: text("status").notNull().default("needs_review"),
    provenance: jsonb("provenance").$type<RecordProvenance>().notNull(),
    ...timestamps,
  },
  (table) => [index("authority_conflicts_org_idx").on(table.organizationId)],
);

export const criminalCases = pgTable(
  "criminal_cases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id").references(() => matters.id, { onDelete: "set null" }),
    caseNumber: text("case_number").notNull(),
    jurisdiction: text("jurisdiction").notNull(),
    court: text("court").notNull(),
    courthouse: text("courthouse"),
    caseStatus: text("case_status").notNull().default("open"),
    assignedProsecutorId: uuid("assigned_prosecutor_id").references(() => users.id),
    supervisingProsecutorId: uuid("supervising_prosecutor_id").references(() => users.id),
    investigatingAgencyId: uuid("investigating_agency_id"),
    priority: text("priority").notNull().default("normal"),
    filingDate: date("filing_date"),
    arrestDate: date("arrest_date"),
    offenseDateStart: date("offense_date_start"),
    offenseDateEnd: date("offense_date_end"),
    trialDate: date("trial_date"),
    sentencingDate: date("sentencing_date"),
    closedDate: date("closed_date"),
    summary: text("summary"),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("criminal_cases_org_number_uidx").on(table.organizationId, table.caseNumber),
    index("criminal_cases_org_idx").on(table.organizationId),
    index("criminal_cases_matter_idx").on(table.matterId),
  ],
);

export const prosecutionAgencies = pgTable(
  "prosecution_agencies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    agencyType: text("agency_type").notNull(),
    jurisdiction: text("jurisdiction"),
    contact: jsonb("contact").$type<Record<string, string>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [index("prosecution_agencies_org_idx").on(table.organizationId)],
);

export const prosecutionDefendants = pgTable(
  "prosecution_defendants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    criminalCaseId: uuid("criminal_case_id")
      .notNull()
      .references(() => criminalCases.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
    dateOfBirth: date("date_of_birth"),
    custodyStatus: text("custody_status"),
    defenseCounsel: text("defense_counsel"),
    notes: text("notes"),
    status: text("status").notNull().default("active"),
    provenance: jsonb("provenance").$type<RecordProvenance>().notNull(),
    privacy: jsonb("privacy").$type<{ dobRestricted: boolean }>().notNull().default({ dobRestricted: true }),
    ...timestamps,
  },
  (table) => [
    index("prosecution_defendants_case_idx").on(table.criminalCaseId),
    index("prosecution_defendants_org_idx").on(table.organizationId),
  ],
);

export const prosecutionOfficers = pgTable(
  "prosecution_officers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    criminalCaseId: uuid("criminal_case_id")
      .notNull()
      .references(() => criminalCases.id, { onDelete: "cascade" }),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => prosecutionAgencies.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    role: text("role").notNull(),
    badgeIdentifier: text("badge_identifier"),
    reportIds: jsonb("report_ids").$type<string[]>().notNull().default([]),
    interviewIds: jsonb("interview_ids").$type<string[]>().notNull().default([]),
    warrantIds: jsonb("warrant_ids").$type<string[]>().notNull().default([]),
    evidenceCollectedIds: jsonb("evidence_collected_ids").$type<string[]>().notNull().default([]),
    testimonyIds: jsonb("testimony_ids").$type<string[]>().notNull().default([]),
    ...timestamps,
  },
  (table) => [index("prosecution_officers_case_idx").on(table.criminalCaseId)],
);

export const prosecutionCharges = pgTable(
  "prosecution_charges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    criminalCaseId: uuid("criminal_case_id")
      .notNull()
      .references(() => criminalCases.id, { onDelete: "cascade" }),
    defendantId: uuid("defendant_id")
      .notNull()
      .references(() => prosecutionDefendants.id, { onDelete: "cascade" }),
    countNumber: text("count_number").notNull(),
    statuteAuthorityId: uuid("statute_authority_id").references(() => legalAuthorities.id, { onDelete: "set null" }),
    statuteCitation: text("statute_citation"),
    offenseName: text("offense_name").notNull(),
    offenseClassification: text("offense_classification"),
    jurisdiction: text("jurisdiction").notNull(),
    filingDate: date("filing_date"),
    status: text("status").notNull().default("pending"),
    amendmentHistory: jsonb("amendment_history").$type<string[]>().notNull().default([]),
    dispositionId: uuid("disposition_id"),
    provenance: jsonb("provenance").$type<RecordProvenance>().notNull(),
    ...timestamps,
  },
  (table) => [
    index("prosecution_charges_case_idx").on(table.criminalCaseId),
    uniqueIndex("prosecution_charges_count_uidx").on(table.criminalCaseId, table.defendantId, table.countNumber),
  ],
);

export const prosecutionChargeElements = pgTable(
  "prosecution_charge_elements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    criminalCaseId: uuid("criminal_case_id")
      .notNull()
      .references(() => criminalCases.id, { onDelete: "cascade" }),
    chargeId: uuid("charge_id")
      .notNull()
      .references(() => prosecutionCharges.id, { onDelete: "cascade" }),
    elementOrder: integer("element_order").notNull(),
    elementText: text("element_text").notNull(),
    elementType: text("element_type").notNull(),
    legalStandardId: uuid("legal_standard_id").references(() => legalStandards.id, { onDelete: "set null" }),
    supportingEvidenceIds: jsonb("supporting_evidence_ids").$type<string[]>().notNull().default([]),
    contraryEvidenceIds: jsonb("contrary_evidence_ids").$type<string[]>().notNull().default([]),
    uncertainEvidenceIds: jsonb("uncertain_evidence_ids").$type<string[]>().notNull().default([]),
    missingEvidenceIds: jsonb("missing_evidence_ids").$type<string[]>().notNull().default([]),
    relatedAuthorityIds: jsonb("related_authority_ids").$type<string[]>().notNull().default([]),
    status: text("status").notNull(),
    confidence: text("confidence").notNull().default("low"),
    humanReviewStatus: text("human_review_status").notNull().default("unreviewed"),
    provenance: jsonb("provenance").$type<RecordProvenance>().notNull(),
    ...timestamps,
  },
  (table) => [
    index("prosecution_charge_elements_charge_idx").on(table.chargeId),
    index("prosecution_charge_elements_case_idx").on(table.criminalCaseId),
  ],
);

export const prosecutionEvidenceItems = pgTable(
  "prosecution_evidence_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    criminalCaseId: uuid("criminal_case_id")
      .notNull()
      .references(() => criminalCases.id, { onDelete: "cascade" }),
    documentId: uuid("document_id"),
    evidenceType: text("evidence_type").notNull(),
    sourceAgency: text("source_agency"),
    collector: text("collector"),
    collectionDate: date("collection_date"),
    storageReference: text("storage_reference"),
    chainOfCustody: jsonb("chain_of_custody").$type<string[]>().notNull().default([]),
    relatedDefendantIds: jsonb("related_defendant_ids").$type<string[]>().notNull().default([]),
    relatedChargeIds: jsonb("related_charge_ids").$type<string[]>().notNull().default([]),
    relatedElementIds: jsonb("related_element_ids").$type<string[]>().notNull().default([]),
    relatedWitnessIds: jsonb("related_witness_ids").$type<string[]>().notNull().default([]),
    sensitivity: text("sensitivity").notNull().default("standard"),
    reviewStatus: text("review_status").notNull().default("received"),
    provenance: jsonb("provenance").$type<RecordProvenance>().notNull(),
    ...timestamps,
  },
  (table) => [index("prosecution_evidence_case_idx").on(table.criminalCaseId)],
);

export const prosecutionEvidenceLinks = pgTable(
  "prosecution_evidence_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    criminalCaseId: uuid("criminal_case_id")
      .notNull()
      .references(() => criminalCases.id, { onDelete: "cascade" }),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => prosecutionEvidenceItems.id, { onDelete: "cascade" }),
    relationship: text("relationship").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    provenance: jsonb("provenance").$type<RecordProvenance>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("prosecution_evidence_links_case_idx").on(table.criminalCaseId)],
);

export const prosecutionWitnesses = pgTable(
  "prosecution_witnesses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    criminalCaseId: uuid("criminal_case_id")
      .notNull()
      .references(() => criminalCases.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id"),
    displayName: text("display_name").notNull(),
    witnessType: text("witness_type").notNull(),
    relationship: text("relationship"),
    testimonyIds: jsonb("testimony_ids").$type<string[]>().notNull().default([]),
    relatedEvidenceIds: jsonb("related_evidence_ids").$type<string[]>().notNull().default([]),
    notes: text("notes"),
    sensitivity: text("sensitivity").notNull().default("standard"),
    provenance: jsonb("provenance").$type<RecordProvenance>().notNull(),
    ...timestamps,
  },
  (table) => [index("prosecution_witnesses_case_idx").on(table.criminalCaseId)],
);

export const prosecutionWitnessStatements = pgTable(
  "prosecution_witness_statements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    criminalCaseId: uuid("criminal_case_id")
      .notNull()
      .references(() => criminalCases.id, { onDelete: "cascade" }),
    witnessId: uuid("witness_id")
      .notNull()
      .references(() => prosecutionWitnesses.id, { onDelete: "cascade" }),
    statementDate: date("statement_date"),
    statementType: text("statement_type").notNull(),
    sourceDocumentId: uuid("source_document_id"),
    sourceSpan: text("source_span"),
    interviewer: text("interviewer"),
    eventContext: text("event_context"),
    claims: jsonb("claims").$type<Array<{ key: string; value: string; kind?: string }>>().notNull().default([]),
    confidence: text("confidence").notNull().default("low"),
    provenance: jsonb("provenance").$type<RecordProvenance>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("prosecution_witness_statements_witness_idx").on(table.witnessId)],
);

export const prosecutionDiscoveryItems = pgTable(
  "prosecution_discovery_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    criminalCaseId: uuid("criminal_case_id")
      .notNull()
      .references(() => criminalCases.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    category: text("category").notNull(),
    receivedDate: date("received_date"),
    reviewStatus: text("review_status").notNull().default("RECEIVED"),
    productionStatus: text("production_status").notNull().default("RECEIVED"),
    producedDate: date("produced_date"),
    relatedDocumentIds: jsonb("related_document_ids").$type<string[]>().notNull().default([]),
    relatedEvidenceIds: jsonb("related_evidence_ids").$type<string[]>().notNull().default([]),
    disclosureReviewStatus: text("disclosure_review_status").notNull().default("UNREVIEWED"),
    notes: text("notes"),
    auditHistory: jsonb("audit_history").$type<string[]>().notNull().default([]),
    provenance: jsonb("provenance").$type<RecordProvenance>().notNull(),
    ...timestamps,
  },
  (table) => [index("prosecution_discovery_case_idx").on(table.criminalCaseId)],
);

export const prosecutionDisclosureCandidates = pgTable(
  "prosecution_disclosure_candidates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    criminalCaseId: uuid("criminal_case_id")
      .notNull()
      .references(() => criminalCases.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    status: text("status").notNull().default("UNREVIEWED"),
    notes: text("notes"),
    humanActorId: uuid("human_actor_id").references(() => users.id),
    provenance: jsonb("provenance").$type<RecordProvenance>().notNull(),
    ...timestamps,
  },
  (table) => [index("prosecution_disclosure_case_idx").on(table.criminalCaseId)],
);

export const prosecutionProcedureIssues = pgTable(
  "prosecution_procedure_issues",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    criminalCaseId: uuid("criminal_case_id")
      .notNull()
      .references(() => criminalCases.id, { onDelete: "cascade" }),
    issueType: text("issue_type").notNull(),
    relatedFactIds: jsonb("related_fact_ids").$type<string[]>().notNull().default([]),
    relatedEvidenceIds: jsonb("related_evidence_ids").$type<string[]>().notNull().default([]),
    relatedAuthorityIds: jsonb("related_authority_ids").$type<string[]>().notNull().default([]),
    missingFacts: jsonb("missing_facts").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("open"),
    confidence: text("confidence").notNull().default("low"),
    provenance: jsonb("provenance").$type<RecordProvenance>().notNull(),
    ...timestamps,
  },
  (table) => [index("prosecution_procedure_issues_case_idx").on(table.criminalCaseId)],
);

export const prosecutionWarrants = pgTable(
  "prosecution_warrants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    criminalCaseId: uuid("criminal_case_id")
      .notNull()
      .references(() => criminalCases.id, { onDelete: "cascade" }),
    warrantType: text("warrant_type").notNull(),
    issuingCourt: text("issuing_court"),
    issuingJudge: text("issuing_judge"),
    applicationDate: date("application_date"),
    issueDate: date("issue_date"),
    executionDate: date("execution_date"),
    scope: text("scope"),
    probableCauseFacts: jsonb("probable_cause_facts").$type<string[]>().notNull().default([]),
    sourceFactIds: jsonb("source_fact_ids").$type<string[]>().notNull().default([]),
    seizedEvidenceIds: jsonb("seized_evidence_ids").$type<string[]>().notNull().default([]),
    returnNotes: text("return_notes"),
    relatedSuppressionIssueIds: jsonb("related_suppression_issue_ids").$type<string[]>().notNull().default([]),
    provenance: jsonb("provenance").$type<RecordProvenance>().notNull(),
    ...timestamps,
  },
  (table) => [index("prosecution_warrants_case_idx").on(table.criminalCaseId)],
);

export const prosecutionWarrantAffidavits = pgTable("prosecution_warrant_affidavits", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  warrantId: uuid("warrant_id")
    .notNull()
    .references(() => prosecutionWarrants.id, { onDelete: "cascade" }),
  affiant: text("affiant"),
  statement: text("statement").notNull(),
  provenance: jsonb("provenance").$type<RecordProvenance>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const prosecutionWarrantExecutions = pgTable("prosecution_warrant_executions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  warrantId: uuid("warrant_id")
    .notNull()
    .references(() => prosecutionWarrants.id, { onDelete: "cascade" }),
  executedAt: timestamp("executed_at", { withTimezone: true }),
  executedBy: text("executed_by"),
  notes: text("notes"),
  provenance: jsonb("provenance").$type<RecordProvenance>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const prosecutionWarrantReturns = pgTable("prosecution_warrant_returns", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  warrantId: uuid("warrant_id")
    .notNull()
    .references(() => prosecutionWarrants.id, { onDelete: "cascade" }),
  returnedAt: timestamp("returned_at", { withTimezone: true }),
  inventory: jsonb("inventory").$type<string[]>().notNull().default([]),
  provenance: jsonb("provenance").$type<RecordProvenance>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const prosecutionMotions = pgTable(
  "prosecution_motions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    criminalCaseId: uuid("criminal_case_id")
      .notNull()
      .references(() => criminalCases.id, { onDelete: "cascade" }),
    motionType: text("motion_type").notNull(),
    filingParty: text("filing_party").notNull(),
    filedDate: date("filed_date"),
    issueIds: jsonb("issue_ids").$type<string[]>().notNull().default([]),
    relatedAuthorityIds: jsonb("related_authority_ids").$type<string[]>().notNull().default([]),
    response: text("response"),
    status: text("status").notNull().default("filed"),
    ruling: text("ruling"),
    provenance: jsonb("provenance").$type<RecordProvenance>().notNull(),
    ...timestamps,
  },
  (table) => [index("prosecution_motions_case_idx").on(table.criminalCaseId)],
);

export const prosecutionHearings = pgTable(
  "prosecution_hearings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    criminalCaseId: uuid("criminal_case_id")
      .notNull()
      .references(() => criminalCases.id, { onDelete: "cascade" }),
    hearingType: text("hearing_type").notNull(),
    dateTime: timestamp("date_time", { withTimezone: true }),
    court: text("court"),
    judge: text("judge"),
    participants: jsonb("participants").$type<string[]>().notNull().default([]),
    issueIds: jsonb("issue_ids").$type<string[]>().notNull().default([]),
    outcome: text("outcome"),
    generatedDeadlineIds: jsonb("generated_deadline_ids").$type<string[]>().notNull().default([]),
    provenance: jsonb("provenance").$type<RecordProvenance>().notNull(),
    ...timestamps,
  },
  (table) => [index("prosecution_hearings_case_idx").on(table.criminalCaseId)],
);

export const prosecutionSubpoenas = pgTable(
  "prosecution_subpoenas",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    criminalCaseId: uuid("criminal_case_id")
      .notNull()
      .references(() => criminalCases.id, { onDelete: "cascade" }),
    recipient: text("recipient").notNull(),
    requestScope: text("request_scope").notNull(),
    issueDate: date("issue_date"),
    serviceDate: date("service_date"),
    returnDate: date("return_date"),
    status: text("status").notNull().default("issued"),
    documentsReceived: jsonb("documents_received").$type<string[]>().notNull().default([]),
    provenance: jsonb("provenance").$type<RecordProvenance>().notNull(),
    ...timestamps,
  },
  (table) => [index("prosecution_subpoenas_case_idx").on(table.criminalCaseId)],
);

export const prosecutionPleaOffers = pgTable(
  "prosecution_plea_offers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    criminalCaseId: uuid("criminal_case_id")
      .notNull()
      .references(() => criminalCases.id, { onDelete: "cascade" }),
    terms: text("terms").notNull(),
    offerDate: date("offer_date"),
    expiration: date("expiration"),
    status: text("status").notNull().default("draft"),
    history: jsonb("history").$type<string[]>().notNull().default([]),
    humanOwnerId: uuid("human_owner_id")
      .notNull()
      .references(() => users.id),
    provenance: jsonb("provenance").$type<RecordProvenance>().notNull(),
    ...timestamps,
  },
  (table) => [index("prosecution_plea_offers_case_idx").on(table.criminalCaseId)],
);

export const prosecutionDispositions = pgTable(
  "prosecution_dispositions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    criminalCaseId: uuid("criminal_case_id")
      .notNull()
      .references(() => criminalCases.id, { onDelete: "cascade" }),
    chargeId: uuid("charge_id")
      .notNull()
      .references(() => prosecutionCharges.id, { onDelete: "cascade" }),
    result: text("result").notNull(),
    date: date("date"),
    notes: text("notes"),
    provenance: jsonb("provenance").$type<RecordProvenance>().notNull(),
    ...timestamps,
  },
  (table) => [index("prosecution_dispositions_case_idx").on(table.criminalCaseId)],
);

export const prosecutionSentences = pgTable(
  "prosecution_sentences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    criminalCaseId: uuid("criminal_case_id")
      .notNull()
      .references(() => criminalCases.id, { onDelete: "cascade" }),
    chargeId: uuid("charge_id")
      .notNull()
      .references(() => prosecutionCharges.id, { onDelete: "cascade" }),
    conviction: text("conviction").notNull(),
    sentenceDate: date("sentence_date"),
    sentenceTerms: text("sentence_terms").notNull(),
    custodial: boolean("custodial"),
    conditions: jsonb("conditions").$type<string[]>().notNull().default([]),
    notes: text("notes"),
    sourceDocumentId: uuid("source_document_id"),
    provenance: jsonb("provenance").$type<RecordProvenance>().notNull(),
    ...timestamps,
  },
  (table) => [index("prosecution_sentences_case_idx").on(table.criminalCaseId)],
);

export const prosecutionTimelineEvents = pgTable(
  "prosecution_timeline_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    criminalCaseId: uuid("criminal_case_id")
      .notNull()
      .references(() => criminalCases.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id").references(() => matters.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    title: text("title").notNull(),
    eventDate: timestamp("event_date", { withTimezone: true }),
    provenance: jsonb("provenance").$type<RecordProvenance>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("prosecution_timeline_case_idx").on(table.criminalCaseId)],
);

export const prosecutionTasks = pgTable(
  "prosecution_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    criminalCaseId: uuid("criminal_case_id")
      .notNull()
      .references(() => criminalCases.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status").notNull().default("open"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("prosecution_tasks_case_idx").on(table.criminalCaseId)],
);

export const prosecutionGraphNodes = pgTable(
  "prosecution_graph_nodes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    criminalCaseId: uuid("criminal_case_id")
      .notNull()
      .references(() => criminalCases.id, { onDelete: "cascade" }),
    nodeType: text("node_type").notNull(),
    refId: text("ref_id").notNull(),
    provenance: jsonb("provenance").$type<RecordProvenance>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("prosecution_graph_nodes_ref_uidx").on(table.criminalCaseId, table.nodeType, table.refId),
    index("prosecution_graph_nodes_case_idx").on(table.criminalCaseId),
  ],
);

export const prosecutionGraphEdges = pgTable(
  "prosecution_graph_edges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    criminalCaseId: uuid("criminal_case_id")
      .notNull()
      .references(() => criminalCases.id, { onDelete: "cascade" }),
    fromRef: text("from_ref").notNull(),
    toRef: text("to_ref").notNull(),
    relationship: text("relationship").notNull(),
    provenance: jsonb("provenance").$type<RecordProvenance>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("prosecution_graph_edges_case_idx").on(table.criminalCaseId)],
);

export const prosecutionElementStatusCheck = sql`status in ('SUPPORTED','PARTIALLY_SUPPORTED','CONFLICTED','NO_EVIDENCE_FOUND','UNKNOWN')`;
