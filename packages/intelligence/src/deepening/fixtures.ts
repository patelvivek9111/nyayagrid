import { compareWitnessStatements } from "../prosecution/domain";
import { ProsecutionWorkspace } from "../prosecution/memory";
import { decomposeQuestion } from "../week4/decompose";
import { buildClaimMatrix, buildLawEvidenceBundle } from "../week4/law-evidence-join";
import type { QueryContext } from "../week4/types";
import { checkWholeMatterConsistency } from "./consistency";
import { decomposeMatterIssues } from "./decompose-matter";
import { partitionEvidenceByDefendant, separateProsecutionCaseIssues } from "./evidence-scope";
import { assessAnalysisFreshness } from "./freshness";
import { buildWholeMatterAnalysis, formatLongFormAnalysis } from "./whole-matter";

const PROV = {
  extractionOrigin: "deterministic_fixture" as const,
  humanEntered: false,
  sourceSpan: "Synthetic source span.",
};

const LAW_FIRM_QUESTION =
  "What are the strengths and weaknesses of the breach claim and the statutory notice defense, including damages and contrary authority?";

export function runDeepeningLawFirm() {
  const context: QueryContext = {
    organizationId: "org-synthetic-firm",
    workspaceType: "professional",
    matterId: "matter-deep-1",
    jurisdiction: "US",
    forumCourt: "us-d-pa-ed",
    issueType: "FEDERAL_STATUTORY",
    userQuestion: LAW_FIRM_QUESTION,
    subjectMatter: "civil",
  };
  const bundle = buildLawEvidenceBundle({
    context,
    evidenceCorpus: [
      {
        id: "ev-letter",
        organizationId: context.organizationId,
        matterId: context.matterId,
        kind: "exhibit",
        text: "Letter exhibit states the tenant performed the written lease.",
        documentId: "doc-letter",
        relation: "SUPPORTS",
        provenance: { ...PROV, documentId: "doc-letter", sourcePage: 1 },
      },
      {
        id: "ev-log",
        organizationId: context.organizationId,
        matterId: context.matterId,
        kind: "log",
        text: "Recipient log has no entry for the notice.",
        documentId: "doc-log",
        relation: "CONTRADICTS",
        provenance: { ...PROV, documentId: "doc-log", sourcePage: 2 },
      },
      {
        id: "ev-invoice",
        organizationId: context.organizationId,
        matterId: context.matterId,
        kind: "exhibit",
        text: "Invoice lists the claimed repair amount.",
        documentId: "doc-invoice",
        relation: "SUPPORTS",
        provenance: { ...PROV, documentId: "doc-invoice", sourcePage: 3 },
      },
      {
        id: "ev-unassigned",
        organizationId: context.organizationId,
        matterId: context.matterId,
        kind: "note",
        text: "Cover email with no issue tag.",
        documentId: "doc-email",
        relation: "SUPPORTS",
        provenance: { ...PROV, documentId: "doc-email", sourcePage: 4 },
      },
    ],
    authorityHits: [
      {
        authorityId: "auth-3d",
        citation: "SYNTHETIC-3D-2020-001",
        courtId: "us-ca-3",
        jurisdiction: "US",
        authorityType: "case",
        score: 0.62,
        title: "Synthetic Third Circuit notice case",
        snippet: "written notice",
      },
      {
        authorityId: "auth-contrary",
        citation: "SYNTHETIC-2D-2019-014",
        courtId: "us-ca-2",
        jurisdiction: "US",
        authorityType: "case",
        score: 0.8,
        title: "Synthetic contrary notice discussion",
        snippet: "notice not required",
      },
    ],
    contraryAuthorityIds: ["auth-contrary"],
    standards: [
      {
        id: "std-notice",
        authorityId: "auth-3d",
        ruleText: "Synthetic rule: written notice must be delivered by the method in the lease.",
        sourceSpan: "Synthetic source span.",
        sourceCitation: "SYNTHETIC-3D-2020-001",
      },
    ],
    facts: [
      {
        id: "fact-perform",
        text: "The letter describes performance of the lease.",
        provenance: { ...PROV, documentId: "doc-letter" },
      },
    ],
    requirements: [
      { id: "req-perform", text: "performance of the lease", claimOrChargeId: "claim-breach", status: "SUPPORTED" },
      { id: "req-notice", text: "statutory notice delivery", claimOrChargeId: "defense-notice", status: "CONFLICTED" },
      { id: "req-damages", text: "proof of damages", claimOrChargeId: "claim-damages", status: "PARTIALLY_SUPPORTED" },
    ],
    missingEvidence: [
      {
        id: "missing-delivery",
        description: "Missing defenses proof: no delivery receipt for the statutory notice.",
        relatedRequirementId: "req-notice",
      },
    ],
    treatment: [{ authorityId: "auth-3d", label: "UNKNOWN", verification: "unknown" }],
  });
  const issueId = (pattern: RegExp) => {
    const index = decomposeMatterIssues(context).issues.findIndex((issue) => pattern.test(issue.description));
    if (index < 0) throw new Error(`Missing issue for ${pattern}`);
    return `issue-${index + 1}`;
  };
  const analysis = buildWholeMatterAnalysis({
    context,
    bundle,
    evidenceLinks: [
      { evidenceId: "ev-letter", issueId: issueId(/strength and weakness/i), relation: "SUPPORTS" },
      { evidenceId: "ev-log", issueId: issueId(/defense/i), relation: "CONTRADICTS" },
      { evidenceId: "ev-invoice", issueId: issueId(/damages/i), relation: "SUPPORTS" },
    ],
  });
  const longForm = formatLongFormAnalysis({ analysis, bundle });
  const primary = decomposeQuestion(context).issues[0]?.description ?? "";
  const claimMatrix = buildClaimMatrix([
    {
      claimOrDefenseId: "claim-breach",
      label: "Synthetic breach claim",
      requirementId: "req-perform",
      requirementText: "performance of the lease",
      supportingEvidence: [{ id: "ev-letter", text: "Letter exhibit states the tenant performed the written lease." }],
      contraryEvidence: [],
      missingEvidence: [],
      governingAuthorities: [{ authorityId: "auth-3d", status: "BINDING", citation: "SYNTHETIC-3D-2020-001" }],
      status: "SUPPORTED",
      provenance: { sourceSpan: "Synthetic source span.", documentId: "doc-letter" },
    },
    {
      claimOrDefenseId: "defense-notice",
      label: "Synthetic notice defense",
      requirementId: "req-notice",
      requirementText: "statutory notice delivery",
      supportingEvidence: [],
      contraryEvidence: [{ id: "ev-log", text: "Recipient log has no entry for the notice." }],
      missingEvidence: [{ id: "missing-delivery", description: "No delivery receipt." }],
      governingAuthorities: [
        { authorityId: "auth-3d", status: "BINDING", citation: "SYNTHETIC-3D-2020-001" },
        { authorityId: "auth-contrary", status: "CONTRARY", citation: "SYNTHETIC-2D-2019-014" },
      ],
      status: "CONFLICTED",
      provenance: { sourceSpan: "Synthetic source span.", documentId: "doc-log" },
    },
  ]);
  const consistency = checkWholeMatterConsistency({
    analysis,
    longForm,
    primaryIssueDescription: primary,
    overviewIssueIds: analysis.issues.map((issue) => issue.issueId),
    matrixRows: [
      { id: "req-perform", supportingEvidenceIds: ["ev-letter"], contraryEvidenceIds: [] },
      { id: "req-notice", supportingEvidenceIds: [], contraryEvidenceIds: ["ev-log"] },
    ],
    theorySupportingIds: analysis.issues.flatMap((issue) => issue.supportingEvidenceIds),
    theoryContraryIds: analysis.issues.flatMap((issue) => issue.contraryEvidenceIds),
  });
  const priorEvidenceIds = ["ev-letter", "ev-log", "ev-invoice", "ev-unassigned"];
  const freshness = assessAnalysisFreshness({
    priorEvidenceIds,
    priorIssueEvidence: analysis.issues.map((issue) => ({
      issueId: issue.issueId,
      evidenceIds: [...issue.supportingEvidenceIds, ...issue.contraryEvidenceIds],
    })),
    currentEvidenceIds: [...priorEvidenceIds, "ev-supplemental"],
    newContradictionEvidenceIds: ["ev-log"],
  });
  return {
    context,
    bundle,
    analysis,
    longForm,
    claimMatrix,
    consistency,
    freshness,
    separatedIssueCount: decomposeMatterIssues(context).issues.length,
    guiltConclusion: null as null,
    outcomeConclusion: null as null,
  };
}

