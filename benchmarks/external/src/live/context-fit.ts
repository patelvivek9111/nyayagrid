export type ContextFit =
  "FULL_CONTEXT_SUPPORTED" | "REQUIRES_DEFINED_TRUNCATION_POLICY" | "INELIGIBLE";

export function assessContextFit(input: {
  inputTokensEstimate: number;
  maxOutputTokens: number;
  contextWindow: number;
  truncationPolicyDefined?: boolean;
}): ContextFit {
  const total = input.inputTokensEstimate + input.maxOutputTokens;
  if (total <= input.contextWindow) {
    return "FULL_CONTEXT_SUPPORTED";
  }
  if (input.truncationPolicyDefined) {
    return "REQUIRES_DEFINED_TRUNCATION_POLICY";
  }
  return "INELIGIBLE";
}

export function assertNoSilentTruncate(fit: ContextFit): void {
  if (fit === "INELIGIBLE") {
    throw new Error("Context ineligible; silent truncation forbidden.");
  }
}
