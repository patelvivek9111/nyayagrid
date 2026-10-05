import { getCourtById } from "./registry";
import {
  SPLIT_CRIMINAL_HIGH_COURTS,
  hierarchyLevel,
  relateCourts,
  type CourtRelationship,
  type HierarchyLevel,
  type JurisdictionRelationship,
} from "./hierarchy";

export const AUTHORITY_STATUS_CLASSIFICATIONS = [
  "BINDING",
  "PERSUASIVE",
  "NONCONTROLLING",
  "OUT_OF_JURISDICTION",
  "UNKNOWN",
] as const;
export type AuthorityStatusClassification = (typeof AUTHORITY_STATUS_CLASSIFICATIONS)[number];

export const LEGAL_ISSUE_TYPES = [
  "FEDERAL_CONSTITUTIONAL",
  "FEDERAL_STATUTORY",
  "STATE_LAW",
  "STATE_CONSTITUTIONAL",
  "SPECIALIZED_FEDERAL",
  "UNKNOWN",
] as const;
export type LegalIssueType = (typeof LEGAL_ISSUE_TYPES)[number];

export const ABSTENTION_CODES = [
  "UNKNOWN",
  "INSUFFICIENT_CONTEXT",
  "INSUFFICIENT_AUTHORITY",
  "SOURCE_MISSING",
  "JURISDICTION_UNKNOWN",
  "TREATMENT_UNVERIFIED",
] as const;
export type AbstentionCode = (typeof ABSTENTION_CODES)[number];

export const AUTHORITY_CURRENTNESS = ["unknown", "current", "historical", "superseded"] as const;
export type AuthorityCurrentness = (typeof AUTHORITY_CURRENTNESS)[number];

export type AuthorityStatusConfidence = "high" | "medium" | "low";

export type AuthorityStatusInput = {
  questionJurisdiction?: string | null;
  forumCourtId?: string | null;
  issueType?: LegalIssueType | null;
  /** criminal | civil matters for states with a separate criminal high court. */
  subjectMatter?: "criminal" | "civil" | "general" | null;
  authorityCourtId?: string | null;
  authorityType?: string | null;
  authorityJurisdiction?: string | null;
  authorityDate?: string | null;
  asOfDate?: string | null;
  currentness?: AuthorityCurrentness | null;
  forumAppellateDistrictId?: string | null;
  authorityAppellateDistrictId?: string | null;
  sourceMetadata?: Record<string, unknown> | null;
};

export type AuthorityStatusExplanation = {
  classification: AuthorityStatusClassification;
  reasonCode: string;
  explanation: string;
  courtRelationship: CourtRelationship;
  jurisdictionRelationship: JurisdictionRelationship;
  forumLevel: HierarchyLevel;
  authorityLevel: HierarchyLevel;
  currentnessConsideration: string;
  confidence: AuthorityStatusConfidence;
  abstention: AbstentionCode | null;
  sourceMetadata: Record<string, unknown>;
};

function normJurisdiction(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (/^(us|usa|federal|united states)$/i.test(raw)) return "US";
  if (/^[a-z]{2}$/i.test(raw)) return raw.toUpperCase();
  return raw.toUpperCase();
}

function result(
  partial: Omit<AuthorityStatusExplanation, "sourceMetadata" | "currentnessConsideration"> & {
    currentnessConsideration?: string;
    sourceMetadata?: Record<string, unknown>;
  },
  input: AuthorityStatusInput,
  relation: ReturnType<typeof relateCourts>,
): AuthorityStatusExplanation {
  const currentness = input.currentness ?? "unknown";
  return {
    ...partial,
    currentnessConsideration:
      partial.currentnessConsideration ??
      (currentness === "unknown"
        ? "Currentness is unknown. Classification does not treat the authority as overruled or superseded."
        : currentness === "superseded"
          ? "Source metadata marks this authority superseded."
          : currentness === "historical"
            ? "Authority is marked historical. Confirm the rule still applies before relying on it."
            : "Source metadata marks this authority current. That is not a citator determination."),
    sourceMetadata: {
      questionJurisdiction: normJurisdiction(input.questionJurisdiction),
      forumCourtId: input.forumCourtId ?? null,
      authorityCourtId: input.authorityCourtId ?? null,
      issueType: input.issueType ?? null,
      subjectMatter: input.subjectMatter ?? null,
      authorityDate: input.authorityDate ?? null,
      currentness,
      forumLevel: relation.forumLevel,
      authorityLevel: relation.authorityLevel,
      ...(input.sourceMetadata ?? {}),
      ...(partial.sourceMetadata ?? {}),
    },
  };
}

