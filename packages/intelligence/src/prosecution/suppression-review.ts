import { evaluateAuthorityStatus, getCourtById, type AuthorityStatusClassification, type LegalIssueType } from "@nyayagrid/jurisdiction";
import { assessAnalysisFreshness } from "../deepening/freshness";
import { compareWitnessStatements, type StatementClaim } from "./domain";

export const SUPPRESSION_DIMENSIONS = [
  "PROBABLE_CAUSE",
  "NEXUS",
  "STALENESS",
  "PARTICULARITY",
  "SCOPE",
  "EXECUTION",
  "GOOD_FAITH",
  "CONSENT",
  "PLAIN_VIEW",
  "EXIGENCY",
  "MIRANDA",
  "VOLUNTARINESS",
  "IDENTIFICATION",
  "RIGHT_TO_COUNSEL",
  "OTHER",
] as const;
export type SuppressionDimension = (typeof SUPPRESSION_DIMENSIONS)[number];

export const SUPPRESSION_DOCTRINES = [
  "FEDERAL_CONSTITUTIONAL",
  "STATE_CONSTITUTIONAL",
  "STATE_LAW",
  "UNKNOWN",
] as const;
export type SuppressionDoctrine = (typeof SUPPRESSION_DOCTRINES)[number];

export type SuppressionTreatment = "VERIFIED" | "UNVERIFIED";

export type SuppressionAuthorityLink = {
  authorityId: string;
  citation: string | null;
  title: string | null;
  courtId: string | null;
  dimension: SuppressionDimension;
  proposition: string | null;
  sourceSpan: string | null;
  sourceSupported: boolean;
  authorityStatus: AuthorityStatusClassification;
  reasonCode: string;
  treatment: SuppressionTreatment;
  currentness: string;
  sourceUrl: string | null;
  coverageWarning: string | null;
  relation: "RELEVANT" | "CONTRARY" | "DISTINGUISHABLE";
};

export type SuppressionEvidenceLink = {
  evidenceId: string;
  evidenceType: string;
  documentId: string | null;
  storageReference: string | null;
  relatedDefendantIds: string[];
  provenanceDocumentId: string | null;
};

export type SuppressionReviewIssue = {
  id: string;
  warrantId: string | null;
  dimension: SuppressionDimension;
  defendantIds: string[];
  defendantScope: "JOINT" | "DEFENDANT_SPECIFIC" | "UNASSIGNED";
  knownFacts: string[];
  disputedFacts: string[];
  missingFacts: string[];
  factsSupportingConcern: string[];
  factsReducingConcern: string[];
  legalStandard: string | null;
  applicationQuestions: string[];
  authorities: SuppressionAuthorityLink[];
  linkedEvidence: SuppressionEvidenceLink[];
  linkedProcedureIssueIds: string[];
  officerIds: string[];
  timelineEventIds: string[];
  uncertainty: string[];
  reviewStatus: "open" | "needs_review" | "human_reviewed";
  humanDecision: { text: string; actorId: string } | null;
  suppressionConclusion: null;
  validityConclusion: null;
  guiltConclusion: null;
};

export type SuppressionWarrantView = {
  id: string;
  warrantType: string;
  issuingCourt: string | null;
  issuingJudge: string | null;
  applicationDate: string | null;
  issueDate: string | null;
  executionDate: string | null;
  scope: string | null;
  affidavitStatements: string[];
  affidavitSourceFactIds: string[];
  executionNotes: string[];
  returnInventory: string[];
  returnNotes: string | null;
  evidence: SuppressionEvidenceLink[];
  officerIds: string[];
  officerNames: string[];
  timelineEventIds: string[];
  timelineEvents: Array<{ id: string; eventType: string; title: string; eventDate: string | null }>;
  issueIds: string[];
  missingFacts: string[];
  unassignedMissingFacts: string[];
  unscopedAuthorityIds: string[];
  reviewStatus: "open" | "needs_review" | "human_reviewed";
};

export type SuppressionConflict =
  | "NO_VERIFIED_CONFLICT_PAIR"
  | {
      kind: "SOURCE_SUPPORTED_DISTINGUISHABLE";
      dimension: SuppressionDimension;
      warrantId: string | null;
      authorityIds: [string, string];
    };

export type SuppressionReview = {
  doctrine: SuppressionDoctrine;
  doctrineWarning: string | null;
  warrants: SuppressionWarrantView[];
  issues: SuppressionReviewIssue[];
  conflictPair: SuppressionConflict;
  coverageWarnings: string[];
  suppressionConclusion: null;
  validityConclusion: null;
  guiltConclusion: null;
};

export type SuppressionAnswerIssue = {
  issueId: string;
  warrantId: string | null;
  dimension: SuppressionDimension;
  knownFacts: string[];
  disputedFacts: string[];
  missingFacts: string[];
  legalStandard: string | null;
  bindingAuthorities: SuppressionAuthorityLink[];
  persuasiveAuthorities: SuppressionAuthorityLink[];
  otherAuthorities: SuppressionAuthorityLink[];
  applicationQuestions: string[];
  uncertainty: string[];
};

export type SuppressionAnswer = {
  question: string;
  issues: SuppressionAnswerIssue[];
  limitations: string[];
  conflictPair: SuppressionConflict;
  suppressionConclusion: null;
  validityConclusion: null;
  guiltConclusion: null;
};

const APPLICATION_QUESTIONS: Record<SuppressionDimension, string> = {
  PROBABLE_CAUSE: "What facts are recorded in the affidavit, and which probable-cause facts are missing?",
  NEXUS: "What recorded facts connect the place, device, or person to the offense?",
  STALENESS: "What is the recorded date of the underlying observations, and how does it relate to the warrant date?",
  PARTICULARITY: "Does the recorded scope identify the place, person, or items to be searched?",
  SCOPE: "What does the recorded scope authorize, and what was recorded as seized?",
  EXECUTION: "What execution, return, and inventory facts are recorded?",
  GOOD_FAITH: "What recorded facts describe the officer's basis for relying on the warrant?",
  CONSENT: "Who is recorded as consenting, and where is the consent source?",
  PLAIN_VIEW: "What recorded facts describe where the item was observed and the basis for the seizure?",
  EXIGENCY: "What recorded facts are offered on urgency, and which exigency facts are missing?",
  MIRANDA: "What is the recorded timing of warnings, custody, and questioning?",
  VOLUNTARINESS: "What recorded facts bear on the conditions of the statement?",
  IDENTIFICATION: "What recorded facts describe the identification procedure?",
  RIGHT_TO_COUNSEL: "What recorded facts describe the request for or presence of counsel?",
  OTHER: "What additional recorded facts are needed before this procedure issue can be reviewed?",
};

