/** Week 5 benchmark taxonomy — full workflow certification categories. */

export const WEEK5_DATASET_ID = "week5-e2e-workflow-cert";
export const WEEK5_DATASET_VERSION = "week5-2026-10-05";
export const WEEK5_GRADER_VERSION = "week5-grade-2026-10-05";

export const WEEK5_CATEGORIES = [
  "LAW_FIRM_FULL_MATTER",
  "PROSECUTION_FULL_CASE",
  "LEGAL_RESEARCH",
  "AUTHORITY_HIERARCHY",
  "LEGAL_STANDARD",
  "EVIDENCE_GROUNDING",
  "CONTRADICTION",
  "MISSING_EVIDENCE",
  "LAW_TO_FACT",
  "DRAFTING",
  "CITATION_CORRECTNESS",
  "TREATMENT",
  "DISCLOSURE_REVIEW",
  "SUPPRESSION",
  "WARRANT",
  "WITNESS",
  "DISCOVERY",
  "CASE_MANAGEMENT",
  "SECURITY",
  "ABSTENTION",
  "COVERAGE_WARNING",
  "PROMPT_INJECTION",
  "CHAIN_OF_CUSTODY",
  "TIMELINE",
  "INVESTIGATION",
  "ASK_NYAYA",
] as const;

export type Week5Category = (typeof WEEK5_CATEGORIES)[number];

export const WEEK5_RUBRIC_DIMENSIONS = [
  "ISSUE_SPOTTING",
  "FACT_RECALL",
  "EVIDENCE_RETRIEVAL",
  "CONTRARY_EVIDENCE",
  "LEGAL_RETRIEVAL",
  "AUTHORITY_HIERARCHY",
  "LEGAL_STANDARD",
  "LAW_TO_FACT_APPLICATION",
  "MISSING_EVIDENCE",
  "WEAKNESS_ANALYSIS",
  "SOURCE_TRACEABILITY",
  "CITATION_CORRECTNESS",
  "ABSTENTION",
  "COMPLETENESS",
  "NO_HALLUCINATION",
] as const;

export type Week5RubricDimension = (typeof WEEK5_RUBRIC_DIMENSIONS)[number];

export const WEEK5_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export type Week5Severity = (typeof WEEK5_SEVERITIES)[number];

export const WEEK5_CRITICAL_FAILURES = [
  "FABRICATED_AUTHORITY",
  "FABRICATED_STATUTE",
  "FABRICATED_QUOTE",
  "FABRICATED_EVIDENCE",
  "FABRICATED_WITNESS_STATEMENT",
  "FABRICATED_DOCUMENT",
  "WRONG_CONTROLLING_AUTHORITY",
  "INCORRECT_BINDING_CLASSIFICATION",
  "UNSUPPORTED_DECISIVE_CONCLUSION",
  "CROSS_MATTER_LEAKAGE",
  "CROSS_TENANT_LEAKAGE",
  "GUILT_CONCLUSION",
  "AUTOMATED_CHARGING_DECISION",
  "AUTOMATED_FINAL_DISCLOSURE",
  "UNSUPPORTED_TREATMENT_CLAIM",
] as const;

export type Week5CriticalFailure = (typeof WEEK5_CRITICAL_FAILURES)[number];

export const WEEK5_ROOT_CAUSES = [
  "CORPUS_MISSING",
  "RETRIEVAL_FAILURE",
  "RANKING_FAILURE",
  "AUTHORITY_STATUS_FAILURE",
  "STANDARD_EXTRACTION_FAILURE",
  "EVIDENCE_RETRIEVAL_FAILURE",
  "CONTRADICTION_FAILURE",
  "APPLICATION_FAILURE",
  "HALLUCINATION",
  "CITATION_FAILURE",
  "CURRENTNESS_FAILURE",
  "TREATMENT_FAILURE",
  "WORKFLOW_FAILURE",
  "PERMISSION_FAILURE",
  "UI_FAILURE",
  "OTHER",
] as const;

export type Week5RootCause = (typeof WEEK5_ROOT_CAUSES)[number];

export const WEEK5_LANES = ["development", "certification", "hidden_holdout"] as const;
export type Week5Lane = (typeof WEEK5_LANES)[number];

export const WEEK5_AUDIT = {
  EXISTING: [
    "benchmarks/nyaya-bench FW1 v4-workflow catalog/graders/persist",
    "packages/intelligence/src/week4 LawEvidenceBundle + fixtures A-E",
    "askNyayaAboutMatter week4StructuredContext injection",
    "failure-classes.ts + dogfood RUBRIC",
    "e2e professional/prosecution/professor/guide/security",
  ],
  EXTEND: [
    "FW1 critical classes for prosecution/guilt/disclosure",
    "Ask Nyaya structured-context assertion (Week 4 P1)",
    "week4 fixture runners as deterministic answer substrate",
  ],
  NEW: [
    "datasets/week5 taxonomy + assignment catalog + holdouts",
    "graders/week5-grade + week5-auditors",
    "runner/week5 deterministic certification",
  ],
  VALIDATE: [
    "npm run test -w @nyayagrid/nyaya-bench -- week5",
    "npm run bench:week5 -w @nyayagrid/nyaya-bench",
    "e2e prosecution + case-intelligence + professor + guide + security",
  ],
} as const;
