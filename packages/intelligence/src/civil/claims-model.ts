/**
 * Application-layer civil claims / defenses / counterclaims model (Deepening Pass 3).
 *
 * Deterministic, non-deciding analysis helpers. Persistence lives in postgres/adapter
 * against migration 0020_civil_claims. Does not invent liability outcomes.
 */

export const CIVIL_CLAIM_KINDS = [
  "CLAIM",
  "COUNTERCLAIM",
  "CROSSCLAIM",
  "THIRD_PARTY_CLAIM",
] as const;
export type CivilClaimKind = (typeof CIVIL_CLAIM_KINDS)[number];

export const CIVIL_CLAIM_CATEGORIES = [
  "STATUTORY",
  "COMMON_LAW",
  "CONSTITUTIONAL",
  "CONTRACT",
  "TORT",
  "EQUITABLE",
  "PROCEDURAL",
  "OTHER",
] as const;
export type CivilClaimCategory = (typeof CIVIL_CLAIM_CATEGORIES)[number];

export const CIVIL_DEFENSE_KINDS = [
  "ELEMENT_NEGATING",
  "AFFIRMATIVE",
  "PROCEDURAL",
  "JURISDICTIONAL",
  "LIMITATIONS",
  "NOTICE",
  "WAIVER",
  "CONSENT",
  "PRIVILEGE",
  "PREEMPTION",
  "FAILURE_TO_STATE_A_CLAIM",
  "OTHER",
] as const;
export type CivilDefenseKind = (typeof CIVIL_DEFENSE_KINDS)[number];

/** Non-deciding support statuses — mirrors prosecution element statuses. No WIN/LOSE/LIABLE. */
export const CIVIL_ELEMENT_STATUSES = [
  "SUPPORTED",
  "PARTIALLY_SUPPORTED",
  "CONFLICTED",
  "NO_EVIDENCE_FOUND",
  "UNKNOWN",
] as const;
export type CivilElementStatus = (typeof CIVIL_ELEMENT_STATUSES)[number];

export const CIVIL_PROCEDURAL_STATUSES = [
  "PLED",
  "AMENDED",
  "DISMISSED",
  "WITHDRAWN",
  "PENDING",
  "SUMMARY_JUDGMENT",
  "TRIAL",
  "RESOLVED",
  "SUPERSEDED",
  "UNKNOWN",
] as const;
export type CivilProceduralStatus = (typeof CIVIL_PROCEDURAL_STATUSES)[number];

export const CIVIL_EVIDENCE_ROLES = [
  "SUPPORTS",
  "UNDERMINES",
  "CONTRADICTS",
  "CORROBORATES",
  "RELATED_TO",
  "MISSING_EXPECTED",
] as const;
export type CivilEvidenceRole = (typeof CIVIL_EVIDENCE_ROLES)[number];

export const CIVIL_PARTY_ROLES = [
  "PLAINTIFF",
  "DEFENDANT",
  "COUNTERCLAIMANT",
  "COUNTERCLAIM_DEFENDANT",
  "THIRD_PARTY_PLAINTIFF",
  "THIRD_PARTY_DEFENDANT",
  "OTHER",
] as const;
export type CivilPartyRole = (typeof CIVIL_PARTY_ROLES)[number];

export const CIVIL_AUTHORITY_RELATIONS = [
  "BINDING",
  "PERSUASIVE",
  "CONTRARY",
  "DISTINGUISHABLE",
] as const;
export type CivilAuthorityRelation = (typeof CIVIL_AUTHORITY_RELATIONS)[number];

export type CivilSourceProvenance = {
  documentId: string | null;
  sourceSpan: string | null;
  sourcePage: number | null;
  pleadingId: string | null;
  humanEntered: boolean;
  extractionOrigin: "source_metadata" | "deterministic_fixture" | "user_entry";
};

export type CivilParty = {
  id: string;
  displayName: string;
  entityType: "person" | "organization";
};

export type CivilPleading = {
  id: string;
  label: string;
  filedAt: string | null;
  supersededByPleadingId: string | null;
  supersedesPleadingId: string | null;
  isCurrent: boolean;
  provenance: CivilSourceProvenance;
};

export type CivilFact = {
  id: string;
  text: string;
  relatedPartyIds: string[];
  provenance: CivilSourceProvenance;
};

export type CivilEvidenceItem = {
  id: string;
  label: string;
  documentId: string | null;
  relatedPartyIds: string[];
  provenance: CivilSourceProvenance;
};

export type CivilAuthorityLink = {
  authorityId: string;
  citation: string | null;
  title: string | null;
  relation: CivilAuthorityRelation;
  treatment: "UNVERIFIED" | "VERIFIED";
  currentness: string;
  proposition: string | null;
  sourceSpan: string | null;
  sourceSupported: boolean;
  target: "claim" | "element" | "defense" | "legal_issue";
  targetId: string;
};

