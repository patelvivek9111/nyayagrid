/**
 * General (no-Case) Ask is not a legal-advice engine and not a substitute for an attached document.
 * When the question is an advice/signing/counsel request, or refers to an instrument that is not in
 * the chat, answer deterministically instead of treating it as a failed corpus search.
 */

export const GENERAL_ASK_BOUNDARY_PROMPT_VERSION = "general-ask-boundary-v1";

export const GENERAL_ASK_NOT_ADVICE =
  "Nyaya cannot tell you whether to sign, and cannot give legal advice on that decision. Output here is draft work product, not a recommendation to sign, decline, or proceed.";

export const GENERAL_ASK_MISSING_INSTRUMENT =
  "This general chat has no contract clause or other document attached, so Nyaya cannot analyze “this specific clause.” Paste the clause here, or create a Case and upload the document, if you want a source-grounded draft reading of the text.";

export const GENERAL_ASK_COUNSEL =
  "Whether you need a real-estate (or other) attorney is a judgment about your facts, risk, and jurisdiction. Nyaya cannot make that call. For a signing decision, have a qualified attorney licensed where the deal is governed review the instrument before you execute it.";

const SEEKS_SIGNING_OR_ADVICE =
  /\b((can|could) you|please)\b.{0,60}\b(legally advise|advise me)\b|\b(give|giving) me legal advice\b|\bshould i (sign|execute|agree( to)?)\b|\blegally advise me\b/i;

const ASKS_WHETHER_TO_RETAIN_COUNSEL =
  /\bdo i need (a |an )?(?:\w+\s+){0,3}(lawyer|attorney)\b|\bneed (a |an )?(real[- ]estate |estate )?(lawyer|attorney)\b/i;

const REFERS_TO_THIS_INSTRUMENT =
  /\bthis (specific )?(contract )?(clause|contract|agreement|lease|document)\b/i;

const QUOTED_CLAUSE = /["“][^"”]{80,}["”]/;

export type GeneralAskBoundaryFlags = {
  seeksSigningOrAdvice: boolean;
  asksWhetherToRetainCounsel: boolean;
  referencesUnattachedInstrument: boolean;
};

export function detectGeneralAskBoundary(question: string): GeneralAskBoundaryFlags {
  const q = question.trim();
  const referencesInstrument = REFERS_TO_THIS_INSTRUMENT.test(q);
  const hasQuotedClause = QUOTED_CLAUSE.test(q);
  return {
    seeksSigningOrAdvice: SEEKS_SIGNING_OR_ADVICE.test(q),
    asksWhetherToRetainCounsel: ASKS_WHETHER_TO_RETAIN_COUNSEL.test(q),
    referencesUnattachedInstrument: referencesInstrument && !hasQuotedClause,
  };
}

export function buildGeneralAskBoundaryAnswer(question: string): string | null {
  const flags = detectGeneralAskBoundary(question);
  if (
    !flags.seeksSigningOrAdvice &&
    !flags.asksWhetherToRetainCounsel &&
    !flags.referencesUnattachedInstrument
  ) {
    return null;
  }

  const parts: string[] = [];
  if (flags.seeksSigningOrAdvice) parts.push(GENERAL_ASK_NOT_ADVICE);
  if (flags.referencesUnattachedInstrument) parts.push(GENERAL_ASK_MISSING_INSTRUMENT);
  if (flags.asksWhetherToRetainCounsel) parts.push(GENERAL_ASK_COUNSEL);
  if (parts.length === 0) return null;
  return parts.join("\n\n");
}
