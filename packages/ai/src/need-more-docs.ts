/**
 * Detect when Case Q&A should ask the user for additional documents
 * rather than pretending the retrieved set is complete.
 */

export function assessNeedMoreDocuments(params: {
  evidenceState: string;
  retrievedCount: number;
  unresolvedQuestions: string[];
  question?: string;
}): { needsMoreDocuments: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const state = params.evidenceState.toLowerCase();
  const unresolved = params.unresolvedQuestions.join(" ").toLowerCase();
  const question = (params.question ?? "").toLowerCase();

  if (state === "insufficient") {
    reasons.push("Answer is insufficiently grounded in retrieved Case sources.");
  }
  if (state === "partial") {
    reasons.push("Answer is only partially grounded; additional Case documents may complete it.");
  }
  if (params.retrievedCount === 0) {
    reasons.push("No Case document passages were retrieved for this question.");
  }
  if (
    /(upload|additional document|another document|missing document|not in (the )?sources|need (more|the) (document|exhibit|agreement|amendment))/i.test(
      unresolved,
    )
  ) {
    reasons.push("Unresolved questions call for documents not present in retrieval.");
  }
  if (
    params.retrievedCount > 0 &&
    state !== "grounded" &&
    /(amendment|indemnit|deposition|exhibit|attachment|schedule|cam|reconcile)/i.test(question)
  ) {
    reasons.push("Question references document types that may not be fully covered by retrieval.");
  }

  const needsMoreDocuments = state !== "grounded" && reasons.length > 0;
  return { needsMoreDocuments, reasons: needsMoreDocuments ? reasons : [] };
}

/** Expand a matter question for a second retrieval hop (multi-hop). */
export function buildFollowUpRetrievalQuery(question: string): string | null {
  const q = question.trim();
  if (q.length < 8) return null;

  const expansions: string[] = [];
  if (/amendment|indemnit/i.test(q)) expansions.push("amendment indemnity");
  if (/cam|reconcile|common area/i.test(q)) expansions.push("CAM reconciliation package");
  if (/deposit|deposition|transcript/i.test(q)) expansions.push("deposition transcript testimony");
  if (/notice|terminat/i.test(q)) expansions.push("termination notice");
  if (/rent|payment|installment/i.test(q)) expansions.push("base rent payment");

  if (expansions.length === 0) {
    // Generic: keep content words longer than 3 chars
    const tokens = q
      .split(/\W+/)
      .filter((t) => t.length > 3)
      .slice(0, 8);
    if (tokens.length < 2) return null;
    return tokens.join(" ");
  }

  return `${q} ${expansions.join(" ")}`;
}