export type CivilStandardLink = {
  id: string;
  label: string;
  standardType: "ELEMENT" | "MULTI_FACTOR" | "EXCEPTION" | "BURDEN" | "PROCEDURAL" | "SUMMARY_JUDGMENT" | "OTHER";
  text: string | null;
  sourceSpan: string | null;
  target: "claim" | "element" | "defense";
  targetId: string;
};

export type CivilLegalIssueLink = {
  issueId: string;
  label: string;
  claimIds: string[];
  defenseIds: string[];
};

export type CivilEvidenceRelation = {
  evidenceId: string;
  role: CivilEvidenceRole;
  /** When set, evidence applies only to these parties for this target. Empty = shared where linked. */
  partyIds: string[];
  note: string | null;
};

export type CivilFactRelation = {
  factId: string;
  role: CivilEvidenceRole;
  partyIds: string[];
  note: string | null;
};

export type CivilClaimElement = {
  id: string;
  claimId: string;
  label: string;
  requirementText: string;
  status: CivilElementStatus;
  supportingEvidence: CivilEvidenceRelation[];
  contraryEvidence: CivilEvidenceRelation[];
  missingEvidence: Array<{ id: string; description: string }>;
  factRelations: CivilFactRelation[];
  authorities: CivilAuthorityLink[];
  standards: CivilStandardLink[];
  uncertainty: string[];
  provenance: CivilSourceProvenance;
};

export type CivilClaimParty = {
  partyId: string;
  role: CivilPartyRole;
};

export type CivilClaim = {
  id: string;
  kind: CivilClaimKind;
  category: CivilClaimCategory;
  label: string;
  description: string;
  parties: CivilClaimParty[];
  /** Factual/legal support status for the claim as a whole — never liability. */
  supportStatus: CivilElementStatus;
  proceduralStatus: CivilProceduralStatus;
  pleadingId: string;
  supersededByClaimId: string | null;
  supersedesClaimId: string | null;
  isCurrent: boolean;
  elements: CivilClaimElement[];
  legalIssueIds: string[];
  authorities: CivilAuthorityLink[];
  standards: CivilStandardLink[];
  damagesOrRemedy: {
    category: string | null;
    remedySought: string | null;
    notes: string | null;
  } | null;
  uncertainty: string[];
  provenance: CivilSourceProvenance;
  liabilityConclusion: null;
};

export type CivilDefense = {
  id: string;
  kind: CivilDefenseKind;
  label: string;
  description: string;
  /** Claims this defense responds to. */
  againstClaimIds: string[];
  assertingPartyIds: string[];
  targetPartyIds: string[];
  supportStatus: CivilElementStatus;
  proceduralStatus: CivilProceduralStatus;
  pleadingId: string;
  isCurrent: boolean;
  elements: CivilClaimElement[];
  evidence: CivilEvidenceRelation[];
  factRelations: CivilFactRelation[];
  authorities: CivilAuthorityLink[];
  standards: CivilStandardLink[];
  legalIssueIds: string[];
  uncertainty: string[];
  provenance: CivilSourceProvenance;
  validityConclusion: null;
};

export type CivilCaseTheory = {
  id: string;
  orientation: "plaintiff" | "defendant" | "counterclaim" | "alternative" | "system_hypothesis";
  label: string;
  supportingFactIds: string[];
  contraryFactIds: string[];
  missingFactIds: string[];
  affectedClaimIds: string[];
  affectedDefenseIds: string[];
  status: "hypothesis";
};

export type CivilClaimsReview = {
  matterId: string;
  organizationId: string;
  jurisdiction: string | null;
  forumCourtId: string | null;
  parties: CivilParty[];
  pleadings: CivilPleading[];
  facts: CivilFact[];
  evidence: CivilEvidenceItem[];
  claims: CivilClaim[];
  defenses: CivilDefense[];
  legalIssues: CivilLegalIssueLink[];
  theories: CivilCaseTheory[];
  coverageWarnings: string[];
  liabilityConclusion: null;
  outcomeConclusion: null;
};

export type CivilClaimMatrixRow = {
  rowKind: "claim" | "counterclaim" | "defense";
  parentId: string;
  parentLabel: string;
  elementId: string;
  elementLabel: string;
  requirementText: string;
  supportStatus: CivilElementStatus;
  proceduralStatus: CivilProceduralStatus;
  claimantPartyIds: string[];
  targetPartyIds: string[];
  supportingEvidenceIds: string[];
  contraryEvidenceIds: string[];
  missingEvidence: Array<{ id: string; description: string }>;
  bindingAuthorities: string[];
  persuasiveAuthorities: string[];
  uncertainty: string[];
  isCurrent: boolean;
};