function unknown(
  input: AuthorityStatusInput,
  relation: ReturnType<typeof relateCourts>,
  reasonCode: string,
  explanation: string,
  abstention: AbstentionCode,
): AuthorityStatusExplanation {
  return result(
    {
      classification: "UNKNOWN",
      reasonCode,
      explanation,
      courtRelationship: relation.courtRelationship,
      jurisdictionRelationship: relation.jurisdictionRelationship,
      forumLevel: relation.forumLevel,
      authorityLevel: relation.authorityLevel,
      confidence: "low",
      abstention,
    },
    input,
    relation,
  );
}

function isFederalIssue(issue: LegalIssueType): boolean {
  return issue === "FEDERAL_CONSTITUTIONAL" || issue === "FEDERAL_STATUTORY";
}

function isStateIssue(issue: LegalIssueType): boolean {
  return issue === "STATE_LAW" || issue === "STATE_CONSTITUTIONAL";
}

/**
 * Deterministic binding / persuasive classification.
 * Higher-court rank alone is not binding. Missing context returns UNKNOWN.
 * The Phase 6S `classifyAuthorityRelationship` helper remains for coarse labels.
 */
export function evaluateAuthorityStatus(input: AuthorityStatusInput): AuthorityStatusExplanation {
  const relation = relateCourts({
    forumCourtId: input.forumCourtId,
    authorityCourtId: input.authorityCourtId,
    forumAppellateDistrictId: input.forumAppellateDistrictId,
    authorityAppellateDistrictId: input.authorityAppellateDistrictId,
  });
  const issue = input.issueType ?? "UNKNOWN";
  const question = normJurisdiction(input.questionJurisdiction);
  const authorityType = (input.authorityType ?? "case").toLowerCase();
  const enacted = ["statute", "regulation", "constitution", "rule", "constitutional"].includes(
    authorityType,
  );

  if (issue === "UNKNOWN") {
    return unknown(
      input,
      relation,
      "ISSUE_TYPE_UNKNOWN",
      "The legal issue type is unknown, so authority weight is not classified.",
      "INSUFFICIENT_CONTEXT",
    );
  }
  if (!question) {
    return unknown(
      input,
      relation,
      "JURISDICTION_UNKNOWN",
      "The question jurisdiction was not provided.",
      "JURISDICTION_UNKNOWN",
    );
  }
  if (!input.forumCourtId || !getCourtById(input.forumCourtId)) {
    return unknown(
      input,
      relation,
      "FORUM_COURT_MISSING",
      "The court where the matter is pending is missing or not in the court registry.",
      "INSUFFICIENT_CONTEXT",
    );
  }

  if ((input.currentness ?? "unknown") === "superseded") {
    return result(
      {
        classification: "NONCONTROLLING",
        reasonCode: "SUPERSEDED_AUTHORITY",
        explanation: "Source metadata marks this authority superseded, so it is not treated as binding.",
        courtRelationship: relation.courtRelationship,
        jurisdictionRelationship: relation.jurisdictionRelationship,
        forumLevel: relation.forumLevel,
        authorityLevel: relation.authorityLevel,
        confidence: "medium",
        abstention: null,
        currentnessConsideration: "Superseded metadata blocks a binding classification.",
      },
      input,
      relation,
    );
  }

  if (input.asOfDate && input.authorityDate && input.authorityDate > input.asOfDate) {
    return unknown(
      input,
      relation,
      "AUTHORITY_AFTER_AS_OF",
      "The authority date is after the question's as-of date.",
      "INSUFFICIENT_CONTEXT",
    );
  }

  if (enacted) {
    return classifyEnacted(input, relation, question, issue);
  }

  if (!input.authorityCourtId || !getCourtById(input.authorityCourtId)) {
    return unknown(
      input,
      relation,
      "MISSING_COURT_METADATA",
      "The authority has no usable court metadata.",
      "INSUFFICIENT_AUTHORITY",
    );
  }

  if (issue === "SPECIALIZED_FEDERAL") return classifySpecialized(input, relation);
  if (isFederalIssue(issue)) return classifyFederal(input, relation);
  return classifyState(input, relation, question);
}

