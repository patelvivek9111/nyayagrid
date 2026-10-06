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
  {
    id: "D2-PR-WARRANT-01",
    workspace: "prosecution",
    title: "Multi-theory warrant review",
    scenario:
      "A synthetic EDPA search warrant has separate probable-cause, nexus, staleness, good-faith, and execution questions, with synthetic source spans attached only to the matching question.",
    expected: [
      "probable cause, nexus, staleness, good faith, and execution stay separate",
      "each synthetic authority stays on its own issue",
      "missing facts differ by issue",
      "no suppression, validity, or guilt conclusion",
    ],
    sources: ["SYNTHETIC-SCOTUS-PC-001", "SYNTHETIC-SCOTUS-GF-001", "doc-phone"],
    rubric: ["ISSUE_SEPARATION", "AUTHORITY_SCOPE", "MISSING_FACTS", "NO_SUPPRESSION_DECISION"],
    failureSeverity: "CRITICAL",
  },
  {
    id: "D2-PR-WARRANT-02",
    workspace: "prosecution",
    title: "Multiple warrants and defendant scope",
    scenario:
      "One warrant seizes defendant-specific evidence and another seizes joint evidence, with different dates and timeline events.",
    expected: [
      "warrant issues do not share evidence",
      "defendant-specific review is hidden from the other defendant",
      "timeline events stay on the matching warrant",
    ],
    sources: ["doc-ada", "doc-scene"],
    rubric: ["MULTI_WARRANT", "DEFENDANT_SCOPE", "TIMELINE_LINK"],
    failureSeverity: "CRITICAL",
  },
  {
    id: "D2-PR-MIRANDA-01",
    workspace: "prosecution",
    title: "Miranda timing review",
    scenario: "A synthetic interview is on the timeline and Miranda timing is not recorded.",
    expected: ["Miranda issue stays separate", "missing timing is explicit", "no suppression decision"],
    sources: ["doc-interview"],
    rubric: ["MIRANDA_SEPARATION", "MISSING_FACTS", "NO_SUPPRESSION_DECISION"],
    failureSeverity: "CRITICAL",
  },
  {
    id: "D2-ASK-SUPPRESS-01",
    workspace: "prosecution",
    title: "Ask Nyaya non-deciding suppression answer",
    scenario: "Ask Nyaya is given the multi-theory warrant review and must answer in separated fact and authority sections.",
    expected: [
      "known, disputed, and missing facts stay labeled",
      "binding authority is limited to a source-supported proposition",
      "no suppression, validity, or guilt conclusion",
    ],
    sources: ["SYNTHETIC-SCOTUS-PC-001"],
    rubric: ["STRUCTURED_ANSWER", "NO_SUPPRESSION_DECISION", "TREATMENT_UNVERIFIED"],
    failureSeverity: "CRITICAL",
  },
  {
    id: "D2-AUTH-HIER-01",
    workspace: "prosecution",
    title: "Suppression authority hierarchy",
    scenario:
      "A synthetic federal issue in EDPA and a separate Pennsylvania constitutional issue are classified with the certified hierarchy engine.",
    expected: [
      "SCOTUS and the Third Circuit bind the federal issue",
      "EDPA is persuasive",
      "Pennsylvania high and intermediate courts bind the state constitutional issue",
      "an unspecified Pennsylvania forum does not collapse the doctrines",
    ],
    sources: ["SYNTHETIC-SCOTUS-H-001", "SYNTHETIC-CA3-H-001", "SYNTHETIC-EDPA-H-001", "SYNTHETIC-PA-H-001"],
    rubric: ["AUTHORITY_HIERARCHY", "DOCTRINE_SEPARATION"],
    failureSeverity: "CRITICAL",
  },
  {
    id: "D2-MISSING-FACTS-01",
    workspace: "prosecution",
    title: "Missing affidavit support",
    scenario: "A warrant record has no affidavit, scope, observation date, or execution inventory.",
    expected: ["affidavit unavailable is explicit", "known facts stay empty", "no legal standard is invented"],
    sources: [],
    rubric: ["MISSING_FACTS", "NO_INVENTED_STANDARD"],
    failureSeverity: "CRITICAL",
  },
];