export type CivilWholeMatterView = {
  currentClaims: Array<{ id: string; label: string; kind: CivilClaimKind; supportStatus: CivilElementStatus; proceduralStatus: CivilProceduralStatus }>;
  supersededClaims: Array<{ id: string; label: string; supersededByClaimId: string | null }>;
  defenses: Array<{ id: string; label: string; kind: CivilDefenseKind; againstClaimIds: string[]; supportStatus: CivilElementStatus }>;
  counterclaims: Array<{ id: string; label: string; supportStatus: CivilElementStatus }>;
  partyOrientations: Array<{ claimId: string; claimants: string[]; targets: string[] }>;
  sharedEvidenceRoles: Array<{ evidenceId: string; roles: Array<{ targetKind: "claim" | "defense" | "element"; targetId: string; role: CivilEvidenceRole }> }>;
  missingEvidence: Array<{ parentId: string; description: string }>;
  uncertainty: string[];
  liabilityConclusion: null;
  outcomeConclusion: null;
};

export type CivilAskAnswer = {
  question: string;
  claims: Array<{ id: string; label: string; kind: CivilClaimKind; isCurrent: boolean; supportStatus: CivilElementStatus; proceduralStatus: CivilProceduralStatus }>;
  elements: Array<{ claimId: string; elementId: string; label: string; status: CivilElementStatus; missing: string[] }>;
  defenses: Array<{ id: string; label: string; kind: CivilDefenseKind; againstClaimIds: string[] }>;
  evidenceNotes: string[];
  amendmentNotes: string[];
  investigationNotes: string[];
  authorityNotes: string[];
  limitations: string[];
  liabilityConclusion: null;
  outcomeConclusion: null;
};

/** Non-deciding structured claim strength analysis. Never includes liability/win-loss. */
export type CivilClaimStrengthAnalysis = {
  claimId: string;
  claimLabel: string;
  kind: CivilClaimKind;
  proceduralStatus: CivilProceduralStatus;
  elementSupportCompleteness: Array<{
    elementId: string;
    label: string;
    status: CivilElementStatus;
    supportingEvidenceIds: string[];
    contraryEvidenceIds: string[];
    conflicted: boolean;
    missingEvidence: string[];
  }>;
  unresolvedFactualQuestions: string[];
  unresolvedLegalQuestions: string[];
  authorityGaps: string[];
  investigationQuestions: string[];
  discoveryOpportunities: string[];
  proceduralConcerns: string[];
  liabilityConclusion: null;
  outcomeConclusion: null;
};

const FORBIDDEN_LIABILITY = [
  /\bthe (plaintiff|defendant) is liable\b/i,
  /\bnot liable\b/i,
  /\bwill (win|lose)\b/i,
  /\bcase is (strong|weak)\b/i,
  /\bliability (is|was) established\b/i,
  /\bdefendant must pay\b/i,
];

export function findCivilLiabilityViolations(text: string): string[] {
  return FORBIDDEN_LIABILITY.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
}

export function assertCivilElementStatus(status: string): asserts status is CivilElementStatus {
  if (!(CIVIL_ELEMENT_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`Forbidden civil element status: ${status}`);
  }
  if (/WIN|LOSE|LIABLE|NOT_LIABLE|GUILTY/i.test(status)) {
    throw new Error(`Decisive civil status rejected: ${status}`);
  }
}

function partyIdsForRole(claim: CivilClaim, roles: CivilPartyRole[]): string[] {
  return claim.parties.filter((party) => roles.includes(party.role)).map((party) => party.partyId);
}

function evidenceIds(relations: CivilEvidenceRelation[], roles?: CivilEvidenceRole[]): string[] {
  return relations
    .filter((relation) => !roles || roles.includes(relation.role))
    .map((relation) => relation.evidenceId);
}

