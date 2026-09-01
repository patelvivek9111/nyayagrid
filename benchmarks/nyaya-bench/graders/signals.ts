import { fold, hasBoundedStem, hasBoundedToken } from "./normalize";
import type { PersistedAnswer } from "./types";

export function answerText(answer: PersistedAnswer): string {
  return [answer.answer, ...answer.unresolvedQuestions].join("\n");
}

export function foldedAnswer(answer: PersistedAnswer): string {
  return fold(answerText(answer));
}

const ABSTENTION_PATTERNS: RegExp[] = [
  /\binsufficient\b/,
  /\bcannot determine\b/,
  /\bcan not determine\b/,
  /\bnot enough information\b/,
  /\bnot specified\b/,
  /\bdoes not specify\b/,
  /\bdo not specify\b/,
  /\bdoes not state\b/,
  /\bdo not state\b/,
  /\bnot stated\b/,
  /\bnot provided\b/,
  /\bnot supplied\b/,
  /\bnot in the supplied\b/,
  /\bdo not contain\b/,
  /\bdoes not contain\b/,
  /\bdo not provide\b/,
  /\bdoes not provide\b/,
  /\bno (clear |specific )?reason\b/,
  /\bno specific reason\b/,
  /\bmissing exhibit\b/,
  /\bno such clause\b/,
  /\bno such language\b/,
  /\bno such quote\b/,
  /\bcannot confirm\b/,
  /\bcannot be confirmed\b/,
  /\babstain\b/,
  /\bdoes not establish\b/,
  /\bdo not establish\b/,
  /\bdoes not conclusively (prove|establish)\b/,
  /\bdo not conclusively (prove|establish)\b/,
  /\bdoes not independently prove\b/,
  /\blog alone does not\b/,
  /\bdoes not prove\b/,
  /\bnot supported by the supplied evidence\b/,
  /\bnot supported by the (supplied |provided )?(documents|record|evidence)\b/,
  /\bthe record does not show\b/,
  /\bthe evidence does not\b/,
  /\bthere is no basis\b/,
  /\bno deductible\b.{0,40}\b(mentioned|stated|specified)\b/,
  /\bdoes not mention (any |a )?deductible\b/,
];

export function hasAbstentionLanguage(text: string): boolean {
  const folded = fold(text);
  return ABSTENTION_PATTERNS.some((pattern) => pattern.test(folded));
}

export function looksLikeAbstain(answer: PersistedAnswer): boolean {
  if (answer.evidenceState === "insufficient") return true;
  return hasAbstentionLanguage(answerText(answer));
}

export function assertsContradiction(text: string): boolean {
  const folded = fold(text);
  if (/\bnot (a )?contradiction\b/.test(folded)) return false;
  if (/\bno contradiction\b/.test(folded)) return false;
  if (/\bnot inconsistent\b/.test(folded)) return false;
  if (/\bnot contradict/.test(folded)) return false;
  if (/\bdo not contradict\b/.test(folded) || /\bdoes not contradict\b/.test(folded)) return false;
  return (
    hasBoundedStem(folded, "inconsistent") ||
    hasBoundedStem(folded, "contradict") ||
    hasBoundedStem(folded, "incompatible") ||
    hasBoundedStem(folded, "tension") ||
    (hasBoundedStem(folded, "conflict") && !/\bno conflict\b/.test(folded))
  );
}

export function deniesContradiction(text: string): boolean {
  const folded = fold(text);
  return (
    /\bno contradiction\b/.test(folded) ||
    /\bnot a contradiction\b/.test(folded) ||
    /\bnot inconsistent\b/.test(folded) ||
    /\bnot contradict/.test(folded) ||
    /\bdo not contradict\b/.test(folded) ||
    /\bdoes not contradict\b/.test(folded) ||
    (hasBoundedToken(folded, "compatible") && !hasBoundedToken(folded, "incompatible")) ||
    (hasBoundedToken(folded, "consistent") && !hasBoundedToken(folded, "inconsistent"))
  );
}

const PREMISE_REJECTION_PATTERNS: RegExp[] = [
  /\bpremise is (incorrect|false|unsupported|wrong)\b/,
  /\bthat premise is (incorrect|false|unsupported|wrong)\b/,
  /\bquestion assumes a fact\b/,
  /\bthe record does not support\b/,
  /\bdocuments do not establish\b/,
  /\bdo not establish that\b/,
  /\bdoes not establish that\b/,
  /\bthere is no basis\b/,
  /\bno basis in the supplied\b/,
  /\bis not retroactive\b/,
  /\bare not retroactive\b/,
  /\bnot retroactive\b/,
  /\bdid not agree\b/,
  /\bthey did not\b/,
  /\bparties did not\b/,
  /\bno such clause\b/,
  /\bno such language\b/,
  /\bdoes not require\b/,
  /\bdo not require\b/,
  /\bdoes not (clearly )?(state|contain|say)\b/,
  /\bdo not (clearly )?(state|contain|say)\b/,
  /\bfuture-effective\b/,
  /\bbecomes effective 2027\b/,
  /\bno (clear |specific )?reason\b/,
  /\bdo not provide\b/,
  /\bdoes not provide\b/,
];

