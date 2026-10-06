import { partitionEvidenceByDefendant, separateProsecutionCaseIssues } from "../deepening/evidence-scope";
import { assertProvenance } from "../legal/standards";
import type { SourceProvenance } from "../legal/types";
import {
  EVIDENCE_RELATIONSHIPS,
  PROSECUTION_GRAPH_NODE_TYPES,
  ProsecutionError,
  assertElementStatus,
  assertSameCase,
  assertTenant,
  assertTimelineEventType,
  buildElementsMatrix,
  deriveElementStatus,
  transitionDisclosure,
  type ChargeElementStatus,
  type DisclosureStatus,
  type EvidenceRelationship,
} from "./domain";

export type CriminalCaseRecord = {
  id: string;
  organizationId: string;
  matterId: string | null;
  caseNumber: string;
  jurisdiction: string;
  court: string;
  courthouse: string | null;
  caseStatus: string;
  assignedProsecutorId: string | null;
  supervisingProsecutorId: string | null;
  investigatingAgencyId: string | null;
  priority: string;
  filingDate: string | null;
  arrestDate: string | null;
  offenseDateStart: string | null;
  offenseDateEnd: string | null;
  trialDate: string | null;
  sentencingDate: string | null;
  closedDate: string | null;
  summary: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
  updatedByUserId: string | null;
};

export type DefendantRecord = {
  id: string;
  organizationId: string;
  criminalCaseId: string;
  displayName: string;
  aliases: string[];
  dateOfBirth: string | null;
  custodyStatus: string | null;
  defenseCounsel: string | null;
  notes: string | null;
  status: string;
  provenance: SourceProvenance;
  privacy: { dobRestricted: boolean };
};

export type ChargeRecord = {
  id: string;
  organizationId: string;
  criminalCaseId: string;
  defendantId: string;
  countNumber: string;
  statuteAuthorityId: string | null;
  statuteCitation: string | null;
  offenseName: string;
  offenseClassification: string | null;
  jurisdiction: string;
  filingDate: string | null;
  status: string;
  amendmentHistory: string[];
  dispositionId: string | null;
  provenance: SourceProvenance;
};

export type ChargeElementRecord = {
  id: string;
  organizationId: string;
  criminalCaseId: string;
  chargeId: string;
  elementOrder: number;
  elementText: string;
  elementType: string;
  legalStandardId: string | null;
  supportingEvidenceIds: string[];
  contraryEvidenceIds: string[];
  uncertainEvidenceIds: string[];
  missingEvidenceIds: string[];
  relatedAuthorityIds: string[];
  status: ChargeElementStatus;
  confidence: "high" | "medium" | "low";
  humanReviewStatus: string;
  provenance: SourceProvenance;
};

export type EvidenceRecord = {
  id: string;
  organizationId: string;
  criminalCaseId: string;
  documentId: string | null;
  evidenceType: string;
  sourceAgency: string | null;
  collector: string | null;
  collectionDate: string | null;
  storageReference: string | null;
  chainOfCustody: string[];
  relatedDefendantIds: string[];
  relatedChargeIds: string[];
  relatedElementIds: string[];
  relatedWitnessIds: string[];
  sensitivity: string;
  reviewStatus: string;
  provenance: SourceProvenance;
};

export type EvidenceLinkRecord = {
  id: string;
  organizationId: string;
  criminalCaseId: string;
  evidenceId: string;
  relationship: EvidenceRelationship;
  targetType: string;
  targetId: string;
  provenance: SourceProvenance;
};

export type WitnessRecord = {
  id: string;
  organizationId: string;
  criminalCaseId: string;
  entityId: string | null;
  displayName: string;
  witnessType: string;
  relationship: string | null;
  statementIds: string[];
  testimonyIds: string[];
  relatedEvidenceIds: string[];
  notes: string | null;
  sensitivity: string;
  provenance: SourceProvenance;
};

export type WitnessStatementRecord = {
  id: string;
  organizationId: string;
  criminalCaseId: string;
  witnessId: string;
  statementDate: string | null;
  statementType: string;
  sourceDocumentId: string | null;
  sourceSpan: string | null;
  interviewer: string | null;
  eventContext: string | null;
  claims: Array<{ key: string; value: string; kind?: "fact" | "time" }>;
  confidence: "high" | "medium" | "low";
  provenance: SourceProvenance;
};