/** Builds the mature Claim Matrix without a win-probability column. */
export function buildCivilClaimMatrix(review: CivilClaimsReview): CivilClaimMatrixRow[] {
  const rows: CivilClaimMatrixRow[] = [];
  for (const claim of review.claims) {
    const rowKind = claim.kind === "COUNTERCLAIM" ? "counterclaim" : "claim";
    for (const element of claim.elements) {
      assertCivilElementStatus(element.status);
      rows.push({
        rowKind,
        parentId: claim.id,
        parentLabel: claim.label,
        elementId: element.id,
        elementLabel: element.label,
        requirementText: element.requirementText,
        supportStatus: element.status,
        proceduralStatus: claim.proceduralStatus,
        claimantPartyIds: partyIdsForRole(claim, ["PLAINTIFF", "COUNTERCLAIMANT", "THIRD_PARTY_PLAINTIFF"]),
        targetPartyIds: partyIdsForRole(claim, ["DEFENDANT", "COUNTERCLAIM_DEFENDANT", "THIRD_PARTY_DEFENDANT"]),
        supportingEvidenceIds: evidenceIds(element.supportingEvidence, ["SUPPORTS", "CORROBORATES"]),
        contraryEvidenceIds: evidenceIds(element.contraryEvidence, ["UNDERMINES", "CONTRADICTS"]),
        missingEvidence: element.missingEvidence,
        bindingAuthorities: [...claim.authorities, ...element.authorities]
          .filter((authority) => authority.relation === "BINDING" && authority.sourceSupported)
          .map((authority) => authority.citation ?? authority.authorityId),
        persuasiveAuthorities: [...claim.authorities, ...element.authorities]
          .filter((authority) => authority.relation === "PERSUASIVE" && authority.sourceSupported)
          .map((authority) => authority.citation ?? authority.authorityId),
        uncertainty: [...claim.uncertainty, ...element.uncertainty],
        isCurrent: claim.isCurrent,
      });
    }
  }
  for (const defense of review.defenses) {
    const elements =
      defense.elements.length > 0
        ? defense.elements
        : [
            {
              id: `${defense.id}-surface`,
              claimId: defense.id,
              label: defense.label,
              requirementText: defense.description,
              status: defense.supportStatus,
              supportingEvidence: defense.evidence.filter((item) => item.role === "SUPPORTS" || item.role === "CORROBORATES"),
              contraryEvidence: defense.evidence.filter((item) => item.role === "UNDERMINES" || item.role === "CONTRADICTS"),
              missingEvidence: [] as Array<{ id: string; description: string }>,
              factRelations: defense.factRelations,
              authorities: defense.authorities,
              standards: defense.standards,
              uncertainty: defense.uncertainty,
              provenance: defense.provenance,
            } satisfies CivilClaimElement,
          ];
    for (const element of elements) {
      assertCivilElementStatus(element.status);
      rows.push({
        rowKind: "defense",
        parentId: defense.id,
        parentLabel: defense.label,
        elementId: element.id,
        elementLabel: element.label,
        requirementText: element.requirementText,
        supportStatus: element.status,
        proceduralStatus: defense.proceduralStatus,
        claimantPartyIds: defense.assertingPartyIds,
        targetPartyIds: defense.targetPartyIds,
        supportingEvidenceIds: evidenceIds(element.supportingEvidence, ["SUPPORTS", "CORROBORATES"]),
        contraryEvidenceIds: evidenceIds(element.contraryEvidence, ["UNDERMINES", "CONTRADICTS"]),
        missingEvidence: element.missingEvidence,
        bindingAuthorities: [...defense.authorities, ...element.authorities]
          .filter((authority) => authority.relation === "BINDING" && authority.sourceSupported)
          .map((authority) => authority.citation ?? authority.authorityId),
        persuasiveAuthorities: [...defense.authorities, ...element.authorities]
          .filter((authority) => authority.relation === "PERSUASIVE" && authority.sourceSupported)
          .map((authority) => authority.citation ?? authority.authorityId),
        uncertainty: [...defense.uncertainty, ...element.uncertainty],
        isCurrent: defense.isCurrent,
      });
    }
  }
  return rows;
}

export function buildCivilWholeMatterView(review: CivilClaimsReview): CivilWholeMatterView {
  const currentClaims = review.claims
    .filter((claim) => claim.isCurrent && claim.kind !== "COUNTERCLAIM")
    .map((claim) => ({
      id: claim.id,
      label: claim.label,
      kind: claim.kind,
      supportStatus: claim.supportStatus,
      proceduralStatus: claim.proceduralStatus,
    }));
  const supersededClaims = review.claims
    .filter((claim) => !claim.isCurrent || claim.proceduralStatus === "SUPERSEDED" || claim.proceduralStatus === "WITHDRAWN")
    .map((claim) => ({
      id: claim.id,
      label: claim.label,
      supersededByClaimId: claim.supersededByClaimId,
    }));
  const counterclaims = review.claims
    .filter((claim) => claim.kind === "COUNTERCLAIM" && claim.isCurrent)
    .map((claim) => ({ id: claim.id, label: claim.label, supportStatus: claim.supportStatus }));
  const defenses = review.defenses
    .filter((defense) => defense.isCurrent)
    .map((defense) => ({
      id: defense.id,
      label: defense.label,
      kind: defense.kind,
      againstClaimIds: defense.againstClaimIds,
      supportStatus: defense.supportStatus,
    }));
  const partyOrientations = review.claims.map((claim) => ({
    claimId: claim.id,
    claimants: partyIdsForRole(claim, ["PLAINTIFF", "COUNTERCLAIMANT", "THIRD_PARTY_PLAINTIFF"]),
    targets: partyIdsForRole(claim, ["DEFENDANT", "COUNTERCLAIM_DEFENDANT", "THIRD_PARTY_DEFENDANT"]),
  }));

  const roleMap = new Map<string, Array<{ targetKind: "claim" | "defense" | "element"; targetId: string; role: CivilEvidenceRole }>>();
  const pushRole = (evidenceId: string, targetKind: "claim" | "defense" | "element", targetId: string, role: CivilEvidenceRole) => {
    const list = roleMap.get(evidenceId) ?? [];
    list.push({ targetKind, targetId, role });
    roleMap.set(evidenceId, list);
  };
  for (const claim of review.claims) {
    for (const element of claim.elements) {
      for (const relation of [...element.supportingEvidence, ...element.contraryEvidence]) {
        pushRole(relation.evidenceId, "element", element.id, relation.role);
      }
    }
  }
  for (const defense of review.defenses) {
    for (const relation of defense.evidence) pushRole(relation.evidenceId, "defense", defense.id, relation.role);
    for (const element of defense.elements) {
      for (const relation of [...element.supportingEvidence, ...element.contraryEvidence]) {
        pushRole(relation.evidenceId, "element", element.id, relation.role);
      }
    }
  }

  const missingEvidence: CivilWholeMatterView["missingEvidence"] = [];
  for (const claim of review.claims.filter((row) => row.isCurrent)) {
    for (const element of claim.elements) {
      for (const missing of element.missingEvidence) {
        missingEvidence.push({ parentId: claim.id, description: missing.description });
      }
    }
  }
  for (const defense of review.defenses.filter((row) => row.isCurrent)) {
    for (const element of defense.elements) {
      for (const missing of element.missingEvidence) {
        missingEvidence.push({ parentId: defense.id, description: missing.description });
      }
    }
  }

  return {
    currentClaims,
    supersededClaims,
    defenses,
    counterclaims,
    partyOrientations,
    sharedEvidenceRoles: [...roleMap.entries()].map(([evidenceId, roles]) => ({ evidenceId, roles })),
    missingEvidence,
    uncertainty: [
      ...review.coverageWarnings,
      ...review.claims.flatMap((claim) => claim.uncertainty),
      ...review.defenses.flatMap((defense) => defense.uncertainty),
    ],
    liabilityConclusion: null,
    outcomeConclusion: null,
  };
}

