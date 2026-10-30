/**
 * Canonical paid-call completion statuses persisted on PersistedPaidCallRecord.
 *
 * Provider-layer LiveProviderResult may use "incomplete" for a known empty
 * final answer; Stage-1 maps that onto "terminal_incomplete" at persist time.
 */
export const PAID_CALL_COMPLETION_STATUSES = [
  "success",
  "failed",
  "unknown_completion_review_required",
  "terminal_incomplete",
] as const;

export type PaidCallCompletionStatus = (typeof PAID_CALL_COMPLETION_STATUSES)[number];

/** Provider request finished with no usable final answer (output/thinking budget exhausted). */
export const TERMINAL_INCOMPLETE_STATUS = "terminal_incomplete" as const;

export function isPaidCallCompletionStatus(value: string): value is PaidCallCompletionStatus {
  return (PAID_CALL_COMPLETION_STATUSES as readonly string[]).includes(value);
}

/**
 * Terminal outcomes that count toward terminal response coverage once persisted.
 * Excludes unknown_completion_review_required (quarantine / uncertain transport).
 */
export function isTerminalPaidCallCompletionStatus(status: PaidCallCompletionStatus): boolean {
  return status === "success" || status === "failed" || status === "terminal_incomplete";
}

/** Only "success" is a valid successful response for scoring / usable-answer gates. */
export function isValidSuccessCompletionStatus(status: PaidCallCompletionStatus): boolean {
  return status === "success";
}

/**
 * Blind retry is never appropriate for terminal_incomplete: the provider call
 * completed and the frozen output budget was exhausted. Existing statuses keep
 * their prior policy (unknown may be carefully reviewed; success/failed are done).
 */
export function allowsBlindRetryForCompletionStatus(status: PaidCallCompletionStatus): boolean {
  if (status === "terminal_incomplete") return false;
  if (status === "success") return false;
  if (status === "failed") return false;
  // unknown_completion_review_required: never blind-retry; require audit path.
  return false;
}

export function countsTowardTerminalCoverage(status: PaidCallCompletionStatus): boolean {
  return isTerminalPaidCallCompletionStatus(status);
}
