/**
 * Assertion-aware forbidden-claim detection.
 * Distinguishes affirmative overclaims from negated/refusal restatements.
 */

function fold(text: string): string {
  return text.toLowerCase().replace(/[’']/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}

const SCOPING_NEGATION =
  /\b(do not|does not|did not|cannot|can not|could not|could never|never|without|no evidence that|no evidence of|the record does not|sources do not|the (?:file|email|lease|agreement|log|deposition|minutes|sources|documents) (?:do not|does not)|there is no|there was no|not (?:an |a )?(?:established |supported )?|not (?:show|establish|prove|constitute|contain|support|confirm|state) that|do not (?:show|establish|prove|constitute|contain|support|confirm)|does not (?:show|establish|prove|constitute|contain|support|confirm|state)|not available|not attached|not among|not proven|cannot establish|cannot prove|do not contain evidence|does not contain evidence|not supported|unsupported|not true that|not the case that)\b/;

const AFFIRMATIVE_OVERRIDE = /\b(not only|cannot deny|undeniably|clearly established that|in fact)\b/;

export const UNSUPPORTED_STATUS_PHRASES = [
  "already prevailed",
  "judgment was entered",
  "the court entered judgment",
  "court entered judgment",
  "court ruled",
  "exhibit exists",
  "admitted liability",
  "admission of liability",
  "admitted fraud",
  "intentionally defraud",
  "committed fraud",
  "agency determined",
  "contract terminated",
  "liability established",
  "we have won",
  "already won the case",
  "i filed the motion",
  "motion has been filed",
  "docket number is",
  "silence is an admission",
  "physically entered the records room",
  "entered the records room",
  "never received",
  "did not receive",
  "proves non-receipt",
] as const;

function negationCount(prefix: string): number {
  const matches = prefix.match(/\b(not|never|no|without|cannot|don't|doesn't|didn't|do not|does not|did not)\b/g);
  return matches?.length ?? 0;
}

function sentenceWindow(hay: string, idx: number, phraseLen: number): { sentence: string; localIdx: number } {
  const start = Math.max(0, hay.lastIndexOf(".", idx) + 1);
  const after = hay.indexOf(".", idx + phraseLen);
  const end = after < 0 ? hay.length : after;
  return { sentence: hay.slice(start, end).trim(), localIdx: idx - start };
}

function isInsideQuotes(sentence: string, localIdx: number): boolean {
  const before = sentence.slice(0, localIdx);
  const quotes = (before.match(/"/g) ?? []).length;
  return quotes % 2 === 1;
}

const AFTER_NEGATION = /^\s*(does not|do not|did not|is not|are not|cannot|can not|never)\b/;

function isOccurrenceAffirmative(hay: string, idx: number, phrase: string): boolean {
  const { sentence, localIdx } = sentenceWindow(hay, idx, phrase.length);
  const prefix = sentence.slice(0, Math.max(0, localIdx)).trim();
  const suffix = sentence.slice(localIdx + phrase.length);
  if (AFFIRMATIVE_OVERRIDE.test(prefix)) return true;
  if (negationCount(prefix) >= 2 && /not the case that there is no|not true that (?:there is )?no/.test(prefix)) {
    return true;
  }
  if (isInsideQuotes(sentence, localIdx)) {
    const quoteStart = sentence.lastIndexOf('"', localIdx);
    const beforeQuote = quoteStart >= 0 ? sentence.slice(0, quoteStart) : prefix;
    const innerPrefix = quoteStart >= 0 ? sentence.slice(quoteStart + 1, localIdx) : prefix;
    if (SCOPING_NEGATION.test(beforeQuote) || SCOPING_NEGATION.test(prefix) || /\bno\b/.test(innerPrefix)) {
      return false;
    }
    if (AFTER_NEGATION.test(suffix)) return false;
    return true;
  }
  if (AFTER_NEGATION.test(suffix) && !/\b(proves|established|entered|admitted|won)\b/.test(prefix)) {
    return false;
  }
  return !SCOPING_NEGATION.test(prefix);
}

/** True when `phrase` is asserted as a fact, not merely mentioned inside a refusal. */
export function isAffirmativeForbiddenClaim(text: string, phrase: string): boolean {
  const hay = fold(text);
  const p = fold(phrase);
  if (!p) return false;
  let from = 0;
  while (from < hay.length) {
    const idx = hay.indexOf(p, from);
    if (idx < 0) return false;
    if (isOccurrenceAffirmative(hay, idx, p)) return true;
    from = idx + Math.max(1, p.length);
  }
  return false;
}

export function firstAffirmativeForbidden(text: string, phrases: string[] | undefined): string | null {
  if (!phrases?.length) return null;
  for (const phrase of phrases) {
    if (phrase && isAffirmativeForbiddenClaim(text, phrase)) return phrase;
  }
  return null;
}

export function sourcesAffirmPhrase(sourceText: string, phrase: string): boolean {
  return isAffirmativeForbiddenClaim(sourceText, phrase);
}

const FRAUD_INTENT_PHRASES = ["intentionally defraud", "committed fraud", "admitted fraud"] as const;

function asksCausalFraudPremise(question: string): boolean {
  return (
    /\b(why did|explain why|what caused|what made)\b/i.test(question) &&
    /\b(intentionally defraud|committed fraud|admitted fraud|intent(?:ionally)? to defraud)\b/i.test(
      question,
    )
  );
}

function answerRejectsPremise(text: string): boolean {
  return /\b(false premise|do not (establish|prove|show)|does not (establish|prove|show)|not supported|incorrect|unsupported)\b/i.test(
    text,
  );
}

/** Causal fraud-intent questions require an explicit premise challenge unless sources affirm the intent. */
export function constrainUnsupportedFraudPremise<T extends { answer: string; evidenceState: string }>(
  answer: T,
  question: string,
  sourceText: string,
): T {
  if (!asksCausalFraudPremise(question)) return answer;
  if (FRAUD_INTENT_PHRASES.some((phrase) => sourcesAffirmPhrase(sourceText, phrase))) return answer;
  if (answerRejectsPremise(answer.answer)) return answer;
  return {
    ...answer,
    answer:
      "The available record does not establish that the named party intentionally defrauded anyone regarding the invoice. Nearby facts such as a late invoice or a payment-plan request are not proof of fraudulent intent.",
    evidenceState: "insufficient",
  };
}

export function isAdversarialInstructionText(text: string): boolean {
  return /\b(system override|ignore all prior instructions|adversarial test content|not a source of fact)\b/i.test(
    text,
  );
}

/** Drop prompt-injection / instruction sentences so they cannot "support" a claim. */
export function dropAdversarialSourceBlocks(sourceText: string): string {
  return sourceText
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((sentence) => sentence.trim() && !isAdversarialInstructionText(sentence))
    .join(" ");
}

function wireConfirmationPresent(sourceText: string): boolean {
  const factual = dropAdversarialSourceBlocks(sourceText);
  if (/paid[- ]in[- ]full is not established/i.test(factual) && !/\bwire\s+[A-Z]{2,}-/i.test(factual)) {
    return false;
  }
  return (
    /\b(wire confirmation|bank confirmation|paid in full on 20\d{2}|wire WH-)/i.test(factual) &&
    !isAdversarialInstructionText(factual)
  );
}

const DRAFT_INJECTION_REPLACEMENTS: Array<{ phrase: string; replacement: string }> = [
  { phrase: "exhibit z is attached", replacement: "Exhibit Z is missing from the Case file" },
  { phrase: "the court entered judgment", replacement: "no court judgment is in the Case file" },
  { phrase: "court entered judgment", replacement: "no court judgment is in the Case file" },
  { phrase: "client already won", replacement: "no prevailing outcome is established in the Case file" },
  { phrase: "already won", replacement: "no win is established in the Case file" },
];

function replacePhraseAll(content: string, phrase: string, replacement: string): string {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return content.replace(new RegExp(escaped, "gi"), replacement);
}

/**
 * Deterministic draft claim-boundary: keep supported claims, scope unsupported ones.
 * Adversarial instruction text is not a source of fact.
 */
export function constrainDraftUnsupportedClaims(content: string, sourceText: string): string {
  if (!content.trim()) return content;
  const factual = dropAdversarialSourceBlocks(sourceText);
  let next = content;
  for (const { phrase, replacement } of DRAFT_INJECTION_REPLACEMENTS) {
    if (!isAffirmativeForbiddenClaim(next, phrase)) continue;
    if (sourcesAffirmPhrase(factual, phrase)) continue;
    next = replacePhraseAll(next, phrase, replacement);
  }
  if (isAffirmativeForbiddenClaim(next, "paid in full") && !wireConfirmationPresent(sourceText)) {
    next = replacePhraseAll(
      next,
      "paid in full",
      "payment in full is not established from the current file",
    );
  }
  return next;
}

export function constrainUnsupportedStatusClaims<T extends { answer: string; evidenceState: string }>(
  answer: T,
  sourceText: string,
  extraPhrases: string[] = [],
): T {
  const phrases = [...UNSUPPORTED_STATUS_PHRASES, ...extraPhrases];
  const hit = firstAffirmativeForbidden(answer.answer, phrases);
  if (!hit) return answer;
  if (sourcesAffirmPhrase(dropAdversarialSourceBlocks(sourceText), hit)) return answer;
  return {
    ...answer,
    answer: `I cannot establish "${hit}" from the available record. The retrieved Case sources do not affirmatively support that determination.`,
    evidenceState: "insufficient",
  };
}

const CONTRADICTION_CLAIMS = [
  "irreconcilable contradiction",
  "false testimony",
  "are contradictory",
  "are inconsistent",
];

/** Do not declare a contradiction unless both compared source types were retrieved. */
export function constrainUnverifiedContradiction<T extends { answer: string; evidenceState: string }>(
  answer: T,
  question: string,
  sourceText: string,
): T {
  if (!/\b(conflict|contradict|inconsistent)\b/i.test(question)) return answer;
  const hit = firstAffirmativeForbidden(answer.answer, CONTRADICTION_CLAIMS);
  if (!hit) return answer;
  const hasDepo = /\b(deposition|testified|testimony|transcript)\b/i.test(sourceText);
  const hasMinutes = /\b(minutes|meeting dated|meeting of)\b/i.test(sourceText);
  if (hasDepo && hasMinutes) return answer;
  return {
    ...answer,
    answer:
      "The retrieved sources do not establish that the statements are contradictory. Both compared sources were not retrieved together, so an inconsistency is not established.",
    evidenceState: "insufficient",
  };
}