/**
 * Filters evidence relations to a defendant party. Defendant-specific evidence does not
 * automatically transfer to another defendant unless the relation lists that party or is shared (empty partyIds).
 */
export function evidenceRelationsForParty(
  relations: CivilEvidenceRelation[],
  partyId: string,
): CivilEvidenceRelation[] {
  return relations.filter((relation) => relation.partyIds.length === 0 || relation.partyIds.includes(partyId));
}

export function currentPleadings(review: CivilClaimsReview): CivilPleading[] {
  return review.pleadings.filter((pleading) => pleading.isCurrent);
}

export function currentClaims(review: CivilClaimsReview): CivilClaim[] {
  return review.claims.filter((claim) => claim.isCurrent);
}

export function isCivilClaimsAskQuestion(question: string): boolean {
  return /(claim|counterclaim|defense|affirmative defense|element|requirement|pleading|amended complaint|notice defense|breach|cause of action|waiver|investigate|evidentiary weakness|live claims|defendant|plaintiff|authority|authorities)/i.test(
    question,
  );
}

export function buildCivilClaimStrengthAnalysis(claim: CivilClaim): CivilClaimStrengthAnalysis {
  const elementSupportCompleteness = claim.elements.map((element) => {
    const supportingEvidenceIds = element.supportingEvidence.map((row) => row.evidenceId);
    const contraryEvidenceIds = element.contraryEvidence.map((row) => row.evidenceId);
    return {
      elementId: element.id,
      label: element.label,
      status: element.status,
      supportingEvidenceIds,
      contraryEvidenceIds,
      conflicted: element.status === "CONFLICTED" || (supportingEvidenceIds.length > 0 && contraryEvidenceIds.length > 0),
      missingEvidence: element.missingEvidence.map((item) => item.description),
    };
  });

  const unresolvedFactualQuestions: string[] = [];
  const investigationQuestions: string[] = [];
  const discoveryOpportunities: string[] = [];
  for (const element of elementSupportCompleteness) {
    if (element.status === "NO_EVIDENCE_FOUND" || element.missingEvidence.length > 0) {
      unresolvedFactualQuestions.push(
        `No evidence was found supporting ${element.label} on claim ${claim.id}.`,
      );
      investigationQuestions.push(`What documentary or testimonial support exists for ${element.label}?`);
      for (const missing of element.missingEvidence) {
        discoveryOpportunities.push(`Seek production or deposition testimony regarding: ${missing}`);
      }
    }
    if (element.conflicted) {
      unresolvedFactualQuestions.push(
        `Evidence supporting ${element.label} conflicts with contrary evidence on claim ${claim.id}.`,
      );
      investigationQuestions.push(`How should counsel reconcile conflicting evidence on ${element.label}?`);
    }
    if (element.status === "PARTIALLY_SUPPORTED") {
      investigationQuestions.push(
        `Element ${element.label} currently has limited documentary support.`,
      );
    }
  }

  const authorityGaps: string[] = [];
  const unresolvedLegalQuestions: string[] = [];
  if (claim.authorities.length === 0) {
    authorityGaps.push(`No linked authorities on claim ${claim.id} (${claim.label}).`);
    unresolvedLegalQuestions.push(`Which authorities govern the elements of ${claim.label}?`);
  }
  if (claim.standards.length === 0) {
    unresolvedLegalQuestions.push(`Which legal standards apply to ${claim.label}?`);
  }
  for (const gap of claim.uncertainty) {
    unresolvedLegalQuestions.push(gap);
  }

  const proceduralConcerns: string[] = [];
  if (claim.proceduralStatus === "SUPERSEDED" || !claim.isCurrent) {
    proceduralConcerns.push(`Claim ${claim.id} is not current (proceduralStatus=${claim.proceduralStatus}).`);
  }
  if (claim.proceduralStatus === "AMENDED") {
    proceduralConcerns.push(`Claim ${claim.id} reflects an amended pleading lineage; inspect superseded prior versions.`);
  }

  return {
    claimId: claim.id,
    claimLabel: claim.label,
    kind: claim.kind,
    proceduralStatus: claim.proceduralStatus,
    elementSupportCompleteness,
    unresolvedFactualQuestions,
    unresolvedLegalQuestions,
    authorityGaps,
    investigationQuestions,
    discoveryOpportunities,
    proceduralConcerns,
    liabilityConclusion: null,
    outcomeConclusion: null,
  };
}