const DECISION_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "warrant validity", pattern: /\bthe warrant (was|is) (valid|invalid)\b/i },
  { label: "unconstitutional search", pattern: /\bthe search was unconstitutional\b/i },
  { label: "suppression decision", pattern: /\b(the )?evidence should be suppressed\b/i },
  { label: "probable cause conclusion", pattern: /\bprobable cause existed\b/i },
  { label: "guilt", pattern: /\b(guilty|not guilty)\b/i },
];

const TOKEN_STOP = new Set([
  "synthetic",
  "search",
  "warrant",
  "affidavit",
  "that",
  "this",
  "with",
  "from",
  "have",
  "been",
  "were",
  "into",
  "onto",
  "under",
  "about",
]);

const TYPE_TO_DIMENSION: Record<string, SuppressionDimension | "GENERIC"> = {
  PROBABLE_CAUSE: "PROBABLE_CAUSE",
  CONSENT: "CONSENT",
  PLAIN_VIEW: "PLAIN_VIEW",
  EXIGENT_CIRCUMSTANCES: "EXIGENCY",
  MIRANDA: "MIRANDA",
  CUSTODY: "MIRANDA",
  INTERROGATION: "MIRANDA",
  VOLUNTARINESS: "VOLUNTARINESS",
  WAIVER: "VOLUNTARINESS",
  IDENTIFICATION: "IDENTIFICATION",
  RIGHT_TO_COUNSEL: "RIGHT_TO_COUNSEL",
  SEARCH: "SCOPE",
  SEIZURE: "SCOPE",
  SEARCH_INCIDENT_TO_ARREST: "SCOPE",
  TRAFFIC_STOP: "OTHER",
  OTHER: "OTHER",
  UNKNOWN: "OTHER",
  WARRANT: "GENERIC",
};

export type SuppressionWarrantInput = {
  id: string;
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
  affidavitStatements?: string[];
  executionNotes?: string[];
  returnInventory?: string[];
  openedDimensions?: SuppressionDimension[];
};

export type SuppressionProcedureInput = {
  id: string;
  issueType: string;
  relatedEvidenceIds: string[];
  relatedAuthorityIds: string[];
  missingFacts: string[];
  status: string;
  warrantId?: string | null;
  reviewDimension?: SuppressionDimension | null;
};

export type SuppressionEvidenceInput = {
  id: string;
  evidenceType: string;
  documentId: string | null;
  storageReference: string | null;
  relatedDefendantIds: string[];
  relatedWitnessIds: string[];
  provenanceDocumentId?: string | null;
};

export type SuppressionAuthorityCandidate = {
  authorityId: string;
  citation?: string | null;
  title?: string | null;
  courtId?: string | null;
  jurisdiction?: string | null;
  authorityType?: string | null;
  decisionDate?: string | null;
  currentnessStatus?: string | null;
  canonicalSourceUrl?: string | null;
  dimensions: SuppressionDimension[];
  warrantIds: string[];
  proposition?: string | null;
  sourceSpan?: string | null;
  sourceText?: string | null;
  treatmentVerification?: "verified" | "unknown";
  doctrine?: SuppressionDoctrine;
  relation?: "RELEVANT" | "CONTRARY" | "DISTINGUISHABLE";
};

export type SuppressionReviewInput = {
  jurisdiction?: string | null;
  forumCourtId?: string | null;
  doctrine?: SuppressionDoctrine | null;
  warrants: SuppressionWarrantInput[];
  procedureIssues: SuppressionProcedureInput[];
  evidence: SuppressionEvidenceInput[];
  officers?: Array<{ id: string; name: string; warrantIds: string[]; reportIds?: string[] }>;
  witnesses?: Array<{ id: string; displayName: string }>;
  statements?: Array<{ witnessId: string; claims: StatementClaim[] }>;
  timeline?: Array<{ id: string; eventType: string; title: string; eventDate: string | null }>;
  authorityCandidates?: SuppressionAuthorityCandidate[];
  humanDecisions?: Array<{ warrantId: string | null; dimension: SuppressionDimension; text: string; actorId: string }>;
  humanReviewedIssueIds?: string[];
  priorEvidenceIds?: string[];
  currentEvidenceIds?: string[];
};

export function inferSuppressionDoctrine(params: {
  jurisdiction?: string | null;
  forumCourtId?: string | null;
  explicit?: SuppressionDoctrine | null;
}): { doctrine: SuppressionDoctrine; warning: string | null } {
  if (params.explicit && params.explicit !== "UNKNOWN") {
    return { doctrine: params.explicit, warning: null };
  }
  const forum = getCourtById(params.forumCourtId);
  if (!forum) {
    return {
      doctrine: "UNKNOWN",
      warning: "Forum court is missing or not in the court registry. Authority weight is not classified.",
    };
  }
  const federal =
    forum.level === "scotus" || forum.level === "circuit" || forum.level === "district";
  if (federal) {
    return {
      doctrine: "FEDERAL_CONSTITUTIONAL",
      warning:
        "This review uses the federal constitutional issue. Pennsylvania constitutional doctrine is a separate issue and is not applied here.",
    };
  }
  return {
    doctrine: "UNKNOWN",
    warning:
      "Federal Fourth Amendment review and Pennsylvania constitutional review are separate. The doctrine was not specified, so authority weight is not classified.",
  };
}

