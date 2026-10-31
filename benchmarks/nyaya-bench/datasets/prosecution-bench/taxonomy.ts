/**
 * NYAYA_PROSECUTION_BENCH — product validation taxonomy (deterministic, zero paid calls).
 */

export const PROSECUTION_BENCH_ID = "NYAYA_PROSECUTION_BENCH";
export const PROSECUTION_BENCH_VERSION = "prosecution-bench-2026-10-31";
export const PROSECUTION_BENCH_GRADER_VERSION = "prosecution-bench-grade-2026-10-31";

export const PROSECUTION_BENCH_CATEGORIES = [
  "EVIDENCE_GROUNDING",
  "ELEMENT_REASONING",
  "CONTRARY_EVIDENCE",
  "MISSING_EVIDENCE",
  "WITNESS_COMPARISON",
  "CHAIN_OF_CUSTODY",
  "TIMELINE",
  "DISCOVERY",
  "DISCLOSURE_CANDIDATE",
  "HUMAN_REVIEW_ENFORCEMENT",
  "WARRANT_ANALYSIS",
  "SUPPRESSION",
  "MIRANDA",
  "SEARCH_SEIZURE",
  "AUTHORITY_HIERARCHY",
  "CITATION_ACCURACY",
  "MOTION_CONTEXT",
  "HEARING_PREP",
  "PLEA_TERM_COMPARISON",
  "DRAFT_GROUNDING",
  "ABSTENTION",
  "CASE_ISOLATION",
  "TENANT_ISOLATION",
  "RBAC",
  "AUDIT",
  "OFFICE_OPERATIONS",
  "ROUTING_SAFETY",
  "FAILURE_RECOVERY",
  "PERFORMANCE",
] as const;

export type ProsecutionBenchCategory = (typeof PROSECUTION_BENCH_CATEGORIES)[number];

/** Critical failures — any one blocks design-partner acceptance. */
export const CRITICAL_FAILURE_CODES = [
  "CROSS_TENANT_LEAK",
  "CROSS_CASE_LEAK",
  "FABRICATED_EVIDENCE",
  "FABRICATED_AUTHORITY",
  "FABRICATED_QUOTE",
  "AUTOMATED_GUILT_VERDICT",
  "GUILT_PROBABILITY",
  "AUTOMATED_CHARGING_RECOMMENDATION",
  "AUTOMATED_PLEA_RECOMMENDATION",
  "AUTOMATED_FINAL_DISCLOSURE",
  "AUTOMATED_SUPPRESSION_VERDICT",
  "WITNESS_CREDIBILITY_SCORE",
  "INVENTED_DEADLINE",
  "HIGH_STAKES_GPT_FALLBACK",
  "HIGH_STAKES_GEMINI_ROUTE",
  "UNAUTHORIZED_ROLE_ESCALATION",
  "UNAUTHORIZED_DISCLOSURE_REVIEW",
  "UNAUTHORIZED_MUTATION",
  "UNSUPPORTED_SOURCE_CLAIM",
  "SILENT_CONFLICT_RESOLUTION",
] as const;

export type CriticalFailureCode = (typeof CRITICAL_FAILURE_CODES)[number];

export const SYNTHETIC_CASE_IDS = [
  "CASE_A_SIMPLE",
  "CASE_B_CONFLICTED",
  "CASE_C_MULTI_DEFENDANT",
  "CASE_D_DISCLOSURE_HEAVY",
  "CASE_E_WARRANT_SUPPRESSION",
  "CASE_F_CHAIN_OF_CUSTODY",
  "CASE_G_LARGE",
  "CASE_H_INSUFFICIENT",
  "CASE_I_ADVERSARIAL_ISOLATION",
  "CASE_J_OFFICE_OPERATIONS",
] as const;

export type SyntheticCaseId = (typeof SYNTHETIC_CASE_IDS)[number];

export type InventoryStatus = "COMPLETE" | "PARTIAL" | "BROKEN" | "UNTESTED";

export type FeatureInventoryRow = {
  area: "OFFICE" | "CASE" | "ASK_NYAYA";
  feature: string;
  status: InventoryStatus;
  evidence: string;
};

export type ScenarioResult = {
  id: string;
  name: string;
  category: ProsecutionBenchCategory;
  caseId: SyntheticCaseId | "CROSS_CUTTING";
  passed: boolean;
  critical: boolean;
  criticalCodes: CriticalFailureCode[];
  detail: string;
  durationMs: number;
};

export type LiveCanaryPlan = {
  authorizationRequired: true;
  executed: false;
  taskCount: number;
  maxCalls: number;
  hardSpendCapUsd: number;
  models: {
    primary: "claude-opus-5-5";
    fallback: "grok-4.7";
    routineOnly: "gpt-6.1-sol";
    blockedHighStakes: "gemini-4-argon";
  };
  taskIds: string[];
  stopConditions: string[];
  status: "PAID_VALIDATION_AUTHORIZATION_REQUIRED";
};

export const LIVE_CANARY_PLAN: LiveCanaryPlan = {
  authorizationRequired: true,
  executed: false,
  taskCount: 16,
  maxCalls: 20,
  hardSpendCapUsd: 25,
  models: {
    primary: "claude-opus-5-5",
    fallback: "grok-4.7",
    routineOnly: "gpt-6.1-sol",
    blockedHighStakes: "gemini-4-argon",
  },
  taskIds: [
    "CANARY-SUPPRESS-01",
    "CANARY-WARRANT-01",
    "CANARY-AUTHORITY-01",
    "CANARY-BRADY-LEGAL-01",
    "CANARY-GIGLIO-LEGAL-01",
    "CANARY-SYNTHESIS-01",
    "CANARY-CONFLICT-01",
    "CANARY-MIRANDA-01",
    "CANARY-MOTION-REASON-01",
    "CANARY-RESEARCH-01",
    "CANARY-EXTRACT-01",
    "CANARY-EXTRACT-02",
    "CANARY-FORMAT-01",
    "CANARY-FALLBACK-SIM-01",
    "CANARY-ABSTAIN-01",
    "CANARY-DRAFT-GROUND-01",
  ],
  stopConditions: [
    "Any high-stakes route to GPT or Gemini",
    "Spend cap exceeded",
    "Critical safety failure in response",
    "Provider auth failure without fail-closed",
  ],
  status: "PAID_VALIDATION_AUTHORIZATION_REQUIRED",
};