function classifyEnacted(
  input: AuthorityStatusInput,
  relation: ReturnType<typeof relateCourts>,
  question: string,
  issue: LegalIssueType,
): AuthorityStatusExplanation {
  const authorityJurisdiction = normJurisdiction(input.authorityJurisdiction);
  if (!authorityJurisdiction) {
    return unknown(
      input,
      relation,
      "ENACTED_JURISDICTION_MISSING",
      "Enacted authority is missing jurisdiction metadata.",
      "INSUFFICIENT_AUTHORITY",
    );
  }
  const federalQuestion = isFederalIssue(issue) || issue === "SPECIALIZED_FEDERAL";
  const matches = federalQuestion
    ? authorityJurisdiction === "US"
    : authorityJurisdiction === question;
  if (!matches) {
    return result(
      {
        classification: "OUT_OF_JURISDICTION",
        reasonCode: "ENACTED_LAW_OTHER_JURISDICTION",
        explanation: `Enacted law from ${authorityJurisdiction} does not govern this ${question} issue.`,
        courtRelationship: relation.courtRelationship,
        jurisdictionRelationship: "FOREIGN",
        forumLevel: relation.forumLevel,
        authorityLevel: relation.authorityLevel,
        confidence: "high",
        abstention: null,
      },
      input,
      relation,
    );
  }
  return result(
    {
      classification: "BINDING",
      reasonCode: "ENACTED_LAW_MATCH",
      explanation:
        "Enacted law matches the question jurisdiction. This is not a determination that the provision applies to the facts.",
      courtRelationship: relation.courtRelationship,
      jurisdictionRelationship: "SAME",
      forumLevel: relation.forumLevel,
      authorityLevel: relation.authorityLevel,
      confidence: "medium",
      abstention: null,
    },
    input,
    relation,
  );
}

function classifySpecialized(
  input: AuthorityStatusInput,
  relation: ReturnType<typeof relateCourts>,
): AuthorityStatusExplanation {
  if (relation.authorityLevel === "SUPREME_COURT_US") {
    return binding(input, relation, "SCOTUS_SPECIALIZED", "The Supreme Court binds specialized federal questions.");
  }
  if (relation.authorityLevel === "SPECIALIZED_FEDERAL") {
    return binding(
      input,
      relation,
      "SPECIALIZED_FEDERAL_SUBJECT_MATTER",
      "The Federal Circuit's subject-matter jurisdiction covers this specialized federal question nationwide.",
    );
  }
  return persuasive(
    input,
    relation,
    "REGIONAL_COURT_ON_SPECIALIZED_QUESTION",
    "A regional federal court is persuasive, not controlling, on a Federal Circuit subject-matter question.",
  );
}

function classifyFederal(
  input: AuthorityStatusInput,
  relation: ReturnType<typeof relateCourts>,
): AuthorityStatusExplanation {
  const forum = getCourtById(input.forumCourtId);
  const authority = getCourtById(input.authorityCourtId);
  if (!forum || !authority) {
    return unknown(input, relation, "MISSING_COURT_METADATA", "Court metadata is incomplete.", "INSUFFICIENT_AUTHORITY");
  }

  if (relation.authorityLevel === "SUPREME_COURT_US") {
    return binding(
      input,
      relation,
      "SCOTUS_FEDERAL_QUESTION",
      "The Supreme Court of the United States binds federal questions in federal and state courts.",
    );
  }

  if (relation.authorityLevel === "SPECIALIZED_FEDERAL") {
    return persuasive(
      input,
      relation,
      "SPECIALIZED_COURT_NOT_TERRITORIAL",
      "The Federal Circuit is not the territorial court of appeals for a general federal question.",
    );
  }

  if (relation.authorityLevel === "FEDERAL_CIRCUIT") {
    if (hierarchyLevel(forum) === "STATE_SUPREME" || hierarchyLevel(forum) === "STATE_INTERMEDIATE" || hierarchyLevel(forum) === "STATE_TRIAL") {
      return persuasive(
        input,
        relation,
        "CIRCUIT_PERSUASIVE_IN_STATE_COURT",
        "A regional court of appeals does not bind state courts. Only the Supreme Court controls the federal question there.",
      );
    }
    if (
      forum.federalCircuit &&
      authority.federalCircuit &&
      forum.federalCircuit === authority.federalCircuit
    ) {
      return binding(
        input,
        relation,
        "CIRCUIT_TERRITORIAL_BINDING",
        `The ${authority.federalCircuit} Circuit is the territorial court of appeals for this federal forum.`,
      );
    }
    if (forum.federalCircuit && authority.federalCircuit) {
      return persuasive(
        input,
        relation,
        "SISTER_CIRCUIT",
        "A court of appeals outside the forum circuit is persuasive on a federal question.",
      );
    }
    return unknown(
      input,
      relation,
      "CIRCUIT_METADATA_INCOMPLETE",
      "Federal circuit metadata is incomplete.",
      "INSUFFICIENT_CONTEXT",
    );
  }

  if (relation.authorityLevel === "FEDERAL_DISTRICT") {
    if (forum.id === authority.id) {
      return persuasive(
        input,
        relation,
        "SAME_DISTRICT_NOT_PRECEDENT",
        "A federal district court decision is not binding precedent, including in the same district.",
      );
    }
    return persuasive(
      input,
      relation,
      "SISTER_DISTRICT",
      "Another federal district court is persuasive, not controlling.",
    );
  }

  if (relation.authorityLevel === "STATE_SUPREME" || relation.authorityLevel === "STATE_INTERMEDIATE" || relation.authorityLevel === "STATE_TRIAL") {
    return persuasive(
      input,
      relation,
      "STATE_COURT_ON_FEDERAL_QUESTION",
      "A state-court decision on a federal question is persuasive. It does not control a federal court.",
    );
  }

  return unknown(input, relation, "UNCLASSIFIED_FEDERAL", "Federal authority could not be classified.", "UNKNOWN");
}

