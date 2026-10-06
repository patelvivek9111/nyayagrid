import type { SuppressionDimension, SuppressionDoctrine } from "./suppression-review";

/**
 * Bibliographic handoff for authorities named in the certified corpus pass.
 * Propositions stay empty until a source span from the corpus is supplied.
 * Citation strings are copied only from the worktree reports or the corpus handoff.
 */
export type CorpusHoldingScreen = {
  caseName: string;
  citation: string | null;
  authorityId: string | null;
  courtId: string | null;
  handoffTopic: string | null;
  dimension: SuppressionDimension | null;
  doctrine: SuppressionDoctrine;
  proposition: null;
  sourceSpan: null;
  sourceSupported: false;
  treatment: "UNVERIFIED";
  issueStatus: "SOURCE_SUPPORTED" | "PENDING_SOURCE_REVIEW" | "UNKNOWN_PENDING_SOURCE";
  requiresHoldingReview: boolean;
  usefulForProsecutionSuppression: "UNKNOWN_PENDING_SOURCE" | "NOT_ATTACHED";
};

const pending = (
  entry: Omit<CorpusHoldingScreen, "proposition" | "sourceSpan" | "sourceSupported" | "treatment" | "usefulForProsecutionSuppression">,
): CorpusHoldingScreen => ({
  ...entry,
  proposition: null,
  sourceSpan: null,
  sourceSupported: false,
  treatment: "UNVERIFIED",
  usefulForProsecutionSuppression: "NOT_ATTACHED",
});