export function answerCivilClaimsQuestion(params: {
  review: CivilClaimsReview;
  question: string;
}): CivilAskAnswer {
  const review = params.review;
  const q = params.question.toLowerCase();
  const current = currentClaims(review);
  const partyMatch = review.parties.find((party) => {
    const name = party.displayName.toLowerCase();
    if (q.includes(name)) return true;
    const tokens = name.split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
    return tokens.some((token) => new RegExp(`\\b${token}\\b`, "i").test(params.question));
  });

  let scopedClaims = current;
  if (partyMatch) {
    scopedClaims = current.filter((claim) => claim.parties.some((party) => party.partyId === partyMatch.id));
  } else if (
    /counterclaim/i.test(params.question) &&
    !/all live|all current|whole.?matter|currently pleaded/i.test(params.question)
  ) {
    scopedClaims = current.filter((claim) => claim.kind === "COUNTERCLAIM");
  }

  // Element focus may narrow to breach without removing other current claims from the claim list.
  let elementScopedClaims = scopedClaims;
  if (
    /breach/i.test(params.question) &&
    !partyMatch &&
    !/all live|whole.?matter|major evidentiary/i.test(params.question)
  ) {
    elementScopedClaims = scopedClaims.filter(
      (claim) => /breach/i.test(claim.label) || claim.elements.some((element) => /breach/i.test(element.label)),
    );
    if (elementScopedClaims.length === 0) elementScopedClaims = scopedClaims;
  }

  const listCurrentOnly = /current|pleaded|live claims|all live/i.test(params.question) || /claim/i.test(params.question);
  const claims = (listCurrentOnly ? scopedClaims : review.claims.filter((claim) => scopedClaims.some((row) => row.id === claim.id) || !partyMatch))
    .map((claim) => ({
      id: claim.id,
      label: claim.label,
      kind: claim.kind,
      isCurrent: claim.isCurrent,
      supportStatus: claim.supportStatus,
      proceduralStatus: claim.proceduralStatus,
    }));

  const elements = elementScopedClaims.flatMap((claim) =>
    claim.elements
      .filter((element) => {
        if (/unsupported|missing|no evidence|lack evidence|weakness/i.test(params.question)) {
          return element.status === "NO_EVIDENCE_FOUND" || element.status === "UNKNOWN" || element.missingEvidence.length > 0 || element.status === "CONFLICTED" || element.status === "PARTIALLY_SUPPORTED";
        }
        if (/breach/i.test(params.question) && !/breach/i.test(claim.label) && !/breach/i.test(element.label)) {
          return false;
        }
        return true;
      })
      .map((element) => ({
        claimId: claim.id,
        elementId: element.id,
        label: element.label,
        status: element.status,
        missing: element.missingEvidence.map((item) => item.description),
      })),
  );

  const defenses = review.defenses
    .filter((defense) => defense.isCurrent)
    .filter((defense) => {
      if (partyMatch) {
        return (
          defense.assertingPartyIds.includes(partyMatch.id) ||
          defense.targetPartyIds.includes(partyMatch.id) ||
          defense.againstClaimIds.some((claimId) =>
            current.some((claim) => claim.id === claimId && claim.parties.some((party) => party.partyId === partyMatch.id)),
          )
        );
      }
      if (/waiver/i.test(params.question)) return /waiver/i.test(defense.label) || defense.kind === "WAIVER";
      if (/notice/i.test(params.question)) return /notice/i.test(defense.label) || defense.kind === "NOTICE";
      if (/defense/i.test(params.question)) return true;
      return /defense|notice|waiver|affirmative/i.test(params.question);
    })
    .map((defense) => ({
      id: defense.id,
      label: defense.label,
      kind: defense.kind,
      againstClaimIds: defense.againstClaimIds,
    }));

  const evidenceNotes: string[] = [];
  if (/same evidence|shared evidence|rely on the same/i.test(params.question)) {
    const whole = buildCivilWholeMatterView(review);
    for (const row of whole.sharedEvidenceRoles) {
      if (row.roles.length > 1) {
        evidenceNotes.push(
          `Evidence ${row.evidenceId} plays roles: ${row.roles.map((role) => `${role.role}@${role.targetId}`).join(", ")}`,
        );
      }
    }
  }
  if (/contrary|contradict|conflicts with/i.test(params.question)) {
    for (const claim of scopedClaims) {
      for (const element of claim.elements) {
        for (const relation of element.contraryEvidence) {
          evidenceNotes.push(
            `Evidence ${relation.evidenceId} conflicts with ${element.label} on claim ${claim.label} (${claim.id}).`,
          );
        }
      }
    }
  }
  if (/supports|supporting evidence/i.test(params.question)) {
    for (const claim of scopedClaims) {
      for (const element of claim.elements) {
        for (const relation of element.supportingEvidence) {
          evidenceNotes.push(
            `Evidence ${relation.evidenceId} supports ${element.label} on claim ${claim.label} (${claim.id}).`,
          );
        }
      }
    }
  }
  if (/notice defense/i.test(params.question)) {
    const notice = review.defenses.find((defense) => defense.kind === "NOTICE" || /notice/i.test(defense.label));
    if (notice) {
      for (const relation of notice.evidence) {
        evidenceNotes.push(`Notice defense evidence ${relation.evidenceId} role=${relation.role}`);
      }
    }
  }
  if (/weakness|investigate|prioritize|discovery/i.test(params.question)) {
    for (const claim of scopedClaims) {
      const strength = buildCivilClaimStrengthAnalysis(claim);
      for (const note of strength.unresolvedFactualQuestions) evidenceNotes.push(note);
      for (const note of strength.investigationQuestions) evidenceNotes.push(note);
    }
  }

  const amendmentNotes: string[] = [];
  if (/amended|complaint|changed|superseded|removed|added|original/i.test(params.question)) {
    for (const claim of review.claims.filter((row) => !row.isCurrent)) {
      amendmentNotes.push(
        `Claim ${claim.id} (${claim.label}) is not current; proceduralStatus=${claim.proceduralStatus}; supersededBy=${claim.supersededByClaimId ?? "none"}`,
      );
    }
    for (const pleading of review.pleadings) {
      amendmentNotes.push(
        `Pleading ${pleading.id} label=${pleading.label} isCurrent=${pleading.isCurrent} supersededBy=${pleading.supersededByPleadingId ?? "none"}`,
      );
    }
  }

  const authorityNotes: string[] = [];
  if (/authorit|govern|standard|legal issue/i.test(params.question)) {
    const defenseTargets = /waiver/i.test(params.question)
      ? review.defenses.filter((defense) => defense.kind === "WAIVER" || /waiver/i.test(defense.label))
      : review.defenses.filter((defense) => defense.isCurrent);
    for (const defense of defenseTargets) {
      for (const authority of defense.authorities) {
        authorityNotes.push(
          `Defense ${defense.id} authority ${authority.authorityId} relation=${authority.relation} treatment=${authority.treatment} citation=${authority.citation ?? "(none)"} sourceSupported=${authority.sourceSupported}`,
        );
      }
      if (defense.authorities.length === 0 && /waiver|authorit|govern/i.test(params.question)) {
        authorityNotes.push(`Defense ${defense.id} (${defense.label}) has no linked authorities.`);
      }
      for (const standard of defense.standards) {
        authorityNotes.push(`Defense ${defense.id} standard ${standard.id} label=${standard.label}`);
      }
    }
    for (const claim of scopedClaims) {
      for (const authority of claim.authorities) {
        authorityNotes.push(
          `Claim ${claim.id} authority ${authority.authorityId} relation=${authority.relation} treatment=${authority.treatment} citation=${authority.citation ?? "(none)"}`,
        );
      }
      for (const standard of claim.standards) {
        authorityNotes.push(`Claim ${claim.id} standard ${standard.id} label=${standard.label}`);
      }
      for (const issueId of claim.legalIssueIds) {
        const issue = review.legalIssues.find((row) => row.issueId === issueId);
        authorityNotes.push(
          `Claim ${claim.id} legal issue ${issueId} label=${issue?.label ?? "(unresolved label)"}`,
        );
      }
    }
  }

  const investigationNotes: string[] = [];
  if (/investigate|prioritize|discovery|weakness|whole.?matter/i.test(params.question)) {
    for (const claim of scopedClaims) {
      const strength = buildCivilClaimStrengthAnalysis(claim);
      investigationNotes.push(...strength.investigationQuestions);
      investigationNotes.push(...strength.discoveryOpportunities);
      investigationNotes.push(...strength.proceduralConcerns);
    }
  }

  const limitations = [
    ...review.coverageWarnings,
    "Nyaya does not decide liability, win/lose outcomes, or claim validity.",
    "Procedural status is separate from factual support status.",
    "Superseded pleadings remain traceable but are not treated as current.",
    "FACTS, EVIDENCE, LEGAL ISSUES, AUTHORITIES, and LEGAL STANDARDS remain separate categories.",
    "Human review is required before filing, settlement, or dispositive motion practice.",
  ];

  return {
    question: params.question,
    claims,
    elements,
    defenses,
    evidenceNotes,
    amendmentNotes,
    investigationNotes,
    authorityNotes,
    limitations,
    liabilityConclusion: null,
    outcomeConclusion: null,
  };
}

