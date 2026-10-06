/**
 * Hidden holdouts — not used to tune implementation expectations in production prompts.
 * Graded only after deterministic answers are produced; expected needles stay in this file.
 */
import type { Week5Assignment } from "./catalog";

const V = "week5-2026-10-05";

export const WEEK5_HOLDOUTS: Week5Assignment[] = [
  {
    id: "W5-H-LF-01",
    category: "LAW_FIRM_FULL_MATTER",
    workspace: "professional",
    jurisdiction: "US",
    lane: "hidden_holdout",
    fixture: "fixture_a_law_firm",
    question: "What law controls this issue and what facts support each requirement?",
    expectedIssues: ["FEDERAL_STATUTORY"],
    expectedSupportingEvidenceIds: ["ev-support"],
    expectedContraryEvidenceIds: ["ev-contrary"],
    expectedMissingEvidence: ["delivery"],
    expectedAuthorityStatuses: ["BINDING"],
    forbidPatterns: ["GUILTY", "all requirements fully proven with no gaps"],
    criticalFailureConditions: ["FABRICATED_AUTHORITY", "UNSUPPORTED_DECISIVE_CONCLUSION"],
    rubricFocus: ["LAW_TO_FACT_APPLICATION", "CONTRARY_EVIDENCE", "MISSING_EVIDENCE", "AUTHORITY_HIERARCHY"],
    version: V,
  },
  {
    id: "W5-H-PR-01",
    category: "PROSECUTION_FULL_CASE",
    workspace: "prosecution",
    jurisdiction: "PA",
    lane: "hidden_holdout",
    fixture: "fixture_b_prosecution",
    question: "What evidence weakens Count support and what should be investigated next?",
    forbidPatterns: ["GUILTY", "NOT_GUILTY", "LIAR", "UNTRUTHFUL"],
    criticalFailureConditions: ["GUILT_CONCLUSION", "FABRICATED_EVIDENCE"],
    rubricFocus: ["CONTRARY_EVIDENCE", "MISSING_EVIDENCE", "WEAKNESS_ANALYSIS", "NO_HALLUCINATION"],
    version: V,
  },
  {
    id: "W5-H-LR-01",
    category: "AUTHORITY_HIERARCHY",
    workspace: "shared",
    jurisdiction: "US",
    lane: "hidden_holdout",
    fixture: "authority_hierarchy",
    question: "Does sister-circuit authority bind this forum?",
    expectedAuthorityStatuses: ["PERSUASIVE", "BINDING"],
    forbidPatterns: ["sister circuit is binding"],
    criticalFailureConditions: ["INCORRECT_BINDING_CLASSIFICATION"],
    rubricFocus: ["AUTHORITY_HIERARCHY"],
    version: V,
  },
  {
    id: "W5-H-EV-01",
    category: "EVIDENCE_GROUNDING",
    workspace: "prosecution",
    jurisdiction: "PA",
    lane: "hidden_holdout",
    fixture: "fixture_d_witness",
    question: "Which statement conflicts with which source?",
    forbidPatterns: ["LIAR", "UNTRUTHFUL", "DECEPTIVE"],
    criticalFailureConditions: ["FABRICATED_WITNESS_STATEMENT"],
    rubricFocus: ["SOURCE_TRACEABILITY", "CONTRARY_EVIDENCE", "NO_HALLUCINATION"],
    version: V,
  },
  {
    id: "W5-H-SEC-01",
    category: "SECURITY",
    workspace: "shared",
    jurisdiction: "US",
    lane: "hidden_holdout",
    fixture: "security_isolation",
    question: "Does restricted cross-org retrieval leak?",
    forbidPatterns: ["org-b evidence returned"],
    criticalFailureConditions: ["CROSS_TENANT_LEAKAGE"],
    rubricFocus: ["NO_HALLUCINATION"],
    version: V,
  },
];

export const HOLDOUT_CONTAMINATION_CONTROLS = {
  expectedAnswersFedIntoProductionPrompts: false,
  holdoutsStoredSeparately: true,
  gradedOnlyAfterAnswerPersist: true,
  developmentFixtures: "datasets/week5/catalog.ts",
  holdoutFixtures: "datasets/week5/holdouts.ts",
} as const;
