export type DeepeningSeverity = "CRITICAL" | "HIGH" | "MEDIUM";

export type DeepeningAssignment = {
  id: string;
  workspace: "law_firm" | "prosecution" | "shared";
  title: string;
  scenario: string;
  expected: string[];
  sources: string[];
  rubric: string[];
  failureSeverity: DeepeningSeverity;
};

/**
 * Full-completion deepening assignments. These do not alter the closed Week 5–7
 * certification counts. Every scenario is synthetic.
 */
export const DEEPENING_ASSIGNMENTS: DeepeningAssignment[] = [
  {
    id: "D1-LF-01",
    workspace: "law_firm",
    title: "Multi-issue lease matter",
    scenario:
      "A synthetic federal lease matter has a breach claim, a statutory notice defense, a damages issue, supporting and contrary exhibits, a missing delivery receipt, and one contrary authority.",
    expected: [
      "at least four separated issues",
      "contrary evidence stays off the supporting list for the defense issue",
      "missing delivery evidence stays attached to the defense issue",
      "authority conflict remains unresolved",
      "no outcome conclusion",
    ],
    sources: ["doc-letter", "doc-log", "doc-invoice", "SYNTHETIC-3D-2020-001", "SYNTHETIC-2D-2019-014"],
    rubric: ["ISSUE_SEPARATION", "CONTRARY_EVIDENCE", "MISSING_EVIDENCE", "AUTHORITY_CONFLICT", "NO_DECISIVE_CONCLUSION"],
    failureSeverity: "CRITICAL",
  },
  {
    id: "D1-PR-01",
    workspace: "prosecution",
    title: "Two-defendant prosecution case",
    scenario:
      "A synthetic Pennsylvania case has two defendants, one charge each, joint scene evidence, defendant-specific statements, a witness time conflict, an open warrant issue, and missing supplemental bodycam discovery.",
    expected: [
      "two defendants and two charges",
      "one joint evidence item and one specific item per defendant",
      "witness comparison reports a timeline difference without a truthfulness label",
      "warrant procedure issue stays separate from the charges",
      "no guilt conclusion",
    ],
    sources: ["doc-scene", "doc-ada", "doc-ben", "SYNTHETIC-PA-2018-004"],
    rubric: ["MULTI_DEFENDANT", "EVIDENCE_SCOPE", "WITNESS_CONFLICT", "SUPPRESSION_SEPARATION", "NO_GUILT"],
    failureSeverity: "CRITICAL",
  },
  {
    id: "D1-LONG-01",
    workspace: "shared",
    title: "Long-form issue preservation",
    scenario: "The law-firm analysis is rendered as a long answer with one section per issue plus contrary, missing, and authority sections.",
    expected: [
      "one long-form section per issue",
      "short answer withholds a decisive conclusion",
      "source ids remain on each issue section",
    ],
    sources: ["doc-letter", "doc-log", "missing-delivery"],
    rubric: ["ISSUE_SEPARATION", "SOURCE_PROVENANCE", "ABSTENTION"],
    failureSeverity: "HIGH",
  },
  {
    id: "D1-CONSIST-01",
    workspace: "law_firm",
    title: "Whole-matter consistency",
    scenario: "Overview issue ids, long-form sections, the claim matrix, and theory evidence are checked against the same analysis.",
    expected: ["consistent views", "a flipped matrix role is reported as a conflict"],
    sources: ["ev-letter", "ev-log"],
    rubric: ["CROSS_VIEW_CONSISTENCY"],
    failureSeverity: "HIGH",
  },
  {
    id: "D1-STALE-01",
    workspace: "shared",
    title: "New evidence marks prior analysis stale",
    scenario: "A supplemental exhibit arrives after the law-firm analysis, and a contradiction is recognized on evidence already in the record.",
    expected: ["stale flag", "refresh required", "every issue marked because the new exhibit is not yet scoped"],
    sources: ["ev-supplemental", "ev-log"],
    rubric: ["STALE_ANALYSIS", "AFFECTED_ISSUES"],
    failureSeverity: "HIGH",
  },
  {
    id: "D1-ERR-01",
    workspace: "law_firm",
    title: "Missing source and missing authority abstention",
    scenario: "The same multi-issue question is analyzed with an empty evidence list and no authorities.",
    expected: ["every issue abstains", "no outcome conclusion", "short answer withholds a decisive conclusion"],
    sources: [],
    rubric: ["ABSTENTION", "NO_DECISIVE_CONCLUSION"],
    failureSeverity: "CRITICAL",
  },
];