export type DiscoveryRecord = {
  id: string;
  organizationId: string;
  criminalCaseId: string;
  source: string;
  category: string;
  receivedDate: string | null;
  reviewStatus: string;
  productionStatus: string;
  producedDate: string | null;
  relatedDocumentIds: string[];
  relatedEvidenceIds: string[];
  disclosureReviewStatus: string;
  notes: string | null;
  auditHistory: string[];
  provenance: SourceProvenance;
};

export type DisclosureCandidateRecord = {
  id: string;
  organizationId: string;
  criminalCaseId: string;
  category: string;
  status: DisclosureStatus;
  notes: string | null;
  humanActorId: string | null;
  provenance: SourceProvenance;
};

export type ProcedureIssueRecord = {
  id: string;
  organizationId: string;
  criminalCaseId: string;
  issueType: string;
  relatedFactIds: string[];
  relatedEvidenceIds: string[];
  relatedAuthorityIds: string[];
  missingFacts: string[];
  status: string;
  confidence: "high" | "medium" | "low";
  provenance: SourceProvenance;
};

export type WarrantRecord = {
  id: string;
  organizationId: string;
  criminalCaseId: string;
  warrantType: string;
  issuingCourt: string | null;
  issuingJudge: string | null;
  applicationDate: string | null;
  issueDate: string | null;
  executionDate: string | null;
  scope: string | null;
  probableCauseFacts: string[];
  sourceFactIds: string[];
  seizedEvidenceIds: string[];
  returnNotes: string | null;
  relatedSuppressionIssueIds: string[];
  provenance: SourceProvenance;
};

export type MotionRecord = {
  id: string;
  organizationId: string;
  criminalCaseId: string;
  motionType: string;
  filingParty: string;
  filedDate: string | null;
  issueIds: string[];
  relatedAuthorityIds: string[];
  response: string | null;
  status: string;
  ruling: string | null;
  provenance: SourceProvenance;
};

export type HearingRecord = {
  id: string;
  organizationId: string;
  criminalCaseId: string;
  hearingType: string;
  dateTime: string | null;
  court: string | null;
  judge: string | null;
  participants: string[];
  issueIds: string[];
  outcome: string | null;
  generatedDeadlineIds: string[];
  provenance: SourceProvenance;
};

export type SubpoenaRecord = {
  id: string;
  organizationId: string;
  criminalCaseId: string;
  recipient: string;
  requestScope: string;
  issueDate: string | null;
  serviceDate: string | null;
  returnDate: string | null;
  status: string;
  documentsReceived: string[];
  provenance: SourceProvenance;
};

export type PleaOfferRecord = {
  id: string;
  organizationId: string;
  criminalCaseId: string;
  terms: string;
  offerDate: string | null;
  expiration: string | null;
  status: string;
  history: string[];
  humanOwnerId: string | null;
  provenance: SourceProvenance;
};

export type DispositionRecord = {
  id: string;
  organizationId: string;
  criminalCaseId: string;
  chargeId: string;
  result: string;
  date: string | null;
  sentenceRecordId: string | null;
  notes: string | null;
  provenance: SourceProvenance;
};

export type SentencingRecord = {
  id: string;
  organizationId: string;
  criminalCaseId: string;
  conviction: string;
  chargeId: string;
  sentenceDate: string | null;
  sentenceTerms: string;
  custodial: boolean | null;
  conditions: string[];
  notes: string | null;
  sourceDocumentId: string | null;
  provenance: SourceProvenance;
};

export type AgencyRecord = {
  id: string;
  organizationId: string;
  name: string;
  agencyType: string;
  jurisdiction: string | null;
  contact: Record<string, string>;
};

export type OfficerRecord = {
  id: string;
  organizationId: string;
  criminalCaseId: string;
  agencyId: string;
  name: string;
  role: string;
  badgeIdentifier: string | null;
  reportIds: string[];
  interviewIds: string[];
  warrantIds: string[];
  evidenceCollectedIds: string[];
  testimonyIds: string[];
};

export type TimelineRecord = {
  id: string;
  organizationId: string;
  criminalCaseId: string;
  matterId: string | null;
  eventType: string;
  title: string;
  eventDate: string | null;
  provenance: SourceProvenance;
};

