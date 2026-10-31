export const SUITE_ID = "NYAYA_EXTERNAL_PROSECUTION_VALIDATION" as const;
export const SUITE_VERSION = "1.0.0" as const;
export const DETERMINISTIC_SEED = "nyaya-external-prosecution-v1" as const;

export const TASK_GROUPS = [
  "US_EVIDENCE_REASONING",
  "US_AUTHORITY_VERIFICATION",
  "US_PRECEDENT_FACT_CHECKING",
  "CITATION_RELIABILITY",
  "CRIMINAL_RAG_RETRIEVAL",
  "CRIMINAL_RAG_GROUNDING",
  "ABSTENTION",
  "SOURCE_FIDELITY",
] as const;

export type TaskGroup = (typeof TASK_GROUPS)[number];

export const EVAL_MODES = [
  "RAW_MODEL_DIAGNOSTIC",
  "NYAYA_PIPELINE",
  "ROUTER_ONLY",
  "RETRIEVAL_ONLY",
] as const;

export type EvalMode = (typeof EVAL_MODES)[number];

export const CITATION_MODES = ["CLOSED_BOOK_DIAGNOSTIC", "NYAYA_GROUNDED_VERIFICATION"] as const;
export type CitationEvalMode = (typeof CITATION_MODES)[number];

export const LEGAL_RAG_RESULT_LABEL = "NON_US_CRIMINAL_RAG_DIAGNOSTIC" as const;
export const LEGAL_RAG_JURISDICTION = "VICTORIA_AUSTRALIA" as const;

export const SAMPLE_TARGETS = {
  legalbench: 100,
  legalcitebench: 80,
  casefacts: 80,
  legalRagBench: 40,
} as const;

export const DEFAULT_LEGALBENCH_UPSTREAM_TASKS = [
  "hearsay",
  "personal_jurisdiction",
  "diversity_1",
  "diversity_2",
  "diversity_3",
  "overruling",
  "citation_prediction_classification",
  "citation_prediction_open",
  "scalr",
  "rule_qa",
] as const;
