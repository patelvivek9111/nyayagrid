/**
 * Application-layer Discovery / Production Ledger model (Deepening Pass 4).
 *
 * Deterministic, non-persisted prototype. Does not write to the database and does not
 * invent court adjudication, sanctions, or privilege legal conclusions.
 * Production L4 persistence requires a coordinated shared schema (see schema proposal).
 */

export const DISCOVERY_REQUEST_TYPES = [
  "INTERROGATORY",
  "REQUEST_FOR_PRODUCTION",
  "REQUEST_FOR_ADMISSION",
  "SUBPOENA",
  "DEPOSITION_DISCOVERY",
  "THIRD_PARTY_REQUEST",
  "OTHER",
] as const;
export type DiscoveryRequestType = (typeof DISCOVERY_REQUEST_TYPES)[number];

/** Operational workflow statuses — not court adjudications. */
export const DISCOVERY_ITEM_STATUSES = [
  "NOT_DUE",
  "OPEN",
  "RESPONDED",
  "PARTIALLY_RESPONDED",
  "OBJECTED",
  "PRODUCED",
  "SUPPLEMENT_REQUIRED",
  "DEFICIENT",
  "RESOLVED",
  "UNKNOWN",
] as const;
export type DiscoveryItemStatus = (typeof DISCOVERY_ITEM_STATUSES)[number];

export const DISCOVERY_DEFICIENCY_KINDS = [
  "NO_RESPONSE",
  "PARTIAL_RESPONSE",
  "OBJECTION_ONLY",
  "MISSING_PRODUCTION",
  "INCOMPLETE_PRODUCTION",
  "UNREADABLE_DOCUMENT",
  "MISSING_ATTACHMENT",
  "BATES_GAP",
  "UNIDENTIFIED_CUSTODIAN",
  "PRIVILEGE_LOG_MISSING",
  "SUPPLEMENT_EXPECTED",
  "OTHER",
] as const;
export type DiscoveryDeficiencyKind = (typeof DISCOVERY_DEFICIENCY_KINDS)[number];

export const DISCOVERY_DEFICIENCY_STATUSES = [
  "OPEN",
  "MEET_AND_CONFER",
  "MOTION_PENDING",
  "RESOLVED",
  "WITHDRAWN",
  "UNKNOWN",
] as const;
export type DiscoveryDeficiencyStatus = (typeof DISCOVERY_DEFICIENCY_STATUSES)[number];

/** Privilege-review operational states — not a determination that a document is privileged. */
export const PRIVILEGE_REVIEW_STATUSES = [
  "ASSERTED",
  "UNDER_REVIEW",
  "CHALLENGED",
  "WITHDRAWN",
  "RESOLVED",
  "UNKNOWN",
] as const;
export type PrivilegeReviewStatus = (typeof PRIVILEGE_REVIEW_STATUSES)[number];

export type DiscoveryProvenance = {
  documentId: string | null;
  sourceSpan: string | null;
  sourcePage: number | null;
  humanEntered: boolean;
  extractionOrigin: "user_entry" | "source_metadata" | "deterministic_fixture";
};

export type DiscoveryPartyRef = {
  partyId: string;
  displayName: string;
};

export type DiscoveryRequestSet = {
  id: string;
  label: string;
  discoveryType: DiscoveryRequestType;
  requestingPartyId: string;
  respondingPartyId: string;
  servedAt: string | null;
  responseDueAt: string | null;
  isCurrent: boolean;
  supersededBySetId: string | null;
  sourceDocumentId: string | null;
  provenance: DiscoveryProvenance;
};

export type DiscoveryRequestItem = {
  id: string;
  setId: string;
  requestNumber: string;
  title: string;
  requestText: string;
  status: DiscoveryItemStatus;
  requestingPartyId: string;
  respondingPartyId: string;
  servedAt: string | null;
  responseDueAt: string | null;
  provenance: DiscoveryProvenance;
};

export type DiscoveryObjection = {
  id: string;
  itemId: string;
  responseId: string;
  basis: string;
  text: string;
  provenance: DiscoveryProvenance;
};

export type DiscoveryResponse = {
  id: string;
  itemId: string;
  label: string;
  respondedAt: string | null;
  isSupplemental: boolean;
  supplementsResponseId: string | null;
  substantiveText: string | null;
  objectionIds: string[];
  productionIds: string[];
  sourceDocumentId: string | null;
  provenance: DiscoveryProvenance;
};

export type BatesRange = {
  id: string;
  productionId: string;
  prefix: string;
  start: number;
  end: number;
  rawText: string;
  provenance: DiscoveryProvenance;
};

export type DiscoveryProduction = {
  id: string;
  label: string;
  producingPartyId: string;
  receivingPartyId: string;
  producedAt: string | null;
  isSupplemental: boolean;
  supplementsProductionId: string | null;
  transmittalDocumentId: string | null;
  documentIds: string[];
  evidenceIds: string[];
  custodianIds: string[];
  batesRanges: BatesRange[];
  requestItemIds: string[];
  notes: string | null;
  provenance: DiscoveryProvenance;
};

export type DiscoveryDeficiency = {
  id: string;
  kind: DiscoveryDeficiencyKind;
  itemId: string | null;
  productionId: string | null;
  description: string;
  status: DiscoveryDeficiencyStatus;
  openedAt: string | null;
  responsiblePartyId: string | null;
  communicationId: string | null;
  meetAndConferId: string | null;
  motionId: string | null;
  /** Review signal only — not a finding of legal violation. */
  isReviewSignal: boolean;
  provenance: DiscoveryProvenance;
};

export type PrivilegeAssertion = {
  id: string;
  status: PrivilegeReviewStatus;
  assertedBasis: string;
  assertingPartyId: string;
  assertedAt: string | null;
  documentId: string | null;
  evidenceId: string | null;
  productionId: string | null;
  privilegeLogDocumentId: string | null;
  reviewNotes: string | null;
  /** Never treat as a final court ruling unless explicitly recorded elsewhere. */
  courtRulingReferenced: boolean;
  provenance: DiscoveryProvenance;
};

export type MeetAndConferIssue = {
  id: string;
  label: string;
  deficiencyIds: string[];
  communicationId: string | null;
  occurredAt: string | null;
  outcomeNotes: string | null;
  provenance: DiscoveryProvenance;
};

export type DiscoveryMotionLink = {
  id: string;
  motionId: string;
  motionLabel: string;
  motionType: "MOTION_TO_COMPEL" | "PROTECTIVE_ORDER" | "OTHER";
  deficiencyIds: string[];
  documentId: string | null;
};

export type BatesReviewSignal = {
  kind: "OVERLAP" | "DUPLICATE" | "APPARENT_GAP";
  productionId: string;
  rangeAId: string;
  rangeBId: string | null;
  description: string;
  /** Explicitly not a legal deficiency determination. */
  legalDeficiencyConclusion: null;
};

export type DiscoveryLedgerReview = {
  matterId: string;
  organizationId: string;
  parties: DiscoveryPartyRef[];
  requestSets: DiscoveryRequestSet[];
  items: DiscoveryRequestItem[];
  responses: DiscoveryResponse[];
  objections: DiscoveryObjection[];
  productions: DiscoveryProduction[];
  deficiencies: DiscoveryDeficiency[];
  privilegeAssertions: PrivilegeAssertion[];
  meetAndConferIssues: MeetAndConferIssue[];
  motionLinks: DiscoveryMotionLink[];
  batesSignals: BatesReviewSignal[];
  coverageWarnings: string[];
  sanctionsConclusion: null;
  privilegeLegalConclusion: null;
};