export function formatCivilClaimsAnswer(answer: CivilAskAnswer): string {
  const lines = [
    "CIVIL_CLAIMS_REVIEW (non-deciding; do not convert missing evidence into liability):",
    `QUESTION: ${answer.question}`,
    "CLAIMS:",
    ...answer.claims.map(
      (claim) =>
        `- ${claim.id} [${claim.kind}] ${claim.label} current=${claim.isCurrent} support=${claim.supportStatus} procedural=${claim.proceduralStatus}`,
    ),
    "ELEMENTS:",
    ...answer.elements.map(
      (element) =>
        `- ${element.claimId}/${element.elementId} ${element.label} status=${element.status} missing=${element.missing.join(" | ") || "(none)"}`,
    ),
    "DEFENSES:",
    ...answer.defenses.map(
      (defense) => `- ${defense.id} [${defense.kind}] ${defense.label} against=${defense.againstClaimIds.join(",")}`,
    ),
    "FACTS_EVIDENCE_NOTES:",
    ...(answer.evidenceNotes.length > 0 ? answer.evidenceNotes.map((note) => `- ${note}`) : ["- (none)"]),
    "AUTHORITIES_AND_STANDARDS:",
    ...(answer.authorityNotes.length > 0 ? answer.authorityNotes.map((note) => `- ${note}`) : ["- (none)"]),
    "AMENDMENT_NOTES:",
    ...(answer.amendmentNotes.length > 0 ? answer.amendmentNotes.map((note) => `- ${note}`) : ["- (none)"]),
    "INVESTIGATION_NOTES:",
    ...(answer.investigationNotes.length > 0 ? answer.investigationNotes.map((note) => `- ${note}`) : ["- (none)"]),
    `LIMITATIONS: ${answer.limitations.join(" | ")}`,
    "LIABILITY_CONCLUSION: null",
    "OUTCOME_CONCLUSION: null",
  ];
  const text = lines.join("\n");
  const violations = findCivilLiabilityViolations(text);
  if (violations.length > 0) {
    throw new Error(`Civil claims answer used a forbidden conclusion: ${violations.join(", ")}`);
  }
  return text;
}

