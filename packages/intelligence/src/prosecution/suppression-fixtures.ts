import {
  answerSuppressionQuestion,
  buildSuppressionReview,
  formatSuppressionAnswer,
  type SuppressionAuthorityCandidate,
  type SuppressionReview,
} from "./suppression-review";

const PROBABLE_CAUSE_SPAN =
  "Synthetic source span: probable cause is reviewed from the recorded affidavit circumstances.";
const GOOD_FAITH_SPAN =
  "Synthetic source span: good-faith review looks to the affidavit the officer is recorded to have relied on.";

function candidate(params: {
  id: string;
  citation: string;
  title: string;
  courtId: string;
  dimension: SuppressionAuthorityCandidate["dimensions"][number];
  warrantId: string;
  proposition: string;
  jurisdiction?: string;
}): SuppressionAuthorityCandidate {
  return {
    authorityId: params.id,
    citation: params.citation,
    title: params.title,
    courtId: params.courtId,
    jurisdiction: params.jurisdiction ?? "US",
    dimensions: [params.dimension],
    warrantIds: [params.warrantId],
    proposition: params.proposition,
    sourceSpan: params.proposition,
    sourceText: `Fixture excerpt only. ${params.proposition}`,
    treatmentVerification: "unknown",
    doctrine: "FEDERAL_CONSTITUTIONAL",
    relation: "RELEVANT",
  };
}

/** Several suppression theories on one warrant. Synthetic facts and a synthetic source span. */
export function runMultiTheoryWarrantReview(): {
  review: SuppressionReview;
  answerText: string;
} {
  const review = buildSuppressionReview({
    jurisdiction: "US",
    forumCourtId: "us-d-pa-ed",
    doctrine: "FEDERAL_CONSTITUTIONAL",
    warrants: [
      {
        id: "warrant-phone",
        warrantType: "search",
        issuingCourt: "us-d-pa-ed",
        issuingJudge: null,
        applicationDate: "2026-04-01",
        issueDate: "2026-04-02",
        executionDate: "2026-05-20",
        scope: "cellular phone of defendant Ada",
        probableCauseFacts: ["Officer report describes a witness observation."],
        sourceFactIds: [],
        seizedEvidenceIds: ["ev-phone"],
        returnNotes: null,
        relatedSuppressionIssueIds: ["issue-pc", "issue-faith"],
        openedDimensions: ["GOOD_FAITH"],
      },
    ],
    procedureIssues: [
      {
        id: "issue-pc",
        issueType: "PROBABLE_CAUSE",
        relatedEvidenceIds: ["ev-phone"],
        relatedAuthorityIds: [],
        missingFacts: ["Affidavit unavailable."],
        status: "open",
        warrantId: "warrant-phone",
      },
      {
        id: "issue-faith",
        issueType: "OTHER",
        reviewDimension: "GOOD_FAITH",
        relatedEvidenceIds: [],
        relatedAuthorityIds: [],
        missingFacts: ["Officer reliance on the warrant is recorded without the affidavit the officer saw."],
        status: "open",
        warrantId: "warrant-phone",
      },
    ],
    evidence: [
      {
        id: "ev-phone",
        evidenceType: "device",
        documentId: "doc-phone",
        storageReference: "SYN-PHONE",
        relatedDefendantIds: ["def-ada"],
        relatedWitnessIds: [],
        provenanceDocumentId: "doc-phone",
      },
    ],
    officers: [],
    timeline: [
      { id: "tl-issue", eventType: "WARRANT_ISSUED", title: "Phone warrant issued", eventDate: "2026-04-02" },
      { id: "tl-exec", eventType: "WARRANT_EXECUTED", title: "Phone warrant executed", eventDate: "2026-05-20" },
    ],
    authorityCandidates: [
      candidate({
        id: "auth-synth-pc",
        citation: "SYNTHETIC-SCOTUS-PC-001",
        title: "Synthetic totality example",
        courtId: "us-scotus",
        dimension: "PROBABLE_CAUSE",
        warrantId: "warrant-phone",
        proposition: PROBABLE_CAUSE_SPAN,
      }),
      candidate({
        id: "auth-synth-faith",
        citation: "SYNTHETIC-SCOTUS-GF-001",
        title: "Synthetic good-faith example",
        courtId: "us-scotus",
        dimension: "GOOD_FAITH",
        warrantId: "warrant-phone",
        proposition: GOOD_FAITH_SPAN,
      }),
    ],
  });
  const answer = answerSuppressionQuestion({
    review,
    question: "What probable cause, nexus, staleness, good faith, and execution issues should be reviewed?",
  });
  return { review, answerText: formatSuppressionAnswer(answer) };
}