export const CORPUS_HOLDING_SCREEN: CorpusHoldingScreen[] = [
  pending({
    caseName: "Illinois v. Gates",
    citation: "462 U.S. 213",
    authorityId: "83949afa-33e2-4cec-8fe5-1e7b0138eef9",
    courtId: "us-scotus",
    handoffTopic: "probable cause / totality",
    dimension: "PROBABLE_CAUSE",
    doctrine: "FEDERAL_CONSTITUTIONAL",
    issueStatus: "PENDING_SOURCE_REVIEW",
    requiresHoldingReview: true,
  }),
  pending({
    caseName: "United States v. Leon",
    citation: "468 U.S. 897",
    authorityId: null,
    courtId: "us-scotus",
    handoffTopic: "good faith",
    dimension: "GOOD_FAITH",
    doctrine: "FEDERAL_CONSTITUTIONAL",
    issueStatus: "PENDING_SOURCE_REVIEW",
    requiresHoldingReview: true,
  }),
  pending({
    caseName: "Welsh v. Wisconsin",
    citation: null,
    authorityId: null,
    courtId: "us-scotus",
    handoffTopic: "exigency / home entry",
    dimension: "EXIGENCY",
    doctrine: "FEDERAL_CONSTITUTIONAL",
    issueStatus: "PENDING_SOURCE_REVIEW",
    requiresHoldingReview: true,
  }),
  pending({
    caseName: "Hudson v. Michigan",
    citation: null,
    authorityId: null,
    courtId: "us-scotus",
    handoffTopic: "knock-and-announce / exclusionary remedy",
    dimension: "EXECUTION",
    doctrine: "FEDERAL_CONSTITUTIONAL",
    issueStatus: "PENDING_SOURCE_REVIEW",
    requiresHoldingReview: true,
  }),
  pending({
    caseName: "Davis v. United States",
    citation: "564 U.S. 229",
    authorityId: "e67d1763-da45-4c07-b2e8-625309542a1f",
    courtId: "us-scotus",
    handoffTopic: "good-faith reliance on binding precedent",
    dimension: "GOOD_FAITH",
    doctrine: "FEDERAL_CONSTITUTIONAL",
    issueStatus: "PENDING_SOURCE_REVIEW",
    requiresHoldingReview: true,
  }),
  pending({
    caseName: "Kentucky v. King",
    citation: null,
    authorityId: null,
    courtId: "us-scotus",
    handoffTopic: "exigency",
    dimension: "EXIGENCY",
    doctrine: "FEDERAL_CONSTITUTIONAL",
    issueStatus: "PENDING_SOURCE_REVIEW",
    requiresHoldingReview: true,
  }),
  pending({
    caseName: "Pennsylvania Board of Probation & Parole v. Scott",
    citation: null,
    authorityId: null,
    courtId: "us-scotus",
    handoffTopic: "exclusionary-rule context",
    dimension: null,
    doctrine: "FEDERAL_CONSTITUTIONAL",
    issueStatus: "PENDING_SOURCE_REVIEW",
    requiresHoldingReview: true,
  }),
  ...["Fuentes", "Cronic", "Walder", "Beck", "Henry"].map((caseName) =>
    pending({
      caseName,
      citation: null,
      authorityId: null,
      courtId: "us-scotus",
      handoffTopic: null,
      dimension: null,
      doctrine: "UNKNOWN",
      issueStatus: "UNKNOWN_PENDING_SOURCE",
      requiresHoldingReview: true,
    }),
  ),
  ...["United States v. Tracey", "United States v. Katzin", "United States v. Vasquez-Algarin", "United States v. Wright"].map(
    (caseName) =>
      pending({
        caseName,
        citation: null,
        authorityId: null,
        courtId: "us-ca-3",
        handoffTopic: null,
        dimension: null,
        doctrine: "FEDERAL_CONSTITUTIONAL",
        issueStatus: "PENDING_SOURCE_REVIEW",
        requiresHoldingReview: true,
      }),
  ),
  pending({
    caseName: "In re Search Warrant No. 16-960-M-1 to Google",
    citation: "275 F.Supp.3d 605",
    authorityId: null,
    courtId: "us-d-pa-ed",
    handoffTopic: null,
    dimension: null,
    doctrine: "FEDERAL_CONSTITUTIONAL",
    issueStatus: "PENDING_SOURCE_REVIEW",
    requiresHoldingReview: true,
  }),
  pending({
    caseName: "In re Search Warrant No. 16-960-M-01 to Google",
    citation: "232 F.Supp.3d 708",
    authorityId: null,
    courtId: "us-d-pa-ed",
    handoffTopic: null,
    dimension: null,
    doctrine: "FEDERAL_CONSTITUTIONAL",
    issueStatus: "PENDING_SOURCE_REVIEW",
    requiresHoldingReview: true,
  }),
  pending({
    caseName: "United States v. Mooty",
    citation: "96 F.Supp.3d 472",
    authorityId: null,
    courtId: "us-d-pa-ed",
    handoffTopic: null,
    dimension: null,
    doctrine: "FEDERAL_CONSTITUTIONAL",
    issueStatus: "PENDING_SOURCE_REVIEW",
    requiresHoldingReview: true,
  }),
  pending({
    caseName: "Bamont",
    citation: "163 F.Supp.3d 138",
    authorityId: null,
    courtId: "us-d-pa-ed",
    handoffTopic: null,
    dimension: null,
    doctrine: "FEDERAL_CONSTITUTIONAL",
    issueStatus: "PENDING_SOURCE_REVIEW",
    requiresHoldingReview: true,
  }),
  pending({
    caseName: "Lawson",
    citation: "124 F.Supp.3d 394",
    authorityId: null,
    courtId: "us-d-pa-ed",
    handoffTopic: null,
    dimension: null,
    doctrine: "FEDERAL_CONSTITUTIONAL",
    issueStatus: "PENDING_SOURCE_REVIEW",
    requiresHoldingReview: true,
  }),
  pending({
    caseName: "In re T.B.",
    citation: null,
    authorityId: null,
    courtId: null,
    handoffTopic: null,
    dimension: null,
    doctrine: "UNKNOWN",
    issueStatus: "PENDING_SOURCE_REVIEW",
    requiresHoldingReview: true,
  }),
  pending({
    caseName: "Pustilnik",
    citation: null,
    authorityId: null,
    courtId: null,
    handoffTopic: null,
    dimension: null,
    doctrine: "UNKNOWN",
    issueStatus: "PENDING_SOURCE_REVIEW",
    requiresHoldingReview: true,
  }),
  pending({
    caseName: "Ness",
    citation: "105 A.3d 1257",
    authorityId: null,
    courtId: null,
    handoffTopic: null,
    dimension: null,
    doctrine: "UNKNOWN",
    issueStatus: "PENDING_SOURCE_REVIEW",
    requiresHoldingReview: true,
  }),
  pending({
    caseName: "Grigsby",
    citation: "47 A.3d 1176",
    authorityId: null,
    courtId: null,
    handoffTopic: null,
    dimension: null,
    doctrine: "UNKNOWN",
    issueStatus: "PENDING_SOURCE_REVIEW",
    requiresHoldingReview: true,
  }),
];

export function corpusAuthoritiesAttachedToReview(): string[] {
  return CORPUS_HOLDING_SCREEN.filter((entry) => entry.sourceSupported).map((entry) => entry.caseName);
}