export function checkCivilClaimsConsistency(params: {
  review: CivilClaimsReview;
  matrix: CivilClaimMatrixRow[];
  whole: CivilWholeMatterView;
}): { consistent: boolean; conflicts: string[] } {
  const conflicts: string[] = [];
  const currentClaimIds = new Set(params.review.claims.filter((claim) => claim.isCurrent).map((claim) => claim.id));
  for (const row of params.matrix.filter((item) => item.rowKind !== "defense" && item.isCurrent)) {
    if (!currentClaimIds.has(row.parentId) && row.rowKind !== "defense") {
      // counterclaims are claims too
    }
  }
  for (const claim of params.review.claims.filter((row) => row.isCurrent)) {
    if (params.whole.currentClaims.every((row) => row.id !== claim.id) && claim.kind !== "COUNTERCLAIM") {
      conflicts.push(`whole-matter missing current claim ${claim.id}`);
    }
    if (claim.kind === "COUNTERCLAIM" && params.whole.counterclaims.every((row) => row.id !== claim.id)) {
      conflicts.push(`whole-matter missing counterclaim ${claim.id}`);
    }
  }
  for (const claim of params.review.claims.filter((row) => !row.isCurrent)) {
    if (params.whole.currentClaims.some((row) => row.id === claim.id)) {
      conflicts.push(`superseded claim ${claim.id} treated as current`);
    }
  }
  if (params.whole.liabilityConclusion !== null || params.whole.outcomeConclusion !== null) {
    conflicts.push("liability or outcome conclusion set");
  }
  const defenseAsCounter = params.review.defenses.some((defense) => /counterclaim/i.test(defense.label) && defense.kind !== "OTHER");
  if (defenseAsCounter) conflicts.push("counterclaim modeled only as defense label");
  return { consistent: conflicts.length === 0, conflicts };
}