/** Two warrants, joint evidence, and defendant-specific evidence. */
export function runMultiWarrantDefendantReview(): SuppressionReview {
  return buildSuppressionReview({
    jurisdiction: "US",
    forumCourtId: "us-d-pa-ed",
    doctrine: "FEDERAL_CONSTITUTIONAL",
    warrants: [
      {
        id: "warrant-ada",
        warrantType: "search",
        issuingCourt: "us-d-pa-ed",
        issuingJudge: null,
        applicationDate: "2026-03-01",
        issueDate: "2026-03-01",
        executionDate: "2026-03-02",
        scope: "Ada phone",
        probableCauseFacts: [],
        sourceFactIds: [],
        seizedEvidenceIds: ["ev-ada"],
        returnNotes: null,
        relatedSuppressionIssueIds: [],
      },
      {
        id: "warrant-joint",
        warrantType: "search",
        issuingCourt: "us-d-pa-ed",
        issuingJudge: null,
        applicationDate: "2026-03-10",
        issueDate: "2026-03-11",
        executionDate: "2026-03-12",
        scope: "shared residence",
        probableCauseFacts: ["Observation dated 2026-03-09 at the shared residence."],
        sourceFactIds: ["fact-1"],
        seizedEvidenceIds: ["ev-joint"],
        returnNotes: "Inventory listed a bag.",
        returnInventory: ["bag"],
        relatedSuppressionIssueIds: [],
        affidavitStatements: ["Observation dated 2026-03-09 at the shared residence."],
      },
    ],
    procedureIssues: [],
    evidence: [
      {
        id: "ev-ada",
        evidenceType: "device",
        documentId: "doc-ada",
        storageReference: "SYN-ADA",
        relatedDefendantIds: ["def-ada"],
        relatedWitnessIds: [],
      },
      {
        id: "ev-joint",
        evidenceType: "scene_photo",
        documentId: "doc-scene",
        storageReference: "SYN-JOINT",
        relatedDefendantIds: ["def-ada", "def-ben"],
        relatedWitnessIds: [],
      },
    ],
    timeline: [
      { id: "tl-ada-issue", eventType: "WARRANT_ISSUED", title: "Ada warrant", eventDate: "2026-03-01" },
      { id: "tl-ada-exec", eventType: "WARRANT_EXECUTED", title: "Ada execution", eventDate: "2026-03-02" },
      { id: "tl-joint-issue", eventType: "WARRANT_ISSUED", title: "Residence warrant", eventDate: "2026-03-11" },
      { id: "tl-joint-exec", eventType: "WARRANT_EXECUTED", title: "Residence execution", eventDate: "2026-03-12" },
    ],
  });
}

export function runMirandaReview(): SuppressionReview {
  return buildSuppressionReview({
    jurisdiction: "US",
    forumCourtId: "us-d-pa-ed",
    doctrine: "FEDERAL_CONSTITUTIONAL",
    warrants: [],
    procedureIssues: [
      {
        id: "issue-miranda",
        issueType: "MIRANDA",
        relatedEvidenceIds: ["ev-interview"],
        relatedAuthorityIds: [],
        missingFacts: ["Miranda timing is not recorded."],
        status: "open",
      },
    ],
    evidence: [
      {
        id: "ev-interview",
        evidenceType: "interview",
        documentId: "doc-interview",
        storageReference: "SYN-INTERVIEW",
        relatedDefendantIds: ["def-ada"],
        relatedWitnessIds: ["wit-ada"],
      },
    ],
    timeline: [{ id: "tl-interview", eventType: "INTERVIEW", title: "Station interview", eventDate: "2026-03-04" }],
  });
}

export function runSuppressionHierarchyReview(): SuppressionReview {
  const proposition = "Synthetic source span: this fixture checks court hierarchy only.";
  const base = {
    proposition,
    sourceSpan: proposition,
    sourceText: proposition,
    treatmentVerification: "unknown" as const,
    doctrine: "FEDERAL_CONSTITUTIONAL" as const,
    dimensions: ["PROBABLE_CAUSE" as const],
    warrantIds: ["warrant-hier"],
    relation: "RELEVANT" as const,
  };
  return buildSuppressionReview({
    jurisdiction: "US",
    forumCourtId: "us-d-pa-ed",
    doctrine: "FEDERAL_CONSTITUTIONAL",
    warrants: [
      {
        id: "warrant-hier",
        warrantType: "search",
        issuingCourt: "us-d-pa-ed",
        issuingJudge: null,
        applicationDate: "2026-01-01",
        issueDate: "2026-01-02",
        executionDate: "2026-01-03",
        scope: "recorded premises",
        probableCauseFacts: ["Observation dated 2026-01-01 at the recorded premises."],
        sourceFactIds: ["fact-hier"],
        seizedEvidenceIds: [],
        returnNotes: "Inventory recorded.",
        returnInventory: ["item"],
        relatedSuppressionIssueIds: [],
        affidavitStatements: ["Observation dated 2026-01-01 at the recorded premises."],
        openedDimensions: ["PROBABLE_CAUSE"],
      },
    ],
    procedureIssues: [],
    evidence: [],
    authorityCandidates: [
      { ...base, authorityId: "auth-scotus", citation: "SYNTHETIC-SCOTUS-H-001", title: "Synthetic SCOTUS", courtId: "us-scotus", jurisdiction: "US" },
      { ...base, authorityId: "auth-ca3", citation: "SYNTHETIC-CA3-H-001", title: "Synthetic Third Circuit", courtId: "us-ca-3", jurisdiction: "US" },
      { ...base, authorityId: "auth-edpa", citation: "SYNTHETIC-EDPA-H-001", title: "Synthetic EDPA", courtId: "us-d-pa-ed", jurisdiction: "US" },
      { ...base, authorityId: "auth-pa-high", citation: "SYNTHETIC-PA-H-001", title: "Synthetic PA Supreme", courtId: "st-pa-high", jurisdiction: "PA" },
      { ...base, authorityId: "auth-pa-app", citation: "SYNTHETIC-PA-A-001", title: "Synthetic PA Superior", courtId: "st-pa-app", jurisdiction: "PA" },
    ],
  });
}

