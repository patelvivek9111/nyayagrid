/**
 * Detect when Case Q&A should ask the user for additional documents
 * rather than pretending the retrieved set is complete.
 */

import { extractNamedInstrument, instrumentMentionIsDenial } from "./operative-facts";

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

const MISSING_INSTRUMENT_RE =
  /not (available|attached|among|in the (case|file|uploaded|retrieved))|do not include|was not found|is missing/i;

export function ensureMissingInstrumentDisclosure(
  question: string,
  answer: string,
  sourceText: string,
): string {
  const named = extractNamedInstrument(question);
  if (!named) return answer;
  if (MISSING_INSTRUMENT_RE.test(answer)) return answer;
  const compactNamed = named.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const compactSource = sourceText.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const mentioned = Boolean(compactNamed && compactSource.includes(compactNamed));
  const legacyDenial =
    /does not attach a non-compete|draft not for execution|unsigned draft header.{0,40}superseded|superseded .{0,40}executed/i.test(
      sourceText,
    );
  if (mentioned && !instrumentMentionIsDenial(named, sourceText) && !legacyDenial) return answer;
  return `${answer.trim()}\n\n${named} is not available in the Case materials currently accessible. What that instrument would show cannot be concluded without it.`;
}

/** Expand a matter question for a second retrieval hop (multi-hop). */
export function buildFollowUpRetrievalQuery(question: string): string | null {
  const q = question.trim();
  if (q.length < 8) return null;

  const expansions: string[] = [];
  if (/\boriginal\b/i.test(q) && /\b(cap|liability|amount|price)\b/i.test(q)) {
    expansions.push("original aggregate liability cap main agreement");
  }
  if (/\bindemnit/i.test(q) || (/amendment/i.test(q) && !/\b(cap|liability cap)\b/i.test(q))) {
    expansions.push("amendment indemnity");
  } else if (/amendment/i.test(q)) {
    expansions.push("amendment liability cap");
  }
  if (/cam|reconcile|common area/i.test(q)) expansions.push("CAM reconciliation package");
  if (/deposit|deposition|transcript/i.test(q)) expansions.push("deposition transcript testimony");
  if (/notice|terminat/i.test(q)) expansions.push("termination notice");
  if (/\b(on 20\d{2}-|will apply|as of)\b/i.test(q) && /\bnotice\b/i.test(q)) {
    expansions.push("amendment convenience notice effective date");
  }
  if (/\b(conflict|contradict|inconsistent)\b/i.test(q)) {
    expansions.push("deposition testimony meeting date meeting minutes");
  }
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