export type TaskRecord = {
  id: string;
  organizationId: string;
  criminalCaseId: string;
  title: string;
  status: "open" | "in_progress" | "completed" | "cancelled";
  dueAt: string | null;
};

export type AuditRecord = {
  action: string;
  organizationId: string;
  criminalCaseId: string | null;
  targetType: string;
  targetId: string;
};

export type ProsecutionSnapshot = {
  cases: CriminalCaseRecord[];
  defendants: DefendantRecord[];
  charges: ChargeRecord[];
  elements: ChargeElementRecord[];
  evidence: EvidenceRecord[];
  evidenceLinks: EvidenceLinkRecord[];
  witnesses: WitnessRecord[];
  statements: WitnessStatementRecord[];
  discovery: DiscoveryRecord[];
  disclosures: DisclosureCandidateRecord[];
  procedureIssues: ProcedureIssueRecord[];
  warrants: WarrantRecord[];
  motions: MotionRecord[];
  hearings: HearingRecord[];
  subpoenas: SubpoenaRecord[];
  pleas: PleaOfferRecord[];
  dispositions: DispositionRecord[];
  sentences: SentencingRecord[];
  agencies: AgencyRecord[];
  officers: OfficerRecord[];
  timeline: TimelineRecord[];
  tasks: TaskRecord[];
  audits: AuditRecord[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export class ProsecutionWorkspace {
  private readonly data = new Map<string, ProsecutionSnapshot>();

  private bucket(organizationId: string): ProsecutionSnapshot {
    const existing = this.data.get(organizationId);
    if (existing) return existing;
    const created: ProsecutionSnapshot = {
      cases: [],
      defendants: [],
      charges: [],
      elements: [],
      evidence: [],
      evidenceLinks: [],
      witnesses: [],
      statements: [],
      discovery: [],
      disclosures: [],
      procedureIssues: [],
      warrants: [],
      motions: [],
      hearings: [],
      subpoenas: [],
      pleas: [],
      dispositions: [],
      sentences: [],
      agencies: [],
      officers: [],
      timeline: [],
      tasks: [],
      audits: [],
    };
    this.data.set(organizationId, created);
    return created;
  }

  snapshot(organizationId: string): ProsecutionSnapshot {
    return this.bucket(organizationId);
  }

  private requireCase(organizationId: string, caseId: string): CriminalCaseRecord {
    const found = this.bucket(organizationId).cases.find((item) => item.id === caseId);
    if (!found) throw new ProsecutionError("NOT_FOUND", "Criminal case not found.", 404);
    assertTenant(organizationId, found.organizationId);
    return found;
  }

  private audit(snapshot: ProsecutionSnapshot, event: AuditRecord) {
    snapshot.audits.push(event);
  }

  createCase(input: Omit<CriminalCaseRecord, "createdAt" | "updatedAt" | "id"> & { id?: string }): CriminalCaseRecord {
    const snapshot = this.bucket(input.organizationId);
    const record: CriminalCaseRecord = {
      ...input,
      id: input.id ?? id("case"),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    snapshot.cases.push(record);
    this.audit(snapshot, {
      action: "prosecution.case_created",
      organizationId: record.organizationId,
      criminalCaseId: record.id,
      targetType: "criminal_case",
      targetId: record.id,
    });
    return record;
  }

  addDefendant(input: Omit<DefendantRecord, "id"> & { id?: string }): DefendantRecord {
    this.requireCase(input.organizationId, input.criminalCaseId);
    assertProvenance(input.provenance);
    const record = { ...input, id: input.id ?? id("def") };
    this.bucket(input.organizationId).defendants.push(record);
    return record;
  }

  addCharge(input: Omit<ChargeRecord, "id"> & { id?: string }): ChargeRecord {
    const snapshot = this.bucket(input.organizationId);
    const criminalCase = this.requireCase(input.organizationId, input.criminalCaseId);
    const defendant = snapshot.defendants.find((item) => item.id === input.defendantId);
    if (!defendant) throw new ProsecutionError("ORPHAN_REFERENCE", "Defendant not found.");
    assertSameCase(criminalCase.id, defendant.criminalCaseId);
    assertTenant(input.organizationId, defendant.organizationId);
    assertProvenance(input.provenance);
    const record = { ...input, id: input.id ?? id("chg") };
    snapshot.charges.push(record);
    this.audit(snapshot, {
      action: "prosecution.charge_modified",
      organizationId: input.organizationId,
      criminalCaseId: input.criminalCaseId,
      targetType: "charge",
      targetId: record.id,
    });
    return record;
  }

  addElement(input: Omit<ChargeElementRecord, "id" | "status"> & { id?: string; status?: ChargeElementStatus }): ChargeElementRecord {
    const snapshot = this.bucket(input.organizationId);
    const charge = snapshot.charges.find((item) => item.id === input.chargeId);
    if (!charge) throw new ProsecutionError("ORPHAN_REFERENCE", "Charge not found.");
    assertTenant(input.organizationId, charge.organizationId);
    assertSameCase(input.criminalCaseId, charge.criminalCaseId);
    assertProvenance(input.provenance);
    const status = input.status ?? deriveElementStatus(input);
    assertElementStatus(status);
    const record: ChargeElementRecord = { ...input, id: input.id ?? id("el"), status };
    snapshot.elements.push(record);
    this.audit(snapshot, {
      action: "prosecution.element_modified",
      organizationId: input.organizationId,
      criminalCaseId: input.criminalCaseId,
      targetType: "charge_element",
      targetId: record.id,
    });
    return record;
  }

  addEvidence(input: Omit<EvidenceRecord, "id"> & { id?: string }): EvidenceRecord {
    this.requireCase(input.organizationId, input.criminalCaseId);
    assertProvenance(input.provenance);
    const record = { ...input, id: input.id ?? id("ev") };
    this.bucket(input.organizationId).evidence.push(record);
    return record;
  }

  linkEvidence(input: Omit<EvidenceLinkRecord, "id"> & { id?: string }): EvidenceLinkRecord {
    const snapshot = this.bucket(input.organizationId);
    const evidence = snapshot.evidence.find((item) => item.id === input.evidenceId);
    if (!evidence) throw new ProsecutionError("ORPHAN_REFERENCE", "Evidence item not found.");
    assertTenant(input.organizationId, evidence.organizationId);
    assertSameCase(input.criminalCaseId, evidence.criminalCaseId);
    if (!(EVIDENCE_RELATIONSHIPS as readonly string[]).includes(input.relationship)) {
      throw new ProsecutionError("INVALID_EVIDENCE_RELATIONSHIP", "Unsupported evidence relationship.");
    }
    assertProvenance(input.provenance);
    const record = { ...input, id: input.id ?? id("link") };
    snapshot.evidenceLinks.push(record);
    this.audit(snapshot, {
      action: "prosecution.evidence_link_changed",
      organizationId: input.organizationId,
      criminalCaseId: input.criminalCaseId,
      targetType: "evidence_link",
      targetId: record.id,
    });
    return record;
  }

  addWitness(input: Omit<WitnessRecord, "id"> & { id?: string }): WitnessRecord {
    this.requireCase(input.organizationId, input.criminalCaseId);
    assertProvenance(input.provenance);
    const record = { ...input, id: input.id ?? id("wit") };
    this.bucket(input.organizationId).witnesses.push(record);
    return record;
  }

  addStatement(input: Omit<WitnessStatementRecord, "id"> & { id?: string }): WitnessStatementRecord {
    const snapshot = this.bucket(input.organizationId);
    const witness = snapshot.witnesses.find((item) => item.id === input.witnessId);
    if (!witness) throw new ProsecutionError("ORPHAN_REFERENCE", "Witness not found.");
    assertSameCase(input.criminalCaseId, witness.criminalCaseId);
    assertTenant(input.organizationId, witness.organizationId);
    assertProvenance(input.provenance);
    const record = { ...input, id: input.id ?? id("stmt") };
    snapshot.statements.push(record);
    witness.statementIds.push(record.id);
    return record;
  }

  addDiscovery(input: Omit<DiscoveryRecord, "id"> & { id?: string }): DiscoveryRecord {
    this.requireCase(input.organizationId, input.criminalCaseId);
    assertProvenance(input.provenance);
    const record = { ...input, id: input.id ?? id("disc") };
    const snapshot = this.bucket(input.organizationId);
    snapshot.discovery.push(record);
    this.audit(snapshot, {
      action: "prosecution.discovery_review_changed",
      organizationId: input.organizationId,
      criminalCaseId: input.criminalCaseId,
      targetType: "discovery_item",
      targetId: record.id,
    });
    return record;
  }

  addDisclosure(input: Omit<DisclosureCandidateRecord, "id" | "status"> & { id?: string; status?: DisclosureStatus; humanActor?: boolean }): DisclosureCandidateRecord {
    this.requireCase(input.organizationId, input.criminalCaseId);
    assertProvenance(input.provenance);
    const status = transitionDisclosure({ next: input.status ?? "UNREVIEWED", humanActor: input.humanActor ?? false });
    const record: DisclosureCandidateRecord = {
      id: input.id ?? id("disc-rev"),
      organizationId: input.organizationId,
      criminalCaseId: input.criminalCaseId,
      category: input.category,
      status,
      notes: input.notes,
      humanActorId: input.humanActorId,
      provenance: input.provenance,
    };
    const snapshot = this.bucket(input.organizationId);
    snapshot.disclosures.push(record);
    this.audit(snapshot, {
      action: "prosecution.disclosure_review_changed",
      organizationId: input.organizationId,
      criminalCaseId: input.criminalCaseId,
      targetType: "disclosure_review",
      targetId: record.id,
    });
    return record;
  }

  addProcedureIssue(input: Omit<ProcedureIssueRecord, "id"> & { id?: string }): ProcedureIssueRecord {
    this.requireCase(input.organizationId, input.criminalCaseId);
    assertProvenance(input.provenance);
    const record = { ...input, id: input.id ?? id("proc") };
    this.bucket(input.organizationId).procedureIssues.push(record);
    return record;
  }

  addWarrant(input: Omit<WarrantRecord, "id"> & { id?: string }): WarrantRecord {
    this.requireCase(input.organizationId, input.criminalCaseId);
    assertProvenance(input.provenance);
    const record = { ...input, id: input.id ?? id("war") };
    this.bucket(input.organizationId).warrants.push(record);
    return record;
  }

  addMotion(input: Omit<MotionRecord, "id"> & { id?: string }): MotionRecord {
    this.requireCase(input.organizationId, input.criminalCaseId);
    assertProvenance(input.provenance);
    const record = { ...input, id: input.id ?? id("mot") };
    this.bucket(input.organizationId).motions.push(record);
    return record;
  }

  addHearing(input: Omit<HearingRecord, "id"> & { id?: string }): HearingRecord {
    this.requireCase(input.organizationId, input.criminalCaseId);
    assertProvenance(input.provenance);
    const record = { ...input, id: input.id ?? id("hear") };
    this.bucket(input.organizationId).hearings.push(record);
    return record;
  }

  addSubpoena(input: Omit<SubpoenaRecord, "id"> & { id?: string }): SubpoenaRecord {
    this.requireCase(input.organizationId, input.criminalCaseId);
    assertProvenance(input.provenance);
    const record = { ...input, id: input.id ?? id("sub") };
    this.bucket(input.organizationId).subpoenas.push(record);
    return record;
  }

  addPlea(input: Omit<PleaOfferRecord, "id"> & { id?: string }): PleaOfferRecord {
    if (!input.humanOwnerId) {
      throw new ProsecutionError("PLEA_HUMAN_REQUIRED", "Plea records require a human owner. Nyaya does not recommend a plea.");
    }
    this.requireCase(input.organizationId, input.criminalCaseId);
    assertProvenance(input.provenance);
    const record = { ...input, id: input.id ?? id("plea") };
    const snapshot = this.bucket(input.organizationId);
    snapshot.pleas.push(record);
    this.audit(snapshot, {
      action: "prosecution.plea_modified",
      organizationId: input.organizationId,
      criminalCaseId: input.criminalCaseId,
      targetType: "plea_offer",
      targetId: record.id,
    });
    return record;
  }

  addDisposition(input: Omit<DispositionRecord, "id"> & { id?: string }): DispositionRecord {
    const snapshot = this.bucket(input.organizationId);
    const charge = snapshot.charges.find((item) => item.id === input.chargeId);
    if (!charge) throw new ProsecutionError("ORPHAN_REFERENCE", "Charge not found.");
    assertSameCase(input.criminalCaseId, charge.criminalCaseId);
    assertProvenance(input.provenance);
    const record = { ...input, id: input.id ?? id("disp") };
    snapshot.dispositions.push(record);
    this.audit(snapshot, {
      action: "prosecution.disposition_modified",
      organizationId: input.organizationId,
      criminalCaseId: input.criminalCaseId,
      targetType: "disposition",
      targetId: record.id,
    });
    return record;
  }

  addSentence(input: Omit<SentencingRecord, "id"> & { id?: string }): SentencingRecord {
    this.requireCase(input.organizationId, input.criminalCaseId);
    assertProvenance(input.provenance);
    const record = { ...input, id: input.id ?? id("sent") };
    this.bucket(input.organizationId).sentences.push(record);
    return record;
  }

  addAgency(input: Omit<AgencyRecord, "id"> & { id?: string }): AgencyRecord {
    const record = { ...input, id: input.id ?? id("agy") };
    this.bucket(input.organizationId).agencies.push(record);
    return record;
  }

  addOfficer(input: Omit<OfficerRecord, "id"> & { id?: string }): OfficerRecord {
    this.requireCase(input.organizationId, input.criminalCaseId);
    const record = { ...input, id: input.id ?? id("off") };
    this.bucket(input.organizationId).officers.push(record);
    return record;
  }

  addTimeline(input: Omit<TimelineRecord, "id"> & { id?: string }): TimelineRecord {
    const criminalCase = this.requireCase(input.organizationId, input.criminalCaseId);
    assertTimelineEventType(input.eventType);
    assertProvenance(input.provenance);
    const record = { ...input, matterId: input.matterId ?? criminalCase.matterId, id: input.id ?? id("tl") };
    this.bucket(input.organizationId).timeline.push(record);
    return record;
  }

  addTask(input: Omit<TaskRecord, "id"> & { id?: string }): TaskRecord {
    this.requireCase(input.organizationId, input.criminalCaseId);
    const record = { ...input, id: input.id ?? id("task") };
    this.bucket(input.organizationId).tasks.push(record);
    return record;
  }

  matrix(organizationId: string, caseId: string) {
    const snapshot = this.bucket(organizationId);
    this.requireCase(organizationId, caseId);
    return buildElementsMatrix({
      charges: snapshot.charges.filter((item) => item.criminalCaseId === caseId),
      elements: snapshot.elements.filter((item) => item.criminalCaseId === caseId),
    });
  }

  overview(organizationId: string, caseId: string) {
    const snapshot = this.bucket(organizationId);
    const criminalCase = this.requireCase(organizationId, caseId);
    const matrix = this.matrix(organizationId, caseId);
    const defendants = snapshot.defendants.filter((item) => item.criminalCaseId === caseId);
    const charges = snapshot.charges.filter((item) => item.criminalCaseId === caseId);
    const issueFlags = snapshot.procedureIssues.filter((item) => item.criminalCaseId === caseId);
    const evidence = snapshot.evidence.filter((item) => item.criminalCaseId === caseId);
    const elementGaps = matrix.filter(
      (row) => row.status === "NO_EVIDENCE_FOUND" || row.status === "CONFLICTED" || row.status === "UNKNOWN",
    );
    return {
      case: criminalCase,
      defendants,
      charges,
      hearings: snapshot.hearings.filter((item) => item.criminalCaseId === caseId),
      openTasks: snapshot.tasks.filter((item) => item.criminalCaseId === caseId && item.status === "open"),
      evidenceCount: evidence.length,
      discoveryCount: snapshot.discovery.filter((item) => item.criminalCaseId === caseId).length,
      witnessCount: snapshot.witnesses.filter((item) => item.criminalCaseId === caseId).length,
      elementGaps,
      issueFlags,
      issueSeparation: separateProsecutionCaseIssues({
        charges: charges.map((charge) => ({
          id: charge.id,
          offenseName: charge.offenseName,
          countNumber: charge.countNumber,
          status: charge.status,
          defendantId: charge.defendantId,
        })),
        procedureIssues: issueFlags.map((issue) => ({
          id: issue.id,
          issueType: issue.issueType,
          status: issue.status,
        })),
        elementGaps: elementGaps.map((gap) => ({
          id: gap.elementId,
          elementText: gap.elementText,
          status: gap.status,
        })),
      }),
      evidenceScope: partitionEvidenceByDefendant({
        defendants: defendants.map((defendant) => ({ id: defendant.id, displayName: defendant.displayName })),
        evidence: evidence.map((item) => ({ id: item.id, relatedDefendantIds: item.relatedDefendantIds })),
      }),
      guiltConclusion: null,
    };
  }

  graph(organizationId: string, caseId: string) {
    const snapshot = this.bucket(organizationId);
    this.requireCase(organizationId, caseId);
    const nodes: Array<{ nodeType: (typeof PROSECUTION_GRAPH_NODE_TYPES)[number]; id: string; provenance: SourceProvenance | null }> = [];
    const edges: Array<{ fromId: string; toId: string; relationship: string; provenance: SourceProvenance }> = [];
    const criminalCase = snapshot.cases.find((item) => item.id === caseId)!;
    nodes.push({
      nodeType: "CriminalCase",
      id: criminalCase.id,
      provenance: { extractionOrigin: "human", humanEntered: true },
    });
    for (const defendant of snapshot.defendants.filter((item) => item.criminalCaseId === caseId)) {
      nodes.push({ nodeType: "Defendant", id: defendant.id, provenance: defendant.provenance });
      edges.push({ fromId: criminalCase.id, toId: defendant.id, relationship: "HAS_DEFENDANT", provenance: defendant.provenance });
    }
    for (const charge of snapshot.charges.filter((item) => item.criminalCaseId === caseId)) {
      nodes.push({ nodeType: "Charge", id: charge.id, provenance: charge.provenance });
      edges.push({ fromId: charge.defendantId, toId: charge.id, relationship: "CHARGED_WITH", provenance: charge.provenance });
    }
    for (const element of snapshot.elements.filter((item) => item.criminalCaseId === caseId)) {
      nodes.push({ nodeType: "ChargeElement", id: element.id, provenance: element.provenance });
      edges.push({ fromId: element.chargeId, toId: element.id, relationship: "HAS_ELEMENT", provenance: element.provenance });
    }
    for (const evidence of snapshot.evidence.filter((item) => item.criminalCaseId === caseId)) {
      nodes.push({ nodeType: "EvidenceItem", id: evidence.id, provenance: evidence.provenance });
    }
    for (const link of snapshot.evidenceLinks.filter((item) => item.criminalCaseId === caseId)) {
      edges.push({ fromId: link.evidenceId, toId: link.targetId, relationship: link.relationship, provenance: link.provenance });
    }
    for (const witness of snapshot.witnesses.filter((item) => item.criminalCaseId === caseId)) {
      nodes.push({ nodeType: "Witness", id: witness.id, provenance: witness.provenance });
    }
    for (const warrant of snapshot.warrants.filter((item) => item.criminalCaseId === caseId)) {
      nodes.push({ nodeType: "Warrant", id: warrant.id, provenance: warrant.provenance });
    }
    for (const motion of snapshot.motions.filter((item) => item.criminalCaseId === caseId)) {
      nodes.push({ nodeType: "Motion", id: motion.id, provenance: motion.provenance });
    }
    for (const hearing of snapshot.hearings.filter((item) => item.criminalCaseId === caseId)) {
      nodes.push({ nodeType: "Hearing", id: hearing.id, provenance: hearing.provenance });
    }
    for (const subpoena of snapshot.subpoenas.filter((item) => item.criminalCaseId === caseId)) {
      nodes.push({ nodeType: "Subpoena", id: subpoena.id, provenance: subpoena.provenance });
    }
    for (const item of snapshot.discovery.filter((row) => row.criminalCaseId === caseId)) {
      nodes.push({ nodeType: "DiscoveryItem", id: item.id, provenance: item.provenance });
    }
    for (const issue of snapshot.procedureIssues.filter((item) => item.criminalCaseId === caseId)) {
      nodes.push({ nodeType: "LegalIssue", id: issue.id, provenance: issue.provenance });
    }
    for (const officer of snapshot.officers.filter((item) => item.criminalCaseId === caseId)) {
      nodes.push({ nodeType: "Officer", id: officer.id, provenance: { extractionOrigin: "human", humanEntered: true } });
    }
    for (const agency of snapshot.agencies.filter((item) => item.organizationId === organizationId)) {
      nodes.push({ nodeType: "Agency", id: agency.id, provenance: { extractionOrigin: "human", humanEntered: true } });
    }
    return { nodes, edges };
  }
}