export function screenHoldingProposition(params: {
  proposition?: string | null;
  sourceSpan?: string | null;
  sourceText?: string | null;
}): { sourceSupported: boolean; proposition: string | null; sourceSpan: string | null; reason: string } {
  const proposition = params.proposition?.trim() || null;
  const sourceSpan = params.sourceSpan?.trim() || null;
  const sourceText = params.sourceText?.trim() || null;
  if (!proposition || !sourceSpan || !sourceText) {
    return { sourceSupported: false, proposition: null, sourceSpan: null, reason: "SOURCE_TEXT_ABSENT" };
  }
  const haystack = normalizeSpace(sourceText);
  if (!haystack.includes(normalizeSpace(sourceSpan)) || !haystack.includes(normalizeSpace(proposition))) {
    return { sourceSupported: false, proposition: null, sourceSpan: null, reason: "PROPOSITION_NOT_IN_SOURCE" };
  }
  return { sourceSupported: true, proposition, sourceSpan, reason: "SOURCE_SUPPORTED" };
}

export function federalSupplementCoverage(citation: string | null | undefined): string | null {
  if (!citation) return null;
  if (/F\.\s*Supp\.\s*2d/i.test(citation)) {
    return "This F.Supp.2d citation is shown as recorded. Shared citation normalization for that reporter form can fail, so the string is not treated as a resolved match.";
  }
  return null;
}

export function findAutonomousSuppressionViolations(text: string): string[] {
  const stripped = text
    .replace(/HUMAN_ENTERED_DECISION:\s*[^\n]*/g, "")
    .replace(/CITED_HOLDING\[[^\]]+\]:[^\n]*/g, "")
    .replace(/^KNOWN_FACTS:.*$/gm, "")
    .replace(/^DISPUTED_FACTS:.*$/gm, "")
    .replace(/^MISSING_FACTS:.*$/gm, "");
  return DECISION_PATTERNS.filter((item) => item.pattern.test(stripped)).map((item) => item.label);
}

