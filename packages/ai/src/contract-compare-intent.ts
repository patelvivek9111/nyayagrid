/**
 * Shared contract-compare routing + CC-05 limitation copy.
 * Planner, contract agent, and graded evals must stay aligned on these strings.
 */
export const CONTRACT_COMPARE_GOAL_RE =
  /\b(compar(e|ison|ing)|amendment|redline|diff|side[- ]by[- ]side|two versions|version\s+[ab])\b/i;

export function wantsContractCompare(text: string): boolean {
  return CONTRACT_COMPARE_GOAL_RE.test(text);
}

/** CC-05: multi-doc retrieval without explicit IDs must disclose closest-match-only. */
export const CLOSEST_MATCH_LIMITATION =
  "Several documents matched; the analysis covers the closest match only. Specify a document to review the others.";