export function runPennsylvaniaDoctrineReview(): SuppressionReview {
  const proposition = "Synthetic source span: this fixture checks Pennsylvania court hierarchy only.";
  return buildSuppressionReview({
    jurisdiction: "PA",
    forumCourtId: "st-pa-trial",
    doctrine: "STATE_CONSTITUTIONAL",
    warrants: [
      {
        id: "warrant-pa",
        warrantType: "search",
        issuingCourt: "st-pa-trial",
        issuingJudge: null,
        applicationDate: "2026-01-01",
        issueDate: "2026-01-02",
        executionDate: "2026-01-03",
        scope: "recorded premises",
        probableCauseFacts: ["Observation dated 2026-01-01 at the recorded premises."],
        sourceFactIds: ["fact-pa"],
        seizedEvidenceIds: [],
        returnNotes: "Inventory recorded.",
        returnInventory: ["item"],
        relatedSuppressionIssueIds: [],
        affidavitStatements: ["Observation dated 2026-01-01 at the recorded premises."],
        openedDimensions: ["PROBABLE_CAUSE"],
      },
    ],
    procedureIssues: [],
    evidence: [],
    authorityCandidates: [
      {
        authorityId: "auth-pa-high",
        citation: "SYNTHETIC-PA-H-001",
        title: "Synthetic PA Supreme",
        courtId: "st-pa-high",
        jurisdiction: "PA",
        dimensions: ["PROBABLE_CAUSE"],
        warrantIds: ["warrant-pa"],
        proposition,
        sourceSpan: proposition,
        sourceText: proposition,
        treatmentVerification: "unknown",
        doctrine: "STATE_CONSTITUTIONAL",
        relation: "RELEVANT",
      },
      {
        authorityId: "auth-pa-app",
        citation: "SYNTHETIC-PA-A-001",
        title: "Synthetic PA Superior",
        courtId: "st-pa-app",
        jurisdiction: "PA",
        dimensions: ["PROBABLE_CAUSE"],
        warrantIds: ["warrant-pa"],
        proposition,
        sourceSpan: proposition,
        sourceText: proposition,
        treatmentVerification: "unknown",
        doctrine: "STATE_CONSTITUTIONAL",
        relation: "RELEVANT",
      },
      {
        authorityId: "auth-scotus",
        citation: "SYNTHETIC-SCOTUS-H-001",
        title: "Synthetic SCOTUS",
        courtId: "us-scotus",
        jurisdiction: "US",
        dimensions: ["PROBABLE_CAUSE"],
        warrantIds: ["warrant-pa"],
        proposition,
        sourceSpan: proposition,
        sourceText: proposition,
        treatmentVerification: "unknown",
        doctrine: "STATE_CONSTITUTIONAL",
        relation: "RELEVANT",
      },
    ],
  });
}

export function runMissingAffidavitReview(): SuppressionReview {
  return buildSuppressionReview({
    jurisdiction: "US",
    forumCourtId: "us-d-pa-ed",
    doctrine: "FEDERAL_CONSTITUTIONAL",
    warrants: [
      {
        id: "warrant-thin",
        warrantType: "search",
        issuingCourt: "us-d-pa-ed",
        issuingJudge: null,
        applicationDate: null,
        issueDate: null,
        executionDate: null,
        scope: null,
        probableCauseFacts: [],
        sourceFactIds: [],
        seizedEvidenceIds: [],
        returnNotes: null,
        relatedSuppressionIssueIds: [],
      },
    ],
    procedureIssues: [],
    evidence: [],
  });
}