export function buildSuppressionReview(input: SuppressionReviewInput): SuppressionReview {
  const doctrine = inferSuppressionDoctrine({
    jurisdiction: input.jurisdiction,
    forumCourtId: input.forumCourtId,
    explicit: input.doctrine,
  });
  const evidenceById = new Map(input.evidence.map((item) => [item.id, item]));
  const issues: SuppressionReviewIssue[] = [];
  const warrantViews: SuppressionWarrantView[] = [];
  const coverageWarnings = new Set<string>();
  if (doctrine.warning) coverageWarnings.add(doctrine.warning);

  const timeline = input.timeline ?? [];
  const officers = input.officers ?? [];
  const warrantCount = input.warrants.length;

  for (const warrant of input.warrants) {
    const affidavits = warrant.affidavitStatements ?? [];
    const executionNotes = warrant.executionNotes ?? [];
    const inventory = warrant.returnInventory ?? [];
    const linkedIssues = input.procedureIssues.filter(
      (issue) =>
        warrant.relatedSuppressionIssueIds.includes(issue.id) || issue.warrantId === warrant.id,
    );
    const opened = new Set<SuppressionDimension>(warrant.openedDimensions ?? []);
    const missingByDimension = new Map<SuppressionDimension, string[]>();
    const procedureByDimension = new Map<SuppressionDimension, string[]>();
    const unassignedMissing: string[] = [];
    const unscopedAuthorityIds = new Set<string>();

    for (const issue of linkedIssues) {
      const mapped = issue.reviewDimension ?? TYPE_TO_DIMENSION[issue.issueType] ?? "OTHER";
      if (mapped === "GENERIC") {
        for (const fact of issue.missingFacts) {
          const routed = routeMissingFact(fact);
          if (routed) pushMap(missingByDimension, routed, fact);
          else unassignedMissing.push(fact);
        }
        for (const authorityId of issue.relatedAuthorityIds) unscopedAuthorityIds.add(authorityId);
        continue;
      }
      opened.add(mapped);
      pushMap(procedureByDimension, mapped, issue.id);
      for (const fact of issue.missingFacts) {
        const routed = routeMissingFact(fact);
        pushMap(missingByDimension, routed ?? mapped, fact);
      }
    }

    for (const dimension of gapDimensions(warrant, affidavits, inventory)) opened.add(dimension);
    if (timeline.some((event) => event.eventType === "INTERVIEW") && linkedIssues.some((issue) => TYPE_TO_DIMENSION[issue.issueType] === "MIRANDA")) {
      opened.add("MIRANDA");
    }

    const evidence = unique(warrant.seizedEvidenceIds)
      .map((id) => evidenceById.get(id))
      .filter((item): item is SuppressionEvidenceInput => Boolean(item))
      .map(toEvidenceLink);
    for (const issue of linkedIssues) {
      for (const evidenceId of issue.relatedEvidenceIds) {
        const row = evidenceById.get(evidenceId);
        if (row && !evidence.some((item) => item.evidenceId === row.id)) evidence.push(toEvidenceLink(row));
      }
    }

    const warrantOfficers = officers.filter((officer) => officer.warrantIds.includes(warrant.id));
    const timelineLinks = linkTimelineToWarrant(warrant, timeline, warrantCount);
    const disputed = disputedFactsForEvidence(evidence, input);
    const defendantIds = unique(evidence.flatMap((item) => item.relatedDefendantIds));

    const issueIds: string[] = [];
    for (const dimension of SUPPRESSION_DIMENSIONS) {
      if (!opened.has(dimension)) continue;
      const id = `${warrant.id}:${dimension}`;
      issueIds.push(id);
      const knownFacts = knownFactsFor(dimension, warrant, affidavits, executionNotes, inventory, timelineLinks.events);
      const missingFacts = unique([
        ...(missingByDimension.get(dimension) ?? []),
        ...derivedMissingFacts(dimension, warrant, affidavits, inventory, warrantOfficers.length),
      ]);
      const authorities = attachAuthorities({
        input,
        doctrine: doctrine.doctrine,
        dimension,
        warrantId: warrant.id,
        forumCourtId: input.forumCourtId ?? null,
        jurisdiction: input.jurisdiction ?? null,
      });
      for (const authority of authorities) {
        if (authority.coverageWarning) coverageWarnings.add(authority.coverageWarning);
      }
      const legalStandard =
        authorities.find((authority) => authority.relation === "RELEVANT" && authority.proposition)?.proposition ?? null;
      const human = input.humanDecisions?.find((decision) => decision.warrantId === warrant.id && decision.dimension === dimension) ?? null;
      const uncertainty = [
        ...(!legalStandard ? ["Legal standard text was not extracted from a source span."] : []),
        ...(authorities.some((authority) => authority.treatment === "UNVERIFIED")
          ? ["Treatment is unverified. This is not a citator confirmation that the authority is good law."]
          : []),
        ...(authorities.length === 0 ? ["No source-supported authority is attached to this issue."] : []),
        "No verified conflict pair is recorded.",
      ];
      issues.push({
        id,
        warrantId: warrant.id,
        dimension,
        defendantIds,
        defendantScope: defendantScope(defendantIds),
        knownFacts,
        disputedFacts: dimension === "EXECUTION" || dimension === "PROBABLE_CAUSE" ? disputed : [],
        missingFacts,
        factsSupportingConcern: concernFacts(dimension, warrant, missingFacts),
        factsReducingConcern: reducingFacts(dimension, warrant, affidavits, inventory),
        legalStandard,
        applicationQuestions: [APPLICATION_QUESTIONS[dimension]],
        authorities,
        linkedEvidence: evidence,
        linkedProcedureIssueIds: procedureByDimension.get(dimension) ?? [],
        officerIds: warrantOfficers.map((officer) => officer.id),
        timelineEventIds: timelineLinks.ids,
        uncertainty,
        reviewStatus: reviewStatusFor({
          id,
          missingFacts,
          humanReviewedIssueIds: input.humanReviewedIssueIds,
          evidenceIds: evidence.map((item) => item.evidenceId),
          priorEvidenceIds: input.priorEvidenceIds,
          currentEvidenceIds: input.currentEvidenceIds,
        }),
        humanDecision: human ? { text: human.text, actorId: human.actorId } : null,
        suppressionConclusion: null,
        validityConclusion: null,
        guiltConclusion: null,
      });
    }

    const warrantIssues = issues.filter((issue) => issue.warrantId === warrant.id);
    warrantViews.push({
      id: warrant.id,
      warrantType: warrant.warrantType,
      issuingCourt: warrant.issuingCourt,
      issuingJudge: warrant.issuingJudge,
      applicationDate: warrant.applicationDate,
      issueDate: warrant.issueDate,
      executionDate: warrant.executionDate,
      scope: warrant.scope,
      affidavitStatements: affidavits,
      affidavitSourceFactIds: warrant.sourceFactIds,
      executionNotes,
      returnInventory: inventory,
      returnNotes: warrant.returnNotes,
      evidence,
      officerIds: warrantOfficers.map((officer) => officer.id),
      officerNames: warrantOfficers.map((officer) => officer.name),
      timelineEventIds: timelineLinks.ids,
      timelineEvents: timelineLinks.events.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        title: event.title,
        eventDate: event.eventDate,
      })),
      issueIds,
      missingFacts: unique(warrantIssues.flatMap((issue) => issue.missingFacts)),
      unassignedMissingFacts: unassignedMissing,
      unscopedAuthorityIds: [...unscopedAuthorityIds],
      reviewStatus: warrantIssues.some((issue) => issue.reviewStatus === "needs_review")
        ? "needs_review"
        : "open",
    });
  }

  for (const issue of input.procedureIssues) {
    const mapped = issue.reviewDimension ?? TYPE_TO_DIMENSION[issue.issueType] ?? "OTHER";
    if (mapped === "GENERIC") continue;
    const already = issues.some(
      (row) => row.dimension === mapped && (row.warrantId === (issue.warrantId ?? null) || input.warrants.some((warrant) => warrant.relatedSuppressionIssueIds.includes(issue.id))),
    );
    if (already) continue;
    if (issue.warrantId && input.warrants.some((warrant) => warrant.id === issue.warrantId)) continue;
    const evidence = issue.relatedEvidenceIds
      .map((id) => evidenceById.get(id))
      .filter((item): item is SuppressionEvidenceInput => Boolean(item))
      .map(toEvidenceLink);
    const defendantIds = unique(evidence.flatMap((item) => item.relatedDefendantIds));
    const interviewIds = timeline.filter((event) => event.eventType === "INTERVIEW").map((event) => event.id);
    issues.push({
      id: `case:${issue.id}:${mapped}`,
      warrantId: null,
      dimension: mapped,
      defendantIds,
      defendantScope: defendantScope(defendantIds),
      knownFacts: interviewIds.length > 0 ? ["An interview event is on the case timeline."] : [],
      disputedFacts: [],
      missingFacts: unique(issue.missingFacts.length > 0 ? issue.missingFacts : derivedCaseMissing(mapped)),
      factsSupportingConcern: issue.missingFacts.map((fact) => `Missing factual support: ${fact}`),
      factsReducingConcern: [],
      legalStandard: null,
      applicationQuestions: [APPLICATION_QUESTIONS[mapped]],
      authorities: [],
      linkedEvidence: evidence,
      linkedProcedureIssueIds: [issue.id],
      officerIds: [],
      timelineEventIds: mapped === "MIRANDA" ? interviewIds : [],
      uncertainty: ["Legal standard text was not extracted from a source span.", "No verified conflict pair is recorded."],
      reviewStatus: "open",
      humanDecision: null,
      suppressionConclusion: null,
      validityConclusion: null,
      guiltConclusion: null,
    });
  }

  return {
    doctrine: doctrine.doctrine,
    doctrineWarning: doctrine.warning,
    warrants: warrantViews,
    issues,
    conflictPair: verifiedConflict(issues),
    coverageWarnings: [...coverageWarnings],
    suppressionConclusion: null,
    validityConclusion: null,
    guiltConclusion: null,
  };
}

