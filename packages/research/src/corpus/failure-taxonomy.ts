/** Import failure taxonomy for Phase 6T-CORPUS-1 reporting. */
export const IMPORT_FAILURE_CODES = [
  "A_source_unavailable",
  "B_parser_failure",
  "C_ambiguous_jurisdiction",
  "D_ambiguous_court",
  "E_citation_missing",
  "F_date_missing",
  "G_duplicate_conflict",
  "H_version_conflict",
  "I_malformed_text",
  "J_source_trust_issue",
  "K_rate_access_issue",
  "L_indexing_failure",
] as const;

export type ImportFailureCode = (typeof IMPORT_FAILURE_CODES)[number];

export type ImportFailure = {
  code: ImportFailureCode;
  message: string;
  sourceExternalId?: string;
  state?: string;
};