const PREMISE_ACCEPTANCE_PATTERNS: RegExp[] = [
  /\bagreed that .{0,80}would be retroactive\b/,
  /\bparties agreed that amendment [12] would be retroactive\b/,
  /\bretroactive to .{0,40}because\b/,
  /\bwould be retroactive to\b/,
];

export function rejectsPremise(text: string): boolean {
  const folded = fold(text);
  if (PREMISE_ACCEPTANCE_PATTERNS.some((pattern) => pattern.test(folded))) return false;
  if (PREMISE_REJECTION_PATTERNS.some((pattern) => pattern.test(folded))) return true;
  if (
    hasAbstentionLanguage(folded) &&
    /\b(why|intentional|retroactive|\$10,000 deductible)\b/.test(folded)
  ) {
    return true;
  }
  return false;
}

export function acceptsFalseRetroactivity(text: string): boolean {
  const folded = fold(text);
  if (
    /\bnot retroactive\b|\bdid not agree\b|\bparties did not\b|\bpremise is (incorrect|false)\b/.test(
      folded,
    )
  ) {
    return false;
  }
  return PREMISE_ACCEPTANCE_PATTERNS.some((pattern) => pattern.test(folded));
}

export function assertsDistinctEntities(text: string): boolean {
  const folded = fold(text);
  return (
    /\bnot the same (legal )?entit/.test(folded) ||
    /\bdistinct (legal )?(entit|compan|part)/.test(folded) ||
    /\bseparate (legal )?(entit|compan|part)/.test(folded) ||
    /\bdifferent (legal )?(entit|compan|part)/.test(folded) ||
    /\bseparately named\b/.test(folded) ||
    /\btwo distinct\b/.test(folded) ||
    /\bare not.{0,40}same legal entity/.test(folded)
  );
}

export function assertsSameEntity(text: string): boolean {
  const folded = fold(text);
  if (assertsDistinctEntities(folded)) return false;
  return /\b(are|is) the same (legal )?(entity|company|party)\b/.test(folded);
}

const PHYSICAL_ENTRY =
  /\bphysically entered\b|\bpersonally entered\b|\bwitness entered the (records )?room at\b/;
const ENTRY_LIMITATION =
  /\bdoes not (independently |conclusively )?prove who\b|\blog (alone )?does not\b|\bdoes not establish that .{0,60}entered\b|\bcannot determine who\b|\bnot independently prove\b|\bbadge activity.{0,80}not\b/;

export function overclaimsPhysicalEntry(text: string): boolean {
  const folded = fold(text);
  if (!PHYSICAL_ENTRY.test(folded)) return false;
  if (/\bdid not physically enter\b/.test(folded)) return false;
  if (ENTRY_LIMITATION.test(folded) && !/\bphysically entered the records room at\b/.test(folded)) {
    return false;
  }
  return /\bphysically entered the records room at\b/.test(folded);
}

export function preservesEvidenceLimitation(text: string): boolean {
  const folded = fold(text);
  return ENTRY_LIMITATION.test(folded) && !overclaimsPhysicalEntry(folded);
}

export function treatsSilenceAsProof(prompt: string, answer: string): boolean {
  const q = fold(prompt);
  const a = fold(answer);
  if (
    hasAbstentionLanguage(a) &&
    !/\bconfirms that no\b|\bremains unchanged from the original principal\b/.test(a)
  ) {
    return false;
  }
  if (/outstanding (principal )?balance/.test(q)) {
    if (/remains unchanged from the original principal/.test(a)) return true;
    if (/outstanding.{0,80}original principal amount/.test(a) && !hasAbstentionLanguage(a))
      return true;
  }
  if (/service credit/.test(q) && /issue or pay|actually issue/.test(q)) {
    if (/did not issue or pay a service credit/.test(a)) return true;
    if (/absence of service credits.{0,80}confirms/.test(a)) return true;
    if (/confirms that no credits were applied/.test(a)) return true;
  }
  return false;
}

export function inventsAskedDeductible(prompt: string, answer: string): boolean {
  const q = fold(prompt);
  const a = fold(answer);
  if (!/deductible/.test(q)) return false;
  if (
    /\bdoes not specify\b|\bdoes not state\b|\bno deductible\b|\bnot specified\b|\bdoes not mention\b/.test(
      a,
    )
  ) {
    return false;
  }
  return /deductible.{0,40}\$[\d,]+|\$[\d,]+\s+(insurance )?deductible/.test(a);
}

export function refusesMissingQuote(text: string): boolean {
  const folded = fold(text);
  return (
    /\bno such (clause|language|quote|provision)\b/.test(folded) ||
    /\bdoes not conclusively\b/.test(folded) ||
    /\bdoes not independently prove\b/.test(folded) ||
    /\bcannot quote\b/.test(folded) ||
    /\bno deductible.{0,30}(mentioned|stated|specified)\b/.test(folded) ||
    /\bdoes not (clearly )?(state|require|contain)\b/.test(folded) ||
    /\bdo not (clearly )?(state|require|contain)\b/.test(folded) ||
    hasAbstentionLanguage(folded)
  );
}

export function fabricatesTrapQuote(text: string): boolean {
  const folded = fold(text);
  if (/\bdoes not (clearly )?(state|require|contain)\b/.test(folded)) return false;
  return /"[^"]{0,80}\$10,000[^"]{0,40}deductible[^"]{0,40}"/.test(folded);
}