export function answerSuppressionQuestion(params: {
  review: SuppressionReview;
  question: string;
  defendantId?: string | null;
}): SuppressionAnswer {
  const review = params.defendantId ? suppressionReviewForDefendant(params.review, params.defendantId) : params.review;
  const wanted = dimensionsInQuestion(params.question);
  const selected = review.issues.filter((issue) => {
    if (wanted.size > 0 && !wanted.has(issue.dimension)) return false;
    if (!params.defendantId) return true;
    if (issue.defendantScope === "UNASSIGNED" || issue.defendantScope === "JOINT") return true;
    return issue.defendantIds.includes(params.defendantId);
  });
  const limitations = [
    ...review.coverageWarnings,
    "Nyaya does not decide suppression, warrant validity, or guilt.",
    "Treatment remains unverified unless a source marks it verified.",
  ];
  return {
    question: params.question,
    issues: selected.map((issue) => ({
      issueId: issue.id,
      warrantId: issue.warrantId,
      dimension: issue.dimension,
      knownFacts: params.defendantId ? factsForDefendant(issue.knownFacts, issue, params.defendantId) : issue.knownFacts,
      disputedFacts: issue.disputedFacts,
      missingFacts: issue.missingFacts,
      legalStandard: issue.legalStandard,
      bindingAuthorities: issue.authorities.filter((authority) => authority.authorityStatus === "BINDING" && authority.sourceSupported),
      persuasiveAuthorities: issue.authorities.filter((authority) => authority.authorityStatus === "PERSUASIVE" && authority.sourceSupported),
      otherAuthorities: issue.authorities.filter((authority) => !authority.sourceSupported || (authority.authorityStatus !== "BINDING" && authority.authorityStatus !== "PERSUASIVE")),
      applicationQuestions: issue.applicationQuestions,
      uncertainty: issue.uncertainty,
    })),
    limitations,
    conflictPair: review.conflictPair,
    suppressionConclusion: null,
    validityConclusion: null,
    guiltConclusion: null,
  };
}

export function suppressionReviewForDefendant(review: SuppressionReview, defendantId: string): SuppressionReview {
  const keepEvidence = (link: SuppressionEvidenceLink) =>
    link.relatedDefendantIds.length !== 1 || link.relatedDefendantIds[0] === defendantId;
  return {
    ...review,
    warrants: review.warrants.map((warrant) => ({
      ...warrant,
      evidence: warrant.evidence.filter(keepEvidence),
    })),
    issues: review.issues
      .filter((issue) => issue.defendantScope !== "DEFENDANT_SPECIFIC" || issue.defendantIds.includes(defendantId))
      .map((issue) => ({
        ...issue,
        linkedEvidence: issue.linkedEvidence.filter(keepEvidence),
      })),
  };
}

export function formatSuppressionAnswer(answer: SuppressionAnswer): string {
  const lines = [
    "SUPPRESSION_REVIEW (non-deciding; do not convert missing facts into a legal conclusion):",
    `QUESTION: ${answer.question}`,
  ];
  for (const issue of answer.issues) {
    lines.push(
      `ISSUE: ${issue.dimension} warrant=${issue.warrantId ?? "none"}`,
      `KNOWN_FACTS: ${issue.knownFacts.join(" | ") || "(none recorded)"}`,
      `DISPUTED_FACTS: ${issue.disputedFacts.join(" | ") || "(none recorded)"}`,
      `MISSING_FACTS: ${issue.missingFacts.join(" | ") || "(none recorded)"}`,
      `LEGAL_STANDARD: ${issue.legalStandard ?? "Not extracted from a source span."}`,
      `BINDING_AUTHORITY: ${labelAuthorities(issue.bindingAuthorities)}`,
      `PERSUASIVE_AUTHORITY: ${labelAuthorities(issue.persuasiveAuthorities)}`,
      `APPLICATION_QUESTIONS: ${issue.applicationQuestions.join(" | ")}`,
      `UNCERTAINTY: ${issue.uncertainty.join(" | ")}`,
    );
  }
  lines.push(
    `LIMITATIONS: ${answer.limitations.join(" | ")}`,
    `CONFLICT_PAIR: ${answer.conflictPair === "NO_VERIFIED_CONFLICT_PAIR" ? "NO_VERIFIED_CONFLICT_PAIR" : answer.conflictPair.authorityIds.join(",")}`,
    "SUPPRESSION_CONCLUSION: null",
    "WARRANT_VALIDITY_CONCLUSION: null",
    "GUILT_CONCLUSION: null",
  );
  const text = lines.join("\n");
  const violations = findAutonomousSuppressionViolations(text);
  if (violations.length > 0) {
    throw new Error(`Suppression answer used a forbidden conclusion: ${violations.join(", ")}.`);
  }
  return text;
}

export function checkSuppressionConsistency(params: {
  review: SuppressionReview;
  answer: SuppressionAnswer;
  evidenceIds: string[];
  warrantIds: string[];
  defendantEvidence?: Array<{ evidenceId: string; relatedDefendantIds: string[] }>;
}): { consistent: boolean; conflicts: string[] } {
  const conflicts: string[] = [];
  if (params.review.suppressionConclusion !== null || params.answer.suppressionConclusion !== null) {
    conflicts.push("A suppression conclusion is present.");
  }
  if (params.review.validityConclusion !== null || params.answer.validityConclusion !== null) {
    conflicts.push("A warrant-validity conclusion is present.");
  }
  if (params.review.guiltConclusion !== null || params.answer.guiltConclusion !== null) {
    conflicts.push("A guilt conclusion is present.");
  }
  if (params.review.conflictPair !== "NO_VERIFIED_CONFLICT_PAIR" && params.review.conflictPair.kind !== "SOURCE_SUPPORTED_DISTINGUISHABLE") {
    conflicts.push("A conflict pair was recorded without a verified source.");
  }
  const evidence = new Set(params.evidenceIds);
  const warrants = new Set(params.warrantIds);
  const reviewIssueIds = new Set(params.review.issues.map((issue) => issue.id));
  for (const issue of params.review.issues) {
    if (issue.warrantId && !warrants.has(issue.warrantId)) conflicts.push(`Issue ${issue.id} names an unknown warrant.`);
    for (const link of issue.linkedEvidence) {
      if (!evidence.has(link.evidenceId)) conflicts.push(`Issue ${issue.id} names evidence ${link.evidenceId} outside the case.`);
    }
    const text = JSON.stringify(issue);
    if (findAutonomousSuppressionViolations(text).length > 0) conflicts.push(`Issue ${issue.id} contains a forbidden conclusion.`);
  }
  for (const issue of params.answer.issues) {
    if (!reviewIssueIds.has(issue.issueId)) conflicts.push(`Answer issue ${issue.issueId} is not on the review.`);
    if (issue.warrantId && !warrants.has(issue.warrantId)) conflicts.push(`Answer names an unknown warrant ${issue.warrantId}.`);
  }
  for (const warrant of params.review.warrants) {
    const dimensions = params.review.issues.filter((issue) => issue.warrantId === warrant.id).map((issue) => issue.dimension);
    if (new Set(dimensions).size !== dimensions.length) conflicts.push(`Warrant ${warrant.id} repeats a dimension.`);
  }
  if (params.defendantEvidence) {
    for (const issue of params.review.issues) {
      if (issue.defendantScope !== "DEFENDANT_SPECIFIC" || issue.defendantIds.length !== 1) continue;
      const owner = issue.defendantIds[0];
      for (const link of issue.linkedEvidence) {
        const row = params.defendantEvidence.find((item) => item.evidenceId === link.evidenceId);
        if (row && row.relatedDefendantIds.length === 1 && row.relatedDefendantIds[0] !== owner) {
          conflicts.push(`Issue ${issue.id} includes another defendant's evidence.`);
        }
      }
    }
  }
  return { consistent: conflicts.length === 0, conflicts };
}

