type ResearchTurnPayload = {
  synthesis?: { conciseAnswer?: string; answer?: string } | null;
  answer?: string;
  hits?: unknown[];
};

/** Prefer the persisted research synthesis; never look only at a non-existent `answer` field. */
export function researchTurnAnswer(data: ResearchTurnPayload): string {
  const text =
    data.synthesis?.conciseAnswer?.trim() ||
    data.synthesis?.answer?.trim() ||
    data.answer?.trim();
  if (text) return text;
  if ((data.hits?.length ?? 0) > 0) {
    return "See sources for potentially relevant authority.";
  }
  return "I couldn't find enough verified authority to answer that confidently.";
}