function classifyState(
  input: AuthorityStatusInput,
  relation: ReturnType<typeof relateCourts>,
  question: string,
): AuthorityStatusExplanation {
  if (question === "US") {
    return unknown(
      input,
      relation,
      "STATE_LAW_JURISDICTION_MISSING",
      "A state-law issue needs the state whose law governs. 'US' is not enough.",
      "INSUFFICIENT_CONTEXT",
    );
  }

  const forum = getCourtById(input.forumCourtId);
  const authority = getCourtById(input.authorityCourtId);
  if (!forum || !authority) {
    return unknown(input, relation, "MISSING_COURT_METADATA", "Court metadata is incomplete.", "INSUFFICIENT_AUTHORITY");
  }

  const forumLevel = hierarchyLevel(forum);
  const federalForum =
    forumLevel === "FEDERAL_DISTRICT" ||
    forumLevel === "FEDERAL_CIRCUIT" ||
    forumLevel === "SUPREME_COURT_US" ||
    forumLevel === "SPECIALIZED_FEDERAL";

  if (relation.authorityLevel === "SUPREME_COURT_US") {
    return noncontrolling(
      input,
      relation,
      "SCOTUS_DOES_NOT_CONTROL_STATE_LAW",
      "The Supreme Court does not supply controlling state-law precedent for a pure state-law issue.",
    );
  }

  if (
    relation.authorityLevel === "FEDERAL_CIRCUIT" ||
    relation.authorityLevel === "SPECIALIZED_FEDERAL" ||
    relation.authorityLevel === "FEDERAL_DISTRICT"
  ) {
    return noncontrolling(
      input,
      relation,
      federalForum ? "ERIE_FEDERAL_PREDICTION_NOT_STATE_LAW" : "FEDERAL_COURT_NOT_STATE_LAW",
      "A federal-court decision does not control state law. Under Erie it may predict state law, and that prediction is not itself the state's rule.",
    );
  }

  if (authority.state && authority.state !== question) {
    return result(
      {
        classification: "OUT_OF_JURISDICTION",
        reasonCode: "SISTER_STATE",
        explanation: `${authority.state} authority does not control ${question} state law.`,
        courtRelationship: "FOREIGN",
        jurisdictionRelationship: "FOREIGN",
        forumLevel: relation.forumLevel,
        authorityLevel: relation.authorityLevel,
        confidence: "high",
        abstention: null,
      },
      input,
      relation,
    );
  }

  if (relation.authorityLevel === "STATE_SUPREME") {
    const split = SPLIT_CRIMINAL_HIGH_COURTS[question];
    if (split) {
      const criminalHigh = authority.id === split;
      const generalHigh = authority.id === `st-${question.toLowerCase()}-high`;
      if (!input.subjectMatter) {
        return unknown(
          input,
          relation,
          "SPLIT_HIGH_COURT_SUBJECT_MISSING",
          `${question} has a separate criminal court of last resort. Subject matter is required before either high court is treated as binding.`,
          "INSUFFICIENT_CONTEXT",
        );
      }
      if (input.subjectMatter === "criminal" && criminalHigh) {
        return binding(input, relation, "STATE_CRIMINAL_HIGH_COURT", `${question} criminal high court controls this state's criminal law.`);
      }
      if (input.subjectMatter === "criminal" && generalHigh) {
        return noncontrolling(
          input,
          relation,
          "CIVIL_HIGH_COURT_NOT_CRIMINAL",
          `${question}'s general supreme court is not the criminal court of last resort.`,
        );
      }
      if (input.subjectMatter !== "criminal" && generalHigh) {
        return binding(input, relation, "STATE_HIGH_COURT", `${question} court of last resort controls this state-law issue.`);
      }
      if (input.subjectMatter !== "criminal" && criminalHigh) {
        return noncontrolling(
          input,
          relation,
          "CRIMINAL_HIGH_COURT_NOT_CIVIL",
          `${question}'s criminal high court does not control this civil state-law issue.`,
        );
      }
    }
    return binding(
      input,
      relation,
      federalForum ? "ERIE_STATE_HIGH_COURT" : "STATE_HIGH_COURT",
      federalForum
        ? `${question} court of last resort binds a federal court applying that state's law.`
        : `${question} court of last resort controls this state-law issue.`,
    );
  }

  if (relation.authorityLevel === "STATE_INTERMEDIATE") {
    const districtsDiffer =
      Boolean(input.forumAppellateDistrictId) &&
      Boolean(input.authorityAppellateDistrictId) &&
      input.forumAppellateDistrictId !== input.authorityAppellateDistrictId;
    if (districtsDiffer) {
      return noncontrolling(
        input,
        relation,
        "INTERMEDIATE_OUTSIDE_DISTRICT",
        "This intermediate court sits in a different appellate district from the forum. It is not controlling.",
      );
    }
    if (federalForum) {
      return persuasive(
        input,
        relation,
        "ERIE_INTERMEDIATE_PERSUASIVE",
        "A state's intermediate court is persuasive when a federal court applies that state's law. The state high court controls.",
      );
    }
    if (forumLevel === "STATE_TRIAL") {
      return binding(
        input,
        relation,
        "INTERMEDIATE_BINDS_TRIAL",
        "The state's intermediate appellate court binds this trial court when the appellate district matches or no district split is identified.",
      );
    }
    if (forumLevel === "STATE_SUPREME") {
      return noncontrolling(input, relation, "INFERIOR_STATE_COURT", "An intermediate court does not control the state high court.");
    }
    return persuasive(
      input,
      relation,
      "HORIZONTAL_INTERMEDIATE",
      "Same-level intermediate authority is persuasive, not automatically binding.",
    );
  }

  if (relation.authorityLevel === "STATE_TRIAL") {
    return persuasive(
      input,
      relation,
      "TRIAL_COURT_NOT_PRECEDENT",
      "A state trial court decision is not binding precedent.",
    );
  }

  return unknown(input, relation, "UNCLASSIFIED_STATE", "State authority could not be classified.", "UNKNOWN");
}