function attachAuthorities(params: {
  input: SuppressionReviewInput;
  doctrine: SuppressionDoctrine;
  dimension: SuppressionDimension;
  warrantId: string;
  forumCourtId: string | null;
  jurisdiction: string | null;
}): SuppressionAuthorityLink[] {
  const candidates = (params.input.authorityCandidates ?? []).filter(
    (candidate) => candidate.dimensions.includes(params.dimension) && candidate.warrantIds.includes(params.warrantId),
  );
  const links: SuppressionAuthorityLink[] = [];
  for (const candidate of candidates) {
    const screened = screenHoldingProposition(candidate);
    if (!screened.sourceSupported) continue;
    if (candidate.doctrine && candidate.doctrine !== "UNKNOWN" && candidate.doctrine !== params.doctrine) continue;
    const citationWarning = federalSupplementCoverage(candidate.citation);
    let authorityStatus: AuthorityStatusClassification = "UNKNOWN";
    let reasonCode = "INSUFFICIENT_CONTEXT";
    if (params.doctrine !== "UNKNOWN" && candidate.courtId) {
      const status = evaluateAuthorityStatus({
        questionJurisdiction: params.doctrine === "FEDERAL_CONSTITUTIONAL" ? "US" : params.jurisdiction,
        forumCourtId: params.forumCourtId,
        issueType: params.doctrine as LegalIssueType,
        subjectMatter: "criminal",
        authorityCourtId: candidate.courtId,
        authorityType: candidate.authorityType ?? "case",
        authorityJurisdiction: candidate.jurisdiction ?? null,
        authorityDate: candidate.decisionDate ?? null,
        currentness: candidate.currentnessStatus === "current" ? "current" : "unknown",
      });
      authorityStatus = status.classification;
      reasonCode = status.reasonCode;
    }
    links.push({
      authorityId: candidate.authorityId,
      citation: candidate.citation ?? null,
      title: candidate.title ?? null,
      courtId: candidate.courtId ?? null,
      dimension: params.dimension,
      proposition: screened.proposition,
      sourceSpan: screened.sourceSpan,
      sourceSupported: true,
      authorityStatus,
      reasonCode,
      treatment: candidate.treatmentVerification === "verified" ? "VERIFIED" : "UNVERIFIED",
      currentness: candidate.currentnessStatus ?? "unknown",
      sourceUrl: candidate.canonicalSourceUrl ?? null,
      coverageWarning: citationWarning,
      relation: candidate.relation ?? "RELEVANT",
    });
  }
  return links;
}

function verifiedConflict(issues: SuppressionReviewIssue[]): SuppressionConflict {
  for (const issue of issues) {
    const distinguishable = issue.authorities.filter(
      (authority) => authority.relation === "DISTINGUISHABLE" && authority.sourceSupported,
    );
    if (distinguishable.length >= 2) {
      return {
        kind: "SOURCE_SUPPORTED_DISTINGUISHABLE",
        dimension: issue.dimension,
        warrantId: issue.warrantId,
        authorityIds: [distinguishable[0]!.authorityId, distinguishable[1]!.authorityId],
      };
    }
  }
  return "NO_VERIFIED_CONFLICT_PAIR";
}

function gapDimensions(warrant: SuppressionWarrantInput, affidavits: string[], inventory: string[]): SuppressionDimension[] {
  const open: SuppressionDimension[] = [];
  const hasStatement = affidavits.length > 0 || warrant.probableCauseFacts.length > 0;
  if (!hasStatement || (warrant.probableCauseFacts.length > 0 && warrant.sourceFactIds.length === 0 && affidavits.length === 0)) {
    open.push("PROBABLE_CAUSE");
  }
  if (!warrant.scope?.trim() || (hasStatement && !factsMentionScope(warrant, affidavits))) open.push("NEXUS");
  if (!observationDateRecorded(warrant, affidavits)) open.push("STALENESS");
  open.push("PARTICULARITY");
  if (warrant.scope?.trim() || warrant.seizedEvidenceIds.length > 0) open.push("SCOPE");
  if (!warrant.executionDate || (inventory.length === 0 && !warrant.returnNotes?.trim())) open.push("EXECUTION");
  if (warrant.executionDate && warrant.issueDate && datePrefix(warrant.executionDate) < datePrefix(warrant.issueDate)) {
    open.push("EXECUTION", "STALENESS");
  }
  return open;
}

