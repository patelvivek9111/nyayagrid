/**
 * Deterministic safety guardrails for Guide answers. These run in code, after the model responds,
 * so a provider that ignores its system prompt still cannot make it into a persisted answer.
 */

/**
 * Matches a sentence asserting that some clause/term/provision/notice/action is illegal, void,
 * unenforceable, or invalid. Deliberately broad — a false positive just strips a sentence that
 * needed authority support anyway.
 */
const ILLEGALITY_CLAIM_PATTERN =
  /\b(this|that|the)\b[^.!?]{0,80}\b(clause|term|provision|section|notice|action|agreement|contract)\b[^.!?]{0,120}\b(is|are|was|were)\b[^.!?]{0,40}\b(illegal|unenforceable|void|invalid|unlawful)\b[^.!?]*[.!?]/gi;

export function containsIllegalityClaim(text: string): boolean {
  return ILLEGALITY_CLAIM_PATTERN.test(text);
}

export const ILLEGALITY_GUARDRAIL_NOTE =
  "A statement asserting that something is illegal or unenforceable was removed because it was not supported by a retrieved legal authority. Whether a clause is enforceable depends on your specific jurisdiction and facts — a lawyer can evaluate this.";

/**
 * Strip any sentence claiming illegality/unenforceability unless a LEGAL_AUTHORITY source backs
 * the answer. Guide must never assert a clause is illegal or unenforceable from model memory
 * alone.
 */
export function enforceIllegalityGuardrail(
  answer: string,
  hasAuthoritySource: boolean,
): { answer: string; wasBlocked: boolean } {
  ILLEGALITY_CLAIM_PATTERN.lastIndex = 0;
  if (hasAuthoritySource || !containsIllegalityClaim(answer)) {
    return { answer, wasBlocked: false };
  }
  const cleaned = answer
    .replace(ILLEGALITY_CLAIM_PATTERN, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return {
    answer:
      cleaned.length > 0
        ? cleaned
        : "General legal information is available, but a definitive statement about legality could not be made without supporting legal authority.",
    wasBlocked: true,
  };
}