export function runDeepeningProsecution() {
  const workspace = new ProsecutionWorkspace();
  const organizationId = "org-synthetic-prosecution-deep";
  const criminalCase = workspace.createCase({
    organizationId,
    matterId: null,
    caseNumber: "SYN-CR-2002",
    jurisdiction: "PA",
    court: "st-pa-trial",
    courthouse: "Synthetic Courthouse",
    caseStatus: "open",
    assignedProsecutorId: "user-prosecutor",
    supervisingProsecutorId: "user-supervisor",
    investigatingAgencyId: null,
    priority: "normal",
    filingDate: "2026-04-01",
    arrestDate: null,
    offenseDateStart: "2026-03-02",
    offenseDateEnd: "2026-03-02",
    trialDate: null,
    sentencingDate: null,
    closedDate: null,
    summary: "Synthetic two-defendant prosecution fixture.",
    notes: null,
    createdByUserId: "user-prosecutor",
    updatedByUserId: "user-prosecutor",
  });
  const ada = workspace.addDefendant({
    organizationId,
    criminalCaseId: criminalCase.id,
    displayName: "Synthetic Defendant Ada",
    aliases: [],
    dateOfBirth: null,
    custodyStatus: "released",
    defenseCounsel: "Synthetic Counsel A",
    notes: null,
    status: "active",
    provenance: PROV,
    privacy: { dobRestricted: true },
  });
  const ben = workspace.addDefendant({
    organizationId,
    criminalCaseId: criminalCase.id,
    displayName: "Synthetic Defendant Ben",
    aliases: [],
    dateOfBirth: null,
    custodyStatus: "released",
    defenseCounsel: "Synthetic Counsel B",
    notes: null,
    status: "active",
    provenance: PROV,
    privacy: { dobRestricted: true },
  });
  const chargeAda = workspace.addCharge({
    organizationId,
    criminalCaseId: criminalCase.id,
    defendantId: ada.id,
    countNumber: "1",
    statuteAuthorityId: null,
    statuteCitation: "SYNTHETIC-STATUTE-1",
    offenseName: "Synthetic theft count",
    offenseClassification: "misdemeanor",
    jurisdiction: "PA",
    filingDate: "2026-04-01",
    status: "pending",
    amendmentHistory: [],
    dispositionId: null,
    provenance: PROV,
  });
  const chargeBen = workspace.addCharge({
    organizationId,
    criminalCaseId: criminalCase.id,
    defendantId: ben.id,
    countNumber: "2",
    statuteAuthorityId: null,
    statuteCitation: "SYNTHETIC-STATUTE-2",
    offenseName: "Synthetic receiving count",
    offenseClassification: "misdemeanor",
    jurisdiction: "PA",
    filingDate: "2026-04-01",
    status: "pending",
    amendmentHistory: [],
    dispositionId: null,
    provenance: PROV,
  });
  const joint = workspace.addEvidence({
    organizationId,
    criminalCaseId: criminalCase.id,
    documentId: "doc-scene",
    evidenceType: "scene_photo",
    sourceAgency: null,
    collector: null,
    collectionDate: "2026-03-02",
    storageReference: "SYN-JOINT",
    chainOfCustody: ["logged"],
    relatedDefendantIds: [ada.id, ben.id],
    relatedChargeIds: [chargeAda.id, chargeBen.id],
    relatedElementIds: [],
    relatedWitnessIds: [],
    sensitivity: "standard",
    reviewStatus: "received",
    provenance: { ...PROV, documentId: "doc-scene" },
  });
  const adaOnly = workspace.addEvidence({
    organizationId,
    criminalCaseId: criminalCase.id,
    documentId: "doc-ada",
    evidenceType: "statement",
    sourceAgency: null,
    collector: null,
    collectionDate: "2026-03-03",
    storageReference: "SYN-ADA",
    chainOfCustody: ["logged"],
    relatedDefendantIds: [ada.id],
    relatedChargeIds: [chargeAda.id],
    relatedElementIds: [],
    relatedWitnessIds: [],
    sensitivity: "standard",
    reviewStatus: "received",
    provenance: { ...PROV, documentId: "doc-ada" },
  });
  const benOnly = workspace.addEvidence({
    organizationId,
    criminalCaseId: criminalCase.id,
    documentId: "doc-ben",
    evidenceType: "statement",
    sourceAgency: null,
    collector: null,
    collectionDate: "2026-03-04",
    storageReference: "SYN-BEN",
    chainOfCustody: ["logged"],
    relatedDefendantIds: [ben.id],
    relatedChargeIds: [chargeBen.id],
    relatedElementIds: [],
    relatedWitnessIds: [],
    sensitivity: "standard",
    reviewStatus: "received",
    provenance: { ...PROV, documentId: "doc-ben" },
  });
  workspace.addElement({
    organizationId,
    criminalCaseId: criminalCase.id,
    chargeId: chargeAda.id,
    elementOrder: 1,
    elementText: "Identity of the person at the scene",
    elementType: "element",
    legalStandardId: null,
    supportingEvidenceIds: [],
    contraryEvidenceIds: [],
    uncertainEvidenceIds: [],
    missingEvidenceIds: ["missing-bodycam"],
    relatedAuthorityIds: ["auth-pa-high"],
    status: "NO_EVIDENCE_FOUND",
    confidence: "low",
    humanReviewStatus: "unreviewed",
    provenance: PROV,
  });
  const procedure = workspace.addProcedureIssue({
    organizationId,
    criminalCaseId: criminalCase.id,
    issueType: "WARRANT",
    relatedFactIds: [],
    relatedEvidenceIds: [joint.id],
    relatedAuthorityIds: ["auth-pa-high"],
    missingFacts: ["Affidavit does not identify which device was searched."],
    status: "open",
    confidence: "low",
    provenance: PROV,
  });
  workspace.addWarrant({
    organizationId,
    criminalCaseId: criminalCase.id,
    warrantType: "search",
    issuingCourt: "st-pa-trial",
    issuingJudge: null,
    applicationDate: "2026-03-01",
    issueDate: "2026-03-01",
    executionDate: "2026-03-02",
    scope: "Synthetic residence",
    probableCauseFacts: ["Officer report describes a witness observation."],
    sourceFactIds: [],
    seizedEvidenceIds: [joint.id],
    returnNotes: null,
    relatedSuppressionIssueIds: [procedure.id],
    provenance: PROV,
  });
  workspace.addDiscovery({
    organizationId,
    criminalCaseId: criminalCase.id,
    source: "Synthetic Police Department",
    category: "bodycam",
    receivedDate: "2026-03-10",
    reviewStatus: "RECEIVED",
    productionStatus: "RECEIVED",
    producedDate: null,
    relatedDocumentIds: [],
    relatedEvidenceIds: [],
    disclosureReviewStatus: "UNREVIEWED",
    notes: "Initial production. Supplemental bodycam not received.",
    auditHistory: ["received"],
    provenance: PROV,
  });
  const witnessComparison = compareWitnessStatements(
    [
      { key: "time", value: "21:00", kind: "time" },
      { key: "location", value: "front door", kind: "fact" },
    ],
    [
      { key: "time", value: "22:30", kind: "time" },
      { key: "location", value: "front door", kind: "fact" },
      { key: "clothing", value: "dark jacket", kind: "fact" },
    ],
  );
  const context: QueryContext = {
    organizationId,
    workspaceType: "prosecution",
    criminalCaseId: criminalCase.id,
    jurisdiction: "PA",
    forumCourt: "st-pa-trial",
    issueType: "STATE_LAW",
    userQuestion:
      "What are the strengths and weaknesses of the charges, which witness statements conflict, and what warrant suppression issues should be reviewed alongside missing discovery?",
    subjectMatter: "criminal",
  };
  const bundle = buildLawEvidenceBundle({
    context,
    evidenceCorpus: [
      {
        id: joint.id,
        organizationId,
        criminalCaseId: criminalCase.id,
        kind: "scene_photo",
        text: "Scene photo is shared across both defendants.",
        documentId: "doc-scene",
        relation: "SUPPORTS",
        provenance: { ...PROV, documentId: "doc-scene" },
      },
      {
        id: adaOnly.id,
        organizationId,
        criminalCaseId: criminalCase.id,
        kind: "statement",
        text: "Statement attributed to the first defendant only.",
        documentId: "doc-ada",
        relation: "SUPPORTS",
        provenance: { ...PROV, documentId: "doc-ada" },
      },
      {
        id: benOnly.id,
        organizationId,
        criminalCaseId: criminalCase.id,
        kind: "statement",
        text: "Second statement gives a different time than the first statement.",
        documentId: "doc-ben",
        relation: "CONTRADICTS",
        provenance: { ...PROV, documentId: "doc-ben" },
      },
    ],
    authorityHits: [
      {
        authorityId: "auth-pa-high",
        citation: "SYNTHETIC-PA-2018-004",
        courtId: "st-pa-high",
        jurisdiction: "PA",
        authorityType: "case",
        score: 0.7,
        snippet: "search warrant probable cause",
      },
      {
        authorityId: "auth-contrary",
        citation: "SYNTHETIC-NJ-2017-009",
        courtId: "st-nj-high",
        jurisdiction: "NJ",
        authorityType: "case",
        score: 0.66,
        snippet: "contrary discussion of warrant scope",
      },
    ],
    contraryAuthorityIds: ["auth-contrary"],
    missingEvidence: [
      {
        id: "missing-bodycam",
        description: "Missing discovery disclosure review: supplemental bodycam was not produced.",
        relatedRequirementId: chargeAda.id,
      },
    ],
    requirements: [
      { id: "el-identity", text: "Identity of the person at the scene", claimOrChargeId: chargeAda.id, status: "NO_EVIDENCE_FOUND" },
    ],
  });
  const analysis = buildWholeMatterAnalysis({
    context,
    bundle,
    evidenceLinks: [
      { evidenceId: joint.id, issueId: "issue-4", relation: "SUPPORTS" },
      { evidenceId: adaOnly.id, issueId: "issue-4", relation: "SUPPORTS" },
      { evidenceId: benOnly.id, issueId: "issue-2", relation: "CONTRADICTS" },
    ],
  });
  const longForm = formatLongFormAnalysis({ analysis, bundle });
  const overview = workspace.overview(organizationId, criminalCase.id);
  const evidenceScope = partitionEvidenceByDefendant({
    defendants: [
      { id: ada.id, displayName: ada.displayName },
      { id: ben.id, displayName: ben.displayName },
    ],
    evidence: [
      { id: joint.id, relatedDefendantIds: [ada.id, ben.id] },
      { id: adaOnly.id, relatedDefendantIds: [ada.id] },
      { id: benOnly.id, relatedDefendantIds: [ben.id] },
    ],
  });
  const issueSeparation = separateProsecutionCaseIssues({
    charges: [
      { id: chargeAda.id, offenseName: chargeAda.offenseName, countNumber: "1", status: "pending", defendantId: ada.id },
      { id: chargeBen.id, offenseName: chargeBen.offenseName, countNumber: "2", status: "pending", defendantId: ben.id },
    ],
    procedureIssues: [{ id: procedure.id, issueType: "WARRANT", status: "open" }],
    elementGaps: overview.elementGaps.map((gap) => ({
      id: gap.elementId,
      elementText: gap.elementText,
      status: gap.status,
    })),
  });
  const freshness = assessAnalysisFreshness({
    priorEvidenceIds: [joint.id, adaOnly.id, benOnly.id],
    priorIssueEvidence: analysis.issues.map((issue) => ({
      issueId: issue.issueId,
      evidenceIds: [...issue.supportingEvidenceIds, ...issue.contraryEvidenceIds],
    })),
    currentEvidenceIds: [joint.id, adaOnly.id, benOnly.id, "ev-supplemental-bodycam"],
  });
  return {
    defendants: [ada, ben],
    charges: [chargeAda, chargeBen],
    witnessComparison,
    evidenceScope,
    issueSeparation,
    overview,
    analysis,
    longForm,
    bundle,
    freshness,
    guiltConclusion: null as null,
  };
}