function knownFactsFor(
  dimension: SuppressionDimension,
  warrant: SuppressionWarrantInput,
  affidavits: string[],
  executionNotes: string[],
  inventory: string[],
  timeline: Array<{ title: string; eventDate: string | null; eventType: string }>,
): string[] {
  const facts: string[] = [];
  if (dimension === "PROBABLE_CAUSE") {
    facts.push(...warrant.probableCauseFacts, ...affidavits);
  }
  if (dimension === "NEXUS" || dimension === "PARTICULARITY" || dimension === "SCOPE") {
    if (warrant.scope?.trim()) facts.push(`Recorded scope: ${warrant.scope.trim()}`);
  }
  if (dimension === "STALENESS") {
    if (warrant.issueDate) facts.push(`Recorded issue date: ${warrant.issueDate}`);
    if (warrant.applicationDate) facts.push(`Recorded application date: ${warrant.applicationDate}`);
  }
  if (dimension === "EXECUTION" || dimension === "SCOPE") {
    if (warrant.executionDate) facts.push(`Recorded execution date: ${warrant.executionDate}`);
    facts.push(...executionNotes);
    if (inventory.length > 0) facts.push(`Recorded inventory: ${inventory.join("; ")}`);
    if (warrant.returnNotes?.trim()) facts.push(`Recorded return notes: ${warrant.returnNotes.trim()}`);
  }
  for (const event of timeline) {
    if (dimension === "STALENESS" && event.eventType === "WARRANT_ISSUED") {
      facts.push(`Timeline records warrant issuance${event.eventDate ? ` on ${event.eventDate}` : ""}.`);
    }
    if (dimension === "EXECUTION" && event.eventType === "WARRANT_EXECUTED") {
      facts.push(`Timeline records warrant execution${event.eventDate ? ` on ${event.eventDate}` : ""}.`);
    }
  }
  return unique(facts.filter((fact) => fact.trim().length > 0));
}

function derivedMissingFacts(
  dimension: SuppressionDimension,
  warrant: SuppressionWarrantInput,
  affidavits: string[],
  inventory: string[],
  officerCount: number,
): string[] {
  const missing: string[] = [];
  if (dimension === "PROBABLE_CAUSE" && affidavits.length === 0 && warrant.probableCauseFacts.length === 0) {
    missing.push("Affidavit unavailable.");
  }
  if (dimension === "PROBABLE_CAUSE" && warrant.probableCauseFacts.length > 0 && warrant.sourceFactIds.length === 0 && affidavits.length === 0) {
    missing.push("Probable-cause assertions are recorded without a linked source fact.");
  }
  if (dimension === "PROBABLE_CAUSE" && officerCount === 0) missing.push("Officer basis is not recorded.");
  if (dimension === "NEXUS" && (!warrant.scope?.trim() || !factsMentionScope(warrant, affidavits))) {
    missing.push("Connection between the place, device, or person and the offense is not recorded.");
  }
  if (dimension === "STALENESS" && !observationDateRecorded(warrant, affidavits)) {
    missing.push("Date of underlying observations is not recorded.");
  }
  if (dimension === "PARTICULARITY" && !warrant.scope?.trim()) missing.push("Warrant scope or target is not recorded.");
  if (dimension === "EXECUTION" && !warrant.executionDate) missing.push("Execution date is not recorded.");
  if (dimension === "EXECUTION" && inventory.length === 0 && !warrant.returnNotes?.trim()) missing.push("Execution inventory is absent.");
  if (dimension === "EXECUTION" && officerCount === 0) missing.push("Executing officer is not recorded.");
  if (dimension === "GOOD_FAITH") missing.push("The affidavit the officer reviewed is not identified on this issue.");
  if (dimension === "CONSENT") missing.push("Consent source is absent.");
  return missing;
}

function derivedCaseMissing(dimension: SuppressionDimension): string[] {
  if (dimension === "MIRANDA") return ["Miranda timing is not recorded."];
  if (dimension === "VOLUNTARINESS") return ["Facts bearing on voluntariness are not recorded."];
  if (dimension === "IDENTIFICATION") return ["Identification procedure details are not recorded."];
  return ["Additional facts are not recorded for this issue."];
}

function concernFacts(dimension: SuppressionDimension, warrant: SuppressionWarrantInput, missingFacts: string[]): string[] {
  const facts = missingFacts.map((fact) => `Missing factual support: ${fact}`);
  if (
    (dimension === "EXECUTION" || dimension === "STALENESS") &&
    warrant.executionDate &&
    warrant.issueDate &&
    datePrefix(warrant.executionDate) < datePrefix(warrant.issueDate)
  ) {
    facts.push("Recorded execution date is earlier than the recorded issue date. Review the source dates.");
  }
  return facts;
}

function reducingFacts(
  dimension: SuppressionDimension,
  warrant: SuppressionWarrantInput,
  affidavits: string[],
  inventory: string[],
): string[] {
  const facts: string[] = [];
  if (dimension === "PROBABLE_CAUSE" && (affidavits.length > 0 || warrant.probableCauseFacts.length > 0)) {
    facts.push("An affidavit statement or probable-cause assertion is on the warrant record.");
  }
  if ((dimension === "PARTICULARITY" || dimension === "SCOPE" || dimension === "NEXUS") && warrant.scope?.trim()) {
    facts.push("Scope text is recorded.");
  }
  if (dimension === "EXECUTION" && inventory.length > 0) facts.push("A return inventory is recorded.");
  if (dimension === "STALENESS" && warrant.issueDate) facts.push("An issue date is recorded.");
  return facts;
}

function routeMissingFact(text: string): SuppressionDimension | null {
  const value = text.toLowerCase();
  if (/good faith|reliance on the warrant|binding precedent/.test(value)) return "GOOD_FAITH";
  if (/nexus|connection between|which device|place or device|device was searched/.test(value)) return "NEXUS";
  if (/stale|observation|underlying/.test(value)) return "STALENESS";
  if (/particular/.test(value)) return "PARTICULARITY";
  if (/inventory|execution|warrant return|knock|return/.test(value)) return "EXECUTION";
  if (/consent/.test(value)) return "CONSENT";
  if (/plain view/.test(value)) return "PLAIN_VIEW";
  if (/exigenc/.test(value)) return "EXIGENCY";
  if (/miranda|interrogat/.test(value)) return "MIRANDA";
  if (/voluntar|waiver/.test(value)) return "VOLUNTARINESS";
  if (/identification|lineup|show-?up/.test(value)) return "IDENTIFICATION";
  if (/counsel/.test(value)) return "RIGHT_TO_COUNSEL";
  if (/\bscope\b/.test(value)) return "SCOPE";
  if (/probable cause|affidavit/.test(value)) return "PROBABLE_CAUSE";
  return null;
}