function binding(
  input: AuthorityStatusInput,
  relation: ReturnType<typeof relateCourts>,
  reasonCode: string,
  explanation: string,
): AuthorityStatusExplanation {
  return result(
    {
      classification: "BINDING",
      reasonCode,
      explanation,
      courtRelationship: relation.courtRelationship,
      jurisdictionRelationship: relation.jurisdictionRelationship,
      forumLevel: relation.forumLevel,
      authorityLevel: relation.authorityLevel,
      confidence: "high",
      abstention: null,
    },
    input,
    relation,
  );
}

function persuasive(
  input: AuthorityStatusInput,
  relation: ReturnType<typeof relateCourts>,
  reasonCode: string,
  explanation: string,
): AuthorityStatusExplanation {
  return result(
    {
      classification: "PERSUASIVE",
      reasonCode,
      explanation,
      courtRelationship: relation.courtRelationship,
      jurisdictionRelationship: relation.jurisdictionRelationship,
      forumLevel: relation.forumLevel,
      authorityLevel: relation.authorityLevel,
      confidence: "medium",
      abstention: null,
    },
    input,
    relation,
  );
}

function noncontrolling(
  input: AuthorityStatusInput,
  relation: ReturnType<typeof relateCourts>,
  reasonCode: string,
  explanation: string,
): AuthorityStatusExplanation {
  return result(
    {
      classification: "NONCONTROLLING",
      reasonCode,
      explanation,
      courtRelationship: relation.courtRelationship,
      jurisdictionRelationship: relation.jurisdictionRelationship,
      forumLevel: relation.forumLevel,
      authorityLevel: relation.authorityLevel,
      confidence: "medium",
      abstention: null,
    },
    input,
    relation,
  );
}