function factsMentionScope(warrant: SuppressionWarrantInput, affidavits: string[]): boolean {
  const scopeTokens = tokens(warrant.scope ?? "");
  if (scopeTokens.size === 0) return false;
  const factTokens = tokens([...warrant.probableCauseFacts, ...affidavits].join(" "));
  for (const token of scopeTokens) if (factTokens.has(token)) return true;
  return false;
}

function observationDateRecorded(warrant: SuppressionWarrantInput, affidavits: string[]): boolean {
  return [...warrant.probableCauseFacts, ...affidavits].some((fact) =>
    /\b\d{4}-\d{2}-\d{2}\b/.test(fact) ||
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/i.test(fact),
  );
}

function linkTimelineToWarrant(
  warrant: SuppressionWarrantInput,
  timeline: Array<{ id: string; eventType: string; title: string; eventDate: string | null }>,
  warrantCount: number,
): { ids: string[]; events: Array<{ id: string; eventType: string; title: string; eventDate: string | null }> } {
  const linked = timeline.filter((event) => {
    if (event.eventType !== "WARRANT_ISSUED" && event.eventType !== "WARRANT_EXECUTED") return false;
    if (warrantCount === 1) return true;
    const stamp = datePrefix(event.eventDate);
    if (!stamp) return false;
    if (event.eventType === "WARRANT_ISSUED") return stamp === datePrefix(warrant.issueDate) || stamp === datePrefix(warrant.applicationDate);
    return stamp === datePrefix(warrant.executionDate);
  });
  return { ids: linked.map((event) => event.id), events: linked };
}

function disputedFactsForEvidence(evidence: SuppressionEvidenceLink[], input: SuppressionReviewInput): string[] {
  const witnessIds = new Set(
    input.evidence
      .filter((item) => evidence.some((link) => link.evidenceId === item.id))
      .flatMap((item) => item.relatedWitnessIds),
  );
  const statements = (input.statements ?? []).filter((statement) => witnessIds.has(statement.witnessId));
  if (statements.length < 2) return [];
  const comparison = compareWitnessStatements(statements[0]!.claims, statements[1]!.claims);
  return comparison
    .filter((row) => row.label === "CONTRADICTORY" || row.label === "TIMELINE_DIFFERENCE")
    .map((row) => `${row.detail} This comparison is not a truthfulness finding.`);
}

function reviewStatusFor(params: {
  id: string;
  missingFacts: string[];
  humanReviewedIssueIds?: string[];
  evidenceIds: string[];
  priorEvidenceIds?: string[];
  currentEvidenceIds?: string[];
}): SuppressionReviewIssue["reviewStatus"] {
  if (params.humanReviewedIssueIds?.includes(params.id)) return "human_reviewed";
  if (params.priorEvidenceIds && params.currentEvidenceIds) {
    const freshness = assessAnalysisFreshness({
      priorEvidenceIds: params.priorEvidenceIds,
      currentEvidenceIds: params.currentEvidenceIds,
      priorIssueEvidence: [{ issueId: params.id, evidenceIds: params.evidenceIds }],
    });
    if (freshness.refreshRequired && freshness.affectedIssueIds.includes(params.id)) return "needs_review";
  }
  return "open";
}

function dimensionsInQuestion(question: string): Set<SuppressionDimension> {
  const found = new Set<SuppressionDimension>();
  const value = question.toLowerCase();
  const table: Array<[RegExp, SuppressionDimension]> = [
    [/probable cause/, "PROBABLE_CAUSE"],
    [/nexus/, "NEXUS"],
    [/stale/, "STALENESS"],
    [/particular/, "PARTICULARITY"],
    [/good faith/, "GOOD_FAITH"],
    [/consent/, "CONSENT"],
    [/plain view/, "PLAIN_VIEW"],
    [/exigenc/, "EXIGENCY"],
    [/miranda/, "MIRANDA"],
    [/voluntar/, "VOLUNTARINESS"],
    [/identification/, "IDENTIFICATION"],
    [/counsel/, "RIGHT_TO_COUNSEL"],
    [/execution|inventory|knock/, "EXECUTION"],
    [/\bscope\b/, "SCOPE"],
  ];
  for (const [pattern, dimension] of table) if (pattern.test(value)) found.add(dimension);
  return found;
}

function defendantScope(ids: string[]): SuppressionReviewIssue["defendantScope"] {
  if (ids.length > 1) return "JOINT";
  if (ids.length === 1) return "DEFENDANT_SPECIFIC";
  return "UNASSIGNED";
}

function factsForDefendant(facts: string[], issue: SuppressionReviewIssue, defendantId: string): string[] {
  if (issue.defendantScope === "DEFENDANT_SPECIFIC" && !issue.defendantIds.includes(defendantId)) return [];
  return facts;
}

function labelAuthorities(authorities: SuppressionAuthorityLink[]): string {
  if (authorities.length === 0) return "(none with a source-supported proposition)";
  return authorities
    .map((authority) => `${authority.citation ?? authority.authorityId} [${authority.treatment}] ${authority.proposition ?? ""}`.trim())
    .join(" | ");
}

function toEvidenceLink(item: SuppressionEvidenceInput): SuppressionEvidenceLink {
  return {
    evidenceId: item.id,
    evidenceType: item.evidenceType,
    documentId: item.documentId,
    storageReference: item.storageReference,
    relatedDefendantIds: item.relatedDefendantIds,
    provenanceDocumentId: item.provenanceDocumentId ?? item.documentId,
  };
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((token) => token.length > 3 && !TOKEN_STOP.has(token)),
  );
}

function datePrefix(value: string | null | undefined): string {
  if (!value) return "";
  return value.slice(0, 10);
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function pushMap(map: Map<SuppressionDimension, string[]>, key: SuppressionDimension, value: string): void {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

export function suppressionPayload(input: SuppressionReviewInput): {
  suppressionReview: SuppressionReview;
  suppressionAnswer: SuppressionAnswer;
} {
  const suppressionReview = buildSuppressionReview(input);
  return {
    suppressionReview,
    suppressionAnswer: answerSuppressionQuestion({
      review: suppressionReview,
      question: "What suppression issues should be reviewed?",
    }),
  };
}
